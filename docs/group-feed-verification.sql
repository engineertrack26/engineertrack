-- ============================================================
-- Group feed verification
--
-- Run in the Supabase SQL editor. Anonymous dollar-quoting only.
-- Apply order: docs/group-feed-migration.sql, docs/group-feed-rpcs.sql,
-- then this file, ONE PART PER SUBMISSION.
--
-- PART A is STRUCTURAL: the editor runs as the table owner and bypasses
-- RLS, so these prove a table, column, constraint, trigger or policy
-- EXISTS -- never that a policy EVALUATES correctly. Part C does that.
-- ============================================================

-- ============================================================
-- PART A — schema assertions. Expected: one row "PASS: schema assertions held".
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'assignment_submissions' AND column_name = 'share_to_feed') THEN
    RAISE EXCEPTION 'FAIL: assignment_submissions.share_to_feed is missing';
  END IF;

  FOREACH t IN ARRAY ARRAY['feed_posts','feed_poll_options','feed_poll_votes','feed_likes','feed_comments'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      RAISE EXCEPTION 'FAIL: table % is missing', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = t AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'FAIL: RLS is not enabled on %', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_posts_task_has_submission') THEN
    RAISE EXCEPTION 'FAIL: feed_posts_task_has_submission CHECK is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_see_post') THEN
    RAISE EXCEPTION 'FAIL: can_see_post() is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'feed_publish_submission') THEN
    RAISE EXCEPTION 'FAIL: feed_publish_submission() is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_feed_task_post' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: trg_feed_task_post is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_feed_comment_notify' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: trg_feed_comment_notify is missing';
  END IF;

  -- Every child-table policy must route through can_see_post, never read
  -- feed_posts directly (42P17 guard). The one exception is
  -- feed_comments_delete's advisor branch, which is an EXISTS on feed_posts
  -- inside a DELETE policy and cannot recurse.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename IN ('feed_poll_options','feed_poll_votes','feed_likes','feed_comments')
      AND cmd = 'SELECT'
      AND coalesce(qual, '') NOT LIKE '%can_see_post%'
  ) THEN
    RAISE EXCEPTION 'FAIL: a child-table SELECT policy does not go through can_see_post';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'feed_posts') THEN
    RAISE EXCEPTION 'FAIL: feed_posts is not in the supabase_realtime publication';
  END IF;

  RAISE NOTICE 'PASS: schema assertions held';
END $$;
SELECT 'PASS: schema assertions held' AS result;

-- Parts B and C are appended by Task 2.
