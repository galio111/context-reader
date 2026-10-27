begin;
do $$
declare u uuid:=gen_random_uuid(); ids jsonb; s jsonb:='{"reviewsPerDay":40,"reviewBudgetVersion":1,"includeAnki":true}';
 r jsonb; m jsonb; before_cards jsonb; cid text; ev jsonb; day date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 assert current_database()='context_reader_budget_1027','isolated database only';
 insert into auth.users(id) values(u);
 insert into study_settings(user_id,settings) values(u,s);
 m:=jsonb_build_object('state',2,'due',now()-interval '1 day','stability',5,'difficulty',5,'reps',3,'last_review',now()-interval '3 days');
 insert into study_cards(user_id,id,entry_id,mode,memory)
 select u,lpad(i::text,40,'0'),i::text,'basic_en_to_cn',m from generate_series(1,320) i;
 select jsonb_agg(id order by id),jsonb_agg(to_jsonb(c) order by id) into ids,before_cards from study_cards c where user_id=u;
 insert into study_days(user_id,day,card_ids,new_ids,settings) values(u,day,ids,'[]','{}');
 r:=study_start_day_budget_v5(u,ids,s);
 assert jsonb_array_length(r->'card_ids')=40,'legacy unlimited plan capped';
 assert (select jsonb_agg(to_jsonb(c) order by id) from study_cards c where user_id=u)=before_cards,'memories and versions unchanged';
 for cid in select jsonb_array_elements_text(r->'card_ids') loop
  ev:=jsonb_build_object('id',gen_random_uuid(),'at',now(),'kind','review','cardId',cid,'answer','remembered','activeMs',1000);
  perform study_local_event_day_v4(u,ev,0,m||jsonb_build_object('due',now()+interval '7 days','last_review',now()),s,r->'card_ids','test');
 end loop;
 r:=study_start_day_budget_v5(u,ids,s);
 assert jsonb_array_length(r->'card_ids')=40,'reload does not refill completed slots';
 assert (select count(*) from study_reviews where user_id=u)=40,'exactly forty historical answers';
 r:=study_start_day_budget_v5(u,ids,s||jsonb_build_object('reviewExtraDay',day::text,'reviewExtraCount',10));
 assert jsonb_array_length(r->'card_ids')=50,'explicit ten extra';
 r:=study_start_day_budget_v5(u,ids,s||jsonb_build_object('reviewExtraDay',day::text,'reviewExtraCount',10));
 assert jsonb_array_length(r->'card_ids')=50,'repeat extra settings idempotent';
 r:=study_start_day_budget_v5(u,ids,s||'{"reviewsPerDay":20}');
 assert jsonb_array_length(r->'card_ids')=40,'lower cap preserves completed history';
 assert not has_function_privilege('anon','public.study_start_day_budget_v5(uuid,jsonb,jsonb,timestamptz)','execute'),'anon denied';
 assert not has_function_privilege('authenticated','public.study_start_day_budget_v5(uuid,jsonb,jsonb,timestamptz)','execute'),'browser denied';
end $$;
rollback;
