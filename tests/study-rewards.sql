-- Rollback-only integration checks against a restored database.
begin;
do $$
declare u uuid:=gen_random_uuid();d date:=(now() at time zone 'Asia/Shanghai')::date;
 r jsonb;m jsonb;c text;old_end timestamptz;old_start timestamptz;id integer;st integer;
begin
 assert current_database()='context_reader_study_1005','isolated database required';
 insert into auth.users(id) values(u);
 insert into account_profiles(user_id,nickname,status) values(u,'study-rewards-test','active') on conflict(user_id) do update set status='active';
 insert into user_entitlements(user_id,plan_id,source) values(u,'free','signup') on conflict(user_id) do update set plan_id='free';
 update study_policy set policy='{"rewardsEnabled":true,"pointsPerNew":1,"dailyRewardCap":50,"rewardDays":90,"streakMinNew":5,"profileEnabled":true,"profileCost":5,"minimumReadingMinutes":60,"minimumLookups":50,"milestones":[{"days":2,"points":50,"plan":null,"months":0},{"days":3,"points":100,"plan":null,"months":0},{"days":7,"points":500,"plan":null,"months":0},{"days":21,"points":1000,"plan":null,"months":0},{"days":30,"points":0,"plan":"basic","months":1},{"days":60,"points":0,"plan":"plus","months":2},{"days":180,"points":0,"plan":"plus","months":6},{"days":365,"points":0,"plan":"max","months":12}]}' where study_policy.id;
 m:=jsonb_build_object('state',0,'due',now());
 for id in 1..5 loop
  c:=lpad(id::text,40,'a');insert into study_cards(user_id,id,entry_id,mode,memory,reward_key) values(u,c,c,'basic_en_to_cn',m,'word-'||id);
 end loop;
 c:=repeat('b',40);insert into study_cards(user_id,id,entry_id,mode,memory,reward_key) values(u,c,c,'basic_en_to_cn',m||'{"state":2}','old');
 perform study_start(u,(select jsonb_agg(study_cards.id) from study_cards where user_id=u),'{}');
 r:=study_present(u,lpad('1',40,'a'),0);assert r->>'reviewsFirst'='true','new words blocked until all planned reviews finish';
 update study_cards set memory=memory||jsonb_build_object('state',2,'last_review',now(),'due',now()+interval '3 days') where user_id=u;
 insert into study_streaks(user_id,current,best,last_day) values(u,1,1,d-1);
 r:=study_complete(u);assert (r->>'newWords')::int=5 and (r->>'points')::int=55 and (r->>'streak')::int=2,'day 2 gives 5 new-word points plus 50';
 assert (billing_balance(u)->>'allowance')::int=355,'real point balance includes both grants';
 r:=study_complete(u);assert r->>'duplicate'='true','reload cannot repeat reward';
 -- Simulate a later qualifying date through the isolated fixture state; no clock changes.
 for st in select unnest(array[3,7,21,30,60,180,365]) loop
  delete from study_days where user_id=u;delete from study_reward_words where user_id=u;
  update study_cards set memory=m where user_id=u;
  perform study_start(u,(select jsonb_agg(study_cards.id) from study_cards where user_id=u and study_cards.id<>repeat('b',40)),'{}');
  update study_cards set memory=memory||jsonb_build_object('state',2,'last_review',now(),'due',now()+interval '3 days') where user_id=u;
  update study_streaks set current=st-1,last_day=d-1 where user_id=u;
  r:=study_complete(u);assert (r->>'streak')::int=st,'milestone streak recorded';
  assert exists(select 1 from study_rewards where user_id=u and milestone=st),'milestone reward recorded once';
 end loop;
 assert (select count(*) from study_rewards where user_id=u)=8,'all eight approved milestones';
 r:=study_activate_membership(u,30);assert r->>'activated'='true','basic voucher activates';
 select starts_at,ends_at into old_start,old_end from user_entitlements where user_id=u;
 assert (select plan_id from user_entitlements where user_id=u)='basic','membership changes actual entitlement';
 r:=study_activate_membership(u,30);assert r->>'duplicate'='true','activation retry cannot extend twice';
 assert (select ends_at from user_entitlements where user_id=u)=old_end,'exact membership expiry retained';
 r:=study_activate_membership(u,60);assert r->>'existingPlan'='true','different paid/reward tier preserved';
 assert (select activated_at is null from study_rewards where user_id=u and milestone=60),'blocked reward remains available';
 update user_entitlements set ends_at=now()-interval '1 day' where user_id=u;
 r:=study_activate_membership(u,60);assert r->>'activated'='true','plus activates after current plan expiry';
 select starts_at,ends_at into old_start,old_end from user_entitlements where user_id=u;
 r:=study_activate_membership(u,180);assert r->>'activated'='true','same-tier reward extends membership';
 assert (select ends_at from user_entitlements where user_id=u)=billing_month(old_end,6),'six additional months';
 assert (select starts_at from user_entitlements where user_id=u)=old_start,'same-tier extension preserves monthly allowance anchor';
 -- A different card id for a previously rewarded word cannot mint another new-word credit.
 delete from study_days where user_id=u;
 c:=repeat('c',40);insert into study_cards(user_id,id,entry_id,mode,memory,reward_key) values(u,c,c,'basic_en_to_cn',m,'word-1');
 perform study_start(u,to_jsonb(array[c]),'{}');
 update study_cards set memory=memory||jsonb_build_object('state',2,'last_review',now(),'due',now()+interval '3 days') where user_id=u;
 r:=study_complete(u);assert (r->>'newWords')::int=0 and (r->>'points')::int=0,'delete/re-add cannot farm rewards';
 assert not has_function_privilege('authenticated','study_activate_membership(uuid,integer)','execute'),'client cannot mint membership';
 perform study_pause(u,jsonb_build_object('pausedUntil',now()+interval '3 days'));
 assert (select current from study_streaks where user_id=u)=0,'pause immediately resets consecutive days';
 assert (select count(*) from study_rewards where user_id=u)=8,'pause retains every earned milestone';
 raise notice 'PASS rewards: new-only, strict review-first, all milestones, idempotency, durable vouchers, no tier overwrite, same-tier extension, monthly allowance, duplicate words';
end $$;
rollback;
