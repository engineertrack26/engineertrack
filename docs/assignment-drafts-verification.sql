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
