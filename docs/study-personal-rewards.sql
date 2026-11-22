begin;
-- The activation day is recorded once, including when the migration is replayed.
alter table public.study_policy add column if not exists review_checkin_since date not null default ((now() at time zone 'Asia/Shanghai')::date);
alter table public.study_days add column if not exists review_checkin boolean not null default false;
create table if not exists public.study_vouchers (
 user_id uuid not null references auth.users(id) on delete cascade,
 milestone integer not null check(milestone in (2,3,7,21,30,60,180,365)),
 unit smallint not null check(unit=1 or (unit=2 and milestone=180)),
 earned_day date not null, redeemed_at timestamptz, choice text,
 primary key(user_id,milestone,unit),
 check(choice is null or (milestone=365 and redeemed_at is not null and choice in ('clothes','shoes'))),
 check(milestone<>365 or redeemed_at is null or choice is not null)
);
alter table public.study_vouchers enable row level security;
revoke all on public.study_vouchers from public, anon, authenticated;
grant all on public.study_vouchers to service_role;

create or replace function public.study_settle_checkin(p_user uuid,p_day date) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 first_day date; eligible boolean; counted integer; existing boolean; enabled boolean; latest_day date; current_run integer; longest integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 select review_checkin_since,coalesce((policy->>'rewardsEnabled')::boolean,true) into first_day,enabled from study_policy where id;
 if p_day<first_day or p_day>(now() at time zone 'Asia/Shanghai')::date then return '{"complete":false}'; end if;
 select review_checkin into existing from study_days where user_id=p_user and day=p_day;
 if not found then return '{"complete":false}'; end if;
 select count(*) into counted from (
   select card_id from study_reviews where user_id=p_user and not undone
    and reviewed_at>=p_day::timestamp at time zone 'Asia/Shanghai'
    and reviewed_at<(p_day+1)::timestamp at time zone 'Asia/Shanghai'
   group by card_id having bool_or(previous->>'state'='2') and not bool_or(previous->>'state'='0')
 ) distinct_reviews;
 eligible:=counted>=30;
 if eligible=existing then return jsonb_build_object('complete',eligible,'reviewed',counted); end if;
 update study_days set review_checkin=eligible,completed_at=case when eligible then coalesce(completed_at,now()) else null end,
   streak=0 where user_id=p_user and day=p_day;
 -- Offline days may arrive out of order. Recompute connected runs from durable qualified dates.
 with dates as (
   select day, day-(row_number() over(order by day))::integer as island from study_days
    where user_id=p_user and (review_checkin or (day<first_day and completed_at is not null and streak>0))
 ), runs as (
   select day,(row_number() over(partition by island order by day))::integer as length from dates
 )
 update study_days d set streak=runs.length from runs
   where d.user_id=p_user and d.day=runs.day and d.day>=first_day and d.streak<>runs.length;
 select day,streak into latest_day,current_run from study_days where user_id=p_user and completed_at is not null and streak>0 order by day desc limit 1;
 select coalesce(max(streak),0) into longest from study_days where user_id=p_user and completed_at is not null;
 insert into study_streaks(user_id,current,best,last_day) values(p_user,coalesce(current_run,0),longest,latest_day)
 on conflict(user_id) do update set current=excluded.current,best=excluded.best,last_day=excluded.last_day;
 if eligible and enabled then
  insert into study_vouchers(user_id,milestone,unit,earned_day)
  select p_user,m.days,m.unit,min(d.day) from study_days d
  join (values(2,1),(3,1),(7,1),(21,1),(30,1),(60,1),(180,1),(180,2),(365,1)) m(days,unit) on d.streak>=m.days
  where d.user_id=p_user and d.review_checkin group by m.days,m.unit on conflict do nothing;
 end if;
 return jsonb_build_object('complete',eligible,'reviewed',counted,'streak',coalesce(current_run,0));
end $$;

create or replace function public.study_pause(p_user uuid,p_settings jsonb) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 insert into study_settings(user_id,settings) values(p_user,p_settings)
 on conflict(user_id) do update set settings=p_settings,updated_at=now();
end $$;

-- Old callers and new callers settle the same published rule. Existing financial claims remain redeemable.
create or replace function public.study_settle_rewards(p_user uuid) returns jsonb
language sql security definer set search_path=public as $$
 select study_settle_checkin(p_user,(now() at time zone 'Asia/Shanghai')::date)
$$;
create or replace function public.study_checkin_after_answer() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.previous->>'state' in ('2','0') and (tg_op='INSERT' or new.undone is distinct from old.undone) then
   perform study_settle_checkin(new.user_id,(new.reviewed_at at time zone 'Asia/Shanghai')::date);
 end if;
 return null;
end $$;
create or replace trigger study_record_checkin after insert or update of undone on public.study_reviews
 for each row execute function public.study_checkin_after_answer();

create or replace function public.study_redeem_voucher(p_user uuid,p_milestone integer,p_unit integer,p_choice text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v study_vouchers%rowtype;
begin
 select * into v from study_vouchers where user_id=p_user and milestone=p_milestone and unit=p_unit for update;
 if not found then return '{"missing":true}'; end if;
 if v.redeemed_at is not null then return jsonb_build_object('redeemed',true,'duplicate',true,'choice',v.choice); end if;
 if (p_milestone=365 and (p_choice is null or p_choice not in ('clothes','shoes'))) or (p_milestone<>365 and p_choice is not null)
 then return '{"invalidChoice":true}'; end if;
 update study_vouchers set redeemed_at=now(),choice=p_choice where user_id=p_user and milestone=p_milestone and unit=p_unit;
 return '{"redeemed":true}';
end $$;
revoke all on function public.study_settle_checkin(uuid,date), public.study_settle_rewards(uuid), public.study_checkin_after_answer(), public.study_redeem_voucher(uuid,integer,integer,text) from public,anon,authenticated;
grant execute on function public.study_settle_checkin(uuid,date), public.study_settle_rewards(uuid), public.study_redeem_voucher(uuid,integer,integer,text) to service_role;
select public.study_settle_checkin(user_id,day) from public.study_days where day=(now() at time zone 'Asia/Shanghai')::date;
notify pgrst,'reload schema';
commit;
