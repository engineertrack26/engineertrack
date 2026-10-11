-- docs/maintenance-2026-10-11.sql
-- Three maintenance items in one paste: prune cron.job_run_details, close the
-- anon gap on feed_publish_assignment, and LIST (not revoke) every public
-- function anon can still execute.
--
-- APPLY ORDER: after docs/assignment-scheduling.sql and
-- docs/group-feed-assignment-cards.sql. Idempotent, anonymous $$ only.
--
-- The editor hides NOTICE and shows only the LAST statement's result, so the
-- final statement is a plain SELECT that reports and cannot fail. Read it.
-- Editor runs this as one implicit transaction: nothing above may fail
-- except through the guards written below.

-- ---- 1. Prune cron.job_run_details (7 days, daily 03:17 UTC) ----
-- publish-due-assignments runs every minute = 1440 rows/day, never pruned.
-- Unschedule-then-schedule, as assignment-scheduling.sql does, so a re-run
-- never stacks a second job. Skipped (not failed) if pg_cron is absent, so
-- the other two items still land; the final result set says which happened.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule('prune-cron-job-run-details')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-cron-job-run-details');
    PERFORM cron.schedule(
      'prune-cron-job-run-details', '17 3 * * *',
      'DELETE FROM cron.job_run_details WHERE COALESCE(end_time, start_time) < now() - interval ''7 days'';');
  END IF;
END;
$$;

-- ---- 2. feed_publish_assignment: also revoke from anon ----
-- group-feed-assignment-cards.sql revokes only PUBLIC, authenticated. An
-- explicit GRANT to anon would survive that. Skipped if the function is absent.
DO $$
BEGIN
  IF to_regprocedure('public.feed_publish_assignment(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.feed_publish_assignment(uuid) FROM PUBLIC, anon, authenticated;
  END IF;
END;
$$;

-- ---- 3. Anon sweep: list, never revoke ----
-- MUST stay the last statement. One row per non-trigger public function anon
-- can execute (kind = 'OFFENDER'). If there are none, exactly one row
-- 'CLEAN' comes back, so an empty grid never means "did not run". A final
-- 'CRON' row reports whether the prune job is registered.
-- via_public = true: reachable through the PUBLIC grant (a revoke from anon
-- alone will not close it). direct_anon_grant = true: anon is named in the ACL.
-- from_extension = true: owned by an extension, think before revoking.
SELECT kind, function_name, arguments, via_public, direct_anon_grant, from_extension, detail
FROM (
  SELECT 'OFFENDER'::text AS kind,
         p.proname::text AS function_name,
         pg_get_function_identity_arguments(p.oid) AS arguments,
         EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                 WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS via_public,
         EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                 JOIN pg_roles r ON r.oid = a.grantee
                 WHERE r.rolname = 'anon' AND a.privilege_type = 'EXECUTE') AS direct_anon_grant,
         EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                 AND d.objid = p.oid AND d.deptype = 'e') AS from_extension,
         p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS detail,
         1 AS ord
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.prorettype <> 'trigger'::regtype
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
  UNION ALL
  SELECT 'CLEAN', NULL, NULL, NULL, NULL, NULL,
         'No public function is executable by anon.', 0
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.prorettype <> 'trigger'::regtype
      AND has_function_privilege('anon', p.oid, 'EXECUTE'))
  UNION ALL
  SELECT 'CRON', NULL, NULL, NULL, NULL, NULL,
         CASE WHEN to_regclass('cron.job') IS NULL THEN 'pg_cron NOT enabled: prune job was skipped'
              WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-cron-job-run-details')
                THEN 'prune-cron-job-run-details is registered'
              ELSE 'prune job NOT registered' END, 2
) s
ORDER BY ord, function_name, arguments;
