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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_posts_poll_question_length') THEN
    RAISE EXCEPTION 'FAIL: feed_posts_poll_question_length CHECK is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_posts_announcement_has_body') THEN
    RAISE EXCEPTION 'FAIL: feed_posts_announcement_has_body CHECK is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_poll_votes_option_matches_post') THEN
    RAISE EXCEPTION 'FAIL: feed_poll_votes_option_matches_post FOREIGN KEY is missing';
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
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_feed_task_retract' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: trg_feed_task_retract is missing';
  END IF;

  -- A task post is unforgeable: the direct-insert policy must exclude 'task'.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'feed_posts' AND cmd = 'INSERT'
      AND with_check LIKE '%announcement%'
  ) THEN
    RAISE EXCEPTION 'FAIL: feed_posts INSERT policy does not restrict to announcement/poll';
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

-- ============================================================
-- PART B — RPC behaviour, run as owner (auth.uid() is impersonated through
-- request.jwt.claims). Submit BEGIN..ROLLBACK in one go.
--   B1 approval with share_to_feed = true          -> exactly one task post
--   B2 approval with share_to_feed = false         -> no post
--   B3 retract then re-approve leaves exactly one post
--   B4 set_submission_sharing(false)                -> post AND its 2 comments gone
--   B5 set_submission_sharing(true)                 -> a post is back
--   B6 create_feed_post poll with 1 option          -> POLL_OPTIONS_RANGE
--   B7 create_feed_post poll with 3 options         -> 3 options, 1 notification per ACTIVE student
--   B8 vote twice as the same user                  -> 1 vote, on the second option
-- Expected: eight rows, none beginning FAIL / SKIP / ABORTED.
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; stu2 UUID; grp UUID; kpi UUID; asg UUID; sub UUID; sub2 UUID;
  post UUID; opt1 UUID; opt2 UUID; n INT; m INT; log TEXT := '';
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu2 FROM profiles WHERE role = 'student' AND id <> stu ORDER BY created_at LIMIT 1;
  SELECT k.id INTO kpi FROM competency_kpis k WHERE k.level = 1 ORDER BY k.kpi_index LIMIT 1;

  IF adv IS NULL OR stu IS NULL OR kpi IS NULL THEN
    PERFORM set_config('probe.results', 'B1-B8' || E'\t' || 'SKIP: needs an advisor, a student and a KPI' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe feed') RETURNING id INTO grp;
  UPDATE group_memberships SET left_at = now() WHERE student_id IN (stu, stu2) AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  IF stu2 IS NOT NULL THEN
    -- stu2 is active for B2 and is closed out before B7, which asserts a
    -- member who has left gets no notification.
    INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu2);
  END IF;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grp, tr.id, 'Probe task', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index LIMIT 1
  RETURNING id INTO asg;

  -- Two submissions by stu on two assignments would need two triplets; one
  -- assignment with the second submission by stu2 keeps the fixture small.
  INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection, share_to_feed)
  VALUES (asg, stu, 'submitted', 'r', true) RETURNING id INTO sub;

  -- B1
  UPDATE assignment_submissions SET status = 'approved' WHERE id = sub;
  SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
  log := log || 'B1 approval creates a task post' || E'\t'
      || CASE WHEN n = 1 THEN '1 post' ELSE 'FAIL: ' || n || ' posts' END || E'\n';

  -- B2
  IF stu2 IS NOT NULL THEN
    INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection, share_to_feed)
    VALUES (asg, stu2, 'submitted', 'r', false) RETURNING id INTO sub2;
    UPDATE assignment_submissions SET status = 'approved' WHERE id = sub2;
    SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub2;
    log := log || 'B2 approval with sharing off creates nothing' || E'\t'
        || CASE WHEN n = 0 THEN '0 posts' ELSE 'FAIL: ' || n || ' posts' END || E'\n';
  ELSE
    log := log || 'B2 approval with sharing off creates nothing' || E'\t' || 'SKIP: needs a second student' || E'\n';
  END IF;

  -- B3: re-fire the trigger condition. The retraction trigger deletes the
  -- post the instant status leaves 'approved', so this flip is delete-then-
  -- recreate, not a same-row update -- the assertion is still exactly one
  -- post, but it is a *new* post, not the original B1 row.
  UPDATE assignment_submissions SET status = 'submitted' WHERE id = sub;
  UPDATE assignment_submissions SET status = 'approved' WHERE id = sub;
  SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
  log := log || 'B3 retract then re-approve leaves exactly one post' || E'\t'
      || CASE WHEN n = 1 THEN '1 post' ELSE 'FAIL: ' || n || ' posts' END || E'\n';

  -- B4
  SELECT id INTO post FROM feed_posts WHERE submission_id = sub;
  INSERT INTO feed_comments (post_id, author_id, body) VALUES (post, adv, 'c1'), (post, adv, 'c2');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM set_submission_sharing(sub, false);
  SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
  SELECT count(*) INTO m FROM feed_comments WHERE post_id = post;
  log := log || 'B4 sharing off removes post and comments' || E'\t'
      || CASE WHEN n = 0 AND m = 0 THEN '0 posts, 0 comments'
              ELSE 'FAIL: ' || n || ' posts, ' || m || ' comments' END || E'\n';

  -- B5
  PERFORM set_submission_sharing(sub, true);
  SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
  log := log || 'B5 sharing on republishes' || E'\t'
      || CASE WHEN n = 1 THEN '1 post' ELSE 'FAIL: ' || n || ' posts' END || E'\n';

  -- B6
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM create_feed_post(grp, 'poll', 'One option?', ARRAY['only']);
    log := log || 'B6 poll with one option refused' || E'\t' || 'FAIL: accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B6 poll with one option refused' || E'\t'
        || CASE WHEN SQLERRM LIKE 'POLL_OPTIONS_RANGE%' THEN 'POLL_OPTIONS_RANGE'
                ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;

  -- B7: stu2 leaves first; only stu (active) may be notified.
  UPDATE group_memberships SET left_at = now() WHERE group_id = grp AND student_id = stu2;
  DELETE FROM notifications WHERE type IN ('feed_poll', 'feed_announcement') AND user_id IN (stu, stu2);
  post := create_feed_post(grp, 'poll', 'Which?', ARRAY['A', 'B', 'C']);
  SELECT count(*) INTO n FROM feed_poll_options WHERE post_id = post;
  SELECT count(*) INTO m FROM notifications WHERE type = 'feed_poll' AND (data->>'postId')::uuid = post;
  log := log || 'B7 poll writes options and notifies active members' || E'\t'
      || CASE WHEN n = 3 AND m = 1 THEN '3 options, 1 notification'
              ELSE 'FAIL: ' || n || ' options, ' || m || ' notifications' END || E'\n';

  -- B8
  SELECT id INTO opt1 FROM feed_poll_options WHERE post_id = post AND position = 0;
  SELECT id INTO opt2 FROM feed_poll_options WHERE post_id = post AND position = 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM vote_feed_poll(post, opt1);
  PERFORM vote_feed_poll(post, opt2);
  SELECT count(*) INTO n FROM feed_poll_votes WHERE post_id = post AND user_id = stu;
  SELECT count(*) INTO m FROM feed_poll_votes WHERE post_id = post AND user_id = stu AND option_id = opt2;
  log := log || 'B8 second vote moves the first' || E'\t'
      || CASE WHEN n = 1 AND m = 1 THEN '1 vote, on option 2'
              ELSE 'FAIL: ' || n || ' votes, ' || m || ' on option 2' END || E'\n';

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;

-- ============================================================
-- PART C — the policies, actually evaluated. Submit BEGIN..ROLLBACK in one go.
--   C1 member of group A lists A's feed              1 post   (positive control)
--   C2 member of group A reads B's post              0 rows
--   C3 member of group A reads B's comment           0 rows
--   C4 member of group A reads B's vote              0 rows
--   C5 member of group A calls list_feed_posts(B)    NOT_IN_GROUP
--   C6 student inserts an announcement               refused (42501)
--   C7 mentor selects feed_posts                     0 rows
--   C8 student whose membership closed lists A       NOT_IN_GROUP; post still exists
-- If SET LOCAL ROLE raises 42501 in your editor, STOP and report Part C as
-- unrunnable -- do not replace these with pg_policies lookups.
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; mentor UUID; grpA UUID; grpB UUID; postA UUID; postB UUID; optB UUID;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role = 'mentor' ORDER BY created_at LIMIT 1;
  IF adv IS NULL OR stu IS NULL THEN
    PERFORM set_config('probe.ready', 'no', true); RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe feed A') RETURNING id INTO grpA;
  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe feed B') RETURNING id INTO grpB;
  UPDATE group_memberships SET left_at = now() WHERE student_id = stu AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grpA, stu);

  INSERT INTO feed_posts (group_id, author_id, kind, body) VALUES (grpA, adv, 'announcement', 'hello A') RETURNING id INTO postA;
  INSERT INTO feed_posts (group_id, author_id, kind, body) VALUES (grpB, adv, 'poll', 'B?') RETURNING id INTO postB;
  INSERT INTO feed_poll_options (post_id, position, label) VALUES (postB, 0, 'x') RETURNING id INTO optB;
  INSERT INTO feed_poll_votes (post_id, option_id, user_id) VALUES (postB, optB, adv);
  INSERT INTO feed_comments (post_id, author_id, body) VALUES (postB, adv, 'B comment');

  PERFORM set_config('probe.ready', 'yes', true);
  PERFORM set_config('probe.adv', adv::text, true);
  PERFORM set_config('probe.stu', stu::text, true);
  PERFORM set_config('probe.mentor', coalesce(mentor::text, ''), true);
  PERFORM set_config('probe.grpA', grpA::text, true);
  PERFORM set_config('probe.grpB', grpB::text, true);
  PERFORM set_config('probe.postA', postA::text, true);
  PERFORM set_config('probe.postB', postB::text, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  adv UUID; stu UUID; mentor UUID; grpA UUID; grpB UUID; postA UUID; postB UUID;
  n INT; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results', 'C1-C8' || E'\t' || 'SKIP: needs an advisor and a student' || E'\n', true);
    RETURN;
  END IF;
  adv := current_setting('probe.adv')::uuid;  stu := current_setting('probe.stu')::uuid;
  mentor := NULLIF(current_setting('probe.mentor'), '')::uuid;
  grpA := current_setting('probe.grpA')::uuid; grpB := current_setting('probe.grpB')::uuid;
  postA := current_setting('probe.postA')::uuid; postB := current_setting('probe.postB')::uuid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);

  BEGIN
    SELECT count(*) INTO n FROM list_feed_posts(grpA);
    log := log || 'C1 member lists own group' || E'\t' || CASE WHEN n = 1 THEN '1 post' ELSE 'FAIL: ' || n END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C1 member lists own group' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;

  BEGIN
    SELECT count(*) INTO n FROM feed_posts WHERE id = postB;
    log := log || 'C2 member reads other group post' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: leaked' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C2 member reads other group post' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;

  BEGIN
    SELECT count(*) INTO n FROM feed_comments WHERE post_id = postB;
    log := log || 'C3 member reads other group comment' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: leaked' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C3 member reads other group comment' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;

  BEGIN
    SELECT count(*) INTO n FROM feed_poll_votes WHERE post_id = postB;
    log := log || 'C4 member reads other group vote' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: leaked' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C4 member reads other group vote' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;

  BEGIN
    SELECT count(*) INTO n FROM list_feed_posts(grpB);
    log := log || 'C5 member lists other group' || E'\t' || 'FAIL: returned ' || n || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C5 member lists other group' || E'\t'
        || CASE WHEN SQLERRM LIKE 'NOT_IN_GROUP%' THEN 'NOT_IN_GROUP' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;

  BEGIN
    INSERT INTO feed_posts (group_id, author_id, kind, body) VALUES (grpA, stu, 'announcement', 'nope');
    log := log || 'C6 student inserts announcement' || E'\t' || 'FAIL: accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C6 student inserts announcement' || E'\t'
        || CASE WHEN SQLSTATE = '42501' THEN 'refused 42501' ELSE 'FAIL: ' || SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  IF mentor IS NULL THEN
    log := log || 'C7 mentor sees nothing' || E'\t' || 'SKIP: no mentor profile' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT count(*) INTO n FROM feed_posts;
      log := log || 'C7 mentor sees nothing' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: ' || n || ' rows' END || E'\n';
    EXCEPTION WHEN OTHERS THEN log := log || 'C7 mentor sees nothing' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
  END IF;

  PERFORM set_config('probe.results', log, true);
END $$;

RESET ROLE;

-- C8 needs the membership closed as owner, then the read attempted as the student.
DO $$
DECLARE stu UUID; grpA UUID; postA UUID; n INT; log TEXT;
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  stu := current_setting('probe.stu')::uuid; grpA := current_setting('probe.grpA')::uuid;
  postA := current_setting('probe.postA')::uuid;
  UPDATE group_memberships SET left_at = now() WHERE group_id = grpA AND student_id = stu;
  SELECT count(*) INTO n FROM feed_posts WHERE id = postA;   -- owner-run: proves the row survived
  log := current_setting('probe.results', true);
  log := log || 'C8a post survives the member leaving' || E'\t' || CASE WHEN n = 1 THEN '1 row' ELSE 'FAIL: ' || n END || E'\n';
  PERFORM set_config('probe.results', log, true);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE stu UUID; grpA UUID; n INT; log TEXT;
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  stu := current_setting('probe.stu')::uuid; grpA := current_setting('probe.grpA')::uuid;
  log := current_setting('probe.results', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM list_feed_posts(grpA);
    log := log || 'C8b left member lists old group' || E'\t' || 'FAIL: returned ' || n || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C8b left member lists old group' || E'\t'
        || CASE WHEN SQLERRM LIKE 'NOT_IN_GROUP%' THEN 'NOT_IN_GROUP' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;
  PERFORM set_config('probe.results', log, true);
END $$;
RESET ROLE;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;
