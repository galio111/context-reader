-- Additive plan reconciliation. Never rewrite card memories or review history.
begin;
create or replace function public.study_start_day_budget_v5(p_user uuid,p_ids jsonb,p_settings jsonb,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public as $$
declare d date:=(p_at at time zone 'Asia/Shanghai')::date; plan study_days%rowtype;
  used jsonb; fresh jsonb; ids jsonb; candidates jsonb; allowance int; remaining int;
begin
 perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
 if jsonb_typeof(p_ids)<>'array' or jsonb_array_length(p_ids)>50000 then raise exception 'invalid study plan';end if;
 select * into plan from study_days where user_id=p_user and day=d for update;
 allowance:=greatest(1,least(300,coalesce((p_settings->>'reviewsPerDay')::int,40)))+
   case when p_settings->>'reviewExtraDay'=d::text then greatest(0,least(300,coalesce((p_settings->>'reviewExtraCount')::int,0))) else 0 end;
 -- New words are identified by actual introductions, not legacy new_ids (which included yesterday's Learning).
 select coalesce(jsonb_agg(distinct card_id),'[]') into fresh from study_reviews
 where user_id=p_user and (reviewed_at at time zone 'Asia/Shanghai')::date=d and (previous->>'state')::int=0;
 select coalesce(jsonb_agg(distinct card_id),'[]') into used from study_reviews
 where user_id=p_user and (reviewed_at at time zone 'Asia/Shanghai')::date=d and not fresh ? card_id and (previous->>'state')::int<>0;
 remaining:=greatest(0,allowance-jsonb_array_length(used));
 candidates:=case when plan.settings->>'reviewBudgetVersion'='1' then plan.card_ids else '[]'::jsonb end || p_ids;
 select used||coalesce(jsonb_agg(id order by ord),'[]') into ids from (
   select c.id,min(x.ord) ord from jsonb_array_elements_text(candidates) with ordinality x(id,ord)
   join study_cards c on c.user_id=p_user and c.id=x.id
   where not c.suspended and (not c.anki_pending or coalesce((p_settings->>'includeAnki')::boolean,false))
     and (c.memory->>'state')::int<>0 and not fresh ? c.id and not used ? c.id
   group by c.id order by min(x.ord) limit remaining
 ) chosen;
 select coalesce(jsonb_agg(c.id order by c.created_at,c.id),'[]') into fresh from study_cards c
 where c.user_id=p_user and not c.suspended and (not c.anki_pending or coalesce((p_settings->>'includeAnki')::boolean,false))
 and (fresh ? c.id or (p_ids ? c.id and (c.memory->>'state')::int=0));
 ids:=ids||fresh;
 -- Keep initial-learning membership for existing rewards; budgeting uses the ledger above.
 select coalesce(jsonb_agg(c.id),'[]') into fresh from study_cards c where c.user_id=p_user and ids ? c.id
 and (coalesce(plan.new_ids,'[]') ? c.id or (c.memory->>'state')::int in (0,1));
 insert into study_days(user_id,day,card_ids,new_ids,settings) values(p_user,d,ids,fresh,p_settings||'{"flexibleNew":true,"learningQueue":4,"reviewBudgetVersion":1}')
 on conflict(user_id,day) do update set card_ids=excluded.card_ids,new_ids=excluded.new_ids,settings=excluded.settings;
 select * into plan from study_days where user_id=p_user and day=d;
 return to_jsonb(plan);
end $$;
revoke all on function public.study_start_day_budget_v5(uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.study_start_day_budget_v5(uuid,jsonb,jsonb,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
