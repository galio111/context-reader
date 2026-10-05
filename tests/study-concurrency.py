"""Run on the Docker host, against the dedicated restored test database only."""
import concurrent.futures,json,subprocess,uuid
DB='context_reader_study_1005';u=str(uuid.uuid4())
def sql(text):
 return subprocess.check_output(['docker','exec','-i','context-reader-postgres-1','psql','-U','supabase_admin','-d',DB,'-v','ON_ERROR_STOP=1','-At'],input=text.encode()).decode().strip()
assert sql('select current_database()')==DB
try:
 sql(f"""begin;
 insert into auth.users(id) values('{u}');
 insert into account_profiles(user_id,nickname,status) values('{u}','study-concurrency','active') on conflict(user_id) do update set status='active';
 insert into user_entitlements(user_id,plan_id,source) values('{u}','free','signup') on conflict(user_id) do update set plan_id='free';
 insert into study_cards(user_id,id,entry_id,mode,memory,reward_key)
 select '{u}',lpad(n::text,40,'a'),n::text,'basic_en_to_cn',jsonb_build_object('state',0,'due',now()),'concurrent-'||n from generate_series(1,5)n;
 select study_start('{u}',(select jsonb_agg(id) from study_cards where user_id='{u}'),'{{}}');
 update study_cards set memory=memory||jsonb_build_object('state',2,'last_review',now(),'due',now()+interval '3 days') where user_id='{u}';
 insert into study_streaks(user_id,current,best,last_day) values('{u}',1,1,(now() at time zone 'Asia/Shanghai')::date-1);
 commit;""")
 # Policy is configured only in this disposable database, preserving its previous value.
 old=sql('select policy from study_policy where id')
 policy=json.loads(old);policy.update(rewardsEnabled=True,pointsPerNew=1,dailyRewardCap=50,rewardDays=90,streakMinNew=5,milestones=[{'days':2,'points':50,'plan':None,'months':0}])
 sql("update study_policy set policy='"+json.dumps(policy).replace("'","''")+"' where id")
 try:
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
   results=list(executor.map(lambda _:json.loads(sql(f"select study_complete('{u}')")),range(8)))
  assert sum(not r.get('duplicate',False) for r in results)==1,results
  assert all(r['points']==55 for r in results),results
  assert sql(f"select count(*) from billing_grants where user_id='{u}' and kind='topup'")=='1'
  assert sql(f"select current from study_streaks where user_id='{u}'")=='2'
  print('PASS: 8 simultaneous completion requests produce one 55-point credit, one milestone and one streak advance')
 finally:sql("update study_policy set policy='"+old.replace("'","''")+"' where id")
finally:
 sql(f"begin;delete from billing_grants where user_id='{u}';delete from auth.users where id='{u}';commit;")
