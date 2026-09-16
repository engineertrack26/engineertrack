-- ============================================================
-- Internship closure verification. Run in the Supabase SQL editor, one part
-- per submission. Anonymous dollar-quoting only.
-- Apply order: docs/internship-closure-migration.sql, then
-- docs/internship-closure-guards.sql, then this file.
-- PART A is STRUCTURAL (owner session bypasses RLS) -- it proves existence
-- and grants, not evaluability. Part B (owner-run, impersonated) is RPC
-- behaviour. Part C (SET LOCAL ROLE authenticated) is the only real RLS test.
-- ============================================================

-- ============================================================
-- PART A — schema assertions. Expected: one row "PASS: schema assertions held".
-- ============================================================
DO $$
DECLARE n INT;
BEGIN
  -- Table + columns.
  IF to_regclass('public.internship_closures') IS NULL THEN
    RAISE EXCEPTION 'FAIL: internship_closures table is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'internship_closures' AND column_name = 'student_id'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures.student_id is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'internship_closures' AND column_name = 'group_id'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures.group_id is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'internship_closures' AND column_name = 'report_md'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures.report_md is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'internship_closures' AND column_name = 'report_version'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures.report_version is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'internship_closures' AND column_name = 'reopen_reason'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures.reopen_reason is missing';
  END IF;

  -- UNIQUE (student_id, group_id) -- one closure row per pair, the target of
  -- close_internship's ON CONFLICT.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'internship_closures'::regclass AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures has no UNIQUE constraint (expected student_id, group_id)';
  END IF;

  -- RLS on, a SELECT policy exists, and nothing else does -- every write goes
  -- through the SECURITY DEFINER RPCs, never a direct client write.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'internship_closures' AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'FAIL: internship_closures does not have row level security enabled';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'internship_closures' AND cmd = 'SELECT';
  IF n < 1 THEN
    RAISE EXCEPTION 'FAIL: internship_closures has no SELECT policy';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'internship_closures' AND cmd IN ('INSERT','UPDATE','DELETE');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: internship_closures has a direct write policy (% found) -- writes must go through the RPCs', n;
  END IF;

  -- Internal functions: present, but not directly callable by a client.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'internship_closed') THEN
    RAISE EXCEPTION 'FAIL: internship_closed is missing';
  END IF;
  IF has_function_privilege('authenticated', 'internship_closed(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: internship_closed is executable by authenticated -- it must be internal only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'build_internship_report') THEN
    RAISE EXCEPTION 'FAIL: build_internship_report is missing';
  END IF;
  IF has_function_privilege('authenticated', 'build_internship_report(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: build_internship_report is executable by authenticated -- it must be internal only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'closure_reached_level') THEN
    RAISE EXCEPTION 'FAIL: closure_reached_level is missing';
  END IF;
  IF has_function_privilege('authenticated', 'closure_reached_level(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: closure_reached_level is executable by authenticated -- it must be internal only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'closure_level_word') THEN
    RAISE EXCEPTION 'FAIL: closure_level_word is missing';
  END IF;

  -- The four public RPCs, granted to authenticated.
  IF NOT has_function_privilege('authenticated', 'close_internship(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: close_internship is not granted to authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'reopen_internship(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: reopen_internship is not granted to authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'get_internship_report(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: get_internship_report is not granted to authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'internship_closure_status(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: internship_closure_status is not granted to authenticated';
  END IF;

  RAISE NOTICE 'PASS: schema assertions held';
END $$;
SELECT 'PASS: schema assertions held' AS result;
