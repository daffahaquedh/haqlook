-- Seller Panel V1 hardening.
-- This migration is additive and safe on the existing Haqlooks catalog.
-- It does not drop, truncate, or delete any production data.

-- Keep role lookup stable for RLS and avoid per-row auth function planning.
create or replace function public.current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.admins where user_id = (select auth.uid());
$$;

create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select public.current_user_role()) in ('ADMIN', 'SELLER'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select public.current_user_role()) = 'ADMIN', false);
$$;

-- These functions are called by RLS and by the application RPC flow.
revoke all on function public.current_user_role() from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Remove duplicate permissive ALL policies while preserving the same role checks.
drop policy if exists "Staff can manage marketplace listings" on public.marketplace_listings;
create policy "Staff can insert marketplace listings" on public.marketplace_listings
  for insert to authenticated
  with check ((select public.is_staff()));
create policy "Staff can update marketplace listings" on public.marketplace_listings
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
create policy "Staff can delete marketplace listings" on public.marketplace_listings
  for delete to authenticated
  using ((select public.is_staff()));

drop policy if exists "Staff can manage sourcing candidates" on public.sourcing_candidates;
create policy "Staff can insert sourcing candidates" on public.sourcing_candidates
  for insert to authenticated
  with check ((select public.is_staff()));
create policy "Staff can update sourcing candidates" on public.sourcing_candidates
  for update to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
create policy "Staff can delete sourcing candidates" on public.sourcing_candidates
  for delete to authenticated
  using ((select public.is_staff()));

drop policy if exists "Admins can manage app settings" on public.app_settings;
create policy "Admins can insert app settings" on public.app_settings
  for insert to authenticated
  with check ((select public.is_admin()));
create policy "Admins can update app settings" on public.app_settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "Admins can delete app settings" on public.app_settings
  for delete to authenticated
  using ((select public.is_admin()));

-- Missing FK indexes are cheap and keep staff screens/RPCs responsive.
create index if not exists ai_usage_user_id_idx on public.ai_usage(user_id);
create index if not exists app_settings_updated_by_idx on public.app_settings(updated_by);
create index if not exists sales_created_by_idx on public.sales(created_by);

-- The Data API needs table privileges in addition to RLS policies.
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.admins to authenticated;
grant select, insert, update, delete on public.marketplace_listings to authenticated;
grant select on public.sales to authenticated;
grant select, insert, update, delete on public.sourcing_candidates to authenticated;
grant select on public.app_settings to authenticated;
grant insert, update, delete on public.app_settings to authenticated;
grant select on public.ai_usage to authenticated;

-- RPCs are authenticated-only; no anonymous access is introduced.
revoke all on function public.mark_product_sold(uuid, text, bigint, bigint, bigint, bigint, bigint, text) from public;
revoke all on function public.convert_sourcing_to_inventory(uuid, bigint) from public;
revoke all on function public.seller_ai_usage_summary() from public;
revoke all on function public.seller_dashboard_summary() from public;
revoke all on function public.reserve_ai_usage(text, text, numeric) from public;
revoke all on function public.finalize_ai_usage(uuid, integer, integer, numeric) from public;
revoke all on function public.release_ai_usage(uuid) from public;
grant execute on function public.mark_product_sold(uuid, text, bigint, bigint, bigint, bigint, bigint, text) to authenticated;
grant execute on function public.convert_sourcing_to_inventory(uuid, bigint) to authenticated;
grant execute on function public.seller_ai_usage_summary() to authenticated;
grant execute on function public.seller_dashboard_summary() to authenticated;
grant execute on function public.reserve_ai_usage(text, text, numeric) to authenticated;
grant execute on function public.finalize_ai_usage(uuid, integer, integer, numeric) to authenticated;
grant execute on function public.release_ai_usage(uuid) to authenticated;

-- Legacy helper hardening; keep the trigger function working.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public';
    execute 'revoke all on function public.rls_auto_enable() from anon, authenticated';
  end if;
  if to_regprocedure('public.update_updated_at()') is not null then
    execute 'alter function public.update_updated_at() set search_path = pg_catalog';
  end if;
end;
$$;
