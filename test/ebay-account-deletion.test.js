import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandler, makeChallengeResponse } from '../supabase/functions/ebay-account-deletion/server.mjs'

const endpoint = 'https://akihuhhabslzhxyjxwoz.supabase.co/functions/v1/ebay-account-deletion'
const token = 'A'.repeat(32)
const appId = 'test-app-id'
const fixture = {
  signature: 'eyJhbGciOiJlY2RzYSIsImtpZCI6Ijk5MzYyNjFhLTdkN2ItNDYyMS1hMGYxLTk2Y2NiNDI4YWY0OSIsInNpZ25hdHVyZSI6Ik1FWUNJUUNmeGZJV3V4bVdjSUJRSjljNS9YN2lHREpxczJSQ0dzQkVhQWppbnlycmZBSWhBSVY2d0djVGlCdVY1S0pVaWYyaG9reXJMK1E5c3NIa2FkK214Mm5FRTI1dyIsImRpZ2VzdCI6IlNIQTEifQ==',
  message: {
    metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION', schemaVersion: '1.0', deprecated: false },
    notification: {
      notificationId: '49feeaeb-4982-42d9-a377-9645b8479411_33f7e043-fed8-442b-9d44-791923bd9a6d',
      eventDate: '2021-03-19T20:43:59.462Z',
      publishDate: '2021-03-19T20:43:59.679Z',
      publishAttemptCount: 1,
      data: { username: 'test_user', userId: 'ma8vp1jySJC', eiasToken: 'nY+sHZ2PrBmdj6wVnY+sEZ2PrA2dj6wJnY+gAZGEpwmdj6x9nY+seQ==' },
    },
  },
  publicKey: '-----BEGIN PUBLIC KEY-----MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZhhxXKtR+TOvtDbgTPCkSof02qgBB7IsYOyf76ilExJ/upAa/vKIKheOoCyOpcLmi4t0b4uepb7LLjmMr90FUg==-----END PUBLIC KEY-----',
}

function makeHandler({ secrets = { EBAY_DELETION_VERIFY_TOKEN: token, EBAY_CLIENT_SECRET: 'fixture-secret' }, fetchImpl, log = () => {} } = {}) {
  return createHandler({ endpoint, appId, getSecret: (name) => secrets[name] || '', log, ...(fetchImpl ? { fetchImpl } : {}) })
}

test('challenge response hashes challenge + token + exact endpoint in order', async () => {
  assert.equal(
    await makeChallengeResponse('abc', token, endpoint),
    '99e7f63434c80d38fa01f3dce7511916f132f4914a59b194348e95acf71e82e6',
  )
})

test('GET challenge returns JSON with the eBay-required content type', async () => {
  const response = await makeHandler()(new Request(`${endpoint}?challenge_code=abc`))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^application\/json/)
  assert.deepEqual(await response.json(), { challengeResponse: '99e7f63434c80d38fa01f3dce7511916f132f4914a59b194348e95acf71e82e6' })
})

test('GET rejects missing or overlong challenge_code', async () => {
  const handler = makeHandler()
  assert.equal((await handler(new Request(endpoint))).status, 400)
  assert.equal((await handler(new Request(`${endpoint}?challenge_code=${'x'.repeat(513)}`))).status, 400)
})

test('GET fails closed if verification token is missing or invalid', async () => {
  const noToken = makeHandler({ secrets: {} })
  assert.equal((await noToken(new Request(`${endpoint}?challenge_code=abc`))).status, 503)
  const invalidToken = makeHandler({ secrets: { EBAY_DELETION_VERIFY_TOKEN: 'invalid' } })
  assert.equal((await invalidToken(new Request(`${endpoint}?challenge_code=abc`))).status, 503)
})

test('POST rejects unsupported content type, malformed JSON, and invalid payload shape', async () => {
  const handler = makeHandler()
  assert.equal((await handler(new Request(endpoint, { method: 'POST', body: '{}' }))).status, 415)
  assert.equal((await handler(new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status, 400)
  assert.equal((await handler(new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).status, 400)
})

test('POST rejects missing or malformed eBay signature without contacting eBay', async () => {
  const fetchImpl = async () => { throw new Error('must not fetch') }
  const handler = makeHandler({ fetchImpl })
  const response = await handler(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture.message),
  }))
  assert.equal(response.status, 412)
})

test('POST safely diagnoses a rejected Production-token-shaped OAuth response', async () => {
  const events = []
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://api.ebay.com/identity/v1/oauth2/token')
    assert.equal(init.method, 'POST')
    assert.equal(init.body, 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope')
    return Response.json({ error: 'invalid_client', error_description: 'NEVER-LOG-DESCRIPTION', access_token: 'NEVER-LOG-TOKEN' }, { status: 401 })
  }
  const response = await makeHandler({ fetchImpl, log: (stage, details) => events.push({ stage, ...details }) })(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': fixture.signature },
    body: JSON.stringify(fixture.message),
  }))
  assert.equal(response.status, 503)
  assert.ok(events.some((event) => event.stage === 'client_secret_present' && event.present === true))
  assert.ok(events.some((event) => event.stage === 'oauth_token_request_status' && event.status === 401))
  assert.ok(events.some((event) => event.stage === 'oauth_token_failed' && event.status === 401 && event.error_code === 'invalid_client'))
  const diagnostics = JSON.stringify(events)
  for (const sensitive of ['fixture-secret', 'NEVER-LOG-DESCRIPTION', 'NEVER-LOG-TOKEN', fixture.signature, fixture.message.notification.data.userId, fixture.message.notification.data.eiasToken]) {
    assert.equal(diagnostics.includes(sensitive), false)
  }
})

test('POST validates the official eBay signed notification fixture and acknowledges without mutation', async () => {
  let oauthCalls = 0
  let keyCalls = 0
  const events = []
  const fetchImpl = async (url, init) => {
    if (url === 'https://api.ebay.com/identity/v1/oauth2/token') {
      oauthCalls += 1
      assert.equal(init.method, 'POST')
      assert.match(init.headers.Authorization, /^Basic /)
      return Response.json({ access_token: 'test-app-token', expires_in: 3600 })
    }
    assert.equal(url, 'https://api.ebay.com/commerce/notification/v1/public_key/9936261a-7d7b-4621-a0f1-96ccb428af49')
    keyCalls += 1
    assert.equal(init.headers.Authorization, 'Bearer test-app-token')
    return Response.json({ key: fixture.publicKey, algorithm: 'ECDSA', digest: 'SHA1' })
  }
  const response = await makeHandler({ fetchImpl, log: (stage, details) => events.push({ stage, ...details }) })(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': fixture.signature },
    body: JSON.stringify(fixture.message),
  }))
  assert.equal(response.status, 204)
  assert.equal(await response.text(), '')
  assert.equal(oauthCalls, 1)
  assert.equal(keyCalls, 1)
  assert.ok(events.some((event) => event.stage === 'client_secret_present' && event.present === true))
  assert.ok(events.some((event) => event.stage === 'oauth_token_request_status' && event.status === 200))
  assert.ok(events.some((event) => event.stage === 'public_key_request_status' && event.status === 200))
  assert.ok(events.some((event) => event.stage === 'signature_verified'))
  const diagnostics = JSON.stringify(events)
  for (const sensitive of ['fixture-secret', 'test-app-token', fixture.signature, fixture.message.notification.data.userId, fixture.message.notification.data.eiasToken]) {
    assert.equal(diagnostics.includes(sensitive), false)
  }
})

test('POST safely diagnoses public-key lookup failure without logging provider response data', async () => {
  const events = []
  const fetchImpl = async (url) => url === 'https://api.ebay.com/identity/v1/oauth2/token'
    ? Response.json({ access_token: 'test-app-token', expires_in: 3600 })
    : Response.json({ error: 'access_denied', detail: 'NEVER-LOG-DETAIL', key: 'NEVER-LOG-KEY' }, { status: 403 })
  const header = JSON.parse(atob(fixture.signature))
  header.kid = 'a936261a-7d7b-4621-a0f1-96ccb428af49'
  const uniqueSignatureHeader = btoa(JSON.stringify(header))
  const response = await makeHandler({ fetchImpl, log: (stage, details) => events.push({ stage, ...details }) })(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': uniqueSignatureHeader },
    body: JSON.stringify(fixture.message),
  }))
  assert.equal(response.status, 503)
  assert.ok(events.some((event) => event.stage === 'public_key_request_status' && event.status === 403))
  assert.ok(events.some((event) => event.stage === 'public_key_failed' && event.status === 403 && event.error_code === 'access_denied'))
  const diagnostics = JSON.stringify(events)
  for (const sensitive of ['fixture-secret', 'test-app-token', 'NEVER-LOG-DETAIL', 'NEVER-LOG-KEY', uniqueSignatureHeader, fixture.message.notification.data.userId, fixture.message.notification.data.eiasToken]) {
    assert.equal(diagnostics.includes(sensitive), false)
  }
})

test('POST rejects a tampered signed payload', async () => {
  const fetchImpl = async (url) => url === 'https://api.ebay.com/identity/v1/oauth2/token'
    ? Response.json({ access_token: 'test-app-token', expires_in: 3600 })
    : Response.json({ key: fixture.publicKey, algorithm: 'ECDSA', digest: 'SHA1' })
  const tampered = structuredClone(fixture.message)
  tampered.notification.data.userId = 'modified-user'
  const response = await makeHandler({ fetchImpl })(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': fixture.signature },
    body: JSON.stringify(tampered),
  }))
  assert.equal(response.status, 412)
})

test('POST fails closed when server credentials are unavailable', async () => {
  const handler = makeHandler({ secrets: { EBAY_DELETION_VERIFY_TOKEN: token } })
  const response = await handler(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': fixture.signature },
    body: JSON.stringify(fixture.message),
  }))
  assert.equal(response.status, 503)
})

test('only the eBay deletion function disables JWT verification', async () => {
  const { readFile } = await import('node:fs/promises')
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8')
  assert.match(config, /\[functions\.seller-ai\]\s+verify_jwt\s*=\s*true/)
  assert.match(config, /\[functions\.ebay-account-deletion\]\s+verify_jwt\s*=\s*false/)
  const sellerSection = config.match(/\[functions\.seller-ai\]([^\[]*)/)?.[1] || ''
  assert.doesNotMatch(sellerSection, /verify_jwt\s*=\s*false/)
})

test('secrets are read from the server environment and are not hard-coded', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../supabase/functions/ebay-account-deletion/index.ts', import.meta.url), 'utf8')
  assert.match(source, /Deno\.env\.get\(name\)/)
  assert.doesNotMatch(source, /EBAY_DELETION_VERIFY_TOKEN\s*=|EBAY_CLIENT_SECRET\s*=|OPENAI_API_KEY\s*=/)
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/)
})

