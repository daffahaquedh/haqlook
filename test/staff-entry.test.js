import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8')
const seller = await readFile(new URL('../src/seller.jsx', import.meta.url), 'utf8')
const login = await readFile(new URL('../src/staff-auth.jsx', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/staff-entry.css', import.meta.url), 'utf8')

test('staff and legacy login routes share one role-neutral Staff Panel entry', () => {
  assert.match(main, /path==='\/staff' \|\| path==='\/admin\/login'\) page=<StaffLogin \/>/)
  assert.match(main, /path==='\/admin'\) page=<SellerApp path=\{path\} \/>/)
  assert.match(main, /path==='\/seller' \|\| path\.startsWith\('\/seller\/'\)\) page=<SellerApp path=\{path\} \/>/)
  assert.match(seller, /auth\.state !== 'signed_in'\) return <StaffLogin \/>/)
  assert.match(login, /HAQLOOKS \/ Staff Panel/)
  assert.match(login, /Email/)
  assert.match(login, /Kata sandi/)
  assert.doesNotMatch(login, /ADMIN LOGIN|PANEL SELLER/)
})

test('the public account entry is staff-safe and changes to Panel only for a verified staff role', () => {
  assert.match(main, /from\('admins'\)\.select\('user_id,role'\)/)
  assert.match(main, /\['ADMIN','SELLER'\]\.includes\(role\)/)
  assert.match(main, /staffEntry==='staff'\?'\/seller':'\/staff'/)
  assert.match(main, /Buka Panel/)
  assert.doesNotMatch(main, /service_role|SUPABASE_SERVICE_ROLE_KEY/i)
})

test('public mobile menu exposes Staff Login/Panel and closes after navigation', () => {
  assert.match(main, /aria-expanded=\{open\}/)
  assert.match(main, /aria-controls="public-navigation"/)
  assert.match(main, /onKeyDown|onkeydown/)
  assert.match(main, /onNavigate=\{closeMenu\}/)
  assert.match(main, /nav-account-secondary/)
  assert.match(main, /menuButtonRef\.current\?\.focus\(\)/)
})

test('shared login uses the existing Supabase Auth session and returns to the guarded workspace', () => {
  assert.match(login, /supabase\.auth\.signInWithPassword/)
  assert.match(login, /go\('\/seller'\)/)
  assert.match(seller, /\['ADMIN', 'SELLER'\]\.includes\(String\(profile\.role/)
  assert.match(seller, /path === '\/admin' && profile\.role !== 'ADMIN'/)
})

test('staff entry layout remains touch-sized, safe-area aware, and single-column on mobile', () => {
  assert.match(css, /min-height:100dvh/)
  assert.match(css, /env\(safe-area-inset-top\)/)
  assert.match(css, /env\(safe-area-inset-bottom\)/)
  assert.match(css, /min-height:48px/)
  assert.match(css, /@media\(max-width:820px\)\{\.staff-auth-page\{grid-template-columns:1fr/)
  assert.match(css, /@media\(max-width:760px\).*nav-account-secondary/s)
})
