const MAX_BODY_BYTES = 64 * 1024
const EBAY_OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_PUBLIC_KEY_URL = 'https://api.ebay.com/commerce/notification/v1/public_key/'
const MAX_PUBLIC_KEY_DER_BYTES = 512
const PUBLIC_KEY_TTL_MS = 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8_000
const SAFE_CRYPTO_ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'NotSupportedError', 'OperationError', 'DataError'])

const keyCache = new Map()
let appTokenCache = null

export async function makeChallengeResponse(challengeCode, verificationToken, endpoint) {
  const bytes = new TextEncoder().encode(`${challengeCode}${verificationToken}${endpoint}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

function readSignatureHeader(raw) {
  if (!raw || raw.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null
  try {
    const decoded = atob(raw)
    const header = JSON.parse(decoded)
    if (!header || typeof header !== 'object' || Array.isArray(header)) return null
    if (header.alg !== 'ecdsa' || header.digest !== 'SHA1') return null
    if (typeof header.kid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(header.kid)) return null
    if (typeof header.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(header.signature)) return null
    return header
  } catch {
    return null
  }
}

function decodeBase64(value, maxBytes = MAX_PUBLIC_KEY_DER_BYTES) {
  if (typeof value !== 'string' || !value || value.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Invalid base64 data')
  }
  if (value.includes('=') && value.length % 4 !== 0) throw new Error('Invalid base64 data')
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=')
  const binary = atob(padded)
  if (binary.length > maxBytes || btoa(binary).replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new Error('Invalid base64 data')
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function readDerElement(bytes, cursor, parentEnd) {
  if (cursor.offset + 2 > parentEnd) throw new Error('Invalid SubjectPublicKeyInfo')
  const tag = bytes[cursor.offset++]
  const firstLength = bytes[cursor.offset++]
  let length = firstLength
  if (firstLength >= 0x80) {
    const octetCount = firstLength & 0x7f
    if (octetCount === 0 || octetCount > 2 || cursor.offset + octetCount > parentEnd) {
      throw new Error('Invalid SubjectPublicKeyInfo')
    }
    if (bytes[cursor.offset] === 0) throw new Error('Invalid SubjectPublicKeyInfo')
    length = 0
    for (let index = 0; index < octetCount; index += 1) {
      length = (length * 256) + bytes[cursor.offset++]
    }
    if (length < 0x80) throw new Error('Invalid SubjectPublicKeyInfo')
  }
  if (length > MAX_PUBLIC_KEY_DER_BYTES) throw new Error('Invalid SubjectPublicKeyInfo')
  const contentStart = cursor.offset
  const end = contentStart + length
  if (end > parentEnd) throw new Error('Invalid SubjectPublicKeyInfo')
  cursor.offset = end
  return { tag, contentStart, end }
}

const OID_EC_PUBLIC_KEY = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
const OID_PRIME256V1 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07])

function equalBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function validateEcdsaDerSignature(signatureDer) {
  // A P-256 ECDSA signature is a DER SEQUENCE of exactly two canonical
  // positive INTEGERs. Validate encoding here, but leave all curve arithmetic
  // and signature verification to the pinned Noble implementation.
  if (!(signatureDer instanceof Uint8Array) || signatureDer.length < 8 || signatureDer.length > 72) {
    throw new Error('Invalid ECDSA signature DER')
  }
  if (signatureDer[0] !== 0x30 || signatureDer[1] >= 0x80 || signatureDer[1] !== signatureDer.length - 2) {
    throw new Error('Invalid ECDSA signature DER')
  }

  let offset = 2
  for (let integerIndex = 0; integerIndex < 2; integerIndex += 1) {
    if (signatureDer[offset] !== 0x02) throw new Error('Invalid ECDSA signature DER')
    offset += 1
    const length = signatureDer[offset]
    offset += 1
    if (!length || length > 33 || offset + length > signatureDer.length) {
      throw new Error('Invalid ECDSA signature DER')
    }
    const first = signatureDer[offset]
    if ((first & 0x80) !== 0) throw new Error('Invalid ECDSA signature DER')
    if (length > 1 && first === 0 && (signatureDer[offset + 1] & 0x80) === 0) {
      throw new Error('Invalid ECDSA signature DER')
    }
    offset += length
  }
  if (offset !== signatureDer.length) throw new Error('Invalid ECDSA signature DER')
}

export function parseSpkiP256PublicKey(publicKeyPem) {
  if (typeof publicKeyPem !== 'string') throw new Error('Invalid SubjectPublicKeyInfo')
  const match = /^\s*-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----\s*$/.exec(publicKeyPem)
  if (!match) throw new Error('Invalid SubjectPublicKeyInfo')
  const encoded = match[1].replace(/\s/g, '')
  const der = decodeBase64(encoded, MAX_PUBLIC_KEY_DER_BYTES)
  if (der.length === 0 || der.length > MAX_PUBLIC_KEY_DER_BYTES) throw new Error('Invalid SubjectPublicKeyInfo')

  const outerCursor = { offset: 0 }
  const outer = readDerElement(der, outerCursor, der.length)
  if (outer.tag !== 0x30 || outer.end !== der.length) throw new Error('Invalid SubjectPublicKeyInfo')

  const spkiCursor = { offset: outer.contentStart }
  const algorithm = readDerElement(der, spkiCursor, outer.end)
  if (algorithm.tag !== 0x30) throw new Error('Invalid SubjectPublicKeyInfo')
  const algorithmCursor = { offset: algorithm.contentStart }
  const publicKeyOid = readDerElement(der, algorithmCursor, algorithm.end)
  const curveOid = readDerElement(der, algorithmCursor, algorithm.end)
  if (
    publicKeyOid.tag !== 0x06 ||
    !equalBytes(der.subarray(publicKeyOid.contentStart, publicKeyOid.end), OID_EC_PUBLIC_KEY) ||
    curveOid.tag !== 0x06 ||
    !equalBytes(der.subarray(curveOid.contentStart, curveOid.end), OID_PRIME256V1) ||
    algorithmCursor.offset !== algorithm.end
  ) {
    throw new Error('Unsupported SubjectPublicKeyInfo algorithm')
  }

  const bitString = readDerElement(der, spkiCursor, outer.end)
  if (bitString.tag !== 0x03 || bitString.end !== outer.end) throw new Error('Invalid SubjectPublicKeyInfo')
  const bitStringBytes = der.subarray(bitString.contentStart, bitString.end)
  if (bitStringBytes.length !== 66 || bitStringBytes[0] !== 0 || bitStringBytes[1] !== 0x04) {
    throw new Error('Invalid P-256 public point')
  }
  if (spkiCursor.offset !== outer.end) throw new Error('Invalid SubjectPublicKeyInfo')
  return bitStringBytes.slice(1)
}

export function verifyEbaySignature(
  payload,
  signatureBase64,
  publicKey,
  rawBodyBytes,
  nobleCrypto,
) {
  if (!(rawBodyBytes instanceof Uint8Array)) throw new TypeError('Raw request bytes unavailable')
  if (!nobleCrypto || typeof nobleCrypto.sha1 !== 'function' || typeof nobleCrypto.p256?.verify !== 'function') {
    throw new TypeError('Noble crypto unavailable')
  }

  const canonicalBytes = new TextEncoder().encode(JSON.stringify(payload))
  const rawMatchesReserialized = equalBytes(rawBodyBytes, canonicalBytes)
  const signatureDer = decodeBase64(signatureBase64, 72)
  validateEcdsaDerSignature(signatureDer)
  const rawPublicKey = parseSpkiP256PublicKey(publicKey)
  const verifyBytes = (messageBytes) => {
    const digest = nobleCrypto.sha1(messageBytes)
    if (!(digest instanceof Uint8Array) || digest.length !== 20) throw new Error('Invalid SHA-1 digest')
    return nobleCrypto.p256.verify(
      signatureDer,
      digest,
      rawPublicKey,
      { prehash: false, format: 'der', lowS: false },
    )
  }

  const canonicalValid = verifyBytes(canonicalBytes)
  if (canonicalValid) return { mode: 'canonical', rawMatchesReserialized }

  if (!rawMatchesReserialized) {
    const rawValid = verifyBytes(rawBodyBytes)
    if (rawValid) return { mode: 'raw', rawMatchesReserialized }
  }

  return { mode: null, rawMatchesReserialized }
}

async function fetchJsonResponse(fetchImpl, url, init) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal })
    let data = null
    try {
      data = await response.json()
    } catch {
      // Keep malformed or non-JSON provider responses out of diagnostics.
    }
    return { status: response.status, ok: response.ok, data }
  } catch {
    return { status: null, ok: false, data: null }
  } finally {
    clearTimeout(timeout)
  }
}

function safeErrorCode(data) {
  const code = data && typeof data.error === 'string' ? data.error : ''
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : undefined
}

function diagnostic(log, stage, details = {}) {
  try {
    log(stage, details)
  } catch {
    // Diagnostics must never change callback behavior.
  }
}

function safeCryptoErrorDetails(error) {
  const details = {}
  const name = error && typeof error === 'object' && typeof error.name === 'string' ? error.name : ''
  if (SAFE_CRYPTO_ERROR_NAMES.has(name)) details.error_name = name
  return details
}

async function getApplicationToken({ appId, clientSecret, fetchImpl, now, log }) {
  if (appTokenCache && appTokenCache.expiresAt > now() + 30_000) {
    diagnostic(log, 'oauth_token_cache_hit')
    return appTokenCache.value
  }

  const credentials = btoa(`${appId}:${clientSecret}`)
  const response = await fetchJsonResponse(fetchImpl, EBAY_OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  })
  if (response.status !== null) diagnostic(log, 'oauth_token_request_status', { status: response.status })
  const result = response.data
  if (!response.ok || !result || typeof result.access_token !== 'string' || !result.access_token || !Number.isFinite(Number(result.expires_in))) {
    const errorCode = safeErrorCode(result)
    diagnostic(log, 'oauth_token_failed', {
      ...(response.status === null ? {} : { status: response.status }),
      ...(errorCode ? { error_code: errorCode } : {}),
    })
    return null
  }

  appTokenCache = {
    value: result.access_token,
    expiresAt: now() + Math.max(60, Number(result.expires_in) - 60) * 1000,
  }
  diagnostic(log, 'oauth_token_succeeded', { status: response.status })
  return appTokenCache.value
}

async function getPublicKey({ kid, appId, clientSecret, fetchImpl, now, log }) {
  const cached = keyCache.get(kid)
  if (cached && cached.expiresAt > now()) {
    diagnostic(log, 'public_key_cache_hit')
    return cached.value
  }

  const accessToken = await getApplicationToken({ appId, clientSecret, fetchImpl, now, log })
  if (!accessToken) return null
  const response = await fetchJsonResponse(fetchImpl, `${EBAY_PUBLIC_KEY_URL}${encodeURIComponent(kid)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  })
  if (response.status !== null) diagnostic(log, 'public_key_request_status', { status: response.status })
  const result = response.data
  if (!response.ok || !result || typeof result.key !== 'string' || !result.key.includes('BEGIN PUBLIC KEY') || result.algorithm !== 'ECDSA' || result.digest !== 'SHA1') {
    const errorCode = safeErrorCode(result)
    diagnostic(log, 'public_key_failed', {
      ...(response.status === null ? {} : { status: response.status }),
      ...(errorCode ? { error_code: errorCode } : {}),
    })
    return null
  }

  keyCache.set(kid, { value: result.key, expiresAt: now() + PUBLIC_KEY_TTL_MS })
  if (keyCache.size > 100) keyCache.delete(keyCache.keys().next().value)
  diagnostic(log, 'public_key_succeeded', { status: response.status })
  return result.key
}

function validDeletionPayload(payload) {
  const metadata = payload?.metadata
  const notification = payload?.notification
  const data = notification?.data
  return Boolean(
    metadata && metadata.topic === 'MARKETPLACE_ACCOUNT_DELETION' &&
    typeof metadata.schemaVersion === 'string' && typeof metadata.deprecated === 'boolean' &&
    notification && typeof notification.notificationId === 'string' && notification.notificationId.length <= 256 &&
    typeof notification.eventDate === 'string' && Number.isFinite(Date.parse(notification.eventDate)) &&
    typeof notification.publishDate === 'string' && Number.isFinite(Date.parse(notification.publishDate)) &&
    Number.isInteger(notification.publishAttemptCount) && notification.publishAttemptCount >= 1 &&
    data && typeof data.username === 'string' && data.username.length <= 256 &&
    typeof data.userId === 'string' && data.userId.length > 0 && data.userId.length <= 256 &&
    typeof data.eiasToken === 'string' && data.eiasToken.length > 0 && data.eiasToken.length <= 4096
  )
}

async function readLimitedBody(request) {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null
  if (!request.body) return null

  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const rawBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return { rawBody, rawBodyBytes: bytes }
}

export function createHandler({
  endpoint,
  appId,
  getSecret,
  fetchImpl = fetch,
  now = Date.now,
  log = (stage, details) => console.info(JSON.stringify({ component: 'ebay-account-deletion', stage, ...details })),
  nobleCrypto,
}) {
  return async function handle(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: 'GET, POST, OPTIONS' } })

    if (request.method === 'GET') {
      const challengeCode = new URL(request.url).searchParams.get('challenge_code')
      if (!challengeCode || challengeCode.length > 512) return json({ error: 'invalid_challenge' }, 400)

      const verificationToken = getSecret('EBAY_DELETION_VERIFY_TOKEN')
      if (!verificationToken || !/^[A-Za-z0-9_-]{32,80}$/.test(verificationToken)) {
        return json({ error: 'endpoint_not_configured' }, 503)
      }
      return json({ challengeResponse: await makeChallengeResponse(challengeCode, verificationToken, endpoint) }, 200)
    }

    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, POST, OPTIONS' })
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return json({ error: 'unsupported_media_type' }, 415)

    let body
    try {
      body = await readLimitedBody(request)
    } catch {
      return json({ error: 'invalid_payload' }, 400)
    }
    if (body === null) return json({ error: 'payload_too_large_or_empty' }, 413)

    const { rawBody, rawBodyBytes } = body
    let payload
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return json({ error: 'invalid_payload' }, 400)
    }
    if (!validDeletionPayload(payload)) return json({ error: 'invalid_notification' }, 400)

    const signature = readSignatureHeader(request.headers.get('x-ebay-signature'))
    if (!signature) return json({ error: 'invalid_signature' }, 412)

    let clientSecret = ''
    try {
      clientSecret = getSecret('EBAY_CLIENT_SECRET')
    } catch {
      // Treat secret-store access failure as unavailable without logging details.
    }
    diagnostic(log, 'client_secret_present', { present: Boolean(clientSecret) })
    if (!appId || !clientSecret) return json({ error: 'signature_verification_unavailable' }, 503)
    const publicKey = await getPublicKey({ kid: signature.kid, appId, clientSecret, fetchImpl, now, log })
    if (!publicKey) return json({ error: 'signature_verification_unavailable' }, 503)

    const rawMatchesReserialized = equalBytes(
      rawBodyBytes,
      new TextEncoder().encode(JSON.stringify(payload)),
    )
    let verification
    try {
      verification = await verifyEbaySignature(
        payload,
        signature.signature,
        publicKey,
        rawBodyBytes,
        nobleCrypto,
      )
    } catch (error) {
      diagnostic(log, 'signature_verify_exception', {
        raw_matches_reserialized: rawMatchesReserialized,
        ...safeCryptoErrorDetails(error),
      })
      return json({ error: 'signature_verification_unavailable' }, 503)
    }
    if (verification.mode === 'canonical') {
      diagnostic(log, 'signature_verified_canonical', {
        raw_matches_reserialized: verification.rawMatchesReserialized,
      })
    } else if (verification.mode === 'raw') {
      diagnostic(log, 'signature_verified_raw', {
        raw_matches_reserialized: verification.rawMatchesReserialized,
      })
    } else {
      diagnostic(log, 'signature_verify_failed', {
        raw_matches_reserialized: verification.rawMatchesReserialized,
      })
      return json({ error: 'invalid_signature' }, 412)
    }

    // HAQLOOKS currently persists no eBay user/customer data. A valid notice is
    // acknowledged without mutating unrelated business records.
    return new Response(null, { status: 204 })
  }
}
