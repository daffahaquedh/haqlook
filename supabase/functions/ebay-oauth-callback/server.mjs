const EBAY_OAUTH_ENDPOINT = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_AUTHORIZATION_ENDPOINT = 'https://auth.ebay.com/oauth2/authorize'
export const EBAY_APP_ID = 'daffahaq-HAQLOOKS-PRD-efb79df06-6b061f2d'
export const EBAY_RUNAME = 'daffa_haque-daffahaq-HAQLOO-avhrixmb'
export const HAQLOOKS_SETTINGS_URL = 'https://haqlooks.my.id/seller/marketplace-settings'
export const HAQLOOKS_PRIVACY_URL = 'https://haqlooks.my.id/privacy'

export const EBAY_OAUTH_SCOPES = Object.freeze([
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.payment.dispute',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.reputation',
  'https://api.ebay.com/oauth/api_scope/sell.reputation.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription',
  'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.stores',
  'https://api.ebay.com/oauth/api_scope/sell.stores.readonly',
  'https://api.ebay.com/oauth/scope/sell.edelivery',
  'https://api.ebay.com/oauth/api_scope/commerce.vero',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.mapping',
  'https://api.ebay.com/oauth/api_scope/commerce.message',
  'https://api.ebay.com/oauth/api_scope/commerce.feedback',
  'https://api.ebay.com/oauth/api_scope/commerce.shipping',
  'https://api.ebay.com/oauth/api_scope/sell.listing',
  'https://api.ebay.com/oauth/api_scope/sell.listing.read',
  'https://api.ebay.com/oauth/api_scope/sell.cancellation.read',
  'https://api.ebay.com/oauth/api_scope/sell.cancellation',
  'https://api.ebay.com/oauth/api_scope/sell.return.read',
  'https://api.ebay.com/oauth/api_scope/sell.return',
  'https://api.ebay.com/oauth/api_scope/sell.inquiry',
  'https://api.ebay.com/oauth/api_scope/sell.inquiry.read',
  'https://api.ebay.com/oauth/api_scope/commerce.post_order.document',
  'https://api.ebay.com/oauth/api_scope/sell.offer',
])

const STATE_TTL_MS = 10 * 60 * 1000
const MAX_POST_BYTES = 4096
const TOKEN_REQUEST_TIMEOUT_MS = 10_000
const SAFE_REDIRECT_REASONS = new Set([
  'invalid_callback',
  'invalid_state',
  'server_not_ready',
  'provider_error',
  'storage_error',
])

function responseHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...headers }),
  })
}

function isAllowedOrigin(origin) {
  return origin === 'https://haqlooks.my.id' || /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.haqlook\.pages\.dev$/i.test(origin)
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  }
}

function redirectToStatus(status, reason) {
  const destination = new URL(HAQLOOKS_SETTINGS_URL)
  destination.searchParams.set('ebay', status)
  if (reason && SAFE_REDIRECT_REASONS.has(reason)) destination.searchParams.set('reason', reason)
  return new Response(null, {
    status: 303,
    headers: responseHeaders({ Location: destination.toString() }),
  })
}

function currentDate(now) {
  const value = now()
  return value instanceof Date ? value : new Date(value)
}

export async function hashOAuthState(state, cryptoImpl = globalThis.crypto) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(state))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function makeAuthorizationUrl(state) {
  if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) throw new TypeError('Invalid OAuth state')
  const url = new URL(EBAY_AUTHORIZATION_ENDPOINT)
  url.searchParams.set('client_id', EBAY_APP_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', EBAY_RUNAME)
  url.searchParams.set('scope', EBAY_OAUTH_SCOPES.join(' '))
  url.searchParams.set('state', state)
  return url.toString()
}

function safeLog(logEvent, stage, status) {
  if (typeof logEvent !== 'function') return
  logEvent(stage, Number.isInteger(status) ? status : undefined)
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function readLimitedJson(request) {
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_POST_BYTES) return null
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_POST_BYTES) return null
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function validState(state) {
  return typeof state === 'string' && /^[a-f0-9]{64}$/.test(state)
}

async function issueAuthorizationUrl({ cryptoImpl, store, now }) {
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(32))
  const state = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const stateHash = await hashOAuthState(state, cryptoImpl)
  const createdAt = currentDate(now)
  const expiresAt = new Date(createdAt.getTime() + STATE_TTL_MS)

  await store.deleteExpiredStates(createdAt.toISOString())
  await store.insertState(stateHash, expiresAt.toISOString())

  return makeAuthorizationUrl(state)
}

async function consumeOAuthState(state, store, cryptoImpl, now) {
  if (!validState(state)) return false
  const stateHash = await hashOAuthState(state, cryptoImpl)
  return store.consumeState(stateHash, currentDate(now).toISOString())
}

async function exchangeAuthorizationCode({ code, clientSecret, fetchImpl }) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: EBAY_RUNAME,
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS)

  try {
    return await fetchImpl(EBAY_OAUTH_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + base64Utf8(EBAY_APP_ID + ':' + clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export function createEbayOAuthHandler({
  authenticateAdmin,
  store,
  getSecret,
  fetchImpl = fetch,
  cryptoImpl = globalThis.crypto,
  now = () => new Date(),
  logEvent = () => {},
}) {
  return async function handleEbayOAuth(request) {
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('origin') || ''
      if (!isAllowedOrigin(origin)) return json({ ok: false, error: 'origin_not_allowed' }, 403)
      return new Response(null, { status: 204, headers: responseHeaders(corsHeaders(origin)) })
    }

    if (request.method === 'GET') {
      const requestUrl = new URL(request.url)
      const codes = requestUrl.searchParams.getAll('code')
      const states = requestUrl.searchParams.getAll('state')
      const code = codes[0]
      const state = states[0]
      if (codes.length !== 1 || states.length !== 1 || !code || code.length > 1024 || !validState(state)) {
        return redirectToStatus('error', 'invalid_callback')
      }

      let stateIsValid = false
      try {
        stateIsValid = await consumeOAuthState(state, store, cryptoImpl, now)
      } catch {
        return redirectToStatus('error', 'storage_error')
      }
      if (!stateIsValid) return redirectToStatus('error', 'invalid_state')

      const clientSecret = getSecret('EBAY_CLIENT_SECRET')
      if (typeof clientSecret !== 'string' || !clientSecret) {
        return redirectToStatus('error', 'server_not_ready')
      }

      let tokenResponse
      try {
        tokenResponse = await exchangeAuthorizationCode({ code, clientSecret, fetchImpl })
      } catch (error) {
        safeLog(logEvent, error?.name === 'AbortError' ? 'oauth_token_timeout' : 'oauth_token_request_failed')
        return redirectToStatus('error', 'provider_error')
      }
      if (!tokenResponse?.ok) {
        safeLog(logEvent, 'oauth_token_request_failed', tokenResponse?.status)
        return redirectToStatus('error', 'provider_error')
      }

      let tokenPayload
      try {
        tokenPayload = await tokenResponse.json()
      } catch {
        safeLog(logEvent, 'oauth_token_invalid_response', tokenResponse.status)
        return redirectToStatus('error', 'provider_error')
      }

      const refreshToken = tokenPayload?.refresh_token
      const refreshExpiresIn = Number(tokenPayload?.refresh_token_expires_in)
      if (
        typeof refreshToken !== 'string' ||
        !refreshToken ||
        refreshToken === 'N/A' ||
        refreshToken.length > 8192 ||
        !Number.isFinite(refreshExpiresIn) ||
        refreshExpiresIn <= 0 ||
        refreshExpiresIn > 10 * 365 * 24 * 60 * 60
      ) {
        safeLog(logEvent, 'oauth_token_invalid_response', tokenResponse.status)
        return redirectToStatus('error', 'provider_error')
      }

      const connectedAt = currentDate(now)
      const refreshExpiresAt = new Date(connectedAt.getTime() + Math.floor(refreshExpiresIn) * 1000)
      try {
        await store.saveCredentials({
          refresh_token: refreshToken,
          refresh_token_expires_at: refreshExpiresAt.toISOString(),
          connected_at: connectedAt.toISOString(),
        })
      } catch {
        safeLog(logEvent, 'oauth_credential_store_failed')
        return redirectToStatus('error', 'storage_error')
      }

      return redirectToStatus('connected')
    }

    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

    const origin = request.headers.get('origin') || ''
    if (!isAllowedOrigin(origin)) return json({ ok: false, error: 'origin_not_allowed' }, 403)
    const allowedHeaders = corsHeaders(origin)
    const body = await readLimitedJson(request)
    if (!body || !['start', 'status'].includes(body.action)) {
      return json({ ok: false, error: 'invalid_request' }, 400, allowedHeaders)
    }

    let auth
    try {
      auth = await authenticateAdmin(request)
    } catch {
      return json({ ok: false, error: 'authentication_unavailable' }, 503, allowedHeaders)
    }
    if (auth?.status === 401) return json({ ok: false, error: 'authentication_required' }, 401, allowedHeaders)
    if (auth?.status === 403) return json({ ok: false, error: 'admin_required' }, 403, allowedHeaders)
    if (!auth?.ok) return json({ ok: false, error: 'authentication_unavailable' }, 503, allowedHeaders)

    if (body.action === 'status') {
      try {
        const connection = await store.getConnectionStatus()
        return json({
          ok: true,
          connected: Boolean(connection),
          connected_at: connection?.connected_at || null,
          refresh_token_expires_at: connection?.refresh_token_expires_at || null,
        }, 200, allowedHeaders)
      } catch {
        return json({ ok: false, error: 'status_unavailable' }, 503, allowedHeaders)
      }
    }

    try {
      const authorizationUrl = await issueAuthorizationUrl({ cryptoImpl, store, now })
      return json({ ok: true, authorization_url: authorizationUrl }, 200, allowedHeaders)
    } catch {
      return json({ ok: false, error: 'authorization_unavailable' }, 503, allowedHeaders)
    }
  }
}
