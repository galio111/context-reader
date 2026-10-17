-- Isolated database only; every fixture is rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid(); c text:=repeat('d',40); step text:=repeat('e',40); future text:=repeat('f',40); m jsonb; later timestamptz; r jsonb; eid uuid:=gen_random_uuid(); ev jsonb; before_cards jsonb; before_reviews jsonb;
begin
 assert current_database()='context_reader_day_1017','isolated database required';
 later:=(((now() at time zone 'Asia/Shanghai')::date+1)::timestamp at time zone 'Asia/Shanghai');
 insert into auth.users(id) values(u);
 insert into study_settings(user_id,settings) values(u,'{"includeAnki":true}');
 m:=jsonb_build_object('state',2,'due',later-interval '1 second','stability',5,'difficulty',5,'reps',3,'last_review',now()-interval '3 days');
 insert into study_cards(user_id,id,entry_id,mode,memory) values(u,c,c,'basic_en_to_cn',m),(u,step,step,'basic_en_to_cn',m||jsonb_build_object('state',1,'due',now()+interval '15 minutes')),(u,future,future,'basic_en_to_cn',m||jsonb_build_object('due',later));
 insert into study_days(user_id,day,card_ids,new_ids,settings) values(u,(now() at time zone 'Asia/Shanghai')::date,'[]','[]','{}');
 select jsonb_agg(to_jsonb(x) order by id) into before_cards from study_cards x where user_id=u;
 r:=study_start_day_v4(u,to_jsonb(array[c,step]),'{"includeAnki":true}');
 assert r->'card_ids' ? c and jsonb_array_length(r->'card_ids')=2,'existing plan repaired';
 assert (select jsonb_agg(to_jsonb(x) order by id) from study_cards x where user_id=u)=before_cards,'plan repair must not change any card field';
 assert not exists(select 1 from study_reviews where user_id=u),'plan repair must not create answers';
 assert study_present_day_v4(u,c,0) ? 'token','evening review ready at start of day';
 assert study_present_day_v4(u,step,0)->>'notDue'='true','short step still waits';
 assert study_present_day_v4(u,future,0)->>'notDue'='true','tomorrow cannot be accelerated';
 ev:=jsonb_build_object('id',eid,'at',now(),'kind','review','cardId',c,'answer','remembered','activeMs',1000);
 r:=study_local_event_day_v4(u,ev,0,m||jsonb_build_object('due',later+interval '3 days','last_review',now()),'{"includeAnki":true}',to_jsonb(array[c,step]),'test');
 assert r->>'saved'='true','same-day evening offline answer accepted';
 r:=study_local_event_day_v4(u,ev,0,m,'{}','[]','test');assert r->>'duplicate'='true','idempotent replay';
 assert (select count(*) from study_reviews where user_id=u)=1,'no doubled answer';
 assert (select previous from study_reviews where user_id=u)=m,'original memory retained in ledger';
 ev:=jsonb_build_object('id',gen_random_uuid(),'at',now(),'kind','undo','reviewId',eid);
 r:=study_local_event_day_v4(u,ev,1,m,'{}','[]','test');
 assert (select memory from study_cards where user_id=u and id=c)=m,'undo restores exact original memory';
 assert (select undone from study_reviews where user_id=u),'undo preserved';
 assert not has_function_privilege('anon','public.study_start_day_v4(uuid,jsonb,jsonb)','execute'),'anon blocked';
 assert not has_function_privilege('authenticated','public.study_local_event_day_v4(uuid,jsonb,bigint,jsonb,jsonb,jsonb,text)','execute'),'browser blocked';
end $$;
rollback;
