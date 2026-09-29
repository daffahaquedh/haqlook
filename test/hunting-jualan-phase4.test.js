import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  SOURCING_CANDIDATE_STATUSES,
  huntingPathForTab,
  huntingTabForPath,
  jualanPathForTab,
  jualanTabForPath,
  safeHttpUrl,
  sourcingCandidateCanMoveToInventory,
} from '../src/seller-utils.js'

const [sellerSource, sellerStyles] = await Promise.all([
  readFile(new URL('../src/seller.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/seller.css', import.meta.url), 'utf8'),
])
const sourcingSource = sellerSource.slice(sellerSource.indexOf('function SourcingPage'), sellerSource.indexOf('function ListingsPage'))
const listingsSource = sellerSource.slice(sellerSource.indexOf('function ListingsPage'), sellerSource.indexOf('function SalesPage'))
const salesSource = sellerSource.slice(sellerSource.indexOf('function SalesPage'), sellerSource.indexOf('function AIUsagePage'))

test('Hunting and Jualan keep their existing legacy route mappings', () => {
  assert.equal(huntingTabForPath('/seller/ai-hunter'), 'research')
  assert.equal(huntingTabForPath('/seller/sourcing'), 'finds')
  assert.equal(huntingPathForTab('finds'), '/seller/sourcing')
  assert.equal(jualanTabForPath('/seller/listings'), 'listings')
  assert.equal(jualanTabForPath('/seller/sales'), 'sales')
  assert.equal(jualanPathForTab('sales'), '/seller/sales')
})

test('saved finds separate fetch errors from a genuine empty state and offer retry', () => {
  assert.match(sourcingSource, /const \[loadError, setLoadError\] = useState\(''\)/)
  assert.match(sourcingSource, /!loading && loadError && .*role="alert".*Coba lagi/)
  assert.match(sourcingSource, /!loading && !loadError && !items\.length/)
})

test('saved source links are rendered only from validated HTTP(S) URLs', () => {
  assert.equal(safeHttpUrl('https://example.com/item'), 'https://example.com/item')
  assert.equal(safeHttpUrl('javascript:alert(1)'), null)
  assert.match(sourcingSource, /const sourceUrl = safeHttpUrl\(candidate\.source_url\)/)
  assert.match(sourcingSource, /className="sourcing-source-link" href=\{sourceUrl\} target="_blank" rel="noreferrer"/)
})

test('candidate lifecycle values and conversion duplicate guard remain unchanged', () => {
  assert.deepEqual(SOURCING_CANDIDATE_STATUSES, ['WATCHING', 'CHECK', 'NEGOTIATING', 'BOUGHT', 'SKIPPED'])
  assert.equal(sourcingCandidateCanMoveToInventory({ status: 'BOUGHT', product_id: null }), true)
  assert.equal(sourcingCandidateCanMoveToInventory({ status: 'BOUGHT', product_id: 'p-1' }), false)
  assert.match(sourcingSource, /sourcingCandidateCanMoveToInventory\(candidate\)/)
  assert.match(sourcingSource, /convert_sourcing_to_inventory/)
})

test('Listing distinguishes data failure from no matching rows and keeps retry read-only', () => {
  assert.match(listingsSource, /if \(error\) setLoadError\(errorText\(error, 'Listing belum bisa dimuat\.'\)\)/)
  assert.match(listingsSource, /loadError \? <div className="seller-empty jualan-load-error" role="alert"/)
  assert.match(listingsSource, /onClick=\{\(\) => void load\(\)\}>Coba lagi/)
  assert.match(listingsSource, /: <div className="seller-empty listing-empty"/)
})

test('Terjual avoids false zero totals during loading/errors and keeps retry', () => {
  assert.match(salesSource, /!loading && !loadError && <section className="seller-finance-grid jualan-finance-grid">/)
  assert.match(salesSource, /loadError \? <div className="seller-empty jualan-load-error" role="alert"/)
  assert.match(salesSource, /onClick=\{\(\) => void load\(\)\}>Coba lagi/)
  assert.match(salesSource, /: <div className="seller-empty"><strong>Belum ada transaksi terjual\./)
})

test('Terjual identifies each transaction with its stored product image, channel, and date', () => {
  assert.match(salesSource, /imageFor\(sale\.products \|\| \{\}\).*loading="lazy"/)
  assert.match(salesSource, /marketplaceStatusLabel\(sale\.sold_via\) · \{dateLabel\(sale\.sold_at\)\}/)
  assert.match(sellerStyles, /\.jualan-sale-main>img\{display:block;width:52px;height:52px/)
})

test('Hunting/Jualan mobile controls and cards remain width-safe and touch-friendly', () => {
  assert.match(sellerStyles, /\.sourcing-source-link\{[^}]*min-height:44px/)
  assert.match(sellerStyles, /\.jualan-sale-main\{grid-template-columns:48px minmax\(0,1fr\)/)
  assert.match(sellerStyles, /\.jualan-sale-main \.listing-action-link\{min-height:44px/)
  assert.match(sellerStyles, /\.jualan-workspace-tabs a[^}]*min-height:54px/)
  assert.match(sellerStyles, /\.hunting-workspace-tabs a[^}]*min-height:52px/)
})

test('page-level Hunter and Jualan lists do not add AI calls or change AI behavior', () => {
  for (const source of [sourcingSource, listingsSource, salesSource]) {
    assert.doesNotMatch(source, /functions\.invoke|seller-ai|web_search/)
  }
})
