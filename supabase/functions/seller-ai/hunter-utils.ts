export function responsesOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === 'string') return payload.output_text
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (!item || typeof item !== 'object') continue
    for (const part of Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []) {
      if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') return (part as Record<string, unknown>).text as string
    }
  }
  return ''
}

function hunterError(code: string) {
  return Object.assign(new Error(code), { code })
}

function isContentFiltered(payload: Record<string, unknown>) {
  const error = payload.error && typeof payload.error === 'object' ? payload.error as Record<string, unknown> : {}
  const incomplete = payload.incomplete_details && typeof payload.incomplete_details === 'object' ? payload.incomplete_details as Record<string, unknown> : {}
  const code = String(error.code || '')
  return String(incomplete.reason || '') === 'content_filter' || /content.?filter|safety/i.test(code)
}

function containsRefusal(payload: Record<string, unknown>) {
  return (Array.isArray(payload.output) ? payload.output : []).some((item) => {
    if (!item || typeof item !== 'object') return false
    const row = item as Record<string, unknown>
    if (row.type === 'refusal') return true
    return (Array.isArray(row.content) ? row.content : []).some((part) => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'refusal')
  })
}

/** Only parse Structured Output after Responses confirms a completed final message. */
export function parseCompletedHunterJson(payload: Record<string, unknown>) {
  if (isContentFiltered(payload)) throw hunterError('AI_CONTENT_FILTERED')
  if (containsRefusal(payload)) throw hunterError('AI_REFUSED')

  const status = String(payload.status || '')
  const incomplete = payload.incomplete_details && typeof payload.incomplete_details === 'object' ? payload.incomplete_details as Record<string, unknown> : {}
  const reason = String(incomplete.reason || '')
  if (status === 'incomplete' && reason === 'max_output_tokens') throw hunterError('AI_OUTPUT_LIMIT')
  if (status === 'incomplete') throw hunterError('AI_RESPONSE_INCOMPLETE')
  if (status !== 'completed') throw hunterError('AI_RESPONSE_NOT_COMPLETED')

  let text = typeof payload.output_text === 'string' ? payload.output_text : ''
  if (!text) {
    for (const item of Array.isArray(payload.output) ? payload.output : []) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      if (row.type !== 'message' || (row.role && row.role !== 'assistant') || (row.status && row.status !== 'completed')) continue
      const finalPart = (Array.isArray(row.content) ? row.content : []).find((part) => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'output_text') as Record<string, unknown> | undefined
      if (typeof finalPart?.text === 'string') { text = finalPart.text; break }
    }
  }
  if (!text) throw hunterError('AI_EMPTY_RESPONSE')
  try { return JSON.parse(text) } catch { throw hunterError('AI_INVALID_RESPONSE') }
}

/** Safe metrics only: no prompt, response text, destination, or account identifiers. */
export function hunterResponseMetrics(payload: Record<string, unknown>) {
  const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : {}
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === 'object' ? usage.input_tokens_details as Record<string, unknown> : {}
  const outputDetails = usage.output_tokens_details && typeof usage.output_tokens_details === 'object' ? usage.output_tokens_details as Record<string, unknown> : {}
  const finite = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
  const incomplete = payload.incomplete_details && typeof payload.incomplete_details === 'object' ? payload.incomplete_details as Record<string, unknown> : {}
  return {
    response_status: String(payload.status || 'unknown'),
    incomplete_reason: String(incomplete.reason || ''),
    input_tokens: finite(usage.input_tokens),
    cached_input_tokens: finite(inputDetails.cached_tokens),
    output_tokens: finite(usage.output_tokens),
    reasoning_tokens: finite(outputDetails.reasoning_tokens),
    web_search_calls: countWebSearchCalls(payload),
  }
}

export function extractHunterCitations(payload: Record<string, unknown>) {
  const citations = new Map<string, { url: string; title: string }>()
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (!item || typeof item !== 'object') continue
    const outputItem = item as Record<string, unknown>
    if (outputItem.type !== 'message') continue
    for (const part of Array.isArray(outputItem.content) ? outputItem.content : []) {
      if (!part || typeof part !== 'object') continue
      const contentPart = part as Record<string, unknown>
      for (const annotation of Array.isArray(contentPart.annotations) ? contentPart.annotations : []) {
        if (!annotation || typeof annotation !== 'object') continue
        const citation = annotation as Record<string, unknown>
        if (citation.type !== 'url_citation' || typeof citation.url !== 'string') continue
        try {
          const url = new URL(citation.url)
          if (!['https:', 'http:'].includes(url.protocol)) continue
          citations.set(url.href, { url: url.href, title: String(citation.title || url.hostname).slice(0, 240) })
        } catch { /* Ignore malformed provider annotations. */ }
      }
    }
  }
  return [...citations.values()].slice(0, 30)
}

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function sanitizeTarget(target: Record<string, unknown>, allowedSources: Set<string>) {
  const sourceUrls = [...new Set((Array.isArray(target.source_urls) ? target.source_urls : []).filter((url): url is string => typeof url === 'string' && allowedSources.has(url)))].slice(0, 5)
  const currency = ['IDR', 'USD', 'EUR', 'JPY', 'GBP', 'OTHER', 'UNKNOWN'].includes(String(target.resale_currency)) ? String(target.resale_currency) : 'UNKNOWN'
  const candidateLow = sourceUrls.length ? positiveInteger(target.resale_low) : null
  const candidateHigh = sourceUrls.length ? positiveInteger(target.resale_high) : null
  const hasSupportedRange = Boolean(candidateLow && candidateHigh && candidateLow <= candidateHigh && currency !== 'UNKNOWN')
  const resaleLow = hasSupportedRange ? candidateLow : null
  const resaleHigh = hasSupportedRange ? candidateHigh : null
  const idealLow = positiveInteger(target.ideal_buy_low_idr)
  const idealHigh = positiveInteger(target.ideal_buy_high_idr)
  const maxCandidate = hasSupportedRange && currency === 'IDR' ? positiveInteger(target.max_buy_price_idr) : null
  const maxRationale = String(target.max_buy_rationale || '').slice(0, 300)
  const maxBuy = maxCandidate && resaleLow && maxCandidate <= resaleLow && maxRationale ? maxCandidate : null
  const bounded = (value: unknown, max = 500) => (Array.isArray(value) ? value : []).slice(0, 12).map((item) => String(item).slice(0, max))
  return {
    target_id: String(target.target_id || crypto.randomUUID()).slice(0, 100),
    item_name: String(target.item_name || 'Fashion item').slice(0, 160),
    category: String(target.category || 'Fashion').slice(0, 80),
    why_search: String(target.why_search || '').slice(0, 700),
    quick_identification: String(target.quick_identification || '').slice(0, 700),
    tags_and_details: bounded(target.tags_and_details, 150),
    preferred_size: bounded(target.preferred_size, 80),
    preferred_variants: bounded(target.preferred_variants, 120),
    ideal_buy_low_idr: idealLow,
    ideal_buy_high_idr: idealHigh,
    max_buy_price_idr: maxBuy,
    max_buy_rationale: maxBuy ? String(target.max_buy_rationale || '').slice(0, 300) : '',
    resale_low: hasSupportedRange ? resaleLow : null,
    resale_high: hasSupportedRange ? resaleHigh : null,
    resale_currency: hasSupportedRange ? currency : 'UNKNOWN',
    market_evidence_summary: sourceUrls.length ? String(target.market_evidence_summary || '').slice(0, 500) : '',
    source_urls: sourceUrls,
    marketplace_fit: Object.fromEntries(['haqlooks', 'preloved', 'grailed', 'vestiaire', 'carousell', 'instagram'].map((name) => {
      const fit = target.marketplace_fit && typeof target.marketplace_fit === 'object' ? (target.marketplace_fit as Record<string, unknown>)[name] as Record<string, unknown> : {}
      return [name, {
        fit: ['strong', 'good', 'limited', 'avoid', 'unknown'].includes(String(fit?.fit)) ? fit.fit : 'unknown',
        reason: String(fit?.reason || '').slice(0, 200),
      }]
    })),
    international_fit: ['high', 'good', 'limited', 'unknown'].includes(String(target.international_fit)) ? target.international_fit : 'unknown',
    authenticity_risk: String(target.authenticity_risk || 'Authenticity not verified; manual review required.').slice(0, 400),
    inspection_checklist: bounded(target.inspection_checklist, 240),
    availability_classification: 'SOURCING_HYPOTHESIS',
  }
}

export function sanitizeHunterBrief(brief: Record<string, unknown>, citations: Array<{ url: string; title: string }>) {
  const allowedSources = new Set(citations.map((citation) => citation.url))
  const rawSections = brief.sections && typeof brief.sections === 'object' ? brief.sections as Record<string, unknown> : {}
  const sections: Record<string, Array<Record<string, unknown>>> = {}
  let remaining = 15
  for (const section of ['priority', 'buy_if_cheap', 'wildcard', 'caution', 'avoid']) {
    const rows = Array.isArray(rawSections[section]) ? rawSections[section] as Record<string, unknown>[] : []
    const cap = section === 'wildcard' ? 4 : 5
    const take = Math.min(rows.length, cap, remaining)
    sections[section] = rows.slice(0, take).map((row) => sanitizeTarget(row, allowedSources))
    remaining -= take
  }
  const discoveries = (Array.isArray(brief.new_discoveries) ? brief.new_discoveries as Record<string, unknown>[] : []).slice(0, 3).map((row) => ({
    name: String(row.name || '').slice(0, 120),
    what_it_is: String(row.what_it_is || '').slice(0, 500),
    quick_identification: String(row.quick_identification || '').slice(0, 500),
    tags_to_check: (Array.isArray(row.tags_to_check) ? row.tags_to_check : []).slice(0, 8).map((value) => String(value).slice(0, 120)),
    fake_risk: String(row.fake_risk || 'Authenticity not verified; manual verification required.').slice(0, 300),
    demand_signal: String(row.demand_signal || '').slice(0, 300),
    why_learn: String(row.why_learn || '').slice(0, 400),
    source_urls: [...new Set((Array.isArray(row.source_urls) ? row.source_urls : []).filter((url): url is string => typeof url === 'string' && allowedSources.has(url)))].slice(0, 3),
  })).filter((row) => row.name && row.source_urls.length)
  return {
    destination_name: String(brief.destination_name || '').slice(0, 100),
    destination_type: String(brief.destination_type || '').slice(0, 100),
    category_focus: String(brief.category_focus || 'all').slice(0, 100),
    sections,
    new_discoveries: discoveries,
    internal_insights: (Array.isArray(brief.internal_insights) ? brief.internal_insights : []).slice(0, 3).map((value) => String(value).slice(0, 400)),
    uncertainty_notice: 'Ketersediaan barang hari ini tidak dapat dipastikan. Ini adalah target pencarian, bukan konfirmasi stok fisik.',
  }
}

export function summarizeHaqlooksData(products: Array<Record<string, unknown>> = [], sales: Array<Record<string, unknown>> = []) {
  const groupCounts = (rows: Array<Record<string, unknown>>, key: string) => {
    const groups = new Map<string, number>()
    for (const row of rows) {
      const value = String(row[key] || '').trim()
      if (value) groups.set(value, (groups.get(value) || 0) + 1)
    }
    return [...groups.entries()].filter(([, count]) => count >= 3).map(([label, count]) => ({ label, count }))
  }
  const productById = new Map(products.map((product) => [String(product.id), product]))
  const sold = new Map<string, Array<Record<string, unknown>>>()
  for (const sale of sales) {
    const product = productById.get(String(sale.product_id))
    const category = String(product?.category || '').trim()
    if (category) sold.set(category, [...(sold.get(category) || []), sale])
  }
  const soldByCategory = [...sold.entries()].filter(([, rows]) => rows.length >= 3).map(([category, rows]) => ({
    category,
    sold_count: rows.length,
    average_sale_price_idr: Math.round(rows.reduce((sum, row) => sum + Number(row.sale_price || 0), 0) / rows.length),
    average_net_profit_idr: Math.round(rows.reduce((sum, row) => sum + Number(row.net_profit || 0), 0) / rows.length),
  }))
  const modalGroups = new Map<string, number[]>()
  for (const product of products) {
    const category = String(product.category || '').trim()
    const amount = Number(product.purchase_price)
    if (!category || !Number.isFinite(amount) || amount < 0) continue
    modalGroups.set(category, [...(modalGroups.get(category) || []), amount])
  }
  const averagePurchaseByCategory = [...modalGroups.entries()].filter(([, amounts]) => amounts.length >= 3).map(([category, amounts]) => ({
    category,
    sample_count: amounts.length,
    average_purchase_price_idr: Math.round(amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length),
  }))
  const sellThrough = products.filter((product) => product.status === 'sold' && product.created_at && product.sold_at).map((product) => (Date.parse(String(product.sold_at)) - Date.parse(String(product.created_at))) / 86_400_000).filter((days) => Number.isFinite(days) && days >= 0)
  return {
    inventory_total: products.length,
    inventory_by_category: groupCounts(products, 'category'),
    inventory_by_brand: groupCounts(products, 'brand'),
    sold_by_category: soldByCategory,
    average_purchase_by_category: averagePurchaseByCategory,
    average_days_to_sell: sellThrough.length >= 3 ? Math.round(sellThrough.reduce((sum, days) => sum + days, 0) / sellThrough.length) : null,
  }
}

export function countWebSearchCalls(payload: Record<string, unknown>) {
  return (Array.isArray(payload.output) ? payload.output : []).filter((item) => {
    if (!item || typeof item !== 'object') return false
    const row = item as Record<string, unknown>
    return row.type === 'web_search_call' && !!row.action && typeof row.action === 'object' && (row.action as Record<string, unknown>).type === 'search'
  }).length
}

export function findHunterTarget(brief: Record<string, unknown>, targetId: string) {
  const sections = brief.sections && typeof brief.sections === 'object' ? brief.sections as Record<string, unknown> : {}
  for (const values of Object.values(sections)) {
    if (!Array.isArray(values)) continue
    const target = values.find((value) => value && typeof value === 'object' && (value as Record<string, unknown>).target_id === targetId)
    if (target) return target as Record<string, unknown>
  }
  return null
}


