-- HAQLOOK database schema
-- Run in Supabase SQL Editor on a fresh project.

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

alter table public.admins enable row level security;

drop policy if exists "Admin can read own profile" on public.admins;
create policy "Admin can read own profile" on public.admins for select to authenticated using (user_id = auth.uid());

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  brand text not null,
  model text,
  price_idr bigint not null default 0,
  price_usd numeric(10,2),
  size_label text,
  condition text not null default 'Good',
  description text,
  status text not null default 'available' check (status in ('available','reserved','sold')),
  featured boolean not null default false,
  is_published boolean not null default true,
  image_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

drop policy if exists "Public can view published products" on public.products;
create policy "Public can view published products" on public.products for select to anon, authenticated using (is_published = true);

drop policy if exists "Admins can manage products" on public.products;
create policy "Admins can manage products" on public.products for all to authenticated
using (exists (select 1 from public.admins where admins.user_id = auth.uid()))
with check (exists (select 1 from public.admins where admins.user_id = auth.uid()));

insert into storage.buckets (id,name,public) values ('product-images','product-images',true) on conflict (id) do update set public=true;

drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images" on storage.objects for select to public using (bucket_id='product-images');

drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images" on storage.objects for insert to authenticated with check (bucket_id='product-images' and exists (select 1 from public.admins where admins.user_id=auth.uid()));

drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images" on storage.objects for update to authenticated using (bucket_id='product-images' and exists (select 1 from public.admins where admins.user_id=auth.uid()));

drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images" on storage.objects for delete to authenticated using (bucket_id='product-images' and exists (select 1 from public.admins where admins.user_id=auth.uid()));
