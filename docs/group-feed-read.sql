-- ============================================
-- Group feed: THE read. The single home of list_feed_posts.
--
-- Apply LAST -- after docs/group-feed-migration.sql, docs/group-feed-rpcs.sql,
-- docs/group-feed-assignment-cards.sql and docs/group-feed-attachments.sql
-- (it reads feed_attachments). Idempotent and safe to re-apply. Anonymous
-- dollar-quoting only in the Supabase SQL editor.
--
-- Neither docs/group-feed-rpcs.sql nor docs/group-feed-assignment-cards.sql
-- defines list_feed_posts any more, so the CREATE OR REPLACE below is the one
-- that stands: the committed body plus the 'assignment' key and the
-- 'attachments' key, nothing else. Part A of the verification fails loudly
-- if a stale copy is applied over it.
-- ============================================

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
    ) ELSE NULL END,
    'attachments', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', at.id, 'kind', at.kind, 'target', at.target,
               'name', at.name, 'mime', at.mime, 'size', at.size)
             ORDER BY CASE at.kind WHEN 'photo' THEN 0 WHEN 'document' THEN 1 ELSE 2 END)
      FROM feed_attachments at WHERE at.post_id = p.id), '[]'::jsonb)
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
