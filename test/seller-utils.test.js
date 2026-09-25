import test from 'node:test'
import assert from 'node:assert/strict'
import { budgetLabel, budgetTone, calculateProfit, safeHttpUrl } from '../src/seller-utils.js'

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
