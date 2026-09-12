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
-- This file holds THE copy of list_feed_posts: docs/group-feed-rpcs.sql no
-- longer defines it, so the CREATE OR REPLACE below is the one that stands
-- (the committed body plus the 'assignment' key, nothing else).
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
-- The only definition. The pre-assignment body from docs/group-feed-rpcs.sql
-- plus the one 'assignment' entry after 'poll'. Same signature, same GRANT.
-- THE read. SECURITY DEFINER because a student cannot select a classmate's
-- assignment_submissions / log_photos / log_documents rows, and widening
-- those policies would expose the reflection and the mentor's note. This
-- function projects exactly the shared fields and nothing else.
CREATE OR REPLACE FUNCTION list_feed_posts(
  p_group_id UUID,
  p_before   TIMESTAMPTZ DEFAULT NULL,
  p_limit    INT DEFAULT 20
)
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF NOT (owns_group(p_group_id) OR is_member_of_group(p_group_id)) THEN
    RAISE EXCEPTION 'NOT_IN_GROUP';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id',           p.id,
    'kind',         p.kind,
    'groupId',      p.group_id,
    'authorId',     p.author_id,
    'authorName',   trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')),
    'body',         p.body,
    'createdAt',    p.created_at,
    'likeCount',    (SELECT count(*) FROM feed_likes l WHERE l.post_id = p.id),
    'commentCount', (SELECT count(*) FROM feed_comments c WHERE c.post_id = p.id),
    'likedByMe',    EXISTS (SELECT 1 FROM feed_likes l WHERE l.post_id = p.id AND l.user_id = auth.uid()),
    'task', CASE WHEN p.kind = 'task' THEN (
      SELECT jsonb_build_object(
        'submissionId',   s.id,
        'title',          a.title,
        'competencyName', c.name,
        'level',          k.level,
        'note',           s.student_note,
        'photos', coalesce((
          SELECT jsonb_agg(jsonb_build_object('uri', ph.uri, 'caption', ph.caption) ORDER BY ph.created_at)
          FROM log_photos ph WHERE ph.submission_id = s.id), '[]'::jsonb),
        'documents', coalesce((
          SELECT jsonb_agg(jsonb_build_object('uri', d.uri, 'fileName', d.file_name,
                                              'fileType', d.file_type, 'fileSize', d.file_size)
                           ORDER BY d.created_at)
          FROM log_documents d WHERE d.submission_id = s.id), '[]'::jsonb)
      )
      FROM assignment_submissions s
      JOIN group_assignments a ON a.id = s.assignment_id
      LEFT JOIN kpi_triplets tr ON tr.id = a.triplet_id
      LEFT JOIN competency_kpis k ON k.id = tr.kpi_id
      LEFT JOIN competencies c ON c.id = k.competency_id
      WHERE s.id = p.submission_id
    ) ELSE NULL END,
    'poll', CASE WHEN p.kind = 'poll' THEN jsonb_build_object(
      'options', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', o.id, 'label', o.label, 'position', o.position,
                 'votes', (SELECT count(*) FROM feed_poll_votes v WHERE v.option_id = o.id))
               ORDER BY o.position)
        FROM feed_poll_options o WHERE o.post_id = p.id), '[]'::jsonb),
      'totalVotes', (SELECT count(*) FROM feed_poll_votes v WHERE v.post_id = p.id),
      'myOptionId', (SELECT v.option_id FROM feed_poll_votes v
                     WHERE v.post_id = p.id AND v.user_id = auth.uid())
    ) ELSE NULL END,
    'assignment', CASE WHEN p.kind = 'assignment' THEN (
      SELECT jsonb_build_object(
        'id',             a.id,
        'title',          a.title,
        'competencyName', c.name,
        'level',          k.level,
        'dueDate',        a.due_date
      )
      FROM group_assignments a
      LEFT JOIN kpi_triplets tr ON tr.id = a.triplet_id
      LEFT JOIN competency_kpis k ON k.id = tr.kpi_id
      LEFT JOIN competencies c ON c.id = k.competency_id
      WHERE a.id = p.assignment_id
    ) ELSE NULL END
  )
  FROM feed_posts p
  JOIN profiles pr ON pr.id = p.author_id
  WHERE p.group_id = p_group_id
    AND (p_before IS NULL OR p.created_at < p_before)
  ORDER BY p.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 50));
END;
$$;
GRANT EXECUTE ON FUNCTION list_feed_posts(UUID, TIMESTAMPTZ, INT) TO authenticated;
