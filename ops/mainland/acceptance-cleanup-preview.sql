select user_id, nickname, created_at
from public.account_profiles
where nickname = '迁移验收账号'
order by created_at;

select id, created_at
from public.guest_identities
where created_at >= timestamptz '2026-08-08 16:50:00+00'
order by created_at;
