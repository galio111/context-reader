-- New learning means an actual first answer from state 0, not graduation or Good.
begin;
create or replace function public.study_daily_stats_v3(p_user uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 with per_card as (
  select (r.reviewed_at at time zone 'Asia/Shanghai')::date as day,r.card_id,
   bool_or((r.previous->>'state')::int=0) as introduced,
   bool_or((r.previous->>'state')::int in(2,3)) as reviewed,
   sum(r.active_ms) as active_ms,count(*) filter(where r.rating>1) as successes,count(*) as reviews
  from study_reviews r
  where r.user_id=p_user and not r.undone and r.reviewed_at>=(((now() at time zone 'Asia/Shanghai')::date-364)::timestamp at time zone 'Asia/Shanghai')
  group by 1,2
 ) select coalesce(jsonb_agg(x order by x.day),'[]') from (
  select day,count(*) as cards,
   count(*) filter(where introduced) as new_cards,
   count(*) filter(where reviewed and not introduced) as review_cards,
   count(*) filter(where not introduced and not reviewed) as learning_cards,
   sum(active_ms) as active_ms,sum(successes) as successes,sum(reviews) as reviews from per_card group by day
 ) x
$$;
revoke all on function public.study_daily_stats_v3(uuid) from public,anon,authenticated;
grant execute on function public.study_daily_stats_v3(uuid) to service_role;
notify pgrst,'reload schema';
commit;
