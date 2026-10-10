"""Run only against the fresh, isolated study restore."""
import concurrent.futures,json,subprocess,uuid
DB='context_reader_study_ui_1010';u=str(uuid.uuid4())
def sql(text):
 return subprocess.check_output(['docker','exec','-i','context-reader-postgres-1','psql','-U','supabase_admin','-d',DB,'-v','ON_ERROR_STOP=1','-At'],input=text.encode()).decode().strip()
assert sql('select current_database()')==DB
try:
 sql(f"""begin;
 insert into auth.users(id) values('{u}');
 insert into account_profiles(user_id,nickname,status) values('{u}','study-claim-concurrency','active') on conflict(user_id) do update set status='active';
 insert into user_entitlements(user_id,plan_id,source) values('{u}','free','signup') on conflict(user_id) do update set plan_id='free';
 insert into study_claims(user_id,id,day,points) values('{u}','daily:2026-10-10','2026-10-10',50);
 commit;""")
 before=int(json.loads(sql(f"select billing_balance('{u}')"))['allowance'])
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
  results=list(pool.map(lambda _:json.loads(sql(f"select study_claim_reward('{u}','daily:2026-10-10')")),range(8)))
 assert sum(r.get('points',0) for r in results)==50,results
 assert sql(f"select count(*) from billing_grants where user_id='{u}' and kind='topup'")=='1'
 assert int(json.loads(sql(f"select billing_balance('{u}')"))['allowance'])==before+50
 print('PASS: eight simultaneous claims create one 50-point grant; balance increases exactly once')
finally:
 sql(f"begin;delete from billing_grants where user_id='{u}';delete from auth.users where id='{u}';commit;")
