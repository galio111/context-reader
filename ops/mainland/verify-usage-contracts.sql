\set ON_ERROR_STOP on

begin;

do $$
declare
  v_user_id uuid;
  v_plan_id text;
  v_metric record;
  v_action_id uuid;
  v_result record;
begin
  select ue.user_id, ue.plan_id
    into v_user_id, v_plan_id
  from public.user_entitlements ue
  join public.account_profiles ap on ap.user_id = ue.user_id
  where ap.status = 'active'
  order by ap.created_at
  limit 1;

  if v_user_id is null or v_plan_id is null then
    raise exception 'usage contract verification requires one active account';
  end if;

  for v_metric in
    select qpl.metric_key
    from public.quota_plan_limits qpl
    where qpl.plan_id = v_plan_id
    order by qpl.metric_key
  loop
    v_action_id := gen_random_uuid();
    select * into v_result
    from public.consume_usage(
      v_action_id,
      'user:' || v_user_id::text,
      v_user_id,
      null,
      v_plan_id,
      'usage_contract_verification',
      v_metric.metric_key,
      1
    );

    if v_result.allowed is null then
      raise exception 'consume_usage returned no row for metric %', v_metric.metric_key;
    end if;

    perform *
    from public.consume_usage(
      v_action_id,
      'user:' || v_user_id::text,
      v_user_id,
      null,
      v_plan_id,
      'usage_contract_verification',
      v_metric.metric_key,
      1
    );
  end loop;
end;
$$;

rollback;

select 'usage contracts passed' as result;
