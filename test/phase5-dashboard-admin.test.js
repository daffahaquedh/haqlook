import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ADMIN_ONLY_SECTIONS, ADMIN_SETTINGS_TABS, ADMIN_INSIGHT_TABS, adminInsightTabForPath, adminSettingsTabForPath, canAccessWorkspaceSection, workspacePathIsActive } from '../src/seller-utils.js'

const sellerSource = await readFile(new URL('../src/seller.jsx', import.meta.url), 'utf8')
const staffLoginSource = await readFile(new URL('../src/staff-auth.jsx', import.meta.url), 'utf8')
const dashboardSource = sellerSource.slice(sellerSource.indexOf('function SellerDashboard('), sellerSource.indexOf('function Stat('))

test('Beranda uses operational summaries and does not fetch AI usage or broad candidate records', () => {
  assert.doesNotMatch(dashboardSource, /seller_ai_usage_summary/)
  assert.doesNotMatch(dashboardSource, /from\('sourcing_candidates'\)\.select\('\*'/)
  assert.match(dashboardSource, /seller_dashboard_summary/)
  assert.match(dashboardSource, /status', 'BOUGHT'\)\.is\('product_id', null\)/)
  assert.match(dashboardSource, /listing_status', 'DRAFT'/)
})

test('Seller Beranda has a concise, action-first Indonesian home and no AI budget panel', () => {
  assert.match(dashboardSource, /title="Beranda" copy="Ringkasan usaha dan langkah yang bisa ditindaklanjuti\."/)
  for (const action of ['Tambah barang', 'Cek barang', 'Mulai hunting']) assert.ok(dashboardSource.includes(`title="${action}"`))
  assert.match(dashboardSource, /Barang tersedia/)
  assert.match(dashboardSource, /Modal berjalan/)
  assert.match(dashboardSource, /Laba bersih tercatat/)
  assert.doesNotMatch(dashboardSource, /AI BUDGET|Monthly usage/)
})

test('Shared Staff sign-in, Barang, and item-entry flows use Indonesian labels', () => {
  assert.match(sellerSource, /auth.state !== 'signed_in'.*StaffLogin/)
  assert.match(staffLoginSource, /<label>Email/)
  assert.match(staffLoginSource, /<label>Kata sandi/)
  assert.match(staffLoginSource, /Kembali ke etalase/)
  assert.match(sellerSource, /placeholder="Cari SKU, merek, atau nama barang…"/)
  assert.match(sellerSource, /<option value="capital">Modal tertinggi<\/option>/)
  assert.match(sellerSource, /title="Informasi barang"/)
  assert.match(sellerSource, /label="Modal pembelian"/)
  assert.match(sellerSource, /SIMPAN & TERSEDIA/)
  assert.match(sellerSource, /title="Edit barang"/)
  assert.match(sellerSource, /Tampilkan di etalase publik/)
})

test('Admin Insight retains all existing destinations inside one route-compatible workspace', () => {
  assert.deepEqual(ADMIN_INSIGHT_TABS.map(({ id, href }) => [id, href]), [
    ['business', '/seller/analytics'], ['hunter', '/seller/hunter-analytics'], ['ai-usage', '/seller/ai-usage'],
  ])
  for (const tab of ADMIN_INSIGHT_TABS) {
    assert.equal(adminInsightTabForPath(tab.href), tab.id)
    assert.equal(workspacePathIsActive(tab.href, '/seller/analytics'), true)
  }
  assert.match(sellerSource, /function AdminInsightWorkspace\(\{ path \}\)/)
})

test('Admin settings clearly separates active AI budget controls from unavailable destinations', () => {
  assert.deepEqual(ADMIN_SETTINGS_TABS.map(({ id, unavailable }) => [id, Boolean(unavailable)]), [
    ['users', true], ['marketplaces', true], ['ai-budget', false], ['app', true],
  ])
  for (const tab of ADMIN_SETTINGS_TABS) assert.equal(adminSettingsTabForPath(tab.href), tab.id)
  assert.match(sellerSource, /Kontrol untuk bagian ini belum disiapkan/)
  assert.match(sellerSource, /function AdminSettingsWorkspace\(\{ path \}\)/)
})

test('mobile Lainnya keeps account identity, role, and logout while Admin shortcuts stay grouped', () => {
  assert.match(sellerSource, /seller-more-head[\s\S]*?profile\.role === 'ADMIN' \? 'ADMIN' : 'SELLER'/)
  assert.match(sellerSource, /seller-more-logout/)
  assert.match(sellerSource, /workspaceMobileMoreGroupsForRole\(profile\.role\)/)
})

test('Admin-only pages remain protected independently of navigation visibility', () => {
  for (const section of ADMIN_ONLY_SECTIONS) {
    assert.equal(canAccessWorkspaceSection('SELLER', section), false)
    assert.equal(canAccessWorkspaceSection('ADMIN', section), true)
  }
  assert.match(sellerSource, /if \(!canAccessWorkspaceSection\(profile\.role, section\)\) page = <AccessDenied \/>/)
})

test('new workspace styles keep mobile layouts in the existing responsive breakpoint system', async () => {
  const css = await readFile(new URL('../src/seller.css', import.meta.url), 'utf8')
  assert.match(css, /\.dashboard-quick-actions\{display:grid/)
  assert.match(css, /\.admin-workspace-tabs\{position:sticky/)
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?\.dashboard-quick-actions\{/)
  assert.match(css, /env\(safe-area-inset-top\)/)
})
