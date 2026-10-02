-- Additive migration. Legacy guest/Admin counters remain valid for rollback.
begin;
create table if not exists public.billing_plans (
  id text primary key references public.quota_plans(id),
  monthly_fen integer not null check(monthly_fen >= 0),
  annual_fen integer not null check(annual_fen >= 0),
  updated_at timestamptz not null default now()
);
insert into public.billing_plans(id,monthly_fen,annual_fen) values
 ('free',0,0),('basic',600,6000),('plus',1500,15000),('max',3000,30000)
on conflict do nothing;
insert into public.quota_plan_limits(plan_id,metric_key,allowance,window_type) values
 ('free','learning_points',300,'month'),('basic','learning_points',5000,'month'),
 ('plus','learning_points',15000,'month'),('max','learning_points',30000,'month')
on conflict do nothing;
update public.quota_plans qp set price_cny=ceil(bp.monthly_fen/100.0) from public.billing_plans bp where qp.id=bp.id;

create table if not exists public.billing_memberships (
 user_id uuid primary key references auth.users(id), plan_id text not null references public.billing_plans(id),
 term text not null check(term in ('month','year')), starts_at timestamptz not null, ends_at timestamptz not null,
 paid_fen integer not null check(paid_fen>=0), order_id uuid not null, version integer not null default 1
);
create table if not exists public.billing_grants (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 plan_id text not null, starts_at timestamptz not null, ends_at timestamptz not null,
 points bigint not null check(points>=0), used bigint not null default 0 check(used>=0),
 kind text not null check(kind in ('period','topup')), grant_key text not null unique,
 closed boolean not null default false, created_at timestamptz not null default now()
);
create index if not exists billing_grants_user on public.billing_grants(user_id,ends_at);
create table if not exists public.billing_allocations (
 action_id uuid not null references public.usage_actions(id), grant_id uuid not null references public.billing_grants(id),
 points bigint not null check(points>0), refunded boolean not null default false, primary key(action_id,grant_id)
);
create table if not exists public.billing_orders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 plan_id text not null references public.billing_plans(id), term text not null check(term in ('month','year')),
 kind text not null check(kind in ('membership','topup')),
 status text not null default 'pending' check(status in ('pending','paid','closed','review','refunding','refunded')),
 price_fen integer not null, credit_fen integer not null, amount_fen integer not null check(amount_fen>0),
 points bigint not null, basis jsonb not null default '{}', transaction_id text unique,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '15 minutes',
 paid_at timestamptz, fulfilled_at timestamptz, provider jsonb not null default '{}', review_reason text,
 refund_id text unique, refunded_at timestamptz
);
create index if not exists billing_orders_user on public.billing_orders(user_id,created_at desc);

create or replace function public.billing_month(t timestamptz,n integer) returns timestamptz
language sql immutable as $$ select ((t at time zone 'Asia/Shanghai') + make_interval(months=>n)) at time zone 'Asia/Shanghai' $$;

-- Called only under the per-user advisory lock. Returns the current regular grant.
create or replace function public.billing_ensure(p_user uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare e user_entitlements%rowtype; m billing_memberships%rowtype; a timestamptz;
 b timestamptz; z timestamptz; n integer:=0; p text; q bigint; g uuid; k text;
begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user,0));
 select * into e from user_entitlements where user_id=p_user;
 p:=case when e.plan_id is not null and (e.ends_at is null or e.ends_at>now()) then e.plan_id else 'free' end;
 if p='admin' then return null; end if;
 select * into m from billing_memberships where user_id=p_user and ends_at>now() and plan_id=p and starts_at=e.starts_at;
 a:=coalesce(m.starts_at,case when p<>'free' then e.starts_at else null end,
   date_trunc('month',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');
 while billing_month(a,n+1)<=now() loop n:=n+1; end loop;
 b:=billing_month(a,n); z:=billing_month(a,n+1);
 if p<>'free' and e.ends_at is not null then z:=least(z,e.ends_at); end if;
 select allowance into q from quota_plan_limits where plan_id=p and metric_key='learning_points';
 q:=coalesce(q,0)+greatest(0,coalesce((e.bonus_limits->>'learning_points')::bigint,0));
 k:=p_user||':'||p||':'||a||':'||n||':'||coalesce(m.order_id::text,'manual');
 insert into billing_grants(user_id,plan_id,starts_at,ends_at,points,kind,grant_key)
 values(p_user,p,b,z,q,'period',k) on conflict(grant_key) do update set closed=false
 returning id into g;
 -- An administrator or invitation can replace the plan without a payment.
 update billing_grants set closed=true where user_id=p_user and kind='period' and id<>g and not closed;
 return g;
end $$;

create or replace function public.billing_balance(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare g uuid; result jsonb;
begin
 g:=billing_ensure(p_user);
 select jsonb_build_object('metricKey','learning_points','used',coalesce(sum(used),0),
 'allowance',coalesce(sum(greatest(points,used)),0),'remaining',coalesce(sum(greatest(0,points-used)),0),
 'windowEnd',min(ends_at),'periodGrant',g)
 into result from billing_grants where user_id=p_user and not closed and starts_at<=now() and ends_at>now();
 return result;
end $$;

create or replace function public.billing_consume(p_action uuid,p_user uuid,p_feature text,p_units bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare bal jsonb; a usage_actions%rowtype; g billing_grants%rowtype; need bigint:=p_units; take bigint; p text;
begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user,0));
 if not exists(select 1 from account_profiles where user_id=p_user and status='active') then raise exception 'account unavailable'; end if;
 if p_units<1 or p_units>1000000 then raise exception 'invalid units'; end if;
 bal:=billing_balance(p_user);
 select * into a from usage_actions where id=p_action;
 if found then
   return bal||jsonb_build_object('allowed',a.user_id=p_user and a.feature=p_feature and a.metric_key='learning_points' and a.status in ('reserved','succeeded','cached'),'duplicate',true);
 end if;
 if (bal->>'remaining')::bigint<p_units then return bal||'{"allowed":false,"duplicate":false}'::jsonb; end if;
 select plan_id into p from billing_grants where id=(bal->>'periodGrant')::uuid;
 insert into usage_actions(id,owner_key,user_id,plan_id,feature,metric_key,quota_units)
 values(p_action,'user:'||p_user,p_user,p,p_feature,'learning_points',p_units);
 for g in select * from billing_grants where user_id=p_user and not closed and starts_at<=now() and ends_at>now() and used<points order by ends_at,created_at for update loop
   take:=least(need,g.points-g.used);
   update billing_grants set used=used+take where id=g.id;
   insert into billing_allocations(action_id,grant_id,points) values(p_action,g.id,take);
   need:=need-take; exit when need=0;
 end loop;
 return billing_balance(p_user)||'{"allowed":true,"duplicate":false}'::jsonb;
end $$;

create or replace function public.billing_finish(p_action uuid,p_status text,p_cache boolean default false,p_refund boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare a usage_actions%rowtype; x billing_allocations%rowtype;
begin
 select * into a from usage_actions where id=p_action;
 if a.metric_key is distinct from 'learning_points' then raise exception 'not a points action'; end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||a.user_id,0));
 select * into a from usage_actions where id=p_action for update;
 if a.status<>'reserved' then return; end if;
 if p_status not in ('succeeded','cached','failed','cancelled') then raise exception 'invalid status'; end if;
 if p_refund then
   for x in select * from billing_allocations where action_id=p_action and not refunded loop
    update billing_grants set used=greatest(0,used-x.points) where id=x.grant_id;
   end loop;
   update billing_allocations set refunded=true where action_id=p_action;
 end if;
 update usage_actions set status=p_status,cache_hit=p_cache,quota_units=case when p_refund then 0 else quota_units end,completed_at=now() where id=p_action;
end $$;

create or replace function public.billing_quote(p_user uuid,p_plan text,p_term text,p_kind text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare g uuid; gr billing_grants%rowtype; m billing_memberships%rowtype;
 price integer; credit integer:=0; future integer:=0; months integer; ratio numeric; n integer:=0; pts bigint; bas jsonb:='{}';
begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user,0));
 if p_plan not in ('basic','plus','max') or p_term not in ('month','year') or p_kind not in ('membership','topup') then raise exception 'invalid purchase'; end if;
 if not exists(select 1 from account_profiles where user_id=p_user and status='active') or exists(select 1 from user_entitlements where user_id=p_user and plan_id='admin' and (ends_at is null or ends_at>now())) then raise exception 'purchase unavailable'; end if;
 g:=billing_ensure(p_user);
 select * into gr from billing_grants where id=g;
 select bm.* into m from billing_memberships bm join user_entitlements ue on ue.user_id=bm.user_id and ue.plan_id=bm.plan_id and ue.starts_at=bm.starts_at where bm.user_id=p_user and bm.ends_at>now();
 select case when p_term='year' then bp.annual_fen else bp.monthly_fen end,q.allowance into price,pts
 from billing_plans bp join quota_plans qp on qp.id=bp.id and qp.active join quota_plan_limits q on q.plan_id=bp.id and q.metric_key='learning_points' where bp.id=p_plan;
 if price is null or price<1 then raise exception 'plan unavailable'; end if;
 if p_kind='topup' then
   if m.user_id is null or m.term<>'year' or m.plan_id<>p_plan or p_term<>'month' then raise exception 'topup requires same annual plan'; end if;
 else
   if m.user_id is not null then
    if array_position(array['basic','plus','max'],p_plan)<array_position(array['basic','plus','max'],m.plan_id) then raise exception 'downgrade available after expiry'; end if;
    if m.term='year' and p_term='month' then raise exception 'annual to monthly available after expiry'; end if;
    months:=case when m.term='year' then 12 else 1 end;
    while billing_month(m.starts_at,n+1)<=now() loop n:=n+1; end loop;
    future:=greatest(0,months-n-1);
    ratio:=greatest(0,least(1,extract(epoch from(gr.ends_at-now()))/nullif(extract(epoch from(gr.ends_at-gr.starts_at)),0),(gr.points-gr.used)::numeric/nullif(gr.points,0)));
    credit:=floor(m.paid_fen::numeric/months*(future+coalesce(ratio,0)));
   end if;
 end if;
 bas:=jsonb_build_object('membershipOrder',m.order_id,'version',m.version,'grant',g,'used',gr.used,'points',gr.points);
 if credit>=price then raise exception 'remaining value exceeds new price'; end if;
 credit:=greatest(credit,0);
 return jsonb_build_object('planId',p_plan,'term',p_term,'kind',p_kind,'priceFen',price,'creditFen',credit,'amountFen',price-credit,'points',pts,'basis',bas);
end $$;

create or replace function public.billing_create_order(p_user uuid,p_plan text,p_term text,p_kind text,p_amount integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare q jsonb; o billing_orders%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user,0));
 q:=billing_quote(p_user,p_plan,p_term,p_kind);
 if (q->>'amountFen')::integer<>p_amount then raise exception 'quote changed'; end if;
 select * into o from billing_orders where user_id=p_user and status='pending' and expires_at>now() and plan_id=p_plan and term=p_term and kind=p_kind and amount_fen=p_amount and basis=q->'basis' order by created_at desc limit 1;
 if found then return to_jsonb(o); end if;
 if (select count(*) from billing_orders where user_id=p_user and created_at>now()-interval '1 hour')>=12 then raise exception 'too many orders'; end if;
 insert into billing_orders(user_id,plan_id,term,kind,price_fen,credit_fen,amount_fen,points,basis)
 values(p_user,p_plan,p_term,p_kind,(q->>'priceFen')::integer,(q->>'creditFen')::integer,p_amount,(q->>'points')::bigint,q->'basis') returning * into o;
 return to_jsonb(o);
end $$;

create or replace function public.billing_settle(p_order uuid,p_transaction text,p_amount integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare o billing_orders%rowtype; q jsonb; t timestamptz:=now(); z timestamptz; grantid uuid;
begin
 select * into o from billing_orders where id=p_order;
 if not found then raise exception 'unknown order'; end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||o.user_id,0));
 select * into o from billing_orders where id=p_order for update;
 if o.amount_fen<>p_amount then raise exception 'amount mismatch'; end if;
 if o.status in ('paid','review','refunding','refunded') then
   if o.transaction_id<>p_transaction then raise exception 'transaction mismatch'; end if;
   return to_jsonb(o);
 end if;
 begin q:=billing_quote(o.user_id,o.plan_id,o.term,o.kind); exception when others then q:='{}'; end;
 -- A payment is recorded even when its entitlement basis became stale. Never double-grant.
 if o.status<>'pending' or o.expires_at<now() or q='{}'::jsonb or
    (o.basis->>'membershipOrder') is distinct from (q->'basis'->>'membershipOrder') or
    (o.basis->>'grant') is distinct from (q->'basis'->>'grant') or
    (o.credit_fen>0 and o.basis is distinct from q->'basis') then
   update billing_orders set status='review',transaction_id=p_transaction,paid_at=t,review_reason='付款期间套餐或抵扣依据已变化，请原路退款后重新购买' where id=o.id returning * into o;
   return to_jsonb(o);
 end if;
 z:=billing_month(t,case when o.term='year' then 12 else 1 end);
 if o.kind='membership' then
   update billing_grants set closed=true where user_id=o.user_id and kind='period' and not closed;
   insert into billing_memberships(user_id,plan_id,term,starts_at,ends_at,paid_fen,order_id)
   values(o.user_id,o.plan_id,o.term,t,z,o.amount_fen+o.credit_fen,o.id)
   on conflict(user_id) do update set plan_id=excluded.plan_id,term=excluded.term,starts_at=t,ends_at=z,paid_fen=excluded.paid_fen,order_id=o.id,version=billing_memberships.version+1;
   insert into user_entitlements(user_id,plan_id,source,starts_at,ends_at)
   values(o.user_id,o.plan_id,'payment',t,z) on conflict(user_id) do update set plan_id=excluded.plan_id,source='payment',starts_at=t,ends_at=z;
   grantid:=billing_ensure(o.user_id);
   -- Paid quote's allowance is honored for the first period even if Admin edited it while payment was pending.
   update billing_grants set points=o.points where id=grantid;
 else
   insert into billing_grants(user_id,plan_id,starts_at,ends_at,points,kind,grant_key)
   values(o.user_id,o.plan_id,t,billing_month(t,1),o.points,'topup','order:'||o.id);
 end if;
 update billing_orders set status='paid',transaction_id=p_transaction,paid_at=t,fulfilled_at=t where id=o.id returning * into o;
 return to_jsonb(o);
end $$;

create or replace function public.billing_update_plan(p_plan text,p_month integer,p_year integer,p_points bigint,p_active boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_plan not in ('free','basic','plus','max') or p_points<0 or p_points>10000000 or p_month<0 or p_year<0 or p_month>1000000 or p_year>12000000 then raise exception 'invalid plan'; end if;
 if p_plan<>'free' and (p_month<1 or p_year<1) then raise exception 'paid plan requires positive price'; end if;
 if p_plan='free' and (p_month<>0 or p_year<>0 or not p_active) then raise exception 'free plan must remain free and active'; end if;
 update billing_plans set monthly_fen=p_month,annual_fen=p_year,updated_at=now() where id=p_plan;
 update quota_plans set price_cny=ceil(p_month/100.0),active=p_active where id=p_plan;
 update quota_plan_limits set allowance=p_points,updated_at=now() where plan_id=p_plan and metric_key='learning_points';
end $$;

create table if not exists billing_translation_blocks (
 action_id uuid not null references usage_actions(id), block_id text not null, hash text not null,
 words integer not null, attempts integer not null default 0, state text not null default 'ready',
 claimed_at timestamptz, primary key(action_id,block_id)
);
alter table billing_translation_blocks enable row level security;
revoke all on billing_translation_blocks from public,anon,authenticated;
grant all on billing_translation_blocks to service_role;
create or replace function billing_translation_start(p_action uuid,p_blocks jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare a usage_actions%rowtype; x jsonb;
begin
 select * into a from usage_actions where id=p_action for update;
 if a.metric_key<>'learning_points' or a.status<>'reserved' then raise exception 'invalid action'; end if;
 if exists(select 1 from billing_translation_blocks where action_id=p_action) then return; end if;
 for x in select * from jsonb_array_elements(p_blocks) loop
 insert into billing_translation_blocks(action_id,block_id,hash,words) values(p_action,x->>'id',x->>'hash',(x->>'words')::integer);
 end loop;
end $$;
create or replace function billing_translation_claim(p_action uuid,p_blocks jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare a usage_actions%rowtype; x jsonb; b billing_translation_blocks%rowtype;
begin
 select * into a from usage_actions where id=p_action for update;
 if a.status<>'reserved' or coalesce((a.metadata->>'finishRequested')::boolean,false) then raise exception 'translation closed'; end if;
 for x in select * from jsonb_array_elements(p_blocks) loop
 select * into b from billing_translation_blocks where action_id=p_action and block_id=x->>'id' for update;
 if not found or b.hash<>x->>'hash' or b.state in ('running','succeeded') or b.attempts>=3 then raise exception 'translation block unavailable'; end if;
 update billing_translation_blocks set state='running',claimed_at=now(),attempts=attempts+1 where action_id=p_action and block_id=b.block_id;
 end loop;
end $$;
create or replace function billing_translation_finish(p_action uuid) returns void
language plpgsql security definer set search_path=public as $$
declare a usage_actions%rowtype; words bigint; cost bigint; refund bigint; x billing_allocations%rowtype; take bigint;
begin
 select * into a from usage_actions where id=p_action;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||a.user_id,0));
 select * into a from usage_actions where id=p_action for update;
 if a.metric_key<>'learning_points' or a.status<>'reserved' then return; end if;
 update usage_actions set metadata=metadata||'{"finishRequested":true}'::jsonb where id=p_action;
 if exists(select 1 from billing_translation_blocks where action_id=p_action and state='running' and claimed_at>now()-interval '4 minutes') then return; end if;
 select coalesce(sum(b.words),0) into words from billing_translation_blocks b where b.action_id=p_action and b.state='succeeded';
 cost:=least(a.quota_units,case when words>0 then greatest(10,ceil(words/500.0)*10) else 0 end);
 refund:=a.quota_units-cost;
 for x in select * from billing_allocations where action_id=p_action and not refunded order by grant_id loop
 take:=least(refund,x.points);
 update billing_grants set used=greatest(0,used-take) where id=x.grant_id;
 if take=x.points then update billing_allocations set refunded=true where action_id=p_action and grant_id=x.grant_id;
 else update billing_allocations set points=points-take where action_id=p_action and grant_id=x.grant_id; end if;
 refund:=refund-take; exit when refund=0;
 end loop;
 update usage_actions set status=case when cost>0 then 'succeeded' else 'cancelled' end,quota_units=cost,completed_at=now() where id=p_action;
end $$;
create or replace function billing_translation_result(p_action uuid,p_ids jsonb,p_success boolean) returns void
language plpgsql security definer set search_path=public as $$
declare a usage_actions%rowtype;
begin
 select * into a from usage_actions where id=p_action;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||a.user_id,0));
 select * into a from usage_actions where id=p_action for update;
 if a.status<>'reserved' then return; end if;
 update billing_translation_blocks set state=case when p_success then 'succeeded' else 'failed' end
 where action_id=p_action and block_id in(select jsonb_array_elements_text(p_ids)) and state='running';
 if coalesce((a.metadata->>'finishRequested')::boolean,false) then perform billing_translation_finish(p_action); end if;
end $$;
create or replace function billing_reset_usage(p_user uuid) returns void
language plpgsql security definer set search_path=public as $$
declare g uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user,0));
 g:=billing_ensure(p_user);
 -- Close the old allocation cycle so delayed refunds cannot restore spent points twice.
 update billing_allocations ba set refunded=true from billing_grants bg where ba.grant_id=bg.id and bg.user_id=p_user and not bg.closed and bg.ends_at>now();
 update billing_grants set used=0 where user_id=p_user and not closed and ends_at>now();
end $$;

create or replace function billing_recover(p_user uuid) returns void
language plpgsql security definer set search_path=public as $$
declare a usage_actions%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user,0));
 for a in select ua.* from usage_actions ua where ua.user_id=p_user and ua.metric_key='learning_points' and ua.status='reserved' and ua.created_at<now()-interval '5 minutes' loop
  if a.feature='full_article_translation' and exists(select 1 from billing_translation_blocks where action_id=a.id) then
   if not exists(select 1 from billing_translation_blocks where action_id=a.id and claimed_at>now()-interval '4 minutes') then perform billing_translation_finish(a.id); end if;
  elsif exists(select 1 from usage_executions where action_id=a.id and status='succeeded') then perform billing_finish(a.id,'succeeded',false,false);
  else perform billing_finish(a.id,'failed',false,true);
  end if;
 end loop;
end $$;

-- Service-role only. No new browser table or RPC access.
alter table billing_plans enable row level security;
alter table billing_memberships enable row level security;
alter table billing_grants enable row level security;
alter table billing_allocations enable row level security;
alter table billing_orders enable row level security;
revoke all on billing_plans,billing_memberships,billing_grants,billing_allocations,billing_orders from public,anon,authenticated;
grant all on billing_plans,billing_memberships,billing_grants,billing_allocations,billing_orders to service_role;
do $$ declare f record; begin
 for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname like 'billing_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
