import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_ONLY_SECTIONS, ADMIN_WORKSPACE_LINKS, budgetLabel, budgetTone, calculateProfit, canAccessWorkspaceSection, safeHttpUrl, SELLER_WORKSPACE_LINKS, workspaceLinksForRole, workspacePathForLegacyAdmin } from '../src/seller-utils.js'

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
  assert.deepEqual(ADMIN_ONLY_SECTIONS, ['analytics', 'ai-usage', 'users-roles', 'marketplace-settings', 'settings', 'app-settings'])
})

test('SELLER workspace omits admin menus and cannot enter admin-only sections', () => {
  const links = workspaceLinksForRole('SELLER')
  assert.deepEqual(links, SELLER_WORKSPACE_LINKS)
  for (const section of ADMIN_ONLY_SECTIONS) assert.equal(canAccessWorkspaceSection('SELLER', section), false)
  assert.equal(canAccessWorkspaceSection('SELLER', 'inventory'), true)
  assert.equal(canAccessWorkspaceSection('ADMIN', 'settings'), true)
})

test('legacy /admin URL maps into the shared workspace', () => {
  assert.equal(workspacePathForLegacyAdmin('/admin'), '/seller')
  assert.equal(workspacePathForLegacyAdmin('/seller/inventory'), '/seller/inventory')
})
