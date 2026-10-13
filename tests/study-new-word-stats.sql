begin;
do $$
declare u uuid:=gen_random_uuid(); n text:=repeat('a',40); old text:=repeat('b',40); yesterday text:=repeat('c',40); m jsonb; r jsonb; dayrow jsonb;
begin
 assert current_database()='context_reader_study_1005','isolated database required';
 insert into auth.users(id) values(u);
 m:=jsonb_build_object('state',0,'due',now());
 insert into study_cards(user_id,id,entry_id,mode,memory) values(u,n,'new','basic_en_to_cn',m),(u,old,'old','basic_en_to_cn',m),(u,yesterday,'yesterday','basic_en_to_cn',m);
 insert into study_reviews(user_id,id,card_id,answer,rating,active_ms,previous,next,algorithm,parameters,version,reviewed_at) values
 (u,gen_random_uuid(),n,'forgot',1,1000,m,m||'{"state":1}','FSRS-6','{}',1,now()),
 (u,gen_random_uuid(),n,'remembered',3,1000,m||'{"state":1}',m||'{"state":2}','FSRS-6','{}',2,now()),
 (u,gen_random_uuid(),old,'remembered',3,1000,m||'{"state":2}',m||'{"state":2}','FSRS-6','{}',1,now()),
 (u,gen_random_uuid(),yesterday,'forgot',1,1000,m,m||'{"state":1}','FSRS-6','{}',1,now()-interval '1 day'),
 (u,gen_random_uuid(),yesterday,'remembered',3,1000,m||'{"state":1}',m||'{"state":2}','FSRS-6','{}',2,now());
 r:=study_daily_stats_v3(u);dayrow:=r->1;
 assert (r->0->>'new_cards')::int=1,'count new word on its first learning day';
 assert (dayrow->>'new_cards')::int=1,'new forgotten word counts; repeat and old remembered answers do not';
 assert (dayrow->>'review_cards')::int=1 and (dayrow->>'learning_cards')::int=1,'distinct origin categories';
 assert (dayrow->>'cards')::int=3 and (dayrow->>'reviews')::int=4,'word counts differ from click counts';
 update study_reviews set undone=true where user_id=u and card_id=n;
 r:=study_daily_stats_v3(u);assert (r->1->>'new_cards')::int=0,'undo removes first learning from count';
 assert not has_function_privilege('anon','study_daily_stats_v3(uuid)','execute');
 assert not has_function_privilege('authenticated','study_daily_stats_v3(uuid)','execute');
 raise notice 'PASS first-learning day, wrong first answer, repeat deduplication, old review, prior-day learning, undo and permissions';
end $$;
rollback;
