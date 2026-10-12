begin;
create table if not exists public.product_activity_meta (
 id boolean primary key default true check(id), started_at timestamptz not null default now()
);
insert into public.product_activity_meta(id) values(true) on conflict do nothing;
create table if not exists public.product_activity_days (
 user_id uuid not null references auth.users(id) on delete cascade,
 day date not null, first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
 primary key(user_id,day)
);
create table if not exists public.product_reading_ticks (
 user_id uuid not null references auth.users(id) on delete cascade, id uuid not null,
 recorded_at timestamptz not null default now(), seconds integer not null check(seconds between 0 and 30),
 primary key(user_id,id)
);
create index if not exists product_reading_time on public.product_reading_ticks(user_id,recorded_at);
create index if not exists product_reading_recorded on public.product_reading_ticks(recorded_at);
create index if not exists product_activity_day on public.product_activity_days(day,user_id);
alter table public.product_activity_meta enable row level security;
alter table public.product_activity_days enable row level security;
alter table public.product_reading_ticks enable row level security;
revoke all on public.product_activity_meta,public.product_activity_days,public.product_reading_ticks from public,anon,authenticated;
grant all on public.product_activity_meta,public.product_activity_days,public.product_reading_ticks to service_role;

create or replace function public.study_record_visit(p_user uuid) returns void
language sql security definer set search_path=public as $$
 insert into product_activity_days(user_id,day) values(p_user,(now() at time zone 'Asia/Shanghai')::date)
 on conflict(user_id,day) do update set last_seen=now()
$$;

-- The event id survives retries. The existing timer guard and daily cap remain authoritative.
create or replace function public.study_reading_tick_v3(p_user uuid,p_seconds integer,p_words jsonb,p_article text,p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare d date:=(now() at time zone 'Asia/Shanghai')::date; before_seconds integer; after_seconds integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('reading:'||p_user,0));
 if exists(select 1 from product_reading_ticks where user_id=p_user and id=p_id) then return; end if;
 select coalesce(verified_seconds,0) into before_seconds from study_reading_days where user_id=p_user and day=d;
 perform study_reading_tick_v2(p_user,p_seconds,p_words,p_article);
 select verified_seconds into after_seconds from study_reading_days where user_id=p_user and day=d;
 insert into product_reading_ticks(user_id,id,seconds) values(p_user,p_id,greatest(0,after_seconds-coalesce(before_seconds,0)));
 perform study_record_visit(p_user);
end $$;

create or replace function public.study_activity_summary(p_user uuid) returns jsonb
language sql security definer set search_path=public as $$
 select jsonb_build_object(
 'since',(select started_at from product_activity_meta where id),
 'seconds',coalesce(sum(seconds),0),
 'todaySeconds',coalesce(sum(seconds) filter(where (recorded_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date),0),
 'readingDays',count(distinct (recorded_at at time zone 'Asia/Shanghai')::date) filter(where seconds>0))
 from product_reading_ticks where user_id=p_user
$$;

create or replace function public.study_product_analytics(p_days integer default 30) returns jsonb
language sql security definer set search_path=public as $$
 with config as (
  select started_at,(now() at time zone 'Asia/Shanghai')::date as today,
   (now() at time zone 'Asia/Shanghai')::date - least(90,greatest(7,p_days)) + 1 as first_day
  from product_activity_meta where id
 ), people as (
  select p.user_id,p.created_at,(p.created_at at time zone 'Asia/Shanghai')::date as joined
  from account_profiles p where not exists(select 1 from user_entitlements e where e.user_id=p.user_id and e.plan_id='admin' and e.starts_at<=now() and (e.ends_at is null or e.ends_at>now()))
 ), calendar as (select generate_series(greatest(first_day,(started_at at time zone 'Asia/Shanghai')::date),today,interval '1 day')::date as day from config),
 active as (select d.* from product_activity_days d join people p using(user_id)),
 ticks as (select t.* from product_reading_ticks t join people p using(user_id)),
 daily as (
  select c.day,
   (select count(*) from active a where a.day=c.day) as active,
   (select count(*) from people p where p.joined=c.day) as registrations,
   (select coalesce(sum(t.seconds),0) from ticks t where (t.recorded_at at time zone 'Asia/Shanghai')::date=c.day) as seconds
  from calendar c
 ), retention as (
  select n as day,
   count(*) filter(where p.joined+n<=c.today) as eligible,
   count(*) filter(where p.joined+n<=c.today and exists(select 1 from active a where a.user_id=p.user_id and a.day=p.joined+n)) as returned
  from people p cross join config c cross join (values(1),(7),(30)) v(n)
  where p.created_at>=c.started_at and p.joined>=c.first_day group by n
 ), first_payments as (
  select o.user_id,min(o.paid_at) as paid_at from billing_orders o join people p using(user_id)
  where o.status in ('paid','refunding','refunded') and o.paid_at is not null group by o.user_id
 ), payments as (
  select f.user_id,f.paid_at,p.created_at>=c.started_at as complete,
   coalesce((select sum(t.seconds) from ticks t where t.user_id=f.user_id and t.recorded_at<=f.paid_at),0) as seconds
  from first_payments f join people p using(user_id) cross join config c
  where (f.paid_at at time zone 'Asia/Shanghai')::date>=c.first_day
 )
 select jsonb_build_object('since',(select started_at from config),
  'daily',coalesce((select jsonb_agg(d order by day) from daily d),'[]'::jsonb),
  'retention',coalesce((select jsonb_agg(r order by day) from retention r),'[]'::jsonb),
  'activeUsers',(select count(distinct user_id) from active,config where day>=first_day),
  'readers',(select count(distinct user_id) from ticks,config where seconds>0 and (recorded_at at time zone 'Asia/Shanghai')::date>=first_day),
  'firstPayments',(select count(*) from payments),
  'completePayments',(select count(*) from payments where complete),
  'medianSecondsBeforePayment',(select percentile_cont(.5) within group(order by seconds) from payments where complete),
  'paymentBuckets',(select jsonb_build_object('under30',count(*) filter(where seconds<1800),'30to120',count(*) filter(where seconds>=1800 and seconds<7200),'over120',count(*) filter(where seconds>=7200)) from payments where complete))
$$;
revoke all on function public.study_record_visit(uuid),public.study_reading_tick_v3(uuid,integer,jsonb,text,uuid),public.study_activity_summary(uuid),public.study_product_analytics(integer) from public,anon,authenticated;
grant execute on function public.study_record_visit(uuid),public.study_reading_tick_v3(uuid,integer,jsonb,text,uuid),public.study_activity_summary(uuid),public.study_product_analytics(integer) to service_role;
notify pgrst, 'reload schema';
commit;
