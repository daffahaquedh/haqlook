-- Haqlooks Hunter chat / destination brief.
-- Additive only: existing storefront tables and rows are preserved.

alter table public.ai_usage
  add column if not exists reasoning_effort text,
  add column if not exists tool_cost numeric(14,6) not null default 0 check (tool_cost >= 0),
  add column if not exists search_calls integer not null default 0 check (search_calls >= 0),
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in (
    'ITEM_ANALYSIS', 'LISTING_GENERATOR', 'SOURCING', 'PRICE_CHECK',
    'WEB_SEARCH', 'SELLER_ASSISTANT', 'HUNTER_CHAT',
    'HUNTER_DESTINATION_BRIEF', 'HUNTER_REFRESH', 'HUNTER_ITEM_CHECK'
  ));
alter table public.ai_usage drop constraint if exists ai_usage_reasoning_effort_check;
alter table public.ai_usage add constraint ai_usage_reasoning_effort_check
  check (reasoning_effort is null or reasoning_effort in ('low', 'medium'));

create table if not exists public.hunter_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  destination text,
  category_focus text[] not null default '{}',
  budget_idr bigint check (budget_idr is null or budget_idr >= 0),
  is_here boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hunter_sessions_user_updated_idx on public.hunter_sessions(user_id, updated_at desc);
alter table public.hunter_sessions enable row level security;
revoke all on public.hunter_sessions from anon, authenticated;
grant select, insert, update, delete on public.hunter_sessions to authenticated;
drop policy if exists "Hunter users manage own sessions" on public.hunter_sessions;
create policy "Hunter users manage own sessions" on public.hunter_sessions
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_staff()))
  with check (user_id = (select auth.uid()) and (select public.is_staff()));

create table if not exists public.hunter_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.hunter_sessions(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) <= 2500),
  message_kind text not null default 'chat' check (message_kind in ('chat', 'brief', 'item_check')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists hunter_messages_session_created_idx on public.hunter_messages(session_id, created_at);
create index if not exists hunter_messages_user_created_idx on public.hunter_messages(user_id, created_at desc);
alter table public.hunter_messages enable row level security;
revoke all on public.hunter_messages from anon, authenticated;
grant select, insert on public.hunter_messages to authenticated;
drop policy if exists "Hunter users read own messages" on public.hunter_messages;
create policy "Hunter users read own messages" on public.hunter_messages
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.is_staff())
    and exists (select 1 from public.hunter_sessions s where s.id = session_id and s.user_id = (select auth.uid()))
  );
drop policy if exists "Hunter users add own messages" on public.hunter_messages;
create policy "Hunter users add own messages" on public.hunter_messages
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_staff())
    and exists (select 1 from public.hunter_sessions s where s.id = session_id and s.user_id = (select auth.uid()))
  );

create table if not exists public.hunter_briefs (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  destination text not null,
  category_focus text not null default 'all',
  brief_json jsonb not null,
  citations jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  model text not null,
  search_calls integer not null default 0 check (search_calls >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0)
);
create index if not exists hunter_briefs_expiry_idx on public.hunter_briefs(expires_at);
alter table public.hunter_briefs enable row level security;
revoke all on public.hunter_briefs from anon, authenticated;
grant select on public.hunter_briefs to authenticated;
grant select, insert, update, delete on public.hunter_briefs to service_role;
drop policy if exists "Staff read shared hunter briefs" on public.hunter_briefs;
create policy "Staff read shared hunter briefs" on public.hunter_briefs
  for select to authenticated using ((select public.is_staff()));

alter table public.sourcing_candidates
  add column if not exists hunter_brief_id uuid references public.hunter_briefs(id) on delete set null,
  add column if not exists hunter_target_key text,
  add column if not exists checked_at timestamptz,
  add column if not exists bought_at timestamptz,
  add column if not exists product_id uuid references public.products(id) on delete set null;
create index if not exists sourcing_candidates_hunter_brief_idx on public.sourcing_candidates(hunter_brief_id);
create index if not exists sourcing_candidates_product_idx on public.sourcing_candidates(product_id);
create unique index if not exists sourcing_candidates_hunter_target_unique_idx
  on public.sourcing_candidates(hunter_brief_id, hunter_target_key)
  where hunter_brief_id is not null and hunter_target_key is not null;

create or replace function public.reserve_hunter_ai_usage(
  p_feature text,
  p_model text,
  p_reasoning_effort text,
  p_estimated_cost numeric,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  monthly_budget numeric;
  monthly_used numeric;
  reservation_id uuid;
begin
  if not public.is_staff() then raise exception 'STAFF_ACCESS_REQUIRED'; end if;
  if p_feature not in ('HUNTER_CHAT', 'HUNTER_DESTINATION_BRIEF', 'HUNTER_REFRESH', 'HUNTER_ITEM_CHECK') then raise exception 'HUNTER_FEATURE_NOT_ALLOWED'; end if;
  if p_reasoning_effort not in ('low', 'medium') then raise exception 'REASONING_EFFORT_NOT_ALLOWED'; end if;
  if p_estimated_cost is null or p_estimated_cost <= 0 then raise exception 'COST_MUST_BE_POSITIVE'; end if;
  perform pg_advisory_xact_lock(783492);
  select coalesce((value->>'amount')::numeric, 100000) into monthly_budget
    from public.app_settings where key = 'ai_monthly_budget';
  monthly_budget := coalesce(monthly_budget, 100000);
  select coalesce(sum(estimated_cost), 0) into monthly_used
    from public.ai_usage where created_at >= date_trunc('month', now());
  if monthly_used >= monthly_budget or monthly_used + p_estimated_cost > monthly_budget then
    raise exception 'AI_BUDGET_EXCEEDED';
  end if;
  insert into public.ai_usage(user_id, feature, model, reasoning_effort, estimated_cost, details)
    values (auth.uid(), p_feature, p_model, p_reasoning_effort, p_estimated_cost, coalesce(p_details, '{}'::jsonb))
    returning id into reservation_id;
  return reservation_id;
end;
$$;
revoke all on function public.reserve_hunter_ai_usage(text, text, text, numeric, jsonb) from public, anon;
grant execute on function public.reserve_hunter_ai_usage(text, text, text, numeric, jsonb) to authenticated;

create or replace function public.finalize_hunter_ai_usage(
  p_usage_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_tool_cost numeric,
  p_total_cost numeric,
  p_search_calls integer,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_staff() then raise exception 'STAFF_ACCESS_REQUIRED'; end if;
  if p_input_tokens < 0 or p_output_tokens < 0 or p_search_calls < 0 or p_tool_cost < 0 or p_total_cost < 0 then
    raise exception 'USAGE_VALUES_MUST_BE_NON_NEGATIVE';
  end if;
  update public.ai_usage
    set input_tokens = p_input_tokens,
        output_tokens = p_output_tokens,
        tool_cost = p_tool_cost,
        estimated_cost = p_total_cost,
        search_calls = p_search_calls,
        details = coalesce(p_details, '{}'::jsonb)
    where id = p_usage_id and user_id = auth.uid()
      and feature in ('HUNTER_CHAT', 'HUNTER_DESTINATION_BRIEF', 'HUNTER_REFRESH', 'HUNTER_ITEM_CHECK');
  if not found then raise exception 'AI_USAGE_RESERVATION_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.finalize_hunter_ai_usage(uuid, integer, integer, numeric, numeric, integer, jsonb) from public, anon;
grant execute on function public.finalize_hunter_ai_usage(uuid, integer, integer, numeric, numeric, integer, jsonb) to authenticated;

create or replace function public.hunter_admin_analytics()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  with monthly_usage as (
    select * from public.ai_usage
    where created_at >= date_trunc('month', now())
      and feature in ('HUNTER_CHAT', 'HUNTER_DESTINATION_BRIEF', 'HUNTER_REFRESH', 'HUNTER_ITEM_CHECK')
  ), destinations as (
    select details->>'destination' as label, count(*) as value
    from monthly_usage where nullif(details->>'destination', '') is not null
    group by details->>'destination' order by value desc, label limit 5
  ), categories as (
    select category, count(*) as value_count
    from monthly_usage u cross join lateral jsonb_array_elements_text(coalesce(u.details->'recommended_categories', '[]'::jsonb)) as category_values(category)
    group by category order by value_count desc, category limit 5
  ), checked as (
    select count(*) as checked_count, count(*) filter (where bought_at is not null) as bought_count
    from public.sourcing_candidates where checked_at is not null and hunter_brief_id is not null
  ), bought as (
    select count(*) as bought_count,
      count(*) filter (where p.status = 'sold' or exists (select 1 from public.sales s where s.product_id = p.id)) as sold_count
    from public.sourcing_candidates c join public.products p on p.id = c.product_id
    where c.bought_at is not null
  )
  select jsonb_build_object(
    'brief_count', (select count(*) from public.hunter_messages where message_kind = 'brief' and created_at >= date_trunc('month', now())),
    'refresh_count', (select count(*) from monthly_usage where feature = 'HUNTER_REFRESH'),
    'item_check_count', (select count(*) from monthly_usage where feature = 'HUNTER_ITEM_CHECK'),
    'hunter_cost_idr', coalesce((select sum(estimated_cost) from monthly_usage), 0),
    'most_requested_destinations', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'value', value)) from destinations), '[]'::jsonb),
    'most_recommended_categories', coalesce((select jsonb_agg(jsonb_build_object('label', category, 'value', value_count)) from categories), '[]'::jsonb),
    'checked_to_bought', jsonb_build_object('checked', (select checked_count from checked), 'bought', (select bought_count from checked)),
    'bought_to_sold', jsonb_build_object('bought', (select bought_count from bought), 'sold', (select sold_count from bought))
  ) into result;
  return result;
end;
$$;
revoke all on function public.hunter_admin_analytics() from public, anon;
grant execute on function public.hunter_admin_analytics() to authenticated;

-- Extend the existing manual sourcing conversion to preserve the Hunter link.
create or replace function public.convert_sourcing_to_inventory(p_candidate_id uuid, p_purchase_price bigint)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare candidate public.sourcing_candidates%rowtype;
declare new_id uuid;
begin
  if not public.is_staff() then raise exception 'STAFF_ACCESS_REQUIRED'; end if;
  if p_purchase_price <= 0 then raise exception 'PURCHASE_PRICE_REQUIRED'; end if;
  select * into candidate from public.sourcing_candidates where id = p_candidate_id for update;
  if candidate.id is null then raise exception 'SOURCING_CANDIDATE_NOT_FOUND'; end if;
  if candidate.status = 'BOUGHT' and candidate.product_id is not null then return candidate.product_id; end if;
  insert into public.products(name, slug, brand, category, condition, price_idr, suggested_price, purchase_price, minimum_price, source, source_url, image_urls, status, is_published, purchase_date)
  values (candidate.title, 'sourcing-' || candidate.id::text, coalesce(candidate.brand, 'Unknown'), candidate.category, coalesce(candidate.condition, 'Good'), candidate.estimated_resale_max, candidate.estimated_resale_max, p_purchase_price, candidate.max_buy_price, candidate.source_platform, candidate.source_url, candidate.image_urls, 'draft', false, current_date)
  returning id into new_id;
  update public.sourcing_candidates
    set status = 'BOUGHT', bought_at = now(), product_id = new_id, updated_at = now()
    where id = candidate.id;
  return new_id;
end;
$$;
revoke all on function public.convert_sourcing_to_inventory(uuid, bigint) from public, anon;
grant execute on function public.convert_sourcing_to_inventory(uuid, bigint) to authenticated;


