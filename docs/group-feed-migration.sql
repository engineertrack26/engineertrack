-- ============================================
-- Group feed: tables, policies, and the trigger that turns an approved
-- task into a post.
--
-- Idempotent and safe to re-apply. Apply order: this file, then
-- docs/group-feed-rpcs.sql, then docs/group-feed-verification.sql.
-- Anonymous dollar-quoting only in the Supabase SQL editor.
-- ============================================

-- ---- The per-task sharing decision ----
ALTER TABLE assignment_submissions
  ADD COLUMN IF NOT EXISTS share_to_feed BOOLEAN NOT NULL DEFAULT true;

-- ---- feed_posts ----
CREATE TABLE IF NOT EXISTS feed_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('task', 'announcement', 'poll')),
  submission_id UUID UNIQUE REFERENCES assignment_submissions(id) ON DELETE CASCADE,
  body          TEXT CHECK (body IS NULL OR char_length(body) <= 2000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A task post is exactly a post with a submission; the other two kinds have
-- none. Stated as one equality so neither half can drift.
ALTER TABLE feed_posts DROP CONSTRAINT IF EXISTS feed_posts_task_has_submission;
ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_task_has_submission
  CHECK ((kind = 'task') = (submission_id IS NOT NULL));

-- A poll's question is its body; capped shorter than an announcement.
ALTER TABLE feed_posts DROP CONSTRAINT IF EXISTS feed_posts_poll_question_length;
ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_poll_question_length
  CHECK (kind <> 'poll' OR (body IS NOT NULL AND char_length(body) <= 200));

-- An announcement may not be empty.
ALTER TABLE feed_posts DROP CONSTRAINT IF EXISTS feed_posts_announcement_has_body;
ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_announcement_has_body
  CHECK (kind <> 'announcement' OR (body IS NOT NULL AND char_length(body) BETWEEN 1 AND 2000));

CREATE INDEX IF NOT EXISTS idx_feed_posts_group_created
  ON feed_posts(group_id, created_at DESC);

-- ---- feed_poll_options ----
CREATE TABLE IF NOT EXISTS feed_poll_options (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id  UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  position INT  NOT NULL,
  label    TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  UNIQUE (post_id, position)
);

-- A vote's option must belong to its post, structurally: feed_poll_options
-- gets a second unique on (post_id, id) so feed_poll_votes can FK against
-- the pair, not just option_id alone.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_poll_options_post_id_id_key') THEN
    ALTER TABLE feed_poll_options ADD CONSTRAINT feed_poll_options_post_id_id_key UNIQUE (post_id, id);
  END IF;
END $$;

-- ---- feed_poll_votes ----
CREATE TABLE IF NOT EXISTS feed_poll_votes (
  post_id    UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  option_id  UUID NOT NULL REFERENCES feed_poll_options(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_poll_votes_option_matches_post') THEN
    ALTER TABLE feed_poll_votes ADD CONSTRAINT feed_poll_votes_option_matches_post
      FOREIGN KEY (post_id, option_id) REFERENCES feed_poll_options(post_id, id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---- feed_likes ----
CREATE TABLE IF NOT EXISTS feed_likes (
  post_id    UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- ---- feed_comments ----
CREATE TABLE IF NOT EXISTS feed_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_comments_post_created
  ON feed_comments(post_id, created_at);

-- ---- The one visibility rule, as a helper the child tables route through ----
-- SECURITY DEFINER so a policy on feed_comments calling it does not re-enter
-- the feed_posts policy (42P17). Same shape as owns_group / is_member_of_group.
CREATE OR REPLACE FUNCTION can_see_post(p_post_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM feed_posts p
    WHERE p.id = p_post_id
      AND (owns_group(p.group_id) OR is_member_of_group(p.group_id))
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
GRANT EXECUTE ON FUNCTION can_see_post(UUID) TO authenticated;

-- ---- RLS ----
ALTER TABLE feed_posts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_poll_votes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_likes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_comments     ENABLE ROW LEVEL SECURITY;

-- feed_posts: read by owner or member. Direct INSERT is allowed only for the
-- advisor's own announcements and polls (create_feed_post is the normal
-- path, but the policy is what makes a task post unforgeable: kind = 'task'
-- never passes here, only the SECURITY DEFINER publisher writes it).
-- DELETE: the advisor of the group, any kind. A student never deletes a
-- task post directly -- set_submission_sharing(false) does, so the flag and
-- the row cannot disagree.
DROP POLICY IF EXISTS feed_posts_select ON feed_posts;
CREATE POLICY feed_posts_select ON feed_posts FOR SELECT TO authenticated
  USING (owns_group(group_id) OR is_member_of_group(group_id));

DROP POLICY IF EXISTS feed_posts_insert ON feed_posts;
CREATE POLICY feed_posts_insert ON feed_posts FOR INSERT TO authenticated
  WITH CHECK (kind IN ('announcement', 'poll')
              AND author_id = auth.uid()
              AND owns_group(group_id));

DROP POLICY IF EXISTS feed_posts_delete ON feed_posts;
CREATE POLICY feed_posts_delete ON feed_posts FOR DELETE TO authenticated
  USING (owns_group(group_id));

-- feed_poll_options: readable with the post; written only by create_feed_post.
DROP POLICY IF EXISTS feed_poll_options_select ON feed_poll_options;
CREATE POLICY feed_poll_options_select ON feed_poll_options FOR SELECT TO authenticated
  USING (can_see_post(post_id));

-- feed_poll_votes: readable with the post; written only by vote_feed_poll;
-- a voter may withdraw their own vote.
DROP POLICY IF EXISTS feed_poll_votes_select ON feed_poll_votes;
CREATE POLICY feed_poll_votes_select ON feed_poll_votes FOR SELECT TO authenticated
  USING (can_see_post(post_id));
DROP POLICY IF EXISTS feed_poll_votes_delete ON feed_poll_votes;
CREATE POLICY feed_poll_votes_delete ON feed_poll_votes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- feed_likes: anyone who can see the post may like it as themselves and
-- withdraw their own like.
DROP POLICY IF EXISTS feed_likes_select ON feed_likes;
CREATE POLICY feed_likes_select ON feed_likes FOR SELECT TO authenticated
  USING (can_see_post(post_id));
DROP POLICY IF EXISTS feed_likes_insert ON feed_likes;
CREATE POLICY feed_likes_insert ON feed_likes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND can_see_post(post_id));
DROP POLICY IF EXISTS feed_likes_delete ON feed_likes;
CREATE POLICY feed_likes_delete ON feed_likes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- feed_comments: same, plus the group's advisor may remove any comment.
DROP POLICY IF EXISTS feed_comments_select ON feed_comments;
CREATE POLICY feed_comments_select ON feed_comments FOR SELECT TO authenticated
  USING (can_see_post(post_id));
DROP POLICY IF EXISTS feed_comments_insert ON feed_comments;
CREATE POLICY feed_comments_insert ON feed_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND can_see_post(post_id));
DROP POLICY IF EXISTS feed_comments_delete ON feed_comments;
CREATE POLICY feed_comments_delete ON feed_comments FOR DELETE TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (SELECT 1 FROM feed_posts p
               WHERE p.id = feed_comments.post_id AND owns_group(p.group_id))
  );

-- ---- Turning an approved submission into a post ----
-- One implementation, called from the approval trigger AND from
-- set_submission_sharing(true), so the two paths cannot disagree.
-- Idempotent: a submission that already has a post gets nothing.
CREATE OR REPLACE FUNCTION feed_publish_submission(p_submission_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student    UUID;
  v_share      BOOLEAN;
  v_status     TEXT;
  v_group      UUID;
  v_advisor    UUID;
  v_title      TEXT;
  v_name       TEXT;
  v_post       UUID;
BEGIN
  -- The assignment's own group, not the student's current active
  -- membership: those coincide at approval time, but set_submission_sharing
  -- (Task 2) can run after the student has transferred, and the post must
  -- still land in the group the task was actually assigned in.
  SELECT s.student_id, s.share_to_feed, s.status, a.title, a.group_id
  INTO v_student, v_share, v_status, v_title, v_group
  FROM assignment_submissions s
  JOIN group_assignments a ON a.id = s.assignment_id
  WHERE s.id = p_submission_id;

  IF v_student IS NULL OR NOT v_share OR v_status <> 'approved' THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM feed_posts WHERE submission_id = p_submission_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO feed_posts (group_id, author_id, kind, submission_id)
  VALUES (v_group, v_student, 'task', p_submission_id)
  RETURNING id INTO v_post;

  -- Tell the advisor. Wrapped so a notification failure cannot undo the
  -- post -- but WARN, never swallow: the notification bug that hid for
  -- weeks was a silent catch.
  BEGIN
    SELECT g.advisor_id INTO v_advisor FROM internship_groups g WHERE g.id = v_group;
    SELECT trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    INTO v_name FROM profiles p WHERE p.id = v_student;
    IF v_advisor IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, body, type, data)
      VALUES (
        v_advisor,
        'New in the feed',
        coalesce(nullif(v_name, ''), 'A student')
          || ' shared "' || coalesce(v_title, 'a task') || '".',
        'feed_task_post',
        jsonb_build_object('postId', v_post, 'groupId', v_group)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'feed_publish_submission: advisor notification failed: %', SQLERRM;
  END;

  RETURN v_post;
END;
$$;
-- Not granted to authenticated: only the trigger below and
-- set_submission_sharing (both SECURITY DEFINER, both owner-run) call it.
REVOKE EXECUTE ON FUNCTION feed_publish_submission(UUID) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION trg_feed_task_post_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM feed_publish_submission(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_task_post ON assignment_submissions;
CREATE TRIGGER trg_feed_task_post
  AFTER UPDATE OF status ON assignment_submissions
  FOR EACH ROW
  WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved')
  EXECUTE FUNCTION trg_feed_task_post_fn();

-- ---- A retracted approval takes its post down with it ----
-- Comments and likes cascade via feed_posts' own ON DELETE CASCADE FKs --
-- same rule as the student withdrawing it through set_submission_sharing(false).
CREATE OR REPLACE FUNCTION trg_feed_task_retract_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM feed_posts WHERE submission_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_task_retract ON assignment_submissions;
CREATE TRIGGER trg_feed_task_retract
  AFTER UPDATE OF status ON assignment_submissions
  FOR EACH ROW
  WHEN (OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved')
  EXECUTE FUNCTION trg_feed_task_retract_fn();

-- ---- A comment notifies the post's author (not for their own comment) ----
CREATE OR REPLACE FUNCTION trg_feed_comment_notify_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author UUID;
  v_group  UUID;
  v_name   TEXT;
BEGIN
  SELECT p.author_id, p.group_id INTO v_author, v_group
  FROM feed_posts p WHERE p.id = NEW.post_id;
  IF v_author IS NULL OR v_author = NEW.author_id THEN
    RETURN NEW;
  END IF;
  SELECT trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, ''))
  INTO v_name FROM profiles pr WHERE pr.id = NEW.author_id;
  BEGIN
    INSERT INTO notifications (user_id, title, body, type, data)
    VALUES (
      v_author,
      'New comment',
      coalesce(nullif(v_name, ''), 'Someone') || ' commented on your post.',
      'feed_comment',
      jsonb_build_object('postId', NEW.post_id, 'groupId', v_group)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'feed comment notification failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_comment_notify ON feed_comments;
CREATE TRIGGER trg_feed_comment_notify
  AFTER INSERT ON feed_comments
  FOR EACH ROW EXECUTE FUNCTION trg_feed_comment_notify_fn();

-- ---- Realtime: the screen prepends new posts as they arrive ----
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'feed_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE feed_posts;
  END IF;
END $$;
