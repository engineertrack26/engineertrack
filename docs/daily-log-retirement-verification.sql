-- ============================================================
-- Subsystem D1 verification
--
-- Run in the Supabase SQL editor. Anonymous $$ only: a named dollar tag
-- fails with 42601 in that editor.
--
-- PART A is STRUCTURAL. The editor connects as the table owner and an owner
-- bypasses RLS, so these assertions prove a column, a constraint or a policy
-- EXISTS. They never prove a policy can be EVALUATED. On 2026-08-20 that
-- blind spot let a 42P17 recursion through two green verification runs.
-- Part C is where the policies are actually evaluated.
-- ============================================================

-- ============================================================
-- PART A — schema assertions
-- Expected: one row, "PASS: schema assertions held".
-- ============================================================

DO $$
DECLARE
  n INT;
BEGIN
  -- The dual-owner columns.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'log_photos' AND column_name = 'submission_id') THEN
    RAISE EXCEPTION 'FAIL: log_photos.submission_id is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'log_documents' AND column_name = 'submission_id') THEN
    RAISE EXCEPTION 'FAIL: log_documents.submission_id is missing';
  END IF;

  -- log_id must have become nullable, or a task-owned row cannot exist at all.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name IN ('log_photos','log_documents')
               AND column_name = 'log_id' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'FAIL: log_id is still NOT NULL; no row can be owned by a submission';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'assignment_submissions' AND column_name = 'reflection') THEN
    RAISE EXCEPTION 'FAIL: assignment_submissions.reflection is missing';
  END IF;

  -- Both one-owner constraints.
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conname IN ('log_photos_one_owner','log_documents_one_owner');
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL: % of 2 one-owner constraints present', n;
  END IF;

  -- Both constraints must actually say "= 1", not merely exist. A
  -- log_documents_one_owner mistyped as <= 1 or >= 1 would pass the count
  -- above and Part B's log_photos-only cases below while permitting exactly
  -- the orphan and double-owner rows the constraint exists to prevent.
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conname IN ('log_photos_one_owner','log_documents_one_owner')
    AND pg_get_constraintdef(oid) LIKE '%= 1%';
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL: % of 2 one-owner constraints actually say "= 1"; a <= 1 would permit an orphan row', n;
  END IF;

  SELECT count(*) INTO n FROM pg_indexes
  WHERE indexname IN ('idx_log_photos_submission','idx_log_documents_submission');
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL: % of 2 submission indexes present', n;
  END IF;
END $$;

SELECT 'PASS: schema assertions held' AS part_a;


-- ============================================================
-- PART B — behaviour, as owner. Submit BEGIN..ROLLBACK in one go.
--
--   B1 both owners set     refused (23514)
--   B2 neither owner set   refused (23514)
-- ============================================================

BEGIN;

DO $$
DECLARE
  log TEXT := '';
  a_log UUID;
BEGIN
  -- Any existing log id will do; B1 only needs a value that satisfies the FK.
  SELECT id INTO a_log FROM daily_logs ORDER BY created_at LIMIT 1;

  -- B1. Both owners set. num_nonnulls = 2, so the CHECK must refuse.
  BEGIN
    INSERT INTO log_photos (log_id, submission_id, uri)
    VALUES (a_log, gen_random_uuid(), 'probe://both');
    log := log || 'B1 both owners set' || E'\t'
        || 'FAIL: accepted -- a row can belong to a log and a submission at once' || E'\n';
  EXCEPTION WHEN check_violation THEN
    log := log || 'B1 both owners set' || E'\t' || 'refused (23514)' || E'\n';
  WHEN foreign_key_violation THEN
    -- The random submission id has no row. That refusal is the FK, not the
    -- CHECK, so it proves nothing about the constraint under test.
    log := log || 'B1 both owners set' || E'\t'
        || 'INCONCLUSIVE: refused by the FK before the CHECK was reached' || E'\n';
  WHEN OTHERS THEN
    log := log || 'B1 both owners set' || E'\t'
        || 'FAIL (wrong error): ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B2. Neither owner set. num_nonnulls = 0. An orphan row belongs to nobody
  --     and no policy can reach it, so it would be invisible and undeletable.
  BEGIN
    INSERT INTO log_photos (log_id, submission_id, uri)
    VALUES (NULL, NULL, 'probe://neither');
    log := log || 'B2 neither owner set' || E'\t'
        || 'FAIL: accepted -- an orphan row no policy can reach' || E'\n';
  EXCEPTION WHEN check_violation THEN
    log := log || 'B2 neither owner set' || E'\t' || 'refused (23514)' || E'\n';
  WHEN OTHERS THEN
    log := log || 'B2 neither owner set' || E'\t'
        || 'FAIL (wrong error): ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS step,
       split_part(line, E'\t', 2) AS result
FROM unnest(string_to_array(current_setting('probe.results'), E'\n')) AS line
WHERE line <> ''
ORDER BY 1;

ROLLBACK;
