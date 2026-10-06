const MAX_BODY_BYTES = 64 * 1024
const EBAY_OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_PUBLIC_KEY_URL = 'https://api.ebay.com/commerce/notification/v1/public_key/'
const EBAY_SIGNATURE_ALGORITHM = Object.freeze({ name: 'ECDSA', hash: 'SHA-1' })
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

function readDerLength(bytes, cursor) {
  if (cursor.offset >= bytes.length) throw new Error('Invalid ECDSA signature')
  const first = bytes[cursor.offset++]
  if (first < 0x80) return first

  const octetCount = first & 0x7f
  if (octetCount === 0 || octetCount > 2 || cursor.offset + octetCount > bytes.length) {
    throw new Error('Invalid ECDSA signature')
  }
  if (bytes[cursor.offset] === 0) throw new Error('Invalid ECDSA signature')

  let length = 0
  for (let index = 0; index < octetCount; index += 1) {
    length = (length * 256) + bytes[cursor.offset++]
  }
  if (length < 0x80) throw new Error('Invalid ECDSA signature')
  return length
}

function readDerInteger(bytes, cursor, sequenceEnd) {
  if (cursor.offset >= sequenceEnd || bytes[cursor.offset++] !== 0x02) {
    throw new Error('Invalid ECDSA signature')
  }
  const length = readDerLength(bytes, cursor)
  const end = cursor.offset + length
  if (length === 0 || end > sequenceEnd) throw new Error('Invalid ECDSA signature')

  let integer = bytes.subarray(cursor.offset, end)
  cursor.offset = end
  if (integer[0] & 0x80) throw new Error('Invalid ECDSA signature')
  if (integer.length > 1 && integer[0] === 0) {
    if ((integer[1] & 0x80) === 0) throw new Error('Invalid ECDSA signature')
    integer = integer.subarray(1)
  }
  if (integer.length > 32) throw new Error('Invalid ECDSA signature')
  return integer
}

export function derEcdsaToP1363(signatureBytes) {
  if (!(signatureBytes instanceof Uint8Array)) throw new Error('Invalid ECDSA signature')
  const cursor = { offset: 0 }
  if (signatureBytes[cursor.offset++] !== 0x30) throw new Error('Invalid ECDSA signature')
  const sequenceLength = readDerLength(signatureBytes, cursor)
  const sequenceEnd = cursor.offset + sequenceLength
  if (sequenceEnd !== signatureBytes.length) throw new Error('Invalid ECDSA signature')

  const r = readDerInteger(signatureBytes, cursor, sequenceEnd)
  const s = readDerInteger(signatureBytes, cursor, sequenceEnd)
  if (cursor.offset !== sequenceEnd) throw new Error('Invalid ECDSA signature')

  const result = new Uint8Array(64)
  result.set(r, 32 - r.length)
  result.set(s, 64 - s.length)
  return result
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Invalid base64 data')
  }
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function decodePublicKeySpki(publicKey) {
  if (typeof publicKey !== 'string') throw new Error('Invalid public key')
  const match = publicKey.match(/-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/)
  if (!match) throw new Error('Invalid public key')
  return decodeBase64(match[1].replace(/\s/g, ''))
}

function equalBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

export async function verifyEbaySignature(
  payload,
  signatureBase64,
  publicKey,
  rawBodyBytes,
  subtleImpl = globalThis.crypto?.subtle,
) {
  if (!subtleImpl) throw new TypeError('Web Crypto unavailable')
  if (!(rawBodyBytes instanceof Uint8Array)) throw new TypeError('Raw request bytes unavailable')

  const canonicalBytes = new TextEncoder().encode(JSON.stringify(payload))
  const rawMatchesReserialized = equalBytes(rawBodyBytes, canonicalBytes)
  const derSignature = decodeBase64(signatureBase64)
  const p1363Signature = derEcdsaToP1363(derSignature)
  const key = await subtleImpl.importKey(
    'spki',
    decodePublicKeySpki(publicKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )

  const canonicalValid = await subtleImpl.verify(
    EBAY_SIGNATURE_ALGORITHM,
    key,
    p1363Signature,
    canonicalBytes,
  )
  if (canonicalValid) return { mode: 'canonical', rawMatchesReserialized }

  if (!rawMatchesReserialized) {
    const rawValid = await subtleImpl.verify(
      EBAY_SIGNATURE_ALGORITHM,
      key,
      p1363Signature,
      rawBodyBytes,
    )
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
  subtleImpl = globalThis.crypto?.subtle,
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
        subtleImpl,
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

