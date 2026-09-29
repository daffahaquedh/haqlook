import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  canAccessWorkspaceSection,
  inventoryStatusLabel,
  productDetailPrimaryAction,
  productDetailTabForKey,
  PRODUCT_DETAIL_TABS,
  safeHttpUrl,
  workspaceLinksForRole,
} from '../src/seller-utils.js'
import { CAMERA_PICKER_PROPS, GALLERY_PICKER_PROPS, MAX_PRODUCT_PHOTOS } from '../src/seller-photos.js'

const sellerSource = await readFile(new URL('../src/seller.jsx', import.meta.url), 'utf8')
const sellerCss = await readFile(new URL('../src/seller.css', import.meta.url), 'utf8')
const detailCss = await readFile(new URL('../src/product-detail.css', import.meta.url), 'utf8')
const dashboardSource = sellerSource.slice(sellerSource.indexOf('function SellerDashboard'), sellerSource.indexOf('function Stat'))
const inventorySource = sellerSource.slice(sellerSource.indexOf('function InventoryPage'), sellerSource.indexOf('function useProductPhotoDraft'))
const photoSource = sellerSource.slice(sellerSource.indexOf('function useProductPhotoDraft'), sellerSource.indexOf('function NewInventory'))
const addSource = sellerSource.slice(sellerSource.indexOf('function NewInventory'), sellerSource.indexOf('function Field'))
const detailSource = sellerSource.slice(sellerSource.indexOf('function InventoryDetail'), sellerSource.indexOf('function ItemAnalysisReview'))
const editSource = sellerSource.slice(sellerSource.indexOf('function EditInventory'), sellerSource.indexOf('function ListingRow'))

test('Seller and ADMIN keep the existing core role behavior', () => {
  assert.equal(canAccessWorkspaceSection('SELLER', 'inventory'), true)
  assert.equal(canAccessWorkspaceSection('ADMIN', 'inventory'), true)
  assert.equal(canAccessWorkspaceSection('SELLER', 'ai-usage'), false)
  assert.equal(canAccessWorkspaceSection('ADMIN', 'ai-usage'), true)
  assert.deepEqual(workspaceLinksForRole('SELLER').map(([href]) => href), ['/seller', '/seller/inventory', '/seller/ai-hunter', '/seller/listings'])
})

test('Beranda stays action-first and does not load AI usage data', () => {
  for (const href of ['/seller/inventory/new', '/seller/inventory', '/seller/ai-hunter']) assert.ok(dashboardSource.includes(`href="${href}"`))
  assert.ok(dashboardSource.includes("rpc('seller_dashboard_summary')"))
  assert.ok(dashboardSource.includes("from('marketplace_listings')"))
  assert.ok(dashboardSource.includes("from('sourcing_candidates')"))
  assert.doesNotMatch(dashboardSource, /ai_usage|seller_ai_usage_summary|functions\.invoke/)
})

test('inventory keeps search, filters, sort, pagination, localized status, and accessible states', () => {
  for (const label of ['Cari SKU, merek, atau nama barang', 'Filter status barang', 'Filter merek', 'Urutkan barang']) assert.ok(inventorySource.includes(label))
  for (const option of ['newest', 'oldest', 'capital']) assert.ok(inventorySource.includes(`value="${option}"`))
  assert.match(inventorySource, /\.range\(page \* pageSize, \(page \+ 1\) \* pageSize - 1\)/)
  assert.match(inventorySource, /Coba lagi/)
  assert.match(inventorySource, /aria-live="polite"/)
  assert.match(inventorySource, /role="status"/)
  assert.deepEqual(['draft', 'available', 'reserved', 'sold', 'archived'].map(inventoryStatusLabel), ['Draf', 'Tersedia', 'Dipesan', 'Terjual', 'Diarsipkan'])
  assert.match(inventorySource, /productDisplayTitle\(item\)/)
  for (const label of ['Modal', 'Harga jual']) assert.ok(inventorySource.includes(`<small>${label}</small>`))
})

test('Add and Edit share grouped seller fields and preserve safe URL validation', () => {
  for (const section of ['photos', 'identity', 'condition', 'pricing', 'origin', 'copy']) {
    const source = section === 'photos' ? photoSource : addSource
    assert.ok(source.includes(`data-form-section="${section}"`), `Add Barang missing ${section}`)
    assert.ok((section === 'photos' ? photoSource : editSource).includes(`data-form-section="${section}"`), `Edit Barang missing ${section}`)
  }
  for (const field of ['brand', 'name', 'category', 'subcategory', 'size_label', 'condition', 'condition_notes', 'defects', 'purchase_price', 'suggested_price', 'minimum_price', 'source', 'source_url', 'purchase_date', 'description', 'status']) {
    assert.ok(addSource.includes(`${field}:`), `Add Barang missing ${field}`)
    assert.ok(editSource.includes(`form.${field}`) || editSource.includes(`form.${field} ||`) || editSource.includes(`form.${field} ??`), `Edit Barang missing ${field}`)
  }
  assert.match(addSource, /if \(form\.source_url && !safeHttpUrl\(form\.source_url\)\)/)
  assert.match(editSource, /if \(form\.source_url && !safeHttpUrl\(form\.source_url\)\)/)
  assert.equal(safeHttpUrl('javascript:alert(1)'), null)
  assert.equal(safeHttpUrl('https://example.com/source'), 'https://example.com/source')
  assert.match(addSource, /disabled=\{busy \|\| photoBusy\}/)
  assert.match(editSource, /disabled=\{busy \|\| photoBusy\}/)
})

test('Gallery and camera remain separate, capped, and explicit photo operations', () => {
  assert.deepEqual(GALLERY_PICKER_PROPS, { type: 'file', accept: 'image/*', multiple: true })
  assert.equal(Object.hasOwn(GALLERY_PICKER_PROPS, 'capture'), false)
  assert.deepEqual(CAMERA_PICKER_PROPS, { type: 'file', accept: 'image/*', capture: 'environment' })
  assert.equal(MAX_PRODUCT_PHOTOS, 10)
  assert.match(photoSource, /prepareProductPhoto\(candidate\)/)
  assert.match(photoSource, /URL\.createObjectURL\(file\)/)
  assert.match(photoSource, /URL\.revokeObjectURL/)
  assert.match(photoSource, /Batas 10 foto per barang/)
  assert.match(photoSource, /role="alert"/)
  assert.equal((photoSource.match(/disabled=\{disabled \|\| photoBusy\}/g) || []).length, 2)
  assert.match(editSource, /onRemoveExisting=\{\(url\) => setRemovedPhotos/)
  assert.match(editSource, /Foto dikeluarkan dari daftar barang; file asli tetap disimpan/)
  assert.match(editSource, /Batalkan/)
  assert.match(editSource, /image_urls: imageUrls/)
  assert.doesNotMatch(editSource, /storage\.from\('product-images'\)\.remove/)
})

test('Product Detail tabs and next-action semantics remain intact', () => {
  assert.deepEqual(PRODUCT_DETAIL_TABS.map(({ id }) => id), ['summary', 'marketplace', 'sales'])
  assert.equal(productDetailTabForKey('summary', 'ArrowRight'), 'marketplace')
  assert.equal(productDetailTabForKey('marketplace', 'ArrowLeft'), 'summary')
  assert.equal(productDetailPrimaryAction({ status: 'draft', brand: 'A', name: 'B', size_label: 'M', condition: 'Good' }, []).label, 'Lengkapi barang')
  assert.equal(productDetailPrimaryAction({ status: 'available', brand: 'A', name: 'B', size_label: 'M', condition: 'Good' }, []).label, 'Buat listing')
  assert.equal(productDetailPrimaryAction({ status: 'available', brand: 'A', name: 'B', size_label: 'M', condition: 'Good' }, [{ listing_status: 'LISTED' }]).label, 'Kelola listing')
  assert.equal(productDetailPrimaryAction({ status: 'sold' }, []).label, 'Lihat penjualan')
  assert.match(detailSource, /productDetailTabForKey\(tabId, event\.key\)/)
  assert.match(detailSource, /role="tablist"/)
  assert.match(detailSource, /product-photo-thumbnails/)
  assert.match(detailSource, /aria-pressed=\{activePhoto === index\}/)
})

test('Seller responsive rules cover compact tablets, iOS safe area, keyboard, and touch sizing', () => {
  assert.match(sellerCss, /@media\(min-width:701px\) and \(max-width:900px\)/)
  assert.match(sellerCss, /@media\(max-width:700px\)/)
  assert.match(sellerCss, /env\(safe-area-inset-bottom\)/)
  assert.match(sellerCss, /body:has\(\.seller-app input:focus\) \.inventory-form \.seller-form-actions/)
  assert.match(sellerCss, /\.inventory-card\{[^}]*min-height:110px/s)
  assert.match(sellerCss, /\.photo-picker-action\{[^}]*min-height:60px/s)
  assert.match(detailCss, /\.product-photo-thumbnails button\{[^}]*min-height:44px/s)
  assert.match(detailCss, /@media\(max-width:390px\)/)
  assert.match(sellerCss, /minmax\(0,1fr\)/)
})

test('hidden photo picker inputs stay narrow inside full-width inventory forms', () => {
  const inputRule = sellerCss.match(/\.inventory-form input[^{}]*\{[^}]*\}/)?.[0]
  assert.ok(inputRule, 'inventory form input sizing rule should exist')
  assert.match(inputRule, /input:not\(\.photo-picker-input\)/)
  assert.match(sellerCss, /\.photo-picker-input\{[^}]*width:1px/)
})
