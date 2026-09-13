-- ============================================
-- Group feed: drafts for announcements and polls.
--
-- The advisor can save an announcement or poll as a DRAFT and publish it
-- later. A draft is a feed_posts row with published_at IS NULL. Students
-- never see drafts -- nor their comments, likes, votes or attachments.
-- Task posts and assignment cards are published the instant they are
-- created. Notifications move from creation time to PUBLISH time, so a
-- draft notifies nobody until it is published, and then exactly once.
-- No scheduling.
--
-- Idempotent and safe to re-apply. Apply AFTER docs/group-feed-migration.sql,
-- docs/group-feed-rpcs.sql, docs/group-feed-assignment-cards.sql and
-- docs/group-feed-attachments.sql, and BEFORE docs/group-feed-read.sql
-- (list_feed_posts reads published_at). Anonymous dollar-quoting only in
-- the Supabase SQL editor.
-- ============================================

-- ---- The column, backfilled once ----
-- NULL = draft, visible to the group's advisor only. Every row that existed
-- before this column was published the moment it was created, so the
-- backfill is bound to the column's creation and cannot run twice: a second
-- apply would otherwise re-publish every draft.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'feed_posts' AND column_name = 'published_at') THEN
    ALTER TABLE feed_posts ADD COLUMN published_at TIMESTAMPTZ;
    UPDATE feed_posts SET published_at = created_at;
  END IF;
END $$;

-- feed_publish_submission (docs/group-feed-migration.sql) and
-- feed_publish_assignment (docs/group-feed-assignment-cards.sql) insert
-- into feed_posts without naming published_at, and neither file changes.
-- The default publishes; only create_feed_post ever writes NULL.
ALTER TABLE feed_posts ALTER COLUMN published_at SET DEFAULT now();

-- Task posts and assignment cards are never drafts.
ALTER TABLE feed_posts DROP CONSTRAINT IF EXISTS feed_posts_auto_kinds_published;
ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_auto_kinds_published
  CHECK (kind IN ('announcement', 'poll') OR published_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_feed_posts_group_published
  ON feed_posts(group_id, published_at DESC) WHERE published_at IS NOT NULL;

-- ---- The visibility rule -- the one place it changes ----
-- The owner sees every post of their group; a member sees only published
-- ones. Comments, likes, votes and attachments all route through
-- can_see_post, so they inherit this without change. feed_shares_evidence
-- (docs/group-feed-attachments.sql) joins feed_posts for TASK posts, which
-- are always published -- no change needed there.
CREATE OR REPLACE FUNCTION can_see_post(p_post_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM feed_posts p
    WHERE p.id = p_post_id
      AND (owns_group(p.group_id)
           OR (is_member_of_group(p.group_id) AND p.published_at IS NOT NULL))
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
GRANT EXECUTE ON FUNCTION can_see_post(UUID) TO authenticated;

DROP POLICY IF EXISTS feed_posts_select ON feed_posts;
CREATE POLICY feed_posts_select ON feed_posts FOR SELECT TO authenticated
  USING (owns_group(group_id)
         OR (is_member_of_group(group_id) AND published_at IS NOT NULL));

-- ---- Publishing -- one function, one notification ----
-- Marks a post published and notifies the group's active students, once.
-- Called by create_feed_post (post now) and publish_feed_post (draft ->
-- now). Idempotent: an already-published post is left alone and nobody
-- is notified again.
CREATE OR REPLACE FUNCTION feed_publish_post(p_post_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group UUID; v_kind TEXT; v_body TEXT; v_author UUID; v_name TEXT; v_published TIMESTAMPTZ;
BEGIN
  SELECT group_id, kind, body, author_id, published_at
  INTO v_group, v_kind, v_body, v_author, v_published
  FROM feed_posts WHERE id = p_post_id;
  IF v_group IS NULL OR v_published IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE feed_posts SET published_at = now() WHERE id = p_post_id;

  SELECT trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
  INTO v_name FROM profiles p WHERE p.id = v_author;

  INSERT INTO notifications (user_id, title, body, type, data)
  SELECT m.student_id,
         CASE WHEN v_kind = 'poll' THEN 'New poll' ELSE 'New announcement' END,
         coalesce(nullif(v_name, ''), 'Your advisor')
           || CASE WHEN v_kind = 'poll' THEN ' asked: ' ELSE ' posted: ' END
           || left(btrim(coalesce(v_body, '')), 80),
         CASE WHEN v_kind = 'poll' THEN 'feed_poll' ELSE 'feed_announcement' END,
         jsonb_build_object('postId', p_post_id, 'groupId', v_group)
  FROM group_memberships m
  WHERE m.group_id = v_group AND m.left_at IS NULL;
END;
$$;
-- Not granted to authenticated: only create_feed_post and publish_feed_post
-- (both SECURITY DEFINER, both owner-checked) call it.
REVOKE EXECUTE ON FUNCTION feed_publish_post(UUID) FROM PUBLIC, authenticated;

-- ---- create_feed_post, re-issued with p_draft ----
-- Moved here from docs/group-feed-attachments.sql (which keeps a pointer).
-- The five-parameter overload is dropped first: a defaulted sixth parameter
-- beside it would make every existing call ambiguous. Body otherwise
-- verbatim, with two changes: the row is ALWAYS inserted with
-- published_at = NULL, and the notification block is replaced by a call to
-- feed_publish_post when this is not a draft -- so "post now" and
-- "publish the draft later" are the same code path.
DROP FUNCTION IF EXISTS create_feed_post(UUID, TEXT, TEXT, TEXT[], JSONB);

CREATE OR REPLACE FUNCTION create_feed_post(
  p_group_id     UUID,
  p_kind         TEXT,
  p_body         TEXT,
  p_options      TEXT[]  DEFAULT NULL,
  p_attachments  JSONB   DEFAULT '[]'::jsonb,
  p_draft        BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post   UUID;
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

  -- Always unpublished here; feed_publish_post sets published_at below for
  -- "post now", so a draft and an immediate post differ only in that call.
  INSERT INTO feed_posts (group_id, author_id, kind, body, published_at)
  VALUES (p_group_id, auth.uid(), p_kind, btrim(p_body), NULL)
  RETURNING id INTO v_post;

  IF p_kind = 'poll' THEN
    INSERT INTO feed_poll_options (post_id, position, label)
    SELECT v_post, ord - 1, btrim(o)
    FROM unnest(p_options) WITH ORDINALITY AS u(o, ord)
    WHERE btrim(o) <> '';
  END IF;

  -- Attachments: announcements only, at most one of each kind. The UNIQUE
  -- (post_id, kind) is the structural backstop; this is the named refusal.
  IF jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 THEN
    IF p_kind <> 'announcement' THEN
      RAISE EXCEPTION 'KIND_NOT_ALLOWED';
    END IF;
    IF (SELECT count(*) FROM jsonb_to_recordset(p_attachments) AS a(kind TEXT) WHERE a.kind = 'photo') > 1
       OR (SELECT count(*) FROM jsonb_to_recordset(p_attachments) AS a(kind TEXT) WHERE a.kind = 'document') > 1
       OR (SELECT count(*) FROM jsonb_to_recordset(p_attachments) AS a(kind TEXT) WHERE a.kind = 'link') > 1 THEN
      RAISE EXCEPTION 'ATTACHMENT_LIMIT';
    END IF;
    INSERT INTO feed_attachments (post_id, kind, target, name, mime, size)
    SELECT v_post, a.kind, a.target, a.name, a.mime, a.size
    FROM jsonb_to_recordset(p_attachments)
         AS a(kind TEXT, target TEXT, name TEXT, mime TEXT, size INTEGER)
    WHERE a.kind IN ('photo', 'document', 'link') AND a.target IS NOT NULL;
  END IF;

  IF NOT p_draft THEN
    PERFORM feed_publish_post(v_post);
  END IF;

  RETURN v_post;
END;
$$;
GRANT EXECUTE ON FUNCTION create_feed_post(UUID, TEXT, TEXT, TEXT[], JSONB, BOOLEAN) TO authenticated;

-- ---- Draft management ----
-- Publish a draft now. Owner-checked; a second call is a no-op because
-- feed_publish_post leaves an already-published post alone.
CREATE OR REPLACE FUNCTION publish_feed_post(p_post_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_group UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT group_id INTO v_group FROM feed_posts WHERE id = p_post_id;
  IF v_group IS NULL THEN RAISE EXCEPTION 'POST_NOT_FOUND'; END IF;
  IF NOT owns_group(v_group) THEN RAISE EXCEPTION 'NOT_GROUP_OWNER'; END IF;
  PERFORM feed_publish_post(p_post_id);
END;
$$;
GRANT EXECUTE ON FUNCTION publish_feed_post(UUID) TO authenticated;

-- The advisor's unpublished posts for one group, newest first. Same JSON
-- shape as list_feed_posts (body, poll options, attachments), so the client
-- renders them with the same card.
CREATE OR REPLACE FUNCTION list_feed_pending(p_group_id UUID)
RETURNS SETOF JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT owns_group(p_group_id) THEN RAISE EXCEPTION 'NOT_GROUP_OWNER'; END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'groupId', p.group_id, 'authorId', p.author_id,
    'authorName', trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')),
    'body', p.body, 'createdAt', p.created_at, 'draft', true,
    'likeCount', 0, 'commentCount', 0, 'likedByMe', false, 'task', NULL, 'assignment', NULL,
    'poll', CASE WHEN p.kind = 'poll' THEN jsonb_build_object(
      'options', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'position', o.position, 'votes', 0) ORDER BY o.position)
                           FROM feed_poll_options o WHERE o.post_id = p.id), '[]'::jsonb),
      'totalVotes', 0, 'myOptionId', NULL) ELSE NULL END,
    'attachments', coalesce((SELECT jsonb_agg(jsonb_build_object('id', fa.id, 'kind', fa.kind, 'target', fa.target, 'name', fa.name, 'mime', fa.mime, 'size', fa.size)
                                              ORDER BY CASE fa.kind WHEN 'photo' THEN 0 WHEN 'document' THEN 1 ELSE 2 END)
                             FROM feed_attachments fa WHERE fa.post_id = p.id), '[]'::jsonb)
  )
  FROM feed_posts p JOIN profiles pr ON pr.id = p.author_id
  WHERE p.group_id = p_group_id AND p.published_at IS NULL
  ORDER BY p.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION list_feed_pending(UUID) TO authenticated;

-- Deleting a draft is remove_feed_post (docs/group-feed-rpcs.sql, already
-- owner-checked) -- no new RPC.
