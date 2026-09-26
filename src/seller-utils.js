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

export const PRODUCT_DETAIL_TABS = [
  { id: 'summary', label: 'Ringkas' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'sales', label: 'Penjualan' },
]

export function productDisplayTitle(item = {}) {
  const brand = String(item.brand || '').trim()
  const name = String(item.name || '').trim()
  if (!brand) return name || 'Barang tanpa nama'
  if (!name) return brand
  const brandPrefixMatches = name.slice(0, brand.length).toLocaleLowerCase() === brand.toLocaleLowerCase()
    && (name.length === brand.length || /[\s\-/:,]/.test(name[brand.length]))
  return brandPrefixMatches ? name : `${brand} ${name}`
}

export function productDetailSubtitle(item = {}) {
  const name = String(item.name || '').toLocaleLowerCase()
  const attributes = [item.size_label, item.condition, item.category]
    .filter(Boolean)
    .filter((value) => !(String(value).length > 2 && name.includes(String(value).toLocaleLowerCase())))
  return attributes.join(' · ') || 'Detail barang'
}

export function productDetailTabForKey(currentTab, key) {
  const index = PRODUCT_DETAIL_TABS.findIndex((tab) => tab.id === currentTab)
  if (index < 0) return PRODUCT_DETAIL_TABS[0].id
  if (key === 'Home') return PRODUCT_DETAIL_TABS[0].id
  if (key === 'End') return PRODUCT_DETAIL_TABS[PRODUCT_DETAIL_TABS.length - 1].id
  if (key === 'ArrowRight') return PRODUCT_DETAIL_TABS[(index + 1) % PRODUCT_DETAIL_TABS.length].id
  if (key === 'ArrowLeft') return PRODUCT_DETAIL_TABS[(index + PRODUCT_DETAIL_TABS.length - 1) % PRODUCT_DETAIL_TABS.length].id
  return currentTab
}

export function productDetailPrimaryAction(item, listings = []) {
  if (String(item?.status || '').toLowerCase() === 'sold') {
    return { kind: 'tab', target: 'sales', label: 'Lihat penjualan' }
  }
  const incomplete = !String(item?.brand || '').trim()
    || !String(item?.name || '').trim()
    || !String(item?.size_label || '').trim()
    || !String(item?.condition || '').trim()
  if (String(item?.status || '').toLowerCase() === 'draft' || incomplete) {
    return { kind: 'complete', target: 'edit', label: 'Lengkapi barang' }
  }
  const hasActiveListing = listings.some((listing) => ['DRAFT', 'LISTED'].includes(String(listing.listing_status || '').toUpperCase()))
  return hasActiveListing
    ? { kind: 'tab', target: 'marketplace', label: 'Kelola listing' }
    : { kind: 'generator', target: 'marketplace', label: 'Buat listing' }
}

export function productDetailActiveListings(listings = [], soldVia) {
  return listings.filter((listing) => ['LISTED', 'DRAFT'].includes(String(listing.listing_status || '').toUpperCase()) && listing.marketplace !== soldVia)
}

export function marketplaceStatusLabel(status = '') {
  const labels = {
    NOT_LISTED: 'Belum listing',
    DRAFT: 'Draft',
    LISTED: 'Tayang',
    SOLD: 'Terjual',
    REMOVED: 'Dihapus',
  }
  const key = String(status).toUpperCase()
  return labels[key] || titleCaseStatus(status)
}

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
  { label: 'HUNTING', links: [['/seller/ai-hunter', 'Hunting', '✦']] },
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
  { label: 'JUALAN', links: [['/seller/sales', 'Terjual', '◎']] },
]

export const SOURCING_CANDIDATE_STATUSES = ['WATCHING', 'CHECK', 'NEGOTIATING', 'BOUGHT', 'SKIPPED']

const SOURCING_STATUS_LABELS = {
  WATCHING: 'Dipantau',
  CHECK: 'Perlu dicek',
  NEGOTIATING: 'Negosiasi',
  BOUGHT: 'Dibeli',
  SKIPPED: 'Dilewati',
}

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

export function huntingTabForPath(path) {
  return path === '/seller/sourcing' ? 'finds' : 'research'
}

export function huntingPathForTab(tab) {
  return tab === 'finds' ? '/seller/sourcing' : '/seller/ai-hunter'
}

export function sourcingCandidateStatusLabel(status) {
  return SOURCING_STATUS_LABELS[String(status || '').toUpperCase()] || titleCaseStatus(status)
}

export function sourcingCandidateCanMoveToInventory(candidate) {
  return String(candidate?.status || '').toUpperCase() === 'BOUGHT' && !candidate?.product_id
}

export function sourcingCandidateIsInInventory(candidate) {
  return Boolean(candidate?.product_id)
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

