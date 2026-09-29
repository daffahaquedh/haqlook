import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sellerSource = await readFile(new URL('../src/seller.jsx', import.meta.url), 'utf8')
const hunterSource = await readFile(new URL('../src/hunter.jsx', import.meta.url), 'utf8')
const homeCss = await readFile(new URL('../src/home-refinement.css', import.meta.url), 'utf8')
const aiUsageSource = sellerSource.slice(sellerSource.indexOf('function AIUsagePage()'), sellerSource.indexOf('function StoreContactPage()'))
const settingsSource = sellerSource.slice(sellerSource.indexOf('function SettingsPage()'))
const hunterAnalyticsSource = hunterSource.slice(hunterSource.indexOf('export function HunterAnalyticsPage()'), hunterSource.indexOf('function AnalyticsList('))

test('Admin AI usage and budget settings use clear Indonesian copy without changing data sources', () => {
  for (const label of ['ANGGARAN BULANAN', 'Riwayat penggunaan', 'Belum ada penggunaan AI', 'Diblokir']) assert.ok(aiUsageSource.includes(label))
  for (const label of ['Anggaran bulanan', 'Anggaran AI bulanan (IDR)', 'Simpan pengaturan', 'belum aktif']) assert.ok(settingsSource.includes(label))
  assert.match(aiUsageSource, /rpc\('seller_ai_usage_summary'\)/)
  assert.match(aiUsageSource, /from\('ai_usage'\)/)
  assert.match(settingsSource, /from\('app_settings'\)\.select\('value'\)/)
  assert.match(settingsSource, /from\('app_settings'\)\.upsert\(/)
  assert.doesNotMatch(aiUsageSource, /Usage is tracked server-side|MONTHLY BUDGET|NO AI USAGE/)
  assert.doesNotMatch(settingsSource, /Monthly AI budget|Save settings|Monthly budget/)
})

test('Hunter Insight presents aggregate sourcing metrics in Indonesian and keeps the same analytics RPC', () => {
  for (const label of ['Analitik Hunter', 'Destinasi paling sering diriset', 'Kategori rekomendasi terbanyak', 'Dicek → Dibeli', 'Dibeli → Terjual']) assert.ok(hunterAnalyticsSource.includes(label))
  assert.match(hunterAnalyticsSource, /rpc\('hunter_admin_analytics'\)/)
  assert.match(hunterAnalyticsSource, /Data pribadi pembeli maupun penjual tidak ditampilkan/)
  assert.doesNotMatch(hunterAnalyticsSource, /Most requested destinations|Most recommended categories|No buyer or seller PII/)
})

test('tablet navbar fit is corrected only at the crowded 761–819px breakpoint', () => {
  const tabletRule = homeCss.match(/@media \(min-width: 761px\) and \(max-width: 819px\) \{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(tabletRule, /\.nav-inner\s*\{\s*gap:\s*12px;/)
  assert.doesNotMatch(tabletRule, /overflow-x\s*:\s*hidden/)
  assert.match(homeCss, /\.nav-inner\s*\{\s*gap:\s*12px;/)
})
