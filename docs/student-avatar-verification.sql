-- Read-only checks after student-avatar-migration.sql.
SELECT relname, relrowsecurity,
  has_table_privilege('authenticated', 'public.student_avatar_preferences', 'SELECT') AS select_must_be_false,
  has_table_privilege('authenticated', 'public.student_avatar_preferences', 'INSERT') AS insert_must_be_false,
  has_table_privilege('authenticated', 'public.student_avatar_preferences', 'UPDATE') AS update_must_be_false,
  has_table_privilege('authenticated', 'public.student_avatar_preferences', 'DELETE') AS delete_must_be_false
FROM pg_class WHERE oid='public.student_avatar_preferences'::regclass;

SELECT p.oid::regprocedure AS function, p.prosecdef, p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_must_be_false,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated
FROM pg_proc p WHERE p.oid IN ('public.my_student_avatar()'::regprocedure,
  'public.set_student_avatar(text)'::regprocedure,'public.capture_student_avatar()'::regprocedure);
-- authenticated: true for the two RPCs, false for capture_student_avatar.
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname='trg_capture_student_avatar';
-- Expected O (enabled).
