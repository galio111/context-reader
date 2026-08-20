select 'database=' || pg_size_pretty(pg_database_size(current_database()));

select n.nspname || '.' || c.relname || '=' || pg_size_pretty(pg_total_relation_size(c.oid))
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'auth', 'storage')
  and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 20;
