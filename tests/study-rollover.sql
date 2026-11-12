begin;
do $$
declare
  u uuid:=gen_random_uuid(); ids jsonb; before_cards jsonb; result jsonb;
  s jsonb:='{"reviewsPerDay":40,"reviewBudgetVersion":1,"includeAnki":false}';
  before_midnight timestamptz:='2026-11-11 23:59:00+08';
  after_midnight timestamptz:='2026-11-12 00:00:00+08';
  carry text:=repeat('a',40); relearn text:=repeat('b',40); old_card text:=lpad('1',40,'0');
  memory jsonb; short_step jsonb;
begin
  assert current_database()='context_reader_rollover_1112','isolated database only';
  insert into auth.users(id) values(u);
  insert into study_settings(user_id,settings) values(u,s);
  memory:=jsonb_build_object('state',2,'due',before_midnight-interval '1 day','stability',5,'difficulty',5,'reps',3,'last_review',before_midnight-interval '3 days');
  short_step:=memory||jsonb_build_object('state',1,'due',after_midnight+interval '4 minutes','last_review',before_midnight);
  insert into study_cards(user_id,id,entry_id,mode,memory)
  select u,lpad(i::text,40,'0'),i::text,'basic_en_to_cn',memory from generate_series(1,50) i;
  insert into study_cards(user_id,id,entry_id,mode,memory) values
    (u,carry,'carried','basic_en_to_cn',short_step),
    (u,relearn,'relearn','basic_en_to_cn',short_step||jsonb_build_object('state',3,'due',after_midnight-interval '1 second'));
  select jsonb_agg(c.id order by c.id),jsonb_agg(to_jsonb(c) order by c.id) into ids,before_cards
  from study_cards c where user_id=u and c.id not in (carry,relearn);
  insert into study_days(user_id,day,card_ids,new_ids,settings)
  values(u,'2026-11-11',jsonb_build_array(carry,relearn),jsonb_build_array(carry),s),
    (u,'2026-11-12',(select jsonb_agg(id order by ord) from jsonb_array_elements_text(ids) with ordinality x(id,ord) where ord<=40),'[]',s);
  result:=study_start_day_budget_v6(u,ids,s,after_midnight);
  assert jsonb_array_length(result->'card_ids')=42 and (result->'card_ids') ? carry and (result->'card_ids') ? relearn,'restore both short steps alongside forty old reviews';
  assert (result->'new_ids') ? carry and not (result->'new_ids') ? relearn,'initial learning and relearning retain reward classification';
  assert not study_ready_day_v4(short_step,after_midnight) and study_ready_day_v4(short_step,after_midnight+interval '4 minutes'),'exact timer survived midnight';
  assert (select jsonb_agg(to_jsonb(c) order by c.id) from study_cards c where c.user_id=u and c.id not in (carry,relearn))=before_cards,'old card memory untouched';
  assert (select c.memory from study_cards c where c.user_id=u and c.id=carry)=short_step,'carried card memory untouched';

  perform study_local_event_day_v4(u,jsonb_build_object('id',gen_random_uuid(),'at',after_midnight+interval '4 minutes','kind','review','cardId',carry,'answer','remembered','activeMs',1000),
    0,short_step||jsonb_build_object('state',2,'due',after_midnight+interval '2 days','last_review',after_midnight+interval '4 minutes'),s,result->'card_ids','test');
  perform study_local_event_day_v4(u,jsonb_build_object('id',gen_random_uuid(),'at',after_midnight,'kind','review','cardId',old_card,'answer','forgot','activeMs',1000),
    0,memory||jsonb_build_object('state',3,'due',after_midnight+interval '5 minutes','last_review',after_midnight),s,result->'card_ids','test');
  result:=study_start_day_budget_v6(u,ids,s,after_midnight+interval '5 minutes');
  assert jsonb_array_length(result->'card_ids')=42 and (result->'new_ids') ? carry,'graduated carry and same-day old slot stay on plan';
  assert (select count(*) from study_reviews where user_id=u)=2,'no review events added by replanning';
  assert not has_function_privilege('anon','public.study_start_day_budget_v6(uuid,jsonb,jsonb,timestamptz)','execute'),'anon denied';
  assert not has_function_privilege('authenticated','public.study_start_day_budget_v6(uuid,jsonb,jsonb,timestamptz)','execute'),'browser denied';
end $$;
rollback;
