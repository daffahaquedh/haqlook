import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHunterCacheKey, detectHunterCategories, detectHunterDestination, filterHunterTargets, parseHunterBudget, sortHunterTargets } from '../src/hunter-utils.js'
import { routeHunterInteraction } from '../src/hunter-router.js'
import { buildHunterChatContext, createHunterBriefRequest, createHunterChatRequest, createHunterItemCheckRequest, HUNTER_OPENAI_TIMEOUT_MS, isHunterReasoningQuestion } from '../supabase/functions/seller-ai/hunter-analysis.ts'
import { countWebSearchCalls, extractHunterCitations, hunterResearchDecision, hunterResponseMetrics, parseCompletedHunterJson, sanitizeHunterBrief, shouldReadHunterCache, summarizeHaqlooksData } from '../supabase/functions/seller-ai/hunter-utils.ts'
import { advanceHunterActivity, beginHunterActivity, finishHunterActivity, hunterActivityLabel, isHunterActivityActive } from '../src/hunter-loading.js'
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
  assert.deepEqual(research.include, ['web_search_call.action.sources'])
  assert.equal(research.tool_choice, 'required')
  assert.equal(research.max_tool_calls, 10)
  assert.equal(research.max_output_tokens, 16000)
  assert.match(research.input[0].content, /approximately 8 useful/i)
  assert.match(research.input[0].content, /never exceed the existing product limit of 15/i)
  assert.match(research.input[0].content, /at most 3 new brand\/model discoveries/i)
  assert.equal(chat.model, 'gpt-6-luna')
  assert.deepEqual(chat.reasoning, { effort: 'low' })
  assert.equal(chat.tools, undefined)
})

test('Hunter OpenAI timeout leaves room below the Supabase 150s idle limit', () => {
  assert.equal(HUNTER_OPENAI_TIMEOUT_MS, 110_000)
  assert.ok(HUNTER_OPENAI_TIMEOUT_MS < 150_000)
})

test('Destination Brief refuses to parse incomplete output and reports token exhaustion specifically', () => {
  assert.throws(() => parseCompletedHunterJson({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"sections":' }), { code: 'AI_OUTPUT_LIMIT' })
  assert.throws(() => parseCompletedHunterJson({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output_text: '{}' }), { code: 'AI_CONTENT_FILTERED' })
  assert.throws(() => parseCompletedHunterJson({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'declined' }] }] }), { code: 'AI_REFUSED' })
  assert.throws(() => parseCompletedHunterJson({ status: 'incomplete', output_text: '{}' }), { code: 'AI_RESPONSE_INCOMPLETE' })
})

test('Destination Brief parses only completed final Structured Output', () => {
  assert.deepEqual(parseCompletedHunterJson({ status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"ok":true}' }] }] }), { ok: true })
  assert.throws(() => parseCompletedHunterJson({ status: 'completed', output: [{ type: 'message', content: [{ type: 'analysis_text', text: '{"partial":true}' }] }] }), { code: 'AI_EMPTY_RESPONSE' })
  assert.throws(() => parseCompletedHunterJson({ status: 'completed', output_text: 'not-json' }), { code: 'AI_INVALID_RESPONSE' })
})

test('Hunter observability records safe response/token/search metrics without prompt fields', () => {
  const metrics = hunterResponseMetrics({
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    usage: { input_tokens: 24000, input_tokens_details: { cached_tokens: 12000 }, output_tokens: 6000, output_tokens_details: { reasoning_tokens: 900 } },
    output: [{ type: 'web_search_call', action: { type: 'search' } }, { type: 'web_search_call', action: { type: 'search' } }],
  })
  assert.deepEqual(metrics, { response_status: 'incomplete', incomplete_reason: 'max_output_tokens', input_tokens: 24000, cached_input_tokens: 12000, output_tokens: 6000, reasoning_tokens: 900, web_search_calls: 2 })
  assert.equal(Object.hasOwn(metrics, 'prompt'), false)
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

test('extracts annotation citations when they are the only provider sources', () => {
  const citations = extractHunterCitations({ output: [{ type: 'message', content: [{ type: 'output_text', annotations: [{ type: 'url_citation', url: 'https://market.example/listing', title: 'Public listing' }] }] }] })
  assert.deepEqual(citations, [{ url: 'https://market.example/listing', title: 'Public listing' }])
})

test('extracts web search action sources when annotations are absent', () => {
  const citations = extractHunterCitations({ output: [{ type: 'web_search_call', action: { type: 'search', sources: [{ url: 'https://market.example/items/123', title: 'Market item' }, { url: 'https://other.example' }] } }] })
  assert.deepEqual(citations, [
    { url: 'https://market.example/items/123', title: 'Market item' },
    { url: 'https://other.example/', title: 'other.example' },
  ])
})

test('combines annotations and web search sources', () => {
  const citations = extractHunterCitations({ output: [
    { type: 'message', content: [{ type: 'output_text', annotations: [{ type: 'url_citation', url: 'https://cited.example/article', title: 'Cited article' }] }] },
    { type: 'web_search_call', action: { sources: [{ url: 'https://searched.example/result', title: 'Search result' }] } },
  ] })
  assert.deepEqual(citations.map((citation) => citation.url), ['https://cited.example/article', 'https://searched.example/result'])
})

test('deduplicates normalized URLs and prefers a supplied source title', () => {
  const citations = extractHunterCitations({ output: [
    { type: 'message', content: [{ type: 'output_text', annotations: [{ type: 'url_citation', url: 'https://EXAMPLE.com/listing/', title: '' }] }] },
    { type: 'web_search_call', action: { sources: [{ url: 'https://example.com/listing', title: 'Listing source' }] } },
  ] })
  assert.deepEqual(citations, [{ url: 'https://example.com/listing', title: 'Listing source' }])
})

test('rejects malformed, non-http and credential-bearing provider URLs', () => {
  const citations = extractHunterCitations({ output: [{ type: 'web_search_call', action: { sources: [
    { url: 'not a url', title: 'Malformed' },
    { url: 'ftp://market.example/item', title: 'FTP' },
    { url: 'javascript:alert(1)', title: 'Script' },
    { url: 'https://user:pass@market.example/item', title: 'Credentials' },
  ] } }] })
  assert.deepEqual(citations, [])
})

test('does not trust model-generated URLs and leaves unsupported price fields null', () => {
  const providerSources = extractHunterCitations({ output: [{ type: 'web_search_call', action: { sources: [{ url: 'https://provider.example/listing', title: 'Provider result' }] } }] })
  const brief = sanitizeHunterBrief({ sections: { priority: [{
    item_name: 'Unverified jacket', source_urls: ['https://invented.example/price'],
    resale_low: 100000, resale_high: 200000, resale_currency: 'IDR', max_buy_price_idr: 80000,
  }] } }, providerSources)
  assert.deepEqual(brief.sections.priority[0].source_urls, [])
  assert.equal(brief.sections.priority[0].resale_low, null)
  assert.equal(brief.sections.priority[0].resale_high, null)
  assert.equal(brief.sections.priority[0].max_buy_price_idr, null)
})

test('brief keeps only provider-backed target URLs with harmless trailing-slash normalization', () => {
  const providerSources = extractHunterCitations({ output: [{ type: 'web_search_call', action: { sources: [{ url: 'https://provider.example/listing', title: 'Provider listing' }] } }] })
  const brief = sanitizeHunterBrief({ sections: { priority: [{
    item_name: 'Jacket', source_urls: ['https://PROVIDER.example/listing/'],
    resale_low: 100000, resale_high: 200000, resale_currency: 'IDR',
  }] } }, providerSources)
  assert.deepEqual(brief.sections.priority[0].source_urls, ['https://provider.example/listing'])
  assert.equal(brief.sections.priority[0].resale_low, 100000)
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

const preflightState = { destination: '', budgetIdr: null, categoryFocus: [], marketGoal: 'both', preflightStep: 'destination' }
const decisionFor = (text, state = preflightState, hasBrief = false) => routeHunterInteraction({ text, state, hasBrief })

test('destination, budget, category, market choices and greetings stay on the free router', () => {
  for (const [text, expected] of [
    ['Pajak Melati', 'budget'], ['500 ribu', 'category'], ['jaket', 'market'], ['luar negeri', 'destination'], ['halo', 'destination'],
  ]) {
    const decision = decisionFor(text)
    assert.notEqual(decision.type, 'AI_CHAT', text)
    assert.notEqual(decision.type, 'START_RESEARCH', text)
    if (text === 'Pajak Melati') assert.equal(decision.state.destination, 'Pajak Melati')
    if (text === '500 ribu') assert.equal(decision.state.budgetIdr, 500000)
    if (text === 'jaket') assert.deepEqual(decision.state.categoryFocus, ['Jackets'])
    if (text === 'luar negeri') assert.equal(decision.state.marketGoal, 'international')
    if (text === 'halo') assert.equal(decision.type, 'PREFLIGHT_RESPONSE')
    assert.ok(expected)
  }
})

test('short ambiguous confirmation never starts research', () => {
  for (const text of ['gas', 'oke', 'iya', 'lanjut', 'batal']) {
    const decision = decisionFor(text, { ...preflightState, destination: 'Pajak Melati', preflightStep: 'summary' })
    assert.ok(['PREFLIGHT_RESPONSE', 'PREFLIGHT_CLARIFY'].includes(decision.type), text)
    assert.equal(decision.researchConfirmed, undefined)
  }
})

test('destination chip and preflight selections advance without any paid decision', () => {
  let decision = routeHunterInteraction({ action: 'destination', value: 'Pajak Melati', state: preflightState })
  assert.equal(decision.type, 'PREFLIGHT_RESPONSE')
  assert.equal(decision.state.preflightStep, 'budget')
  decision = routeHunterInteraction({ action: 'budget', value: 500000, state: decision.state })
  assert.equal(decision.state.preflightStep, 'category')
  decision = routeHunterInteraction({ action: 'category', value: ['Jackets'], state: decision.state })
  assert.equal(decision.state.preflightStep, 'market')
  decision = routeHunterInteraction({ action: 'market', value: 'international', state: decision.state })
  assert.equal(decision.state.preflightStep, 'summary')
  assert.equal(decision.state.marketGoal, 'international')
  assert.ok(['PREFLIGHT_RESPONSE', 'LOCAL_FILTER'].includes(decision.type))
})

test('explicit full destination command only prepares a summary until the button confirmation', () => {
  const decision = decisionFor('Research Pajak Melati, budget 500 ribu, fokus jaket, target luar negeri.')
  assert.equal(decision.type, 'PREFLIGHT_RESPONSE')
  assert.equal(decision.state.destination, 'Pajak Melati')
  assert.equal(decision.state.budgetIdr, 500000)
  assert.deepEqual(decision.state.categoryFocus, ['Jackets'])
  assert.equal(decision.state.marketGoal, 'international')
  assert.equal(decision.state.preflightStep, 'summary')
  assert.equal(decision.researchConfirmed, undefined)
})

test('research confirmation resolves fresh cache before research and refresh explicitly bypasses it', () => {
  const state = { ...preflightState, destination: 'Pajak Melati', preflightStep: 'summary' }
  const freshCache = routeHunterInteraction({ action: 'confirm_research', state, cacheFresh: true })
  const cacheMiss = routeHunterInteraction({ action: 'confirm_research', state, cacheFresh: false })
  const refresh = routeHunterInteraction({ action: 'refresh_research', state })
  assert.equal(freshCache.type, 'LOAD_CACHE')
  assert.equal(freshCache.researchConfirmed, true)
  assert.equal(cacheMiss.type, 'START_RESEARCH')
  assert.equal(refresh.type, 'REFRESH_RESEARCH')
  assert.equal(routeHunterInteraction({ action: 'confirm_research', state: preflightState }).type, 'PREFLIGHT_CLARIFY')
  assert.equal(hunterResearchDecision('HUNTER_DESTINATION_BRIEF', false, false), 'CONFIRMATION_REQUIRED')
  assert.equal(hunterResearchDecision('HUNTER_DESTINATION_BRIEF', true, true), 'LOAD_CACHE')
  assert.equal(hunterResearchDecision('HUNTER_DESTINATION_BRIEF', true, false), 'START_RESEARCH')
  assert.equal(hunterResearchDecision('HUNTER_REFRESH', true, true), 'REFRESH_RESEARCH')
  assert.equal(shouldReadHunterCache('HUNTER_DESTINATION_BRIEF'), true)
  assert.equal(shouldReadHunterCache('HUNTER_REFRESH'), false)
})

test('simple local follow-ups filter categories, budget, market and research sections for zero-AI cost', () => {
  const state = { destination: 'Pajak Melati', budgetIdr: null, categoryFocus: [], marketGoal: 'both', preflightStep: 'done' }
  assert.deepEqual(decisionFor('fokus jaket', state, true).state.categoryFocus, ['Jackets'])
  assert.equal(decisionFor('budget jadi 300 ribu', state, true).state.budgetIdr, 300000)
  assert.equal(decisionFor('yang international aja', state, true).state.marketGoal, 'international')
  assert.equal(decisionFor('yang lokal aja', state, true).state.marketGoal, 'local')
  assert.equal(decisionFor('tampilkan wildcard', state, true).state.activeSection, 'wildcard')
  assert.equal(decisionFor('prioritas utama', state, true).state.activeSection, 'priority')
  for (const phrase of ['fokus jaket', 'budget jadi 300 ribu', 'yang international aja', 'tampilkan wildcard']) assert.notEqual(decisionFor(phrase, state, true).type, 'AI_CHAT')
})

test('saved brief filtering applies budget, market goal and active section locally', () => {
  const brief = { sections: {
    priority: [
      { target_id: 'local', category: 'Jackets', ideal_buy_high_idr: 250000, international_fit: 'good', marketplace_fit: { haqlooks: { fit: 'good' } } },
      { target_id: 'expensive', category: 'Jackets', ideal_buy_high_idr: 600000, international_fit: 'good', marketplace_fit: { grailed: { fit: 'strong' } } },
    ],
    wildcard: [{ target_id: 'wild', category: 'Shoes', ideal_buy_high_idr: 200000, international_fit: 'limited', marketplace_fit: { haqlooks: { fit: 'good' } } }],
  } }
  assert.deepEqual(filterHunterTargets(brief, { categories: ['Jackets'], budgetIdr: 300000, marketGoal: 'international' }).map((target) => target.target_id), ['local'])
  assert.deepEqual(filterHunterTargets(brief, { marketGoal: 'local' }).map((target) => target.target_id), ['local', 'wild'])
  assert.deepEqual(filterHunterTargets(brief, { activeSection: 'wildcard' }).map((target) => target.target_id), ['wild'])
})

test('top-three and cheapest are local structured operations', () => {
  const best = decisionFor('3 terbaik', { destination: 'Pajak Melati' }, true)
  const cheapest = decisionFor('yang paling murah', { destination: 'Pajak Melati' }, true)
  assert.equal(best.type, 'LOCAL_SORT')
  assert.equal(best.limit, 3)
  assert.equal(cheapest.type, 'LOCAL_SORT')
  const rows = [{ target_id: 'a', ideal_buy_high_idr: 200000 }, { target_id: 'b', ideal_buy_high_idr: 100000 }]
  assert.deepEqual(sortHunterTargets(rows, 'cheapest').map((row) => row.target_id), ['b', 'a'])
})

test('only clearly reasoning-oriented questions route to low-cost Hunter Chat', () => {
  assert.equal(decisionFor('Kenapa Carhartt ini lebih bagus daripada Nike ACG?', { destination: 'Pajak Melati' }, true).type, 'AI_CHAT')
  assert.equal(isHunterReasoningQuestion('Kalau ada noda sedikit masih worth it?'), true)
  assert.equal(isHunterReasoningQuestion('fokus jaket aja'), false)
  const chat = createHunterChatRequest({ message: 'Kenapa item ini lebih cocok?', context: { relevant_targets: [] } })
  assert.deepEqual(chat.reasoning, { effort: 'low' })
  assert.equal(chat.tools, undefined)
  assert.equal(JSON.stringify(chat).includes('conversation'), false)
})

test('chat context contains at most three relevant structured targets and only their evidence', () => {
  const makeTarget = (target_id, item_name) => ({ target_id, item_name, category: 'Jackets', why_search: 'Useful', source_urls: [`https://${target_id}.example/item`], resale_low: null, resale_high: null })
  const brief = { destination_name: 'Pajak Melati', sections: { priority: [makeTarget('carhartt', 'Carhartt Detroit Jacket'), makeTarget('nike', 'Nike ACG Shell'), makeTarget('other', 'Levi’s Denim')] }, citations: [{ title: 'Carhartt evidence', url: 'https://carhartt.example/item' }, { title: 'Other', url: 'https://other.example/item' }] }
  const context = buildHunterChatContext({ brief, message: 'Kenapa Carhartt lebih cocok dari Nike ACG?', destination: 'Pajak Melati', categories: ['Jackets'], budgetIdr: 500000, marketGoal: 'international' })
  assert.ok(context.relevant_targets.length <= 3)
  assert.deepEqual(context.relevant_targets.map((target) => target.target_id), ['carhartt', 'nike'])
  assert.equal(JSON.stringify(context).includes('Levi'), false)
  assert.equal(context.relevant_targets[0].sources[0].url, 'https://carhartt.example/item')
})

test('cache confirmation is a zero-cost load decision and preflight responses never call the model', () => {
  const cacheHit = routeHunterInteraction({ action: 'confirm_research', cacheFresh: true, state: { destination: 'Pajak Sambu' } })
  assert.equal(cacheHit.type, 'LOAD_CACHE')
  assert.equal(['START_RESEARCH', 'AI_CHAT', 'ITEM_CHECK', 'REFRESH_RESEARCH'].includes(cacheHit.type), false)
  for (const decision of [decisionFor('Carousell'), decisionFor('500 ribu'), decisionFor('jaket'), decisionFor('luar negeri'), decisionFor('halo')]) {
    assert.ok(['PREFLIGHT_RESPONSE', 'PREFLIGHT_CLARIFY', 'LOCAL_FILTER'].includes(decision.type))
  }
})

test('photo checker still routes through ITEM_CHECK and keeps its no-search low reasoning contract', () => {
  assert.equal(routeHunterInteraction({ action: 'item_check' }).type, 'ITEM_CHECK')
  const request = createHunterItemCheckRequest({ imageDataUrls: ['data:image/jpeg;base64,AA=='], askingPriceIdr: 100000 })
  assert.deepEqual(request.reasoning, { effort: 'low' })
  assert.equal(request.tools, undefined)
})

test('refresh activity becomes visibly busy immediately and ignores duplicate submissions', () => {
  const idle = finishHunterActivity()
  const active = beginHunterActivity(idle, 'REFRESH_RESEARCH')
  assert.equal(isHunterActivityActive(active, 'REFRESH_RESEARCH'), true)
  assert.equal(hunterActivityLabel(active), 'Menyiapkan refresh riset…')
  assert.strictEqual(beginHunterActivity(active, 'REFRESH_RESEARCH'), active)
  assert.equal(hunterActivityLabel(advanceHunterActivity(active)), 'Mencari referensi pasar terbaru…')
  assert.equal(/\d+%/.test(hunterActivityLabel(active)), false)
})

test('successful and failed refresh outcomes both clear the busy state', () => {
  const active = beginHunterActivity(finishHunterActivity(), 'REFRESH_RESEARCH')
  assert.equal(isHunterActivityActive(finishHunterActivity(active), 'REFRESH_RESEARCH'), false)
  // Failure follows the same finally cleanup path as success; the error is kept separately by the UI.
  const failedActivity = finishHunterActivity(active)
  assert.equal(failedActivity.action, null)
  assert.equal(hunterActivityLabel(failedActivity), '')
})

test('destination research, chat and item check expose their own activity copy', () => {
  const research = beginHunterActivity(finishHunterActivity(), 'START_RESEARCH')
  assert.equal(hunterActivityLabel(research), 'Memeriksa cache riset…')
  const chat = beginHunterActivity(finishHunterActivity(), 'AI_CHAT')
  assert.equal(hunterActivityLabel(chat), 'Memeriksa konteks brief tersimpan…')
  const item = beginHunterActivity(finishHunterActivity(), 'ITEM_CHECK')
  assert.equal(hunterActivityLabel(item), 'Menyiapkan foto untuk dianalisis…')
  assert.equal(hunterActivityLabel(advanceHunterActivity(item)), 'Menganalisis foto barang…')
})

test('local preflight and filter actions never create paid-AI loading activity', () => {
  const idle = finishHunterActivity()
  for (const action of ['PREFLIGHT_RESPONSE', 'PREFLIGHT_CLARIFY', 'LOCAL_FILTER', 'LOCAL_SORT']) {
    const next = beginHunterActivity(idle, action)
    assert.equal(next.action, null, action)
    assert.equal(hunterActivityLabel(next), '', action)
  }
  const destination = routeHunterInteraction({ action: 'destination', value: 'Pajak Melati', state: preflightState })
  const budget = routeHunterInteraction({ action: 'budget', value: 300000, state: destination.state })
  const category = routeHunterInteraction({ action: 'category', value: ['Jackets'], state: budget.state })
  const market = routeHunterInteraction({ action: 'market', value: 'international', state: category.state })
  for (const step of [destination, budget, category, market]) {
    assert.ok(['PREFLIGHT_RESPONSE', 'LOCAL_FILTER'].includes(step.type))
    assert.equal(beginHunterActivity(idle, step.type).action, null)
  }
})


