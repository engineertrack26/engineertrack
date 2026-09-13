-- ============================================================
-- Group feed verification
--
-- Run in the Supabase SQL editor. Anonymous dollar-quoting only.
-- Apply order: docs/group-feed-migration.sql, docs/group-feed-rpcs.sql,
-- docs/group-feed-assignment-cards.sql, docs/group-feed-attachments.sql,
-- docs/group-feed-drafts.sql, docs/group-feed-read.sql, then this file,
-- ONE PART PER SUBMISSION.
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
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'feed_posts' AND column_name = 'assignment_id') THEN
    RAISE EXCEPTION 'FAIL: feed_posts.assignment_id is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'feed_posts' AND column_name = 'published_at') THEN
    RAISE EXCEPTION 'FAIL: feed_posts.published_at is missing -- apply docs/group-feed-drafts.sql';
  END IF;

  FOREACH t IN ARRAY ARRAY['feed_posts','feed_poll_options','feed_poll_votes','feed_likes','feed_comments','feed_attachments'] LOOP
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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_posts_assignment_has_assignment') THEN
    RAISE EXCEPTION 'FAIL: feed_posts_assignment_has_assignment CHECK is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_attachments_link_is_http') THEN
    RAISE EXCEPTION 'FAIL: feed_attachments_link_is_http CHECK is missing -- re-apply docs/group-feed-attachments.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_posts_auto_kinds_published') THEN
    RAISE EXCEPTION 'FAIL: feed_posts_auto_kinds_published CHECK is missing -- apply docs/group-feed-drafts.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_see_post') THEN
    RAISE EXCEPTION 'FAIL: can_see_post() is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'feed_publish_submission') THEN
    RAISE EXCEPTION 'FAIL: feed_publish_submission() is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'feed_shares_evidence') THEN
    RAISE EXCEPTION 'FAIL: feed_shares_evidence() is missing -- apply docs/group-feed-attachments.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'feed_publish_post') THEN
    RAISE EXCEPTION 'FAIL: feed_publish_post() is missing -- apply docs/group-feed-drafts.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'publish_feed_post') THEN
    RAISE EXCEPTION 'FAIL: publish_feed_post() is missing -- apply docs/group-feed-drafts.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'list_feed_pending') THEN
    RAISE EXCEPTION 'FAIL: list_feed_pending() is missing -- apply docs/group-feed-drafts.sql';
  END IF;
  -- create_feed_post carries p_draft as its sixth parameter, and the old
  -- four- and five-parameter overloads must be gone: side by side, every
  -- call with fewer arguments is ambiguous (42725).
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_feed_post' AND pronargs = 6) THEN
    RAISE EXCEPTION 'FAIL: create_feed_post does not take 6 arguments -- apply docs/group-feed-drafts.sql';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_feed_post' AND pronargs <> 6) THEN
    RAISE EXCEPTION 'FAIL: a stale create_feed_post overload is still present -- re-apply docs/group-feed-drafts.sql';
  END IF;
  -- The visibility rule must be the drafts-aware one: a stale re-apply of
  -- docs/group-feed-migration.sql would silently show every draft to every
  -- member, through every child table.
  IF pg_get_functiondef('can_see_post(uuid)'::regprocedure) NOT LIKE '%published_at%' THEN
    RAISE EXCEPTION 'FAIL: can_see_post does not check published_at -- re-apply docs/group-feed-drafts.sql';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'feed-attachments' AND public = false) THEN
    RAISE EXCEPTION 'FAIL: feed-attachments bucket is missing or public';
  END IF;
  -- The one copy of list_feed_posts is in docs/group-feed-read.sql; a stale
  -- re-apply of an older file would drop a key and every assignment card
  -- would render header-only, or every attachment vanish, silently.
  IF pg_get_functiondef('list_feed_posts(uuid,timestamptz,int)'::regprocedure) NOT LIKE '%''assignment''%' THEN
    RAISE EXCEPTION 'FAIL: list_feed_posts does not project the assignment kind -- re-apply docs/group-feed-read.sql';
  END IF;
  IF pg_get_functiondef('list_feed_posts(uuid,timestamptz,int)'::regprocedure) NOT LIKE '%''attachments''%' THEN
    RAISE EXCEPTION 'FAIL: list_feed_posts does not project attachments -- re-apply docs/group-feed-read.sql';
  END IF;
  IF pg_get_functiondef('list_feed_posts(uuid,timestamptz,int)'::regprocedure) NOT LIKE '%published_at%' THEN
    RAISE EXCEPTION 'FAIL: list_feed_posts does not filter on published_at -- re-apply docs/group-feed-read.sql';
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
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_feed_assignment_post' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: trg_feed_assignment_post is missing';
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
--   B5 set_submission_sharing(true), twice           -> a post is back, second call is a no-op
--   B6 create_feed_post poll with 1 option          -> POLL_OPTIONS_RANGE
--   B7 create_feed_post poll with 3 options         -> 3 options, 1 notification per ACTIVE student
--   B8 vote twice as the same user                  -> 1 vote, on the second option
--   B9 advisor remove_feed_post on the task post    -> post gone AND share_to_feed = false
--   B10 publishing a task posts one card, once; deleting the task removes it
--   B11 announcement with one of each attachment  -> 3 feed_attachments rows
--   B12 second photo -> ATTACHMENT_LIMIT; poll with an attachment -> KIND_NOT_ALLOWED;
--       javascript: link -> 23514 (the feed_attachments_link_is_http CHECK)
--   B13 draft is created unpublished and notifies nobody
--   B14 publishing the draft notifies once, and again is a no-op
--   B15 list_feed_pending shows the advisor's drafts only; the stream hides them
-- Expected: fifteen rows, none beginning FAIL / SKIP / ABORTED.
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; stu2 UUID; grp UUID; kpi UUID; asg UUID; asg2 UUID; asg3 UUID; sub UUID; sub2 UUID;
  post UUID; opt1 UUID; opt2 UUID; draft2 UUID; n INT; m INT; log TEXT := '';
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu2 FROM profiles WHERE role = 'student' AND id <> stu ORDER BY created_at LIMIT 1;
  SELECT k.id INTO kpi FROM competency_kpis k WHERE k.level = 1 ORDER BY k.kpi_index LIMIT 1;

  IF adv IS NULL OR stu IS NULL OR kpi IS NULL THEN
    PERFORM set_config('probe.results', 'B1-B15' || E'\t' || 'SKIP: needs an advisor, a student and a KPI' || E'\n', true);
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

  -- A second task under the same KPI, so B2 can approve a submission with
  -- sharing OFF by the SAME student -- it must not depend on the database
  -- having a second student profile.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grp, tr.id, 'Probe task 2', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 1 LIMIT 1
  RETURNING id INTO asg2;

  -- A third task left as a DRAFT (no published_at), so B10 can drive the
  -- publish transition through the trigger. asg and asg2 were INSERTed
  -- already published, which the AFTER UPDATE trigger never sees.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT grp, tr.id, 'Probe task 3', tr.objective, tr.criterion, adv
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 2 LIMIT 1
  RETURNING id INTO asg3;

  -- Two submissions by stu on two assignments would need two triplets; one
  -- assignment with the second submission by stu2 keeps the fixture small.
  INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection, share_to_feed)
  VALUES (asg, stu, 'submitted', 'r', true) RETURNING id INTO sub;

  -- B1
  BEGIN
    UPDATE assignment_submissions SET status = 'approved' WHERE id = sub;
    SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
    log := log || 'B1 approval creates a task post' || E'\t'
        || CASE WHEN n = 1 THEN '1 post' ELSE 'FAIL: ' || n || ' posts' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B1 approval creates a task post' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B2: the same student, a second task, sharing OFF. The publisher's
  -- NOT v_share branch is the whole privacy promise; it must be exercised
  -- on every database, not only ones with two student profiles.
  BEGIN
    IF asg2 IS NULL THEN
      log := log || 'B2 approval with sharing off creates nothing' || E'\t' || 'SKIP: the KPI has only one triplet' || E'\n';
    ELSE
      INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection, share_to_feed)
      VALUES (asg2, stu, 'submitted', 'r', false) RETURNING id INTO sub2;
      UPDATE assignment_submissions SET status = 'approved' WHERE id = sub2;
      SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub2;
      log := log || 'B2 approval with sharing off creates nothing' || E'\t'
          || CASE WHEN n = 0 THEN '0 posts' ELSE 'FAIL: ' || n || ' posts' END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B2 approval with sharing off creates nothing' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B3: re-fire the trigger condition. The retraction trigger deletes the
  -- post the instant status leaves 'approved', so this flip is delete-then-
  -- recreate, not a same-row update -- the assertion is still exactly one
  -- post, but it is a *new* post, not the original B1 row.
  BEGIN
    UPDATE assignment_submissions SET status = 'submitted' WHERE id = sub;
    UPDATE assignment_submissions SET status = 'approved' WHERE id = sub;
    SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
    log := log || 'B3 retract then re-approve leaves exactly one post' || E'\t'
        || CASE WHEN n = 1 THEN '1 post' ELSE 'FAIL: ' || n || ' posts' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B3 retract then re-approve leaves exactly one post' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B4: SELECT id INTO post lives inside this block because it depends on
  -- B3 having run -- if B3 aborted, this reports ABORTED too, truthfully.
  BEGIN
    SELECT id INTO post FROM feed_posts WHERE submission_id = sub;
    INSERT INTO feed_comments (post_id, author_id, body) VALUES (post, adv, 'c1'), (post, adv, 'c2');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    PERFORM set_submission_sharing(sub, false);
    SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
    SELECT count(*) INTO m FROM feed_comments WHERE post_id = post;
    log := log || 'B4 sharing off removes post and comments' || E'\t'
        || CASE WHEN n = 0 AND m = 0 THEN '0 posts, 0 comments'
                ELSE 'FAIL: ' || n || ' posts, ' || m || ' comments' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B4 sharing off removes post and comments' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B5: called twice. If the publisher's "already has a post" EXISTS guard
  -- ever regressed, the second call would hit 23505 instead of no-op'ing.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    PERFORM set_submission_sharing(sub, true);
    PERFORM set_submission_sharing(sub, true);
    SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
    log := log || 'B5 sharing on republishes, and again is a no-op' || E'\t'
        || CASE WHEN n = 1 THEN '1 post' ELSE 'FAIL: ' || n || ' posts' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B5 sharing on republishes, and again is a no-op' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

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
  BEGIN
    UPDATE group_memberships SET left_at = now() WHERE group_id = grp AND student_id = stu2;
    DELETE FROM notifications WHERE type IN ('feed_poll', 'feed_announcement') AND user_id IN (stu, stu2);
    post := create_feed_post(grp, 'poll', 'Which?', ARRAY['A', 'B', 'C']);
    SELECT count(*) INTO n FROM feed_poll_options WHERE post_id = post;
    SELECT count(*) INTO m FROM notifications WHERE type = 'feed_poll' AND (data->>'postId')::uuid = post;
    log := log || 'B7 poll writes options and notifies active members' || E'\t'
        || CASE WHEN n = 3 AND m = 1 THEN '3 options, 1 notification'
                ELSE 'FAIL: ' || n || ' options, ' || m || ' notifications' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B7 poll writes options and notifies active members' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B8
  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B8 second vote moves the first' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B9: the task post B5 republished, re-selected by submission (B7/B8
  -- reassigned `post` to the poll). Removal by the advisor must also flip
  -- the student's flag, or the switch reads "on" for a post that is gone
  -- and toggling it off -> on silently undoes the moderation.
  BEGIN
    SELECT id INTO post FROM feed_posts WHERE submission_id = sub;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
    PERFORM remove_feed_post(post);
    SELECT count(*) INTO n FROM feed_posts WHERE id = post;
    SELECT count(*) INTO m FROM assignment_submissions WHERE id = sub AND share_to_feed = false;
    log := log || 'B9 advisor removal turns the student''s sharing off' || E'\t'
        || CASE WHEN n = 0 AND m = 1 THEN '0 posts, sharing off'
                ELSE 'FAIL: ' || n || ' posts, ' || CASE WHEN m = 1 THEN 'sharing off' ELSE 'sharing still on' END END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B9 advisor removal turns the student''s sharing off' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B10: the publish transition (NULL -> now()) fires the trigger exactly
  -- once; a published -> published UPDATE must not (the WHEN clause), and
  -- deleting the task takes its card down through the FK cascade.
  BEGIN
    IF asg3 IS NULL THEN
      log := log || 'B10 publishing a task posts one card, once; deleting the task removes it' || E'\t' || 'SKIP: the KPI has fewer than three triplets' || E'\n';
    ELSE
      UPDATE group_assignments SET published_at = now() WHERE id = asg3;
      SELECT count(*) INTO n FROM feed_posts WHERE assignment_id = asg3;
      UPDATE group_assignments SET published_at = now() WHERE id = asg3;
      SELECT count(*) INTO m FROM feed_posts WHERE assignment_id = asg3;
      DELETE FROM group_assignments WHERE id = asg3;
      log := log || 'B10 publishing a task posts one card, once; deleting the task removes it' || E'\t'
          || CASE WHEN n = 1 AND m = 1 AND (SELECT count(*) FROM feed_posts WHERE assignment_id = asg3) = 0
                  THEN '1 card, still 1, then 0'
                  ELSE 'FAIL: ' || n || ' after publish, ' || m || ' after republish, '
                       || (SELECT count(*) FROM feed_posts WHERE assignment_id = asg3) || ' after delete' END || E'\n';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B10 publishing a task posts one card, once; deleting the task removes it' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B11: one of each kind on an announcement, through the fifth parameter.
  -- Three rows; the order they are handed in is deliberately not the order
  -- list_feed_posts returns them in.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
  BEGIN
    post := create_feed_post(grp, 'announcement', 'Read this', NULL,
      ('[{"kind":"link","target":"https://example.org","name":"Example"},'
       || '{"kind":"document","target":"' || grp::text || '/x/brief.pdf","name":"brief.pdf","mime":"application/pdf","size":10},'
       || '{"kind":"photo","target":"' || grp::text || '/x/p.jpg","mime":"image/jpeg","size":10}]')::jsonb);
    SELECT count(*) INTO n FROM feed_attachments WHERE post_id = post;
    log := log || 'B11 announcement with one of each attachment stores three rows' || E'\t'
        || CASE WHEN n = 3 THEN '3 rows' ELSE 'FAIL: ' || n || ' rows' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B11 announcement with one of each attachment stores three rows' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B12: the named refusals. A second photo is ATTACHMENT_LIMIT before any
  -- row is written; an attachment on a poll is KIND_NOT_ALLOWED; a link
  -- that is not http(s) fails the row CHECK (SQLSTATE 23514), so a bypassed
  -- composer still cannot store a javascript: target.
  DECLARE
    r1 TEXT; r2 TEXT; r3 TEXT;
  BEGIN
    BEGIN
      PERFORM create_feed_post(grp, 'announcement', 'Two photos', NULL,
        ('[{"kind":"photo","target":"' || grp::text || '/x/a.jpg","mime":"image/jpeg","size":10},'
         || '{"kind":"photo","target":"' || grp::text || '/x/b.jpg","mime":"image/jpeg","size":10}]')::jsonb);
      r1 := 'FAIL: second photo accepted';
    EXCEPTION WHEN OTHERS THEN
      r1 := CASE WHEN SQLERRM LIKE 'ATTACHMENT_LIMIT%' THEN 'ATTACHMENT_LIMIT' ELSE 'FAIL: ' || SQLERRM END;
    END;
    BEGIN
      PERFORM create_feed_post(grp, 'poll', 'Which?', ARRAY['A', 'B'],
        '[{"kind":"link","target":"https://example.org"}]'::jsonb);
      r2 := 'FAIL: poll attachment accepted';
    EXCEPTION WHEN OTHERS THEN
      r2 := CASE WHEN SQLERRM LIKE 'KIND_NOT_ALLOWED%' THEN 'KIND_NOT_ALLOWED' ELSE 'FAIL: ' || SQLERRM END;
    END;
    BEGIN
      PERFORM create_feed_post(grp, 'announcement', 'Bad link', NULL,
        '[{"kind":"link","target":"javascript:alert(1)"}]'::jsonb);
      r3 := 'FAIL: javascript: link accepted';
    EXCEPTION WHEN OTHERS THEN
      r3 := CASE WHEN SQLSTATE = '23514' THEN '23514' ELSE 'FAIL: ' || SQLSTATE || ' ' || SQLERRM END;
    END;
    log := log || 'B12 second photo, poll attachment and javascript: link refused' || E'\t'
        || CASE WHEN r1 = 'ATTACHMENT_LIMIT' AND r2 = 'KIND_NOT_ALLOWED' AND r3 = '23514'
                THEN 'ATTACHMENT_LIMIT, KIND_NOT_ALLOWED, 23514'
                ELSE 'FAIL: ' || r1 || ', ' || r2 || ', ' || r3 END || E'\n';
  END;

  -- B13: the sixth parameter. A draft is a row with published_at NULL and
  -- no notification -- the notification moved from creation to publish.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
  BEGIN
    post := create_feed_post(grp, 'announcement', 'Draft body', NULL, '[]'::jsonb, true);
    SELECT count(*) INTO n FROM feed_posts WHERE id = post AND published_at IS NULL;
    SELECT count(*) INTO m FROM notifications WHERE data->>'postId' = post::text;
    log := log || 'B13 draft is created unpublished and notifies nobody' || E'\t'
        || CASE WHEN n = 1 AND m = 0 THEN 'unpublished, 0 notifications'
                ELSE 'FAIL: ' || CASE WHEN n = 1 THEN 'unpublished' ELSE 'published' END || ', ' || m || ' notifications' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B13 draft is created unpublished and notifies nobody' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B14: publish twice. Exactly one notification, for stu (stu2 left in
  -- B7); the second call must be a no-op, not a second notification.
  BEGIN
    PERFORM publish_feed_post(post);
    PERFORM publish_feed_post(post);
    SELECT count(*) INTO n FROM feed_posts WHERE id = post AND published_at IS NOT NULL;
    SELECT count(*) INTO m FROM notifications WHERE data->>'postId' = post::text;
    log := log || 'B14 publishing the draft notifies once, and again is a no-op' || E'\t'
        || CASE WHEN n = 1 AND m = 1
                     AND (SELECT count(*) FROM notifications WHERE data->>'postId' = post::text AND user_id = stu) = 1
                THEN 'published, 1 notification'
                ELSE 'FAIL: ' || CASE WHEN n = 1 THEN 'published' ELSE 'still unpublished' END || ', ' || m || ' notifications' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B14 publishing the draft notifies once, and again is a no-op' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  -- B15: a second draft. list_feed_pending returns exactly it (the first
  -- was published in B14); list_feed_posts must not return it at all.
  BEGIN
    draft2 := create_feed_post(grp, 'poll', 'Still thinking?', ARRAY['Yes', 'No'], '[]'::jsonb, true);
    SELECT count(*) INTO n FROM list_feed_pending(grp);
    SELECT count(*) INTO m FROM list_feed_posts(grp) AS r WHERE r->>'id' = draft2::text;
    log := log || 'B15 list_feed_pending shows the advisor''s drafts only' || E'\t'
        || CASE WHEN n = 1 AND m = 0 THEN '1 pending, hidden from the stream'
                ELSE 'FAIL: ' || n || ' pending, ' || CASE WHEN m = 0 THEN 'hidden from' ELSE 'leaked into' END || ' the stream' END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B15 list_feed_pending shows the advisor''s drafts only' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

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
--   C7 mentor selects all five feed tables           0 rows in each
--   C8 student whose membership closed lists A       NOT_IN_GROUP; post still exists
--   C9 classmate reads a SHARED task's photo object  1 row   (log_photos_read, 4th disjunct)
--   C10 classmate reads an UNSHARED task's photo     0 rows
--   C11 member cannot see a draft, comment on it, or list it
--                                                    0 rows, refused 42501, not listed
-- Eleven cases. C9/C10 need a second student profile and SKIP without one.
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
  n INT; log TEXT := ''; tname TEXT; leaked TEXT;
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
    log := log || 'C7 mentor sees nothing in any feed table' || E'\t' || 'SKIP: no mentor profile' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    BEGIN
      -- Every feed table, not only feed_posts: the four children route
      -- through can_see_post, and a regression there would leak the
      -- comments and votes while feed_posts still read 0.
      leaked := '';
      FOREACH tname IN ARRAY ARRAY['feed_posts','feed_poll_options','feed_poll_votes','feed_likes','feed_comments'] LOOP
        EXECUTE format('SELECT count(*) FROM %I', tname) INTO n;
        IF n <> 0 THEN
          leaked := leaked || CASE WHEN leaked = '' THEN '' ELSE ', ' END || tname || ' ' || n;
        END IF;
      END LOOP;
      log := log || 'C7 mentor sees nothing in any feed table' || E'\t'
          || CASE WHEN leaked = '' THEN '0 rows in all five tables' ELSE 'FAIL: leaked ' || leaked END || E'\n';
    EXCEPTION WHEN OTHERS THEN log := log || 'C7 mentor sees nothing in any feed table' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
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

-- C9/C10 fixture, as owner. Two published tasks in grpA, both with an
-- APPROVED submission by stu: the first shared (trg_feed_task_post makes
-- its post), the second with share_to_feed = false (no post). One probe
-- object in log-photos under each, at <studentId>/<assignmentId>/<file> --
-- the path log_photos_read reasons about. stu2, a SECOND student profile,
-- joins grpA as an active member and is the classmate who reads. This needs
-- two student profiles and a KPI with two triplets; C9/C10 SKIP otherwise.
-- stu's own membership in grpA was closed by C8 -- irrelevant here, the
-- disjunct asks whether the READER is in the post's group.
DO $$
DECLARE
  adv UUID; stu UUID; stu2 UUID; grpA UUID; kpi UUID; asg UUID; asg_off UUID; sub UUID; sub_off UUID;
  shared_path TEXT; unshared_path TEXT; n INT;
BEGIN
  PERFORM set_config('probe.c9ready', 'no', true);
  PERFORM set_config('probe.c9fail', '', true);
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  adv := current_setting('probe.adv')::uuid; stu := current_setting('probe.stu')::uuid;
  grpA := current_setting('probe.grpA')::uuid;
  SELECT id INTO stu2 FROM profiles WHERE role = 'student' AND id <> stu ORDER BY created_at LIMIT 1;
  SELECT k.id INTO kpi FROM competency_kpis k WHERE k.level = 1 ORDER BY k.kpi_index LIMIT 1;
  IF stu2 IS NULL OR kpi IS NULL THEN RETURN; END IF;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grpA, tr.id, 'Probe evidence shared', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index LIMIT 1
  RETURNING id INTO asg;
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grpA, tr.id, 'Probe evidence unshared', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index OFFSET 1 LIMIT 1
  RETURNING id INTO asg_off;
  IF asg IS NULL OR asg_off IS NULL THEN RETURN; END IF;

  INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection, share_to_feed)
  VALUES (asg, stu, 'submitted', 'r', true) RETURNING id INTO sub;
  UPDATE assignment_submissions SET status = 'approved' WHERE id = sub;
  INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection, share_to_feed)
  VALUES (asg_off, stu, 'submitted', 'r', false) RETURNING id INTO sub_off;
  UPDATE assignment_submissions SET status = 'approved' WHERE id = sub_off;
  -- The fixture itself must hold before the policy is asked about it; a
  -- broken fixture is reported as its own FAIL line, never as a C9 verdict
  -- and never by RAISE, which would abort the transaction and lose C1-C8.
  SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
  IF n <> 1 THEN
    PERFORM set_config('probe.c9fail', 'FAIL: fixture expected 1 post for the shared submission, found ' || n, true);
    RETURN;
  END IF;
  SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub_off;
  IF n <> 0 THEN
    PERFORM set_config('probe.c9fail', 'FAIL: fixture expected 0 posts for the unshared submission, found ' || n, true);
    RETURN;
  END IF;

  shared_path   := stu::text || '/' || asg::text     || '/probe.jpg';
  unshared_path := stu::text || '/' || asg_off::text || '/probe2.jpg';
  INSERT INTO storage.objects (bucket_id, name) VALUES ('log-photos', shared_path);
  INSERT INTO storage.objects (bucket_id, name) VALUES ('log-photos', unshared_path);

  UPDATE group_memberships SET left_at = now() WHERE student_id = stu2 AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grpA, stu2);

  PERFORM set_config('probe.c9ready',       'yes',         true);
  PERFORM set_config('probe.stu2',          stu2::text,    true);
  PERFORM set_config('probe.shared_path',   shared_path,   true);
  PERFORM set_config('probe.unshared_path', unshared_path, true);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE stu2 UUID; shared_path TEXT; unshared_path TEXT; n INT; log TEXT;
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  log := current_setting('probe.results', true);
  IF coalesce(current_setting('probe.c9ready', true), 'no') <> 'yes' THEN
    log := log || 'C9-C10 classmate evidence read' || E'\t'
        || coalesce(nullif(current_setting('probe.c9fail', true), ''),
                    'SKIP: needs a second student profile and a KPI with two triplets') || E'\n';
    PERFORM set_config('probe.results', log, true);
    RETURN;
  END IF;
  stu2 := current_setting('probe.stu2')::uuid;
  shared_path := current_setting('probe.shared_path'); unshared_path := current_setting('probe.unshared_path');
  -- 'role' alongside 'sub': log_photos_read tests auth.role() = 'authenticated'.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu2, 'role', 'authenticated')::text, true);

  BEGIN
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'log-photos' AND name = shared_path;
    log := log || 'C9 classmate reads a SHARED task''s photo object' || E'\t'
        || CASE WHEN n = 1 THEN '1 row' ELSE 'FAIL: ' || n || ' rows' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C9 classmate reads a SHARED task''s photo object' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  BEGIN
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'log-photos' AND name = unshared_path;
    log := log || 'C10 classmate cannot read an UNSHARED task''s photo object' || E'\t'
        || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: leaked' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C10 classmate cannot read an UNSHARED task''s photo object' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n'; END;

  PERFORM set_config('probe.results', log, true);
END $$;
RESET ROLE;

-- C11 fixture, as owner. One DRAFT announcement in grpA (published_at NULL,
-- written directly -- the editor runs as owner, so the INSERT policy is not
-- in the way). stu re-joins grpA as an active member: C8 closed the earlier
-- membership, and C11 is about a CURRENT member, not a former one.
DO $$
DECLARE adv UUID; stu UUID; grpA UUID; draft UUID;
BEGIN
  PERFORM set_config('probe.draft', '', true);
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  adv := current_setting('probe.adv')::uuid; stu := current_setting('probe.stu')::uuid;
  grpA := current_setting('probe.grpA')::uuid;
  UPDATE group_memberships SET left_at = now() WHERE student_id = stu AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grpA, stu);
  INSERT INTO feed_posts (group_id, author_id, kind, body, published_at)
  VALUES (grpA, adv, 'announcement', 'not yet', NULL) RETURNING id INTO draft;
  PERFORM set_config('probe.draft', draft::text, true);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE stu UUID; grpA UUID; draft UUID; n INT; m INT; ins TEXT; log TEXT;
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  log := current_setting('probe.results', true);
  stu := current_setting('probe.stu')::uuid; grpA := current_setting('probe.grpA')::uuid;
  draft := current_setting('probe.draft')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);

  -- Three doors, one rule: the row (feed_posts_select), a child write that
  -- routes through can_see_post (feed_comments_insert), and the RPC.
  BEGIN
    SELECT count(*) INTO n FROM feed_posts WHERE id = draft;
    BEGIN
      INSERT INTO feed_comments (post_id, author_id, body) VALUES (draft, stu, 'x');
      ins := 'FAIL: comment accepted';
    EXCEPTION WHEN OTHERS THEN
      ins := CASE WHEN SQLSTATE = '42501' THEN 'refused 42501' ELSE 'FAIL: ' || SQLSTATE || ' ' || SQLERRM END;
    END;
    SELECT count(*) INTO m FROM list_feed_posts(grpA) AS r WHERE r->>'id' = draft::text;
    log := log || 'C11 member cannot see a draft, comment on it, or list it' || E'\t'
        || CASE WHEN n = 0 AND ins = 'refused 42501' AND m = 0 THEN '0 rows, refused 42501, not listed'
                ELSE 'FAIL: ' || n || ' rows, ' || ins || ', ' || CASE WHEN m = 0 THEN 'not listed' ELSE 'listed' END END || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C11 member cannot see a draft, comment on it, or list it' || E'\t' || 'ABORTED: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  END;

  PERFORM set_config('probe.results', log, true);
END $$;
RESET ROLE;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;
