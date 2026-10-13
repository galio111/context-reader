-- Run against isolated production schema only. All fixtures roll back.
begin;
do $$
declare u uuid:=gen_random_uuid();v uuid:=gen_random_uuid(); t uuid; r jsonb; m jsonb; pending_id uuid:=gen_random_uuid();
 l text:=repeat('a',40); o text:=repeat('b',40); n text:=repeat('c',40); late text:=repeat('d',40);
begin
 assert current_database()='context_reader_cet6_1012','isolated database required';
 insert into auth.users(id) values(u),(v);
 m:=jsonb_build_object('state',0,'due',now()-interval '1 minute','stability',0,'difficulty',0,'elapsed_days',0,'scheduled_days',0,'reps',0,'lapses',0,'learning_steps',0);
 insert into study_cards(user_id,id,entry_id,mode,memory) values
 (u,l,'learning','basic_en_to_cn',m||'{"state":1}'),(u,o,'review','basic_en_to_cn',m||'{"state":2}'),(u,n,'new','basic_en_to_cn',m);
 r:=study_start_learning_v3(u,to_jsonb(array[l,o,n]),'{"retention":0.9,"reviewsPerDay":1}');
 assert r->'new_ids' ? l and r->'new_ids' ? n and not r->'new_ids' ? o,'initial learning stays new until graduation';
 assert study_present_v3(u,o,0)->>'earlierStageFirst'='true','learning first';
 assert study_present_v3(u,n,0)->>'earlierStageFirst'='true','new blocked before old pass';
 assert study_present_v3(v,l,0)->>'conflict'='true','owner isolation';
 t:=(study_present_v3(u,l,0)->>'token')::uuid;assert t is not null;
 assert study_review_v3(u,gen_random_uuid(),l,0,t,'forgot',1,1000,m,'FSRS-6','{}')->>'tooFast'='true';
 update study_cards set shown_at=now()-interval '2 seconds' where user_id=u and id=l;
 r:=study_review_v3(u,gen_random_uuid(),l,0,t,'forgot',1,1000,m||jsonb_build_object('state',1,'last_review',now(),'due',now()+interval '5 minutes'),'FSRS-6','{}');
 assert r->>'saved'='true';
 r:=study_daily_stats_v3(u);assert (r->0->>'new_cards')::int=0 and (r->0->>'learning_cards')::int=1,'unfinished learning is not new completion';
 t:=(study_present_v3(u,o,0)->>'token')::uuid;assert t is not null,'waiting learning allows review';
 update study_cards set shown_at=now()-interval '2 seconds' where user_id=u and id=o;
 assert study_review_v3(u,gen_random_uuid(),o,0,t,'forgot',1,1000,m||jsonb_build_object('state',3,'last_review',now(),'due',now()+interval '5 minutes'),'FSRS-6','{}')->>'saved'='true';
 t:=(study_present_v3(u,n,0)->>'token')::uuid;assert t is not null,'waiting learning/relearning allows new';
 -- Becoming due during a shown question does not invalidate that answer.
 update study_cards set memory=memory||jsonb_build_object('due',now()-interval '1 second') where user_id=u and id=l;
 update study_cards set shown_at=now()-interval '2 seconds' where user_id=u and id=n;
 assert study_review_v3(u,gen_random_uuid(),n,0,t,'remembered',3,1000,m||jsonb_build_object('state',1,'last_review',now(),'due',now()+interval '10 minutes'),'FSRS-6','{}')->>'saved'='true';
 t:=(study_present_v3(u,l,1)->>'token')::uuid;assert t is not null,'due learning returns';
 update study_cards set shown_at=now()-interval '2 seconds' where user_id=u and id=l;
 assert study_review_v3(u,gen_random_uuid(),l,1,t,'remembered',3,1000,m||jsonb_build_object('state',2,'last_review',now(),'due',now()+interval '3 days'),'FSRS-6','{}')->>'saved'='true';
 r:=study_daily_stats_v3(u);assert (r->0->>'new_cards')::int=1 and (r->0->>'learning_cards')::int=1,'first learning counts once independently of graduation';
 -- Cross-midnight learning counts on its first learning day, never again on graduation.
 insert into study_cards(user_id,id,entry_id,mode,memory) values(u,late,'cross-day','basic_en_to_cn',m||'{"state":1}');
 insert into study_reviews(user_id,id,card_id,answer,rating,active_ms,previous,next,algorithm,parameters,version,reviewed_at) values
 (u,gen_random_uuid(),late,'forgot',1,1000,m,m||'{"state":1}','FSRS-6','{}',1,now()-interval '1 day'),
 (u,gen_random_uuid(),late,'remembered',3,1000,m||'{"state":1}',m||'{"state":2}','FSRS-6','{}',2,now());
 r:=study_daily_stats_v3(u);assert (r->0->>'new_cards')::int=1 and (r->1->>'new_cards')::int=1,'cross-day first-learning statistics';
 -- An outbox may replay yesterday's answer before today's start request finishes.
 insert into study_cards(user_id,id,entry_id,mode,memory) values(v,l,'pending-yesterday','basic_en_to_cn',m||'{"state":1}');
 perform study_start_learning_v3(v,to_jsonb(array[l]),'{"retention":0.9,"reviewsPerDay":1}');
 t:=(study_present_v3(v,l,0)->>'token')::uuid;
 update study_cards set shown_at=now()-interval '1 day' where user_id=v and id=l;
 update study_days set day=day-1 where user_id=v;
 r:=study_review_v3(v,pending_id,l,0,t,'forgot',1,1000,m||jsonb_build_object('state',1,'last_review',now(),'due',now()+interval '5 minutes'),'FSRS-6','{}');
 assert r->>'dayChanged'='true' and not exists(select 1 from study_reviews where user_id=v and id=pending_id),'day change is retryable and does not save';
 perform study_start_learning_v3(v,to_jsonb(array[l]),'{"retention":0.9,"reviewsPerDay":1}');
 assert exists(select 1 from study_cards where user_id=v and id=l and version=0 and presentation_id=t),'start preserves the prior presentation';
 r:=study_review_v3(v,pending_id,l,0,t,'forgot',1,1000,m||jsonb_build_object('state',1,'last_review',now(),'due',now()+interval '5 minutes'),'FSRS-6','{}');
 assert r->>'saved'='true','unchanged pending answer recovers after midnight';
 assert study_review_v3(v,pending_id,l,0,t,'forgot',1,1000,m,'FSRS-6','{}')->>'duplicate'='true','recovered answer remains idempotent';
 assert (select count(*) from study_reviews where user_id=v and id=pending_id)=1,'one recovered review';
 assert not has_function_privilege('authenticated','study_review_v3(uuid,uuid,text,bigint,uuid,text,integer,integer,jsonb,text,jsonb)','execute');
 assert not has_function_privilege('anon','study_daily_stats_v3(uuid)','execute');
 raise notice 'PASS learning queue, due times, cross-day graduation, ownership, server timing and grants';
end $$;
rollback;
