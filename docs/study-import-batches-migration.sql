begin;
create table if not exists public.study_import_batches(
 user_id uuid not null references auth.users(id) on delete cascade,
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 source_name text not null, imported_at timestamptz not null default now(),
 summary jsonb not null, source_data jsonb not null,
 primary key(user_id,source_sha256)
);
alter table public.study_import_batches enable row level security;
revoke all on public.study_import_batches from public,anon,authenticated;
grant all on public.study_import_batches to service_role;
comment on table public.study_import_batches is 'Private idempotent Anki import receipts, original notes/cards/revlog and generation provenance. Not study rewards or usage events.';
notify pgrst, 'reload schema';
commit;
