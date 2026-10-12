-- Additive queue/statistics revision. Old RPCs remain available for app rollback.
begin;
create or replace function public.study_start_learning_v3(p_user uuid,p_ids jsonb,p_settings jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d date:=(now() at time zone 'Asia/Shanghai')::date; plan study_days%rowtype; ids jsonb; fresh jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 if exists(select 1 from study_settings where user_id=p_user and nullif(settings->>'pausedUntil','')::timestamptz>now()) then raise exception 'study paused';end if;
 if jsonb_array_length(p_ids)>50000 or exists(select 1 from jsonb_array_elements_text(p_ids) x where not exists(select 1 from study_cards c where c.user_id=p_user and c.id=x and not c.suspended and (not c.anki_pending or coalesce((p_settings->>'includeAnki')::boolean,false)))) then raise exception 'invalid study plan';end if;
 select * into plan from study_days where user_id=p_user and day=d for update;
 if found then
  -- Existing review targets stay fixed; all ongoing steps and newly saved words can join.
  select coalesce(jsonb_agg(c.id order by c.created_at,c.id),'[]') into ids from study_cards c
  where c.user_id=p_user and not c.suspended and (not c.anki_pending or coalesce((p_settings->>'includeAnki')::boolean,false))
    and (plan.card_ids ? c.id or (p_ids ? c.id and (c.memory->>'state')::int in(0,1,3)));
 else ids:=p_ids;
 end if;
 -- State 1 is initial learning, even when begun yesterday. State 3 is relearning.
 select coalesce(jsonb_agg(c.id),'[]') into fresh from study_cards c where c.user_id=p_user and ids ? c.id
   and (coalesce(plan.new_ids,'[]') ? c.id or (c.memory->>'state')::int in(0,1));
 insert into study_days(user_id,day,card_ids,new_ids,settings) values(p_user,d,ids,fresh,p_settings||'{"flexibleNew":true,"learningQueue":3}')
 on conflict(user_id,day) do update set card_ids=ids,new_ids=fresh,settings=study_days.settings||'{"flexibleNew":true,"learningQueue":3}';
 select * into plan from study_days where user_id=p_user and day=d;return to_jsonb(plan);
end $$;

create or replace function public.study_present_v3(p_user uuid,p_card text,p_version bigint) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c study_cards%rowtype; token uuid:=gen_random_uuid(); priority int; d date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 if exists(select 1 from study_settings where user_id=p_user and nullif(settings->>'pausedUntil','')::timestamptz>now()) then return '{"paused":true}';end if;
 select * into c from study_cards where user_id=p_user and id=p_card for update;
 if not found or c.version<>p_version or c.suspended then return '{"conflict":true}';end if;
 if (c.memory->>'due')::timestamptz>now() then return '{"notDue":true}';end if;
 if not exists(select 1 from study_days where user_id=p_user and day=d and card_ids ? p_card) then return '{"notPlanned":true}';end if;
 if c.anki_pending and not exists(select 1 from study_settings where user_id=p_user and coalesce((settings->>'includeAnki')::boolean,false)) then return '{"ankiPending":true}';end if;
 priority:=case (c.memory->>'state')::int when 0 then 2 when 2 then 1 else 0 end;
 if exists(select 1 from study_days p join study_cards r on r.user_id=p.user_id and p.card_ids ? r.id
   where p.user_id=p_user and p.day=d and not r.suspended
   and (r.memory->>'due')::timestamptz<=now()
   and (not r.anki_pending or coalesce((p.settings->>'includeAnki')::boolean,false))
   and case (r.memory->>'state')::int when 0 then 2 when 2 then 1 else 0 end < priority)
 then return '{"earlierStageFirst":true}';end if;
 update study_cards set presentation_id=token,shown_at=now() where user_id=p_user and id=p_card;
 return jsonb_build_object('token',token,'shownAt',now());
end $$;

create or replace function public.study_review_v3(p_user uuid,p_id uuid,p_card text,p_version bigint,p_token uuid,p_answer text,p_rating integer,p_active integer,p_memory jsonb,p_algorithm text,p_parameters jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c study_cards%rowtype; previous_review study_reviews%rowtype; elapsed integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 select * into previous_review from study_reviews where user_id=p_user and id=p_id;
 if found then
  if previous_review.card_id<>p_card or previous_review.answer<>p_answer then raise exception 'review id reused';end if;
  return jsonb_build_object('duplicate',true,'review',to_jsonb(previous_review));
 end if;
 if exists(select 1 from study_settings where user_id=p_user and nullif(settings->>'pausedUntil','')::timestamptz>now()) then return '{"paused":true}';end if;
 select * into c from study_cards where user_id=p_user and id=p_card for update;
 if not found or c.version<>p_version or c.presentation_id is distinct from p_token or c.suspended then return '{"conflict":true}';end if;
 if not exists(select 1 from study_days where user_id=p_user and day=(now() at time zone 'Asia/Shanghai')::date and card_ids ? p_card) then return '{"dayChanged":true}';end if;
 if c.anki_pending and not exists(select 1 from study_settings where user_id=p_user and coalesce((settings->>'includeAnki')::boolean,false)) then return '{"ankiPending":true}';end if;
 -- A card already presented can finish if a timed learning step becomes due meanwhile.
 if p_rating<>(case p_answer when 'forgot' then 1 when 'unsure_wrong' then 1 when 'unsure_right' then 2 when 'remembered' then 3 else 0 end) then raise exception 'invalid recall outcome';end if;
 elapsed:=greatest(0,floor(extract(epoch from(now()-c.shown_at))*1000));
 if elapsed<800 then return '{"tooFast":true}';end if;
 if (select count(*) from study_reviews where user_id=p_user and reviewed_at>now()-interval '1 minute')>=45 then raise exception 'review rate exceeded';end if;
 insert into study_reviews(user_id,id,card_id,answer,rating,active_ms,previous,next,algorithm,parameters,version)
 values(p_user,p_id,p_card,p_answer,p_rating,least(60000,greatest(0,p_active),elapsed),c.memory,p_memory,p_algorithm,p_parameters,c.version+1);
 update study_cards set memory=p_memory,version=version+1,presentation_id=null,shown_at=null where user_id=p_user and id=p_card;
 return '{"saved":true}';
end $$;

create or replace function public.study_daily_stats_v3(p_user uuid) returns jsonb
language sql security definer set search_path=public as $$
 with graduations as (
  select card_id,min(reviewed_at) as graduated_at from study_reviews
  where user_id=p_user and not undone and (previous->>'state')::int in(0,1) and (next->>'state')::int=2 group by card_id
 ), per_card as (
  select (r.reviewed_at at time zone 'Asia/Shanghai')::date as day,r.card_id,
   (array_agg((r.next->>'state')::int order by r.reviewed_at desc,r.version desc,r.id desc))[1] in(1,3) as learning,
   bool_or((r.previous->>'state')::int in(2,3)) as reviewed,
   bool_or((g.graduated_at at time zone 'Asia/Shanghai')::date=(r.reviewed_at at time zone 'Asia/Shanghai')::date) as graduated,
   sum(r.active_ms) as active_ms,count(*) filter(where r.rating>1) as successes,count(*) as reviews
  from study_reviews r left join graduations g on g.card_id=r.card_id
  where r.user_id=p_user and not r.undone and r.reviewed_at>=(((now() at time zone 'Asia/Shanghai')::date-364)::timestamp at time zone 'Asia/Shanghai')
  group by 1,2
 ) select coalesce(jsonb_agg(x order by x.day),'[]') from (
  select day,count(*) as cards,
   count(*) filter(where graduated and not learning) as new_cards,
   count(*) filter(where reviewed and not graduated and not learning) as review_cards,
   count(*) filter(where learning) as learning_cards,
   sum(active_ms) as active_ms,sum(successes) as successes,sum(reviews) as reviews from per_card group by day
 ) x
$$;
do $$ declare f record;begin
 for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace
 and proname in('study_start_learning_v3','study_present_v3','study_review_v3','study_daily_stats_v3') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
