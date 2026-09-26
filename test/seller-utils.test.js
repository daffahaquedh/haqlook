import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_ONLY_SECTIONS, ADMIN_WORKSPACE_GROUPS, ADMIN_WORKSPACE_LINKS, budgetLabel, budgetTone, calculateProfit, canAccessWorkspaceSection, safeHttpUrl, SELLER_MOBILE_MORE_GROUPS, SELLER_MOBILE_PRIMARY_LINKS, SELLER_WORKSPACE_GROUPS, SELLER_WORKSPACE_LINKS, workspaceLinksForRole, workspaceMobileMoreGroupsForRole, workspaceNavigationGroupsForRole, workspacePathIsActive, workspacePathForLegacyAdmin } from '../src/seller-utils.js'

test('calculateProfit returns gross and net profit', () => {
  assert.deepEqual(calculateProfit({ salePrice: 2250000, purchasePrice: 750000, marketplaceFee: 100000, paymentFee: 25000, shippingSubsidy: 50000, otherCost: 10000 }), { grossProfit: 1500000, netProfit: 1315000 })
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
  assert.deepEqual(SELLER_WORKSPACE_GROUPS.map(({ label }) => label), ['OPERASIONAL', 'HUNTING', 'JUALAN'])
  assert.deepEqual(SELLER_WORKSPACE_LINKS.map(([href, label]) => [href, label]), [
    ['/seller', 'Beranda'], ['/seller/inventory', 'Barang'],
    ['/seller/ai-hunter', 'Riset'], ['/seller/sourcing', 'Temuan tersimpan'],
    ['/seller/listings', 'Listing'], ['/seller/sales', 'Terjual'],
  ])
  assert.equal(SELLER_WORKSPACE_LINKS.some(([href]) => href === '/seller/inventory/new'), false)
})

test('mobile navigation has five destinations and keeps Add Item contextual', () => {
  assert.deepEqual(SELLER_MOBILE_PRIMARY_LINKS.map(([, label]) => label), ['Beranda', 'Barang', 'Hunting', 'Jualan'])
  assert.deepEqual(SELLER_MOBILE_MORE_GROUPS.map(({ label }) => label), ['HUNTING', 'JUALAN'])
  assert.deepEqual(workspaceMobileMoreGroupsForRole('SELLER'), SELLER_MOBILE_MORE_GROUPS)
  const visibleSellerRoutes = [...SELLER_MOBILE_PRIMARY_LINKS, ...SELLER_MOBILE_MORE_GROUPS.flatMap(({ links }) => links)]
  assert.equal(visibleSellerRoutes.some(([href]) => href === '/seller/inventory/new'), false)
  assert.ok(visibleSellerRoutes.some(([href]) => href === '/seller/sourcing'))
  assert.ok(visibleSellerRoutes.some(([href]) => href === '/seller/sales'))
})

test('admin navigation adds only active insight and AI budget destinations', () => {
  assert.deepEqual(ADMIN_WORKSPACE_GROUPS.map(({ label }) => label), ['OPERASIONAL', 'HUNTING', 'JUALAN', 'INSIGHT', 'PENGATURAN'])
  assert.deepEqual(ADMIN_WORKSPACE_LINKS.map(([href, label]) => [href, label]), [
    ['/seller/analytics', 'Ringkasan bisnis'], ['/seller/hunter-analytics', 'Hunter'],
    ['/seller/ai-usage', 'Penggunaan AI'], ['/seller/settings', 'AI & Anggaran'],
  ])
  const routes = workspaceLinksForRole('ADMIN').map(([href]) => href)
  for (const unfinished of ['/seller/users-roles', '/seller/marketplace-settings', '/seller/app-settings']) assert.equal(routes.includes(unfinished), false)
  assert.deepEqual(workspaceNavigationGroupsForRole('SELLER'), SELLER_WORKSPACE_GROUPS)
  assert.deepEqual(workspaceMobileMoreGroupsForRole('ADMIN').map(({ label }) => label), ['HUNTING', 'JUALAN', 'INSIGHT', 'PENGATURAN'])
})

test('active navigation follows legacy deep links and keeps contextual Add under Barang', () => {
  assert.equal(workspacePathIsActive('/seller', '/seller'), true)
  assert.equal(workspacePathIsActive('/seller/inventory/new', '/seller/inventory'), true)
  assert.equal(workspacePathIsActive('/seller/sourcing', '/seller/ai-hunter'), true)
  assert.equal(workspacePathIsActive('/seller/sales', '/seller/listings'), true)
  assert.equal(workspacePathIsActive('/seller/inventory', '/seller'), false)
  assert.equal(workspacePathIsActive('/seller/ai-usage', '/seller/ai-usage'), true)
})

test('legacy /admin URL maps into the shared workspace', () => {
  assert.equal(workspacePathForLegacyAdmin('/admin'), '/seller')
  assert.equal(workspacePathForLegacyAdmin('/seller/inventory'), '/seller/inventory')
})
