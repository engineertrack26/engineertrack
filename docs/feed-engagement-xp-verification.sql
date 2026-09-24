-- docs/feed-engagement-xp-verification.sql — read-only in effect: Part B runs
-- inside BEGIN .. ROLLBACK, so nothing it writes survives. Run after
-- docs/feed-engagement-xp.sql. Three parts, one at a time.

-- ============================================================
-- PART A — structural
-- ============================================================
-- One query, six rows: the SQL editor shows only the last statement's result.
SELECT * FROM (
  VALUES
    ('A1 table',
     to_regclass('public.feed_engagement_awards') IS NOT NULL),
    ('A2 primary key is (student, post, kind)',
     EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
             WHERE c.relname = 'feed_engagement_awards' AND i.indisprimary
               AND (SELECT count(*) FROM unnest(i.indkey)) = 3)),
    ('A3 RLS on, no policy',
     coalesce((SELECT relrowsecurity FROM pg_class WHERE relname = 'feed_engagement_awards'), false)
       AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feed_engagement_awards')),
    ('A4 both triggers present',
     (SELECT count(*) FROM pg_trigger
      WHERE tgname IN ('feed_likes_award_xp', 'feed_comments_award_xp') AND NOT tgisinternal) = 2),
    ('A5 helper not callable by clients',
     NOT has_function_privilege('authenticated', 'feed_engagement_award(uuid,uuid,text,integer,integer)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'feed_engagement_award(uuid,uuid,text,integer,integer)', 'EXECUTE')),
    ('A6 no table grant to clients',
     NOT has_table_privilege('authenticated', 'feed_engagement_awards', 'SELECT')
       AND NOT has_table_privilege('anon', 'feed_engagement_awards', 'SELECT'))
) AS t(check_name, ok)
ORDER BY check_name;

-- ============================================================
-- PART B — behaviour. Everything is rolled back at the end.
-- Actors come from the live simulation group; nothing is hard-coded.
-- Results come back as a RESULT SET (the SQL editor does not show NOTICE),
-- and a failed check is recorded rather than raised, so one failure does not
-- hide the checks after it.
-- ============================================================
BEGIN;
DO $$
DECLARE
  v_group   UUID;
  v_post    UUID;
  v_author  UUID;   -- the student who owns the post
  v_other   UUID;   -- another student in the same group
  v_staff   UUID;   -- the group's advisor
  v_before  INTEGER;
  v_after   INTEGER;
  v_base    INTEGER;
  v_post2   UUID;
  v_post3   UUID;
  v_post4   UUID;
  v_log     TEXT := '';
BEGIN
  SELECT g.id, g.advisor_id INTO v_group, v_staff
  FROM internship_groups g WHERE g.join_code = '58MMWL';
  IF v_group IS NULL THEN
    PERFORM set_config('probe.results', 'SKIP: simulation group 58MMWL not found', true);
    RETURN;
  END IF;

  SELECT fp.id, fp.author_id INTO v_post, v_author
  FROM feed_posts fp
  JOIN student_profiles sp ON sp.id = fp.author_id
  WHERE fp.group_id = v_group AND fp.published_at IS NOT NULL
  ORDER BY fp.created_at LIMIT 1;
  IF v_post IS NULL THEN
    PERFORM set_config('probe.results', 'SKIP: no student-authored post in the group', true);
    RETURN;
  END IF;

  SELECT m.student_id INTO v_other
  FROM group_memberships m
  WHERE m.group_id = v_group AND m.left_at IS NULL AND m.student_id <> v_author
  LIMIT 1;
  IF v_other IS NULL THEN
    PERFORM set_config('probe.results', 'SKIP: no second student in the group', true);
    RETURN;
  END IF;

  -- B1: a like on someone else's post pays 1 XP. The simulation may already
  -- have left a like here (written before this trigger existed), so clear it.
  DELETE FROM feed_likes WHERE post_id = v_post AND user_id = v_other;
  SELECT total_xp INTO v_base FROM student_profiles WHERE id = v_other;
  INSERT INTO feed_likes (post_id, user_id) VALUES (v_post, v_other);
  SELECT total_xp INTO v_after FROM student_profiles WHERE id = v_other;
  v_log := v_log || CASE
    WHEN v_after - v_base = 1
      AND EXISTS (SELECT 1 FROM xp_transactions WHERE student_id = v_other
                  AND reason = 'feed_like' AND created_at >= now() - interval '1 minute')
    THEN 'PASS B1: like pays 1 XP'
    ELSE 'FAIL B1: like paid ' || (v_after - v_base) || ' XP, expected 1'
  END || chr(10);

  -- B2: unlike then like again pays nothing the second time.
  DELETE FROM feed_likes WHERE post_id = v_post AND user_id = v_other;
  INSERT INTO feed_likes (post_id, user_id) VALUES (v_post, v_other);
  SELECT total_xp INTO v_after FROM student_profiles WHERE id = v_other;
  v_log := v_log || CASE
    WHEN v_after - v_base = 1 THEN 'PASS B2: unlike/relike pays once'
    ELSE 'FAIL B2: unlike/relike total delta ' || (v_after - v_base)
  END || chr(10);

  -- B3: the daily cap stops the fourth like of the day, and the capped like
  -- does not burn that post's one payment.
  SELECT fp.id INTO v_post2 FROM feed_posts fp WHERE fp.group_id = v_group
    AND fp.published_at IS NOT NULL AND fp.author_id <> v_other AND fp.id <> v_post
    ORDER BY fp.created_at LIMIT 1;
  SELECT fp.id INTO v_post3 FROM feed_posts fp WHERE fp.group_id = v_group
    AND fp.published_at IS NOT NULL AND fp.author_id <> v_other AND fp.id NOT IN (v_post, v_post2)
    ORDER BY fp.created_at LIMIT 1;
  SELECT fp.id INTO v_post4 FROM feed_posts fp WHERE fp.group_id = v_group
    AND fp.published_at IS NOT NULL AND fp.author_id <> v_other AND fp.id NOT IN (v_post, v_post2, v_post3)
    ORDER BY fp.created_at LIMIT 1;
  IF v_post2 IS NULL OR v_post3 IS NULL OR v_post4 IS NULL THEN
    v_log := v_log || 'SKIP B3: fewer than four eligible posts in the group' || chr(10);
  ELSE
    DELETE FROM feed_likes WHERE user_id = v_other AND post_id IN (v_post2, v_post3, v_post4);
    INSERT INTO feed_likes (post_id, user_id) VALUES (v_post2, v_other);
    INSERT INTO feed_likes (post_id, user_id) VALUES (v_post3, v_other);
    SELECT total_xp INTO v_before FROM student_profiles WHERE id = v_other;
    INSERT INTO feed_likes (post_id, user_id) VALUES (v_post4, v_other);
    SELECT total_xp INTO v_after FROM student_profiles WHERE id = v_other;
    v_log := v_log || CASE
      WHEN v_before - v_base = 3 AND v_after = v_before
        AND NOT EXISTS (SELECT 1 FROM feed_engagement_awards
                        WHERE student_id = v_other AND post_id = v_post4 AND kind = 'like')
      THEN 'PASS B3: cap holds at three, the capped like keeps its slot'
      ELSE 'FAIL B3: three likes gave ' || (v_before - v_base) || ', the fourth added ' || (v_after - v_before)
    END || chr(10);
  END IF;

  -- B4: your own post pays nothing.
  SELECT total_xp INTO v_before FROM student_profiles WHERE id = v_author;
  DELETE FROM feed_likes WHERE post_id = v_post AND user_id = v_author;
  INSERT INTO feed_likes (post_id, user_id) VALUES (v_post, v_author);
  SELECT total_xp INTO v_after FROM student_profiles WHERE id = v_author;
  v_log := v_log || CASE
    WHEN v_after = v_before THEN 'PASS B4: your own post pays nothing'
    ELSE 'FAIL B4: own post paid ' || (v_after - v_before)
  END || chr(10);

  -- B5: staff earn nothing and nothing breaks.
  DELETE FROM feed_likes WHERE post_id = v_post AND user_id = v_staff;
  INSERT INTO feed_likes (post_id, user_id) VALUES (v_post, v_staff);
  v_log := v_log || CASE
    WHEN NOT EXISTS (SELECT 1 FROM xp_transactions WHERE student_id = v_staff
                     AND created_at >= now() - interval '1 minute')
    THEN 'PASS B5: advisor earns nothing'
    ELSE 'FAIL B5: the advisor earned XP'
  END || chr(10);

  -- B6: a comment pays 2 XP from ten characters, nothing below, once per post.
  SELECT total_xp INTO v_before FROM student_profiles WHERE id = v_other;
  INSERT INTO feed_comments (post_id, author_id, body) VALUES (v_post, v_other, '+1');
  SELECT total_xp INTO v_after FROM student_profiles WHERE id = v_other;
  IF v_after <> v_before THEN
    v_log := v_log || 'FAIL B6: a two-character comment paid ' || (v_after - v_before) || chr(10);
  ELSE
    INSERT INTO feed_comments (post_id, author_id, body)
    VALUES (v_post, v_other, 'Olcum yontemini ben de denedim, tesekkurler.');
    SELECT total_xp INTO v_after FROM student_profiles WHERE id = v_other;
    INSERT INTO feed_comments (post_id, author_id, body)
    VALUES (v_post, v_other, 'Bir de su kaynaga bakabilirsin, faydali oldu.');
    SELECT total_xp INTO v_base FROM student_profiles WHERE id = v_other;
    v_log := v_log || CASE
      WHEN v_after - v_before = 2 AND v_base = v_after
      THEN 'PASS B6: comment pays 2 XP once, short comments pay nothing'
      ELSE 'FAIL B6: the real comment gave ' || (v_after - v_before) || ', the second gave ' || (v_base - v_after)
    END || chr(10);
  END IF;

  PERFORM set_config('probe.results', v_log, true);
END $$;

-- the result set the editor shows
SELECT btrim(line) AS result
FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE btrim(line) <> '';
ROLLBACK;

-- ============================================================
-- PART C — the ledger under the client's own role. Results as a result set.
-- ============================================================
BEGIN;
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_log TEXT := '';
BEGIN
  BEGIN
    PERFORM 1 FROM feed_engagement_awards LIMIT 1;
    v_log := v_log || 'FAIL C1: authenticated can read feed_engagement_awards' || chr(10);
  EXCEPTION WHEN insufficient_privilege THEN
    v_log := v_log || 'PASS C1: reading the ledger is refused' || chr(10);
  END;
  BEGIN
    INSERT INTO feed_engagement_awards (student_id, post_id, kind, amount)
    VALUES (gen_random_uuid(), gen_random_uuid(), 'like', 999);
    v_log := v_log || 'FAIL C2: authenticated can write feed_engagement_awards' || chr(10);
  EXCEPTION WHEN insufficient_privilege THEN
    v_log := v_log || 'PASS C2: writing the ledger is refused' || chr(10);
  END;
  BEGIN
    PERFORM feed_engagement_award(gen_random_uuid(), gen_random_uuid(), 'like', 999, 999);
    v_log := v_log || 'FAIL C3: authenticated can call feed_engagement_award' || chr(10);
  EXCEPTION WHEN insufficient_privilege THEN
    v_log := v_log || 'PASS C3: calling the helper is refused' || chr(10);
  END;
  PERFORM set_config('probe.results', v_log, true);
END $$;

SELECT btrim(line) AS result
FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE btrim(line) <> '';
ROLLBACK;
