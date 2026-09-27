import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildWhatsAppProductMessage,
  filterAndSortPublicProducts,
  publicProductUrl,
  publicPurchaseAction,
  publicStatusLabel,
} from '../src/public-storefront.js'

const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8')
const stylesSource = await readFile(new URL('../src/home-refinement.css', import.meta.url), 'utf8')

const products = [
  { slug: 'pair-latest', name: 'Runner Latest', brand: 'Nike', size_label: 'EU 42', status: 'AVAILABLE', price_idr: 1500000, created_at: '2026-09-26T00:00:00Z' },
  { slug: 'pair-cheaper', name: 'Classic Low', brand: 'Adidas', size_label: 'EU 41', status: 'reserved', price_idr: 800000, created_at: '2026-09-24T00:00:00Z' },
  { slug: 'pair-sold', name: 'Archive Pair', brand: 'Vans', size_label: 'EU 43', status: 'sold', price_idr: 1100000, created_at: '2026-09-25T00:00:00Z' },
]

test('public status text is localized and never color-only', () => {
  assert.equal(publicStatusLabel('AVAILABLE'), 'Tersedia')
  assert.equal(publicStatusLabel('reserved'), 'Dipesan')
  assert.equal(publicStatusLabel('sold'), 'Terjual')
  assert.equal(publicStatusLabel('unexpected'), 'Status belum diketahui')
})

test('purchase action matches actual public availability', () => {
  assert.deepEqual(publicPurchaseAction('available'), { disabled: false, label: 'Tanya / Beli via WhatsApp' })
  assert.deepEqual(publicPurchaseAction('available', false), { disabled: false, label: 'Tanya via Instagram' })
  assert.deepEqual(publicPurchaseAction('reserved'), { disabled: true, label: 'Dipesan' })
  assert.deepEqual(publicPurchaseAction('sold'), { disabled: true, label: 'Terjual / Arsip' })
})

test('public catalog supports search, real status filters, and safe sort choices', () => {
  assert.deepEqual(filterAndSortPublicProducts(products, { query: 'nike', status: 'available' }).map((p) => p.slug), ['pair-latest'])
  assert.deepEqual(filterAndSortPublicProducts(products, { sort: 'price-asc' }).map((p) => p.slug), ['pair-cheaper', 'pair-sold', 'pair-latest'])
  assert.deepEqual(filterAndSortPublicProducts(products, { sort: 'price-desc' }).map((p) => p.slug), ['pair-latest', 'pair-sold', 'pair-cheaper'])
  assert.deepEqual(filterAndSortPublicProducts(products).map((p) => p.slug), ['pair-latest', 'pair-sold', 'pair-cheaper'])
})

test('WhatsApp context contains only public product identity and URL', () => {
  const url = publicProductUrl('https://haqlooks.my.id/', 'runner-latest')
  assert.equal(url, 'https://haqlooks.my.id/product/runner-latest')
  const message = buildWhatsAppProductMessage({ name: 'Runner Latest', slug: 'runner-latest' }, url)
  assert.match(message, /Runner Latest/)
  assert.match(message, /Kode barang: runner-latest/)
  assert.match(message, /https:\/\/haqlooks\.my\.id\/product\/runner-latest/)
  assert.doesNotMatch(message, /purchase_price|minimum_price|source_url|internal/i)
})

test('catalog keeps the safe public projection and avoids misleading fallback flashes', () => {
  assert.match(mainSource, /select\('id,slug,name,brand,model,price_idr,price_usd,size_label,condition,description,status,is_published,image_urls,created_at'\)/)
  assert.doesNotMatch(mainSource, /select\('\*'\)/)
  assert.doesNotMatch(mainSource, /fallbackProducts/)
})

test('cards have no fake wishlist control and Phase 1 staff entry stays present', () => {
  assert.doesNotMatch(mainSource, /className="heart"/)
  assert.match(mainSource, /Staff Login/)
  assert.match(mainSource, /\/staff/)
  assert.match(stylesSource, /public-product-grid/)
})

