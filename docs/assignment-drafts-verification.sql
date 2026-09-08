-- ============================================================
-- Assignment drafts verification
--
-- Run in the Supabase SQL editor. Anonymous $$ only: a named dollar tag
-- fails with 42601 in that editor.
--
-- Apply order: docs/assignment-drafts-migration.sql first, then
-- docs/assignment-drafts-rpcs.sql, then this file.
--
-- PART A is STRUCTURAL. The editor connects as the table owner and an owner
-- bypasses RLS, so these assertions prove a column, a constraint or a policy
-- EXISTS. They never prove a policy can be EVALUATED. Part C is where the
-- policies are actually evaluated.
-- ============================================================

-- ============================================================
-- PART A — schema assertions
-- Expected: one row, "PASS: schema assertions held".
-- ============================================================

DO $$
DECLARE
  n INT;
BEGIN
  -- The three draft columns.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'group_assignments' AND column_name = 'published_at') THEN
    RAISE EXCEPTION 'FAIL: group_assignments.published_at is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'group_assignments' AND column_name = 'document_path') THEN
    RAISE EXCEPTION 'FAIL: group_assignments.document_path is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'group_assignments' AND column_name = 'document_name') THEN
    RAISE EXCEPTION 'FAIL: group_assignments.document_name is missing';
  END IF;

  -- The bucket exists and is private. A public assignment-docs bucket would
  -- make every document readable by URL alone, bypassing the read policy
  -- below entirely.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets
                 WHERE id = 'assignment-docs' AND public = false) THEN
    RAISE EXCEPTION 'FAIL: assignment-docs bucket is missing or public';
  END IF;

  -- The three storage policies exist.
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname IN ('assignment_docs_upload', 'assignment_docs_read', 'assignment_docs_delete');
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL: % of 3 assignment-docs storage policies present', n;
  END IF;

  -- The backfill's proof, in a form that survives drafts existing. A task that
  -- carries submissions was unquestionably sent, so a NULL published_at there
  -- can only mean the backfill was missed. Asserting "no row is NULL" would be
  -- true today and false the moment the first draft is created.
  IF EXISTS (
    SELECT 1 FROM group_assignments a
    WHERE a.published_at IS NULL AND assignment_has_submissions(a.id)
  ) THEN
    RAISE EXCEPTION 'FAIL: an assignment with submissions has a NULL published_at; the backfill was missed';
  END IF;
END $$;

SELECT 'PASS: schema assertions held' AS part_a;


-- ============================================================
-- PART B — publish_assignments, as owner. Submit BEGIN..ROLLBACK in one go.
--
--   B1 publish an in-scope draft         returns 1, published_at set
--   B2 publish an out-of-scope draft     refused, message names the task
--   B3 re-publish an already-published row   returns 0, published_at unchanged
--
-- B3 is the one that looks redundant and is not: without the
-- `AND published_at IS NULL` guard on the UPDATE, a re-send would silently
-- reset the timestamp that records when students first saw the task.
-- ============================================================

BEGIN;

DO $$
DECLARE
  log TEXT := '';
  adv UUID; grp UUID;
  kpi_a UUID; kpi_b UUID; comp_b UUID;
  a_in UUID; a_out UUID; a_pub UUID;
  pub_ts TIMESTAMPTZ;
  n INT;
  check_ts TIMESTAMPTZ;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;

  IF adv IS NULL THEN
    PERFORM set_config('probe.results',
      'B1-B3 behaviour' || E'\t' || 'SKIP: needs one advisor profile' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name)
  VALUES (adv, 'Probe drafts') RETURNING id INTO grp;

  -- tr_seed_group_competency_targets seeds every competency as a target on
  -- that INSERT, so both triplets below start in scope. comp_b's target row
  -- is DELETEd further down, after its draft already exists, rather than
  -- assumed absent from the start.
  SELECT k.id INTO kpi_a
  FROM competency_kpis k
  JOIN competencies c ON c.id = k.competency_id
  WHERE k.level = 1 AND k.kpi_index = 1
  ORDER BY c.display_order OFFSET 0 LIMIT 1;

  SELECT k.id, k.competency_id INTO kpi_b, comp_b
  FROM competency_kpis k
  JOIN competencies c ON c.id = k.competency_id
  WHERE k.level = 1 AND k.kpi_index = 1
  ORDER BY c.display_order OFFSET 1 LIMIT 1;

  -- A SELECT ... INTO over an empty result leaves the variable NULL rather
  -- than raising. If the framework has fewer than two competencies, kpi_a or
  -- kpi_b would be NULL here and the inserts below would fail on the
  -- triplet_id NOT NULL constraint with a confusing error instead of a clear
  -- SKIP -- so check explicitly.
  IF kpi_a IS NULL OR kpi_b IS NULL THEN
    PERFORM set_config('probe.results',
      'B1-B3 behaviour' || E'\t'
      || 'SKIP: needs two competencies with a level-1 KPI 1' || E'\n', true);
    RETURN;
  END IF;

  -- a_in: a draft on a competency the group targets. Stays in scope.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe in-scope', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi_a ORDER BY tr.triplet_index LIMIT 1
  RETURNING id INTO a_in;

  -- a_out: a draft on comp_b, still a target at insert time (so
  -- trg_assignment_within_scope lets it through) -- its target row is removed
  -- afterward, below, to create the out-of-scope condition publish_assignments
  -- must catch.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe out-of-scope', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi_b ORDER BY tr.triplet_index LIMIT 1
  RETURNING id INTO a_out;

  -- a_pub: already published, on the still-in-scope competency, written
  -- directly as the owner. The point of this fixture is a known starting
  -- published_at, not an exercise of the RPC.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grp, tr.id, 'Probe already-published', tr.objective, tr.criterion, adv, now() - interval '1 day'
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi_a ORDER BY tr.triplet_index OFFSET 1 LIMIT 1
  RETURNING id, published_at INTO a_pub, pub_ts;

  IF a_pub IS NULL THEN
    PERFORM set_config('probe.results',
      'B1-B3 behaviour' || E'\t'
      || 'SKIP: needs a second triplet under the in-scope KPI' || E'\n', true);
    RETURN;
  END IF;

  -- Now take comp_b out of scope. a_out was already inserted above, so this
  -- is the trap the brief names: assuming the target row starts absent would
  -- have skipped the seed trigger's effect entirely and proven nothing.
  DELETE FROM group_competency_targets WHERE group_id = grp AND competency_id = comp_b;

  -- publish_assignments reads auth.uid(). Without this every call below
  -- would raise NOT_AUTHENTICATED.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', adv)::text, true);

  -- Each case from here on is wrapped in its own BEGIN..EXCEPTION so an
  -- unexpected throw in one case reports ABORTED for that case instead of
  -- unwinding the whole DO block and losing every result gathered so far.

  -- B1. An in-scope draft publishes: 1 row moved, published_at now set.
  BEGIN
    SELECT publish_assignments(ARRAY[a_in]) INTO n;
    SELECT published_at INTO check_ts FROM group_assignments WHERE id = a_in;
    log := log || 'B1 publish an in-scope draft' || E'\t'
        || CASE WHEN n = 1 AND check_ts IS NOT NULL THEN 'returns 1, published_at set'
                WHEN n <> 1 THEN 'FAIL: returned ' || n || ', expected 1'
                ELSE 'FAIL: published_at still NULL after publish' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B1 publish an in-scope draft' || E'\t'
        || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B2. An out-of-scope draft is refused, and the message names the task --
  --     an advisor told only "something is out of scope" has to go hunting
  --     through the tray.
  BEGIN
    PERFORM publish_assignments(ARRAY[a_out]);
    log := log || 'B2 publish an out-of-scope draft' || E'\t'
        || 'FAIL: accepted -- trg_assignment_within_scope is BEFORE INSERT only, '
        || 'this is exactly the re-check that must catch it' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B2 publish an out-of-scope draft' || E'\t'
        || CASE WHEN SQLERRM LIKE '%Probe out-of-scope%' THEN 'refused, message names the task'
                ELSE 'FAIL (wrong error): ' || SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- B3. Re-publishing an already-published row moves nothing and must not
  --     rewrite published_at -- see the header comment above. IS DISTINCT
  --     FROM would read as false for a re-sent identical value, which is the
  --     right answer here but only because we compare against the ORIGINAL
  --     captured pub_ts, not a freshly re-derived one.
  BEGIN
    SELECT publish_assignments(ARRAY[a_pub]) INTO n;
    SELECT published_at INTO check_ts FROM group_assignments WHERE id = a_pub;
    log := log || 'B3 re-publish an already-published row' || E'\t'
        || CASE WHEN n = 0 AND check_ts = pub_ts THEN 'returns 0, published_at unchanged'
                WHEN n <> 0 THEN 'FAIL: returned ' || n || ', expected 0'
                ELSE 'FAIL: published_at moved from ' || pub_ts || ' to ' || check_ts END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B3 re-publish an already-published row' || E'\t'
        || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;


-- ============================================================
-- How to run this
--
-- Apply order before this script ever runs: docs/assignment-drafts-migration.sql
-- first, then docs/assignment-drafts-rpcs.sql, then this file.
--
-- Part B is submitted as one block, BEGIN..ROLLBACK in a single submission --
-- the SQL editor gives each submission its own connection, so a transaction
-- split across submissions loses its state (42P01).
--
-- Expected output: Part A one row reading PASS; Part B three rows. Any cell
-- beginning FAIL, ABORTED or SKIP is a real result to look at, not noise to
-- scroll past.
-- ============================================================
