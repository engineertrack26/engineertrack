-- docs/internship-groups-verification.sql
-- Run after docs/internship-groups-migration.sql and
-- docs/internship-groups-rpcs.sql. Two separate submissions.

-- ============================================================
-- PART A — schema assertions
-- Expected: one row, "PASS: schema assertions held".
-- ============================================================

DO $$
DECLARE
  missing TEXT;
BEGIN
  IF to_regclass('public.internship_groups') IS NULL THEN
    RAISE EXCEPTION 'FAIL: internship_groups missing';
  END IF;
  IF to_regclass('public.group_memberships') IS NULL THEN
    RAISE EXCEPTION 'FAIL: group_memberships missing';
  END IF;

  -- The whole one-active-group rule is this index. Without it nothing
  -- visibly breaks and a student silently belongs to two advisors.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'one_active_group_per_student'
  ) THEN
    RAISE EXCEPTION 'FAIL: one_active_group_per_student index missing';
  END IF;

  -- No INSERT policy on memberships: join_group_by_code is SECURITY DEFINER
  -- and is the only write path. An INSERT policy would let a client join any
  -- group by guessing a UUID, skipping the archived-group check.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'group_memberships' AND cmd = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'FAIL: group_memberships has an INSERT policy — the RPC is bypassable';
  END IF;

  -- The old model is gone.
  IF to_regclass('public.institutions') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: institutions still exists';
  END IF;
  IF to_regclass('public.departments') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: departments still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'FAIL: admin profiles still exist';
  END IF;

  SELECT string_agg(n, ', ') INTO missing
  FROM unnest(ARRAY[
    'join_group_by_code', 'validate_group_code',
    'link_student_by_code', 'get_my_student_code', 'get_my_group_leaderboard'
  ]) AS n
  WHERE NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = n);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: missing functions: %', missing;
  END IF;
END $$;

SELECT 'PASS: schema assertions held' AS result;


-- ============================================================
-- PART B — behaviour
-- Submit everything from BEGIN to ROLLBACK in one go.
--
-- Expected rows:
--   1 join            accepted
--   2 second group    accepted, first closed
--   3 two active      rejected by the unique index
--   4 second group    accepted (advisor owns two)
--   5 archived        GROUP_ARCHIVED
-- ============================================================

BEGIN;

DO $$
DECLARE
  adv      UUID;
  stu      UUID;
  g1       UUID;
  g2       UUID;
  g3       UUID;
  c1       TEXT;
  c2       TEXT;
  c3       TEXT;
  closed   INT;
  log      TEXT := '';
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;

  IF adv IS NULL OR stu IS NULL THEN
    PERFORM set_config('probe.results',
      '1-5 groups' || E'\t' || 'SKIP: needs one advisor and one student profile' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe A') RETURNING id, join_code INTO g1, c1;
  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe B') RETURNING id, join_code INTO g2, c2;
  INSERT INTO internship_groups (advisor_id, name, is_archived)
    VALUES (adv, 'Probe C', true) RETURNING id, join_code INTO g3, c3;

  -- Row 4 is proven by the two inserts above succeeding: an advisor owning
  -- more than one group is exactly what institutions_admin_id_unique forbade.
  log := log || '4 second group' || E'\t' || 'accepted' || E'\n';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu)::text, true);

  DELETE FROM group_memberships m WHERE m.student_id = stu;

  BEGIN
    PERFORM join_group_by_code(c1);
    log := log || '1 join' || E'\t' || 'accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || '1 join' || E'\t' || 'FAIL: ' || SQLERRM || E'\n';
  END;

  BEGIN
    PERFORM join_group_by_code(c2);
    SELECT count(*) INTO closed
    FROM group_memberships m
    WHERE m.student_id = stu AND m.group_id = g1 AND m.left_at IS NOT NULL;
    IF closed = 1 THEN
      log := log || '2 second group' || E'\t' || 'accepted, first closed' || E'\n';
    ELSE
      log := log || '2 second group' || E'\t' || 'FAIL: first membership not closed' || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    log := log || '2 second group' || E'\t' || 'FAIL: ' || SQLERRM || E'\n';
  END;

  -- Force a second ACTIVE membership straight past the RPC. This is the only
  -- check on the index that carries the whole rule.
  BEGIN
    INSERT INTO group_memberships (group_id, student_id) VALUES (g1, stu);
    log := log || '3 two active' || E'\t' || 'FAIL: index allowed two active memberships' || E'\n';
  EXCEPTION WHEN unique_violation THEN
    log := log || '3 two active' || E'\t' || 'rejected by the unique index' || E'\n';
  WHEN OTHERS THEN
    log := log || '3 two active' || E'\t' || 'FAIL (wrong error): ' || SQLERRM || E'\n';
  END;

  BEGIN
    PERFORM join_group_by_code(c3);
    log := log || '5 archived' || E'\t' || 'FAIL: joined an archived group' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || '5 archived' || E'\t' || SQLERRM || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;
