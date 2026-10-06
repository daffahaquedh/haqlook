import {
  EBAY_APP_ID,
  EBAY_OAUTH_SCOPES,
  EBAY_RUNAME,
  createEbayOAuthHandler,
  hashOAuthState,
  makeAuthorizationUrl,
} from '../supabase/functions/ebay-oauth-callback/server.mjs'

Deno.test('Supabase Edge Deno Web Crypto builds an eBay Production authorization request', async () => {
  const randomState = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const digest = await hashOAuthState(randomState)
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('OAuth state hash must be fixed-length SHA-256 hex')
  const authorization = new URL(makeAuthorizationUrl(randomState))
  if (authorization.searchParams.get('client_id') !== EBAY_APP_ID) throw new Error('Unexpected client identifier')
  if (authorization.searchParams.get('redirect_uri') !== EBAY_RUNAME) throw new Error('Unexpected RuName')
  if (authorization.searchParams.get('scope')?.split(' ').length !== EBAY_OAUTH_SCOPES.length) throw new Error('Scope list mismatch')
})

Deno.test('Supabase Edge Deno callback rejects missing OAuth parameters and redirects without credentials', async () => {
  let secretRead = false
  const store = {
    async deleteExpiredStates() {},
    async insertState() {},
    async consumeState() { return false },
    async getConnectionStatus() { return null },
    async saveCredentials() {},
  }
  const handler = createEbayOAuthHandler({
    authenticateAdmin: async () => ({ ok: false }),
    store,
    getSecret: () => { secretRead = true; return '' },
    logEvent: () => { throw new Error('Malformed callback must not log request material') },
  })
  const response = await handler(new Request('https://function.example/ebay-oauth-callback'))
  const location = new URL(response.headers.get('location') || '')
  if (response.status !== 303) throw new Error('Expected safe redirect')
  if (location.origin !== 'https://haqlooks.my.id') throw new Error('Expected HAQLOOKS redirect')
  if (location.searchParams.has('code') || location.searchParams.has('state')) throw new Error('Credential query leaked')
  if (secretRead) throw new Error('Secret should not be read for malformed callback')
})
