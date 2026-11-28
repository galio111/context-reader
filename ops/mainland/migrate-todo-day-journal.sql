-- Journal plan versions use Shanghai civil days. Dates between versions share the preceding plan.
BEGIN;
CREATE TABLE IF NOT EXISTS public.personal_todo_day_plan (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL, tasks jsonb NOT NULL, events jsonb NOT NULL,
  PRIMARY KEY (owner_id,day)
);
ALTER TABLE public.personal_todo_day_plan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personal_todo_day_plan FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.personal_todo_day_plan TO service_role;

CREATE OR REPLACE FUNCTION public.personal_todo_record_plan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE local_day date := (statement_timestamp() AT TIME ZONE 'Asia/Shanghai')::date;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.state->'tasks' IS NOT DISTINCT FROM NEW.state->'tasks'
       AND OLD.state->'events' IS NOT DISTINCT FROM NEW.state->'events' THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO public.personal_todo_day_plan(owner_id,day,tasks,events)
  VALUES(NEW.owner_id,local_day,NEW.state->'tasks',coalesce(NEW.state->'events','[]'::jsonb))
  ON CONFLICT (owner_id,day) DO UPDATE SET tasks=excluded.tasks,events=excluded.events;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.personal_todo_record_plan() FROM PUBLIC, anon, authenticated, service_role;
LOCK TABLE public.personal_todo_workspace IN SHARE ROW EXCLUSIVE MODE;
CREATE OR REPLACE TRIGGER personal_todo_archive_plan AFTER INSERT OR UPDATE OF state
  ON public.personal_todo_workspace FOR EACH ROW EXECUTE FUNCTION public.personal_todo_record_plan();
-- The bootstrap copy supports best-effort reconstruction before journaling began.
INSERT INTO public.personal_todo_day_plan(owner_id,day,tasks,events)
SELECT owner_id,'0001-01-01',state->'tasks',coalesce(state->'events','[]'::jsonb)
FROM public.personal_todo_workspace ON CONFLICT DO NOTHING;
INSERT INTO public.personal_todo_day_plan(owner_id,day,tasks,events)
SELECT owner_id,(statement_timestamp() AT TIME ZONE 'Asia/Shanghai')::date,state->'tasks',coalesce(state->'events','[]'::jsonb)
FROM public.personal_todo_workspace ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
