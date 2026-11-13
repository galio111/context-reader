begin;
create table if not exists public.browser_extension_connections (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Chrome',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists browser_extension_connections_owner on public.browser_extension_connections(user_id);
alter table public.browser_extension_connections enable row level security;
revoke all on public.browser_extension_connections from anon, authenticated;
grant all on public.browser_extension_connections to service_role;
notify pgrst, 'reload schema';
commit;
