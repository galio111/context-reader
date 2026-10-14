-- Isolated database only. Every fixture is rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();cid text:=repeat('a',40);m jsonb;next_m jsonb;e jsonb;r jsonb;review_id uuid:=gen_random_uuid();undo_id uuid:=gen_random_uuid();s jsonb:='{"retention":0.9,"reviewsPerDay":200,"includeAnki":true}';
begin
 assert current_database()='context_reader_study_1005';
 insert into auth.users(id) values(u),(v);
 m:=jsonb_build_object('state',2,'due',now()-interval '1 minute','stability',5,'difficulty',5,'elapsed_days',1,'scheduled_days',1,'reps',3,'lapses',0,'learning_steps',0);
 next_m:=m||jsonb_build_object('state',3,'last_review',now(),'due',now()+interval '5 minutes','reps',4);
 insert into study_cards(user_id,id,entry_id,mode,memory) values(u,cid,'qa','basic_en_to_cn',m);
 e:=jsonb_build_object('id',review_id,'kind','review','cardId',cid,'at',now(),'answer','forgot','activeMs',1200,'permit','test');
 r:=study_local_event_v1(u,e,0,next_m,s,jsonb_build_array(cid),'FSRS-6');assert r->>'saved'='true';
 r:=study_local_event_v1(u,e,0,next_m,s,jsonb_build_array(cid),'FSRS-6');assert r->>'duplicate'='true';
 assert (select count(*) from study_reviews where user_id=u)=1;
 assert (select version from study_cards where user_id=u and study_cards.id=cid)=1;
 -- Same immutable id with different content is rejected, never silently merged.
 begin perform study_local_event_v1(u,e||'{"answer":"remembered"}',1,m,s,'[]','FSRS-6');raise exception 'expected id rejection';exception when raise_exception then assert sqlerrm='event id reused';end;
 -- Another account cannot update the first account's card.
 r:=study_local_event_v1(v,e,1,m,s,'[]','FSRS-6');assert r->>'removed'='true';
 assert (select version from study_cards where user_id=u and study_cards.id=cid)=1;
 e:=jsonb_build_object('id',undo_id,'kind','undo','reviewId',review_id,'at',now()+interval '1 second','permit','test');
 r:=study_local_event_v1(u,e,1,null,s,'[]','FSRS-6');assert r->>'saved'='true';
 assert (select undone from study_reviews where user_id=u and study_reviews.id=review_id);
 assert (select memory from study_cards where user_id=u and study_cards.id=cid)=m;
 r:=study_local_event_v1(u,e,1,null,s,'[]','FSRS-6');assert r->>'duplicate'='true';
 assert (select version from study_cards where user_id=u and study_cards.id=cid)=2;
 e:=jsonb_build_object('id',gen_random_uuid(),'kind','review','cardId',cid,'at',now(),'answer','remembered','activeMs',2000,'permit','test');
 assert study_local_event_v1(u,e,1,next_m,s,'[]','FSRS-6')->>'retry'='true';
 assert (select count(*) from study_local_events where user_id=u)=2;
 assert not has_function_privilege('anon','public.study_local_event_v1(uuid,jsonb,bigint,jsonb,jsonb,jsonb,text)','execute');
 assert not has_table_privilege('authenticated','public.study_local_events','select');
end $$;
rollback;
