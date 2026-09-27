import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { accountingRequestKey } from '../supabase/functions/seller-ai/usage-accounting.ts'

const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8')
const seller = await readFile(new URL('../src/seller.jsx', import.meta.url), 'utf8')
const hunter = await readFile(new URL('../src/hunter.jsx', import.meta.url), 'utf8')
const accounting = await readFile(new URL('../supabase/functions/seller-ai/usage-accounting.ts', import.meta.url), 'utf8')
const index = await readFile(new URL('../supabase/functions/seller-ai/index.ts', import.meta.url), 'utf8')
const listing = await readFile(new URL('../supabase/functions/seller-ai/listing-generation.ts', import.meta.url), 'utf8')
const hunterHandler = await readFile(new URL('../supabase/functions/seller-ai/hunter-handler.ts', import.meta.url), 'utf8')
const lifecycle = await readFile(new URL('../supabase/migrations/20260927010000_security_remediation_a_accounting.sql', import.meta.url), 'utf8')
const lockdown = await readFile(new URL('../supabase/migrations/20260927010100_security_remediation_a_lockdown.sql', import.meta.url), 'utf8')

test('public storefront selects only its required published product projection', () => {
  assert.match(main, /select\('id,slug,name,brand,model,price_idr,price_usd,size_label,condition,description,status,is_published,image_urls,created_at'\)\.eq\('is_published',true\)/)
  assert.doesNotMatch(main, /from\('products'\)\.select\('\*'\)/)
})

test('anonymous product grants are column-scoped and RLS policy is not dropped', () => {
  assert.match(lockdown, /REVOKE ALL PRIVILEGES ON TABLE public\.products FROM anon/i)
  assert.match(lockdown, /GRANT SELECT \([\s\S]*is_published[\s\S]*created_at[\s\S]*\) ON TABLE public\.products TO anon/i)
  for (const internal of ['purchase_price', 'minimum_price', 'source_url', 'condition_notes', 'defects', 'purchase_date', 'sold_at', 'sku', 'quantity', 'category']) {
    assert.doesNotMatch(lockdown.match(/GRANT SELECT \(([\s\S]*?)\) ON TABLE public\.products TO anon/i)?.[1] || '', new RegExp('\\b' + internal + '\\b'))
  }
  assert.doesNotMatch(lockdown, /DROP POLICY|DROP TABLE/i)
})

test('staff flows keep authenticated product access and AI requests carry idempotency keys', () => {
  assert.match(seller, /feature: 'ITEM_ANALYSIS', product_id: id, request_id: crypto\.randomUUID\(\)/)
  assert.match(hunter, /request_id: crypto\.randomUUID\(\)/)
  assert.match(index, /getUser\(\)/)
  assert.match(index, /from\('admins'\)\.select\('role'\)/)
})

test('older preview and production clients without request ids remain compatible', () => {
  const legacyKey = accountingRequestKey(undefined)
  assert.match(legacyKey, /^[0-9a-f-]{36}$/i)
  assert.equal(accountingRequestKey('123e4567-e89b-42d3-a456-426614174000'), '123e4567-e89b-42d3-a456-426614174000')
})

test('all provider accounting is routed through the trusted server client', () => {
  assert.match(index, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(index, /createClient\(supabaseUrl, serviceRoleKey/)
  assert.match(accounting, /reserve_ai_usage_server/)
  assert.match(accounting, /finalize_ai_usage_server/)
  assert.match(accounting, /release_ai_usage_server/)
  assert.doesNotMatch(index + listing + hunterHandler, /\.rpc\('(reserve_ai_usage|finalize_ai_usage|release_ai_usage|reserve_hunter_ai_usage|finalize_hunter_ai_usage|reserve_listing_ai_usage)'/)
})

test('reservation lifecycle is one-way, expiring, idempotent, and serialized for budget checks', () => {
  assert.match(lifecycle, /DEFAULT 'FINALIZED'/)
  assert.match(lifecycle, /'RESERVED', 'FINALIZED', 'RELEASED', 'EXPIRED'/)
  assert.match(lifecycle, /interval '5 minutes'/)
  assert.match(lifecycle, /pg_advisory_xact_lock\(783492\)/)
  assert.match(lifecycle, /ai_usage_user_request_key_idx|request_key/)
  assert.match(lifecycle, /reservation_status = 'RESERVED'[\s\S]*reservation_expires_at > now\(\)/)
  assert.match(lifecycle, /reservation_status = 'FINALIZED'/)
  assert.match(accounting, /result\.created !== true/)
})

test('authenticated clients cannot execute legacy accounting mutations after lock-down', () => {
  for (const name of ['reserve_ai_usage', 'finalize_ai_usage', 'release_ai_usage', 'reserve_hunter_ai_usage', 'finalize_hunter_ai_usage', 'reserve_listing_ai_usage']) {
    assert.match(lockdown, new RegExp('REVOKE ALL ON FUNCTION public\\.' + name + '\\('))
  }
  assert.match(lockdown, /FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(lockdown, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*ON TABLE public\.ai_usage FROM PUBLIC, anon, authenticated/)
})
