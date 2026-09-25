import test from 'node:test'
import assert from 'node:assert/strict'
import { analysisSuggestionValue, applyItemAnalysisSuggestions, ITEM_ANALYSIS_SUGGESTIONS } from '../src/seller-utils.js'

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
