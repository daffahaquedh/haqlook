const GREETING = /^(?:hai|halo|hello|hi|hey|pagi|siang|sore|malam|assalamualaikum|assalamu alaikum)(?:\s+(?:haq\s*ai|haqlooks|kak))?[.!?\s]*$/iu

export function isHaqAiGreeting(value) {
  const text = String(value || '').normalize('NFKC').trim()
  return text.length <= 48 && GREETING.test(text)
}

export function routeHaqAiContext(value) {
  const text = String(value || '').normalize('NFKC').trim()
  const normalized = text.toLocaleLowerCase('id-ID')

  const skuMatch = text.match(/\bHL[-\s]?(\d{1,6})\b/i)
  if (skuMatch) return { type: 'product', sku: `HL-${skuMatch[1]}` }

  if (/\b(?:paling lama|tertua|lama belum laku|stok lama|oldest)\b/i.test(normalized)) {
    return { type: 'oldest_available' }
  }
  if (/\b(?:profit|laba|pendapatan|omzet|penjualan)\b/i.test(normalized) && /\b(?:bulan ini|bulan berjalan|bulan sekarang|this month)\b/i.test(normalized)) {
    return { type: 'monthly_sales' }
  }
  if (/\b(?:listing|listings|marketplace)\b/i.test(normalized) && /\b(?:aktif|active|listed|terdaftar|dipasang)\b/i.test(normalized)) {
    return { type: 'active_listings' }
  }
  if (/\b(?:temuan|sourcing|kandidat hunting|kandidat tersimpan)\b/i.test(normalized)) {
    return { type: 'saved_finds' }
  }
  if (/\b(?:analisis toko|ringkasan toko|ringkasan inventory|ringkasan inventori|berapa stok|jumlah stok|kondisi inventory|kondisi inventori)\b/i.test(normalized)) {
    return { type: 'store_summary' }
  }

  const named = text.match(/\b(?:produk|barang)\s+(?:bernama\s+)?["“]?([\p{L}\p{N}][\p{L}\p{N} .'-]{2,48})/iu)
  const term = named?.[1]?.replace(/[?!.,"”]+$/g, '').trim()
  if (term && !/^(?:apa|yang|tersedia|aktif|saya|kami|paling|belum|masih|baru|ini|itu|saja|dong|ada|terjual)(?:\s|$)/iu.test(term)) {
    return { type: 'product_search', term: term.slice(0, 48) }
  }

  return { type: 'none' }
}

function sanitizeContext(value, depth = 0) {
  if (depth > 4 || value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 280)
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => sanitizeContext(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [key.slice(0, 60), sanitizeContext(item, depth + 1)]))
  }
  return null
}

export function boundHaqAiContext(value, maximumCharacters = 6000) {
  const safe = sanitizeContext(value)
  const serialized = JSON.stringify(safe)
  if (serialized.length <= maximumCharacters) return safe

  const compact = sanitizeContext(safe)
  const shrink = (node) => {
    if (Array.isArray(node)) return node.slice(0, 3).map(shrink)
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, shrink(item)]))
    if (typeof node === 'string') return node.slice(0, 100)
    return node
  }
  const smaller = shrink(compact)
  if (JSON.stringify(smaller).length <= maximumCharacters) return smaller
  return { scope: String(safe?.scope || 'limited').slice(0, 40), context_limited: true }
}

export function jakartaMonthRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const pad = (number) => String(number).padStart(2, '0')
  return {
    start: `${year}-${pad(month)}-01T00:00:00+07:00`,
    end: `${nextYear}-${pad(nextMonth)}-01T00:00:00+07:00`,
  }
}
