import { DEFAULT_MODEL } from './pricing.ts'

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

export function createHunterChatRequest({ message, brief, conversation = [] }) {
  return {
    model: DEFAULT_MODEL,
    reasoning: { effort: 'low' },
    max_output_tokens: 900,
    input: [
      { role: 'system', content: `${HUNTER_SYSTEM_PROMPT}\nYou are in chat mode: do not use web search or pretend you searched. The supplied brief is the only market research context. If it lacks evidence, say so. Never re-quote a price range without its cited context. If the seller changes budget/focus, filter/rank only existing targets. Do not claim physical stock.` },
      { role: 'user', content: `CURRENT DESTINATION BRIEF (may be null): ${JSON.stringify(brief || null)}\nRECENT SESSION CONTEXT: ${JSON.stringify(conversation.slice(-12))}\nSELLER MESSAGE: ${String(message).slice(0, 1000)}` },
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


