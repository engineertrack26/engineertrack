-- docs/security-review-inventory.sql — read-only. Owner-run, one statement
-- block at a time; each returns a result set for docs/security-review-2026-09-20.md.
-- Nothing here changes the database.

-- 1. Tables in public without row level security (expected: none)
SELECT c.relname AS table_without_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
ORDER BY 1;

-- 2. Every policy, so writes can be eyeballed: a permissive INSERT/UPDATE/DELETE
--    whose WITH CHECK does not mention auth.uid() or a helper is suspicious.
SELECT tablename, policyname, cmd, roles::text AS roles,
       left(coalesce(qual, ''), 90) AS using_expr, left(coalesce(with_check, ''), 90) AS check_expr
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- 3. Tables the authenticated role may write directly (table- or column-level grants)
SELECT table_name, privilege_type, string_agg(coalesce(column_name, '*'), ',' ORDER BY column_name) AS columns
FROM (
  SELECT table_name, privilege_type, NULL::text AS column_name FROM information_schema.role_table_grants
   WHERE grantee = 'authenticated' AND table_schema = 'public' AND privilege_type IN ('INSERT','UPDATE','DELETE')
  UNION ALL
  SELECT table_name, privilege_type, column_name FROM information_schema.role_column_grants
   WHERE grantee = 'authenticated' AND table_schema = 'public' AND privilege_type IN ('INSERT','UPDATE','DELETE')
) g GROUP BY table_name, privilege_type ORDER BY table_name, privilege_type;

-- 4. Functions in public that the ANON role can execute (expected after hardening: none)
SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS anon_executable,
       p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prorettype <> 'trigger'::regtype
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY 1;

-- 5. SECURITY DEFINER functions executable by authenticated — the real API surface.
--    Internal helpers (internship_closed, build_internship_report, internship_notify,
--    can_message, conversation_other, closure_*) must NOT appear here.
SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS rpc
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
ORDER BY 1;

-- 6. SECURITY DEFINER functions without a fixed search_path (expected: none)
SELECT p.proname AS definer_without_search_path
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%')
ORDER BY 1;

-- 7. Storage buckets: publicity and limits (expected: only avatars public; every bucket with a size limit and MIME list)
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id;

-- 8. Storage policies (who may list/read/write which bucket)
SELECT policyname, cmd, roles::text AS roles, left(coalesce(qual, ''), 100) AS using_expr, left(coalesce(with_check, ''), 100) AS check_expr
FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- 9. Views exposed to authenticated (a view runs as its owner unless security_invoker is set)
SELECT c.relname AS view_name, coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false') AS security_invoker
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v' ORDER BY 1;
