-- ============================================
-- Group feed: announcement attachments, plus the classmate evidence-read fix.
--
-- An announcement may carry up to ONE photo, ONE document and ONE link.
-- Files live in a new private bucket, feed-attachments, keyed by group id;
-- the rows live in feed_attachments and cascade with the post.
--
-- Also here: a classmate viewing a shared task post could not sign its
-- photo (log_photos_read / log_documents_read allowed only the owner, their
-- mentor and their advisor). Both read policies are re-created with a
-- fourth disjunct that lives exactly as long as the feed post does.
--
-- Idempotent and safe to re-apply. Apply AFTER docs/group-feed-migration.sql,
-- docs/group-feed-rpcs.sql and docs/group-feed-assignment-cards.sql, and
-- BEFORE docs/group-feed-read.sql (list_feed_posts reads feed_attachments).
-- Anonymous dollar-quoting only in the Supabase SQL editor.
-- ============================================

-- ---- The bucket and its policies -- same shape as assignment-docs ----
INSERT INTO storage.buckets (id, name, public)
VALUES ('feed-attachments', 'feed-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Path: <groupId>/<random>/<filename>. The group id leads because a storage
-- policy can only reason about the object's path.
DROP POLICY IF EXISTS "feed_attachments_upload" ON storage.objects;
CREATE POLICY "feed_attachments_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'feed-attachments'
    AND auth.role() = 'authenticated'
    AND owns_group((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "feed_attachments_read" ON storage.objects;
CREATE POLICY "feed_attachments_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'feed-attachments'
    AND auth.role() = 'authenticated'
    AND (owns_group((storage.foldername(name))[1]::uuid)
         OR is_member_of_group((storage.foldername(name))[1]::uuid))
  );

DROP POLICY IF EXISTS "feed_attachments_delete" ON storage.objects;
CREATE POLICY "feed_attachments_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'feed-attachments'
    AND owns_group((storage.foldername(name))[1]::uuid)
  );

-- ---- feed_attachments ----
CREATE TABLE IF NOT EXISTS feed_attachments (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id  UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('photo', 'document', 'link')),
  -- storage path for photo/document (bucket feed-attachments); the URL for link
  target   TEXT NOT NULL CHECK (char_length(target) BETWEEN 1 AND 2000),
  name     TEXT CHECK (name IS NULL OR char_length(name) <= 200),
  mime     TEXT,
  size     INTEGER,
  -- one of each kind per post -- the whole limit, stated structurally
  UNIQUE (post_id, kind)
);
-- A link is an http(s) URL with a host, or it is not a link: the card opens
-- whatever this column holds, so javascript:/file:/bare words are refused
-- at the row, not only by the composer.
ALTER TABLE feed_attachments DROP CONSTRAINT IF EXISTS feed_attachments_link_is_http;
ALTER TABLE feed_attachments ADD CONSTRAINT feed_attachments_link_is_http
  CHECK (kind <> 'link' OR target ~* '^https?://[^/[:space:]]+');
ALTER TABLE feed_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feed_attachments_select ON feed_attachments;
CREATE POLICY feed_attachments_select ON feed_attachments FOR SELECT TO authenticated
  USING (can_see_post(post_id));
-- No INSERT/UPDATE/DELETE policy: create_feed_post writes rows; the post's
-- cascade removes them.

-- ---- The classmate evidence-read fix ----
-- True when the object at <student>/<assignment>/... belongs to a submission
-- that currently has a feed post in a group the caller is a member of.
-- Access lives exactly as long as the post: withdraw it and this is false.
CREATE OR REPLACE FUNCTION feed_shares_evidence(p_student UUID, p_assignment UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM feed_posts p
    JOIN assignment_submissions s ON s.id = p.submission_id
    WHERE s.student_id = p_student
      AND s.assignment_id = p_assignment
      AND (owns_group(p.group_id) OR is_member_of_group(p.group_id))
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
GRANT EXECUTE ON FUNCTION feed_shares_evidence(UUID, UUID) TO authenticated;

-- log_photos_read / log_documents_read, as in docs/database-schema.sql
-- (owner, their mentor, their advisor) plus the classmate branch. The regex
-- guards matter: the daily-log era stored <userId>/<logId>/... and some
-- paths may have a non-uuid second segment; a bare ::uuid cast on those
-- would raise 22P02 inside the policy and break every read. The strict
-- 8-4-4-4-12 shape is what guarantees the cast cannot raise: a loose
-- '[0-9a-f-]{36}' admits 'aa-aaaa...' which ::uuid still rejects.
DROP POLICY IF EXISTS "log_photos_read" ON storage.objects;
CREATE POLICY "log_photos_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'log-photos'
    AND auth.role() = 'authenticated'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR is_mentor_of((storage.foldername(name))[1]::uuid)
      OR is_advisor_of((storage.foldername(name))[1]::uuid)
      OR (
        array_length(storage.foldername(name), 1) >= 2
        AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND feed_shares_evidence((storage.foldername(name))[1]::uuid, (storage.foldername(name))[2]::uuid)
      )
    )
  );

DROP POLICY IF EXISTS "log_documents_read" ON storage.objects;
CREATE POLICY "log_documents_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'log-documents'
    AND auth.role() = 'authenticated'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR is_mentor_of((storage.foldername(name))[1]::uuid)
      OR is_advisor_of((storage.foldername(name))[1]::uuid)
      OR (
        array_length(storage.foldername(name), 1) >= 2
        AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND feed_shares_evidence((storage.foldername(name))[1]::uuid, (storage.foldername(name))[2]::uuid)
      )
    )
  );

-- ---- create_feed_post ----
-- Lives in docs/group-feed-drafts.sql since drafts were added (a sixth
-- parameter, p_draft); apply that file after this one.
