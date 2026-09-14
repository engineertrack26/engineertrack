-- Read-only production checks. Run after the migration. No personal data returned.
SELECT c.relname, c.relrowsecurity,
  has_table_privilege('authenticated',c.oid,'INSERT') AS client_insert_must_be_false,
  has_table_privilege('authenticated',c.oid,'UPDATE') AS client_update_must_be_false,
  has_table_privilege('authenticated',c.oid,'DELETE') AS client_delete_must_be_false,
  has_table_privilege('authenticated',c.oid,'SELECT') AS direct_select_must_be_false
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('internship_placements','internship_days','internship_day_events');

SELECT p.oid::regprocedure AS function, p.prosecdef AS security_definer,
  p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_must_be_false,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'internship_%' ORDER BY p.proname;
-- authenticated must be false only for the private internship_can_student helper.

SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='internship-day-files';
-- public=false; file_size_limit=10485760; image/jpeg,image/png,image/webp,application/pdf.

SELECT schemaname,tablename,policyname,cmd,roles,qual,with_check FROM pg_policies
WHERE (schemaname='public' AND tablename IN ('internship_placements','internship_days','internship_day_events'))
   OR (schemaname='storage' AND tablename='objects')
ORDER BY schemaname,tablename,policyname;
-- Inspect ALL storage policies: no general read/insert/update/delete policy should
-- inadvertently grant wider access to internship-day-files. Policies are permissive ORs.
