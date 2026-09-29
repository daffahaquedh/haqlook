-- Phase 3B: public-safe contact settings managed by authenticated HAQLOOKS staff.
-- This migration is additive: it creates only a new singleton table and trigger.

create table public.storefront_contact_settings (
  id smallint primary key default 1,
  whatsapp_number text,
  instagram_url text,
  updated_at timestamptz not null default now(),
  constraint storefront_contact_settings_singleton check (id = 1),
  constraint storefront_contact_settings_whatsapp_format
    check (whatsapp_number is null or whatsapp_number ~ '^628[1-9][0-9]{7,10}$'),
  constraint storefront_contact_settings_instagram_format
    check (
      instagram_url is null
      or instagram_url ~ '^https://www[.]instagram[.]com/[A-Za-z0-9._]{1,30}/?$'
    )
);

alter table public.storefront_contact_settings enable row level security;

-- Browser roles get only public read and staff-only column updates.
revoke all privileges on table public.storefront_contact_settings
  from public, anon, authenticated, service_role;
grant select on table public.storefront_contact_settings to anon, authenticated;
grant update (whatsapp_number, instagram_url)
  on table public.storefront_contact_settings to authenticated;

create policy "Public can read storefront contact"
  on public.storefront_contact_settings
  for select
  to anon, authenticated
  using (id = 1);

create policy "Staff can update storefront contact"
  on public.storefront_contact_settings
  for update
  to authenticated
  using (id = 1 and (select public.is_staff()))
  with check (id = 1 and (select public.is_staff()));

create or replace function public.set_storefront_contact_settings_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.set_storefront_contact_settings_updated_at()
  from public, anon, authenticated, service_role;

create trigger storefront_contact_settings_set_updated_at
  before update on public.storefront_contact_settings
  for each row execute function public.set_storefront_contact_settings_updated_at();

insert into public.storefront_contact_settings (id)
values (1)
on conflict (id) do nothing;
