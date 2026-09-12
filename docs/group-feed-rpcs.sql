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
-- Lives in docs/group-feed-attachments.sql since attachments were added
-- (a fifth parameter, p_attachments); apply that file after this one.

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
-- lives in docs/group-feed-assignment-cards.sql since the 'assignment' kind
-- was added; apply that file after this one. One copy, one file that stands.
