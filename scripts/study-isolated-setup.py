import pathlib, subprocess
DB="context_reader_study_1005"
def cmd(*args,stdin=None):
 return subprocess.run(["docker","exec","-i","context-reader-postgres-1",*args],input=stdin,check=True,capture_output=True).stdout
exists=cmd("psql","-U","supabase_admin","-d","postgres","-Atc","select datname from pg_database where datname='"+DB+"'").decode().strip()
if exists: raise SystemExit("Dedicated study database already exists; reuse it instead of recreating")
backup=max(pathlib.Path("/var/backups/context-reader/postgres/daily").glob("*.dump"),key=lambda p:p.stat().st_mtime)
subprocess.run(["sha256sum","-c",str(backup)+".sha256"],check=True)
cmd("createdb","-U","supabase_admin",DB)
data=backup.read_bytes()
for section in ("pre-data","data","post-data"):
 if section=="data":
  cmd("psql","-U","supabase_admin","-d",DB,"-v","ON_ERROR_STOP=1","-c","grant all on table vault.secrets to supabase_admin")
 cmd("pg_restore","--exit-on-error","--no-owner","--no-privileges","--section="+section,"-U","supabase_admin","-d",DB,stdin=data)
print("Restored isolated study database from verified backup")
cmd("psql","-U","supabase_admin","-d",DB,"-v","ON_ERROR_STOP=1",stdin=b"do $$ declare f record; begin for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname like 'billing_%' loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;end $$;")
print(cmd("psql","-U","supabase_admin","-d",DB,"-v","ON_ERROR_STOP=1",stdin=pathlib.Path("/tmp/context-study-migration-1005.sql").read_bytes()).decode())
