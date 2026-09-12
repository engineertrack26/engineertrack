-- ============================================
-- Group feed RPCs. Apply after docs/group-feed-migration.sql.
-- All SECURITY DEFINER; the actor is always auth.uid(), never a parameter.
-- ============================================

-- ---- set_submission_sharing ----
-- The student's per-task decision, changeable at any time. false removes
-- the post (likes and comments cascade); true republishes if approved,
-- through the same function the approval trigger uses.
CREATE OR REPLACE FUNCTION set_submission_sharing(p_submission_id UUID, p_share BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  SELECT student_id INTO v_owner FROM assignment_submissions WHERE id = p_submission_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'SUBMISSION_NOT_FOUND';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_OWNER';
  END IF;

  UPDATE assignment_submissions SET share_to_feed = p_share WHERE id = p_submission_id;

  IF p_share THEN
    PERFORM feed_publish_submission(p_submission_id);
  ELSE
    DELETE FROM feed_posts WHERE submission_id = p_submission_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION set_submission_sharing(UUID, BOOLEAN) TO authenticated;

-- ---- create_feed_post ----
-- Advisor-only. Writes the post, the poll options, and one notification per
-- ACTIVE student in the same transaction -- a client-side notification
-- write failed with 42501 on every call once and a .catch hid it.
CREATE OR REPLACE FUNCTION create_feed_post(
  p_group_id UUID,
  p_kind     TEXT,
  p_body     TEXT,
  p_options  TEXT[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post   UUID;
  v_name   TEXT;
  v_count  INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF NOT owns_group(p_group_id) THEN
    RAISE EXCEPTION 'NOT_GROUP_OWNER';
  END IF;
  IF coalesce(p_kind, '') NOT IN ('announcement', 'poll') THEN
    RAISE EXCEPTION 'KIND_NOT_ALLOWED';
  END IF;
  IF btrim(coalesce(p_body, '')) = '' THEN
    RAISE EXCEPTION 'KIND_NOT_ALLOWED';
  END IF;

  IF p_kind = 'poll' THEN
    SELECT count(*) INTO v_count
    FROM unnest(coalesce(p_options, ARRAY[]::TEXT[])) AS o
    WHERE btrim(o) <> '';
    IF v_count < 2 OR v_count > 6 THEN
      RAISE EXCEPTION 'POLL_OPTIONS_RANGE';
    END IF;
  END IF;

  INSERT INTO feed_posts (group_id, author_id, kind, body)
  VALUES (p_group_id, auth.uid(), p_kind, btrim(p_body))
  RETURNING id INTO v_post;

  IF p_kind = 'poll' THEN
    INSERT INTO feed_poll_options (post_id, position, label)
    SELECT v_post, ord - 1, btrim(o)
    FROM unnest(p_options) WITH ORDINALITY AS u(o, ord)
    WHERE btrim(o) <> '';
  END IF;

  SELECT trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
  INTO v_name FROM profiles p WHERE p.id = auth.uid();

  INSERT INTO notifications (user_id, title, body, type, data)
  SELECT m.student_id,
         CASE WHEN p_kind = 'poll' THEN 'New poll' ELSE 'New announcement' END,
         coalesce(nullif(v_name, ''), 'Your advisor')
           || CASE WHEN p_kind = 'poll' THEN ' asked: ' ELSE ' posted: ' END
           || left(btrim(p_body), 80),
         CASE WHEN p_kind = 'poll' THEN 'feed_poll' ELSE 'feed_announcement' END,
         jsonb_build_object('postId', v_post, 'groupId', p_group_id)
  FROM group_memberships m
  WHERE m.group_id = p_group_id AND m.left_at IS NULL;

  RETURN v_post;
END;
$$;
GRANT EXECUTE ON FUNCTION create_feed_post(UUID, TEXT, TEXT, TEXT[]) TO authenticated;

-- ---- vote_feed_poll ----
-- One vote per person per poll; voting again moves it.
CREATE OR REPLACE FUNCTION vote_feed_poll(p_post_id UUID, p_option_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group UUID;
  v_kind  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  SELECT group_id, kind INTO v_group, v_kind FROM feed_posts WHERE id = p_post_id;
  IF v_group IS NULL OR v_kind <> 'poll' THEN
    RAISE EXCEPTION 'POST_NOT_FOUND';
  END IF;
  IF NOT (owns_group(v_group) OR is_member_of_group(v_group)) THEN
    RAISE EXCEPTION 'NOT_IN_GROUP';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM feed_poll_options WHERE id = p_option_id AND post_id = p_post_id) THEN
    RAISE EXCEPTION 'OPTION_MISMATCH';
  END IF;

  INSERT INTO feed_poll_votes (post_id, option_id, user_id)
  VALUES (p_post_id, p_option_id, auth.uid())
  ON CONFLICT (post_id, user_id) DO UPDATE
    SET option_id = EXCLUDED.option_id, created_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION vote_feed_poll(UUID, UUID) TO authenticated;

-- ---- remove_feed_post ----
-- Advisor moderation. For a task post the student's sharing flag is turned
-- off as well, so the removal cannot be undone by the switch reading "on".
CREATE OR REPLACE FUNCTION remove_feed_post(p_post_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group      UUID;
  v_submission UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  SELECT group_id, submission_id INTO v_group, v_submission FROM feed_posts WHERE id = p_post_id;
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'POST_NOT_FOUND';
  END IF;
  IF NOT owns_group(v_group) THEN
    RAISE EXCEPTION 'NOT_GROUP_OWNER';
  END IF;
  IF v_submission IS NOT NULL THEN
    UPDATE assignment_submissions SET share_to_feed = false WHERE id = v_submission;
  END IF;
  DELETE FROM feed_posts WHERE id = p_post_id;
END;
$$;
GRANT EXECUTE ON FUNCTION remove_feed_post(UUID) TO authenticated;

-- ---- list_feed_posts ----
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
