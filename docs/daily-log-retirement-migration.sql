-- ============================================
-- Subsystem D: the daily log retires
--
-- Evidence moves onto the task submission by giving log_photos and
-- log_documents a second possible owner. The upload service, the picker
-- components and BOTH STORAGE BUCKETS are reused unchanged -- the bucket
-- policies key on (storage.foldername(name))[1] = auth.uid()::text and never
-- mention logs, so nothing there needs touching.
--
-- Idempotent and safe to re-apply.
-- ============================================

-- ---- assignment_submissions.reflection ----
--
-- Nullable on purpose. Existing submissions genuinely have no reflection, and
-- a NOT NULL DEFAULT '' would satisfy the constraint while meaning nothing.
-- The requirement is enforced in submit_assignment, where btrim can be
-- applied and a blank can be refused with a name.
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS reflection TEXT;

-- ---- log_photos ----
ALTER TABLE log_photos ALTER COLUMN log_id DROP NOT NULL;

ALTER TABLE log_photos ADD COLUMN IF NOT EXISTS submission_id UUID
  REFERENCES assignment_submissions(id) ON DELETE CASCADE;

-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres, so re-applying this file
-- would fail with 42710 without the drop.
ALTER TABLE log_photos DROP CONSTRAINT IF EXISTS log_photos_one_owner;
ALTER TABLE log_photos ADD CONSTRAINT log_photos_one_owner
  CHECK (num_nonnulls(log_id, submission_id) = 1);

CREATE INDEX IF NOT EXISTS idx_log_photos_submission
  ON log_photos(submission_id);

-- ---- log_documents ----
ALTER TABLE log_documents ALTER COLUMN log_id DROP NOT NULL;

ALTER TABLE log_documents ADD COLUMN IF NOT EXISTS submission_id UUID
  REFERENCES assignment_submissions(id) ON DELETE CASCADE;

ALTER TABLE log_documents DROP CONSTRAINT IF EXISTS log_documents_one_owner;
ALTER TABLE log_documents ADD CONSTRAINT log_documents_one_owner
  CHECK (num_nonnulls(log_id, submission_id) = 1);

CREATE INDEX IF NOT EXISTS idx_log_documents_submission
  ON log_documents(submission_id);

-- ---- Policies: a second owner means a second branch ----
--
-- The submission branch is deliberately just
--   EXISTS (SELECT 1 FROM assignment_submissions s WHERE s.id = submission_id)
-- with no role logic of its own. A policy subquery is evaluated under the
-- REFERENCED table's RLS -- the behaviour that produced 42P17 on this branch
-- in August. Here it works for us: the rule reads "you can see the evidence if
-- you can see the submission", and assignment_submissions' own SELECT policy
-- already resolves student, mentor and advisor. There is no recursion, because
-- that policy never looks at log_photos or log_documents.

DROP POLICY IF EXISTS "log_photos_select" ON log_photos;
CREATE POLICY "log_photos_select" ON log_photos
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND (daily_logs.student_id = auth.uid()
        OR is_mentor_of(daily_logs.student_id)
        OR is_advisor_of(daily_logs.student_id)))
    OR EXISTS (SELECT 1 FROM assignment_submissions s WHERE s.id = submission_id)
  );

DROP POLICY IF EXISTS "log_photos_insert" ON log_photos;
CREATE POLICY "log_photos_insert" ON log_photos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid())
    OR EXISTS (SELECT 1 FROM assignment_submissions s
      WHERE s.id = submission_id
        AND s.student_id = auth.uid()
        AND s.status <> 'approved')
  );

DROP POLICY IF EXISTS "log_photos_delete" ON log_photos;
CREATE POLICY "log_photos_delete" ON log_photos
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid()
      AND daily_logs.status IN ('draft', 'needs_revision'))
    OR EXISTS (SELECT 1 FROM assignment_submissions s
      WHERE s.id = submission_id
        AND s.student_id = auth.uid()
        AND s.status <> 'approved')
  );

DROP POLICY IF EXISTS "log_documents_select" ON log_documents;
CREATE POLICY "log_documents_select" ON log_documents
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND (daily_logs.student_id = auth.uid()
        OR is_mentor_of(daily_logs.student_id)
        OR is_advisor_of(daily_logs.student_id)))
    OR EXISTS (SELECT 1 FROM assignment_submissions s WHERE s.id = submission_id)
  );

DROP POLICY IF EXISTS "log_documents_insert" ON log_documents;
CREATE POLICY "log_documents_insert" ON log_documents
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid())
    OR EXISTS (SELECT 1 FROM assignment_submissions s
      WHERE s.id = submission_id
        AND s.student_id = auth.uid()
        AND s.status <> 'approved')
  );

DROP POLICY IF EXISTS "log_documents_delete" ON log_documents;
CREATE POLICY "log_documents_delete" ON log_documents
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM daily_logs WHERE daily_logs.id = log_id
      AND daily_logs.student_id = auth.uid()
      AND daily_logs.status IN ('draft', 'needs_revision'))
    OR EXISTS (SELECT 1 FROM assignment_submissions s
      WHERE s.id = submission_id
        AND s.student_id = auth.uid()
        AND s.status <> 'approved')
  );
