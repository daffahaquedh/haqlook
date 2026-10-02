import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { boundHaqAiContext, isHaqAiGreeting, jakartaMonthRange, routeHaqAiContext } from '../supabase/functions/seller-ai/haq-ai-context.js'
import { createHaqAiChatRequest } from '../supabase/functions/seller-ai/hunter-analysis.ts'
import { huntingPathForTab, huntingTabForPath, SELLER_MOBILE_PRIMARY_LINKS, SELLER_WORKSPACE_GROUPS } from '../src/seller-utils.js'

const [sellerSource, chatSource, chatStyles, handlerSource, analysisSource] = await Promise.all([
  readFile(new URL('../src/seller.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/haq-ai.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/haq-ai.css', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/seller-ai/hunter-handler.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/seller-ai/hunter-analysis.ts', import.meta.url), 'utf8'),
])

test('seller navigation labels the old Hunter destination HAQ AI without changing its URL', () => {
  assert.ok(SELLER_MOBILE_PRIMARY_LINKS.some(([, label]) => label === 'HAQ AI'))
  assert.ok(SELLER_WORKSPACE_GROUPS[0].links.some(([href, label]) => href === '/seller/ai-hunter' && label === 'HAQ AI'))
  assert.equal(huntingTabForPath('/seller/ai-hunter'), 'chat')
  assert.equal(huntingPathForTab('chat'), '/seller/ai-hunter')
  assert.match(sellerSource, /section === 'ai-hunter' \|\| section === 'sourcing'/)
})

test('a greeting is handled locally with no data-context intent', () => {
  for (const text of ['Halo', 'hai HAQLOOKS!', 'Assalamualaikum']) assert.equal(isHaqAiGreeting(text), true)
  assert.equal(routeHaqAiContext('Halo').type, 'none')
  assert.equal(routeHaqAiContext('Apa yang bisa kamu bantu untuk HAQLOOKS?').type, 'none')
  const chatHandler = handlerSource.slice(handlerSource.indexOf('export async function handleHunterRequest'))
  assert.ok(chatHandler.indexOf('isHaqAiGreeting(input.body.message)') < chatHandler.indexOf('getOrCreateSession(input.supabase'))
})

test('deterministic routing selects only the requested narrow context', () => {
  assert.deepEqual(routeHaqAiContext('Cek SKU HL-0012'), { type: 'product', sku: 'HL-0012' })
  assert.deepEqual(routeHaqAiContext('Barang apa yang paling lama belum laku?'), { type: 'oldest_available' })
  assert.deepEqual(routeHaqAiContext('Berapa profit bulan ini?'), { type: 'monthly_sales' })
  assert.deepEqual(routeHaqAiContext('Cek listing yang masih aktif'), { type: 'active_listings' })
  assert.deepEqual(routeHaqAiContext('Apa status Temuan saya?'), { type: 'saved_finds' })
  assert.deepEqual(routeHaqAiContext('Analisis toko saya'), { type: 'store_summary' })
  assert.equal(routeHaqAiContext('Bantu listing').type, 'none')
})

test('month aggregation uses Jakarta calendar boundaries', () => {
  assert.deepEqual(jakartaMonthRange(new Date('2026-12-31T20:00:00Z')), {
    start: '2027-01-01T00:00:00+07:00',
    end: '2027-02-01T00:00:00+07:00',
  })
})

test('bounded context caps row counts and serialized context size', () => {
  const bounded = boundHaqAiContext({ type: 'demo', rows: Array.from({ length: 30 }, (_, i) => ({ name: 'x'.repeat(500), index: i })) })
  assert.ok(bounded.rows.length <= 8)
  assert.ok(JSON.stringify(bounded).length <= 6000)
})

test('normal HAQ AI chat uses gpt-6-luna low reasoning and never enables web search', () => {
  const request = createHaqAiChatRequest({
    message: 'Apa status listing bulan ini?',
    context: { type: 'active_listings', results: [] },
    conversation: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) })),
  })
  assert.equal(request.model, 'gpt-6-luna')
  assert.deepEqual(request.reasoning, { effort: 'low' })
  assert.equal(request.tools, undefined)
  assert.equal(request.tool_choice, undefined)
  assert.equal(request.temperature, undefined)
  assert.equal(request.input.filter((item) => item.role !== 'system').length, 7)
  assert.match(JSON.stringify(request.input), /COMPACT INTERNAL CONTEXT/)
  assert.match(analysisSource, /research_suggestion/)
})

test('greeting and local chat do not call seller-ai from the browser', () => {
  assert.match(chatSource, /if \(isHaqAiGreeting\(text\)\)/)
  assert.ok(chatSource.indexOf('if (isHaqAiGreeting(text))') < chatSource.indexOf('await invokeHaqAi'))
  assert.match(chatSource, /feature: 'HUNTER_CHAT'/)
  assert.match(chatSource, /assistant_mode: 'haq_ai_v1'/)
})

test('context reads use only allowlisted columns and bounded result sets, never select star', () => {
  const contextHandler = handlerSource.slice(handlerSource.indexOf('async function loadHaqAiContext'), handlerSource.indexOf('async function handleHaqAiChat'))
  assert.doesNotMatch(contextHandler, /\.select\(['"]\*['"]\)/)
  assert.match(contextHandler, /\.eq\('sku', route\.sku\)/)
  assert.match(contextHandler, /\.limit\(1\)/)
  assert.match(contextHandler, /\.limit\(5\)/)
  assert.match(contextHandler, /\.limit\(5\)/)
  assert.match(contextHandler, /\.limit\(8\)/)
  assert.match(contextHandler, /\.limit\(6\)/)
  assert.match(contextHandler, /\.limit\(2000\)/)
  assert.match(contextHandler, /gross_profit_idr/)
})

test('context queries use the authenticated staff client and do not mutate business records', () => {
  const contextHandler = handlerSource.slice(handlerSource.indexOf('async function loadHaqAiContext'), handlerSource.indexOf('async function handleHaqAiChat'))
  assert.match(contextHandler, /client\.from\('products'\)/)
  assert.match(contextHandler, /client\.from\('sales'\)/)
  assert.match(contextHandler, /client\.from\('marketplace_listings'\)/)
  assert.match(contextHandler, /client\.from\('sourcing_candidates'\)/)
  assert.doesNotMatch(contextHandler, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
  assert.match(handlerSource, /!\['ADMIN', 'SELLER'\]\.includes\(String\(input\.role\)\.toUpperCase\(\)\)/)
})

test('explicit research prompt is a separate navigation action; existing confirmation and cache logic remain', () => {
  assert.match(chatSource, /<button type="button" onClick=\{onStartResearch\}>Mulai Research<\/button>/)
  assert.match(sellerSource, /onStartResearch=\{\(\) => go\('\/seller\/ai-hunter\/research'\)\}/)
  assert.match(sellerSource, /href="\/seller\/ai-hunter\/research"/)
  assert.match(handlerSource, /input\.body\.research_confirmed === true/)
  assert.match(handlerSource, /shouldReadHunterCache\(feature\)/)
})

test('chat retains safe touch targets, mobile safe-area spacing, Enter and multiline behavior', () => {
  assert.match(chatSource, /event\.key === 'Enter' && !event\.shiftKey/)
  assert.match(chatSource, /Shift\+Enter untuk baris baru/)
  assert.match(chatStyles, /env\(safe-area-inset-bottom\)/)
  assert.match(chatStyles, /min-height:48px/)
  assert.match(chatStyles, /overflow-wrap:anywhere/)
  assert.match(chatStyles, /grid-template-columns:minmax\(0,1fr\) 78px/)
})

test('AI usage remains on the existing server-side accounting lifecycle', () => {
  assert.match(handlerSource, /reserveUsage\(input\.accounting, input\.user\.id, feature, DEFAULT_MODEL, 'low'/)
  assert.match(handlerSource, /finalizeUsage\(input\.accounting, input\.user\.id, usageId, feature, payload/)
  assert.match(handlerSource, /releaseUsage\(input\.accounting, input\.user\.id, usageId\)/)
  assert.match(handlerSource, /web_search: false/)
})
