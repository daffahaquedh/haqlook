const PUBLIC_STATUSES = new Set(['available', 'reserved', 'sold'])

const STATUS_LABELS = Object.freeze({
  available: 'Tersedia',
  reserved: 'Dipesan',
  sold: 'Terjual',
})

export function normalizePublicStatus(status) {
  const value = String(status || '').trim().toLowerCase()
  return PUBLIC_STATUSES.has(value) ? value : 'unknown'
}

export function publicStatusLabel(status) {
  const normalized = normalizePublicStatus(status)
  return STATUS_LABELS[normalized] || 'Status belum diketahui'
}

export function publicPurchaseAction(status, hasWhatsApp = true) {
  switch (normalizePublicStatus(status)) {
    case 'available':
      return {
        disabled: false,
        label: hasWhatsApp ? 'Tanya / Beli via WhatsApp' : 'Tanya via Instagram',
      }
    case 'reserved':
      return { disabled: true, label: 'Dipesan' }
    case 'sold':
      return { disabled: true, label: 'Terjual / Arsip' }
    default:
      return { disabled: true, label: 'Status belum diketahui' }
  }
}

export function filterAndSortPublicProducts(products, { query = '', status = 'all', sort = 'newest' } = {}) {
  const normalizedQuery = String(query).trim().toLowerCase()
  const normalizedStatus = status === 'all' ? 'all' : normalizePublicStatus(status)
  const filtered = products.filter((product) => {
    const searchable = [product.name, product.brand, product.model, product.size_label]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return (!normalizedQuery || searchable.includes(normalizedQuery))
      && (normalizedStatus === 'all' || normalizePublicStatus(product.status) === normalizedStatus)
  })

  const price = (product) => {
    const raw = product.price_idr
    if (raw === null || raw === undefined || String(raw).trim() === '') return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }
  const created = (product) => {
    const value = Date.parse(product.created_at || '')
    return Number.isFinite(value) ? value : 0
  }

  return filtered.sort((a, b) => {
    if (sort === 'price-asc' || sort === 'price-desc') {
      const priceA = price(a)
      const priceB = price(b)
      if (priceA === null && priceB !== null) return 1
      if (priceA !== null && priceB === null) return -1
      if (priceA === null && priceB === null) return 0
      return sort === 'price-asc' ? priceA - priceB : priceB - priceA
    }
    return created(b) - created(a)
  })
}

export function publicProductUrl(origin, slug) {
  const base = String(origin || '').replace(/\/+$/, '')
  const safeSlug = String(slug || '').trim()
  return `${base}/product/${encodeURIComponent(safeSlug)}`
}

export function buildWhatsAppProductMessage(product, url) {
  const name = String(product?.name || 'barang HAQLOOKS').replace(/[\r\n]+/g, ' ').trim()
  const slug = String(product?.slug || '').replace(/[\r\n]+/g, '').trim()
  return [
    `Halo HAQLOOKS, saya tertarik dengan ${name}.`,
    slug ? `Kode barang: ${slug}` : null,
    'Apakah barang ini masih tersedia?',
    `Link barang: ${url}`,
  ].filter(Boolean).join('\n')
}

