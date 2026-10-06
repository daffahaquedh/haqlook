const MAX_BODY_BYTES = 64 * 1024
const EBAY_OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_PUBLIC_KEY_URL = 'https://api.ebay.com/commerce/notification/v1/public_key/'
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

function decodeBase64(value) {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function readDerLength(bytes, offset) {
  const first = bytes[offset]
  if (first === undefined) throw new Error('Invalid DER length')
  if (first < 0x80) return { length: first, next: offset + 1 }
  const count = first & 0x7f
  if (count === 0 || count > 2 || offset + count >= bytes.length) throw new Error('Invalid DER length')
  let length = 0
  for (let index = 1; index <= count; index += 1) length = (length << 8) | bytes[offset + index]
  return { length, next: offset + count + 1 }
}

function derEcdsaToP1363(bytes) {
  let offset = 0
  if (bytes[offset++] !== 0x30) throw new Error('Invalid ECDSA sequence')
  const sequenceLength = readDerLength(bytes, offset)
  offset = sequenceLength.next
  const sequenceEnd = offset + sequenceLength.length

  function readInteger() {
    if (bytes[offset++] !== 0x02) throw new Error('Invalid ECDSA integer')
    const length = readDerLength(bytes, offset)
    offset = length.next
    const end = offset + length.length
    if (length.length < 1 || end > bytes.length || bytes[offset] & 0x80) throw new Error('Invalid ECDSA integer')
    let value = bytes.subarray(offset, end)
    offset = end
    while (value.length > 32 && value[0] === 0) value = value.subarray(1)
    if (value.length > 32) throw new Error('ECDSA integer too large')
    const normalized = new Uint8Array(32)
    normalized.set(value, 32 - value.length)
    return normalized
  }

  const r = readInteger()
  const s = readInteger()
  if (offset !== sequenceEnd || sequenceEnd !== bytes.length) throw new Error('Invalid ECDSA sequence size')
  const result = new Uint8Array(64)
  result.set(r, 0)
  result.set(s, 32)
  return result
}

async function fetchJson(fetchImpl, url, init) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function getApplicationToken({ appId, clientSecret, fetchImpl, now }) {
  if (appTokenCache && appTokenCache.expiresAt > now() + 30_000) return appTokenCache.value

  const credentials = btoa(`${appId}:${clientSecret}`)
  const result = await fetchJson(fetchImpl, EBAY_OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  })
  if (!result || typeof result.access_token !== 'string' || !result.access_token || !Number.isFinite(Number(result.expires_in))) return null

  appTokenCache = {
    value: result.access_token,
    expiresAt: now() + Math.max(60, Number(result.expires_in) - 60) * 1000,
  }
  return appTokenCache.value
}

async function getPublicKey({ kid, appId, clientSecret, fetchImpl, now }) {
  const cached = keyCache.get(kid)
  if (cached && cached.expiresAt > now()) return cached.value

  const accessToken = await getApplicationToken({ appId, clientSecret, fetchImpl, now })
  if (!accessToken) return null
  const result = await fetchJson(fetchImpl, `${EBAY_PUBLIC_KEY_URL}${encodeURIComponent(kid)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  })
  if (!result || typeof result.key !== 'string' || !result.key.includes('BEGIN PUBLIC KEY')) return null
  if (result.algorithm !== 'ECDSA' || result.digest !== 'SHA1') return null

  keyCache.set(kid, { value: result.key, expiresAt: now() + PUBLIC_KEY_TTL_MS })
  if (keyCache.size > 100) keyCache.delete(keyCache.keys().next().value)
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

    const clientSecret = getSecret('EBAY_CLIENT_SECRET')
    if (!appId || !clientSecret) return json({ error: 'signature_verification_unavailable' }, 503)
    const publicKey = await getPublicKey({ kid: signature.kid, appId, clientSecret, fetchImpl, now })
    if (!publicKey) return json({ error: 'signature_verification_unavailable' }, 503)

    try {
      const key = await crypto.subtle.importKey(
        'spki',
        decodeBase64(publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '')),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      )
      const signatureBytes = derEcdsaToP1363(decodeBase64(signature.signature))
      const verified = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-1' },
        key,
        signatureBytes,
        new TextEncoder().encode(JSON.stringify(payload)),
      )
      if (!verified) return json({ error: 'invalid_signature' }, 412)
    } catch {
      return json({ error: 'signature_verification_unavailable' }, 503)
    }

    // HAQLOOKS currently persists no eBay user/customer data. A valid notice is
    // acknowledged without mutating unrelated business records.
    return new Response(null, { status: 204 })
  }
}
