import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ADMIN_SETTINGS_TABS,
  adminSettingsTabForPath,
  canAccessWorkspaceSection,
} from '../src/seller-utils.js'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const [mainSource, sellerSource, migration, config] = await Promise.all([
  read('../src/main.jsx'),
  read('../src/seller.jsx'),
  read('../supabase/migrations/20261006120000_ebay_oauth_credentials.sql'),
  read('../supabase/config.toml'),
])

test('privacy and callback result routes are wired with safe query cleanup', () => {
  assert.ok(mainSource.includes("else if(path==='/privacy') page=<Privacy />"))
  assert.ok(mainSource.includes('to="/privacy"'))
  assert.ok(mainSource.includes('scrubEbayCallbackQuery()'))
  assert.ok(mainSource.includes("'code','state','access_token','refresh_token','error','error_description'"))
  assert.ok(sellerSource.includes('Akun eBay berhasil disambungkan ke HAQLOOKS'))
  assert.ok(sellerSource.includes('Otorisasi eBay dibatalkan'))
  assert.ok(sellerSource.includes('Baca Kebijakan Privasi'))
})

test('marketplace connection route remains Admin-only and uses the existing settings URL', () => {
  assert.equal(adminSettingsTabForPath('/seller/marketplace-settings'), 'marketplaces')
  assert.equal(ADMIN_SETTINGS_TABS.find((tab) => tab.id === 'marketplaces').href, '/seller/marketplace-settings')
  assert.equal(canAccessWorkspaceSection('ADMIN', 'marketplace-settings'), true)
  assert.equal(canAccessWorkspaceSection('SELLER', 'marketplace-settings'), false)
  assert.ok(sellerSource.includes("activeTab === 'marketplaces'\n      ? <EbayConnectionSettings />"))
  assert.ok(sellerSource.includes("functions.invoke('ebay-oauth-callback', { body: { action: 'start' } })"))
  assert.ok(sellerSource.includes("functions.invoke('ebay-oauth-callback', { body: { action: 'status' } })"))
  assert.doesNotMatch(mainSource + sellerSource, /EBAY_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY|client_secret/i)
})

test('OAuth storage is additive, single-account, RLS-enabled, and server-role-only', () => {
  assert.match(migration, /create table if not exists public\.ebay_oauth_states/i)
  assert.match(migration, /create table if not exists public\.ebay_seller_credentials/i)
  assert.match(migration, /id smallint primary key default 1 check \(id = 1\)/i)
  assert.equal((migration.match(/enable row level security/gi) || []).length, 2)
  assert.equal((migration.match(/revoke all privileges[\s\S]*?from public, anon, authenticated/gi) || []).length, 2)
  assert.equal((migration.match(/grant select, insert, update, delete[\s\S]*?to service_role/gi) || []).length, 2)
  assert.doesNotMatch(migration, /\bdrop\b|\btruncate\b|\bdelete from public\.(products|admins)\b/i)
  assert.doesNotMatch(migration, /create policy[\s\S]*?(anon|authenticated)/i)
})

test('new callback disables gateway JWT only because the handler validates admin JWTs itself', () => {
  assert.match(config, /\[functions\.ebay-account-deletion\]\s*verify_jwt = false/)
  assert.match(config, /\[functions\.ebay-oauth-callback\]\s*verify_jwt = false/)
  assert.ok(sellerSource.includes("profile.role === 'ADMIN'"))
})
