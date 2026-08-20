select rolname, rolsuper, rolcreaterole
from pg_roles
where rolname in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin')
order by rolname;

select n.nspname, c.relname, pg_get_userbyid(c.relowner)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where (n.nspname, c.relname) in (
  ('auth', 'users'),
  ('auth', 'instances'),
  ('storage', 'objects'),
  ('public', 'account_profiles')
)
order by n.nspname, c.relname;
