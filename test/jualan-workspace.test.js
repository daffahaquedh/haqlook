import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  calculateProfit,
  jualanPathForTab,
  jualanTabForPath,
  listingNeedsReview,
  listingWorkspaceFilterMatches,
  makeListingTrackerUpdate,
  makeListingWorkspaceRows,
  marketplaceStatusLabel,
  safeHttpUrl,
  workspacePathIsActive,
  canAccessWorkspaceSection,
  LISTING_STATUSES,
} from '../src/seller-utils.js'

const [sellerSource, sellerStyles, productStyles, schema, generatorSource] = await Promise.all([
  readFile(new URL('../src/seller.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/seller.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/product-detail.css', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260925_seller_panel_v1.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/listing-generator.jsx', import.meta.url), 'utf8'),
])
const workspaceSource = sellerSource.slice(sellerSource.indexOf('function JualanWorkspace'), sellerSource.indexOf('function SellerSidebar'))
const listingsSource = sellerSource.slice(sellerSource.indexOf('function ListingsPage'), sellerSource.indexOf('function SalesPage'))
const salesSource = sellerSource.slice(sellerSource.indexOf('function SalesPage'), sellerSource.indexOf('function AIUsagePage'))

test('both existing seller routes resolve to Jualan and keep legacy URLs', () => {
  assert.equal(jualanTabForPath('/seller/listings'), 'listings')
  assert.equal(jualanTabForPath('/seller/sales'), 'sales')
  assert.equal(jualanPathForTab('listings'), '/seller/listings')
  assert.equal(jualanPathForTab('sales'), '/seller/sales')
  assert.match(sellerSource, /section === 'listings' \|\| section === 'sales'\) page = <JualanWorkspace path=\{workspacePath\} \/>/)
})

test('the Listing and Terjual tabs expose matching selected state and keep route refresh compatibility', () => {
  assert.match(workspaceSource, /href="\/seller\/listings" aria-current=\{activeTab === 'listings' \? 'page' : undefined\}/)
  assert.match(workspaceSource, /href="\/seller\/sales" aria-current=\{activeTab === 'sales' \? 'page' : undefined\}/)
  assert.match(workspaceSource, /className="jualan-workspace-tabs" aria-label="Jualan"/)
})

test('workspace loads each backend view only on first visit and retains it when switching tabs', () => {
  assert.match(workspaceSource, /useState\(\(\) => new Set\(\[activeTab\]\)\)/)
  assert.match(workspaceSource, /visitedTabs\.has\('listings'\).*<ListingsPage/)
  assert.match(workspaceSource, /visitedTabs\.has\('sales'\).*<SalesPage/)
  assert.match(workspaceSource, /hidden=\{activeTab !== 'listings'\}/)
  assert.match(workspaceSource, /hidden=\{activeTab !== 'sales'\}/)
  assert.equal((listingsSource.match(/from\('products'\)/g) || []).length, 1)
  assert.equal((salesSource.match(/from\('sales'\)/g) || []).length, 1)
})

test('both legacy routes activate the same top-level Jualan navigation on desktop and mobile', () => {
  assert.equal(workspacePathIsActive('/seller/listings', '/seller/listings'), true)
  assert.equal(workspacePathIsActive('/seller/sales', '/seller/listings'), true)
  assert.match(sellerSource, /SELLER_MOBILE_PRIMARY_LINKS\.map/)
  assert.match(sellerSource, /workspacePathIsActive\(path, href\)/)
})

test('workspace rows preserve actual channel, status, and listed price and include unlisted active inventory', () => {
  const rows = makeListingWorkspaceRows([
    { id: 'p1', status: 'available', marketplace_listings: [{ id: 'l1', marketplace: 'GRAILED', listing_status: 'LISTED', listed_price: 1250000 }] },
    { id: 'p2', status: 'draft', marketplace_listings: [] },
    { id: 'p3', status: 'sold', marketplace_listings: [] },
  ])
  assert.deepEqual([rows[0].marketplace, rows[0].listing_status, rows[0].listed_price], ['GRAILED', 'LISTED', 1250000])
  assert.equal(rows[1].listing_status, 'NOT_LISTED')
  assert.equal(rows[1].isVirtual, true)
  assert.equal(rows.some(({ product_id }) => product_id === 'p3'), false)
})

test('status filters are limited to the existing listing values and safely derive review-needed rows', () => {
  const row = { listing_status: 'LISTED', marketplace: 'GRAILED', products: { status: 'sold', sales: [{ sold_via: 'PRELOVED' }] } }
  assert.deepEqual(LISTING_STATUSES, ['NOT_LISTED', 'DRAFT', 'LISTED', 'SOLD', 'REMOVED'])
  assert.equal(listingWorkspaceFilterMatches(row, 'LISTED'), true)
  assert.equal(listingWorkspaceFilterMatches(row, 'needs-review'), true)
  assert.equal(listingWorkspaceFilterMatches(row, 'DRAFT'), false)
  assert.equal(listingNeedsReview({ ...row, products: { status: 'available' } }), false)
  assert.equal(listingNeedsReview({ ...row, marketplace: 'PRELOVED' }), false)
})

test('listing row warns when sold inventory has an external listing that still needs checking', () => {
  assert.match(listingsSource, /role="alert">Barang sudah terjual, tetapi masih ada listing marketplace yang perlu dicek\./)
  assert.match(listingsSource, /const needsReview = listingNeedsReview\(listing\)/)
  assert.doesNotMatch(listingsSource, /from\('marketplace_listings'\)\.delete\(/)
})

test('global listing edit updates only tracker status, price, and URL; HTTP(S) validation remains enforced', () => {
  const existing = { listing_status: 'DRAFT', listed_at: null }
  assert.deepEqual(makeListingTrackerUpdate(existing, { listing_status: 'LISTED', listed_price: '450000', listing_url: 'https://grailed.com/item/1' }, '2026-09-27T00:00:00.000Z'), {
    listing_status: 'LISTED', listing_url: 'https://grailed.com/item/1', listed_price: 450000, listed_at: '2026-09-27T00:00:00.000Z', last_updated: '2026-09-27T00:00:00.000Z',
  })
  assert.throws(() => makeListingTrackerUpdate(existing, { listing_status: 'LISTED', listing_url: 'javascript:alert(1)' }), /http:\/\/ atau https:\/\//)
  assert.equal(safeHttpUrl('ftp://example.com'), null)
  assert.match(listingsSource, /from\('marketplace_listings'\)\.update\(updates\)\.eq\('id', editingListing\.id\)/)
  assert.match(listingsSource, /<select value=\{editingListing\.listing_status\}/)
  assert.match(listingsSource, /label>Status/)
  assert.match(listingsSource, /label>Harga listing/)
})

test('manual listing edit does not invoke AI or change Listing Generator behavior', () => {
  assert.doesNotMatch(listingsSource, /seller-ai|functions\.invoke|web_search|AIUsage/)
  assert.match(listingsSource, /Ubah status \/ harga \/ URL/)
  assert.match(generatorSource, /createListingGenerationBody\(item\.id, selected, newRequestId\(\)\)/)
  assert.match(generatorSource, /functions\.invoke\('seller-ai', \{ body \}\)/)
})

test('listing rows open the Product Detail Marketplace tab directly', () => {
  assert.match(workspaceSource, /onOpenProduct=\{\(productId\) => go\(`\/seller\/inventory\/\$\{productId\}\?tab=marketplace`\)\}/)
  assert.match(listingsSource, /onOpenProduct\(product\.id\)/)
  assert.match(sellerSource, /<ProductMarketplaceTab item=/)
})

test('sales ledger renders stored channel, date, revenue, cost, and profit fields without recalculating them', () => {
  for (const field of ['sale_price', 'sold_via', 'sold_at', 'gross_profit', 'net_profit', 'purchase_price', 'marketplace_fee', 'payment_fee', 'shipping_subsidy', 'other_cost']) {
    assert.ok(salesSource.includes(`sale.${field}`), `missing stored sales field ${field}`)
  }
  assert.match(salesSource, /Laba kotor/)
  assert.match(salesSource, /Laba bersih/)
  assert.match(salesSource, /Harga terjual/)
  assert.deepEqual(calculateProfit({ salePrice: 2250000, purchasePrice: 750000, marketplaceFee: 100000, paymentFee: 25000, shippingSubsidy: 50000, otherCost: 10000 }), { grossProfit: 1500000, netProfit: 1315000 })
})

test('the global Terjual card opens Product Detail Penjualan and shows actual stored cost details', () => {
  assert.match(workspaceSource, /onOpenProduct=\{\(productId\) => go\(`\/seller\/inventory\/\$\{productId\}\?tab=sales`\)\}/)
  assert.match(salesSource, /onOpenProduct\(sale\.product_id\)/)
  assert.match(salesSource, /Rincian biaya/)
  assert.match(sellerSource, /<ProductSalesTab item=/)
})

test('empty Listing and Terjual states use seller-facing Indonesian guidance', () => {
  assert.match(listingsSource, /Belum ada listing marketplace\./)
  assert.match(listingsSource, /Buka Barang/)
  assert.match(salesSource, /Belum ada transaksi terjual\./)
  assert.match(salesSource, /setSales\(\[\]\)/)
})

test('Seller authorization is preserved and Admin remains a superset', () => {
  assert.equal(canAccessWorkspaceSection('SELLER', 'listings'), true)
  assert.equal(canAccessWorkspaceSection('SELLER', 'sales'), true)
  assert.equal(canAccessWorkspaceSection('ADMIN', 'listings'), true)
  assert.equal(canAccessWorkspaceSection('ADMIN', 'sales'), true)
  assert.equal(canAccessWorkspaceSection('SELLER', 'ai-usage'), false)
  assert.equal(canAccessWorkspaceSection('ADMIN', 'ai-usage'), true)
})

test('both workspace tabs and listing edit controls remain keyboard reachable and announce selection', () => {
  assert.match(workspaceSource, /aria-current=\{activeTab === 'listings' \? 'page' : undefined\}/)
  assert.match(workspaceSource, /aria-current=\{activeTab === 'sales' \? 'page' : undefined\}/)
  assert.match(listingsSource, /aria-label=\{`Ubah listing \$\{marketplaceLabel\} untuk \$\{productTitle\}`\}/)
  assert.match(sellerStyles, /\.jualan-workspace-tabs a:focus-visible/)
  assert.match(sellerStyles, /\.listing-status-filters button:focus-visible/)
})

test('listing notes wrap and clamp; statuses and long titles remain contained on mobile', () => {
  assert.match(sellerStyles, /\.listing-info \.listing-note\{[^}]*overflow-wrap:anywhere/)
  assert.match(sellerStyles, /\.listing-note\{[^}]*-webkit-line-clamp:3/)
  assert.match(sellerStyles, /\.jualan-listing-row \.listing-title\{[^}]*font-size/)
  assert.match(sellerStyles, /\.listing-summary \.listing-status\{[^}]*overflow-wrap:anywhere/)
})

test('414px-class mobile layouts use contained min-width-safe cards, thumb-size controls, and iOS safe areas', () => {
  assert.match(sellerStyles, /\.jualan-listing-row\{grid-template-columns:68px minmax\(0,1fr\)/)
  assert.match(sellerStyles, /\.listing-status-filters button\{min-height:46px/)
  assert.match(sellerStyles, /\.jualan-workspace-tabs a\{min-height:52px/)
  assert.match(sellerStyles, /env\(safe-area-inset-top\)/)
  assert.match(sellerStyles, /env\(safe-area-inset-bottom\)/)
  assert.match(sellerStyles, /\.jualan-sale-card\{grid-template-columns:minmax\(0,1fr\)/)
  assert.match(productStyles, /\.product-workspace-modal\{[^}]*max-height:min\(90vh,860px\)/)
})

test('desktop remains a responsive compact workspace rather than a fixed-width spreadsheet', () => {
  assert.match(sellerStyles, /\.jualan-sale-card\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(150px,max-content\)/)
  assert.match(sellerStyles, /\.jualan-listing-row\{grid-template-columns:68px minmax\(0,1fr\) minmax\(116px,max-content\)/)
  assert.doesNotMatch(sellerStyles, /(?:^|[;{])\s*width:\s*(?:760|900|1000)px/)
})

test('workspace switches do not touch Hunter, AI, or database schema and no paid AI call is introduced', () => {
  assert.match(sellerSource, /<HuntingWorkspace path=\{workspacePath\} \/>/)
  assert.doesNotMatch(workspaceSource, /seller-ai|functions\.invoke|web_search|\.rpc\(/)
  assert.match(schema, /create table if not exists public\.marketplace_listings/)
  assert.match(schema, /create table if not exists public\.sales/)
})
