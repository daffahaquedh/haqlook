import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { p256 } from 'npm:@noble/curves@2.4.0/nist.js'
import { sha1 } from 'npm:@noble/hashes@2.4.0/legacy.js'
import { createHandler } from './server.mjs'

const endpoint = 'https://akihuhhabslzhxyjxwoz.supabase.co/functions/v1/ebay-account-deletion'
const appId = 'daffahaq-HAQLOOKS-PRD-efb79df06-6b061f2d'

Deno.serve(createHandler({
  endpoint,
  appId,
  getSecret: (name: string) => Deno.env.get(name) || '',
  nobleCrypto: { p256, sha1 },
}))
