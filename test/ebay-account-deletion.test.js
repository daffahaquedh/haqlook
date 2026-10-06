import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandler, makeChallengeResponse, parseSpkiP256PublicKey, verifyEbaySignature } from '../supabase/functions/ebay-account-deletion/server.mjs'

const endpoint = 'https://akihuhhabslzhxyjxwoz.supabase.co/functions/v1/ebay-account-deletion'
const token = 'A'.repeat(32)
const appId = 'test-app-id'
const fixture = {
  signatureHeader: 'eyJhbGciOiJlY2RzYSIsImtpZCI6Ijk5MzYyNjFhLTdkN2ItNDYyMS1hMGYxLTk2Y2NiNDI4YWY0OSIsInNpZ25hdHVyZSI6Ik1FWUNJUUNmeGZJV3V4bVdjSUJRSjljNS9YN2lHREpxczJSQ0dzQkVhQWppbnlycmZBSWhBSVY2d0djVGlCdVY1S0pVaWYyaG9reXJMK1E5c3NIa2FkK214Mm5FRTI1dyIsImRpZ2VzdCI6IlNIQTEifQ==',
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

const officialHeader = JSON.parse(atob(fixture.signatureHeader))

function decodeBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function encodeBase64(value) {
  return btoa(String.fromCharCode(...value))
}

function pemForDer(value) {
  return `-----BEGIN PUBLIC KEY-----\n${encodeBase64(value)}\n-----END PUBLIC KEY-----`
}

function concatBytes(...arrays) {
  const result = new Uint8Array(arrays.reduce((length, bytes) => length + bytes.length, 0))
  let offset = 0
  for (const bytes of arrays) {
    result.set(bytes, offset)
    offset += bytes.length
  }
  return result
}

function hexBytes(hex) {
  return Uint8Array.from(hex.match(/.{2}/g) || [], (pair) => Number.parseInt(pair, 16))
}

function makeNobleCrypto({ results = [true], digestLength = 20, onVerify = () => {} } = {}) {
  const calls = { hashedMessages: [], verifications: [] }
  const nobleCrypto = {
    sha1(messageBytes) {
      calls.hashedMessages.push(messageBytes.slice())
      const digest = new Uint8Array(digestLength)
      for (let index = 0; index < digest.length; index += 1) digest[index] = messageBytes[index % messageBytes.length] || 0
      return digest
    },
    p256: {
      verify(signatureDer, digest, rawPublicKey, options) {
        const observed = {
          signatureDer: signatureDer.slice(),
          digest: digest.slice(),
          rawPublicKey: rawPublicKey.slice(),
          options: { ...options },
        }
        calls.verifications.push(observed)
        onVerify(observed)
        return results.length ? results.shift() : false
      },
    },
  }
  return { nobleCrypto, calls }
}

function makeHandler({
  secrets = { EBAY_DELETION_VERIFY_TOKEN: token, EBAY_CLIENT_SECRET: 'fixture-secret' },
  fetchImpl,
  log = () => {},
  nobleCrypto = makeNobleCrypto().nobleCrypto,
} = {}) {
  return createHandler({
    endpoint,
    appId,
    getSecret: (name) => secrets[name] || '',
    log,
    nobleCrypto,
    ...(fetchImpl ? { fetchImpl } : {}),
  })
}

function fetchWithPublicKey(publicKey) {
  return async (url) => url === 'https://api.ebay.com/identity/v1/oauth2/token'
    ? Response.json({ access_token: 'test-app-token', expires_in: 3600 })
    : Response.json({ key: publicKey, algorithm: 'ECDSA', digest: 'SHA1' })
}

test('GET challenge behavior remains unchanged', async () => {
  assert.equal(await makeChallengeResponse('abc', token, endpoint), '99e7f63434c80d38fa01f3dce7511916f132f4914a59b194348e95acf71e82e6')
  const response = await makeHandler()(new Request(`${endpoint}?challenge_code=abc`))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { challengeResponse: '99e7f63434c80d38fa01f3dce7511916f132f4914a59b194348e95acf71e82e6' })
})

test('GET rejects missing or overlong challenge and fails closed without its token', async () => {
  const handler = makeHandler()
  assert.equal((await handler(new Request(endpoint))).status, 400)
  assert.equal((await handler(new Request(`${endpoint}?challenge_code=${'x'.repeat(513)}`))).status, 400)
  assert.equal((await makeHandler({ secrets: {} })(new Request(`${endpoint}?challenge_code=abc`))).status, 503)
})

test('POST rejects missing and malformed x-ebay-signature before contacting eBay', async () => {
  const fetchImpl = async () => { throw new Error('must not fetch') }
  const handler = makeHandler({ fetchImpl })
  const body = JSON.stringify(fixture.message)
  const missing = await handler(new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body }))
  const malformed = await handler(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': 'not-base64' },
    body,
  }))
  assert.equal(missing.status, 412)
  assert.equal(malformed.status, 412)
})

test('OAuth failure diagnostics exclude provider descriptions, tokens, and webhook data', async () => {
  const events = []
  const fetchImpl = async () => Response.json({
    error: 'invalid_client',
    error_description: 'NEVER-LOG-DESCRIPTION',
    access_token: 'NEVER-LOG-TOKEN',
  }, { status: 401 })
  const response = await makeHandler({ fetchImpl, log: (stage, details) => events.push({ stage, ...details }) })(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': fixture.signatureHeader },
    body: JSON.stringify(fixture.message),
  }))
  assert.equal(response.status, 503)
  assert.ok(events.some((event) => event.stage === 'client_secret_present' && event.present === true))
  assert.ok(events.some((event) => event.stage === 'oauth_token_request_status' && event.status === 401))
  const diagnostics = JSON.stringify(events)
  for (const sensitive of ['fixture-secret', 'NEVER-LOG-DESCRIPTION', 'NEVER-LOG-TOKEN', fixture.signatureHeader, JSON.stringify(fixture.message), fixture.message.notification.data.username, fixture.message.notification.data.userId, fixture.message.notification.data.eiasToken]) {
    assert.equal(diagnostics.includes(sensitive), false)
  }
})

test('SPKI parser extracts the exact 65-byte uncompressed P-256 point', () => {
  const point = parseSpkiP256PublicKey(fixture.publicKey)
  assert.equal(point.length, 65)
  assert.equal(point[0], 0x04)
  assert.deepEqual(point, hexBytes('046618715cab51f933afb436e04cf0a44a87f4daa80107b22c60ec9fefa8a513127fba901afef2882a178ea02c8ea5c2e68b8b746f8b9ea5becb2e398cafdd0552'))
})

test('SPKI parser rejects a wrong curve OID, truncation, trailing bytes, and oversized DER', () => {
  const der = decodeBase64(fixture.publicKey.match(/-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/)[1])
  const wrongCurve = der.slice()
  wrongCurve[22] = 0x06
  assert.throws(() => parseSpkiP256PublicKey(pemForDer(wrongCurve)))
  assert.throws(() => parseSpkiP256PublicKey(pemForDer(der.subarray(0, der.length - 1))))
  assert.throws(() => parseSpkiP256PublicKey(pemForDer(concatBytes(der, new Uint8Array([0])))))
  assert.throws(() => parseSpkiP256PublicKey(pemForDer(new Uint8Array(513))))
})

test('Node pipeline passes original DER, SHA-1-sized digest, extracted point and exact noble options', () => {
  const signatureDer = decodeBase64(officialHeader.signature)
  let verification = null
  const { nobleCrypto, calls } = makeNobleCrypto({ onVerify: (call) => { verification = call } })
  const canonical = JSON.stringify(fixture.message)
  const result = verifyEbaySignature(
    fixture.message,
    officialHeader.signature,
    fixture.publicKey,
    new TextEncoder().encode(canonical),
    nobleCrypto,
  )
  assert.deepEqual(result, { mode: 'canonical', rawMatchesReserialized: true })
  assert.equal(calls.hashedMessages.length, 1)
  assert.equal(verification.signatureDer.length, signatureDer.length)
  assert.deepEqual(verification.signatureDer, signatureDer)
  assert.equal(verification.digest.length, 20)
  assert.deepEqual(verification.rawPublicKey, parseSpkiP256PublicKey(fixture.publicKey))
  assert.deepEqual(verification.options, { prehash: false, format: 'der', lowS: false })
})

test('handler acknowledges canonical official-fixture input and logs only safe stage fields', async () => {
  const events = []
  const response = await makeHandler({
    fetchImpl: fetchWithPublicKey(fixture.publicKey),
    log: (stage, details) => events.push({ stage, ...details }),
  })(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': fixture.signatureHeader },
    body: JSON.stringify(fixture.message),
  }))
  assert.equal(response.status, 204)
  assert.ok(events.some((event) => event.stage === 'signature_verified_canonical' && event.raw_matches_reserialized === true))
  const signatureStages = events.filter((event) => event.stage.startsWith('signature_')).map((event) => event.stage)
  assert.deepEqual(signatureStages, ['signature_verified_canonical'])
  const diagnostics = JSON.stringify(events)
  for (const sensitive of ['fixture-secret', 'test-app-token', fixture.signatureHeader, officialHeader.signature, fixture.publicKey, JSON.stringify(fixture.message), fixture.message.notification.data.username, fixture.message.notification.data.userId, fixture.message.notification.data.eiasToken]) {
    assert.equal(diagnostics.includes(sensitive), false)
  }
})

test('handler uses exact raw bytes only after canonical verification returns false', async () => {
  const events = []
  const rawBody = `\n ${JSON.stringify(fixture.message)} \n`
  const { nobleCrypto, calls } = makeNobleCrypto({ results: [false, true] })
  const signatureHeader = btoa(JSON.stringify({ ...officialHeader, kid: '6f9971b4-187b-4c67-9f60-49b910a6e741' }))
  const response = await makeHandler({
    fetchImpl: fetchWithPublicKey(fixture.publicKey),
    nobleCrypto,
    log: (stage, details) => events.push({ stage, ...details }),
  })(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': signatureHeader },
    body: rawBody,
  }))
  assert.equal(response.status, 204)
  assert.equal(calls.hashedMessages.length, 2)
  assert.deepEqual(calls.hashedMessages[0], new TextEncoder().encode(JSON.stringify(fixture.message)))
  assert.deepEqual(calls.hashedMessages[1], new TextEncoder().encode(rawBody))
  assert.ok(events.some((event) => event.stage === 'signature_verified_raw' && event.raw_matches_reserialized === false))
  assert.equal(events.some((event) => event.stage === 'signature_verified_canonical'), false)
  const diagnostics = JSON.stringify(events)
  for (const sensitive of [rawBody, signatureHeader, officialHeader.signature, fixture.publicKey, fixture.message.notification.data.username, fixture.message.notification.data.userId, fixture.message.notification.data.eiasToken]) {
    assert.equal(diagnostics.includes(sensitive), false)
  }
})

test('canonical and raw verification failure stays unacknowledged for tampered content', async () => {
  const events = []
  const rawBody = ` ${JSON.stringify(fixture.message)} `
  const { nobleCrypto, calls } = makeNobleCrypto({ results: [false, false] })
  const signatureHeader = btoa(JSON.stringify({ ...officialHeader, kid: '1a9b219f-1d52-4b22-8a0f-49b910a6e742' }))
  const response = await makeHandler({
    fetchImpl: fetchWithPublicKey(fixture.publicKey),
    nobleCrypto,
    log: (stage, details) => events.push({ stage, ...details }),
  })(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': signatureHeader },
    body: rawBody,
  }))
  assert.equal(response.status, 412)
  assert.equal(calls.hashedMessages.length, 2)
  assert.ok(events.some((event) => event.stage === 'signature_verify_failed' && event.raw_matches_reserialized === false))
  assert.equal(events.filter((event) => event.stage.startsWith('signature_')).length, 1)
})

test('tampered canonical payload fails without a raw retry when bytes are identical', async () => {
  const events = []
  const tampered = structuredClone(fixture.message)
  tampered.notification.data.userId = 'modified-user'
  const { nobleCrypto, calls } = makeNobleCrypto({ results: [false] })
  const response = await makeHandler({
    fetchImpl: fetchWithPublicKey(fixture.publicKey),
    nobleCrypto,
    log: (stage, details) => events.push({ stage, ...details }),
  })(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': fixture.signatureHeader },
    body: JSON.stringify(tampered),
  }))
  assert.equal(response.status, 412)
  assert.equal(calls.hashedMessages.length, 1)
  assert.ok(events.some((event) => event.stage === 'signature_verify_failed' && event.raw_matches_reserialized === true))
  assert.equal(JSON.stringify(events).includes('modified-user'), false)
})

test('wrong SHA-1 digest length throws and cannot acknowledge a notification', () => {
  const { nobleCrypto } = makeNobleCrypto({ digestLength: 19 })
  assert.throws(() => verifyEbaySignature(
    fixture.message,
    officialHeader.signature,
    fixture.publicKey,
    new TextEncoder().encode(JSON.stringify(fixture.message)),
    nobleCrypto,
  ))
})

test('verification exceptions expose only an allowlisted category, never details or payload', async () => {
  const events = []
  const nobleCrypto = {
    sha1: () => new Uint8Array(20),
    p256: { verify: () => { throw new TypeError('NEVER-LOG-CRYPTO-DETAIL') } },
  }
  const response = await makeHandler({
    fetchImpl: fetchWithPublicKey(fixture.publicKey),
    nobleCrypto,
    log: (stage, details) => events.push({ stage, ...details }),
  })(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': fixture.signatureHeader },
    body: JSON.stringify(fixture.message),
  }))
  assert.equal(response.status, 503)
  assert.ok(events.some((event) => event.stage === 'signature_verify_exception' && event.error_name === 'TypeError' && event.raw_matches_reserialized === true))
  const diagnostics = JSON.stringify(events)
  for (const sensitive of ['NEVER-LOG-CRYPTO-DETAIL', fixture.publicKey, fixture.signatureHeader, JSON.stringify(fixture.message), fixture.message.notification.data.username, fixture.message.notification.data.userId, fixture.message.notification.data.eiasToken]) {
    assert.equal(diagnostics.includes(sensitive), false)
  }
})

test('payload and public-key parse failures never return 204', async () => {
  const { nobleCrypto } = makeNobleCrypto({ results: [true] })
  const invalidPointDer = decodeBase64(fixture.publicKey.match(/-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/)[1])
  invalidPointDer[invalidPointDer.length - 65] = 0x02
  const invalidKey = pemForDer(invalidPointDer)
  const uniqueKidHeader = btoa(JSON.stringify({ ...officialHeader, kid: '00000000-0000-0000-0000-000000000001' }))
  const response = await makeHandler({ fetchImpl: fetchWithPublicKey(invalidKey), nobleCrypto })(new Request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ebay-signature': uniqueKidHeader },
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

test('production imports pinned Noble and never uses native ECDSA verification or DER conversion', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../supabase/functions/ebay-account-deletion/server.mjs', import.meta.url), 'utf8')
  const entrypoint = await readFile(new URL('../supabase/functions/ebay-account-deletion/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /node:crypto|createVerify|crypto\.subtle\.(?:verify|importKey)|P1363/)
  assert.match(source, /signatureDer,/)
  assert.match(source, /format: 'der'/)
  assert.match(source, /lowS: false/)
  assert.match(source, /prehash: false/)
  assert.match(entrypoint, /npm:@noble\/curves@2\.4\.0\/nist\.js/)
  assert.match(entrypoint, /npm:@noble\/hashes@2\.4\.0\/legacy\.js/)
  assert.match(entrypoint, /nobleCrypto: \{ p256, sha1 \}/)
  assert.match(entrypoint, /Deno\.serve\(createHandler/)
})
