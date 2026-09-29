const DEFAULT_INSTAGRAM_URL = 'https://www.instagram.com/haqlook/'

export function normalizeWhatsAppNumber(input) {
  const value = String(input ?? '').trim()
  if (!value) return ''
  if (!/^[0-9+\s().-]+$/.test(value)) return null

  const plusCount = (value.match(/\+/g) || []).length
  if (plusCount > 1 || (plusCount === 1 && !value.startsWith('+'))) return null

  const digits = value.replace(/\D/g, '')
  let canonical
  if (value.startsWith('+') || digits.startsWith('62')) {
    if (!digits.startsWith('62')) return null
    canonical = digits
  } else if (digits.startsWith('0')) {
    canonical = `62${digits.slice(1)}`
  } else {
    return null
  }

  return /^628[1-9][0-9]{7,10}$/.test(canonical) ? canonical : null
}

export function normalizeInstagramProfile(input) {
  const value = String(input ?? '').trim()
  if (!value) return ''
  let handle

  if (value.startsWith('@')) {
    handle = value.slice(1)
  } else if (/^[A-Za-z0-9._]{1,30}$/.test(value)) {
    handle = value
  } else {
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      return null
    }
    if (
      parsed.protocol !== 'https:'
      || !['instagram.com', 'www.instagram.com'].includes(parsed.hostname.toLowerCase())
      || parsed.port
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) return null
    const path = parsed.pathname.replace(/^\/+|\/+$/g, '')
    if (!path || path.includes('/')) return null
    handle = path
  }

  if (
    !/^[A-Za-z0-9._]{1,30}$/.test(handle)
    || handle.startsWith('.')
    || handle.endsWith('.')
    || handle.includes('..')
    || ['p', 'reel', 'reels', 'stories', 'explore', 'direct', 'accounts'].includes(handle.toLowerCase())
  ) return null

  return `https://www.instagram.com/${handle}/`
}

export function resolveStorefrontContact(settings) {
  const whatsappNumber = normalizeWhatsAppNumber(settings?.whatsapp_number)
  const instagramUrl = normalizeInstagramProfile(settings?.instagram_url) || DEFAULT_INSTAGRAM_URL
  const hasWhatsApp = Boolean(whatsappNumber)
  return {
    whatsappNumber: hasWhatsApp ? whatsappNumber : null,
    instagramUrl,
    primaryType: hasWhatsApp ? 'whatsapp' : 'instagram',
    primaryUrl: hasWhatsApp ? `https://wa.me/${whatsappNumber}` : instagramUrl,
  }
}
