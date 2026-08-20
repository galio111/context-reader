select
  bucket_id,
  count(*) as object_count,
  coalesce(sum((metadata ->> 'size')::bigint), 0) as total_bytes,
  min(name) as first_object,
  max(name) as last_object
from storage.objects
group by bucket_id
order by bucket_id;

select id, public, file_size_limit
from storage.buckets
order by id;
