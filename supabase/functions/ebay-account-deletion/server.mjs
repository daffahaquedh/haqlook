import { createVerify } from 'node:crypto'

const MAX_BODY_BYTES = 64 * 1024
const EBAY_OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_PUBLIC_KEY_URL = 'https://api.ebay.com/commerce/notification/v1/public_key/'
const EBAY_SIGNATURE_ALGORITHM = 'ssl3-sha1'
const PUBLIC_KEY_TTL_MS = 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8_000

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

function formatPublicKey(publicKey) {
  const encodedKey = publicKey
    .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')
  if (!encodedKey) throw new Error('Invalid public key')
  return `-----BEGIN PUBLIC KEY-----\n${encodedKey}\n-----END PUBLIC KEY-----`
}

export function verifyEbaySignature(payload, signatureBase64, publicKey, createVerifyImpl = createVerify) {
  const verifier = createVerifyImpl(EBAY_SIGNATURE_ALGORITHM)
  verifier.update(JSON.stringify(payload))
  // eBay's official SDK passes the original base64-encoded ASN.1 DER bytes
  // directly to Node crypto; do not convert this signature representation.
  return verifier.verify(formatPublicKey(publicKey), signatureBase64, 'base64')
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
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function createHandler({
  endpoint,
  appId,
  getSecret,
  fetchImpl = fetch,
  now = Date.now,
  log = (stage, details) => console.info(JSON.stringify({ component: 'ebay-account-deletion', stage, ...details })),
  createVerifyImpl = createVerify,
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

    let rawBody
    try {
      rawBody = await readLimitedBody(request)
    } catch {
      return json({ error: 'invalid_payload' }, 400)
    }
    if (rawBody === null) return json({ error: 'payload_too_large_or_empty' }, 413)

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

    let verified
    try {
      verified = verifyEbaySignature(payload, signature.signature, publicKey, createVerifyImpl)
    } catch {
      diagnostic(log, 'signature_verify_exception')
      return json({ error: 'signature_verification_unavailable' }, 503)
    }
    if (!verified) {
      diagnostic(log, 'signature_verify_failed')
      return json({ error: 'invalid_signature' }, 412)
    }
    diagnostic(log, 'signature_verified')

    // HAQLOOKS currently persists no eBay user/customer data. A valid notice is
    // acknowledged without mutating unrelated business records.
    return new Response(null, { status: 204 })
  }
}

