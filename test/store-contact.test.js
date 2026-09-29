import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  normalizeInstagramProfile,
  normalizeWhatsAppNumber,
  resolveStorefrontContact,
} from '../src/store-contact.js'
import { publicPurchaseAction } from '../src/public-storefront.js'
import { canAccessWorkspaceSection, workspaceMobileMoreGroupsForRole, workspaceNavigationGroupsForRole } from '../src/seller-utils.js'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const [mainSource, sellerSource, utilsSource, migration, sellerCss] = await Promise.all([
  read('../src/main.jsx'),
  read('../src/seller.jsx'),
  read('../src/seller-utils.js'),
  read('../supabase/migrations/20260929131147_storefront_contact_settings.sql'),
  read('../src/seller.css'),
])

test('WhatsApp accepts common Indonesian formats and stores canonical digits', () => {
  assert.equal(normalizeWhatsAppNumber('0812 3456 7890'), '6281234567890')
  assert.equal(normalizeWhatsAppNumber('6281234567890'), '6281234567890')
  assert.equal(normalizeWhatsAppNumber('+62 (812) 3456-7890'), '6281234567890')
  assert.equal(normalizeWhatsAppNumber(''), '')
})

test('WhatsApp rejects invalid or ambiguous numbers', () => {
  for (const value of ['0812ABC', '+1 2025550100', '62812+34567890', '6281234', '08 12 34']) {
    assert.equal(normalizeWhatsAppNumber(value), null, value)
  }
})

test('Instagram accepts handles and canonical safe profile URLs', () => {
  assert.equal(normalizeInstagramProfile('@haqlooks'), 'https://www.instagram.com/haqlooks/')
  assert.equal(normalizeInstagramProfile('https://instagram.com/haqlooks'), 'https://www.instagram.com/haqlooks/')
  assert.equal(normalizeInstagramProfile('haq.looks_2'), 'https://www.instagram.com/haq.looks_2/')
  assert.equal(normalizeInstagramProfile(''), '')
})

test('Instagram rejects unsafe, non-profile, and arbitrary URLs', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,<script>',
    'https://example.com/haqlooks',
    'http://instagram.com/haqlooks',
    'https://instagram.com/p/123',
    'https://instagram.com/haqlooks?next=https://example.com',
    'https://instagram.com.evil.test/haqlooks',
    '@bad..handle',
  ]) assert.equal(normalizeInstagramProfile(value), null, value)
})

test('public contact prefers WhatsApp, then configured Instagram, then legacy fallback', () => {
  assert.deepEqual(resolveStorefrontContact({
    whatsapp_number: '6281234567890',
    instagram_url: 'https://instagram.com/haqlooks',
  }), {
    whatsappNumber: '6281234567890',
    instagramUrl: 'https://www.instagram.com/haqlooks/',
    primaryType: 'whatsapp',
    primaryUrl: 'https://wa.me/6281234567890',
  })
  assert.equal(resolveStorefrontContact({ instagram_url: '@haqlooks' }).primaryUrl, 'https://www.instagram.com/haqlooks/')
  assert.equal(resolveStorefrontContact(null).primaryUrl, 'https://www.instagram.com/haqlook/')
  assert.equal(resolveStorefrontContact({ whatsapp_number: 'not-a-number' }).primaryType, 'instagram')
})

test('only safe contact columns are fetched and failures retain the old Instagram fallback', () => {
  assert.match(mainSource, /from\('storefront_contact_settings'\)\.select\('whatsapp_number,instagram_url'\)/)
  assert.doesNotMatch(mainSource, /from\('storefront_contact_settings'\)\.select\('\*'\)/)
  assert.match(mainSource, /setStoreContact\(error\?null:data\|\|null\)/)
  assert.match(mainSource, /resolveStorefrontContact\(contactSettings\)/)
})

test('Kontak Toko is in secondary navigation and available to Seller and Admin', () => {
  const sellerLinks = workspaceNavigationGroupsForRole('SELLER').flatMap((group) => group.links)
  const adminLinks = workspaceNavigationGroupsForRole('ADMIN').flatMap((group) => group.links)
  const sellerMoreLinks = workspaceMobileMoreGroupsForRole('SELLER').flatMap((group) => group.links)
  const adminMoreLinks = workspaceMobileMoreGroupsForRole('ADMIN').flatMap((group) => group.links)
  for (const links of [sellerLinks, adminLinks, sellerMoreLinks, adminMoreLinks]) {
    assert.ok(links.some(([href, label]) => href === '/seller/store-contact' && label === 'Kontak Toko'))
  }
  assert.equal(canAccessWorkspaceSection('SELLER', 'store-contact'), true)
  assert.equal(canAccessWorkspaceSection('ADMIN', 'store-contact'), true)
  assert.match(sellerSource, /section === 'store-contact'\) page = <StoreContactPage \/>/)
  assert.match(sellerSource, /function StoreContactPage\(/)
})

test('database migration grants safe reads and staff-only update with no browser insert/delete', () => {
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /grant select on table public\.storefront_contact_settings to anon, authenticated/i)
  assert.match(migration, /grant update \(whatsapp_number, instagram_url\)[\s\S]*to authenticated/i)
  assert.match(migration, /public\.is_staff\(\)/)
  assert.match(migration, /revoke all privileges on table public\.storefront_contact_settings[\s\S]*from public, anon, authenticated, service_role/i)
  assert.doesNotMatch(migration, /grant (?:insert|delete)/i)
  assert.match(migration, /on conflict \(id\) do nothing/i)
})

test('reserved and sold items keep their non-purchasable public CTA', () => {
  assert.deepEqual(publicPurchaseAction('reserved', true), { disabled: true, label: 'Dipesan' })
  assert.deepEqual(publicPurchaseAction('sold', true), { disabled: true, label: 'Terjual / Arsip' })
  assert.deepEqual(publicPurchaseAction('available', true), { disabled: false, label: 'Tanya / Beli via WhatsApp' })
  assert.deepEqual(publicPurchaseAction('available', false), { disabled: false, label: 'Tanya via Instagram' })
})

test('Kontak Toko has a compact responsive layout and safe-area aware mobile actions', () => {
  assert.match(sellerCss, /\.store-contact-layout\{display:grid;grid-template-columns:minmax\(0,1\.5fr\) minmax\(220px,\.8fr\)/)
  assert.match(sellerCss, /@media\(max-width:700px\)\{\.store-contact-layout\{grid-template-columns:minmax\(0,1fr\)/)
  assert.match(sellerCss, /env\(safe-area-inset-bottom\)/)
  assert.match(sellerCss, /\.store-contact-form input\{width:100%;min-width:0;min-height:48px/)
})
