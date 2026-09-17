-- Read-only checks after growth-awards-migration.sql; run separately.
SELECT c.relname,c.relrowsecurity,
  has_table_privilege('authenticated',c.oid,'SELECT') AS select_must_be_false,
  has_table_privilege('authenticated',c.oid,'INSERT') AS insert_must_be_false,
  has_table_privilege('authenticated',c.oid,'UPDATE') AS update_must_be_false,
  has_table_privilege('authenticated',c.oid,'DELETE') AS delete_must_be_false
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='growth_awards';

SELECT p.oid::regprocedure,p.prosecdef,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_must_be_false,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_must_be_true
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='sync_my_growth_awards';

SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.growth_awards'::regclass AND contype='p';
-- Expected PK: student_id,group_id,stage_id,rule_version.
