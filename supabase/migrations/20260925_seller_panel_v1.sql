-- HAQLOOKS Seller Panel V1
-- Safe to run after supabase/schema.sql. This migration extends products instead
-- of creating a second inventory table, so the public storefront keeps its data.

alter table public.admins add column if not exists role text not null default 'ADMIN';
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check (role in ('ADMIN', 'SELLER'));

create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.admins where user_id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_user_role() in ('ADMIN', 'SELLER'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_user_role() = 'ADMIN', false);
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

alter table public.products add column if not exists sku text;
alter table public.products add column if not exists category text;
alter table public.products add column if not exists subcategory text;
alter table public.products add column if not exists condition_notes text;
alter table public.products add column if not exists defects text;
alter table public.products add column if not exists purchase_price bigint not null default 0;
alter table public.products add column if not exists suggested_price bigint not null default 0;
alter table public.products add column if not exists minimum_price bigint not null default 0;
alter table public.products add column if not exists currency text not null default 'IDR';
alter table public.products add column if not exists quantity integer not null default 1;
alter table public.products add column if not exists source text;
alter table public.products add column if not exists source_url text;
alter table public.products add column if not exists purchase_date date;
alter table public.products add column if not exists sold_at timestamptz;
alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (status in ('draft', 'available', 'reserved', 'sold', 'archived'));
alter table public.products drop constraint if exists products_quantity_check;
alter table public.products add constraint products_quantity_check check (quantity >= 0);

update public.products
set suggested_price = price_idr
where suggested_price = 0 and price_idr <> 0;

with ranked as (
  select id, row_number() over (order by created_at, id) as number
  from public.products
  where sku is null
)
update public.products p
set sku = 'HL-' || lpad(r.number::text, 4, '0')
from ranked r
where p.id = r.id;

create unique index if not exists products_sku_unique_idx on public.products(sku);
create index if not exists products_status_created_idx on public.products(status, created_at desc);
create index if not exists products_brand_idx on public.products(lower(brand));

create or replace function public.assign_inventory_sku()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare next_number integer;
begin
  if new.sku is null or btrim(new.sku) = '' then
    perform pg_advisory_xact_lock(783491);
    select coalesce(max((substring(sku from '^HL-(\d+)$'))::integer), 0) + 1
      into next_number
      from public.products;
    new.sku := 'HL-' || lpad(next_number::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists products_assign_inventory_sku on public.products;
create trigger products_assign_inventory_sku
before insert on public.products
for each row execute function public.assign_inventory_sku();

drop policy if exists "Admins can manage products" on public.products;
drop policy if exists "Staff can read all products" on public.products;
drop policy if exists "Staff can insert products" on public.products;
drop policy if exists "Staff can update products" on public.products;
drop policy if exists "Admins can delete products" on public.products;
create policy "Staff can read all products" on public.products for select to authenticated using (public.is_staff());
create policy "Staff can insert products" on public.products for insert to authenticated with check (public.is_staff());
create policy "Staff can update products" on public.products for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "Admins can delete products" on public.products for delete to authenticated using (public.is_admin());

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  marketplace text not null check (marketplace in ('HAQLOOKS', 'PRELOVED', 'GRAILED', 'VESTIAIRE', 'CAROUSELL', 'INSTAGRAM')),
  listing_status text not null default 'NOT_LISTED' check (listing_status in ('NOT_LISTED', 'DRAFT', 'LISTED', 'SOLD', 'REMOVED')),
  listing_url text,
  listed_price bigint not null default 0 check (listed_price >= 0),
  listed_at timestamptz,
  last_updated timestamptz not null default now(),
  unique(product_id, marketplace)
);
alter table public.marketplace_listings enable row level security;
drop policy if exists "Staff can read marketplace listings" on public.marketplace_listings;
drop policy if exists "Staff can manage marketplace listings" on public.marketplace_listings;
create policy "Staff can read marketplace listings" on public.marketplace_listings for select to authenticated using (public.is_staff());
create policy "Staff can manage marketplace listings" on public.marketplace_listings for all to authenticated using (public.is_staff()) with check (public.is_staff());
create index if not exists marketplace_listings_product_idx on public.marketplace_listings(product_id, marketplace);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete restrict,
  sold_via text not null check (sold_via in ('HAQLOOKS', 'PRELOVED', 'GRAILED', 'VESTIAIRE', 'CAROUSELL', 'INSTAGRAM', 'OTHER')),
  sale_price bigint not null check (sale_price >= 0),
  purchase_price bigint not null default 0 check (purchase_price >= 0),
  marketplace_fee bigint not null default 0 check (marketplace_fee >= 0),
  payment_fee bigint not null default 0 check (payment_fee >= 0),
  shipping_subsidy bigint not null default 0 check (shipping_subsidy >= 0),
  other_cost bigint not null default 0 check (other_cost >= 0),
  gross_profit bigint not null default 0,
  net_profit bigint not null default 0,
  notes text,
  sold_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id)
);
alter table public.sales enable row level security;
drop policy if exists "Staff can read sales" on public.sales;
create policy "Staff can read sales" on public.sales for select to authenticated using (public.is_staff());
create index if not exists sales_sold_at_idx on public.sales(sold_at desc);

create or replace function public.mark_product_sold(
  p_product_id uuid,
  p_sold_via text,
  p_sale_price bigint,
  p_marketplace_fee bigint default 0,
  p_payment_fee bigint default 0,
  p_shipping_subsidy bigint default 0,
  p_other_cost bigint default 0,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare item public.products%rowtype;
declare sale_id uuid;
declare gross bigint;
declare net bigint;
begin
  if not public.is_staff() then raise exception 'STAFF_ACCESS_REQUIRED'; end if;
  if p_sale_price < 0 or p_marketplace_fee < 0 or p_payment_fee < 0 or p_shipping_subsidy < 0 or p_other_cost < 0 then raise exception 'COSTS_MUST_BE_NON_NEGATIVE'; end if;
  update public.products
  set status = 'sold', sold_at = now(), updated_at = now()
  where id = p_product_id and status <> 'sold'
  returning * into item;
  if item.id is null then raise exception 'ITEM_NOT_AVAILABLE_FOR_SALE'; end if;
  gross := p_sale_price - coalesce(item.purchase_price, 0);
  net := gross - p_marketplace_fee - p_payment_fee - p_shipping_subsidy - p_other_cost;
  insert into public.sales(product_id, sold_via, sale_price, purchase_price, marketplace_fee, payment_fee, shipping_subsidy, other_cost, gross_profit, net_profit, notes)
  values (item.id, p_sold_via, p_sale_price, coalesce(item.purchase_price, 0), p_marketplace_fee, p_payment_fee, p_shipping_subsidy, p_other_cost, gross, net, p_notes)
  returning id into sale_id;
  return jsonb_build_object('sale_id', sale_id, 'gross_profit', gross, 'net_profit', net);
end;
$$;
grant execute on function public.mark_product_sold(uuid, text, bigint, bigint, bigint, bigint, bigint, text) to authenticated;

create table if not exists public.sourcing_candidates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  brand text,
  category text,
  source_platform text,
  source_url text,
  seller_asking_price bigint not null default 0 check (seller_asking_price >= 0),
  estimated_resale_min bigint not null default 0 check (estimated_resale_min >= 0),
  estimated_resale_max bigint not null default 0 check (estimated_resale_max >= 0),
  max_buy_price bigint not null default 0 check (max_buy_price >= 0),
  condition text,
  authenticity_risk text,
  opportunity_score integer check (opportunity_score between 0 and 100),
  notes text,
  image_urls text[] not null default '{}',
  status text not null default 'WATCHING' check (status in ('WATCHING', 'CHECK', 'NEGOTIATING', 'BOUGHT', 'SKIPPED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sourcing_candidates enable row level security;
drop policy if exists "Staff can read sourcing candidates" on public.sourcing_candidates;
drop policy if exists "Staff can manage sourcing candidates" on public.sourcing_candidates;
create policy "Staff can read sourcing candidates" on public.sourcing_candidates for select to authenticated using (public.is_staff());
create policy "Staff can manage sourcing candidates" on public.sourcing_candidates for all to authenticated using (public.is_staff()) with check (public.is_staff());
create index if not exists sourcing_candidates_status_idx on public.sourcing_candidates(status, created_at desc);

create or replace function public.convert_sourcing_to_inventory(p_candidate_id uuid, p_purchase_price bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare candidate public.sourcing_candidates%rowtype;
declare new_id uuid;
begin
  if not public.is_staff() then raise exception 'STAFF_ACCESS_REQUIRED'; end if;
  if p_purchase_price <= 0 then raise exception 'PURCHASE_PRICE_REQUIRED'; end if;
  select * into candidate from public.sourcing_candidates where id = p_candidate_id for update;
  if candidate.id is null then raise exception 'SOURCING_CANDIDATE_NOT_FOUND'; end if;
  if candidate.status = 'BOUGHT' then raise exception 'SOURCING_CANDIDATE_ALREADY_MOVED'; end if;
  insert into public.products(name, slug, brand, category, condition, price_idr, suggested_price, purchase_price, minimum_price, source, source_url, image_urls, status, is_published, purchase_date)
  values (candidate.title, 'sourcing-' || candidate.id::text, coalesce(candidate.brand, 'Unknown'), candidate.category, coalesce(candidate.condition, 'Good'), candidate.estimated_resale_max, candidate.estimated_resale_max, p_purchase_price, candidate.max_buy_price, candidate.source_platform, candidate.source_url, candidate.image_urls, 'draft', false, current_date)
  returning id into new_id;
  update public.sourcing_candidates set status = 'BOUGHT', updated_at = now() where id = candidate.id;
  return new_id;
end;
$$;
grant execute on function public.convert_sourcing_to_inventory(uuid, bigint) to authenticated;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id)
);
alter table public.app_settings enable row level security;
drop policy if exists "Staff can read app settings" on public.app_settings;
drop policy if exists "Admins can manage app settings" on public.app_settings;
create policy "Staff can read app settings" on public.app_settings for select to authenticated using (public.is_staff());
create policy "Admins can manage app settings" on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
insert into public.app_settings(key, value) values ('ai_monthly_budget', '{"amount":100000,"currency":"IDR"}') on conflict (key) do nothing;

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  feature text not null check (feature in ('ITEM_ANALYSIS', 'LISTING_GENERATOR', 'SOURCING', 'PRICE_CHECK', 'WEB_SEARCH', 'SELLER_ASSISTANT')),
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost numeric(14,6) not null default 0 check (estimated_cost >= 0),
  created_at timestamptz not null default now()
);
alter table public.ai_usage enable row level security;
drop policy if exists "Staff can read ai usage" on public.ai_usage;
create policy "Staff can read ai usage" on public.ai_usage for select to authenticated using (public.is_staff());
create index if not exists ai_usage_created_at_idx on public.ai_usage(created_at desc);

create or replace function public.seller_ai_usage_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare budget numeric;
declare used numeric;
begin
  if not public.is_staff() then raise exception 'STAFF_ACCESS_REQUIRED'; end if;
  select coalesce((value->>'amount')::numeric, 100000) into budget from public.app_settings where key = 'ai_monthly_budget';
  budget := coalesce(budget, 100000);
  select coalesce(sum(estimated_cost), 0) into used from public.ai_usage where created_at >= date_trunc('month', now());
  return jsonb_build_object('budget', budget, 'used', used, 'remaining', greatest(budget - used, 0), 'percentage', case when budget > 0 then round((used / budget) * 100, 2) else 0 end);
end;
$$;
grant execute on function public.seller_ai_usage_summary() to authenticated;

create or replace function public.seller_dashboard_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_staff() then raise exception 'STAFF_ACCESS_REQUIRED'; end if;
  select jsonb_build_object(
    'total_stock', coalesce(sum(quantity) filter (where status <> 'archived'), 0),
    'available', coalesce(sum(quantity) filter (where status = 'available'), 0),
    'draft', coalesce(sum(quantity) filter (where status = 'draft'), 0),
    'reserved', coalesce(sum(quantity) filter (where status = 'reserved'), 0),
    'sold', coalesce(sum(quantity) filter (where status = 'sold'), 0),
    'total_modal_active', coalesce(sum(purchase_price) filter (where status in ('draft', 'available', 'reserved')), 0),
    'estimated_stock_value', coalesce(sum(coalesce(suggested_price, price_idr)) filter (where status in ('draft', 'available', 'reserved')), 0),
    'revenue', coalesce((select sum(sale_price) from public.sales), 0),
    'gross_profit', coalesce((select sum(gross_profit) from public.sales), 0),
    'net_profit', coalesce((select sum(net_profit) from public.sales), 0)
  ) into result from public.products;
  return result;
end;
$$;
grant execute on function public.seller_dashboard_summary() to authenticated;

-- Server-side budget reservation used by the future Supabase Edge Function.
create or replace function public.reserve_ai_usage(p_feature text, p_model text, p_estimated_cost numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare budget numeric;
declare used numeric;
declare reservation uuid;
begin
  if not public.is_staff() then raise exception 'STAFF_ACCESS_REQUIRED'; end if;
  if p_estimated_cost < 0 then raise exception 'COST_MUST_BE_NON_NEGATIVE'; end if;
  perform pg_advisory_xact_lock(783492);
  select coalesce((value->>'amount')::numeric, 100000) into budget from public.app_settings where key = 'ai_monthly_budget';
  budget := coalesce(budget, 100000);
  select coalesce(sum(estimated_cost), 0) into used from public.ai_usage where created_at >= date_trunc('month', now());
  if used + p_estimated_cost > budget then raise exception 'AI_BUDGET_EXCEEDED'; end if;
  insert into public.ai_usage(user_id, feature, model, estimated_cost) values (auth.uid(), p_feature, p_model, p_estimated_cost) returning id into reservation;
  return reservation;
end;
$$;

create or replace function public.finalize_ai_usage(p_usage_id uuid, p_input_tokens integer, p_output_tokens integer, p_estimated_cost numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'STAFF_ACCESS_REQUIRED'; end if;
  update public.ai_usage set input_tokens = p_input_tokens, output_tokens = p_output_tokens, estimated_cost = p_estimated_cost where id = p_usage_id and user_id = auth.uid();
end;
$$;

grant execute on function public.reserve_ai_usage(text, text, numeric) to authenticated;
grant execute on function public.finalize_ai_usage(uuid, integer, integer, numeric) to authenticated;

create or replace function public.release_ai_usage(p_usage_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'STAFF_ACCESS_REQUIRED'; end if;
  delete from public.ai_usage where id = p_usage_id and user_id = auth.uid();
end;
$$;
grant execute on function public.release_ai_usage(uuid) to authenticated;

-- Storage writes are allowed for both roles, while public reads remain unchanged.
drop policy if exists "Admins can upload product images" on storage.objects;
drop policy if exists "Admins can update product images" on storage.objects;
drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Staff can upload product images" on storage.objects for insert to authenticated with check (bucket_id = 'product-images' and public.is_staff());
create policy "Staff can update product images" on storage.objects for update to authenticated using (bucket_id = 'product-images' and public.is_staff());
create policy "Staff can delete product images" on storage.objects for delete to authenticated using (bucket_id = 'product-images' and public.is_staff());
