export const MARKETPLACES = [
  { key: 'HAQLOOKS', label: 'Haqlooks' },
  { key: 'PRELOVED', label: 'Preloved' },
  { key: 'GRAILED', label: 'Grailed' },
  { key: 'VESTIAIRE', label: 'Vestiaire' },
  { key: 'CAROUSELL', label: 'Carousell' },
  { key: 'INSTAGRAM', label: 'Instagram' },
]

export const INVENTORY_STATUSES = ['draft', 'available', 'reserved', 'sold', 'archived']
export const LISTING_STATUSES = ['NOT_LISTED', 'DRAFT', 'LISTED', 'SOLD', 'REMOVED']

export const ITEM_ANALYSIS_SUGGESTIONS = [
  { key: 'detected_brand', label: 'Brand', target: 'brand' },
  { key: 'suggested_title', label: 'Title', target: 'name' },
  { key: 'suggested_category', label: 'Category', target: 'category' },
  { key: 'condition_summary', label: 'Condition summary', target: 'condition_notes' },
  { key: 'visible_defects', label: 'Visible defects', target: 'defects' },
  { key: 'seller_notes', label: 'Seller notes', target: 'description' },
]

export function analysisSuggestionValue(result, key) {
  const value = result?.[key]
  if (Array.isArray(value)) return value.filter(Boolean).join('; ')
  return String(value || '').trim()
}

export function applyItemAnalysisSuggestions(item, result, selectedKeys) {
  const next = { ...item }
  ITEM_ANALYSIS_SUGGESTIONS.forEach(({ key, target }) => {
    if (!selectedKeys?.[key]) return
    const value = analysisSuggestionValue(result, key)
    if (value) next[target] = value
  })
  return next
}

export function moneyIdr(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

export function calculateProfit({ salePrice = 0, purchasePrice = 0, marketplaceFee = 0, paymentFee = 0, shippingSubsidy = 0, otherCost = 0 }) {
  const sale = Number(salePrice) || 0
  const purchase = Number(purchasePrice) || 0
  const gross = sale - purchase
  const net = gross - (Number(marketplaceFee) || 0) - (Number(paymentFee) || 0) - (Number(shippingSubsidy) || 0) - (Number(otherCost) || 0)
  return { grossProfit: gross, netProfit: net }
}

export function budgetTone(used = 0, budget = 0) {
  const percentage = budget > 0 ? (Number(used) / Number(budget)) * 100 : 0
  if (percentage >= 90) return 'red'
  if (percentage >= 75) return 'orange'
  if (percentage >= 50) return 'yellow'
  return 'green'
}

export function budgetLabel(used = 0, budget = 0) {
  const percentage = budget > 0 ? (Number(used) / Number(budget)) * 100 : 0
  if (percentage >= 100) return 'AI calls blocked'
  if (percentage >= 90) return 'Critical'
  if (percentage >= 75) return 'Warning'
  if (percentage >= 50) return 'Info'
  return 'Healthy'
}

export function safeHttpUrl(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

export function titleCaseStatus(value = '') {
  return String(value).replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}
