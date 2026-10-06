# eBay Marketplace Account Deletion callback

The `ebay-account-deletion` Supabase Edge Function is the Production-only eBay notification callback. It supports eBay's `GET ?challenge_code=...` handshake and signed `MARKETPLACE_ACCOUNT_DELETION` POST notifications.

## Server-side configuration

Set these values in Supabase Edge Function secrets; never put them in Vite variables, browser storage, or Git:

- `EBAY_DELETION_VERIFY_TOKEN`: a newly generated 32–80 character token using only letters, digits, `_`, or `-`. Use the same value in eBay's verification-token field.
- `EBAY_CLIENT_SECRET`: the existing Production eBay Cert ID / Client Secret, entered by the owner directly in Supabase; it is used only to obtain an eBay application access token for public-key lookup.

The non-secret Production App ID and exact callback URL are scoped in the Edge Function source. The callback URL used for the eBay challenge is `https://akihuhhabslzhxyjxwoz.supabase.co/functions/v1/ebay-account-deletion` and must match the portal value exactly.

## Notification behavior and data scope

The function validates the expected payload shape and verifies `x-ebay-signature` against eBay's public key before acknowledging with `204`. Public keys are cached in memory for one hour; eBay application tokens are cached until shortly before expiration. Request bodies are bounded, and payload contents, user IDs, EIAS tokens, signatures, and credentials are not logged.

The current HAQLOOKS schema and application do not persist eBay user/customer data, so a verified deletion notification is acknowledged without deleting unrelated HAQLOOKS products, sales, or other records. If a future eBay integration stores user data, its deletion mapping and deletion workflow must be implemented before that data is persisted.

Only this endpoint has JWT verification disabled because eBay calls it without a HAQLOOKS user JWT. `seller-ai` retains JWT verification.
