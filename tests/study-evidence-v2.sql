begin;
do $$
declare u uuid:=gen_random_uuid(); d date:=(now() at time zone 'Asia/Shanghai')::date; r jsonb; c text:=repeat('a',40); m jsonb:='{"state":0}';
begin
 assert current_database()='context_reader_study_refine_1010','isolated restore required';
 insert into auth.users(id) values(u);
 insert into study_reading_days(user_id,day,active_seconds,last_tick) values(u,d,12000,now()-interval '60 seconds');
 assert (select verified_seconds from study_reading_days where user_id=u)=0,'legacy totals are not verified';
 perform study_reading_tick_v2(u,90,'["flourish","Flourish"]','one');
 assert (select verified_seconds from study_reading_days where user_id=u)=30,'bounded to 30';
 perform study_reading_tick_v2(u,30,'[]','one');
 assert (select verified_seconds from study_reading_days where user_id=u)=30,'parallel requests cannot multiply wall time';
 assert (select jsonb_array_length(words) from study_reading_days where user_id=u)=1,'distinct words';
 update study_reading_days set last_tick=now()-interval '120 seconds' where user_id=u;
 perform study_reading_tick_v2(u,0,'[]','one');
 assert (select verified_seconds from study_reading_days where user_id=u)=30,'idle earns zero';
 insert into study_cards(user_id,id,entry_id,mode,memory,reward_key) values(u,c,'qa','basic_en_to_cn',m,'qa');
 insert into study_reviews(user_id,id,card_id,answer,rating,reviewed_at,active_ms,previous,next,algorithm,parameters,version) values
 (u,gen_random_uuid(),c,'remembered',3,d::timestamp at time zone 'Asia/Shanghai',1000,m,m,'FSRS-6','{}',1),
 (u,gen_random_uuid(),c,'remembered',3,now(),2000,'{"state":1}',m,'FSRS-6','{}',2),
 (u,gen_random_uuid(),c,'remembered',3,(d-364)::timestamp at time zone 'Asia/Shanghai',3000,'{"state":2}',m,'FSRS-6','{}',3),
 (u,gen_random_uuid(),c,'remembered',3,(d-365)::timestamp at time zone 'Asia/Shanghai',4000,'{"state":2}',m,'FSRS-6','{}',4);
 r:=study_daily_stats_v2(u);
 assert jsonb_array_length(r)=2,'365 Shanghai days only';
 assert (r->1->>'new_cards')::int=1 and (r->1->>'review_cards')::int=0,'same-day repeated new card counted once';
 assert (r->1->>'reviews')::int=2 and (r->1->>'active_ms')::int=3000,'actual attempts and time retained';
 assert (r->0->>'review_cards')::int=1,'old review separately counted';
 update study_reviews set undone=true where user_id=u and version=2;
 assert (study_daily_stats_v2(u)->1->>'active_ms')::int=1000,'undo excluded';
 assert not has_function_privilege('authenticated','study_reading_tick_v2(uuid,integer,jsonb,text)','execute'),'browser cannot forge reading';
 assert not has_function_privilege('anon','study_daily_stats_v2(uuid)','execute'),'stats are server only';
 assert has_function_privilege('service_role','study_daily_stats_v2(uuid)','execute'),'server can read stats';
 raise notice 'PASS verified activity, legacy isolation, wall cap, distinct words, yearly daily stats, new/review split, undo, permissions';
end $$;
rollback;
