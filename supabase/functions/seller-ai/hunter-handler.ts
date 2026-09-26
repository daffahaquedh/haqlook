import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DEFAULT_MODEL, estimateHunterCostIdr, hunterReservationCostIdr } from './pricing.ts'
import { createHunterBriefRequest, createHunterChatRequest, createHunterItemCheckRequest } from './hunter-analysis.ts'
import { countWebSearchCalls, extractHunterCitations, findHunterTarget, responsesOutputText, sanitizeHunterBrief, summarizeHaqlooksData } from './hunter-utils.ts'

type AnyClient = ReturnType<typeof createClient>
type HunterUser = { id: string; email?: string | null }
type HandlerInput = { supabase: AnyClient; user: HunterUser; role: string; body: Record<string, unknown>; openAiKey: string; supabaseUrl: string; corsHeaders: Record<string, string> }

const exactAuthenticityNote = 'Authenticity not verified. Manual verification required.'
const HUNTER_FEATURES = new Set(['HUNTER_CHAT', 'HUNTER_DESTINATION_BRIEF', 'HUNTER_REFRESH', 'HUNTER_ITEM_CHECK'])

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function failure(error: string, message: string, status: number, corsHeaders: Record<string, string>) {
  return jsonResponse({ ok: false, error, message }, status, corsHeaders)
}

function idrValue(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 && number <= 100_000_000 ? number : null
}

function searchDestination(message: string) {
  const normalized = message.toLocaleLowerCase('id-ID')
  for (const destination of ['Pajak Melati', 'Pajak Sambu', 'Carousell', 'Preloved', 'Marketplace Online']) {
    if (normalized.includes(destination.toLocaleLowerCase('id-ID'))) return destination
  }
  const match = message.match(/\b(?:ke|di|at)\s+([\p{L}\p{N}][\p{L}\p{N}'’-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’-]*){0,2})/iu)
  return match?.[1]?.slice(0, 80).trim() || ''
}

function safeDestination(value: unknown) {
  const destination = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100)
  const digits = destination.replace(/\D/g, '').length
  if (!destination || /https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Z]{2,}/i.test(destination) || digits >= 9 || /\b(?:alamat|address|jalan|jl\.?|jln\.?|nomor rumah|no rumah|rt\s*\d|rw\s*\d)\b/i.test(destination)) return ''
  return destination
}

function cacheKey(destination: string) {
  const destinationKey = destination.normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
  return `${destinationKey}|all`
}

function redactChatText(value: unknown) {
  let text = String(value || '').slice(0, 1000)
  text = text.replace(/\bhttps?:\/\/\S+/gi, '[tautan dihapus]')
  text = text.replace(/[\w.+-]+@[\w.-]+\.[A-Z]{2,}/gi, '[email dihapus]')
  text = text.replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (match) => match.replace(/\D/g, '').length >= 9 ? '[nomor dihapus]' : match)
  text = text.replace(/\b(?:alamat|address|jalan|jl\.?|jln\.?|no\.? rumah)\s*[:#-]?\s*[^.!?\n]{4,100}/gi, '[alamat dihapus]')
  text = text.split(/(?<=[.!?\n])\s+/).filter((sentence) => !/\b(buyer|pembeli|customer|email|nomor hp|no hp|telepon|payment|pembayaran|rekening|kartu kredit|credit card|alamat pembeli|buyer name)\b/i.test(sentence)).join(' ')
  return text.slice(0, 800)
}

function destinationTypeFor(destination: string) {
  const key = destination.toLocaleLowerCase('id-ID')
  if (key === 'pajak melati' || key === 'pajak sambu') return 'Indonesia thrift market'
  if (key === 'carousell' || key === 'preloved') return 'peer-to-peer marketplace'
  if (key === 'marketplace online') return 'online marketplace'
  return 'local thrift or resale market; current stock is unverified'
}

function outputUsage(payload: Record<string, unknown>) {
  const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : {}
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === 'object' ? usage.input_tokens_details as Record<string, unknown> : {}
  const finite = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
  return { input: finite(usage.input_tokens), cachedInput: finite(inputDetails.cached_tokens), output: finite(usage.output_tokens) }
}

function openAiErrorMessage(status: number) {
  if (status === 401 || status === 403) return 'AI provider authentication is not configured correctly.'
  if (status === 429) return 'AI provider rate limit reached. Please retry later.'
  return 'AI provider is temporarily unavailable. Please retry later.'
}

function parseJsonOutput(payload: Record<string, unknown>) {
  const text = responsesOutputText(payload)
  if (!text) throw new Error('AI_EMPTY_RESPONSE')
  return JSON.parse(text)
}

function serverClient(supabaseUrl: string) {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function fetchOpenAi(requestBody: Record<string, unknown>, openAiKey: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 70_000)
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok) throw Object.assign(new Error(openAiErrorMessage(response.status)), { status: response.status, provider: true })
    if (!payload) throw new Error('AI_INVALID_RESPONSE')
    return payload
  } finally { clearTimeout(timeout) }
}

async function getOrCreateSession(client: AnyClient, user: HunterUser, requestedId: unknown) {
  if (typeof requestedId === 'string' && requestedId.length <= 80) {
    const { data, error } = await client.from('hunter_sessions').select('id,user_id,destination,category_focus,budget_idr,is_here').eq('id', requestedId).maybeSingle()
    if (error) throw new Error('HUNTER_SESSION_UNAVAILABLE')
    if (data) return data
  }
  const { data, error } = await client.from('hunter_sessions').insert({ user_id: user.id }).select('id,user_id,destination,category_focus,budget_idr,is_here').single()
  if (error || !data) throw new Error('HUNTER_SESSION_CREATE_FAILED')
  return data
}

async function saveMessage(client: AnyClient, user: HunterUser, sessionId: string, role: 'user' | 'assistant', content: string, messageKind = 'chat', metadata: Record<string, unknown> = {}) {
  const { error } = await client.from('hunter_messages').insert({ session_id: sessionId, user_id: user.id, role, content: content.slice(0, 2500), message_kind: messageKind, metadata })
  if (error) throw new Error('HUNTER_MESSAGE_SAVE_FAILED')
}

async function getConversation(client: AnyClient, sessionId: string) {
  const { data, error } = await client.from('hunter_messages').select('role,content,message_kind,metadata').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(20)
  if (error) return []
  const rows = (data || []).reverse().filter((row: Record<string, unknown>) => row.role === 'user' || row.role === 'assistant')
  if (rows.at(-1)?.role === 'user') rows.pop() // Current request is provided separately to the model.
  return rows.map((row: Record<string, unknown>) => ({ role: row.role, content: redactChatText(row.content) }))
}

async function currentBriefId(client: AnyClient, sessionId: string) {
  const { data } = await client.from('hunter_messages').select('metadata').eq('session_id', sessionId).eq('role', 'assistant').eq('message_kind', 'brief').order('created_at', { ascending: false }).limit(1).maybeSingle()
  const id = data?.metadata?.brief_id
  return typeof id === 'string' ? id : null
}

async function reserveUsage(client: AnyClient, feature: string, model: string, effort: string, amount: number, details: Record<string, unknown>) {
  const { data, error } = await client.rpc('reserve_hunter_ai_usage', { p_feature: feature, p_model: model, p_reasoning_effort: effort, p_estimated_cost: amount, p_details: details })
  if (error || !data) {
    const budget = String(error?.message || '').includes('AI_BUDGET_EXCEEDED')
    throw Object.assign(new Error(budget ? 'AI monthly budget reached' : 'AI usage could not be reserved.'), { code: budget ? 'AI_MONTHLY_BUDGET_REACHED' : 'AI_USAGE_RESERVATION_FAILED', status: budget ? 429 : 403 })
  }
  return String(data)
}

async function releaseUsage(client: AnyClient, id: string) {
  await client.rpc('release_ai_usage', { p_usage_id: id }).catch(() => undefined)
}

async function finalizeUsage(client: AnyClient, id: string, feature: string, payload: Record<string, unknown>, details: Record<string, unknown>) {
  const tokens = outputUsage(payload)
  const searches = countWebSearchCalls(payload)
  const cost = estimateHunterCostIdr(DEFAULT_MODEL, tokens.input, tokens.output, tokens.cachedInput, searches)
  const { error } = await client.rpc('finalize_hunter_ai_usage', {
    p_usage_id: id,
    p_input_tokens: tokens.input,
    p_output_tokens: tokens.output,
    p_tool_cost: cost.toolCostIdr,
    p_total_cost: cost.totalCostIdr,
    p_search_calls: searches,
    p_details: { ...details, feature, search_calls: searches },
  })
  if (error) throw new Error('AI_USAGE_FINALIZE_FAILED')
  return { input_tokens: tokens.input, output_tokens: tokens.output, search_calls: searches, tool_cost_idr: cost.toolCostIdr, estimated_cost_idr: cost.totalCostIdr }
}

async function getInternalSummary(client: AnyClient) {
  const [{ data: products }, { data: sales }] = await Promise.all([
    client.from('products').select('id,brand,category,status,purchase_price,created_at,sold_at').limit(1000),
    client.from('sales').select('product_id,sale_price,net_profit,sold_via').limit(1000),
  ])
  return summarizeHaqlooksData(products || [], sales || [])
}

async function updateSession(client: AnyClient, sessionId: string, values: Record<string, unknown>) {
  await client.from('hunter_sessions').update({ ...values, updated_at: new Date().toISOString() }).eq('id', sessionId)
}

function recommendedCategories(brief: Record<string, unknown>) {
  const sections = brief.sections && typeof brief.sections === 'object' ? brief.sections as Record<string, unknown> : {}
  return [...new Set(Object.values(sections).flatMap((value) => Array.isArray(value) ? value.map((target) => String((target as Record<string, unknown>).category || '')).filter(Boolean) : []))].slice(0, 12)
}

async function handleResearch(input: HandlerInput, client: AnyClient, admin: AnyClient, session: Record<string, unknown>, feature: string, message: string) {
  const destination = safeDestination(input.body.destination || searchDestination(message) || session.destination)
  if (!destination) return failure('DESTINATION_REQUIRED', 'Sebutkan market atau tempat hunting yang ingin diteliti.', 400, input.corsHeaders)
  const key = cacheKey(destination)
  if (feature !== 'HUNTER_REFRESH') {
    const { data: cached } = await admin.from('hunter_briefs').select('id,destination,category_focus,brief_json,citations,model,created_at,expires_at,search_calls,input_tokens,output_tokens').eq('cache_key', key).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (cached) {
      const summary = `${cached.brief_json?.destination_name || destination} için ${Object.values(cached.brief_json?.sections || {}).flat().length} sourcing target siap. Sumber terverifikasi tersedia di bawah; stok fisik hari ini tidak dapat dipastikan.`
      await updateSession(client, String(session.id), { destination })
      await saveMessage(client, input.user, String(session.id), 'assistant', summary, 'brief', { brief_id: cached.id, cache_hit: true })
      return jsonResponse({ ok: true, feature: 'HUNTER_DESTINATION_BRIEF', session_id: session.id, destination, assistant_message: summary, brief_id: cached.id, cached: true, brief: { id: cached.id, destination: cached.destination, brief: cached.brief_json, citations: cached.citations || [], created_at: cached.created_at, expires_at: cached.expires_at } }, 200, input.corsHeaders)
    }
  }

  const conversation = await getConversation(client, String(session.id))
  const internalSummary = await getInternalSummary(client)
  const usageFeature = feature === 'HUNTER_REFRESH' ? 'HUNTER_REFRESH' : 'HUNTER_DESTINATION_BRIEF'
  let usageId = ''
  let providerResponded = false
  try {
    usageId = await reserveUsage(client, usageFeature, DEFAULT_MODEL, 'medium', hunterReservationCostIdr(DEFAULT_MODEL, 'research'), { destination, category: 'all', cache_key: key })
    const now = new Date().toISOString()
    const payload = await fetchOpenAi(createHunterBriefRequest({ destination, destinationType: destinationTypeFor(destination), previousSession: conversation.slice(-6), internalSummary, now }), input.openAiKey)
    providerResponded = true
    let parsed: unknown
    try { parsed = parseJsonOutput(payload) } catch {
      await finalizeUsage(client, usageId, usageFeature, payload, { destination, category: 'all', cache_key: key, cache_hit: false, invalid_response: true })
      return failure('AI_INVALID_RESPONSE', 'Research did not return a valid structured brief. Try refresh again.', 502, input.corsHeaders)
    }
    const citations = extractHunterCitations(payload)
    const brief = sanitizeHunterBrief(parsed as Record<string, unknown>, citations)
    brief.destination_name ||= destination
    const searchCalls = countWebSearchCalls(payload)
    const tokenUsage = await finalizeUsage(client, usageId, usageFeature, payload, { destination, category: 'all', cache_key: key, recommended_categories: recommendedCategories(brief), cache_hit: false })
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    const { data: stored, error: storeError } = await admin.from('hunter_briefs').upsert({ cache_key: key, destination, category_focus: 'all', brief_json: brief, citations, created_by: input.user.id, created_at: createdAt, expires_at: expiresAt, model: DEFAULT_MODEL, search_calls: searchCalls, input_tokens: tokenUsage.input_tokens, output_tokens: tokenUsage.output_tokens }, { onConflict: 'cache_key' }).select('id,destination,brief_json,citations,created_at,expires_at').single()
    if (storeError || !stored) return failure('HUNTER_CACHE_SAVE_FAILED', 'Research finished, but the shared brief could not be saved. Please retry shortly.', 500, input.corsHeaders)
    const targetCount = Object.values(brief.sections).flat().length
    const assistantMessage = `${destination} için ${targetCount} hedefli hunting brief hazır. Riset diperbarui ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(createdAt))}. Harga hanya ditampilkan jika ada sumber publik; ketersediaan barang hari ini tidak dapat dipastikan.`
    await updateSession(client, String(session.id), { destination })
    await saveMessage(client, input.user, String(session.id), 'assistant', assistantMessage, 'brief', { brief_id: stored.id, cache_hit: false })
    return jsonResponse({ ok: true, feature: usageFeature, model: DEFAULT_MODEL, reasoning_effort: 'medium', session_id: session.id, destination, assistant_message: assistantMessage, brief_id: stored.id, cached: false, brief: { id: stored.id, destination: stored.destination, brief: stored.brief_json, citations: stored.citations, created_at: stored.created_at, expires_at: stored.expires_at }, usage: tokenUsage }, 200, input.corsHeaders)
  } catch (error) {
    if (usageId && !providerResponded) await releaseUsage(client, usageId)
    const errorCode = String((error as Record<string, unknown>)?.code || '')
    if (errorCode === 'AI_MONTHLY_BUDGET_REACHED') return failure(errorCode, 'AI monthly budget reached', 429, input.corsHeaders)
    if (error instanceof Error && error.name === 'AbortError') return failure('AI_TIMEOUT', 'Research timed out. The seller workspace remains available; try again later.', 504, input.corsHeaders)
    const status = Number((error as Record<string, unknown>)?.status || 0)
    if (status) return failure(status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR', openAiErrorMessage(status), status === 429 ? 429 : 502, input.corsHeaders)
    if (String((error as Error)?.message).includes('AI_USAGE_FINALIZE_FAILED')) return failure('AI_USAGE_FINALIZE_FAILED', 'The research completed but usage could not be recorded.', 500, input.corsHeaders)
    return failure(errorCode || 'HUNTER_RESEARCH_FAILED', 'Hunting research could not be completed. Try again or keep using the manual sourcing list.', 502, input.corsHeaders)
  }
}

async function handleChat(input: HandlerInput, client: AnyClient, admin: AnyClient, session: Record<string, unknown>, message: string) {
  const briefId = await currentBriefId(client, String(session.id))
  let brief: Record<string, unknown> | null = null
  if (briefId) {
    const { data } = await admin.from('hunter_briefs').select('brief_json,citations').eq('id', briefId).maybeSingle()
    if (data) brief = { ...data.brief_json, citations: data.citations || [] }
  }
  const conversation = await getConversation(client, String(session.id))
  const safeMessage = redactChatText(message)
  const allowedCategories = new Set(['T-shirts', 'Jackets', 'Shoes', 'Bags', 'Denim', 'Knitwear', 'Accessories'])
  const rawCategories = Array.isArray(input.body.category_focus) ? input.body.category_focus : Array.isArray(session.category_focus) ? session.category_focus : []
  const requestedCategories = [...new Set(rawCategories.map(String).filter((value) => allowedCategories.has(value)))].slice(0, 7)
  const requestedBudget = idrValue(input.body.budget_idr) ?? idrValue(session.budget_idr)
  const feature = 'HUNTER_CHAT'
  let usageId = ''
  let providerResponded = false
  try {
    usageId = await reserveUsage(client, feature, DEFAULT_MODEL, 'low', hunterReservationCostIdr(DEFAULT_MODEL, 'chat'), { destination: String(session.destination || ''), mode: 'no_web_search' })
    const chatContext = `${safeMessage}\nCurrent seller focus: ${requestedCategories.join(', ') || 'all categories'}. Current purchase budget IDR: ${requestedBudget ?? 'not specified'}.`
    const payload = await fetchOpenAi(createHunterChatRequest({ message: chatContext, brief, conversation }), input.openAiKey)
    providerResponded = true
    let result: Record<string, unknown>
    try { result = parseJsonOutput(payload) as Record<string, unknown> } catch {
      await finalizeUsage(client, usageId, feature, payload, { destination: String(session.destination || ''), mode: 'no_web_search', invalid_response: true })
      return failure('AI_INVALID_RESPONSE', 'Chat returned an invalid response. Your saved brief is unchanged.', 502, input.corsHeaders)
    }
    const usage = await finalizeUsage(client, usageId, feature, payload, { destination: String(session.destination || ''), mode: 'no_web_search' })
    const reply = String(result.reply || 'Aku belum menemukan jawaban yang cukup dari brief ini.').slice(0, 1600)
    await saveMessage(client, input.user, String(session.id), 'assistant', reply, 'chat', {})
    return jsonResponse({ ok: true, feature, model: DEFAULT_MODEL, reasoning_effort: 'low', session_id: session.id, assistant_message: reply, focused_target_ids: Array.isArray(result.focused_target_ids) ? result.focused_target_ids.slice(0, 15) : [], category_focus: requestedCategories.length ? requestedCategories : Array.isArray(result.category_focus) ? result.category_focus.slice(0, 8).map(String) : [], budget_idr: requestedBudget ?? idrValue(result.budget_idr), usage }, 200, input.corsHeaders)
  } catch (error) {
    if (usageId && !providerResponded) await releaseUsage(client, usageId)
    const errorCode = String((error as Record<string, unknown>)?.code || '')
    if (errorCode === 'AI_MONTHLY_BUDGET_REACHED') return failure(errorCode, 'AI monthly budget reached', 429, input.corsHeaders)
    if (error instanceof Error && error.name === 'AbortError') return failure('AI_TIMEOUT', 'Chat timed out. Your saved brief is still available.', 504, input.corsHeaders)
    const status = Number((error as Record<string, unknown>)?.status || 0)
    if (status) return failure(status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR', openAiErrorMessage(status), status === 429 ? 429 : 502, input.corsHeaders)
    return failure(errorCode || 'HUNTER_CHAT_FAILED', 'Chat is temporarily unavailable. The saved brief and manual sourcing remain usable.', 502, input.corsHeaders)
  }
}

function cleanTargetValue(value: unknown) {
  return typeof value === 'string' ? value.slice(0, 180) : ''
}

async function handleItemCheck(input: HandlerInput, client: AnyClient, admin: AnyClient, session: Record<string, unknown>, message: string) {
  const price = idrValue(input.body.asking_price_idr)
  const rawImages = Array.isArray(input.body.image_data_urls) ? input.body.image_data_urls : []
  const imageDataUrls = rawImages.filter((value): value is string => typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 1_250_000).slice(0, 3)
  if (!price) return failure('ASKING_PRICE_REQUIRED', 'Masukkan harga penjual yang valid (IDR).', 400, input.corsHeaders)
  if (imageDataUrls.length < 1 || imageDataUrls.length !== rawImages.length || imageDataUrls.reduce((sum, value) => sum + value.length, 0) > 3_500_000) return failure('IMAGE_UNAVAILABLE', 'Pilih 1–3 foto JPEG, PNG, atau WebP yang sudah dioptimalkan di perangkat.', 422, input.corsHeaders)

  const adminRole = admin
  let verifiedTarget: Record<string, unknown> | null = null
  const briefId = typeof input.body.brief_id === 'string' ? input.body.brief_id : ''
  const targetId = typeof input.body.target?.target_id === 'string' ? String(input.body.target.target_id).slice(0, 100) : ''
  if (briefId && targetId) {
    const { data: briefRecord } = await adminRole.from('hunter_briefs').select('brief_json').eq('id', briefId).maybeSingle()
    if (briefRecord) verifiedTarget = findHunterTarget(briefRecord.brief_json, targetId)
  }
  const targetContext = verifiedTarget ? {
    target_id: cleanTargetValue(verifiedTarget.target_id),
    item_name: cleanTargetValue(verifiedTarget.item_name),
    category: cleanTargetValue(verifiedTarget.category),
    max_buy_price_idr: idrValue(verifiedTarget.max_buy_price_idr),
    resale_low: idrValue(verifiedTarget.resale_low),
    resale_high: idrValue(verifiedTarget.resale_high),
    resale_currency: cleanTargetValue(verifiedTarget.resale_currency),
    market_evidence_summary: cleanTargetValue(verifiedTarget.market_evidence_summary),
  } : null
  const feature = 'HUNTER_ITEM_CHECK'
  let usageId = ''
  let providerResponded = false
  try {
    usageId = await reserveUsage(client, feature, DEFAULT_MODEL, 'low', hunterReservationCostIdr(DEFAULT_MODEL, 'item_check'), { destination: String(session.destination || '').slice(0, 100), target_id: targetContext?.target_id || null })
    const payload = await fetchOpenAi(createHunterItemCheckRequest({ imageDataUrls, askingPriceIdr: price, target: targetContext }), input.openAiKey)
    providerResponded = true
    let result: Record<string, unknown>
    try { result = parseJsonOutput(payload) as Record<string, unknown> } catch {
      await finalizeUsage(client, usageId, feature, payload, { destination: String(session.destination || '').slice(0, 100), target_id: targetContext?.target_id || null, invalid_response: true })
      return failure('AI_INVALID_RESPONSE', 'Photo check returned an invalid response. Try again with another photo.', 502, input.corsHeaders)
    }
    result.authenticity_note = exactAuthenticityNote
    result.asking_price_idr = price
    result.referenced_resale_low = targetContext?.resale_currency === 'IDR' ? targetContext.resale_low : null
    result.referenced_resale_high = targetContext?.resale_currency === 'IDR' ? targetContext.resale_high : null
    result.referenced_resale_currency = targetContext?.resale_currency || 'UNKNOWN'
    result.possible_gross_margin_idr = targetContext?.resale_currency === 'IDR' && targetContext.resale_low != null ? Number(targetContext.resale_low) - price : null
    const usage = await finalizeUsage(client, usageId, feature, payload, { destination: String(session.destination || '').slice(0, 100), target_id: targetContext?.target_id || null, verdict: String(result.verdict || '') })
    const targetName = targetContext?.item_name || 'the photographed item'
    await saveMessage(client, input.user, String(session.id), 'assistant', `Photo check: ${String(result.verdict || 'CHECK')} · ${targetName}. Authenticity not verified.`, 'item_check', { result: { verdict: result.verdict, target_id: targetContext?.target_id || null } })
    return jsonResponse({ ok: true, feature, model: DEFAULT_MODEL, reasoning_effort: 'low', session_id: session.id, assistant_message: `${result.verdict}: ${targetName}. Authenticity not verified; manual inspection required.`, result, usage }, 200, input.corsHeaders)
  } catch (error) {
    if (usageId && !providerResponded) await releaseUsage(client, usageId)
    const errorCode = String((error as Record<string, unknown>)?.code || '')
    if (errorCode === 'AI_MONTHLY_BUDGET_REACHED') return failure(errorCode, 'AI monthly budget reached', 429, input.corsHeaders)
    if (error instanceof Error && error.name === 'AbortError') return failure('AI_TIMEOUT', 'Photo check timed out. Try again later.', 504, input.corsHeaders)
    const status = Number((error as Record<string, unknown>)?.status || 0)
    if (status) return failure(status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR', openAiErrorMessage(status), status === 429 ? 429 : 502, input.corsHeaders)
    return failure(errorCode || 'HUNTER_ITEM_CHECK_FAILED', 'Photo check is temporarily unavailable.', 502, input.corsHeaders)
  }
}

export async function handleHunterRequest(input: HandlerInput) {
  const feature = String(input.body.feature || '')
  if (!HUNTER_FEATURES.has(feature)) return failure('INVALID_FEATURE', 'Hunter feature is not enabled.', 400, input.corsHeaders)
  if (!['ADMIN', 'SELLER'].includes(String(input.role).toUpperCase())) return failure('ROLE_NOT_ALLOWED', 'This action is limited to ADMIN and SELLER accounts.', 403, input.corsHeaders)
  const admin = serverClient(input.supabaseUrl)
  if (!admin) return failure('SERVER_DATABASE_NOT_CONFIGURED', 'Hunter server-side storage is not configured.', 503, input.corsHeaders)

  let session: Record<string, unknown>
  try { session = await getOrCreateSession(input.supabase, input.user, input.body.session_id) } catch { return failure('HUNTER_SESSION_UNAVAILABLE', 'The Hunter session could not be loaded. Refresh Seller Panel and retry.', 403, input.corsHeaders) }
  const message = redactChatText(input.body.message)
  const isItemCheck = feature === 'HUNTER_ITEM_CHECK'
  const safeUserMessage = isItemCheck ? `Photo check: ${String(input.body.target?.item_name || 'item').slice(0, 100)} · asking price ${idrValue(input.body.asking_price_idr) || 'not set'} IDR.` : message
  try { await saveMessage(input.supabase, input.user, String(session.id), 'user', safeUserMessage, isItemCheck ? 'item_check' : 'chat', {}) } catch { return failure('HUNTER_MESSAGE_SAVE_FAILED', 'Message could not be saved to this session.', 500, input.corsHeaders) }

  const destination = safeDestination(input.body.destination || searchDestination(message) || session.destination)
  if (destination && destination !== String(session.destination || '')) await updateSession(input.supabase, String(session.id), { destination })
  if (feature === 'HUNTER_DESTINATION_BRIEF' || feature === 'HUNTER_REFRESH') return handleResearch(input, input.supabase, admin, session, feature, message)
  if (feature === 'HUNTER_ITEM_CHECK') return handleItemCheck(input, input.supabase, admin, session, message)
  return handleChat(input, input.supabase, admin, session, message)
}

