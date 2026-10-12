-- Run against an isolated restored database. All fixture changes are rolled back.
begin;
do $test$
declare u uuid:=gen_random_uuid(); old_user uuid:=gen_random_uuid(); admin_user uuid:=gen_random_uuid();
 event uuid:=gen_random_uuid(); result jsonb; before_count integer; since_at timestamptz:=now()-interval '20 days';
begin
 update product_activity_meta set started_at=since_at where id;
 insert into auth.users(id,email,created_at) values(u,u||'@qa.invalid',now()-interval '10 days'),(old_user,old_user||'@qa.invalid',now()-interval '21 days'),(admin_user,admin_user||'@qa.invalid',now()-interval '10 days');
 insert into account_profiles(user_id,nickname,created_at) values(u,'isolated UX fixture',now()-interval '10 days'),(old_user,'isolated old fixture',now()-interval '21 days'),(admin_user,'isolated admin fixture',now()-interval '10 days') on conflict(user_id) do update set created_at=excluded.created_at;
 insert into user_entitlements(user_id,plan_id,source) values(admin_user,'admin','admin') on conflict(user_id) do update set plan_id='admin';
 insert into study_reading_days(user_id,day,last_tick,verified_seconds) values(u,(now() at time zone 'Asia/Shanghai')::date,now()-interval '60 seconds',600);
 perform study_reading_tick_v3(u,30,'["test"]','qa-article',event);
 perform study_reading_tick_v3(u,30,'["test"]','qa-article',event);
 result:=study_activity_summary(u);
 if (result->>'seconds')::integer<>30 or (result->>'todaySeconds')::integer<>30 or (result->>'readingDays')::integer<>1 then raise exception 'Idempotence or old history separation failed: %',result; end if;
 perform study_reading_tick_v3(u,30,'[]','qa-article',gen_random_uuid());
 if (study_activity_summary(u)->>'seconds')::integer<>30 then raise exception 'Wall clock cap failed'; end if;
 perform study_record_visit(u);perform study_record_visit(u);perform study_record_visit(admin_user);
 if (select count(*) from product_activity_days where user_id=u)<>1 then raise exception 'Daily visit idempotence failed'; end if;
 insert into product_activity_days(user_id,day) values(u,((now()-interval '10 days') at time zone 'Asia/Shanghai')::date+1),(u,((now()-interval '10 days') at time zone 'Asia/Shanghai')::date+7);
 -- Before and after payment; old account is deliberately an incomplete observation.
 insert into product_reading_ticks(user_id,id,recorded_at,seconds) values(u,gen_random_uuid(),now()-interval '2 hours',20),(u,gen_random_uuid(),now(),25);
 insert into billing_orders(user_id,plan_id,term,kind,status,price_fen,credit_fen,amount_fen,points,paid_at)
 values(u,'basic','month','membership','paid',100,0,100,1000,now()-interval '1 hour'),(old_user,'basic','month','membership','paid',100,0,100,1000,now()-interval '1 hour');
 result:=study_product_analytics(30);
 if (result->>'firstPayments')::integer<>2 or (result->>'completePayments')::integer<>1 or (result->>'medianSecondsBeforePayment')::integer<>20 then raise exception 'Payment timing/coverage failed: %',result; end if;
 if not exists(select 1 from jsonb_array_elements(result->'retention') r where (r->>'day')::integer=7 and (r->>'returned')::integer>=1) then raise exception 'Retention failed'; end if;
 if has_function_privilege('anon','study_activity_summary(uuid)','execute') or has_table_privilege('authenticated','product_reading_ticks','select') then raise exception 'Private ACL failed'; end if;
 raise notice 'PASS: retry idempotence, real wall clock cap, new-only reading history, visits, retention, payment ordering and incomplete coverage, private ACLs';
end $test$;
rollback;
