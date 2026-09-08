-- ============================================
-- Assignment drafts: the advisor prepares before sending
--
-- Idempotent and safe to re-apply.
-- ============================================

-- published_at IS NULL means draft. A timestamp rather than a status enum
-- because it also records WHEN a task was sent, which nothing captures today.
--
-- The ALTER and the backfill are bound together inside one guard keyed on
-- the column's own existence, so the backfill can only ever run on the first
-- application. A blanket `WHERE published_at IS NULL` would be correct today
-- and destructive later: once drafts exist, a NULL published_at IS a draft,
-- and re-applying this file would silently publish every draft an advisor
-- was still preparing -- unfinished work sent to students, no error anywhere.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'group_assignments' AND column_name = 'published_at'
  ) THEN
    ALTER TABLE group_assignments ADD COLUMN published_at TIMESTAMPTZ;

    -- Backfilled HERE, inside the block that creates the column, so it runs
    -- once and only once. Every assignment that already exists was sent the
    -- moment it was created; created_at is the closest true record of when.
    -- Without this the new read policy hides the entire live catalogue from
    -- every student and mentor at once -- the app looks empty, not broken.
    UPDATE group_assignments SET published_at = created_at;
  END IF;
END $$;

-- The storage PATH, not a URL. getPublicUrl on a private bucket is a dead link
-- and a signed URL expires -- both already cost this branch a bug. The path is
-- the durable part; signing happens at read time. No backfill needed -- these
-- two are plain nullable columns with no existing meaning to preserve, so
-- re-adding them is harmless.
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS document_path TEXT;
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS document_name TEXT;

-- ============================================
-- The read policy: drafts are invisible to everyone but their author
-- ============================================

-- Drafts are invisible to everyone but their author, and that is enforced
-- here rather than by a filter on a screen: a client-side filter would leave
-- the rows readable to anything else that queries this table.
DROP POLICY IF EXISTS "assignments read" ON group_assignments;
CREATE POLICY "assignments read" ON group_assignments
  FOR SELECT TO authenticated USING (
    owns_group(group_id)
    OR (published_at IS NOT NULL
        AND (is_member_of_group(group_id) OR mentors_a_member_of_group(group_id)))
  );

-- Insert, update and delete policies on group_assignments are left exactly
-- as they are -- only the SELECT policy changes.

-- ============================================
-- The bucket: assignment documents the advisor attaches to a task
-- ============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('assignment-docs', 'assignment-docs', false)
ON CONFLICT (id) DO NOTHING;

-- The path is <groupId>/<assignmentId>/<timestamp>_<filename> -- the group id
-- first, because a storage policy can only reason about the object's path and
-- cannot join to a row. That single fact is why the three existing group
-- helpers work here unchanged.
--
-- Do not reuse log-documents: its read policy requires the first path segment
-- to be the reader's own uid, so a student could never open a file the
-- advisor uploaded. This bucket exists because that constraint does not fit
-- an advisor-authored, group-shared document.

-- The group id is the FIRST path segment on purpose: a storage policy sees the
-- object name and nothing else, so anything it must decide has to be in the
-- path. With the group there, owns_group / is_member_of_group /
-- mentors_a_member_of_group answer directly.
DROP POLICY IF EXISTS "assignment_docs_upload" ON storage.objects;
CREATE POLICY "assignment_docs_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'assignment-docs'
    AND auth.role() = 'authenticated'
    AND owns_group((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "assignment_docs_read" ON storage.objects;
CREATE POLICY "assignment_docs_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'assignment-docs'
    AND auth.role() = 'authenticated'
    AND (
      owns_group((storage.foldername(name))[1]::uuid)
      OR is_member_of_group((storage.foldername(name))[1]::uuid)
      OR mentors_a_member_of_group((storage.foldername(name))[1]::uuid)
    )
  );

DROP POLICY IF EXISTS "assignment_docs_delete" ON storage.objects;
CREATE POLICY "assignment_docs_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'assignment-docs'
    AND owns_group((storage.foldername(name))[1]::uuid)
  );

-- A malformed path whose first segment is not a UUID makes the ::uuid cast
-- raise rather than return false. That is the safe direction -- the write is
-- refused -- and the only writer is our own uploader, which always leads with
-- a real group id.
