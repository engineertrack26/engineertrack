-- ============================================
-- Group feed: a card in the stream for every task the advisor publishes.
--
-- When group_assignments.published_at goes from NULL to a timestamp, one
-- 'assignment' post appears in that group's feed, authored by the advisor
-- (created_by). Students open the task from the card and ask questions in
-- its comments. No notification is sent here: task_assigned already covers
-- the publish.
--
-- Idempotent and safe to re-apply. Apply AFTER docs/assignment-drafts-migration.sql
-- (it adds group_assignments.published_at, which the trigger below is
-- keyed on -- without it CREATE TRIGGER fails with 42703),
-- docs/group-feed-migration.sql and docs/group-feed-rpcs.sql. Anonymous
-- dollar-quoting only in the Supabase SQL editor.
--
-- list_feed_posts no longer lives here: docs/group-feed-read.sql holds the
-- one copy that stands (the committed body plus the 'assignment' and
-- 'attachments' keys) and is applied last.
-- ============================================

-- ---- feed_posts gains the 'assignment' kind ----
-- The inline CHECK on the kind column carries the auto name
-- feed_posts_kind_check; it is re-stated with the fourth kind.
ALTER TABLE feed_posts DROP CONSTRAINT IF EXISTS feed_posts_kind_check;
ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_kind_check
  CHECK (kind IN ('task', 'announcement', 'poll', 'assignment'));

ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS assignment_id UUID
  UNIQUE REFERENCES group_assignments(id) ON DELETE CASCADE;

-- An assignment post is exactly a post with an assignment; the other kinds
-- have none. Same one-equality shape as feed_posts_task_has_submission.
ALTER TABLE feed_posts DROP CONSTRAINT IF EXISTS feed_posts_assignment_has_assignment;
ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_assignment_has_assignment
  CHECK ((kind = 'assignment') = (assignment_id IS NOT NULL));

-- ---- publish -> post. Same shape as the approval trigger. ----
-- created_by is the advisor who wrote the draft; owns_group at publish time
-- already guarantees it is the group's advisor. Nothing here can RAISE on
-- the publish path: the SELECT INTO is non-strict, the INSERT's FKs are
-- satisfied by construction and the UNIQUE is guarded by the EXISTS.
CREATE OR REPLACE FUNCTION feed_publish_assignment(p_assignment_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group   UUID;
  v_author  UUID;
  v_post    UUID;
BEGIN
  SELECT a.group_id, a.created_by INTO v_group, v_author
  FROM group_assignments a WHERE a.id = p_assignment_id AND a.published_at IS NOT NULL;
  IF v_group IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM feed_posts WHERE assignment_id = p_assignment_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO feed_posts (group_id, author_id, kind, assignment_id)
  VALUES (v_group, v_author, 'assignment', p_assignment_id)
  RETURNING id INTO v_post;
  RETURN v_post;
END;
$$;
-- Not granted to authenticated: only the trigger below (SECURITY DEFINER,
-- owner-run) calls it.
REVOKE EXECUTE ON FUNCTION feed_publish_assignment(UUID) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION trg_feed_assignment_post_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM feed_publish_assignment(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_assignment_post ON group_assignments;
CREATE TRIGGER trg_feed_assignment_post
  AFTER UPDATE OF published_at ON group_assignments
  FOR EACH ROW
  WHEN (NEW.published_at IS NOT NULL AND OLD.published_at IS NULL)
  EXECUTE FUNCTION trg_feed_assignment_post_fn();

-- ---- list_feed_posts ----
-- Lives in docs/group-feed-read.sql since attachments were added; that file
-- is applied last. Part A fails loudly if a stale copy is applied.
