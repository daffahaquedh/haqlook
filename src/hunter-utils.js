export const HUNTER_DESTINATIONS = [
  { value: 'Pajak Melati', label: 'Pajak Melati', type: 'Indonesia thrift market' },
  { value: 'Pajak Sambu', label: 'Pajak Sambu', type: 'Indonesia thrift market' },
  { value: 'Carousell', label: 'Carousell', type: 'peer-to-peer marketplace' },
  { value: 'Preloved', label: 'Preloved', type: 'peer-to-peer marketplace' },
  { value: 'Marketplace Online', label: 'Marketplace online', type: 'online marketplace' },
]

const STOP_LOCATION_WORDS = new Set(['hari', 'besok', 'sekarang', 'aku', 'saya', 'mau', 'cari', 'hunting', 'tolong', 'dan', 'apa', 'ada', 'modal', 'fokus', 'luar', 'negeri', 'overseas', 'international', 'internasional', 'dijual', 'jual', 'gampang', 'paling', 'jaket', 'kaos', 'sepatu', 'barang', 'rumah', 'alamat', 'jalan', 'jl', 'jln', 'rt', 'rw'])

export function normalizeHunterText(value = '') {
  return String(value).normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

export function detectHunterDestination(message = '') {
  const normalized = normalizeHunterText(message)
  const known = HUNTER_DESTINATIONS.find((entry) => normalized.includes(normalizeHunterText(entry.value)))
  if (known) return known.value

  const match = String(message).match(/\b(?:ke|di|from|at)\s+([\p{L}\p{N}][\p{L}\p{N}'’-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}'’-]*){0,3})/iu)
  if (!match) return ''
  const words = match[1].split(/\s+/).filter(Boolean)
  const location = []
  for (const word of words) {
    if (STOP_LOCATION_WORDS.has(normalizeHunterText(word))) break
    location.push(word)
    if (location.length === 3) break
  }
  const result = location.join(' ').trim()
  if (/https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Z]{2,}/i.test(result) || result.replace(/\D/g, '').length >= 9) return ''
  return result.length >= 3 ? result : ''
}

export function parseHunterBudget(message = '') {
  const text = String(message).normalize('NFKC').toLocaleLowerCase('id-ID')
  const match = text.match(/(?:modal|budget|maksimal|max|under|di bawah|<)?\s*(?:rp\s*)?(\d{1,3}(?:[.,\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(juta|jt|million|m|ribu|rb|k)?\b/i)
  if (!match) return null
  const rawAmount = match[1].replace(/\s/g, '')
  const unit = String(match[2] || '').toLowerCase()
  const grouped = /[.,]\d{3}(?:[.,]\d{3})*$/.test(rawAmount)
  const amount = grouped && !unit ? Number(rawAmount.replace(/[.,]/g, '')) : Number(rawAmount.replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null
  const multiplier = ['juta', 'jt', 'million', 'm'].includes(unit) ? 1_000_000 : ['ribu', 'rb', 'k'].includes(unit) ? 1_000 : 1
  const budget = Math.round(amount * multiplier)
  return budget <= 100_000_000 ? budget : null
}

export function detectHunterCategories(message = '') {
  const value = normalizeHunterText(message)
  const aliases = [
    ['T-shirts', ['kaos', 'tee', 'tees', 't shirt', 'graphic shirt']],
    ['Jackets', ['jaket', 'jacket', 'outerwear', 'windbreaker']],
    ['Shoes', ['sepatu', 'shoes', 'sneaker', 'sneakers']],
    ['Bags', ['tas', 'bag', 'bags']],
    ['Denim', ['denim', 'jeans']],
    ['Knitwear', ['knitwear', 'sweater', 'rajut']],
    ['Accessories', ['aksesoris', 'accessory', 'accessories']],
  ]
  return aliases.filter(([, terms]) => terms.some((term) => value.includes(term))).map(([category]) => category)
}

export function buildHunterCacheKey(destination, category = 'all', date = new Date()) {
  const destinationKey = normalizeHunterText(destination).replace(/ /g, '-')
  const categoryKey = normalizeHunterText(category || 'all').replace(/ /g, '-')
  void date
  return `${destinationKey}|${categoryKey}`
}

export function extractHunterCitations(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : []
  const citations = new Map()
  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      for (const annotation of Array.isArray(part?.annotations) ? part.annotations : []) {
        if (annotation?.type !== 'url_citation' || typeof annotation.url !== 'string') continue
        try {
          const url = new URL(annotation.url)
          if (!['https:', 'http:'].includes(url.protocol)) continue
          citations.set(url.href, { url: url.href, title: String(annotation.title || url.hostname).slice(0, 240) })
        } catch { /* Ignore malformed provider annotations. */ }
      }
    }
  }
  return [...citations.values()].slice(0, 30)
}

function sanitizeTarget(target, allowedSources) {
  const sourceUrls = [...new Set((Array.isArray(target?.source_urls) ? target.source_urls : []).filter((url) => allowedSources.has(url)))].slice(0, 5)
  const hasMarketEvidence = sourceUrls.length > 0
  const currency = ['IDR', 'USD', 'EUR', 'JPY', 'GBP', 'OTHER', 'UNKNOWN'].includes(String(target?.resale_currency)) ? String(target.resale_currency) : 'UNKNOWN'
  const candidateLow = hasMarketEvidence ? positiveInteger(target?.resale_low) : null
  const candidateHigh = hasMarketEvidence ? positiveInteger(target?.resale_high) : null
  const supportedRange = Boolean(candidateLow && candidateHigh && candidateLow <= candidateHigh && currency !== 'UNKNOWN')
  const resaleLow = supportedRange ? candidateLow : null
  const resaleHigh = supportedRange ? candidateHigh : null
  const idealLow = positiveInteger(target?.ideal_buy_low_idr)
  const idealHigh = positiveInteger(target?.ideal_buy_high_idr)
  const maxCandidate = supportedRange && currency === 'IDR' ? positiveInteger(target?.max_buy_price_idr) : null
  const maxBuy = maxCandidate && resaleLow && maxCandidate <= resaleLow && String(target?.max_buy_rationale || '').trim() ? maxCandidate : null
  return {
    ...target,
    source_urls: sourceUrls,
    resale_low: resaleLow,
    resale_high: resaleHigh,
    resale_currency: supportedRange ? currency : 'UNKNOWN',
    resale_range_label: hasMarketEvidence && resaleLow && resaleHigh ? String(target?.resale_range_label || 'Public market references; varies by condition and platform').slice(0, 240) : '',
    ideal_buy_low_idr: idealLow,
    ideal_buy_high_idr: idealHigh,
    max_buy_price_idr: maxBuy,
    max_buy_rationale: maxBuy ? String(target?.max_buy_rationale || '').slice(0, 300) : '',
    availability_classification: 'SOURCING_HYPOTHESIS',
  }
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

export function sanitizeHunterBrief(brief, citations = []) {
  const allowedSources = new Set(citations.map((citation) => citation.url))
  const sectionNames = ['priority', 'buy_if_cheap', 'wildcard', 'caution', 'avoid']
  const sections = {}
  let remaining = 15
  for (const section of sectionNames) {
    const source = Array.isArray(brief?.sections?.[section]) ? brief.sections[section] : []
    const count = Math.min(source.length, section === 'wildcard' ? 4 : 5, remaining)
    sections[section] = source.slice(0, count).map((target) => sanitizeTarget(target, allowedSources))
    remaining -= count
  }
  const discoveries = (Array.isArray(brief?.new_discoveries) ? brief.new_discoveries : [])
    .slice(0, 3)
    .map((item) => ({
      ...item,
      source_urls: [...new Set((Array.isArray(item?.source_urls) ? item.source_urls : []).filter((url) => allowedSources.has(url)))].slice(0, 3),
    }))
    .filter((item) => item.source_urls.length)
  return {
    destination_name: String(brief?.destination_name || '').slice(0, 100),
    destination_type: String(brief?.destination_type || '').slice(0, 100),
    category_focus: String(brief?.category_focus || 'all').slice(0, 100),
    sections,
    new_discoveries: discoveries,
    internal_insights: (Array.isArray(brief?.internal_insights) ? brief.internal_insights : []).slice(0, 3).map((value) => String(value).slice(0, 500)),
    uncertainty_notice: 'Ketersediaan barang hari ini tidak dapat dipastikan. Ini adalah target pencarian, bukan konfirmasi stok fisik.',
  }
}

export function allHunterTargets(brief) {
  const sections = brief?.sections || {}
  return ['priority', 'buy_if_cheap', 'wildcard', 'caution', 'avoid'].flatMap((section) => (sections[section] || []).map((target) => ({ ...target, _section: section })))
}

export function filterHunterTargets(brief, { categories = [], budgetIdr = null, internationalOnly = false } = {}) {
  const categorySet = new Set(categories.map(normalizeHunterText))
  return allHunterTargets(brief).filter((target) => {
    if (categorySet.size && ![...categorySet].some((category) => normalizeHunterText(target.category || '').includes(category) || category.includes(normalizeHunterText(target.category || '')))) return false
    if (budgetIdr != null && target.ideal_buy_high_idr != null && target.ideal_buy_high_idr > budgetIdr) return false
    if (internationalOnly && !['high', 'good'].includes(String(target.international_fit || '').toLowerCase())) return false
    return true
  })
}

export function summarizeHaqlooksData(products = [], sales = []) {
  const counts = (rows, field) => {
    const groups = new Map()
    for (const row of rows) {
      const key = String(row?.[field] || '').trim()
      if (key) groups.set(key, (groups.get(key) || 0) + 1)
    }
    return [...groups.entries()].filter(([, count]) => count >= 3).map(([label, count]) => ({ label, count }))
  }
  const productById = new Map(products.map((product) => [product.id, product]))
  const soldGroups = new Map()
  for (const sale of sales) {
    const product = productById.get(sale.product_id)
    const category = String(product?.category || '').trim()
    if (!category) continue
    const list = soldGroups.get(category) || []
    list.push(sale)
    soldGroups.set(category, list)
  }
  const soldByCategory = [...soldGroups.entries()].filter(([, items]) => items.length >= 3).map(([category, items]) => ({
    category,
    sold_count: items.length,
    average_sale_price_idr: Math.round(items.reduce((sum, item) => sum + Number(item.sale_price || 0), 0) / items.length),
    average_net_profit_idr: Math.round(items.reduce((sum, item) => sum + Number(item.net_profit || 0), 0) / items.length),
  }))
  return {
    inventory_total: products.length,
    inventory_by_category: counts(products, 'category'),
    inventory_by_brand: counts(products, 'brand'),
    sold_by_category: soldByCategory,
    sufficient_sales_sample: soldByCategory.some((item) => item.sold_count >= 3),
  }
}

