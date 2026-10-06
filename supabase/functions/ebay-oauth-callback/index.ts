import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { createEbayOAuthHandler } from './server.mjs'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const serviceClient = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null

function requireServiceClient() {
  if (!serviceClient) throw new Error('OAuth database unavailable')
  return serviceClient
}

const store = {
  async deleteExpiredStates(nowIso: string) {
    const { error } = await requireServiceClient()
      .from('ebay_oauth_states')
      .delete()
      .lt('expires_at', nowIso)
    if (error) throw new Error('OAuth state cleanup failed')
  },

  async insertState(stateHash: string, expiresAt: string) {
    const { error } = await requireServiceClient()
      .from('ebay_oauth_states')
      .insert({ state_hash: stateHash, expires_at: expiresAt })
    if (error) throw new Error('OAuth state creation failed')
  },

  async consumeState(stateHash: string, nowIso: string) {
    const { data, error } = await requireServiceClient()
      .from('ebay_oauth_states')
      .delete()
      .eq('state_hash', stateHash)
      .gt('expires_at', nowIso)
      .select('state_hash')
      .maybeSingle()
    if (error) throw new Error('OAuth state validation failed')
    return Boolean(data)
  },

  async getConnectionStatus() {
    const { data, error } = await requireServiceClient()
      .from('ebay_seller_credentials')
      .select('connected_at,refresh_token_expires_at')
      .eq('id', 1)
      .maybeSingle()
    if (error) throw new Error('OAuth status lookup failed')
    return data
  },

  async saveCredentials(credentials: { refresh_token: string; refresh_token_expires_at: string; connected_at: string }) {
    const { error } = await requireServiceClient()
      .from('ebay_seller_credentials')
      .upsert({ id: 1, ...credentials }, { onConflict: 'id' })
    if (error) throw new Error('OAuth credential save failed')
  },
}

async function authenticateAdmin(request: Request) {
  if (!supabaseUrl || !anonKey || !serviceClient) return { status: 503 }
  const authorization = request.headers.get('Authorization') || ''
  const match = /^Bearer\s+([^\s]{20,8192})$/i.exec(authorization)
  if (!match) return { status: 401 }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { data, error } = await authClient.auth.getUser(match[1])
  if (error || !data.user) return { status: 401 }

  const { data: profile, error: roleError } = await serviceClient
    .from('admins')
    .select('role')
    .eq('user_id', data.user.id)
    .maybeSingle()
  if (roleError) return { status: 503 }
  if (String(profile?.role || '').toUpperCase() !== 'ADMIN') return { status: 403 }
  return { ok: true }
}

Deno.serve(createEbayOAuthHandler({
  authenticateAdmin,
  store,
  getSecret: (name: string) => Deno.env.get(name) || '',
  logEvent: (stage: string, status?: number) => {
    // Explicitly allowlist safe stage and numeric HTTP status only.
    const allowed = new Set([
      'oauth_token_timeout',
      'oauth_token_request_failed',
      'oauth_token_invalid_response',
      'oauth_credential_store_failed',
    ])
    if (allowed.has(stage)) console.warn('[ebay-oauth]', stage, Number.isInteger(status) ? status : undefined)
  },
}))
