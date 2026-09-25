import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DEFAULT_MODEL, estimateCostIdr, maxOutputTokens, reservationCostIdr } from './pricing.ts'
import { ITEM_ANALYSIS_SCHEMA, normalizeItemAnalysis } from './analysis-schema.ts'
import { createItemAnalysisRequest } from './analysis-request.js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function errorResponse(error: string, message: string, status: number, extra: Record<string, unknown> = {}) {
  return response({ ok: false, error, message, ...extra }, status)
}

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function optimizedImageUrl(rawUrl: unknown, supabaseUrl: string) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return null
  try {
    const url = new URL(rawUrl)
    const base = new URL(supabaseUrl)
    if (url.origin !== base.origin || !url.pathname.startsWith('/storage/v1/object/public/')) return null
    url.pathname = url.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
    url.searchParams.set('width', '1280')
    url.searchParams.set('quality', '75')
    return url.toString()
  } catch {
    return null
  }
}

function outputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === 'string') return payload.output_text
  const output = Array.isArray(payload.output) ? payload.output : []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []
    for (const part of content) {
      if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') return (part as Record<string, unknown>).text as string
    }
  }
  return ''
}

function usageTokens(payload: Record<string, unknown>) {
  const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : {}
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === 'object' ? usage.input_tokens_details as Record<string, unknown> : {}
  return {
    input: Math.max(0, Math.floor(safeNumber(usage.input_tokens ?? usage.prompt_tokens))),
    cachedInput: Math.max(0, Math.floor(safeNumber(inputDetails.cached_tokens))),
    output: Math.max(0, Math.floor(safeNumber(usage.output_tokens ?? usage.completion_tokens))),
  }
}

function providerMessage(status: number) {
  if (status === 401 || status === 403) return 'AI provider authentication is not configured correctly.'
  if (status === 429) return 'AI provider rate limit reached. Please retry later.'
  return 'AI provider is temporarily unavailable. Please retry later.'
}

async function releaseReservation(supabase: ReturnType<typeof createClient>, usageId: string) {
  await supabase.rpc('release_ai_usage', { p_usage_id: usageId }).catch(() => undefined)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Only POST is supported.', 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = request.headers.get('Authorization')
  if (!supabaseUrl || !supabaseAnonKey || !authorization) return errorResponse('AUTHENTICATION_REQUIRED', 'Sign in as an authorized seller first.', 401)

  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return errorResponse('AUTHENTICATION_REQUIRED', 'Sign in as an authorized seller first.', 401)

  const { data: profile, error: profileError } = await supabase.from('admins').select('role').eq('user_id', user.id).maybeSingle()
  const role = String(profile?.role || '').toUpperCase()
  if (profileError || !['ADMIN', 'SELLER'].includes(role)) return errorResponse('ROLE_NOT_ALLOWED', 'This action is limited to ADMIN and SELLER accounts.', 403)

  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openAiKey) return errorResponse('AI_NOT_CONFIGURED', 'AI belum diaktifkan di server. Inventory tetap dapat digunakan.', 503)

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || body.feature !== 'ITEM_ANALYSIS') return errorResponse('INVALID_FEATURE', 'Only ITEM_ANALYSIS is enabled in this V1.', 400)
  const productId = typeof body.product_id === 'string' ? body.product_id : ''
  if (!productId) return errorResponse('PRODUCT_REQUIRED', 'Save the item before running AI Analyze.', 400)

  const { data: item, error: itemError } = await supabase.from('products').select('id,name,brand,category,size_label,condition,condition_notes,defects,purchase_price,image_urls').eq('id', productId).maybeSingle()
  if (itemError || !item) return errorResponse('PRODUCT_NOT_FOUND', 'The inventory item could not be loaded.', 404)

  const imageUrls = (Array.isArray(item.image_urls) ? item.image_urls : []).map((url) => optimizedImageUrl(url, supabaseUrl)).filter(Boolean).slice(0, 5) as string[]
  if (!imageUrls.length) return errorResponse('IMAGE_UNAVAILABLE', 'Add at least one image from Supabase Storage before analyzing this item.', 422)

  const model = DEFAULT_MODEL
  const reservedCost = reservationCostIdr(model)
  const { data: usageId, error: reserveError } = await supabase.rpc('reserve_ai_usage', { p_feature: 'ITEM_ANALYSIS', p_model: model, p_estimated_cost: reservedCost })
  if (reserveError || !usageId) {
    const isBudget = String(reserveError?.message || '').includes('AI_BUDGET_EXCEEDED')
    return errorResponse(isBudget ? 'AI_MONTHLY_BUDGET_REACHED' : 'AI_USAGE_RESERVATION_FAILED', isBudget ? 'AI monthly budget reached' : 'AI usage could not be reserved.', isBudget ? 429 : 403)
  }

  const safeItem = {
    brand: String(item.brand || '').slice(0, 120),
    title: String(item.name || '').slice(0, 180),
    category: String(item.category || '').slice(0, 100),
    size: String(item.size_label || '').slice(0, 50),
    condition: String(item.condition || '').slice(0, 80),
    condition_notes: String(item.condition_notes || '').slice(0, 300),
    visible_defects: String(item.defects || '').slice(0, 300),
    purchase_price_idr: Math.max(0, safeNumber(item.purchase_price)),
  }

  const input = [{
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: `Analyze this pre-owned fashion item for a human seller. Return only the required JSON schema. Unknown values must be empty strings or empty arrays. Never determine or imply authenticity from photos; include authenticity_not_verified and manual verification required in seller_notes. Do not invent market facts, prices, or provenance. Marketplace recommendations must cover Haqlooks, Preloved, Grailed, Vestiaire, Carousell, and Instagram. Product data only; do not request or infer buyer names, emails, phone numbers, addresses, passwords, payment data, or marketplace credentials.\n\nPRODUCT DATA: ${JSON.stringify(safeItem)}`,
      },
      ...imageUrls.map((image_url) => ({ type: 'input_image', image_url, detail: 'low' })),
    ],
  }]

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  let openAiResponse: Response
  try {
    openAiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(createItemAnalysisRequest({
        model,
        input,
        maxOutputTokens: maxOutputTokens(),
        schema: ITEM_ANALYSIS_SCHEMA,
      })),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeout)
    await releaseReservation(supabase, usageId)
    return errorResponse(error instanceof DOMException && error.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE', error instanceof DOMException && error.name === 'AbortError' ? 'AI analysis timed out. Please retry.' : 'AI provider is unavailable. Please retry.', 504)
  }
  clearTimeout(timeout)

  if (!openAiResponse.ok) {
    await releaseReservation(supabase, usageId)
    return errorResponse(openAiResponse.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR', providerMessage(openAiResponse.status), openAiResponse.status === 429 ? 429 : 502)
  }

  const payload = await openAiResponse.json().catch(() => null) as Record<string, unknown> | null
  const text = payload ? outputText(payload) : ''
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    await releaseReservation(supabase, usageId)
    return errorResponse('AI_INVALID_RESPONSE', 'AI returned an invalid structured result. Please retry.', 502)
  }
  const result = normalizeItemAnalysis(parsed)
  const tokens = usageTokens(payload || {})
  const actualCost = estimateCostIdr(model, tokens.input, tokens.output, tokens.cachedInput)
  const { error: finalizeError } = await supabase.rpc('finalize_ai_usage', { p_usage_id: usageId, p_input_tokens: tokens.input, p_output_tokens: tokens.output, p_estimated_cost: actualCost })
  if (finalizeError) return errorResponse('AI_USAGE_FINALIZE_FAILED', 'The analysis completed but its usage could not be recorded.', 500)
  const { data: usage } = await supabase.rpc('seller_ai_usage_summary')
  return response({ ok: true, feature: 'ITEM_ANALYSIS', model, result, usage: usage || null })
})
