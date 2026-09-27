-- Security Remediation A: close authenticated access to legacy accounting mutation RPCs.
-- New Edge Function versions use the *_server functions created by the preceding migration.
REVOKE ALL ON FUNCTION public.reserve_ai_usage(text, text, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_ai_usage(uuid, integer, integer, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_ai_usage(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_hunter_ai_usage(text, text, text, numeric, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_hunter_ai_usage(uuid, integer, integer, numeric, numeric, integer, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_listing_ai_usage(uuid, text, numeric) FROM PUBLIC, anon, authenticated, service_role;

-- Keep the ledger read-only to clients; writes occur only inside trusted definer RPCs.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.ai_usage FROM PUBLIC, anon, authenticated;

-- Remove every broad anon table grant, then grant only storefront projection columns.
REVOKE ALL PRIVILEGES ON TABLE public.products FROM anon;
REVOKE ALL PRIVILEGES (
  id, slug, name, brand, model, price_idr, price_usd, size_label, condition,
  description, status, featured, is_published, image_urls, created_at, updated_at,
  sku, category, subcategory, condition_notes, defects, purchase_price,
  suggested_price, minimum_price, currency, quantity, source, source_url,
  purchase_date, sold_at
) ON TABLE public.products FROM anon;

GRANT SELECT (
  id, slug, name, brand, model, price_idr, price_usd, size_label, condition,
  description, status, is_published, image_urls, created_at
) ON TABLE public.products TO anon;

-- RLS policies are intentionally unchanged: anonymous SELECT remains published-only.
NOTIFY pgrst, 'reload schema';

