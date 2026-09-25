import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { analysisBilingualValue, analysisSuggestionValue, applyItemAnalysisSuggestions, ITEM_ANALYSIS_SUGGESTIONS } from '../src/seller-utils.js'
import { createItemAnalysisRequest } from '../supabase/functions/seller-ai/analysis-request.js'
import { DEFAULT_MODEL, estimateCostIdr, modelPricing } from '../supabase/functions/seller-ai/pricing.ts'
import { normalizeItemAnalysis } from '../supabase/functions/seller-ai/analysis-schema.ts'

test('item analysis suggestions expose only approved product fields', () => {
  assert.deepEqual(ITEM_ANALYSIS_SUGGESTIONS.map(({ key }) => key), [
    'detected_brand',
    'suggested_title',
    'suggested_category',
    'condition_summary',
    'visible_defects',
    'seller_notes',
  ])
})

test('analysis arrays render as reviewable seller text', () => {
  assert.equal(analysisSuggestionValue({ visible_defects: ['cuff wear', 'small mark'] }, 'visible_defects'), 'cuff wear; small mark')
})

test('suggestions apply only after explicit field selection', () => {
  const item = { brand: 'Existing', name: 'Existing title', category: 'Jackets', defects: 'Seller note' }
  const result = { detected_brand: 'Detected', suggested_title: 'Suggested title', suggested_category: 'Outerwear', visible_defects: ['Small mark'] }
  const next = applyItemAnalysisSuggestions(item, result, { detected_brand: true, suggested_title: false, suggested_category: true, visible_defects: false })
  assert.equal(next.brand, 'Detected')
  assert.equal(next.category, 'Outerwear')
  assert.equal(next.name, 'Existing title')
  assert.equal(next.defects, 'Seller note')
})

test('item analysis keeps Indonesian primary and English review values', () => {
  const result = normalizeItemAnalysis({
    suggested_title: 'Jaket kerja Stussy',
    suggested_title_en: 'Stussy work jacket',
    condition_summary: 'Kondisi baik dengan sedikit pemakaian',
    condition_summary_en: 'Good condition with light wear',
    visible_defects: ['Noda kecil di manset'],
    visible_defects_en: ['Small cuff mark'],
    authenticity_note: 'This item is authentic',
    marketplace_recommendations: [{ marketplace: 'Grailed', recommendation: 'Sangat cocok', recommendation_en: 'Strong fit' }],
  })
  assert.deepEqual(analysisBilingualValue(result, 'suggested_title'), { id: 'Jaket kerja Stussy', en: 'Stussy work jacket' })
  assert.deepEqual(analysisBilingualValue(result, 'visible_defects'), { id: 'Noda kecil di manset', en: 'Small cuff mark' })
  assert.equal(result.authenticity_note, 'Keaslian belum diverifikasi. Perlu pemeriksaan manual.')
  assert.equal(result.authenticity_note_en, 'Authenticity not verified. Manual verification required.')
  assert.equal(result.marketplace_recommendations.find(({ marketplace }) => marketplace === 'Grailed').recommendation, 'Sangat cocok')
})

test('authenticity cautions are never applied as seller description suggestions', () => {
  const result = { seller_notes: ['Condition looks clean', 'authenticity_not_verified', 'manual verification required'] }
  assert.equal(analysisSuggestionValue(result, 'seller_notes'), 'Condition looks clean')
  assert.equal(analysisBilingualValue(result, 'seller_notes').en, 'Condition looks clean')
})

test('ITEM_ANALYSIS still finalizes token/cost usage before returning results', async () => {
  const source = await readFile(new URL('../supabase/functions/seller-ai/index.ts', import.meta.url), 'utf8')
  assert.match(source, /feature:\s*'ITEM_ANALYSIS'/)
  assert.match(source, /finalize_ai_usage/)
  assert.match(source, /p_input_tokens:\s*tokens\.input/)
  assert.match(source, /p_output_tokens:\s*tokens\.output/)
  assert.match(source, /p_estimated_cost:\s*actualCost/)
})

test('Responses request pins GPT-6 Luna and low reasoning without sampling options', () => {
  const request = createItemAnalysisRequest({
    model: DEFAULT_MODEL,
    input: [{ role: 'user', content: [] }],
    maxOutputTokens: 1600,
    schema: { type: 'object' },
  })
  assert.equal(DEFAULT_MODEL, 'gpt-6-luna')
  assert.equal(request.model, 'gpt-6-luna')
  assert.deepEqual(request.reasoning, { effort: 'low' })
  assert.equal(request.temperature, undefined)
  assert.equal(request.top_p, undefined)
  assert.equal(request.reasoning_effort, undefined)
})

test('GPT-6 Luna pricing distinguishes cached input tokens', () => {
  globalThis.Deno = { env: { get: () => undefined } }
  assert.deepEqual(modelPricing('gpt-6-luna'), { input: 0.1, cachedInput: 0.01, output: 0.5, idrPerUsd: 16000 })
  assert.equal(estimateCostIdr('gpt-6-luna', 1_000_000, 1_000_000, 500_000), 8880)
})
