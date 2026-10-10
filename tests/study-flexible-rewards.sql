-- Rollback-only checks against a fresh, verified production backup.
begin;
do $$
declare u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();d date:=(now() at time zone 'Asia/Shanghai')::date;
 r jsonb;m jsonb;done jsonb;basebalance bigint;k text;review_id uuid:=gen_random_uuid();token uuid;st integer;
begin
 assert current_database()='context_reader_study_ui_1010','isolated restore required';
 insert into auth.users(id) values(u),(v);
 insert into account_profiles(user_id,nickname,status) values(u,'study-ui-isolated','active'),(v,'study-ui-other','active') on conflict(user_id) do update set status='active';
 insert into user_entitlements(user_id,plan_id,source) values(u,'free','signup'),(v,'free','signup') on conflict(user_id) do update set plan_id='free';
 update study_policy set policy=policy||'{"rewardsEnabled":true,"pointsPerNew":1,"dailyRewardCap":50,"streakMinNew":5,"rewardDays":90}' where id;
 m:=jsonb_build_object('state',0,'due',now(),'stability',0,'difficulty',0,'elapsed_days',0,'scheduled_days',0,'reps',0,'lapses',0,'learning_steps',0);
 done:=m||jsonb_build_object('state',2,'last_review',now(),'due',now()+interval '3 days','reps',2,'stability',3);
 insert into study_cards(user_id,id,entry_id,mode,memory,reward_key)
 select u,lpad(i::text,40,'a'),'new-'||i,'basic_en_to_cn',m,'word-'||i from generate_series(1,60) i;
 insert into study_cards(user_id,id,entry_id,mode,memory,reward_key) values(u,repeat('b',40),'old','basic_en_to_cn',m||'{"state":2}','old');
 perform study_start_flexible(u,(select jsonb_agg(id) from study_cards where user_id=u),'{"reviewsPerDay":100,"includeAnki":false}');
 r:=study_present(u,lpad('1',40,'a'),0);assert r->>'reviewsFirst'='true','old reviews block new cards';
 update study_cards set memory=done where user_id=u and id in(lpad('1',40,'a'),lpad('2',40,'a'));
 r:=study_settle_rewards(u);assert r->>'complete'='false','unfinished old reviews block settlement';
 assert not exists(select 1 from study_claims where user_id=u),'no premature claim';
 update study_cards set memory=done where user_id=u and entry_id='old';
 basebalance:=(billing_balance(u)->>'allowance')::bigint;
 r:=study_settle_rewards(u);assert (r->>'newWords')::int=2,'completed new words settle without all 60 new words';
 assert (select points from study_claims where user_id=u and id='daily:'||d)=2,'pending daily reward';
 assert (billing_balance(u)->>'allowance')::bigint=basebalance,'earning does not credit allowance';
 r:=study_claim_reward(v,'daily:'||d);assert r->>'missing'='true','other account cannot claim';
 r:=study_claim_reward(u,'daily:'||d);assert (r->>'points')::int=2,'explicit claim credits two';
 assert (billing_balance(u)->>'allowance')::bigint=basebalance+2,'real allowance credited';
 r:=study_claim_reward(u,'daily:'||d);assert r->>'duplicate'='true','claim replay cannot double credit';
 assert (billing_balance(u)->>'allowance')::bigint=basebalance+2,'duplicate leaves balance unchanged';
 update study_cards set memory=done where user_id=u and entry_id in('new-3','new-4','new-5');
 insert into study_streaks(user_id,current,best,last_day) values(u,1,1,d-1) on conflict(user_id) do update set current=1,best=1,last_day=d-1;
 r:=study_settle_rewards(u);assert (r->>'streak')::int=2,'five completed new words qualify with unlimited new words left';
 assert (select points-claimed_points from study_claims where user_id=u and id='daily:'||d)=3,'later learning accumulates claimable difference';
 assert (select points from study_claims where user_id=u and milestone=2)=50,'day two milestone waits for claim';
 perform study_claim_reward(u,'daily:'||d);perform study_claim_reward(u,'milestone:2');
 assert (billing_balance(u)->>'allowance')::bigint=basebalance+55,'combined claimed balance correct';
 update study_cards set memory=done where user_id=u and entry_id like 'new-%';
 perform study_settle_rewards(u);perform study_claim_reward(u,'daily:'||d);
 assert (select points from study_claims where user_id=u and id='daily:'||d)=50,'daily new word cap excludes milestone';
 assert (select current from study_streaks where user_id=u)=2,'more words cannot count a second day';
 assert (billing_balance(u)->>'allowance')::bigint=basebalance+100,'daily cap 50 plus bonus 50';
 -- A newly saved word joins the same daily plan, without replacing its original review target.
 insert into study_cards(user_id,id,entry_id,mode,memory,reward_key) values(u,repeat('c',40),'new-extra','basic_en_to_cn',m,'extra');
 perform study_start_flexible(u,to_jsonb(array[repeat('c',40)]),'{"includeAnki":false}');
 assert (select jsonb_array_length(card_ids) from study_days where user_id=u and day=d)=62,'new vocabulary appended';
 assert (select new_ids ? repeat('c',40) from study_days where user_id=u and day=d),'appended word remains new';
 r:=study_present(u,repeat('c',40),0);token:=(r->>'token')::uuid;
 update study_cards set shown_at=now()-interval '2 seconds' where user_id=u and id=repeat('c',40);
 r:=study_review(u,review_id,repeat('c',40),0,token,'forgot',1,1000,m||'{"state":1}','FSRS-6','{}');assert r->>'saved'='true','new answer saves after streak qualification';
 r:=study_undo_flexible(u,review_id);assert r->>'saved'='true','later unearned answer can undo even after earlier reward';
 assert (select memory from study_cards where user_id=u and id=repeat('c',40))=m,'undo exact restoration';
 -- Every approved milestone is earned once; membership claim and activation are separate.
 for st in select unnest(array[3,7,21,30,60,180,365]) loop
  update study_streaks set current=st-1,last_day=d-1 where user_id=u;
  perform study_settle_rewards(u);
  assert exists(select 1 from study_claims where user_id=u and milestone=st),'milestone persisted';
 end loop;
 assert (select count(*) from study_rewards where user_id=u)=8,'all eight milestones';
 perform study_claim_reward(u,'milestone:30');
 assert (select activated_at is null from study_rewards where user_id=u and milestone=30),'claim does not start membership clock';
 r:=study_activate_membership(u,30);assert r->>'activated'='true','claimed membership activates separately';
 assert not has_table_privilege('authenticated','study_claims','insert'),'no browser claim forging';
 assert not has_function_privilege('authenticated','study_claim_reward(uuid,text)','execute'),'claim requires server authorization';
 perform study_pause(u,jsonb_build_object('pausedUntil',now()+interval '3 days'));
 assert (select current from study_streaks where user_id=u)=0,'pause resets streak';
 assert (select count(*) from study_claims where user_id=u)=9,'pause retains pending and claimed rewards';
 raise notice 'PASS flexible learning, review-first, partial settlement, explicit claims, replay, account isolation, daily cap, milestones, undo, pause, membership';
end $$;
rollback;
