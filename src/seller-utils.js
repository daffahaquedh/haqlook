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
  { key: 'detected_brand', label: 'Merek terdeteksi', labelEn: 'Detected brand', target: 'brand' },
  { key: 'suggested_title', label: 'Judul yang disarankan', labelEn: 'Suggested title', target: 'name' },
  { key: 'suggested_category', label: 'Kategori', labelEn: 'Category', target: 'category' },
  { key: 'condition_summary', label: 'Ringkasan kondisi', labelEn: 'Condition summary', target: 'condition_notes' },
  { key: 'visible_defects', label: 'Kekurangan terlihat', labelEn: 'Visible defects', target: 'defects' },
  { key: 'seller_notes', label: 'Catatan untuk seller', labelEn: 'Seller notes', target: 'description' },
]

export const SELLER_WORKSPACE_GROUPS = [
  { label: 'OPERASIONAL', links: [['/seller', 'Beranda', '⌂'], ['/seller/inventory', 'Barang', '▣']] },
  { label: 'HUNTING', links: [['/seller/ai-hunter', 'Riset', '✦'], ['/seller/sourcing', 'Temuan tersimpan', '◌']] },
  { label: 'JUALAN', links: [['/seller/listings', 'Listing', '↗'], ['/seller/sales', 'Terjual', '◎']] },
]

export const ADMIN_WORKSPACE_GROUPS = [
  ...SELLER_WORKSPACE_GROUPS,
  { label: 'INSIGHT', links: [['/seller/analytics', 'Ringkasan bisnis', '▤'], ['/seller/hunter-analytics', 'Hunter', '⌕'], ['/seller/ai-usage', 'Penggunaan AI', '◒']] },
  { label: 'PENGATURAN', links: [['/seller/settings', 'AI & Anggaran', '⚙']] },
]

export const SELLER_MOBILE_PRIMARY_LINKS = [
  ['/seller', 'Beranda', '⌂'],
  ['/seller/inventory', 'Barang', '▣'],
  ['/seller/ai-hunter', 'Hunting', '✦'],
  ['/seller/listings', 'Jualan', '↗'],
]

export const SELLER_MOBILE_MORE_GROUPS = [
  { label: 'HUNTING', links: [['/seller/sourcing', 'Temuan tersimpan', '◌']] },
  { label: 'JUALAN', links: [['/seller/sales', 'Terjual', '◎']] },
]

export const SELLER_WORKSPACE_LINKS = SELLER_WORKSPACE_GROUPS.flatMap(({ links }) => links)
export const ADMIN_WORKSPACE_LINKS = ADMIN_WORKSPACE_GROUPS.slice(SELLER_WORKSPACE_GROUPS.length).flatMap(({ links }) => links)

export const ADMIN_ONLY_SECTIONS = ['analytics', 'hunter-analytics', 'ai-usage', 'users-roles', 'marketplace-settings', 'settings', 'app-settings']

export function workspaceNavigationGroupsForRole(role) {
  return String(role || '').toUpperCase() === 'ADMIN' ? ADMIN_WORKSPACE_GROUPS : SELLER_WORKSPACE_GROUPS
}

export function workspaceMobileMoreGroupsForRole(role) {
  return String(role || '').toUpperCase() === 'ADMIN'
    ? [...SELLER_MOBILE_MORE_GROUPS, ...ADMIN_WORKSPACE_GROUPS.slice(SELLER_WORKSPACE_GROUPS.length)]
    : SELLER_MOBILE_MORE_GROUPS
}

export function workspacePathIsActive(path, href) {
  if (href === '/seller') return path === href
  if (href === '/seller/inventory') return path.startsWith(href)
  if (href === '/seller/ai-hunter') return path === href || path === '/seller/sourcing'
  if (href === '/seller/listings') return path === href || path === '/seller/sales'
  return path === href || path.startsWith(`${href}/`)
}

export function workspaceLinksForRole(role) {
  return String(role || '').toUpperCase() === 'ADMIN'
    ? [...SELLER_WORKSPACE_LINKS, ...ADMIN_WORKSPACE_LINKS]
    : [...SELLER_WORKSPACE_LINKS]
}

export function canAccessWorkspaceSection(role, section) {
  return !ADMIN_ONLY_SECTIONS.includes(section) || String(role || '').toUpperCase() === 'ADMIN'
}

export function workspacePathForLegacyAdmin(path) {
  return path === '/admin' ? '/seller' : path
}

export function analysisSuggestionValue(result, key) {
  const value = result?.[key]
  if (Array.isArray(value)) {
    const notes = key === 'seller_notes' ? value.filter((note) => !['authenticity_not_verified', 'manual verification required'].includes(String(note).toLowerCase())) : value
    return notes.filter(Boolean).join('; ')
  }
  return String(value || '').trim()
}

export function analysisBilingualValue(result, key) {
  const primary = analysisSuggestionValue(result, key)
  const rawEnglish = result?.[`${key}_en`]
  const englishNotes = Array.isArray(rawEnglish) && key === 'seller_notes'
    ? rawEnglish.filter((note) => !['authenticity_not_verified', 'manual verification required'].includes(String(note).toLowerCase()))
    : rawEnglish
  const english = Array.isArray(englishNotes) ? englishNotes.filter(Boolean).join('; ') : String(englishNotes || '').trim()
  return { id: primary, en: english || primary }
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

