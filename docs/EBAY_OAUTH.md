# HAQLOOKS eBay Production OAuth

This integration is intentionally limited to connecting the single HAQLOOKS seller account. It does not publish listings, modify orders, or perform marketplace actions.

## Endpoints and pages

- eBay OAuth callback: https://akihuhhabslzhxyjxwoz.supabase.co/functions/v1/ebay-oauth-callback
- HAQLOOKS privacy policy: https://haqlooks.my.id/privacy
- OAuth accepted landing: https://haqlooks.my.id/seller/marketplace-settings
- OAuth declined landing: https://haqlooks.my.id/seller/marketplace-settings?ebay=cancelled
- Existing Production RuName: daffa_haque-daffahaq-HAQLOO-avhrixmb

## Server-side flow

1. An authenticated HAQLOOKS ADMIN asks the Edge Function to start OAuth.
2. The Edge Function verifies the Supabase user and the public.admins.role row, creates a cryptographically random state, stores only its SHA-256 hash with a 10-minute expiry, and returns the eBay Production authorization URL.
3. eBay sends the authorization code and state to the callback. The function atomically consumes the one-use state before exchanging the code at eBay's Production token endpoint.
4. EBAY_CLIENT_SECRET is read only inside the Edge Function. The access token is not persisted or returned. The refresh token and its expiry are stored in a single-row server-only table.
5. The callback redirects to the HAQLOOKS settings route with a fixed safe status. It never forwards code, state, tokens, or provider error text.

The Supabase gateway JWT check is disabled only on this callback function because eBay cannot send a HAQLOOKS JWT. Its browser POST actions perform their own Supabase JWT verification and require ADMIN. The callback GET requires a valid, unexpired one-time state.

## Data protection

The additive migration creates ebay_oauth_states and ebay_seller_credentials. Both have RLS enabled and privileges revoked from PUBLIC, anon, and authenticated; only service_role has table privileges. Browser code only receives connection metadata, never credential columns.

Configure the existing Production EBAY_CLIENT_SECRET in Supabase Edge Function Secrets. Do not add it to Vite variables, source files, .env, or Git.

The authorization request reuses the existing Production User Tokens scope selection exactly; it does not edit the eBay portal scopes. Review the permissions shown by eBay before the account owner consents.

This setup does not authorize the seller. The account owner must deliberately begin consent from the Admin Marketplace settings page after the RuName configuration is saved.
