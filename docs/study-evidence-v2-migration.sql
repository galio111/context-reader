begin;
-- Retain legacy totals for audit. Profile eligibility uses only v2 qualified seconds.
alter table public.study_reading_days add column if not exists verified_seconds integer not null default 0;
create or replace function public.study_reading_tick_v2(p_user uuid,p_seconds integer,p_words jsonb,p_article text)
returns void language plpgsql security definer set search_path=public as $$
declare d date:=(now() at time zone 'Asia/Shanghai')::date; r study_reading_days%rowtype; delta integer; merged jsonb;
begin
 insert into study_reading_days(user_id,day) values(p_user,d) on conflict do nothing;
 select * into r from study_reading_days where user_id=p_user and day=d for update;
 delta:=least(30,greatest(0,p_seconds),greatest(0,floor(extract(epoch from(now()-r.last_tick)))));
 select coalesce(jsonb_agg(word),'[]') into merged from (select distinct lower(value) as word from jsonb_array_elements_text(r.words||p_words) where length(value) between 1 and 80 limit 500) words;
 update study_reading_days set verified_seconds=least(14400,verified_seconds+delta),active_seconds=least(14400,active_seconds+delta),last_tick=now(),words=merged,
 articles=case when length(p_article) between 1 and 160 and jsonb_array_length(articles)<100 and not articles ? p_article then articles||jsonb_build_array(p_article) else articles end
 where user_id=p_user and day=d;
end $$;
create or replace function public.study_daily_stats_v2(p_user uuid) returns jsonb
language sql security definer set search_path=public as $$
 with per_card as (
  select (reviewed_at at time zone 'Asia/Shanghai')::date as day,card_id,
    bool_or((previous->>'state')::integer=0) as is_new,
    sum(active_ms) as active_ms,count(*) filter(where rating>1) as successes,count(*) as reviews
  from study_reviews where user_id=p_user and not undone
    and reviewed_at >= (((now() at time zone 'Asia/Shanghai')::date-364)::timestamp at time zone 'Asia/Shanghai')
  group by 1,2
 ) select coalesce(jsonb_agg(x order by x.day),'[]') from (
  select day,count(*) as cards,count(*) filter(where is_new) as new_cards,count(*) filter(where not is_new) as review_cards,
    sum(active_ms) as active_ms,sum(successes) as successes,sum(reviews) as reviews from per_card group by day
 ) x
$$;
revoke all on function public.study_reading_tick_v2(uuid,integer,jsonb,text),public.study_daily_stats_v2(uuid) from public,anon,authenticated;
grant execute on function public.study_reading_tick_v2(uuid,integer,jsonb,text),public.study_daily_stats_v2(uuid) to service_role;
commit;
