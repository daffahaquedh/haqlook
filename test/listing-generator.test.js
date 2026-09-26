import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  LISTING_PROFILES,
  LISTING_ZERO_COST_ACTIONS,
  createListingGenerationBody,
  makeListingSavePayload,
  needsListingRegenerationConfirmation,
  normalizeListingResult,
  safeListingUrl,
  selectedListingProfiles,
} from '../src/listing-utils.js'
import {
  createListingGenerationRequest,
  createListingGenerationSchema,
  handleListingGeneration,
  normalizeGeneratedListing,
  parseListingGenerationResponse,
  selectedMarketplaces,
} from '../supabase/functions/seller-ai/listing-generation.ts'
import { DEFAULT_MODEL, estimateCostIdr, listingReservationCostIdr, maxListingOutputTokens } from '../supabase/functions/seller-ai/pricing.ts'

const item = {
  id: 'product-1', name: 'Work Jacket', brand: 'Stussy', category: 'Jackets', subcategory: 'Workwear',
  size_label: 'L', condition: 'Good', condition_notes: 'Light wear on cuff', defects: 'Small mark on left sleeve', status: 'available',
}

function generated(marketplaces = ['GRAILED']) {
  return Object.fromEntries(marketplaces.map((marketplace) => [marketplace.toLowerCase(), {
    title: 'Stussy Work Jacket Size L', description: 'A Stussy work jacket in good condition.', condition_summary: 'Good',
    size_display: 'L', measurements_text: '', tags: ['Stussy', 'work jacket'], warnings: [],
  }]))
}

function fakeSupabase({ product = item, reservation = { usage_id: 'usage-1', created: true }, reservationError = null } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      assert.equal(table, 'products')
      const query = { select() { return query }, eq() { return query }, async maybeSingle() { return { data: product, error: null } } }
      return query
    },
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === 'reserve_listing_ai_usage') return { data: reservation, error: reservationError }
      return { data: null, error: null }
    },
  }
}

async function withFetch(handler, callback) {
  const original = globalThis.fetch
  const requests = []
  globalThis.Deno = { env: { get: () => undefined } }
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) })
    return new Response(JSON.stringify(handler), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try { return await callback(requests) }
  finally { globalThis.fetch = original }
}

const completedPayload = (markets = ['GRAILED']) => ({
  status: 'completed', output_text: JSON.stringify(generated(markets)),
  usage: { input_tokens: 1250, input_tokens_details: { cached_tokens: 200 }, output_tokens: 410 },
})

test('only the four V1 marketplace profiles are selectable', () => {
  assert.deepEqual(LISTING_PROFILES.map((profile) => profile.marketplace), ['GRAILED', 'VESTIAIRE', 'CAROUSELL', 'PRELOVED'])
  assert.deepEqual(selectedMarketplaces(['GRAILED', 'FACEBOOK', 'PRELOVED']), ['GRAILED', 'PRELOVED'])
})

test('Grailed-only request builds only a Grailed result', () => {
  const request = createListingGenerationRequest({ item, marketplaces: ['GRAILED'] })
  assert.deepEqual(Object.keys(request.text.format.schema.properties), ['grailed'])
})

test('Vestiaire-only request builds only a Vestiaire result', () => {
  assert.deepEqual(Object.keys(createListingGenerationSchema(['VESTIAIRE']).properties), ['vestiaire'])
})

test('Carousell-only request builds only a Carousell result', () => {
  assert.deepEqual(Object.keys(createListingGenerationSchema(['CAROUSELL']).properties), ['carousell'])
})

test('Preloved-only request builds only a Preloved result', () => {
  assert.deepEqual(Object.keys(createListingGenerationSchema(['PRELOVED']).properties), ['preloved'])
})

test('all four marketplaces are produced by one strict response request', () => {
  const request = createListingGenerationRequest({ item, marketplaces: ['GRAILED', 'VESTIAIRE', 'CAROUSELL', 'PRELOVED'] })
  assert.equal(Object.keys(request.text.format.schema.properties).length, 4)
  assert.equal(request.text.format.name, 'marketplace_listing_drafts')
})

test('unselected marketplaces are not generated or accepted', () => {
  assert.deepEqual(selectedMarketplaces(['CAROUSELL']), ['CAROUSELL'])
  assert.throws(() => parseListingGenerationResponse({ status: 'completed', output_text: JSON.stringify(generated(['CAROUSELL', 'PRELOVED'])) }, item, ['CAROUSELL']), /unexpected marketplace/)
})

test('marketplace output schema is strict and has no undeclared fields', () => {
  const schema = createListingGenerationSchema(['GRAILED'])
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, ['grailed'])
  assert.equal(schema.properties.grailed.additionalProperties, false)
})

test('AI runtime remains GPT-6 Luna', () => {
  assert.equal(DEFAULT_MODEL, 'gpt-6-luna')
  assert.equal(createListingGenerationRequest({ item, marketplaces: ['GRAILED'] }).model, 'gpt-6-luna')
})

test('AI reasoning is explicitly low', () => {
  assert.deepEqual(createListingGenerationRequest({ item, marketplaces: ['GRAILED'] }).reasoning, { effort: 'low' })
})

test('Responses request has no tools or web_search', () => {
  const request = createListingGenerationRequest({ item, marketplaces: ['GRAILED'] })
  assert.equal(request.tools, undefined)
  assert.doesNotMatch(JSON.stringify(request), /web_search/)
})

test('Responses request omits unsupported sampling parameters', () => {
  const request = createListingGenerationRequest({ item, marketplaces: ['GRAILED'] })
  assert.equal(request.temperature, undefined)
  assert.equal(request.top_p, undefined)
})

test('missing inventory measurements are always left blank', () => {
  const result = normalizeGeneratedListing({ title: 'Jacket', description: 'Good jacket', measurements_text: 'Length 72 cm', size_display: 'XL' }, item, { language: 'English' })
  assert.equal(result.measurements_text, '')
  assert.equal(result.size_display, 'L')
})

test('unsupported measurements are removed from generated description', () => {
  const result = normalizeGeneratedListing({ title: 'Jacket', description: 'Length 72 cm. Good condition.', measurements_text: 'Length 72 cm' }, item, { language: 'English' })
  assert.doesNotMatch(result.description, /72\s*cm/i)
})

test('unsupported material claims are stripped', () => {
  const result = normalizeGeneratedListing({ title: 'Stussy jacket cotton', description: 'Made of cotton with good condition.' }, item, { language: 'English' })
  assert.doesNotMatch(`${result.title} ${result.description}`, /cotton/i)
})

test('authenticity assertions are removed from listing copy', () => {
  const result = normalizeGeneratedListing({ title: 'Authentic Stussy Jacket', description: 'This is genuine and authentic.' }, item, { language: 'English' })
  assert.doesNotMatch(`${result.title} ${result.description}`, /authentic|genuine/i)
})

test('unsupported rare, vintage and deadstock claims are removed', () => {
  const result = normalizeGeneratedListing({ title: 'Rare vintage deadstock Stussy grail', description: 'A rare archive piece, limited edition.' }, item, { language: 'English' })
  assert.doesNotMatch(`${result.title} ${result.description}`, /rare|vintage|deadstock|grail|archive|limited edition/i)
})

test('evidence-backed vintage wording can remain', () => {
  const vintageItem = { ...item, name: 'Vintage Work Jacket' }
  const result = normalizeGeneratedListing({ title: 'Vintage Stussy Work Jacket', description: 'Vintage Stussy work jacket.' }, vintageItem, { language: 'English' })
  assert.match(`${result.title} ${result.description}`, /vintage/i)
})

test('seller-provided defects are retained in draft description and summary', () => {
  const result = normalizeGeneratedListing({ title: 'Stussy jacket', description: 'Work jacket.', condition_summary: 'Excellent', warnings: [] }, item, { language: 'English' })
  assert.match(result.description, /Small mark on left sleeve/)
  assert.match(result.condition_summary, /Small mark on left sleeve/)
})

test('generated suggestions do not mutate master inventory', () => {
  const before = structuredClone(item)
  normalizeGeneratedListing({ title: 'New title', description: 'Copy' }, item, { language: 'English' })
  assert.deepEqual(item, before)
})

test('manual edit action has zero AI cost', () => assert.equal(LISTING_ZERO_COST_ACTIONS.edit, 0))
test('copy action has zero AI cost', () => assert.equal(LISTING_ZERO_COST_ACTIONS.copy, 0))
test('save draft action has zero AI cost', () => assert.equal(LISTING_ZERO_COST_ACTIONS.save, 0))
test('mark listed action has zero AI cost', () => assert.equal(LISTING_ZERO_COST_ACTIONS.status, 0))
test('listing URL update has zero AI cost', () => assert.equal(LISTING_ZERO_COST_ACTIONS.url, 0))
test('asking price edit has zero AI cost', () => assert.equal(LISTING_ZERO_COST_ACTIONS.askingPrice, 0))

test('regeneration requires an explicit confirmation after a draft exists', () => {
  assert.equal(needsListingRegenerationConfirmation(true, false), true)
  assert.equal(needsListingRegenerationConfirmation(true, true), false)
  assert.equal(needsListingRegenerationConfirmation(false, false), false)
})

test('save payload creates a draft and leaves missing asking price blank/zero, without AI', () => {
  const payload = makeListingSavePayload({ item, marketplace: 'GRAILED', draft: { title: 'Jacket' }, listingStatus: 'DRAFT', askingPrice: '' })
  assert.equal(payload.listing_status, 'DRAFT')
  assert.equal(payload.listed_price, 0)
  assert.equal(payload.listing_title, 'Jacket')
})

test('saving refreshed copy preserves an existing active listing and its safe URL', () => {
  const existing = { listing_status: 'LISTED', listing_url: 'https://grailed.com/listing/1', listed_at: '2026-01-01T00:00:00Z' }
  const payload = makeListingSavePayload({ item, marketplace: 'GRAILED', draft: { title: 'Edited copy' }, existing, listingStatus: 'DRAFT', listingUrl: existing.listing_url })
  assert.equal(payload.listing_status, 'LISTED')
  assert.equal(payload.listing_url, existing.listing_url)
  assert.equal(payload.listed_at, existing.listed_at)
})

test('safe listing URL validation accepts only HTTP and HTTPS', () => {
  assert.equal(safeListingUrl('https://example.com/item')?.startsWith('https://'), true)
  assert.equal(safeListingUrl('http://example.com/item')?.startsWith('http://'), true)
  assert.equal(safeListingUrl('javascript:alert(1)'), null)
  assert.equal(safeListingUrl('data:text/html,hello'), null)
})

test('sold inventory cannot receive a new saved marketplace listing', () => {
  assert.throws(() => makeListingSavePayload({ item: { ...item, status: 'sold' }, marketplace: 'GRAILED', draft: {} }), /Sold inventory/)
})

test('request body carries a request id for server idempotency', () => {
  const body = createListingGenerationBody(item.id, ['grailed'], '123e4567-e89b-42d3-a456-426614174000')
  assert.equal(body.feature, 'LISTING_GENERATION')
  assert.deepEqual(body.marketplaces, ['GRAILED'])
  assert.equal(body.request_id, '123e4567-e89b-42d3-a456-426614174000')
})

test('private contact and payment notes are omitted from the OpenAI product input', () => {
  const request = createListingGenerationRequest({ item: { ...item, condition_notes: 'buyer: person@example.com\nPhone +62 812 3456 7890\nlight wear' }, marketplaces: ['GRAILED'] })
  const text = request.input[0].content[0].text
  assert.doesNotMatch(text, /person@example.com|\+62 812 3456 7890|buyer:/i)
  assert.match(text, /light wear/)
})

test('price generation is excluded and output cannot retain an unsupported resale price', () => {
  const request = createListingGenerationRequest({ item, marketplaces: ['GRAILED'] })
  const result = normalizeGeneratedListing({ title: 'Work Jacket Rp2.000.000', description: 'Resale price Rp 3,000,000.' }, item, { language: 'English' })
  assert.doesNotMatch(request.input[0].content[0].text, /purchase_price|asking price|Rp/i)
  assert.doesNotMatch(`${result.title} ${result.description}`, /Rp\s*[\d.,]+/i)
})

test('all four marketplaces use exactly one OpenAI Responses call and finalize actual usage', async () => {
  const markets = ['GRAILED', 'VESTIAIRE', 'CAROUSELL', 'PRELOVED']
  const supabase = fakeSupabase()
  await withFetch(completedPayload(markets), async (requests) => {
    const response = await handleListingGeneration({ supabase, user: { id: 'seller-1' }, body: { product_id: item.id, marketplaces: markets, request_id: '123e4567-e89b-42d3-a456-426614174000' }, openAiKey: 'not-a-real-key', corsHeaders: {} })
    const data = await response.json()
    assert.equal(response.status, 200)
    assert.equal(requests.length, 1)
    assert.deepEqual(Object.keys(data.results), markets.map((market) => market.toLowerCase()))
    assert.deepEqual(supabase.calls.find((call) => call.name === 'finalize_ai_usage').args, { p_usage_id: 'usage-1', p_input_tokens: 1250, p_output_tokens: 410, p_estimated_cost: estimateCostIdr('gpt-6-luna', 1250, 410, 200) })
  })
})

test('server duplicate-request reservation stops before OpenAI', async () => {
  const supabase = fakeSupabase({ reservation: { usage_id: 'usage-existing', created: false } })
  await withFetch(completedPayload(), async (requests) => {
    const response = await handleListingGeneration({ supabase, user: { id: 'seller-1' }, body: { product_id: item.id, marketplaces: ['GRAILED'], request_id: '123e4567-e89b-42d3-a456-426614174000' }, openAiKey: 'test', corsHeaders: {} })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error, 'DUPLICATE_REQUEST')
    assert.equal(requests.length, 0)
  })
})

test('monthly budget guard blocks before OpenAI and exposes the controlled budget message', async () => {
  const supabase = fakeSupabase({ reservation: null, reservationError: { message: 'AI_BUDGET_EXCEEDED' } })
  await withFetch(completedPayload(), async (requests) => {
    const response = await handleListingGeneration({ supabase, user: { id: 'seller-1' }, body: { product_id: item.id, marketplaces: ['GRAILED'], request_id: '123e4567-e89b-42d3-a456-426614174000' }, openAiKey: 'test', corsHeaders: {} })
    assert.equal(response.status, 429)
    assert.equal((await response.json()).message, 'AI monthly budget reached')
    assert.equal(requests.length, 0)
  })
})

test('sold inventory is rejected before budget reservation or OpenAI', async () => {
  const supabase = fakeSupabase({ product: { ...item, status: 'sold' } })
  await withFetch(completedPayload(), async (requests) => {
    const response = await handleListingGeneration({ supabase, user: { id: 'seller-1' }, body: { product_id: item.id, marketplaces: ['GRAILED'], request_id: '123e4567-e89b-42d3-a456-426614174000' }, openAiKey: 'test', corsHeaders: {} })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error, 'PRODUCT_ALREADY_SOLD')
    assert.equal(supabase.calls.length, 0)
    assert.equal(requests.length, 0)
  })
})

test('both ADMIN and SELLER share the protected seller-ai authorization gate', async () => {
  const source = await readFile(new URL('../supabase/functions/seller-ai/index.ts', import.meta.url), 'utf8')
  assert.match(source, /\['ADMIN', 'SELLER'\]\.includes\(role\)/)
  assert.match(source, /if \(body\.feature === 'LISTING_GENERATION'\)/)
})

test('anonymous requests remain blocked before listing function dispatch', async () => {
  const source = await readFile(new URL('../supabase/functions/seller-ai/index.ts', import.meta.url), 'utf8')
  assert.match(source, /if \(!user\) return errorResponse\('AUTHENTICATION_REQUIRED'/)
  assert.ok(source.indexOf("if (!user)") < source.indexOf("if (body.feature === 'LISTING_GENERATION')"))
})

test('Hunter and Item Analysis branches remain in seller-ai', async () => {
  const source = await readFile(new URL('../supabase/functions/seller-ai/index.ts', import.meta.url), 'utf8')
  assert.match(source, /handleHunterRequest/)
  assert.match(source, /body\.feature !== 'ITEM_ANALYSIS'/)
  assert.match(source, /finalize_ai_usage/)
})

test('mobile listing sheet styles target narrow viewports without fixed desktop width overflow', async () => {
  const css = await readFile(new URL('../src/seller.css', import.meta.url), 'utf8')
  assert.match(css, /@media\s*\(max-width:\s*700px\)/)
  assert.match(css, /\.listing-generator-sheet\{[^}]*width:min\(760px,100%\)/)
  assert.match(css, /\.listing-generator-content\{[^}]*min-width:0/)
  assert.match(css, /safe-area-inset-bottom/)
  assert.match(css, /\.listing-copy-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
})

test('generator primary action is disabled while a request is in flight and AI calls use only seller-ai', async () => {
  const source = await readFile(new URL('../src/listing-generator.jsx', import.meta.url), 'utf8')
  assert.match(source, /disabled=\{busy \|\| !selected\.length/)
  assert.match(source, /functions\.invoke\('seller-ai'/)
  assert.doesNotMatch(source, /api\.openai\.com/)
})

test('listing reservation pricing is centralized and reserves its configured output ceiling', () => {
  globalThis.Deno = { env: { get: () => undefined } }
  assert.equal(maxListingOutputTokens(), 6000)
  assert.equal(listingReservationCostIdr('gpt-6-luna'), estimateCostIdr('gpt-6-luna', 20000, 6000))
})

test('production migration is additive, preserves legacy listing feature values and touches no inventory rows', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260926152609_listing_generator_v1.sql', import.meta.url), 'utf8')
  assert.match(sql, /add column if not exists listing_title/)
  assert.match(sql, /add column if not exists request_key/)
  assert.match(sql, /'LISTING_GENERATOR', 'LISTING_GENERATION'/)
  assert.doesNotMatch(sql, /drop\s+table|truncate\s+table|delete\s+from\s+public\.products|delete\s+from\s+public\.admins/i)
  assert.doesNotMatch(sql, /alter\s+table\s+public\.products\s+drop/i)
})

test('only authenticated staff can call the security-definer reservation function', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260926152609_listing_generator_v1.sql', import.meta.url), 'utf8')
  assert.match(sql, /if not public\.is_staff\(\) then raise exception 'STAFF_ACCESS_REQUIRED'/)
  assert.match(sql, /revoke all on function public\.reserve_listing_ai_usage\(uuid, text, numeric\) from public/)
  assert.match(sql, /grant execute on function public\.reserve_listing_ai_usage\(uuid, text, numeric\) to authenticated/)
})
