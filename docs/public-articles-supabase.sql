create extension if not exists pgcrypto;

create table if not exists public.public_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  body text not null,
  source_url text not null default '',
  source_name text not null default '',
  imported_article jsonb,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.public_explanations (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.public_articles(id) on delete cascade,
  cache_key text not null,
  word text not null,
  sentence text not null,
  explanation jsonb not null,
  created_at timestamptz not null default now(),
  unique(article_id, cache_key)
);

create table if not exists public.public_article_translations (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.public_articles(id) on delete cascade,
  cache_key text not null,
  translations jsonb not null,
  created_at timestamptz not null default now(),
  unique(article_id, cache_key)
);

create index if not exists public_articles_published_updated_idx
  on public.public_articles (published, updated_at desc);

create index if not exists public_explanations_article_idx
  on public.public_explanations (article_id);

create index if not exists public_article_translations_article_idx
  on public.public_article_translations (article_id);

-- All database access for this app goes through server-only routes with the
-- service-role key. Browser roles must not be able to bypass /admin.
alter table public.public_articles enable row level security;
alter table public.public_explanations enable row level security;
alter table public.public_article_translations enable row level security;

revoke all on table public.public_articles from anon, authenticated;
revoke all on table public.public_explanations from anon, authenticated;
revoke all on table public.public_article_translations from anon, authenticated;
revoke all on table public.public_articles from public;
revoke all on table public.public_explanations from public;
revoke all on table public.public_article_translations from public;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists public_articles_set_updated_at on public.public_articles;

create trigger public_articles_set_updated_at
before update on public.public_articles
for each row execute function public.set_updated_at();
