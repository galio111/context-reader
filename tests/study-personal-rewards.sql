-- Run on an isolated restore with the two November 22 migrations applied.
begin;
do $$
declare u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); d date:=(now() at time zone 'Asia/Shanghai')::date;
  at_time timestamptz:=d::timestamp at time zone 'Asia/Shanghai'; result jsonb; last_id uuid:=gen_random_uuid(); n integer;
  original text:='We read this sentence together.'; k text; v bigint; p jsonb;
begin
 assert current_database() like 'context_reader_study_%','isolated test database required';
 insert into auth.users(id) values(u),(other_user);
 update study_policy set review_checkin_since=d-400, policy=policy||'{"rewardsEnabled":true}' where id;
 k:='sentence-'||encode(sha256(convert_to(original,'UTF8')),'hex');
 p:=jsonb_build_object('word',original,'sourceSentence',original,'sentenceTranslation','我们一起读这句话。','id',k,'anki','{}'::jsonb,'createdAt',now());
 perform merge_user_data_objects(u,jsonb_build_array(jsonb_build_object('kind','vocabulary','objectKey',k,'payload',p,'clientUpdatedAt',now(),'serverVersion',0)));
 select server_version,payload into v,p from user_data_objects where user_id=u and object_key=k;
 assert p->>'entryKind'='sentence' and p->>'sentenceStudyEnabled'='true','stripped legacy record restored';
 perform merge_user_data_objects(u,jsonb_build_array(jsonb_build_object('kind','vocabulary','objectKey',k,'payload',p-'entryKind'-'sentenceStudyEnabled','clientUpdatedAt',now(),'serverVersion',v)));
 assert (select payload->>'entryKind'='sentence' from user_data_objects where user_id=u and object_key=k),'old client cannot strip kind again';
 update user_data_objects set payload=jsonb_build_object('id',k,'word',original) where user_id=u and object_key=k;
 assert (select payload->>'sourceSentence'=original and payload->>'sentenceTranslation'='我们一起读这句话。' from user_data_objects where user_id=u and object_key=k),'summary preserves saved content';
 update user_data_objects set payload='null',deleted_at=now() where user_id=u and object_key=k;
 assert exists(select 1 from user_data_objects where user_id=u and object_key=k and deleted_at is not null),'explicit removal remains removed';
 assert not has_function_privilege('authenticated','public.study_redeem_voucher(uuid,integer,integer,text)','execute');
 assert not has_table_privilege('anon','study_vouchers','select');
 insert into study_cards(user_id,id,entry_id,mode,memory) select u,i::text,'w'||i,'basic_cn_to_en','{"state":2}' from generate_series(1,40) i;
 insert into study_days(user_id,day,card_ids,settings,completed_at,streak,review_checkin)
 select u,d-i,'[]','{}',at_time-i*interval '1 day',365-i,true from generate_series(1,364) i;
 insert into study_days(user_id,day,card_ids,settings) select u,d,jsonb_agg(i::text),'{"reviewsPerDay":30,"reviewExtraCount":10}' from generate_series(1,40) i;
 insert into study_reviews(user_id,id,card_id,answer,rating,reviewed_at,active_ms,previous,next,algorithm,parameters,version)
 select u,gen_random_uuid(),i::text,'forgot',1,at_time+interval '1 second',1000,'{"state":2}','{"state":3}','test','{}',1 from generate_series(1,29) i;
 insert into study_reviews(user_id,id,card_id,answer,rating,reviewed_at,active_ms,previous,next,algorithm,parameters,version)
 values(u,gen_random_uuid(),'1','remembered',3,at_time+interval '2 seconds',1000,'{"state":3}','{"state":2}','test','{}',2),
       (u,gen_random_uuid(),'40','remembered',3,at_time+interval '3 seconds',1000,'{"state":0}','{"state":2}','test','{}',2);
 result:=study_settle_rewards(u); assert (result->>'reviewed')::int=29 and not (result->>'complete')::boolean,'new and repeated words cannot qualify';
 insert into study_reviews(user_id,id,card_id,answer,rating,reviewed_at,active_ms,previous,next,algorithm,parameters,version)
 values(u,last_id,'30','forgot',1,at_time+interval '5 seconds',1000,'{"state":2}','{"state":3}','test','{}',1);
 assert (select review_checkin and streak=365 from study_days where user_id=u and day=d),'review 30 of 40 qualifies including forgotten reviews';
 assert (select count(*)=9 from study_vouchers where user_id=u),'all eight milestones and two separate 180-day cups';
 assert not exists(select 1 from study_claims where user_id=u),'no daily points or membership';
 result:=study_redeem_voucher(other_user,180,1,null);assert result->>'missing'='true','account isolation';
 result:=study_redeem_voucher(u,180,1,null);assert result->>'redeemed'='true';
 result:=study_redeem_voucher(u,180,1,null);assert result->>'duplicate'='true','retry idempotency';
 assert (select redeemed_at is null from study_vouchers where user_id=u and milestone=180 and unit=2),'second cup can be redeemed later';
 assert study_redeem_voucher(u,365,1,null)->>'invalidChoice'='true';
 assert study_redeem_voucher(u,365,1,'shoes')->>'redeemed'='true';
 assert study_redeem_voucher(u,365,1,'clothes')->>'choice'='shoes','cannot change a redeemed choice';
 update study_reviews set undone=true where user_id=u and id=last_id;
 assert not (select review_checkin from study_days where user_id=u and day=d),'undone answer is not credited';
 assert (select count(*)=9 from study_vouchers where user_id=u),'earned coupons remain in the wallet';
 update study_reviews set undone=false where user_id=u and id=last_id;
 assert (select count(*)=9 from study_vouchers where user_id=u),'requalified day does not mint duplicates';
 -- A prior day's 30th answer can sync after the following day's records.
 delete from study_days where user_id=u and day=d-1;
 update study_reviews set undone=true where user_id=u and id=last_id;
 update study_reviews set undone=false where user_id=u and id=last_id;
 assert (select current=1 from study_streaks where user_id=u),'missed day restarts the run';
 insert into study_days(user_id,day,card_ids,settings) values(u,d-1,'[]','{}');
 insert into study_reviews(user_id,id,card_id,answer,rating,reviewed_at,active_ms,previous,next,algorithm,parameters,version)
 select u,gen_random_uuid(),i::text,'forgot',1,at_time-interval '1 second',1000,'{"state":2}','{"state":3}','test','{}',1 from generate_series(1,30) i;
 assert (select current=365 and last_day=d from study_streaks where user_id=u),'late offline reviews reconnect both consecutive runs';
end $$;
rollback;
