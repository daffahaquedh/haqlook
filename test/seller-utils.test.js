import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_ONLY_SECTIONS, ADMIN_SETTINGS_TABS, ADMIN_INSIGHT_TABS, ADMIN_WORKSPACE_GROUPS, ADMIN_WORKSPACE_LINKS, adminInsightTabForPath, adminSettingsTabForPath, budgetLabel, budgetTone, calculateProfit, canAccessWorkspaceSection, huntingPathForTab, huntingTabForPath, inventoryStatusLabel, safeHttpUrl, SELLER_MOBILE_MORE_GROUPS, SELLER_MOBILE_PRIMARY_LINKS, SELLER_WORKSPACE_GROUPS, SELLER_WORKSPACE_LINKS, sourcingCandidateCanMoveToInventory, sourcingCandidateIsInInventory, sourcingCandidateStatusLabel, workspaceLinksForRole, workspaceMobileMoreGroupsForRole, workspaceNavigationGroupsForRole, workspacePathIsActive, workspacePathForLegacyAdmin } from '../src/seller-utils.js'

test('calculateProfit returns gross and net profit', () => {
  assert.deepEqual(calculateProfit({ salePrice: 2250000, purchasePrice: 750000, marketplaceFee: 100000, paymentFee: 25000, shippingSubsidy: 50000, otherCost: 10000 }), { grossProfit: 1500000, netProfit: 1315000 })
})

test('inventory statuses use seller-friendly Indonesian labels without changing stored values', () => {
  assert.deepEqual(['draft', 'available', 'reserved', 'sold', 'archived'].map(inventoryStatusLabel), ['Draf', 'Tersedia', 'Dipesan', 'Terjual', 'Diarsipkan'])
})

test('budget guard display thresholds are deterministic', () => {
  assert.equal(budgetTone(40000, 100000), 'green')
  assert.equal(budgetTone(50000, 100000), 'yellow')
  assert.equal(budgetTone(75000, 100000), 'orange')
  assert.equal(budgetTone(90000, 100000), 'red')
  assert.equal(budgetLabel(100000, 100000), 'AI calls blocked')
})

test('unsafe URLs are rejected before persistence', () => {
  assert.equal(safeHttpUrl('https://grailed.com/item/1'), 'https://grailed.com/item/1')
  assert.equal(safeHttpUrl('javascript:alert(1)'), null)
  assert.equal(safeHttpUrl('not a URL'), null)
})

test('ADMIN workspace includes every seller route and admin tools', () => {
  const links = workspaceLinksForRole('ADMIN')
  for (const [href] of SELLER_WORKSPACE_LINKS) assert.ok(links.some(([candidate]) => candidate === href))
  for (const [href] of ADMIN_WORKSPACE_LINKS) assert.ok(links.some(([candidate]) => candidate === href))
  assert.deepEqual(ADMIN_ONLY_SECTIONS, ['analytics', 'hunter-analytics', 'ai-usage', 'users-roles', 'marketplace-settings', 'settings', 'app-settings'])
})

test('SELLER workspace omits admin menus and cannot enter admin-only sections', () => {
  const links = workspaceLinksForRole('SELLER')
  assert.deepEqual(links, SELLER_WORKSPACE_LINKS)
  for (const section of ADMIN_ONLY_SECTIONS) assert.equal(canAccessWorkspaceSection('SELLER', section), false)
  assert.equal(canAccessWorkspaceSection('SELLER', 'inventory'), true)
  assert.equal(canAccessWorkspaceSection('ADMIN', 'settings'), true)
})

test('seller navigation uses the approved Indonesian operational groups without a permanent Add destination', () => {
  assert.deepEqual(SELLER_WORKSPACE_GROUPS.map(({ label }) => label), ['OPERASIONAL'])
  assert.deepEqual(SELLER_WORKSPACE_LINKS.map(([href, label]) => [href, label]), [
    ['/seller', 'Beranda'], ['/seller/inventory', 'Barang'],
    ['/seller/ai-hunter', 'Hunting'],
    ['/seller/listings', 'Jualan'],
  ])
  assert.equal(SELLER_WORKSPACE_LINKS.some(([href]) => href === '/seller/inventory/new'), false)
  assert.equal(workspacePathIsActive('/seller/sales', '/seller/listings'), true)
})

test('mobile navigation has five destinations and keeps Add Item contextual', () => {
  assert.deepEqual(SELLER_MOBILE_PRIMARY_LINKS.map(([, label]) => label), ['Beranda', 'Barang', 'Hunting', 'Jualan'])
  assert.deepEqual(SELLER_MOBILE_MORE_GROUPS.map(({ label }) => label), ['JUALAN'])
  assert.deepEqual(workspaceMobileMoreGroupsForRole('SELLER'), SELLER_MOBILE_MORE_GROUPS)
  const visibleSellerRoutes = [...SELLER_MOBILE_PRIMARY_LINKS, ...SELLER_MOBILE_MORE_GROUPS.flatMap(({ links }) => links)]
  assert.equal(visibleSellerRoutes.some(([href]) => href === '/seller/inventory/new'), false)
  assert.ok(visibleSellerRoutes.some(([href]) => href === '/seller/sales'))
})

test('admin navigation groups insight and settings while legacy destinations remain in workspace tabs', () => {
  assert.deepEqual(ADMIN_WORKSPACE_GROUPS.map(({ label }) => label), ['OPERASIONAL', 'INSIGHT', 'PENGATURAN'])
  assert.deepEqual(ADMIN_WORKSPACE_LINKS.map(([href, label]) => [href, label]), [
    ['/seller/analytics', 'Insight'], ['/seller/settings', 'Pengaturan'],
  ])
  assert.deepEqual(ADMIN_INSIGHT_TABS.map(({ href }) => href), ['/seller/analytics', '/seller/hunter-analytics', '/seller/ai-usage'])
  assert.deepEqual(ADMIN_SETTINGS_TABS.map(({ href }) => href), ['/seller/users-roles', '/seller/marketplace-settings', '/seller/settings', '/seller/app-settings'])
  assert.deepEqual(ADMIN_SETTINGS_TABS.filter(({ unavailable }) => unavailable).map(({ label }) => label), ['Pengguna & Peran', 'Marketplace', 'Aplikasi'])
  const routes = workspaceLinksForRole('ADMIN').map(([href]) => href)
  for (const unfinished of ['/seller/users-roles', '/seller/marketplace-settings', '/seller/app-settings']) assert.equal(routes.includes(unfinished), false)
  assert.deepEqual(workspaceNavigationGroupsForRole('SELLER'), SELLER_WORKSPACE_GROUPS)
  assert.deepEqual(workspaceMobileMoreGroupsForRole('ADMIN').map(({ label }) => label), ['JUALAN', 'ADMIN'])
})

test('active navigation follows legacy deep links and keeps contextual Add under Barang', () => {
  assert.equal(workspacePathIsActive('/seller', '/seller'), true)
  assert.equal(workspacePathIsActive('/seller/inventory/new', '/seller/inventory'), true)
  assert.equal(workspacePathIsActive('/seller/sourcing', '/seller/ai-hunter'), true)
  assert.equal(workspacePathIsActive('/seller/ai-hunter', '/seller/ai-hunter'), true)
  assert.equal(workspacePathIsActive('/seller/sales', '/seller/listings'), true)
  assert.equal(workspacePathIsActive('/seller/inventory', '/seller'), false)
  assert.equal(workspacePathIsActive('/seller/ai-usage', '/seller/ai-usage'), true)
  for (const route of ['/seller/analytics', '/seller/hunter-analytics', '/seller/ai-usage']) assert.equal(workspacePathIsActive(route, '/seller/analytics'), true)
  for (const route of ['/seller/settings', '/seller/users-roles', '/seller/marketplace-settings', '/seller/app-settings']) assert.equal(workspacePathIsActive(route, '/seller/settings'), true)
  assert.equal(adminInsightTabForPath('/seller/ai-usage'), 'ai-usage')
  assert.equal(adminSettingsTabForPath('/seller/marketplace-settings'), 'marketplaces')
})

test('Hunting legacy routes select matching workspace view and remain direct-link compatible', () => {
  assert.equal(huntingTabForPath('/seller/ai-hunter'), 'research')
  assert.equal(huntingTabForPath('/seller/sourcing'), 'finds')
  assert.equal(huntingPathForTab('research'), '/seller/ai-hunter')
  assert.equal(huntingPathForTab('finds'), '/seller/sourcing')
})

test('existing sourcing statuses receive seller labels without changing database values', () => {
  assert.deepEqual(['WATCHING', 'CHECK', 'NEGOTIATING', 'BOUGHT', 'SKIPPED'].map(sourcingCandidateStatusLabel), [
    'Dipantau', 'Perlu dicek', 'Negosiasi', 'Dibeli', 'Dilewati',
  ])
})

test('only a bought, not-yet-converted candidate offers inventory conversion', () => {
  assert.equal(sourcingCandidateCanMoveToInventory({ status: 'BOUGHT', product_id: null }), true)
  assert.equal(sourcingCandidateCanMoveToInventory({ status: 'WATCHING', product_id: null }), false)
  assert.equal(sourcingCandidateCanMoveToInventory({ status: 'BOUGHT', product_id: 'product-1' }), false)
  assert.equal(sourcingCandidateIsInInventory({ status: 'BOUGHT', product_id: 'product-1' }), true)
  assert.equal(sourcingCandidateIsInInventory({ status: 'BOUGHT', product_id: null }), false)
})

test('legacy /admin URL maps into the shared workspace', () => {
  assert.equal(workspacePathForLegacyAdmin('/admin'), '/seller')
  assert.equal(workspacePathForLegacyAdmin('/seller/inventory'), '/seller/inventory')
})
