import { verifyEbaySignature } from '../supabase/functions/ebay-account-deletion/server.mjs'

const eBayFixture = {
  signatureHeader: 'eyJhbGciOiJlY2RzYSIsImtpZCI6Ijk5MzYyNjFhLTdkN2ItNDYyMS1hMGYxLTk2Y2NiNDI4YWY0OSIsInNpZ25hdHVyZSI6Ik1FWUNJUUNmeGZJV3V4bVdjSUJRSjljNS9YN2lHREpxczJSQ0dzQkVhQWppbnlycmZBSWhBSVY2d0djVGlCdVY1S0pVaWYyaG9reXJMK1E5c3NIa2FkK214Mm5FRTI1dyIsImRpZ2VzdCI6IlNIQTEifQ==',
  message: {
    metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION', schemaVersion: '1.0', deprecated: false },
    notification: {
      notificationId: '49feeaeb-4982-42d9-a377-9645b8479411_33f7e043-fed8-442b-9d44-791923bd9a6d',
      eventDate: '2021-03-19T20:43:59.462Z',
      publishDate: '2021-03-19T20:43:59.679Z',
      publishAttemptCount: 1,
      data: { username: 'test_user', userId: 'ma8vp1jySJC', eiasToken: 'nY+sHZ2PrBmdj6wVnY+sEZ2PrA2dj6wJnY+gAZGEpwmdj6x9nY+seQ==' },
    },
  },
  publicKey: '-----BEGIN PUBLIC KEY-----MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZhhxXKtR+TOvtDbgTPCkSof02qgBB7IsYOyf76ilExJ/upAa/vKIKheOoCyOpcLmi4t0b4uepb7LLjmMr90FUg==-----END PUBLIC KEY-----',
}

const signature = JSON.parse(atob(eBayFixture.signatureHeader)).signature

Deno.test('official eBay signature fixture verifies under the Deno node:crypto runtime', () => {
  if (!verifyEbaySignature(eBayFixture.message, signature, eBayFixture.publicKey)) {
    throw new Error('Official fixture did not verify')
  }
})

Deno.test('Deno node:crypto rejects a tampered payload', () => {
  const tampered = structuredClone(eBayFixture.message)
  tampered.notification.data.userId = 'modified-user'
  if (verifyEbaySignature(tampered, signature, eBayFixture.publicKey)) {
    throw new Error('Tampered payload was accepted')
  }
})

Deno.test('Deno node:crypto rejects malformed DER signature bytes', () => {
  let accepted = false
  try {
    accepted = verifyEbaySignature(eBayFixture.message, btoa('not-der'), eBayFixture.publicKey)
  } catch {
    return
  }
  if (accepted) throw new Error('Malformed signature was accepted')
})

