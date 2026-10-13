begin;

-- One settings row and one row lock serialize saves and releases across app instances.
-- The application strictly validates registered targets and presentation fields first.
-- No browser role receives settings access or permission to call this RPC.
create or replace function public.mutate_ui_design_v1(
  p_expected_revision bigint,
  p_action text,
  p_recipe jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
  v_before jsonb;
  v_recipe jsonb;
  v_current jsonb;
  v_revision bigint;
  v_now timestamptz := clock_timestamp();
  v_status text;
begin
  if p_expected_revision is null or p_expected_revision < 0 or p_expected_revision > 9007199254740990
    or p_action is null or p_action not in ('save', 'publish', 'rollback') then
    raise exception 'ui_design_invalid';
  end if;
  if p_action = 'save' then
    if p_recipe is null or jsonb_typeof(p_recipe) <> 'object' or p_recipe->'version' is distinct from '1'::jsonb
      or jsonb_typeof(p_recipe->'targets') is distinct from 'object' or octet_length(p_recipe::text) > 65536 then
      raise exception 'ui_design_invalid';
    end if;
    if (select count(*) from jsonb_object_keys(p_recipe->'targets')) > 384 then raise exception 'ui_design_invalid'; end if;
  elsif p_recipe is not null then
    raise exception 'ui_design_invalid';
  end if;

  insert into public.account_settings (key, value)
  values ('ui_design_v1', '{"version":1,"revision":0,"publishedRevision":0,"draft":{"version":1,"targets":{}},"published":{"version":1,"targets":{}},"previous":null,"updatedAt":null,"publishedAt":null}'::jsonb)
  on conflict (key) do nothing;

  select value into v_state from public.account_settings where key = 'ui_design_v1' for update;
  if v_state->'version' is distinct from '1'::jsonb
    or jsonb_typeof(v_state->'revision') is distinct from 'number' then raise exception 'ui_design_state_invalid'; end if;
  v_revision := (v_state->>'revision')::bigint;
  if v_revision <> p_expected_revision then return jsonb_build_object('status', 'conflict', 'state', v_state); end if;
  if p_action = 'rollback' and (v_state->'previous' is null or v_state->'previous' = 'null'::jsonb) then
    return jsonb_build_object('status', 'no-previous', 'state', v_state);
  end if;

  v_recipe := case p_action when 'save' then p_recipe when 'publish' then v_state->'draft' else v_state->'previous' end;
  v_current := case p_action when 'save' then v_state->'draft' else v_state->'published' end;
  if v_recipe = v_current then return jsonb_build_object('status', 'unchanged', 'state', v_state); end if;
  v_before := v_state;
  v_revision := v_revision + 1;
  v_state := v_state || jsonb_build_object('revision', v_revision, 'updatedAt', v_now);
  if p_action = 'save' then
    v_status := 'saved';
    v_state := v_state || jsonb_build_object('draft', v_recipe);
  else
    v_status := case when p_action = 'publish' then 'published' else 'rolled-back' end;
    v_state := v_state || jsonb_build_object('published', v_recipe, 'previous', v_before->'published', 'publishedAt', v_now, 'publishedRevision', v_revision);
  end if;
  update public.account_settings set value = v_state, updated_at = v_now where key = 'ui_design_v1';
  insert into public.admin_audit_logs (admin_label, action, target_type, target_id, before_value, after_value)
  values ('verified-admin', 'ui_design_' || p_action, 'ui_design', 'ui_design_v1',
    jsonb_build_object('revision', v_before->'revision'),
    jsonb_build_object('revision', v_revision, 'publishedRevision', v_state->'publishedRevision', 'targets', (select count(*) from jsonb_object_keys(v_recipe->'targets'))));
  return jsonb_build_object('status', v_status, 'state', v_state);
end;
$$;

revoke all on function public.mutate_ui_design_v1(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.mutate_ui_design_v1(bigint, text, jsonb) to service_role;

commit;
notify pgrst, 'reload schema';
