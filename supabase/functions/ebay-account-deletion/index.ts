import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createHandler } from './server.mjs'

const endpoint = 'https://akihuhhabslzhxyjxwoz.supabase.co/functions/v1/ebay-account-deletion'
const appId = 'daffahaq-HAQLOOKS-PRD-efb79df06-6b061f2d'

Deno.serve(createHandler({
  endpoint,
  appId,
  getSecret: (name) => Deno.env.get(name) || '',
}))
