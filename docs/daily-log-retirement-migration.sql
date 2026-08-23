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
--
-- Apply order: this file first, then docs/daily-log-retirement-rpcs.sql, then
-- docs/daily-log-retirement-verification.sql. Applying the RPC file before
-- this one succeeds anyway -- a plpgsql body is not catalog-resolved at
-- CREATE FUNCTION time -- and then fails at runtime on the first submission,
-- because the old three-argument submit_assignment gets dropped while
-- reflection and the new evidence columns do not exist yet.
-- ============================================

-- ---- assignment_submissions.reflection ----
--
-- Nullable on purpose. Existing submissions genuinely have no reflection, and
-- a NOT NULL DEFAULT '' would satisfy the constraint while meaning nothing.
-- The requirement is enforced in submit_assignment, where btrim can be
-- applied and a blank can be refused with a name.
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS reflection TEXT;

-- ---- student_profiles streak counters are being redefined from days to weeks ----
--
-- current_streak used to count consecutive DAYS with a daily log; submit_assignment
-- now writes consecutive WEEKS into the same column. Every existing row still
-- holds a day count, and nothing converts it: a student sitting on
-- current_streak = 6 from daily logs would read as a 6-week streak after a
-- single task submission, hit 7 on the next one, and be awarded streak_30
-- ("Submit a task 8 weeks running") after just two task submissions.
--
-- Both columns are reset, not just current_streak. longest_streak is fed by
-- longest_streak = GREATEST(longest_streak, v_streak); left holding a
-- day-scaled value, GREATEST would pin that maximum forever and a real week
-- streak could never exceed it and surface. This UPDATE is naturally
-- idempotent -- once every row is 0, re-running it changes nothing.
UPDATE student_profiles SET current_streak = 0, longest_streak = 0;

-- ---- trg_daily_logs_gamification retires along with daily_logs writes ----
--
-- This trigger (docs/gamification-server-side-migration.sql) still writes
-- student_profiles.current_streak in DAYS on every daily_logs insert, while
-- submit_assignment above writes the same column in WEEKS. Neither writer can
-- detect the other, so leaving both installed reintroduces the exact bug the
-- reset above just fixed. D1's SQL is applied only after D2 has deleted the
-- daily-log screens (see the apply-order note at the top of this file), so by
-- the time this runs nothing can insert into daily_logs any more and the
-- trigger has no legitimate work left to do. No CASCADE: only the trigger is
-- being retired. handle_log_gamification() itself is left in the catalog,
-- unreferenced -- dropping the function is not needed to stop the double-write.
DROP TRIGGER IF EXISTS trg_daily_logs_gamification ON daily_logs;

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
