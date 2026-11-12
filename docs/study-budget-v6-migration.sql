-- Keep unfinished FSRS steps across Shanghai midnight without using old-review slots.
begin;
create or replace function public.study_start_day_budget_v6(p_user uuid,p_ids jsonb,p_settings jsonb,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  d date := (p_at at time zone 'Asia/Shanghai')::date;
  day_start timestamptz := d::timestamp at time zone 'Asia/Shanghai';
  day_end timestamptz := (d+1)::timestamp at time zone 'Asia/Shanghai';
  plan study_days%rowtype;
  introduced jsonb; reviewed jsonb; continued jsonb; initial_steps jsonb;
  ids jsonb; candidates jsonb; allowance int; remaining int;
  include_anki boolean := coalesce((p_settings->>'includeAnki')::boolean,false);
begin
  perform pg_advisory_xact_lock(hashtextextended('study:'||p_user,0));
  if jsonb_typeof(p_ids)<>'array' or jsonb_array_length(p_ids)>50000 then raise exception 'invalid study plan';end if;
  select * into plan from study_days where user_id=p_user and day=d for update;
  allowance:=greatest(1,least(300,coalesce((p_settings->>'reviewsPerDay')::int,40)))+
    case when p_settings->>'reviewExtraDay'=d::text then greatest(0,least(300,coalesce((p_settings->>'reviewExtraCount')::int,0))) else 0 end;

  select
    coalesce(jsonb_agg(distinct card_id order by card_id) filter (where (previous->>'state')::int=0),'[]'),
    coalesce(jsonb_agg(distinct card_id order by card_id) filter (where (previous->>'state')::int=2),'[]'),
    coalesce(jsonb_agg(distinct card_id order by card_id) filter (where (previous->>'state')::int in (1,3)),'[]'),
    coalesce(jsonb_agg(distinct card_id order by card_id) filter (where (previous->>'state')::int=1),'[]')
  into introduced, reviewed, continued, initial_steps from study_reviews
  where user_id=p_user and reviewed_at>=day_start and reviewed_at<day_end;

  select coalesce(jsonb_agg(id order by id),'[]') into reviewed
  from jsonb_array_elements_text(reviewed) x(id) where not introduced ? id;
  remaining:=greatest(0,allowance-jsonb_array_length(reviewed));
  candidates:=case when plan.settings->>'reviewBudgetVersion'='1' then plan.card_ids else '[]'::jsonb end || p_ids;
  select coalesce(jsonb_agg(c.id order by c.id),'[]') into ids from study_cards c
  where c.user_id=p_user and reviewed ? c.id and not c.suspended and (not c.anki_pending or include_anki);
  select ids||coalesce(jsonb_agg(id order by ord),'[]') into ids from (
    select c.id,min(x.ord) ord from jsonb_array_elements_text(candidates) with ordinality x(id,ord)
    join study_cards c on c.user_id=p_user and c.id=x.id
    where not c.suspended and (not c.anki_pending or include_anki)
      and (c.memory->>'state')::int=2 and not introduced ? c.id and not reviewed ? c.id and not continued ? c.id
    group by c.id order by min(x.ord) limit remaining
  ) chosen;

  -- Read current memory under the same lock so a concurrent answer cannot lose a short step.
  select ids||coalesce(jsonb_agg(c.id order by c.created_at,c.id),'[]') into ids from study_cards c
  where c.user_id=p_user and not c.suspended and (not c.anki_pending or include_anki) and not reviewed ? c.id
    and (introduced ? c.id or continued ? c.id or (c.memory->>'state')::int in (1,3)
      or (p_ids ? c.id and (c.memory->>'state')::int=0));

  -- Preserve first-graduation rewards for initial learning, including across days.
  select coalesce(jsonb_agg(c.id order by c.id),'[]') into initial_steps from study_cards c
  where c.user_id=p_user and ids ? c.id
    and (coalesce(plan.new_ids,'[]') ? c.id or introduced ? c.id or initial_steps ? c.id or (c.memory->>'state')::int in (0,1));
  insert into study_days(user_id,day,card_ids,new_ids,settings)
  values(p_user,d,ids,initial_steps,p_settings||'{"flexibleNew":true,"learningQueue":4,"reviewBudgetVersion":1}')
  on conflict(user_id,day) do update set card_ids=excluded.card_ids,new_ids=excluded.new_ids,settings=excluded.settings;
  select * into plan from study_days where user_id=p_user and day=d;
  return to_jsonb(plan);
end $$;
revoke all on function public.study_start_day_budget_v6(uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.study_start_day_budget_v6(uuid,jsonb,jsonb,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
