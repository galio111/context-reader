\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1
    from public.public_articles article
    where article.published = true
      and jsonb_typeof(article.imported_article->'blocks') = 'array'
      and nullif(article.imported_article->'recommendation'->>'coverImageUrl', '') is not null
      and not exists (
        select 1
        from jsonb_array_elements(article.imported_article->'blocks') block
        where block->>'type' = 'image'
          and nullif(block->>'src', '') is not null
      )
  ) then
    raise exception 'a published cover still has no article-body image';
  end if;

  if exists (
    select 1
    from public.public_articles article
    where article.published = true
      and article.imported_article->'blocks' @> jsonb_build_array(jsonb_build_object(
        'id', 'restored-cover-' || article.id::text
      ))
      and (
        case
          when article.imported_article->'blocks'->0->>'type' in ('heading', 'subheading')
          then article.imported_article->'blocks'->1->>'id'
          else article.imported_article->'blocks'->0->>'id'
        end
      ) <> 'restored-cover-' || article.id::text
  ) then
    raise exception 'a restored cover is not the leading media block';
  end if;
end;
$$;

select 'leading cover contracts passed' as result;
