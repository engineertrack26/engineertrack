-- docs/join-hardening-verification.sql
-- Verifies join-hardening-migration.sql against a live database.
--
-- ============================================================
-- HOW TO RUN THIS — read before pasting anything
-- ============================================================
--
-- Three properties of the Supabase SQL editor shape this file. All three were
-- found the hard way; ignoring any of them makes the script report false
-- failures or fail to run at all.
--
-- 1. EACH SUBMISSION GETS ITS OWN CONNECTION.
--    A `set_config(..., false)` in one submission is gone by the next one.
--    So the borrowed identity and the call being tested must live in the SAME
--    submission, inside an explicit transaction, using `is_local = true`.
--    That is why Parts B and C are single BEGIN/ROLLBACK blocks rather than a
--    list of individual `SELECT link_student_by_code(...)` lines — those would
--    all just return NOT_AUTHENTICATED, which says nothing about the code.
--
-- 2. THE EDITOR MIS-PARSES NAMED DOLLAR TAGS.
--    `DO $probe$ ... $probe$` fails with `42601 mismatched parentheses`.
--    Only the anonymous `$$` form is safe. Do not add a tag when editing.
--
-- 3. A TEMP TABLE IS NOT VISIBLE TO LATER STATEMENTS IN THE SAME SUBMISSION.
--    `CREATE TEMP TABLE probe ...` followed by `INSERT INTO probe` inside a
--    DO block fails with `42P01: relation "probe" does not exist`. Rather than
--    diagnose the editor, this script does not depend on temp tables at all:
--    each DO block accumulates its results in a plain text variable and hands
--    them over through a transaction-local GUC, which is the same mechanism
--    the identity borrowing already relies on.
--
-- Run Part A, then Part B, then Part C, then Part D as separate submissions.
-- Every part prints a result table; nothing needs to be read from NOTICEs.
--
-- Parts B and C end in ROLLBACK. That is load-bearing, not tidiness: Part C
-- temporarily rewrites a real institution's allowed_email_domains and a real
-- profile's e-mail. Part D re-reads those tables so you can confirm nothing
-- was left behind.


-- ============================================================
-- PART A — schema assertions
-- Expected: one row reading `PASS: schema assertions held`.
-- Any failure raises instead, naming what is missing.
-- ============================================================

DO $$
DECLARE
  ok      BOOLEAN;
  missing TEXT;
BEGIN
  -- The column exists. Its default of '{}' is what "no restriction" means.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'institutions' AND column_name = 'allowed_email_domains'
  ) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: institutions.allowed_email_domains missing'; END IF;

  IF to_regclass('public.join_issue_reports') IS NULL THEN
    RAISE EXCEPTION 'FAIL: join_issue_reports missing';
  END IF;

  -- Append-only: reports must not be editable or erasable by their author.
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'join_issue_reports' AND cmd IN ('UPDATE', 'DELETE')
  ) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: join_issue_reports has an UPDATE/DELETE policy'; END IF;

  -- No INSERT policy either. report_join_issue is SECURITY DEFINER and runs as
  -- the table owner, so it writes regardless. Handing clients a direct INSERT
  -- would let PostgREST bypass the RPC entirely, which would make the rate
  -- limit and the note cap decorative. This assertion guards that regression.
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'join_issue_reports' AND cmd = 'INSERT'
  ) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: join_issue_reports has an INSERT policy — the RPC is bypassable'; END IF;

  -- All five functions are present. Name the missing ones rather than just
  -- reporting a count, so a failure is actionable.
  SELECT string_agg(n, ', ') INTO missing
  FROM unnest(ARRAY[
    'get_my_student_code', 'link_student_by_code',
    'join_department_by_code', 'report_join_issue', 'record_consent'
  ]) AS n
  WHERE NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = n);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: missing functions: %', missing;
  END IF;
END $$;

SELECT 'PASS: schema assertions held' AS result;


-- ============================================================
-- PART B — code format rejection and report abuse limits
-- Submit everything from BEGIN to ROLLBACK in one go.
--
-- Expected rows:
--   01..04  INVALID_CODE_FORMAT
--   05      INVALID_REASON
--   06      NOTE_TOO_LONG
--   07..09  accepted
--   10      REPORT_RATE_LIMITED
-- ============================================================

BEGIN;

DO $$
DECLARE
  actor UUID;
  c     TEXT;
  n     INT  := 0;
  log   TEXT := '';
BEGIN
  -- link_student_by_code checks the caller's role BEFORE the code shape, so a
  -- student identity would return ROLE_NOT_ALLOWED and prove nothing.
  SELECT id INTO actor FROM profiles
  WHERE role IN ('mentor', 'advisor') ORDER BY created_at LIMIT 1;

  IF actor IS NULL THEN
    log := log || '01-04 format' || E'\t' || 'SKIP: no mentor or advisor profile exists' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', actor)::text, true);

    FOREACH c IN ARRAY ARRAY[
      '7BW8HH29_H94FQV',  -- two segments, not three
      'A_B_C_D',          -- four segments
      'H94FQ',            -- bare code, wrong length
      ''                  -- empty
    ] LOOP
      n := n + 1;
      BEGIN
        PERFORM link_student_by_code(c, 'mentor');
        log := log || lpad(n::text, 2, '0') || ' format' || E'\t'
                   || 'FAIL: accepted ' || quote_literal(c) || E'\n';
      EXCEPTION WHEN OTHERS THEN
        log := log || lpad(n::text, 2, '0') || ' format' || E'\t'
                   || SQLERRM || '  <- ' || quote_literal(c) || E'\n';
      END;
    END LOOP;
  END IF;

  -- ---- report_join_issue ----
  SELECT id INTO actor FROM profiles ORDER BY created_at LIMIT 1;

  IF actor IS NULL THEN
    log := log || '05-10 report' || E'\t' || 'SKIP: no profiles exist' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', actor)::text, true);

    -- The rate limit counts this caller's reports in the last five minutes, so
    -- a real report filed moments ago would shift every boundary below. Clear
    -- them for a deterministic baseline; the ROLLBACK puts them back.
    DELETE FROM join_issue_reports WHERE reporter_id = actor;

    BEGIN
      PERFORM report_join_issue('H94FQV', 'SOMETHING_ELSE', NULL);
      log := log || '05 reason' || E'\t' || 'FAIL: accepted an unknown reason code' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || '05 reason' || E'\t' || SQLERRM || E'\n';
    END;

    BEGIN
      PERFORM report_join_issue('H94FQV', 'INVALID_CODE', repeat('x', 501));
      log := log || '06 note cap' || E'\t' || 'FAIL: accepted a 501-character note' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || '06 note cap' || E'\t' || SQLERRM || E'\n';
    END;

    -- Three reports are allowed; the fourth must be refused. 07 also proves
    -- the cap is at 500 rather than below it.
    FOR n IN 7..10 LOOP
      BEGIN
        PERFORM report_join_issue(
          'H94FQV', 'INVALID_CODE',
          CASE WHEN n = 7 THEN repeat('x', 500) ELSE 'attempt ' || n END);
        log := log || lpad(n::text, 2, '0') || ' rate' || E'\t' || 'accepted' || E'\n';
      EXCEPTION WHEN OTHERS THEN
        log := log || lpad(n::text, 2, '0') || ' rate' || E'\t' || SQLERRM || E'\n';
      END;
    END LOOP;
  END IF;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;


-- ============================================================
-- PART C — the per-institution e-mail domain rule
-- Submit everything from BEGIN to ROLLBACK in one go.
--
-- Expected rows:
--   11  accepted (empty array = no restriction)
--   12  EMAIL_DOMAIN_BLOCKED:example.invalid
--   13  accepted   <- the case-insensitivity regression test
--   14  EMAIL_DOMAIN_BLOCKED:c.invalid
-- ============================================================

BEGIN;

DO $$
DECLARE
  actor        UUID;
  actor_domain TEXT;
  dept_code    TEXT;
  inst         UUID;
  log          TEXT := '';
BEGIN
  -- Any department will do; we need its institution to rewrite the rule.
  SELECT d.department_code, d.institution_id INTO dept_code, inst
  FROM departments d ORDER BY d.created_at LIMIT 1;

  -- The caller needs a well-formed address; the rule is read off its domain.
  SELECT p.id, split_part(lower(p.email), '@', 2) INTO actor, actor_domain
  FROM profiles p WHERE p.email ~ '^[^@]+@[^@]+$' ORDER BY p.created_at LIMIT 1;

  IF dept_code IS NULL THEN
    log := log || '11-14 domain' || E'\t' || 'SKIP: no departments exist' || E'\n';
  ELSIF actor IS NULL THEN
    log := log || '11-14 domain' || E'\t' || 'SKIP: no profile has a single-@ e-mail' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', actor)::text, true);

    -- 11. No restriction.
    UPDATE institutions SET allowed_email_domains = '{}' WHERE id = inst;
    BEGIN
      PERFORM join_department_by_code(dept_code);
      log := log || '11 empty list' || E'\t' || 'accepted' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || '11 empty list' || E'\t' || 'FAIL: ' || SQLERRM || E'\n';
    END;

    -- 12. A domain the caller does not have. The payload after the colon is
    --     what the client renders into the translated message, so check it is
    --     actually there.
    UPDATE institutions SET allowed_email_domains = '{example.invalid}' WHERE id = inst;
    BEGIN
      PERFORM join_department_by_code(dept_code);
      log := log || '12 blocked' || E'\t' || 'FAIL: joined despite a non-matching rule' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || '12 blocked' || E'\t' || SQLERRM || E'\n';
    END;

    -- 13. The caller's own domain, stored upper-cased. This is the regression
    --     test for the case-sensitivity bug the Task 9 review caught: an admin
    --     who saves 'BTU.EDU.TR' must not lock out every '@btu.edu.tr' student.
    UPDATE institutions SET allowed_email_domains = ARRAY[upper(actor_domain)] WHERE id = inst;
    BEGIN
      PERFORM join_department_by_code(dept_code);
      log := log || '13 case-insensitive' || E'\t' || 'accepted' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || '13 case-insensitive' || E'\t' || 'FAIL: ' || SQLERRM || E'\n';
    END;

    -- 14. A malformed address must be refused outright rather than handed to
    --     split_part, which would happily return 'c.invalid' from
    --     'a@b@c.invalid' and let a mailbox at b@c.invalid through on a rule
    --     it does not satisfy.
    UPDATE profiles SET email = 'a@b@c.invalid' WHERE id = actor;
    UPDATE institutions SET allowed_email_domains = '{c.invalid}' WHERE id = inst;
    BEGIN
      PERFORM join_department_by_code(dept_code);
      log := log || '14 malformed e-mail' || E'\t' || 'FAIL: a two-@ address satisfied the rule' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      log := log || '14 malformed e-mail' || E'\t' || SQLERRM || E'\n';
    END;
  END IF;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;


-- ============================================================
-- PART D — confirm Part C left nothing behind
-- Expected: every row shows the institution's real domain list. If any row
-- reads {example.invalid} or {c.invalid}, the ROLLBACK did not run — fix that
-- institution by hand before doing anything else.
-- ============================================================

SELECT name, allowed_email_domains FROM institutions ORDER BY created_at;
