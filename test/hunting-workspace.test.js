import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { huntingPathForTab, huntingTabForPath, sourcingCandidateCanMoveToInventory, sourcingCandidateIsInInventory, sourcingCandidateStatusLabel } from '../src/seller-utils.js'

const [sellerSource, hunterSource, sellerStyles, hunterStyles, conversionMigration] = await Promise.all([
  readFile(new URL('../src/seller.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/hunter.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/seller.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/hunter.css', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260926082014_hunter_sourcing_copilot_v1.sql', import.meta.url), 'utf8'),
])

test('legacy AI Hunter route opens HAQ AI chat while Riset and Sourcing links remain available', () => {
  assert.equal(huntingTabForPath('/seller/ai-hunter'), 'chat')
  assert.equal(huntingTabForPath('/seller/ai-hunter/research'), 'research')
  assert.equal(huntingTabForPath('/seller/sourcing'), 'finds')
  assert.equal(huntingPathForTab('chat'), '/seller/ai-hunter')
  assert.equal(huntingPathForTab('research'), '/seller/ai-hunter/research')
  assert.equal(huntingPathForTab('finds'), '/seller/sourcing')
  assert.match(sellerSource, /section === 'ai-hunter' \|\| section === 'sourcing'.*<HuntingWorkspace path=\{workspacePath\} \/>/)
})

test('HAQ AI, Riset and Temuan tabs expose selected states and preserve existing URLs', () => {
  assert.match(sellerSource, /<nav className="hunting-workspace-tabs" aria-label="HAQ AI">/)
  assert.match(sellerSource, /href="\/seller\/ai-hunter" aria-current=\{activeTab === 'chat' \? 'page' : undefined\}/)
  assert.match(sellerSource, /href="\/seller\/ai-hunter\/research" aria-current=\{activeTab === 'research' \? 'page' : undefined\}/)
  assert.match(sellerSource, /href="\/seller\/sourcing" aria-current=\{activeTab === 'finds' \? 'page' : undefined\}/)
})

test('HAQ AI, Riset and Temuan views mount lazily and stay mounted when tab selection changes', () => {
  assert.match(sellerSource, /const \[visitedTabs, setVisitedTabs\] = useState\(\(\) => new Set\(\[activeTab\]\)\)/)
  assert.match(sellerSource, /visitedTabs\.has\('chat'\).*<HaqAIChatPage/)
  assert.match(sellerSource, /visitedTabs\.has\('research'\).*<HunterChatPage embedded/)
  assert.match(sellerSource, /visitedTabs\.has\('finds'\).*<SourcingPage embedded/)
  assert.match(sellerSource, /hidden=\{activeTab !== 'chat'\}/)
  assert.match(sellerSource, /hidden=\{activeTab !== 'research'\}/)
  assert.match(sellerSource, /hidden=\{activeTab !== 'finds'\}/)
})

test('research save clearly indicates an existing find and offers a direct Temuan handoff', () => {
  assert.match(hunterSource, /const existing = sourceCandidates\[target\.target_id\]/)
  assert.match(hunterSource, /✓ Sudah disimpan/)
  assert.match(hunterSource, /Lihat Temuan/)
  assert.match(hunterSource, /Simpan ke Temuan/)
  assert.match(sellerSource, /onOpenFinds=\{\(\) => go\('\/seller\/sourcing'\)\}/)
})

test('existing persisted candidate statuses are shown in seller language without new enum values', () => {
  assert.deepEqual(['WATCHING', 'CHECK', 'NEGOTIATING', 'BOUGHT', 'SKIPPED'].map(sourcingCandidateStatusLabel), ['Dipantau', 'Perlu dicek', 'Negosiasi', 'Dibeli', 'Dilewati'])
  assert.match(sellerSource, /SOURCING_CANDIDATE_STATUSES\.map/)
  assert.match(sellerSource, /status: 'WATCHING'/)
})

test('only purchased, unconverted candidates show the existing inventory conversion action', () => {
  assert.equal(sourcingCandidateCanMoveToInventory({ status: 'BOUGHT', product_id: null }), true)
  assert.equal(sourcingCandidateCanMoveToInventory({ status: 'CHECK', product_id: null }), false)
  assert.equal(sourcingCandidateCanMoveToInventory({ status: 'BOUGHT', product_id: 'product-id' }), false)
  assert.match(sellerSource, /supabase\.rpc\('convert_sourcing_to_inventory', \{ p_candidate_id: candidate\.id, p_purchase_price: purchasePrice \}\)/)
  assert.match(sellerSource, /\{canMove && <div className="move-inventory">/)
  assert.match(conversionMigration, /if candidate\.status = 'BOUGHT' and candidate\.product_id is not null then return candidate\.product_id;/)
})

test('successful conversion shows final state and opens the created Product Detail explicitly', () => {
  assert.equal(sourcingCandidateIsInInventory({ status: 'BOUGHT', product_id: 'product-id' }), true)
  assert.match(sellerSource, /Temuan berhasil dipindahkan ke Barang/)
  assert.match(sellerSource, /Buka barang →/)
  assert.match(sellerSource, /go\(`\/seller\/inventory\/\$\{productId\}`\)/)
  assert.doesNotMatch(sellerSource, /Candidate moved to master inventory/)
})

test('unknown prices remain visibly unknown and long saved notes have a compact expandable treatment', () => {
  assert.match(sellerSource, /hasMaxBuy \? moneyIdr\(candidate\.max_buy_price\) : 'Belum ditetapkan'/)
  assert.match(sellerSource, /hasResaleRange \? `\$\{moneyIdr\(candidate\.estimated_resale_min\)\}–\$\{moneyIdr\(candidate\.estimated_resale_max\)\}` : 'Belum ada data'/)
  assert.match(sellerSource, /<details className="sourcing-card-notes">/)
  assert.match(sellerStyles, /\.sourcing-card-notes p\{[^}]*-webkit-line-clamp:4/)
  assert.match(sellerStyles, /\.sourcing-card-notes\[open\] p\{display:block/)
})

test('empty saved-finds state guides the seller back to Riset', () => {
  assert.match(sellerSource, /Belum ada temuan tersimpan\./)
  assert.match(sellerSource, /Simpan target dari Riset untuk memantaunya di sini\./)
  assert.match(sellerSource, /Mulai Riset →/)
  assert.match(sellerSource, /onOpenResearch=\{\(\) => go\('\/seller\/ai-hunter\/research'\)\}/)
})

test('mobile Hunting tabs and candidate controls keep touch sizing and iOS safe-area spacing', () => {
  assert.match(sellerStyles, /\.hunting-workspace-tabs a\{[^}]*min-height:52px/)
  assert.match(sellerStyles, /\.hunting-workspace-tabs\{[^}]*env\(safe-area-inset-top\)/)
  assert.match(sellerStyles, /\.sourcing-status-control select\{[^}]*min-height:44px/)
  assert.match(sellerStyles, /\.sourcing-status-control select\{[^}]*min-height:48px/)
  assert.match(sellerStyles, /\.sourcing-card-title h2\{[^}]*overflow-wrap:anywhere/)
  assert.match(hunterStyles, /\.hunter-target-actions \.hunter-saved-state\{[^}]*min-height:44px/)
})

test('Hunter React workspace still uses only the existing paid action gates and does not call AI on tab selection', () => {
  assert.match(sellerSource, /onClick=\{\(event\) => selectTab\(event, 'research'\)\}/)
  assert.doesNotMatch(sellerSource.slice(sellerSource.indexOf('function HuntingWorkspace'), sellerSource.indexOf('function SellerSidebar')), /callHunterFunction|seller-ai|web_search|rpc\(/)
  assert.match(hunterSource, /onClick=\{\(\) => void confirmResearch\(\)\}/)
  assert.match(hunterSource, /onConfirmRefresh=\{\(\) => void confirmRefresh\(\)\}/)
})
