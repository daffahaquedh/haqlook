export const MARKETPLACES = ['Haqlooks', 'Preloved', 'Grailed', 'Vestiaire', 'Carousell', 'Instagram']

export const ITEM_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    detected_brand: { type: 'string' },
    suggested_title: { type: 'string' },
    suggested_category: { type: 'string' },
    style: { type: 'string' },
    estimated_era: { type: 'string' },
    color: { type: 'string' },
    condition_summary: { type: 'string' },
    visible_defects: { type: 'array', items: { type: 'string' } },
    marketplace_recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          marketplace: { type: 'string' },
          recommendation: { type: 'string' },
          listing_angle: { type: 'string' },
          manual_verification_required: { type: 'boolean' },
        },
        required: ['marketplace', 'recommendation', 'listing_angle', 'manual_verification_required'],
      },
    },
    seller_notes: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
  },
  required: [
    'detected_brand',
    'suggested_title',
    'suggested_category',
    'style',
    'estimated_era',
    'color',
    'condition_summary',
    'visible_defects',
    'marketplace_recommendations',
    'seller_notes',
    'confidence',
  ],
} as const

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 500) : ''
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((entry) => typeof entry === 'string').map((entry) => entry.trim().slice(0, 300)).filter(Boolean).slice(0, 12)
}

export function normalizeItemAnalysis(value: unknown) {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const sourceRecommendations = Array.isArray(candidate.marketplace_recommendations) ? candidate.marketplace_recommendations : []
  const recommendations = MARKETPLACES.map((marketplace) => {
    const match = sourceRecommendations.find((entry) => entry && typeof entry === 'object' && String((entry as Record<string, unknown>).marketplace || '').toLowerCase() === marketplace.toLowerCase()) as Record<string, unknown> | undefined
    return {
      marketplace,
      recommendation: stringValue(match?.recommendation) || 'Review manually before listing.',
      listing_angle: stringValue(match?.listing_angle),
      manual_verification_required: true,
    }
  })
  const notes = stringList(candidate.seller_notes)
  if (!notes.includes('authenticity_not_verified')) notes.push('authenticity_not_verified')
  if (!notes.includes('manual verification required')) notes.push('manual verification required')
  return {
    detected_brand: stringValue(candidate.detected_brand),
    suggested_title: stringValue(candidate.suggested_title),
    suggested_category: stringValue(candidate.suggested_category),
    style: stringValue(candidate.style),
    estimated_era: stringValue(candidate.estimated_era),
    color: stringValue(candidate.color),
    condition_summary: stringValue(candidate.condition_summary),
    visible_defects: stringList(candidate.visible_defects),
    marketplace_recommendations: recommendations,
    seller_notes: notes.slice(0, 12),
    confidence: Math.max(0, Math.min(100, Number(candidate.confidence) || 0)),
  }
}
