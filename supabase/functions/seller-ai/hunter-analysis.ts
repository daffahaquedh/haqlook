import { DEFAULT_MODEL } from './pricing.ts'

const HUNTER_CHAT_SYSTEM_PROMPT = `You are Haqlooks' concise sourcing copilot for a fashion reseller. Reply in Bahasa Indonesia using only the supplied brief context. Do not web-search, claim physical stock, invent sold prices, or claim authenticity. Only repeat prices and evidence included in context; otherwise state that evidence is insufficient. Give practical, concise reasoning and return the required JSON schema.`

const stringArray = { type: 'array', items: { type: 'string' } }
const nullableInteger = { type: ['integer', 'null'] }
const marketplaceFitProperties = Object.fromEntries(['haqlooks', 'preloved', 'grailed', 'vestiaire', 'carousell', 'instagram'].map((name) => [name, {
  type: 'object',
  properties: {
    fit: { type: 'string', enum: ['strong', 'good', 'limited', 'avoid', 'unknown'] },
    reason: { type: 'string' },
  },
  required: ['fit', 'reason'],
  additionalProperties: false,
}]))

const targetProperties = {
  target_id: { type: 'string' },
  item_name: { type: 'string' },
  category: { type: 'string' },
  why_search: { type: 'string' },
  quick_identification: { type: 'string' },
  tags_and_details: stringArray,
  preferred_size: stringArray,
  preferred_variants: stringArray,
  ideal_buy_low_idr: nullableInteger,
  ideal_buy_high_idr: nullableInteger,
  max_buy_price_idr: nullableInteger,
  max_buy_rationale: { type: 'string' },
  resale_low: nullableInteger,
  resale_high: nullableInteger,
  resale_currency: { type: 'string', enum: ['IDR', 'USD', 'EUR', 'JPY', 'GBP', 'OTHER', 'UNKNOWN'] },
  market_evidence_summary: { type: 'string' },
  source_urls: stringArray,
  marketplace_fit: { type: 'object', properties: marketplaceFitProperties, required: Object.keys(marketplaceFitProperties), additionalProperties: false },
  international_fit: { type: 'string', enum: ['high', 'good', 'limited', 'unknown'] },
  authenticity_risk: { type: 'string' },
  inspection_checklist: stringArray,
}

const targetRequired = Object.keys(targetProperties)
const targetSchema = { type: 'object', properties: targetProperties, required: targetRequired, additionalProperties: false }

const discoveryProperties = {
  name: { type: 'string' },
  what_it_is: { type: 'string' },
  quick_identification: { type: 'string' },
  tags_to_check: stringArray,
  fake_risk: { type: 'string' },
  demand_signal: { type: 'string' },
  why_learn: { type: 'string' },
  source_urls: stringArray,
}

export const HUNTER_BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    destination_name: { type: 'string' },
    destination_type: { type: 'string' },
    category_focus: { type: 'string' },
    sections: {
      type: 'object',
      properties: {
        priority: { type: 'array', items: targetSchema },
        buy_if_cheap: { type: 'array', items: targetSchema },
        wildcard: { type: 'array', items: targetSchema },
        caution: { type: 'array', items: targetSchema },
        avoid: { type: 'array', items: targetSchema },
      },
      required: ['priority', 'buy_if_cheap', 'wildcard', 'caution', 'avoid'],
      additionalProperties: false,
    },
    new_discoveries: { type: 'array', items: { type: 'object', properties: discoveryProperties, required: Object.keys(discoveryProperties), additionalProperties: false } },
    internal_insights: stringArray,
  },
  required: ['destination_name', 'destination_type', 'category_focus', 'sections', 'new_discoveries', 'internal_insights'],
  additionalProperties: false,
}

export const HUNTER_CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    focused_target_ids: stringArray,
    category_focus: stringArray,
    budget_idr: nullableInteger,
  },
  required: ['reply', 'focused_target_ids', 'category_focus', 'budget_idr'],
  additionalProperties: false,
}

export const HUNTER_ITEM_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['BUY', 'NEGO', 'CHECK', 'SKIP'] },
    target_match: { type: 'string', enum: ['MATCH', 'POSSIBLE_MATCH', 'NO_MATCH', 'UNKNOWN'] },
    condition_summary: { type: 'string' },
    visible_defects: stringArray,
    authenticity_risk: { type: 'string' },
    authenticity_note: { type: 'string', enum: ['Authenticity not verified. Manual verification required.'] },
    market_fit: { type: 'string' },
    asking_price_idr: nullableInteger,
    referenced_resale_low: nullableInteger,
    referenced_resale_high: nullableInteger,
    referenced_resale_currency: { type: 'string' },
    possible_gross_margin_idr: nullableInteger,
    inspection_checklist: stringArray,
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['verdict', 'target_match', 'condition_summary', 'visible_defects', 'authenticity_risk', 'authenticity_note', 'market_fit', 'asking_price_idr', 'referenced_resale_low', 'referenced_resale_high', 'referenced_resale_currency', 'possible_gross_margin_idr', 'inspection_checklist', 'confidence'],
  additionalProperties: false,
}

export const HUNTER_OPENAI_TIMEOUT_MS = 110_000

export const HUNTER_SYSTEM_PROMPT = `You are Haqlooks Sourcing Copilot for second-hand fashion sellers in Indonesia. Give practical, honest, concise field guidance. Product and market research only; do not ask for or infer personal data, buyer details, passwords, payment data, or private marketplace data. Never claim or imply a thrift market physically has stock, a shipment has arrived, or an item is available today unless a cited public source directly verifies that specific fact. Treat every target as a SOURCING HYPOTHESIS: a worthwhile thing to look for if found, not a stock report. Distinguish source-backed market evidence from estimates. Never claim authenticity from a photo; state that manual authentication is required. Do not invent recent sold prices. Provide a resale range only when direct public market references support it and include the exact source URLs; otherwise use null values and UNKNOWN currency. A max buy price is optional and should be null unless a cited resale range and a clear margin rationale support it. For every target, assess Haqlooks, Preloved, Grailed, Vestiaire, Carousell, and Instagram individually with a concise fit and reason; use unknown where evidence is insufficient. Aim for approximately 8 useful, differentiated targets total across all sections; never exceed the existing product limit of 15. Keep each field concise. Section priority: strongest evidence/opportunity; buy_if_cheap: stable demand but only at low entry price; wildcard: lesser-known or adjacent categories the seller may not know; caution: authenticity/margin/condition risk; avoid: weak demand or poor margin with an evidence-backed reason. Provide at most 3 new brand/model discoveries, each supported by public citations. Research current 7-day signals for fast trends and 30–90-day public resale references where available. Do not present any listing price as a confirmed sold price. Write in Bahasa Indonesia, keeping item names, marketplace names, and citations unchanged.`

export function createHunterBriefRequest({ destination, destinationType, previousSession = [], internalSummary, now }) {
  const input = [
    ...previousSession.map(({ role, content }) => ({ role: role === 'assistant' ? 'assistant' : 'user', content: String(content).slice(0, 1200) })),
    {
      role: 'user',
      content: `Create a concise Destination Hunting Brief for ${String(destination).slice(0, 100)}. Market type: ${String(destinationType || 'unknown').slice(0, 100)}. Research timestamp: ${now}. Use public web research and cite references in source_urls. Aim for about 8 useful targets total, never more than 15; keep explanations short. Discovery items are limited to 3. Set market ranges null if references do not support them. Never imply physical stock at this destination is verified unless a cited public source directly proves it. Use only this aggregated Haqlooks evidence (empty means none): ${JSON.stringify(internalSummary || {})}. For internal_insights, return only patterns backed by at least three matching internal records; otherwise return an empty list. A budget/category focus is applied after research and is not part of the shared brief cache.`,
    },
  ]
  return {
    model: DEFAULT_MODEL,
    reasoning: { effort: 'medium' },
    tools: [{ type: 'web_search', search_context_size: 'medium' }],
    include: ['web_search_call.action.sources'],
    tool_choice: 'required',
    max_tool_calls: 10,
    max_output_tokens: 16000,
    input: [
      { role: 'system', content: HUNTER_SYSTEM_PROMPT },
      ...input,
    ],
    text: { format: { type: 'json_schema', name: 'hunter_destination_brief', strict: true, schema: HUNTER_BRIEF_SCHEMA } },
  }
}

function normalizedChatText(value: unknown) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function buildHunterChatContext({ brief, message, destination = '', budgetIdr = null, categories = [], marketGoal = 'both', activeBriefId = '', selectedTargetIds = [], activeSection = 'all', isHere = false }) {
  const sections = brief?.sections && typeof brief.sections === 'object' ? brief.sections as Record<string, unknown> : {}
  const targets = ['priority', 'buy_if_cheap', 'wildcard', 'caution', 'avoid'].flatMap((section) =>
    (Array.isArray(sections[section]) ? sections[section] as Record<string, unknown>[] : []).map((target) => ({ ...target, _section: section })))
  const query = normalizedChatText(message)
  const tokens = query.split(' ').filter((token) => token.length >= 4)
  const boundedSelectedIds = selectedTargetIds.slice(0, 3).map((value) => String(value).slice(0, 100))
  const selectedIds = new Set(boundedSelectedIds)
  const relevant = targets.map((target, index) => {
    const searchable = normalizedChatText(`${target.item_name || ''} ${target.category || ''} ${target.why_search || ''}`)
    const score = (selectedIds.has(String(target.target_id)) ? 100 : 0) + tokens.reduce((sum, token) => sum + (searchable.includes(token) ? 1 : 0), 0)
    return { target, index, score }
  }).filter((entry) => entry.score > 0)
  const chosen = (relevant.length ? relevant.sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.target) : targets.slice(0, 3)).slice(0, 3)
  const citations = Array.isArray(brief?.citations) ? brief.citations as Record<string, unknown>[] : []
  const selectedTargets = chosen.map((target) => {
    const sourceUrls = Array.isArray(target.source_urls) ? target.source_urls.map(String).slice(0, 3) : []
    const fit = target.marketplace_fit && typeof target.marketplace_fit === 'object'
      ? Object.fromEntries(Object.entries(target.marketplace_fit as Record<string, unknown>).map(([marketplace, rawFit]) => {
        const row = rawFit && typeof rawFit === 'object' ? rawFit as Record<string, unknown> : {}
        return [marketplace, { fit: String(row.fit || 'unknown'), reason: String(row.reason || '').slice(0, 140) }]
      }))
      : undefined
    return {
      target_id: String(target.target_id || '').slice(0, 100),
      section: String(target._section || ''),
      item_name: String(target.item_name || '').slice(0, 160),
      category: String(target.category || '').slice(0, 80),
      why_search: String(target.why_search || '').slice(0, 280),
      ideal_buy_low_idr: target.ideal_buy_low_idr ?? null,
      ideal_buy_high_idr: target.ideal_buy_high_idr ?? null,
      resale_low: target.resale_low ?? null,
      resale_high: target.resale_high ?? null,
      resale_currency: String(target.resale_currency || 'UNKNOWN'),
      market_evidence_summary: String(target.market_evidence_summary || '').slice(0, 300),
      marketplace_fit: fit,
      international_fit: String(target.international_fit || 'unknown'),
      authenticity_risk: String(target.authenticity_risk || '').slice(0, 240),
      sources: citations.filter((citation) => sourceUrls.includes(String(citation.url))).slice(0, 3).map((citation) => ({ title: String(citation.title || '').slice(0, 180), url: String(citation.url || '').slice(0, 500) })),
    }
  })
  return {
    destination: String(destination || brief?.destination_name || '').slice(0, 100),
    session_state: { active_brief_id: String(activeBriefId || '').slice(0, 80), selected_target_ids: boundedSelectedIds, active_section: activeSection, is_here: Boolean(isHere) },
    seller_constraints: { budget_idr: budgetIdr, categories: categories.slice(0, 7), market_goal: marketGoal },
    relevant_targets: selectedTargets,
  }
}

export function isHunterReasoningQuestion(message: unknown) {
  return /\b(kenapa|mengapa|bandingkan|compare|worth(?: it)?|risiko|kondisi|lebih bagus|lebih cocok|pemula|alasan|masih layak)\b/i.test(String(message || ''))
}

export function createHunterChatRequest({ message, context }) {
  return {
    model: DEFAULT_MODEL,
    reasoning: { effort: 'low' },
    max_output_tokens: 900,
    input: [
      { role: 'system', content: HUNTER_CHAT_SYSTEM_PROMPT },
      { role: 'user', content: `COMPACT RESEARCH CONTEXT: ${JSON.stringify(context || { relevant_targets: [] })}\nSELLER MESSAGE: ${String(message).slice(0, 1000)}` },
    ],
    text: { format: { type: 'json_schema', name: 'hunter_chat_reply', strict: true, schema: HUNTER_CHAT_SCHEMA } },
  }
}

export function createHunterItemCheckRequest({ imageDataUrls, askingPriceIdr, target }) {
  const content = [
    { type: 'input_text', text: `Assess this used fashion item as a secondary photo-check during sourcing. Asking price in IDR: ${Number(askingPriceIdr) || 0}. Hunting target context (untrusted seller-provided target): ${JSON.stringify(target || null)}. Use only visible evidence. Never authenticate from photos; include the exact required authenticity caution. If margins cannot be calculated from a cited research range in the supplied target, return null. The advice is a screening suggestion, not a guarantee. Return BUY, NEGO, CHECK, or SKIP.` },
    ...imageDataUrls.map((image_url) => ({ type: 'input_image', image_url, detail: 'low' })),
  ]
  return {
    model: DEFAULT_MODEL,
    reasoning: { effort: 'low' },
    max_output_tokens: 1000,
    input: [{ role: 'system', content: HUNTER_SYSTEM_PROMPT }, { role: 'user', content }],
    text: { format: { type: 'json_schema', name: 'hunter_item_check', strict: true, schema: HUNTER_ITEM_CHECK_SCHEMA } },
  }
}


