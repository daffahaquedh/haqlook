-- Listing Generator V1: additive fields on the existing marketplace tracker.
-- Existing products, admins, listing rows and marketplace statuses are preserved.

alter table public.marketplace_listings
  add column if not exists listing_title text,
  add column if not exists listing_description text,
  add column if not exists listing_tags text[] not null default '{}',
  add column if not exists condition_summary text,
  add column if not exists size_display text,
  add column if not exists measurements_text text,
  add column if not exists warnings text[] not null default '{}';

alter table public.ai_usage
  add column if not exists request_key uuid;

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in (
    'ITEM_ANALYSIS', 'LISTING_GENERATOR', 'LISTING_GENERATION', 'SOURCING',
    'PRICE_CHECK', 'WEB_SEARCH', 'SELLER_ASSISTANT', 'HUNTER_CHAT',
    'HUNTER_DESTINATION_BRIEF', 'HUNTER_REFRESH', 'HUNTER_ITEM_CHECK'
  ));

create unique index if not exists ai_usage_user_request_key_idx
  on public.ai_usage(user_id, request_key)
  where request_key is not null;

create or replace function public.reserve_listing_ai_usage(p_request_key uuid, p_model text, p_estimated_cost numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare existing_usage uuid;
declare reserved_usage uuid;
begin
  if not public.is_staff() then raise exception 'STAFF_ACCESS_REQUIRED'; end if;
  if p_request_key is null then raise exception 'REQUEST_KEY_REQUIRED'; end if;
  if p_model <> 'gpt-6-luna' then raise exception 'MODEL_NOT_ALLOWED'; end if;
  if p_estimated_cost < 0 then raise exception 'COST_MUST_BE_NON_NEGATIVE'; end if;

  select id into existing_usage
  from public.ai_usage
  where user_id = auth.uid() and request_key = p_request_key;
  if existing_usage is not null then
    return jsonb_build_object('usage_id', existing_usage, 'created', false);
  end if;

  begin
    reserved_usage := public.reserve_ai_usage('LISTING_GENERATION', p_model, p_estimated_cost);
    update public.ai_usage
      set request_key = p_request_key, reasoning_effort = 'low'
      where id = reserved_usage and user_id = auth.uid();
    return jsonb_build_object('usage_id', reserved_usage, 'created', true);
  exception when unique_violation then
    select id into existing_usage
    from public.ai_usage
    where user_id = auth.uid() and request_key = p_request_key;
    if existing_usage is null then raise; end if;
    return jsonb_build_object('usage_id', existing_usage, 'created', false);
  end;
end;
$function$;

revoke all on function public.reserve_listing_ai_usage(uuid, text, numeric) from public;
grant execute on function public.reserve_listing_ai_usage(uuid, text, numeric) to authenticated;
