-- Apply before a release that reads CET overrides. The app's service role is
-- the only database role permitted to read or write these editorial changes.
create table if not exists public.cet_paper_overrides (
  paper_id text primary key,
  paragraphs jsonb not null,
  updated_at timestamptz not null default now(),
  constraint cet_paper_overrides_id_check check (paper_id ~ '^cet[46]-[0-9]{4}-[0-9]{2}-[1-3]$'),
  constraint cet_paper_overrides_paragraphs_check check (jsonb_typeof(paragraphs) = 'object')
);
alter table public.cet_paper_overrides enable row level security;
revoke all on table public.cet_paper_overrides from anon, authenticated, public;
grant select, insert, update on table public.cet_paper_overrides to service_role;
notify pgrst, 'reload schema';
