begin;

with measured as (
  select
    id,
    regexp_count(
      coalesce(nullif(body, ''), imported_article->>'text', ''),
      $word$[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*$word$
    ) as word_count
  from public.public_articles
  where imported_article->'recommendation' is not null
), repaired as (
  update public.public_articles as article
  set imported_article = jsonb_set(
    article.imported_article,
    '{recommendation,wordCount}',
    to_jsonb(measured.word_count),
    true
  )
  from measured
  where article.id = measured.id
    and measured.word_count > 0
    and coalesce((article.imported_article->'recommendation'->>'wordCount')::integer, 0) <> measured.word_count
  returning article.id
)
select count(*) as repaired_articles from repaired;

commit;
