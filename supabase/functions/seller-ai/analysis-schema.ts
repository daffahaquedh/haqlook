export const MARKETPLACES = ['Haqlooks', 'Preloved', 'Grailed', 'Vestiaire', 'Carousell', 'Instagram']

export const ITEM_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    detected_brand: { type: 'string' },
    suggested_title: { type: 'string' },
    suggested_title_en: { type: 'string' },
    suggested_category: { type: 'string' },
    suggested_category_en: { type: 'string' },
    style: { type: 'string' },
    style_en: { type: 'string' },
    estimated_era: { type: 'string' },
    estimated_era_en: { type: 'string' },
    color: { type: 'string' },
    color_en: { type: 'string' },
    condition_summary: { type: 'string' },
    condition_summary_en: { type: 'string' },
    visible_defects: { type: 'array', items: { type: 'string' } },
    visible_defects_en: { type: 'array', items: { type: 'string' } },
    authenticity_note: { type: 'string' },
    authenticity_note_en: { type: 'string' },
    marketplace_recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          marketplace: { type: 'string' },
          recommendation: { type: 'string' },
          recommendation_en: { type: 'string' },
          listing_angle: { type: 'string' },
          listing_angle_en: { type: 'string' },
          manual_verification_required: { type: 'boolean' },
        },
        required: ['marketplace', 'recommendation', 'recommendation_en', 'listing_angle', 'listing_angle_en', 'manual_verification_required'],
      },
    },
    seller_notes: { type: 'array', items: { type: 'string' } },
    seller_notes_en: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
  },
  required: [
    'detected_brand',
    'suggested_title',
    'suggested_title_en',
    'suggested_category',
    'suggested_category_en',
    'style',
    'style_en',
    'estimated_era',
    'estimated_era_en',
    'color',
    'color_en',
    'condition_summary',
    'condition_summary_en',
    'visible_defects',
    'visible_defects_en',
    'authenticity_note',
    'authenticity_note_en',
    'marketplace_recommendations',
    'seller_notes',
    'seller_notes_en',
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

function pairedString(candidate: Record<string, unknown>, key: string) {
  const primary = stringValue(candidate[key])
  return { primary, english: stringValue(candidate[`${key}_en`]) || primary }
}

function pairedList(primaryValue: unknown, englishValue: unknown) {
  const primary = stringList(primaryValue)
  const english = stringList(englishValue)
  return { primary, english: primary.map((value, index) => english[index] || value) }
}

export function normalizeItemAnalysis(value: unknown) {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const sourceRecommendations = Array.isArray(candidate.marketplace_recommendations) ? candidate.marketplace_recommendations : []
  const recommendations = MARKETPLACES.map((marketplace) => {
    const match = sourceRecommendations.find((entry) => entry && typeof entry === 'object' && String((entry as Record<string, unknown>).marketplace || '').toLowerCase() === marketplace.toLowerCase()) as Record<string, unknown> | undefined
    const recommendation = stringValue(match?.recommendation) || 'Periksa kecocokan secara manual sebelum memasarkan.'
    const listingAngle = stringValue(match?.listing_angle)
    return {
      marketplace,
      recommendation,
      recommendation_en: stringValue(match?.recommendation_en) || recommendation,
      listing_angle: listingAngle,
      listing_angle_en: stringValue(match?.listing_angle_en) || listingAngle,
      manual_verification_required: true,
    }
  })
  const notes = pairedList(candidate.seller_notes, candidate.seller_notes_en)
  const sellerNotes = notes.primary.filter((note) => !['authenticity_not_verified', 'manual verification required'].includes(note.toLowerCase())).slice(0, 10)
  const sellerNotesEn = notes.english.filter((note) => !['authenticity_not_verified', 'manual verification required'].includes(note.toLowerCase())).slice(0, 10)
  const title = pairedString(candidate, 'suggested_title')
  const category = pairedString(candidate, 'suggested_category')
  const style = pairedString(candidate, 'style')
  const era = pairedString(candidate, 'estimated_era')
  const color = pairedString(candidate, 'color')
  const condition = pairedString(candidate, 'condition_summary')
  const defects = pairedList(candidate.visible_defects, candidate.visible_defects_en)
  return {
    detected_brand: stringValue(candidate.detected_brand),
    suggested_title: title.primary,
    suggested_title_en: title.english,
    suggested_category: category.primary,
    suggested_category_en: category.english,
    style: style.primary,
    style_en: style.english,
    estimated_era: era.primary,
    estimated_era_en: era.english,
    color: color.primary,
    color_en: color.english,
    condition_summary: condition.primary,
    condition_summary_en: condition.english,
    visible_defects: defects.primary,
    visible_defects_en: defects.english,
    authenticity_note: 'Keaslian belum diverifikasi. Perlu pemeriksaan manual.',
    authenticity_note_en: 'Authenticity not verified. Manual verification required.',
    marketplace_recommendations: recommendations,
    seller_notes: [...sellerNotes, 'authenticity_not_verified', 'manual verification required'],
    seller_notes_en: [...sellerNotesEn, 'authenticity_not_verified', 'manual verification required'],
    confidence: Math.max(0, Math.min(100, Number(candidate.confidence) || 0)),
  }
}
