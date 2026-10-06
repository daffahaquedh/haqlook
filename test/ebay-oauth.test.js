import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import {
  EBAY_APP_ID,
  EBAY_OAUTH_SCOPES,
  EBAY_RUNAME,
  HAQLOOKS_PRIVACY_URL,
  HAQLOOKS_SETTINGS_URL,
  createEbayOAuthHandler,
  hashOAuthState,
  makeAuthorizationUrl,
} from '../supabase/functions/ebay-oauth-callback/server.mjs'

const TEST_ORIGIN = 'https://haqlooks.my.id'
const FIXED_NOW = new Date('2026-10-06T12:00:00.000Z')

function createStore(overrides = {}) {
  const calls = { deletedBefore: [], inserted: [], consumed: [], saved: [], status: 0 }
  const store = {
    async deleteExpiredStates(before) { calls.deletedBefore.push(before) },
    async insertState(stateHash, expiresAt) { calls.inserted.push({ stateHash, expiresAt }) },
    async consumeState(stateHash, at) { calls.consumed.push({ stateHash, at }); return true },
    async getConnectionStatus() { calls.status += 1; return null },
    async saveCredentials(value) { calls.saved.push(value) },
    ...overrides,
  }
  return { store, calls }
}

function createHandler(options = {}) {
  const { store, calls } = createStore(options.storeOverrides)
  const logs = []
  const handler = createEbayOAuthHandler({
    authenticateAdmin: options.authenticateAdmin || (async () => ({ ok: true })),
    store,
    getSecret: options.getSecret || (() => 'test-client-secret-never-log'),
    fetchImpl: options.fetchImpl || fetch,
    cryptoImpl: webcrypto,
    now: () => FIXED_NOW,
    logEvent: options.logEvent || ((...values) => logs.push(values)),
  })
  return { handler, store, calls, logs }
}

function post(action, origin = TEST_ORIGIN) {
  return new Request('https://akihuhhabslzhxyjxwoz.supabase.co/functions/v1/ebay-oauth-callback', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
}

test('authorization URL uses the current eBay Production RuName and selected scopes only', () => {
  const state = 'a'.repeat(64)
  const url = new URL(makeAuthorizationUrl(state))
  assert.equal(url.origin, 'https://auth.ebay.com')
  assert.equal(url.pathname, '/oauth2/authorize')
  assert.equal(url.searchParams.get('client_id'), EBAY_APP_ID)
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('redirect_uri'), EBAY_RUNAME)
  assert.equal(url.searchParams.get('state'), state)
  assert.deepEqual(url.searchParams.get('scope').split(' '), [...EBAY_OAUTH_SCOPES])
  assert.equal(EBAY_OAUTH_SCOPES.length, 35)
  assert.equal(HAQLOOKS_PRIVACY_URL, 'https://haqlooks.my.id/privacy')
  assert.equal(HAQLOOKS_SETTINGS_URL, 'https://haqlooks.my.id/seller/marketplace-settings')
  assert.doesNotMatch(url.toString(), /client_secret|refresh_token|access_token/i)
})

test('start creates a short-lived state hash and returns an authorization URL to ADMIN only', async () => {
  const { handler, calls } = createHandler()
  const response = await handler(post('start'))
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  const authorizationUrl = new URL(payload.authorization_url)
  const state = authorizationUrl.searchParams.get('state')
  assert.match(state, /^[a-f0-9]{64}$/)
  assert.equal(calls.inserted.length, 1)
  assert.equal(calls.inserted[0].stateHash, await hashOAuthState(state, webcrypto))
  assert.notEqual(calls.inserted[0].stateHash, state)
  assert.equal(calls.inserted[0].expiresAt, '2026-10-06T12:10:00.000Z')
  assert.deepEqual(calls.deletedBefore, ['2026-10-06T12:00:00.000Z'])
  assert.match(response.headers.get('cache-control'), /no-store/)
})

test('start and status fail closed for missing authentication and non-admin roles', async () => {
  const missing = createHandler({ authenticateAdmin: async () => ({ status: 401 }) })
  const missingResponse = await missing.handler(post('start'))
  assert.equal(missingResponse.status, 401)
  assert.equal(missing.calls.inserted.length, 0)

  const seller = createHandler({ authenticateAdmin: async () => ({ status: 403 }) })
  const sellerResponse = await seller.handler(post('status'))
  assert.equal(sellerResponse.status, 403)
  assert.equal(seller.calls.status, 0)
})

test('status returns connection metadata only and never returns stored refresh-token material', async () => {
  const secretValue = 'test-refresh-token-never-return'
  const { handler } = createHandler({
    storeOverrides: {
      async getConnectionStatus() {
        return { connected_at: '2026-10-06T11:00:00.000Z', refresh_token_expires_at: '2028-01-01T00:00:00.000Z', refresh_token: secretValue }
      },
    },
  })
  const response = await handler(post('status'))
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.connected, true)
  assert.equal(payload.connected_at, '2026-10-06T11:00:00.000Z')
  assert.equal(payload.refresh_token_expires_at, '2028-01-01T00:00:00.000Z')
  assert.doesNotMatch(JSON.stringify(payload), /test-refresh-token-never-return/)
})

test('GET without OAuth parameters redirects to a clean HAQLOOKS URL and does not read secrets', async () => {
  const { handler, calls } = createHandler({
    getSecret() { throw new Error('must not read a secret on malformed callback') },
    fetchImpl: async () => { throw new Error('must not contact eBay') },
  })
  const response = await handler(new Request('https://function.example/callback'))
  const destination = new URL(response.headers.get('location'))
  assert.equal(response.status, 303)
  assert.equal(destination.origin, 'https://haqlooks.my.id')
  assert.equal(destination.pathname, '/seller/marketplace-settings')
  assert.equal(destination.searchParams.get('ebay'), 'error')
  assert.equal(destination.searchParams.get('reason'), 'invalid_callback')
  assert.equal(destination.searchParams.has('code'), false)
  assert.equal(destination.searchParams.has('state'), false)
  assert.equal(calls.consumed.length, 0)
})

test('callback rejects invalid, expired, or replayed state before exchanging a code', async () => {
  let exchanges = 0
  const { handler } = createHandler({
    storeOverrides: { async consumeState() { return false } },
    fetchImpl: async () => { exchanges += 1; return new Response('{}') },
  })
  const state = 'b'.repeat(64)
  const response = await handler(new Request('https://function.example/callback?code=one-time-code&state=' + state))
  const destination = new URL(response.headers.get('location'))
  assert.equal(response.status, 303)
  assert.equal(destination.searchParams.get('reason'), 'invalid_state')
  assert.equal(destination.searchParams.has('code'), false)
  assert.equal(destination.searchParams.has('state'), false)
  assert.equal(exchanges, 0)
})

test('callback rejects duplicate code or state parameters rather than choosing an ambiguous value', async () => {
  let exchanges = 0
  const { handler } = createHandler({
    fetchImpl: async () => { exchanges += 1; return Response.json({ refresh_token: 'unused' }) },
  })
  const state = 'e'.repeat(64)
  const response = await handler(new Request('https://function.example/callback?code=one&code=two&state=' + state))
  const destination = new URL(response.headers.get('location'))
  assert.equal(response.status, 303)
  assert.equal(destination.searchParams.get('reason'), 'invalid_callback')
  assert.equal(destination.searchParams.has('code'), false)
  assert.equal(destination.searchParams.has('state'), false)
  assert.equal(exchanges, 0)
})

test('valid callback exchanges code server-side, stores only refresh token, and redirects without credentials', async () => {
  const state = 'c'.repeat(64)
  const stored = []
  const logged = []
  let requestSeen
  const { handler } = createHandler({
    storeOverrides: {
      async consumeState(hash, at) { return hash === await hashOAuthState(state, webcrypto) && at === FIXED_NOW.toISOString() },
      async saveCredentials(value) { stored.push(value) },
    },
    fetchImpl: async (url, options) => {
      requestSeen = { url, options }
      return Response.json({
        access_token: 'synthetic-access-token-never-log',
        expires_in: 7200,
        refresh_token: 'synthetic-refresh-token-server-only',
        refresh_token_expires_in: 86400,
      })
    },
    logEvent: (...values) => logged.push(values),
  })
  const code = 'synthetic-authorization-code'
  const query = new URLSearchParams({ code, state })
  const response = await handler(new Request('https://function.example/callback?' + query.toString()))
  const destination = new URL(response.headers.get('location'))

  assert.equal(response.status, 303)
  assert.equal(requestSeen.url, 'https://api.ebay.com/identity/v1/oauth2/token')
  assert.equal(requestSeen.options.method, 'POST')
  const form = new URLSearchParams(requestSeen.options.body)
  assert.equal(form.get('grant_type'), 'authorization_code')
  assert.equal(form.get('code'), code)
  assert.equal(form.get('redirect_uri'), EBAY_RUNAME)
  assert.match(requestSeen.options.headers.Authorization, /^Basic /)
  assert.equal(stored.length, 1)
  assert.deepEqual(Object.keys(stored[0]).sort(), ['connected_at', 'refresh_token', 'refresh_token_expires_at'])
  assert.equal(stored[0].refresh_token, 'synthetic-refresh-token-server-only')
  assert.equal(stored[0].refresh_token_expires_at, '2026-10-07T12:00:00.000Z')
  assert.equal(destination.searchParams.get('ebay'), 'connected')
  for (const sensitive of [code, state, 'synthetic-access-token-never-log', 'synthetic-refresh-token-server-only']) {
    assert.equal(destination.href.includes(sensitive), false)
    assert.equal((await response.text()).includes(sensitive), false)
  }
  assert.deepEqual(logged, [])
})

test('provider failures log only a safe stage and numeric HTTP status', async () => {
  const state = 'd'.repeat(64)
  const logs = []
  const { handler } = createHandler({
    fetchImpl: async () => new Response(JSON.stringify({
      error: 'synthetic-provider-error',
      access_token: 'synthetic-access-token-never-log',
      refresh_token: 'synthetic-refresh-token-never-log',
    }), { status: 503 }),
    logEvent: (...values) => logs.push(values),
  })
  const response = await handler(new Request('https://function.example/callback?code=synthetic-code&state=' + state))
  const destination = new URL(response.headers.get('location'))
  assert.equal(response.status, 303)
  assert.equal(destination.searchParams.get('reason'), 'provider_error')
  assert.deepEqual(logs, [['oauth_token_request_failed', 503]])
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-provider-error|synthetic-access-token-never-log|synthetic-refresh-token-never-log|synthetic-code/i)
  assert.equal(destination.searchParams.has('code'), false)
  assert.equal(destination.searchParams.has('state'), false)
})

test('browser actions reject unapproved origins and oversized or invalid requests', async () => {
  const { handler, calls } = createHandler()
  assert.equal((await handler(post('start', 'https://evil.example'))).status, 403)
  assert.equal(calls.inserted.length, 0)
  const oversized = new Request('https://function.example/callback', {
    method: 'POST',
    headers: { Origin: TEST_ORIGIN, 'Content-Type': 'application/json', 'Content-Length': '5000' },
    body: JSON.stringify({ action: 'start' }),
  })
  assert.equal((await handler(oversized)).status, 400)
  const invalid = await handler(post('unknown'))
  assert.equal(invalid.status, 400)
})

test('authorization URL builder rejects malformed state', () => {
  assert.throws(() => makeAuthorizationUrl('bad-state'), /Invalid OAuth state/)
})
