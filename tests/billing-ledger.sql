-- Isolated database only. All synthetic data is rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b jsonb; q jsonb; o jsonb; id uuid; expected bigint; x uuid;
begin
 insert into auth.users(id) values(u);
 insert into account_profiles(user_id,nickname,status) values(u,'billing-test','active') on conflict(user_id) do update set status='active';
 insert into user_entitlements(user_id,plan_id,source) values(u,'free','signup') on conflict(user_id) do update set plan_id='free';
 b:=billing_balance(u); assert (b->>'allowance')::bigint=300,'free allowance';
 b:=billing_consume(a,u,'standalone_dictionary',5); assert (b->>'used')::bigint=5,'consume';
 b:=billing_consume(a,u,'standalone_dictionary',5); assert (b->>'used')::bigint=5 and (b->>'duplicate')::boolean,'idempotency';
 perform billing_finish(a,'failed',false,true); perform billing_finish(a,'failed',false,true);
 b:=billing_balance(u); assert (b->>'used')::bigint=0,'refund once';
 a:=gen_random_uuid(); perform billing_consume(a,u,'article_summary',2);perform billing_finish(a,'cached',true,false);
 b:=billing_balance(u);assert (b->>'used')::bigint=2,'public summary charged';
 q:=billing_quote(u,'basic','month','membership');assert (q->>'amountFen')::int=600,'initial price';
 o:=billing_create_order(u,'basic','month','membership',600);id:=(o->>'id')::uuid;
 o:=billing_settle(id,'test-tx-'||id,600); assert o->>'status'='paid','settle';
 perform billing_settle(id,'test-tx-'||id,600);
 b:=billing_balance(u);assert (b->>'allowance')::bigint=5000,'basic grant once';
 q:=billing_quote(u,'plus','month','membership');assert (q->>'creditFen')::int=600,'immediate full remaining credit';
 a:=gen_random_uuid();perform billing_consume(a,u,'lookup',5000);perform billing_finish(a,'succeeded');
 q:=billing_quote(u,'plus','month','membership');assert (q->>'creditFen')::int=0,'depleted has no credit';
 o:=billing_create_order(u,'basic','month','membership',600);id:=(o->>'id')::uuid;
 perform billing_settle(id,'test-tx-'||id,600);b:=billing_balance(u);assert (b->>'remaining')::bigint=5000,'repurchase resets';
 q:=billing_quote(u,'plus','year','membership');o:=billing_create_order(u,'plus','year','membership',(q->>'amountFen')::int);id:=(o->>'id')::uuid;
 perform billing_settle(id,'test-tx-'||id,(q->>'amountFen')::int);
 b:=billing_balance(u); assert (b->>'allowance')::bigint=15000,'annual only monthly points';
 o:=billing_create_order(u,'plus','month','topup',1500);id:=(o->>'id')::uuid;perform billing_settle(id,'test-tx-'||id,1500);
 b:=billing_balance(u);assert (b->>'allowance')::bigint=30000,'annual topup';
 a:=gen_random_uuid();perform billing_consume(a,u,'full_article_translation',40);
 perform billing_translation_start(a,'[{"id":"a","hash":"x","words":400},{"id":"b","hash":"y","words":1400}]');
 perform billing_translation_claim(a,'[{"id":"a","hash":"x"}]');
 perform billing_translation_finish(a);
 assert (select status from usage_actions where usage_actions.id=a)='reserved','running finish waits';
 perform billing_translation_result(a,'["a"]',true);
 assert (select quota_units from usage_actions where usage_actions.id=a)=10,'partial refund based on completed words';
 assert (select status from usage_actions where usage_actions.id=a)='succeeded','partial finalized';
 perform billing_translation_finish(a);
 b:=billing_balance(u);assert (b->>'used')::bigint=10,'no repeated refund';
 -- Changed user consumption invalidates a discounted checkout, preserving money for refund.
 q:=billing_quote(u,'max','year','membership');o:=billing_create_order(u,'max','year','membership',(q->>'amountFen')::int);id:=(o->>'id')::uuid;
 x:=gen_random_uuid();perform billing_consume(x,u,'lookup',20000);
 o:=billing_settle(id,'test-tx-'||id,(q->>'amountFen')::int);assert o->>'status'='review','stale discounted payment reviewed';
 assert (select plan_id from user_entitlements where user_id=u)='plus','stale payment never grants';
 -- Configuration changes preserve already issued points.
 perform billing_update_plan('plus',1500,15000,16000,true);
 b:=billing_balance(u);assert (b->>'allowance')::bigint=30000,'issued snapshot retained';
 assert billing_month('2026-01-31 02:00Z',1)='2026-02-28 02:00Z'::timestamptz,'month clamp';
 assert billing_month('2026-01-31 02:00Z',2)='2026-03-31 02:00Z'::timestamptz,'anchor retained';
 assert not has_function_privilege('anon','billing_settle(uuid,text,integer)','execute'),'anon cannot settle';
 assert not has_table_privilege('authenticated','billing_orders','select'),'orders private';
 raise notice 'PASS: billing ledger, purchase, refund, annual, partial translation, stale quote, permissions';
end $$;
rollback;
