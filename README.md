# HAQLOOK

Curated pre-owned sneaker storefront for HAQLOOK.

## Stack

- React + Vite
- Supabase Auth / Database / Storage
- Cloudflare Pages

## Environment variables

Create these in Cloudflare Pages → Settings → Environment variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_WHATSAPP_NUMBER
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
