import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  PRODUCT_DETAIL_TABS,
  canAccessWorkspaceSection,
  marketplaceStatusLabel,
  productDetailSubtitle,
  productDisplayTitle,
  productDetailActiveListings,
  productDetailPrimaryAction,
  productDetailTabForKey,
  safeHttpUrl,
} from '../src/seller-utils.js'

const sellerSource = await readFile(new URL('../src/seller.jsx', import.meta.url), 'utf8')
const listingSource = await readFile(new URL('../src/listing-generator.jsx', import.meta.url), 'utf8')
const cssSource = await readFile(new URL('../src/product-detail.css', import.meta.url), 'utf8')
const detailSource = sellerSource.slice(sellerSource.indexOf('function InventoryDetail'), sellerSource.indexOf('function ItemAnalysisReview'))
const completeItem = { status: 'available', brand: 'Vans', name: 'Slip-On', size_label: 'EU 43', condition: 'Good', category: 'Shoes' }

test('workspace has the approved Ringkas, Marketplace, Penjualan tab order', () => {
  assert.deepEqual(PRODUCT_DETAIL_TABS.map(({ id, label }) => [id, label]), [['summary', 'Ringkas'], ['marketplace', 'Marketplace'], ['sales', 'Penjualan']])
})

test('ArrowRight advances tabs and wraps after Penjualan', () => {
  assert.equal(productDetailTabForKey('summary', 'ArrowRight'), 'marketplace')
  assert.equal(productDetailTabForKey('sales', 'ArrowRight'), 'summary')
})

test('ArrowLeft goes backward and wraps before Ringkas', () => {
  assert.equal(productDetailTabForKey('sales', 'ArrowLeft'), 'marketplace')
  assert.equal(productDetailTabForKey('summary', 'ArrowLeft'), 'sales')
})

test('Home and End keyboard keys select the first and last tabs', () => {
  assert.equal(productDetailTabForKey('marketplace', 'Home'), 'summary')
  assert.equal(productDetailTabForKey('summary', 'End'), 'sales')
})

test('incomplete and draft products prioritize Lengkapi barang', () => {
  assert.equal(productDetailPrimaryAction({ ...completeItem, status: 'draft' }).label, 'Lengkapi barang')
  assert.equal(productDetailPrimaryAction({ ...completeItem, size_label: '' }).kind, 'complete')
})

test('ready product without a marketplace listing offers Buat listing', () => {
  assert.deepEqual(productDetailPrimaryAction(completeItem, []), { kind: 'generator', target: 'marketplace', label: 'Buat listing' })
})

test('draft marketplace listing leads to Kelola listing', () => {
  assert.equal(productDetailPrimaryAction(completeItem, [{ listing_status: 'DRAFT' }]).label, 'Kelola listing')
})

test('listed marketplace item leads to Kelola listing', () => {
  assert.equal(productDetailPrimaryAction(completeItem, [{ listing_status: 'LISTED' }]).kind, 'tab')
})

test('sold product action leads to the Penjualan tab', () => {
  assert.deepEqual(productDetailPrimaryAction({ ...completeItem, status: 'sold' }), { kind: 'tab', target: 'sales', label: 'Lihat penjualan' })
})

test('removed marketplace records do not block the create-listing action', () => {
  assert.equal(productDetailPrimaryAction(completeItem, [{ listing_status: 'REMOVED' }]).kind, 'generator')
})

test('sold-item warning helper includes drafts and listed rows but excludes the sold channel', () => {
  const rows = productDetailActiveListings([
    { marketplace: 'GRAILED', listing_status: 'LISTED' },
    { marketplace: 'VESTIAIRE', listing_status: 'DRAFT' },
    { marketplace: 'CAROUSELL', listing_status: 'REMOVED' },
  ], 'GRAILED')
  assert.deepEqual(rows.map(({ marketplace }) => marketplace), ['VESTIAIRE'])
})

test('seller-facing marketplace statuses are clear while database enums remain unchanged', () => {
  assert.equal(marketplaceStatusLabel('NOT_LISTED'), 'Belum listing')
  assert.equal(marketplaceStatusLabel('DRAFT'), 'Draft')
  assert.equal(marketplaceStatusLabel('LISTED'), 'Tayang')
  assert.equal(marketplaceStatusLabel('REMOVED'), 'Dihapus')
})

test('product title does not repeat a brand already present at the start of the name', () => {
  assert.equal(productDisplayTitle({ brand: 'Vans', name: 'Vans Slip-On x Iron Maiden' }), 'Vans Slip-On x Iron Maiden')
  assert.equal(productDisplayTitle({ brand: 'Nike', name: 'Air Max 90' }), 'Nike Air Max 90')
  assert.equal(productDisplayTitle({ brand: '', name: 'Unbranded jacket' }), 'Unbranded jacket')
})

test('product header omits size when it is already embedded in the item title', () => {
  assert.equal(productDetailSubtitle({ name: 'Vans Slip-On EU 43.5', size_label: 'EU 43.5', condition: 'Good', category: 'Sepatu' }), 'Good · Sepatu')
  assert.equal(productDetailSubtitle({ name: 'Work jacket', size_label: 'L', condition: 'Good', category: 'Jaket' }), 'L · Good · Jaket')
})

test('Ringkas is selected by default and reset safely for another product id', () => {
  assert.match(detailSource, /useState\('summary'\)/)
  assert.match(detailSource, /setActiveTab\('summary'\);[\s\S]*?load\(\) \}, \[id\]\)/)
})

test('each workspace tab renders its own panel without deleting existing product routes', () => {
  assert.match(detailSource, /<ProductSummaryTab item=/)
  assert.match(detailSource, /<ProductMarketplaceTab item=/)
  assert.match(detailSource, /<ProductSalesTab item=/)
  assert.match(sellerSource, /section === 'inventory' && id\) page = <InventoryDetail id=\{id\}/)
})

test('tabs expose role, selected state, and a labeled tab panel', () => {
  assert.match(detailSource, /role="tablist" aria-label="Bagian detail barang"/)
  assert.match(detailSource, /role="tab" id=\{`product-tab-\$\{tab\.id\}`\}/)
  assert.match(detailSource, /aria-selected=\{activeTab === tab\.id\}/)
  assert.match(detailSource, /role="tabpanel" aria-labelledby=\{`product-tab-\$\{activeTab\}`\}/)
})

test('AI Analyze remains an explicit button action, not an effect of page or tab load', () => {
  assert.match(detailSource, /onClick=\{analyzeItem\}/)
  assert.match(detailSource, /supabase\.functions\.invoke\('seller-ai', \{ body: \{ feature: 'ITEM_ANALYSIS', product_id: id \} \}\)/)
  const tabHandler = detailSource.slice(detailSource.indexOf('function handleTabKeyDown'), detailSource.indexOf('async function analyzeItem'))
  assert.doesNotMatch(tabHandler, /supabase|invoke\(/)
})

test('switching tabs is local state only and does not insert, update, delete, or RPC data', () => {
  assert.match(detailSource, /onClick=\{\(\) => setActiveTab\(tab\.id\)\}/)
  const tabHandler = detailSource.slice(detailSource.indexOf('function handleTabKeyDown'), detailSource.indexOf('async function analyzeItem'))
  assert.doesNotMatch(tabHandler, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/)
})

test('existing AI review/apply controls remain connected to the same result state', () => {
  assert.match(detailSource, /<ItemAnalysisReview analysis=\{analysis\}/)
  assert.match(detailSource, /onApply=\{applyAnalysis\}/)
  assert.match(detailSource, /onRetry=\{analyzeItem\}/)
  assert.match(sellerSource, /onReviewAnalysis=\{\(\) => setAnalysis\(lastAnalysis\)\}/)
  assert.match(sellerSource, /onClick=\{onReviewAnalysis\}/)
})

test('Listing Generator remains reachable from product actions and Marketplace', () => {
  assert.match(detailSource, /setShowListingGenerator\(true\)/)
  assert.match(detailSource, /<ListingGenerator item=\{item\} listings=\{listings\} onClose=/)
  assert.match(sellerSource, /<ProductMarketplaceTab item=.*onGenerate=\{\(\) => setShowListingGenerator\(true\)\}/s)
  assert.match(listingSource, /<strong>\{productDisplayTitle\(item\)\}<\/strong>/)
  assert.doesNotMatch(listingSource, /<strong>\{item\.brand\} \{item\.name\}<\/strong>/)
})

test('marketplace listing edit controls remain reachable per channel', () => {
  assert.match(sellerSource, /onEdit=\{\(listing\) => setEditingListing\(\{ \.\.\.listing \}\)\}/)
  assert.match(sellerSource, /onClick=\{\(\) => onEdit\(listing\)\}/)
  assert.match(detailSource, /className="seller-modal listing-edit-modal product-workspace-modal"/)
})

test('marketplace cards distinguish saved/generated copy from channels without copy', () => {
  assert.match(sellerSource, /listing\.listing_title \|\| listing\.listing_description \? 'Copy listing tersedia' : 'Belum ada copy tersimpan'/)
  assert.match(cssSource, /product-marketplace-copy-state\.available/)
})

test('the listing save path still validates safe HTTP URLs and upserts the same marketplace row', () => {
  assert.match(detailSource, /safeHttpUrl\(form\.listing_url\)/)
  assert.match(detailSource, /from\('marketplace_listings'\)\.upsert\(/)
  assert.match(detailSource, /onConflict: 'product_id,marketplace'/)
})

test('unsold products offer Catat terjual without merging the global sales ledger', () => {
  assert.match(sellerSource, /BELUM TERJUAL/)
  assert.match(sellerSource, /Catat terjual/)
  assert.match(detailSource, /onSubmit=\{markSold\}/)
})

test('sold products display the existing sale channel, date, revenue, fees, and profit fields', () => {
  for (const field of ['sale_price', 'purchase_price', 'gross_profit', 'net_profit', 'marketplace_fee', 'payment_fee', 'shipping_subsidy', 'other_cost', 'sold_at', 'sold_via']) {
    assert.ok(sellerSource.includes(`sale.${field}`), `missing sale field ${field}`)
  }
})

test('active listing warning remains visible for a sold product and does not auto-remove posts', () => {
  assert.match(detailSource, /Barang ini sudah terjual\. Periksa listing marketplace berikut secara manual/)
  assert.match(detailSource, /Listing tidak dihapus otomatis/)
  assert.doesNotMatch(detailSource, /from\('marketplace_listings'\)\.delete\(/)
})

test('Seller can open inventory; ADMIN retains the existing superset access', () => {
  assert.equal(canAccessWorkspaceSection('SELLER', 'inventory'), true)
  assert.equal(canAccessWorkspaceSection('ADMIN', 'inventory'), true)
  assert.equal(canAccessWorkspaceSection('ADMIN', 'ai-usage'), true)
  assert.equal(canAccessWorkspaceSection('SELLER', 'ai-usage'), false)
})

test('product detail deep links stay on /seller/inventory/:id and keep edit routing intact', () => {
  assert.match(sellerSource, /section === 'inventory' && id && subSection === 'edit'\) page = <EditInventory id=\{id\}/)
  assert.match(sellerSource, /section === 'inventory' && id\) page = <InventoryDetail id=\{id\}/)
  assert.match(detailSource, /href="\/seller\/inventory"/)
})

test('safe marketplace URLs remain limited to HTTP and HTTPS before rendering links', () => {
  assert.ok(safeHttpUrl('https://grailed.com/listing/123'))
  assert.equal(safeHttpUrl('javascript:alert(1)'), null)
  assert.match(sellerSource, /const safeUrl = safeHttpUrl\(listing\.listing_url\)/)
})

test('long notes wrap, clamp visually, and remain expandable without mutating the product', () => {
  assert.match(cssSource, /overflow-wrap:anywhere/)
  assert.match(cssSource, /-webkit-line-clamp:4/)
  assert.match(sellerSource, /aria-expanded=\{expanded\}/)
  assert.match(sellerSource, /Lihat catatan lengkap/)
})

test('mobile workspace uses min-width-safe grids and no fixed desktop-width marketplace table', () => {
  assert.match(cssSource, /minmax\(0,1fr\)/)
  assert.match(cssSource, /@media\(max-width:700px\)/)
  assert.match(cssSource, /product-marketplace-grid\{grid-template-columns:1fr/)
  assert.doesNotMatch(cssSource, /(?:^|[;{])\s*width:\s*(?:760|900|1000)px/)
})

test('sale and listing edit sheets adapt to dynamic mobile height and iOS safe area', () => {
  assert.match(cssSource, /100dvh/)
  assert.match(cssSource, /env\(safe-area-inset-bottom\)/)
  assert.match(cssSource, /\.product-sale-modal \.seller-form-actions\{position:sticky/)
})

test('marketplace and sale tab switching does not trigger extra Supabase query loops', () => {
  const tabEffect = detailSource.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[id\]\)/)
  assert.ok(tabEffect, 'product data should load once per product id, not per tab')
  assert.match(tabEffect[1], /setActiveTab\('summary'\)/)
  assert.match(tabEffect[1], /load\(\)/)
  assert.equal((detailSource.match(/from\('products'\)\.select\('\*'\)\.eq\('id', id\)\.single\(\)/g) || []).length, 1)
})

test('mark-sold still calls the existing RPC with the same sale inputs', () => {
  assert.match(detailSource, /rpc\('mark_product_sold'/)
  for (const field of ['p_product_id', 'p_sold_via', 'p_sale_price', 'p_marketplace_fee', 'p_payment_fee', 'p_shipping_subsidy', 'p_other_cost', 'p_notes']) {
    assert.ok(detailSource.includes(field), `missing RPC argument ${field}`)
  }
})

