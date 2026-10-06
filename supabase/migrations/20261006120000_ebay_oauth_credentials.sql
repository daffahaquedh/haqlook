create table if not exists public.ebay_oauth_states (
  state_hash text primary key
    check (state_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists ebay_oauth_states_expires_at_idx
  on public.ebay_oauth_states (expires_at);

alter table public.ebay_oauth_states enable row level security;
revoke all privileges on table public.ebay_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on table public.ebay_oauth_states to service_role;

create table if not exists public.ebay_seller_credentials (
  id smallint primary key default 1 check (id = 1),
  refresh_token text not null,
  refresh_token_expires_at timestamptz not null,
  connected_at timestamptz not null default now()
);

alter table public.ebay_seller_credentials enable row level security;
revoke all privileges on table public.ebay_seller_credentials from public, anon, authenticated;
grant select, insert, update, delete on table public.ebay_seller_credentials to service_role;

comment on table public.ebay_oauth_states is
  'Short-lived, hashed, one-time CSRF state for eBay Production OAuth; service-role access only.';
comment on table public.ebay_seller_credentials is
  'Single eBay seller refresh token; server-only and inaccessible to anon/authenticated clients.';
comment on column public.ebay_seller_credentials.refresh_token is
  'Sensitive eBay refresh token. Never expose to browser clients or logs.';
