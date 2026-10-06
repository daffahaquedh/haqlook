import { p256 } from 'npm:@noble/curves@2.4.0/nist.js'
import { sha1 } from 'npm:@noble/hashes@2.4.0/legacy.js'
import { parseSpkiP256PublicKey, verifyEbaySignature } from '../supabase/functions/ebay-account-deletion/server.mjs'

const nobleCrypto = { p256, sha1 }
const officialFixture = {
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

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function encodeBase64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
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

function pemForDer(der: Uint8Array) {
  return `-----BEGIN PUBLIC KEY-----\n${encodeBase64(der)}\n-----END PUBLIC KEY-----`
}

function signatureFromHeader() {
  return JSON.parse(atob(officialFixture.signatureHeader)).signature as string
}

function readDerIntegers(signatureDer: Uint8Array) {
  let offset = 0
  if (signatureDer[offset++] !== 0x30) throw new Error('Bad signature fixture')
  const sequenceLength = signatureDer[offset++]
  if (offset + sequenceLength !== signatureDer.length) throw new Error('Bad signature fixture')
  const readInteger = () => {
    if (signatureDer[offset++] !== 0x02) throw new Error('Bad signature fixture')
    const length = signatureDer[offset++]
    const bytes = signatureDer.subarray(offset, offset + length)
    offset += length
    return BigInt(`0x${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`)
  }
  const r = readInteger()
  const s = readInteger()
  if (offset !== signatureDer.length) throw new Error('Bad signature fixture')
  return { r, s }
}

function bigIntBytes(value: bigint) {
  let hex = value.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  let bytes = Uint8Array.from(hex.match(/.{2}/g) || [], (pair) => Number.parseInt(pair, 16))
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1)
  if (bytes[0] & 0x80) bytes = concatBytes(new Uint8Array([0]), bytes)
  return bytes
}

function derFromIntegers(r: bigint, s: bigint) {
  const integer = (value: bigint) => {
    const bytes = bigIntBytes(value)
    return concatBytes(new Uint8Array([0x02, bytes.length]), bytes)
  }
  const content = concatBytes(integer(r), integer(s))
  return concatBytes(new Uint8Array([0x30, content.length]), content)
}

Deno.test('official eBay signed fixture verifies canonically with pinned Noble SHA-1/P-256', () => {
  const canonical = JSON.stringify(officialFixture.message)
  const result = verifyEbaySignature(
    officialFixture.message,
    signatureFromHeader(),
    officialFixture.publicKey,
    new TextEncoder().encode(canonical),
    nobleCrypto,
  )
  if (result.mode !== 'canonical' || !result.rawMatchesReserialized) {
    throw new Error('Official eBay fixture failed canonical verification')
  }
})

Deno.test('Noble SHA-1 digest is the expected 20 bytes', () => {
  const digest = sha1(new TextEncoder().encode('abc'))
  const hex = Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (digest.length !== 20 || hex !== 'a9993e364706816aba3e25717850c26c9cd0d89d') {
    throw new Error('Pinned Noble SHA-1 returned an unexpected digest')
  }
})

Deno.test('SPKI parser extracts the correct 65-byte uncompressed P-256 point', () => {
  const point = parseSpkiP256PublicKey(officialFixture.publicKey)
  const expectedHex = '046618715cab51f933afb436e04cf0a44a87f4daa80107b22c60ec9fefa8a513127fba901afef2882a178ea02c8ea5c2e68b8b746f8b9ea5becb2e398cafdd0552'
  const actualHex = Array.from(point).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (point.length !== 65 || point[0] !== 0x04 || actualHex !== expectedHex) {
    throw new Error('SPKI public point was not extracted exactly')
  }
})

Deno.test('SPKI parser rejects wrong curve OID, truncation, trailing data, and non-uncompressed points', () => {
  const encodedKey = officialFixture.publicKey.match(/-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/)?.[1]
  if (!encodedKey) throw new Error('Missing test SPKI')
  const spki = decodeBase64(encodedKey)
  const wrongCurve = spki.slice()
  wrongCurve[22] = 0x06
  const truncated = spki.subarray(0, spki.length - 1)
  const trailing = concatBytes(spki, new Uint8Array([0]))
  const badPoint = spki.slice()
  badPoint[26] = 0x02
  for (const invalid of [wrongCurve, truncated, trailing, badPoint, new Uint8Array(513)]) {
    let rejected = false
    try {
      parseSpkiP256PublicKey(pemForDer(invalid))
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Malformed SPKI key was accepted')
  }
})

Deno.test('Noble rejects an uncompressed SPKI point that is not a valid P-256 curve point', () => {
  const encodedKey = officialFixture.publicKey.match(/-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/)?.[1]
  if (!encodedKey) throw new Error('Missing test SPKI')
  const invalidPointSpki = decodeBase64(encodedKey)
  invalidPointSpki.fill(0, invalidPointSpki.length - 64)
  const canonical = JSON.stringify(officialFixture.message)
  let verified = false
  try {
    verified = verifyEbaySignature(
      officialFixture.message,
      signatureFromHeader(),
      pemForDer(invalidPointSpki),
      new TextEncoder().encode(canonical),
      nobleCrypto,
    ).mode === 'canonical'
  } catch {
    // Noble may reject an invalid curve point by throwing; either outcome is fail-closed.
  }
  if (verified) throw new Error('An invalid P-256 point verified a notification')
})

Deno.test('original DER signature reaches Noble unchanged with lowS disabled', () => {
  const signatureDer = decodeBase64(signatureFromHeader())
  let observedSignature: Uint8Array | undefined
  let observedOptions: Record<string, unknown> | undefined
  const instrumented = {
    sha1,
    p256: {
      verify(signature: Uint8Array, digest: Uint8Array, key: Uint8Array, options: Record<string, unknown>) {
        observedSignature = signature.slice()
        observedOptions = { ...options }
        return p256.verify(signature, digest, key, options)
      },
    },
  }
  const result = verifyEbaySignature(
    officialFixture.message,
    signatureFromHeader(),
    officialFixture.publicKey,
    new TextEncoder().encode(JSON.stringify(officialFixture.message)),
    instrumented,
  )
  if (result.mode !== 'canonical' || !observedSignature || observedSignature.length !== signatureDer.length) {
    throw new Error('Noble did not receive the original DER signature')
  }
  for (let index = 0; index < signatureDer.length; index += 1) {
    if (observedSignature[index] !== signatureDer[index]) throw new Error('DER signature bytes were changed')
  }
  if (JSON.stringify(observedOptions) !== JSON.stringify({ prehash: false, format: 'der', lowS: false })) {
    throw new Error('Unexpected Noble verification options')
  }
})

Deno.test('high-S valid fixture signature is accepted with lowS disabled', () => {
  const { r, s } = readDerIntegers(decodeBase64(signatureFromHeader()))
  const curveOrder = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')
  const highS = s > curveOrder / 2n ? s : curveOrder - s
  if (highS <= curveOrder / 2n) throw new Error('Test signature could not be made high-S')
  const highSignature = derFromIntegers(r, highS)
  const result = verifyEbaySignature(
    officialFixture.message,
    encodeBase64(highSignature),
    officialFixture.publicKey,
    new TextEncoder().encode(JSON.stringify(officialFixture.message)),
    nobleCrypto,
  )
  if (result.mode !== 'canonical') throw new Error('Valid high-S signature was rejected')
})

Deno.test('tampered canonical payload is rejected without acknowledging', () => {
  const tampered = structuredClone(officialFixture.message)
  tampered.notification.data.userId = 'modified-user'
  const raw = JSON.stringify(tampered)
  const result = verifyEbaySignature(tampered, signatureFromHeader(), officialFixture.publicKey, new TextEncoder().encode(raw), nobleCrypto)
  if (result.mode !== null || !result.rawMatchesReserialized) throw new Error('Tampered payload was accepted')
})

Deno.test('whitespace-different body falls back to exact raw bytes and verifies', async () => {
  const rawBody = `\n ${JSON.stringify(officialFixture.message)} \n`
  const rawBytes = new TextEncoder().encode(rawBody)
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const p1363 = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-1' }, pair.privateKey, rawBytes))
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const signatureDer = derFromIntegers(
    BigInt(`0x${Array.from(p1363.subarray(0, 32)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`),
    BigInt(`0x${Array.from(p1363.subarray(32)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`),
  )
  const result = verifyEbaySignature(
    officialFixture.message,
    encodeBase64(signatureDer),
    pemForDer(spki),
    rawBytes,
    nobleCrypto,
  )
  if (result.mode !== 'raw' || result.rawMatchesReserialized) throw new Error('Raw-body fallback did not verify')
})

Deno.test('tampered whitespace-different body fails canonical and raw verification', async () => {
  const originalRaw = ` ${JSON.stringify(officialFixture.message)} `
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const originalBytes = new TextEncoder().encode(originalRaw)
  const p1363 = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-1' }, pair.privateKey, originalBytes))
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const signatureDer = derFromIntegers(
    BigInt(`0x${Array.from(p1363.subarray(0, 32)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`),
    BigInt(`0x${Array.from(p1363.subarray(32)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`),
  )
  const tampered = structuredClone(officialFixture.message)
  tampered.notification.data.userId = 'changed-after-signing'
  const tamperedRaw = ` ${JSON.stringify(tampered)} `
  const result = verifyEbaySignature(
    tampered,
    encodeBase64(signatureDer),
    pemForDer(spki),
    new TextEncoder().encode(tamperedRaw),
    nobleCrypto,
  )
  if (result.mode !== null || result.rawMatchesReserialized) throw new Error('Tampered raw fallback was accepted')
})

Deno.test('malformed Base64 and DER signatures fail closed', () => {
  const raw = new TextEncoder().encode(JSON.stringify(officialFixture.message))
  const malformedDer = [
    new Uint8Array([0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]),
    new Uint8Array([0x30, 0x06, 0x02, 0x02, 0x01, 0x02, 0x01, 0x01]),
    new Uint8Array([0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01]),
    new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x80, 0x02, 0x01, 0x01]),
    concatBytes(decodeBase64(signatureFromHeader()), new Uint8Array([0x00])),
  ]
  for (const signature of ['%%%not-base64%%%', ...malformedDer.map(encodeBase64)]) {
    let rejected = false
    try {
      verifyEbaySignature(officialFixture.message, signature, officialFixture.publicKey, raw, nobleCrypto)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Malformed signature was accepted')
  }
})
