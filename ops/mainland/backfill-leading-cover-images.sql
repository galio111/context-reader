begin;

with eligible as (
  select
    article.id,
    article.title,
    article.imported_article,
    article.imported_article->'blocks' as blocks,
    article.imported_article->'recommendation'->>'coverImageUrl' as cover_url,
    coalesce(
      nullif(article.imported_article->'recommendation'->>'coverImageAlt', ''),
      nullif(article.title, ''),
      '文章配图'
    ) as cover_alt
  from public.public_articles as article
  where article.published = true
    and jsonb_typeof(article.imported_article->'blocks') = 'array'
    and nullif(article.imported_article->'recommendation'->>'coverImageUrl', '') is not null
    and not exists (
      select 1
      from jsonb_array_elements(article.imported_article->'blocks') as block
      where block->>'type' = 'image'
        and nullif(block->>'src', '') is not null
    )
), repaired as (
  update public.public_articles as article
  set
    imported_article = jsonb_set(
      article.imported_article,
      '{blocks}',
      case
        when jsonb_array_length(eligible.blocks) > 0
          and eligible.blocks->0->>'type' in ('heading', 'subheading')
        then jsonb_build_array(eligible.blocks->0)
          || jsonb_build_array(jsonb_build_object(
            'id', 'restored-cover-' || eligible.id::text,
            'type', 'image',
            'src', eligible.cover_url,
            'alt', eligible.cover_alt
          ))
          || (eligible.blocks - 0)
        else jsonb_build_array(jsonb_build_object(
          'id', 'restored-cover-' || eligible.id::text,
          'type', 'image',
          'src', eligible.cover_url,
          'alt', eligible.cover_alt
        )) || eligible.blocks
      end,
      false
    ),
    updated_at = now()
  from eligible
  where article.id = eligible.id
  returning article.id, article.title
)
select id, title from repaired order by title;

commit;
