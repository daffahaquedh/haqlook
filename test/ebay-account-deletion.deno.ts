import { derEcdsaToP1363, verifyEbaySignature } from '../supabase/functions/ebay-account-deletion/server.mjs'

const eBayFixture = {
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

function concatBytes(...arrays: Uint8Array[]) {
  const result = new Uint8Array(arrays.reduce((length, bytes) => length + bytes.length, 0))
  let offset = 0
  for (const bytes of arrays) {
    result.set(bytes, offset)
    offset += bytes.length
  }
  return result
}

function p1363ToDer(signature: Uint8Array) {
  const integer = (bytes: Uint8Array) => {
    let value = bytes
    while (value.length > 1 && value[0] === 0) value = value.subarray(1)
    if (value[0] & 0x80) value = concatBytes(new Uint8Array([0]), value)
    return concatBytes(new Uint8Array([0x02, value.length]), value)
  }
  const content = concatBytes(integer(signature.subarray(0, 32)), integer(signature.subarray(32, 64)))
  return concatBytes(new Uint8Array([0x30, content.length]), content)
}

function encodeBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

function pemFromSpki(bytes: Uint8Array) {
  return `-----BEGIN PUBLIC KEY-----\n${encodeBase64(bytes)}\n-----END PUBLIC KEY-----`
}

function signatureFromHeader() {
  return JSON.parse(atob(eBayFixture.signatureHeader)).signature as string
}

Deno.test('official eBay fixture verifies with native Deno WebCrypto SHA-1 ECDSA', async () => {
  const canonical = JSON.stringify(eBayFixture.message)
  const result = await verifyEbaySignature(
    eBayFixture.message,
    signatureFromHeader(),
    eBayFixture.publicKey,
    new TextEncoder().encode(canonical),
  )
  if (result.mode !== 'canonical' || !result.rawMatchesReserialized) {
    throw new Error('Official fixture did not verify canonically')
  }
})

Deno.test('DER to P1363 handles leading-zero r and s and always returns 64 bytes', () => {
  const r = new Uint8Array(33)
  const s = new Uint8Array(33)
  r[1] = 0x80
  s[1] = 0x91
  for (let index = 2; index < 33; index += 1) {
    r[index] = index
    s[index] = 0xff - index
  }
  const rDer = concatBytes(new Uint8Array([0x02, r.length]), r)
  const sDer = concatBytes(new Uint8Array([0x02, s.length]), s)
  const content = concatBytes(rDer, sDer)
  const p1363 = derEcdsaToP1363(concatBytes(new Uint8Array([0x30, content.length]), content))
  if (p1363.byteLength !== 64 || p1363[0] !== 0x80 || p1363[32] !== 0x91) {
    throw new Error('DER integers were not normalized to fixed-width P1363')
  }
  for (let index = 2; index < 33; index += 1) {
    if (p1363[index - 1] !== r[index] || p1363[index + 31] !== s[index]) {
      throw new Error('DER integer bytes were not preserved')
    }
  }
})

Deno.test('tampered eBay payload is rejected by WebCrypto', async () => {
  const tampered = structuredClone(eBayFixture.message)
  tampered.notification.data.userId = 'modified-user'
  const raw = JSON.stringify(tampered)
  const result = await verifyEbaySignature(
    tampered,
    signatureFromHeader(),
    eBayFixture.publicKey,
    new TextEncoder().encode(raw),
  )
  if (result.mode !== null || !result.rawMatchesReserialized) {
    throw new Error('Tampered payload was accepted')
  }
})

Deno.test('native WebCrypto SHA-1 ECDSA verifies exact whitespace-different raw body', async () => {
  const rawBody = `\n ${JSON.stringify(eBayFixture.message)} \n`
  const rawBytes = new TextEncoder().encode(rawBody)
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const p1363 = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-1' },
    pair.privateKey,
    rawBytes,
  ))
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const result = await verifyEbaySignature(
    eBayFixture.message,
    encodeBase64(p1363ToDer(p1363)),
    pemFromSpki(spki),
    rawBytes,
  )
  if (result.mode !== 'raw' || result.rawMatchesReserialized) {
    throw new Error('Whitespace-different raw body was not verified through the raw path')
  }
})

Deno.test('malformed DER signature is rejected before acknowledgement', async () => {
  let rejected = false
  try {
    await verifyEbaySignature(
      eBayFixture.message,
      btoa('not-der'),
      eBayFixture.publicKey,
      new TextEncoder().encode(JSON.stringify(eBayFixture.message)),
    )
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('Malformed DER signature was accepted')
})

