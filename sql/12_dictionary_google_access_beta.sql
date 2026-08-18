-- WAKE辞典 Google申請・承認 β版
-- Supabase SQL Editorで1回だけ実行してください。

create table if not exists public.dictionary_access_requests (
  id uuid primary key default gen_random_uuid(),
  product text not null default 'wake_dictionary',
  user_id uuid not null,
  google_email text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  unique (product, user_id)
);

create table if not exists public.dictionary_entitlements (
  id uuid primary key default gen_random_uuid(),
  product text not null default 'wake_dictionary',
  user_id uuid not null,
  google_email text not null,
  status text not null default 'active' check (status in ('active','revoked')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product, user_id)
);

create index if not exists dictionary_entitlements_access_idx
  on public.dictionary_entitlements (product, user_id, status, expires_at);

alter table public.dictionary_access_requests enable row level security;
alter table public.dictionary_entitlements enable row level security;
revoke all on public.dictionary_access_requests from anon, authenticated;
revoke all on public.dictionary_entitlements from anon, authenticated;
grant all on public.dictionary_access_requests to service_role;
grant all on public.dictionary_entitlements to service_role;

comment on table public.dictionary_access_requests is 'WAKE辞典専用。Google利用申請。WAKE本体のpaid_usersとは分離。';
comment on table public.dictionary_entitlements is 'WAKE辞典専用。承認済み利用権。WAKE本体のpaid_usersとは分離。';
