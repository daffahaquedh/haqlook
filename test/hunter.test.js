import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHunterCacheKey, detectHunterCategories, detectHunterDestination, filterHunterTargets, parseHunterBudget } from '../src/hunter-utils.js'
import { createHunterBriefRequest, createHunterChatRequest, createHunterItemCheckRequest } from '../supabase/functions/seller-ai/hunter-analysis.ts'
import { countWebSearchCalls, extractHunterCitations, sanitizeHunterBrief, summarizeHaqlooksData } from '../supabase/functions/seller-ai/hunter-utils.ts'
import { estimateHunterCostIdr, hunterReservationCostIdr } from '../supabase/functions/seller-ai/pricing.ts'

test('natural budget parsing handles localized IDR and shorthand', () => {
  assert.equal(parseHunterBudget('Modal Rp300.000'), 300_000)
  assert.equal(parseHunterBudget('Modal cuma 500 ribu'), 500_000)
  assert.equal(parseHunterBudget('budget 1,5 juta'), 1_500_000)
  assert.equal(parseHunterBudget('fokus jaket aja'), null)
})

test('destination parsing does not mistake international resale chat for a location', () => {
  assert.equal(detectHunterDestination('Hari ini aku mau hunting ke Pajak Melati'), 'Pajak Melati')
  assert.equal(detectHunterDestination('mana yang paling gampang dijual ke luar'), '')
  assert.deepEqual(detectHunterCategories('Fokus kaos dan jaket'), ['T-shirts', 'Jackets'])
})

test('destination cache key stays stable across the 12-hour expiry window', () => {
  const morning = buildHunterCacheKey('Pajak Melati', 'all', new Date('2026-09-25T15:30:00Z'))
  const nextMorning = buildHunterCacheKey('Pajak Melati', 'all', new Date('2026-09-26T03:00:00Z'))
  assert.equal(morning, nextMorning)
})

test('chat re-ranks stored targets locally while destination research uses web_search', () => {
  const research = createHunterBriefRequest({ destination: 'Pajak Melati', now: '2026-09-26T00:00:00Z' })
  const chat = createHunterChatRequest({ message: 'modal 300 ribu', brief: { sections: {} } })
  assert.equal(research.model, 'gpt-6-luna')
  assert.deepEqual(research.reasoning, { effort: 'medium' })
  assert.deepEqual(research.tools, [{ type: 'web_search', search_context_size: 'medium' }])
  assert.equal(research.tool_choice, 'required')
  assert.equal(research.max_tool_calls, 10)
  assert.equal(chat.model, 'gpt-6-luna')
  assert.deepEqual(chat.reasoning, { effort: 'low' })
  assert.equal(chat.tools, undefined)
})

test('photo check stays a secondary no-web-search call with low reasoning', () => {
  const request = createHunterItemCheckRequest({ imageDataUrls: ['data:image/jpeg;base64,AA=='], askingPriceIdr: 100000 })
  assert.deepEqual(request.reasoning, { effort: 'low' })
  assert.equal(request.tools, undefined)
  assert.equal(request.input[1].content[1].detail, 'low')
})

test('only genuine Responses URL citations can support price ranges or discoveries', () => {
  const payload = { output: [{ type: 'message', content: [{ type: 'output_text', annotations: [{ type: 'url_citation', url: 'https://example.com/listing', title: 'Public listing' }] }] }, { type: 'web_search_call', action: { type: 'search' } }] }
  const citations = extractHunterCitations(payload)
  assert.equal(countWebSearchCalls(payload), 1)
  const brief = sanitizeHunterBrief({ sections: { priority: [
    { target_id: 'supported', item_name: 'Jacket', source_urls: ['https://example.com/listing'], resale_low: 100000, resale_high: 200000, resale_currency: 'IDR', ideal_buy_low_idr: 50000, ideal_buy_high_idr: 80000, max_buy_price_idr: 90000 },
    { target_id: 'unsupported', item_name: 'Shirt', source_urls: ['https://fake.example/price'], resale_low: 100000, resale_high: 200000, resale_currency: 'IDR', ideal_buy_low_idr: 50000, ideal_buy_high_idr: 80000, max_buy_price_idr: 70000 },
  ] } }, citations)
  assert.deepEqual(brief.sections.priority[0].source_urls, ['https://example.com/listing'])
  assert.equal(brief.sections.priority[0].availability_classification, 'SOURCING_HYPOTHESIS')
  assert.equal(brief.sections.priority[1].resale_low, null)
  assert.equal(brief.sections.priority[1].max_buy_price_idr, null)
})

test('internal insight aggregates require at least three matching records', () => {
  const summary = summarizeHaqlooksData([
    { id: '1', category: 'Jackets', brand: 'Example', purchase_price: 100000 },
    { id: '2', category: 'Jackets', brand: 'Example', purchase_price: 120000 },
    { id: '3', category: 'Jackets', brand: 'Example', purchase_price: 140000 },
  ], [])
  assert.deepEqual(summary.inventory_by_category, [{ label: 'Jackets', count: 3 }])
  assert.deepEqual(summary.average_purchase_by_category, [{ category: 'Jackets', sample_count: 3, average_purchase_price_idr: 120000 }])
})

test('Hunter cost reservations include web search costs and usage uses centralized pricing', () => {
  globalThis.Deno = { env: { get: () => undefined } }
  const researchEstimate = hunterReservationCostIdr('gpt-6-luna', 'research')
  const chatEstimate = hunterReservationCostIdr('gpt-6-luna', 'chat')
  const measured = estimateHunterCostIdr('gpt-6-luna', 1_000_000, 1_000_000, 500_000, 2)
  assert.ok(researchEstimate > chatEstimate)
  assert.equal(measured.toolCostIdr, 320)
  assert.equal(measured.totalCostIdr, measured.tokenCostIdr + measured.toolCostIdr)
})

