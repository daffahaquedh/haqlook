# Security Remediation A — High Findings

Baseline: `81bcc24778c3c67d639630cb4e57e91726d68b07`.

This change addresses only the two confirmed High findings.

## HIGH-01 — Public product column exposure

The storefront requires: `id, slug, name, brand, model, price_idr, price_usd, size_label, condition, description, status, is_published, image_urls, created_at`. The `is_published` filter remains because a logged-in staff session can otherwise see draft rows through the existing staff RLS policy. RLS continues to restrict anonymous reads to published rows.

Anonymous access to all other `products` columns is revoked at the database layer. Staff grants and product policies are unchanged. The frontend query uses the same explicit allowlist.

## HIGH-02 — AI usage accounting

The Edge Function authenticates the incoming JWT and confirms the `admins.role` is `ADMIN` or `SELLER` before it creates/uses the server-only accounting client. The service-role key stays in Supabase Edge Function environment variables; no Vite/browser key or local storage is used.

Reservation lifecycle is `RESERVED → FINALIZED`, `RESERVED → RELEASED`, or `RESERVED → EXPIRED`. Finalized usage cannot be finalized again, released, or deleted through client RPCs. Releases retain an audit row. Existing usage history defaults to `FINALIZED` and is not rewritten or deleted. The 5-minute reservation TTL is lazy-expired on the next reservation; budget queries exclude expired reservations even before cleanup. Budget checks use a single transaction advisory lock and existing monthly budget configuration. Existing `(user_id, request_key)` uniqueness is reused; a duplicate request never calls the provider again.

Rollout is split to prevent accounting downtime:
1. Add lifecycle and service-only RPCs while legacy grants remain, so the current Edge version continues working.
2. Deploy the compatible Edge version, which uses the server-only RPCs.
3. Deploy the lock-down grants and anonymous product column grants.

## Rollback notes

No rollback has been executed. Preserve the additive lifecycle columns and all existing usage rows.

- If storefront projection causes a regression, keep the explicit projection and published RLS policy; fix only the missing required public field. Do not restore broad anon `SELECT *`.
- If the accounting Edge version fails before lock-down, the old Edge version and legacy RPCs are still available. After lock-down, prefer deploying a corrected server-accounting Edge Function. Regranting legacy RPCs and deploying old Edge code is an emergency-only rollback because it reopens the confirmed vulnerability.
- If the additive reservation columns are no longer used, leave them in place. Do not drop the columns or delete accounting history as part of rollback.
- Cloudflare Pages can be rolled back to the previous deployment; keep the database column restriction in place and deploy a projection-compatible frontend.

This does not fix any Security Remediation B finding.

