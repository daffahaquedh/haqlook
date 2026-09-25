import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openAiKey) return response({ error: 'AI_NOT_CONFIGURED', message: 'AI belum dikonfigurasi.' }, 503)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = request.headers.get('Authorization')
  if (!supabaseUrl || !supabaseAnonKey || !authorization) return response({ error: 'AUTHENTICATION_REQUIRED' }, 401)

  const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return response({ error: 'AUTHENTICATION_REQUIRED' }, 401)

  const body = await request.json().catch(() => ({}))
  const allowedFeatures = ['ITEM_ANALYSIS', 'LISTING_GENERATOR', 'SOURCING', 'PRICE_CHECK', 'WEB_SEARCH', 'SELLER_ASSISTANT']
  const feature = allowedFeatures.includes(body.feature) ? body.feature : null
  if (!feature) return response({ error: 'INVALID_FEATURE' }, 400)

  // Only operational item fields are accepted. Buyer PII and credentials never enter the prompt.
  const item = body.item && typeof body.item === 'object' ? body.item : {}
  const safeItem = {
    brand: String(item.brand || '').slice(0, 120),
    product: String(item.product || item.name || '').slice(0, 180),
    condition: String(item.condition || '').slice(0, 80),
    size: String(item.size || '').slice(0, 50),
    measurement: String(item.measurement || '').slice(0, 120),
    purchase_price: Number(item.purchase_price || 0),
    selling_price: Number(item.selling_price || 0),
    marketplace: String(item.marketplace || '').slice(0, 40),
  }

  const model = String(Deno.env.get('OPENAI_SELLER_MODEL') || 'gpt-4o-mini')
  const estimatedCost = Number(Deno.env.get('AI_RESERVATION_COST_IDR') || 1000)
  const { data: usageId, error: reserveError } = await supabase.rpc('reserve_ai_usage', {
    p_feature: feature,
    p_model: model,
    p_estimated_cost: estimatedCost,
  })
  if (reserveError) {
    const budgetExceeded = reserveError.message?.includes('AI_BUDGET_EXCEEDED')
    return response({ error: budgetExceeded ? 'AI_BUDGET_EXCEEDED' : 'AI_USAGE_RESERVATION_FAILED' }, budgetExceeded ? 429 : 403)
  }

  const prompt = `You are a seller operations assistant for a pre-owned fashion business. Return concise JSON with useful, reviewable recommendations. Do not invent authenticity certainty or market facts. Feature: ${feature}. Item: ${JSON.stringify(safeItem)}`
  const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'You support a human seller. The seller makes the final decision.' }, { role: 'user', content: prompt }] }),
  })
  if (!openAiResponse.ok) {
    await supabase.rpc('release_ai_usage', { p_usage_id: usageId })
    return response({ error: 'AI_PROVIDER_ERROR' }, 502)
  }
  const result = await openAiResponse.json()
  const usage = result.usage || {}
  const actualCost = Number(Deno.env.get('AI_ESTIMATED_COST_IDR') || estimatedCost)
  await supabase.rpc('finalize_ai_usage', { p_usage_id: usageId, p_input_tokens: usage.prompt_tokens || 0, p_output_tokens: usage.completion_tokens || 0, p_estimated_cost: actualCost })
  const content = result.choices?.[0]?.message?.content || '{}'
  try {
    return response({ feature, model, result: JSON.parse(content) })
  } catch {
    return response({ feature, model, result: { text: content } })
  }
})
