import test from 'node:test'
import assert from 'node:assert/strict'
import { analysisSuggestionValue, applyItemAnalysisSuggestions, ITEM_ANALYSIS_SUGGESTIONS } from '../src/seller-utils.js'
import { createItemAnalysisRequest } from '../supabase/functions/seller-ai/analysis-request.js'
import { DEFAULT_MODEL, estimateCostIdr, modelPricing } from '../supabase/functions/seller-ai/pricing.ts'

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
