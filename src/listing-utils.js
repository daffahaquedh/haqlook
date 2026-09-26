export const LISTING_PROFILES = [
  { key: 'grailed', marketplace: 'GRAILED', label: 'Grailed', language: 'English', style: 'Fashion-forward, searchable, concise' },
  { key: 'vestiaire', marketplace: 'VESTIAIRE', label: 'Vestiaire', language: 'English', style: 'Clean, structured, condition-focused' },
  { key: 'carousell', marketplace: 'CAROUSELL', label: 'Carousell', language: 'Bahasa Indonesia', style: 'Practical and easy to scan' },
  { key: 'preloved', marketplace: 'PRELOVED', label: 'Preloved', language: 'Bahasa Indonesia', style: 'Natural, clear, condition-forward' },
]

export const LISTING_ZERO_COST_ACTIONS = Object.freeze({
  edit: 0,
  copy: 0,
  save: 0,
  status: 0,
  url: 0,
  askingPrice: 0,
})

export const LISTING_STATUSES = ['DRAFT', 'LISTED', 'SOLD', 'REMOVED']

export function selectedListingProfiles(keys = []) {
  const selected = new Set(Array.isArray(keys) ? keys : [])
  return LISTING_PROFILES.filter(({ key }) => selected.has(key))
}

export function needsListingRegenerationConfirmation(hasExistingDraft, confirmed) {
  return Boolean(hasExistingDraft && !confirmed)
}

export function createListingGenerationBody(productId, keys, requestId) {
  const marketplaces = selectedListingProfiles(keys).map(({ marketplace }) => marketplace)
  if (!productId) throw new Error('Save the inventory item before generating listings.')
  if (!marketplaces.length) throw new Error('Select at least one marketplace.')
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error('A valid request ID is required.')
  return { feature: 'LISTING_GENERATION', product_id: productId, marketplaces, request_id: requestId }
}

export function safeListingUrl(value) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null
  } catch {
    return null
  }
}

export function normalizeListingResult(result, item = {}) {
  const size = String(item.size_label || '').trim()
  const tags = Array.isArray(result?.tags) ? result.tags : []
  return {
    title: String(result?.title || '').trim(),
    description: String(result?.description || '').trim(),
    condition_summary: String(result?.condition_summary || '').trim(),
    size_display: size,
    measurements_text: String(result?.measurements_text || '').trim(),
    tags: tags.map((tag) => String(tag || '').trim()).filter(Boolean),
    warnings: Array.isArray(result?.warnings) ? result.warnings.map((warning) => String(warning || '').trim()).filter(Boolean) : [],
  }
}

export function makeListingSavePayload({ item, marketplace, draft, existing, listingStatus, askingPrice, listingUrl, now = new Date().toISOString() }) {
  if (String(item?.status || '').toLowerCase() === 'sold') throw new Error('Sold inventory cannot be saved as a new marketplace listing.')
  if (!LISTING_PROFILES.some((profile) => profile.marketplace === marketplace)) throw new Error('Unsupported listing marketplace.')
  const safeUrl = listingUrl ? safeListingUrl(listingUrl) : null
  if (listingUrl && !safeUrl) throw new Error('Listing URL must use http:// or https://.')
  const status = LISTING_STATUSES.includes(listingStatus) ? listingStatus : 'DRAFT'
  const keepExistingListing = existing?.listing_status === 'LISTED' && status === 'DRAFT'
  const finalStatus = keepExistingListing ? 'LISTED' : status
  const text = normalizeListingResult(draft, item)
  return {
    product_id: item.id,
    marketplace,
    listing_status: finalStatus,
    listing_url: safeUrl,
    listed_price: Math.max(0, Math.round(Number(askingPrice) || 0)),
    listed_at: finalStatus === 'LISTED' ? (existing?.listed_at || now) : (existing?.listed_at || null),
    last_updated: now,
    listing_title: text.title,
    listing_description: text.description,
    listing_tags: text.tags,
    condition_summary: text.condition_summary,
    size_display: text.size_display,
    measurements_text: text.measurements_text,
    warnings: text.warnings,
  }
}
