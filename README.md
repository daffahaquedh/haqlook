# HAQLOOKS

Curated pre-owned sneaker storefront for HAQLOOK.

## Stack

- React + Vite
- Supabase Auth / Database / Storage
- Cloudflare Pages

## Seller Panel V1

The public storefront remains on `/`, `/shop`, `/product/:slug`, `/archive`, `/about`, and `/shipping`. The protected mobile-first operations workspace is available at `/seller` after the seller migration and Supabase user setup have been applied.

See [docs/SELLER_PANEL.md](docs/SELLER_PANEL.md) for the architecture, roles, migration, local setup, deployment, security notes, and future Telegram contract.

## Environment variables

Create these in Cloudflare Pages → Settings → Environment variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_WHATSAPP_NUMBER
VITE_AI_ENABLED
```

Use the Supabase Project URL and Publishable Key. Never place `service_role`, database password, or admin passwords in the frontend.

## Cloudflare Pages

Build command:

```text
npm run build
```

Build output directory:

```text
dist
```

The app uses Supabase RLS for public product reads and admin CRUD. Sold products remain visible in the Archive.

