import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8')
const functionIndex = await readFile(new URL('../supabase/functions/seller-ai/index.ts', import.meta.url), 'utf8')
const storageMigration = await readFile(new URL('../supabase/migrations/20260927020000_security_remediation_b_storage.sql', import.meta.url), 'utf8')

test('Pages headers harden content handling, referrer, framing and browser permissions without a speculative CSP', () => {
  assert.match(headers, /X-Content-Type-Options: nosniff/)
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/)
  assert.match(headers, /X-Frame-Options: DENY/)
  assert.match(headers, /Permissions-Policy: camera=\(self\), microphone=\(\), geolocation=\(\)/)
  assert.doesNotMatch(headers, /Content-Security-Policy/i)
})

test('seller-ai uses the exact Supabase JS version resolved by the repository lockfile', async () => {
  const lockfile = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  assert.match(lockfile, /version: 2\.116\.0/)
  assert.match(functionIndex, /https:\/\/esm\.sh\/\@supabase\/supabase-js\@2\.116\.0/)
  assert.doesNotMatch(functionIndex, /https:\/\/esm\.sh\/\@supabase\/supabase-js\@2(?:['"]|\/)/)
})

test('storage lockdown only removes broad listing and unused legacy write policies', () => {
  assert.match(storageMigration, /Public can view product images/)
  assert.match(storageMigration, /Public can read product photos/)
  assert.match(storageMigration, /Admin can upload product photos/)
  assert.match(storageMigration, /Admin can delete product photos/)
  assert.doesNotMatch(storageMigration, /DROP TABLE|DELETE FROM|TRUNCATE|Staff can/i)
})
