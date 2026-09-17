-- Read-only. Run each SELECT separately as the dashboard administrator.
SELECT c.relname, c.relrowsecurity,
  has_table_privilege('authenticated',c.oid,'SELECT') AS select_must_be_false,
  has_table_privilege('authenticated',c.oid,'INSERT') AS insert_must_be_false,
  has_table_privilege('authenticated',c.oid,'UPDATE') AS update_must_be_false,
  has_table_privilege('authenticated',c.oid,'DELETE') AS delete_must_be_false
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('growth_submission_path','growth_submission_events');

SELECT p.oid::regprocedure, p.prosecdef, p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_must_be_false,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('my_growth_journey','growth_track_submission');
-- authenticated true only for my_growth_journey; no PUBLIC/anon execution.

SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid='public.assignment_submissions'::regclass AND tgname='trg_growth_submission';
-- Exactly one row, tgenabled='O'. Production learner data is not exposed here.
