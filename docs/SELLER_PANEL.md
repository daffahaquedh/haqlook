# HAQLOOKS Seller Panel V1

## Architecture

HAQLOOKS remains a React + Vite storefront deployed to Cloudflare Pages. The existing `products` table is extended into the master inventory so the public catalog does not need a second source of truth. Seller routes are isolated under `/seller`; they are not included in the customer navigation.

The seller workspace uses Supabase Auth and the `admins` table as the staff directory. `role` is either `ADMIN` or `SELLER`. Database functions and RLS enforce access on the server; the UI is not the security boundary.

Marketplace integrations are intentionally manual. HAQLOOKS stores listing status, URL, price, and timestamps for Haqlooks, Preloved, Grailed, Vestiaire, Carousell, and Instagram. It never logs into, scrapes, posts to, or removes listings from those services.

## Routes

- `/seller` — protected dashboard
- `/seller/inventory` — searchable, paginated master inventory
- `/seller/inventory/new` — mobile-first add item flow with up to 10 images
- `/seller/inventory/:id` — inventory detail, marketplace status, and sold flow
- `/seller/ai-hunter` — manual sourcing queue / future AI Hunter surface
- `/seller/sourcing` — sourcing candidate database and move-to-inventory flow
- `/seller/listings` — listing tracking overview
- `/seller/sales` — sales and profit ledger
- `/seller/ai-usage` — monthly budget and usage log
- `/seller/settings` — ADMIN-only budget configuration

## Database setup

1. Run `supabase/schema.sql` in a new Supabase project if the base schema does not exist.
2. Run `supabase/migrations/20260925_seller_panel_v1.sql` in the Supabase SQL editor or through the project migration workflow.
3. In Supabase Auth, create users without putting their passwords in this repository.
4. Add each staff user to `public.admins` using SQL in the Supabase dashboard, for example:

```sql
insert into public.admins (user_id, email, role)
values ('AUTH_USER_UUID', 'seller@example.com', 'SELLER');
```

The existing `product-images` bucket is reused. The migration keeps it public for storefront image reads and restricts writes to authenticated staff through Storage RLS.

## Environment variables

Frontend variables belong in local `.env` or Cloudflare Pages settings and must use only the public Supabase URL/key:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_WHATSAPP_NUMBER=628...
VITE_AI_ENABLED=false
```

Never put `service_role`, database passwords, marketplace credentials, or `OPENAI_API_KEY` in a `VITE_*` variable. `.env` is ignored by the repository workflow and `.env.example` contains placeholders only.

## Local development

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The seller UI requires a configured Supabase project and a staff Auth user. Without them, `/seller` deliberately remains signed out; it does not provide a fake authenticated dashboard.

## AI Item Analysis V1

`supabase/functions/seller-ai/index.ts` is the server-side `ITEM_ANALYSIS` endpoint. It authenticates the Supabase session, checks the `admins` role, loads the product through RLS, limits analysis to up to five optimized Supabase Storage image URLs, reserves monthly budget through `reserve_ai_usage`, calls OpenAI Responses with structured JSON output, and records actual token usage through `finalize_ai_usage`.

The default model is `gpt-5.6-luna`. The OpenAI key is read only from the encrypted Supabase Edge Function environment. Pricing is centralized in `supabase/functions/seller-ai/pricing.ts`; the model rates and IDR conversion can be overridden by server-side configuration. No `OPENAI_API_KEY` or service-role key belongs in Vite env, browser storage, source code, or GitHub.

The product detail action is intentionally review-first: AI output is shown in a mobile-friendly sheet, every mapped product field is opt-in, and `APPLY SUGGESTIONS` is the only path that updates the product. The result always carries `authenticity_not_verified` and `manual verification required`; AI never claims authentication.

When `OPENAI_API_KEY` is absent, or `VITE_AI_ENABLED=false`, the UI clearly reports that AI is not active and inventory remains usable. The current branch keeps the browser flag disabled until the server secret is configured and the Edge Function is verified on preview.

## Telegram plan

V1 does not deploy a Telegram bot. A future authenticated backend endpoint can accept an item draft from a bot:

```http
POST /api/inventory/from-chat
Authorization: Bearer <server-to-server-token>
Content-Type: application/json

{
  "title": "Stussy Work Jacket",
  "brand": "Stussy",
  "condition": "Good",
  "purchase_price": 750000,
  "source": "telegram",
  "source_url": "https://example.invalid/source"
}
```

The endpoint must authenticate the bot, validate the payload, create a master inventory record, and never post directly to an external marketplace.

## Security notes

- `/seller` is gated by Supabase Auth and an `ADMIN`/`SELLER` row.
- RLS protects products, listings, sales, sourcing, settings, usage, and image writes.
- Only ADMIN can delete inventory or edit app settings; both staff roles can operate inventory.
- Sold flow is an atomic server-side function and refuses a second sale.
- URLs are limited to `http`/`https` in the UI before persistence.
- React escapes user content; no HTML injection path is introduced.
- Image uploads are capped at 10 files and 8 MB per file in the client; Storage policies remain authoritative.
- AI prompt input is allow-listed and excludes buyer PII, passwords, payment data, and marketplace credentials.
- Marketplace listing changes remain manual and are never automated.
