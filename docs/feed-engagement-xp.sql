-- docs/feed-engagement-xp.sql — idempotent. Apply after docs/group-feed-migration.sql
-- and docs/gamification-server-side-migration.sql (it calls award_xp_internal).
--
-- Small XP for talking to each other in the stream: a like is worth 1 XP, a
-- comment 2 XP, at most 3 paid likes and 3 paid comments per day (9 XP/day, under
-- half of one approved task at 20 XP). Likes and comments are written straight to
-- their tables by the client (feed_likes / feed_comments carry INSERT policies),
-- so the award rides an AFTER INSERT trigger and the client changes nothing.
--
-- Five rules keep it from being farmed:
--   1. one payment per (student, post, kind) — unlike/relike never pays twice;
--   2. the daily cap above, counted on the SERVER date (UTC);
--   3. nothing for liking or commenting on your own post;
--   4. only students earn (an advisor/mentor has no student_profiles row);
--   5. a comment pays only from 10 characters, so "+1" and a lone emoji do not.
-- A deleted comment is not refunded, and rule 1 means re-posting it pays nothing.

-- ------------------------------------------------------------
-- 1. The award ledger
-- ------------------------------------------------------------
-- Its own table rather than a column on xp_transactions: the "already paid"
-- fact needs (student, post, kind) as a key, and the XP ledger stays untouched.
-- Written only by the SECURITY DEFINER trigger below — RLS on, no policy, no
-- grant, so no client can read or write it.
CREATE TABLE IF NOT EXISTS feed_engagement_awards (
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id    UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('like', 'comment')),
  amount     INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, post_id, kind)
);

ALTER TABLE feed_engagement_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON feed_engagement_awards FROM PUBLIC, anon, authenticated;

-- The daily cap reads this index.
CREATE INDEX IF NOT EXISTS idx_feed_engagement_awards_student_day
  ON feed_engagement_awards(student_id, kind, created_at);

-- ------------------------------------------------------------
-- 2. The one place the rules live
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION feed_engagement_award(
  p_student UUID,
  p_post    UUID,
  p_kind    TEXT,
  p_amount  INTEGER,
  p_cap     INTEGER
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_author UUID;
  v_rows   INTEGER;
BEGIN
  -- Rule 4: only students have an XP balance to add to.
  IF NOT EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.id = p_student) THEN
    RETURN;
  END IF;

  -- Rule 3: your own post pays nothing. A task post's author is the student
  -- whose submission it is, so this covers liking your own approved work.
  SELECT fp.author_id INTO v_author FROM feed_posts fp WHERE fp.id = p_post;
  IF v_author IS NULL OR v_author = p_student THEN
    RETURN;
  END IF;

  -- Rule 1 (cheap pre-check; the primary key below is what actually enforces it).
  IF EXISTS (
    SELECT 1 FROM feed_engagement_awards a
    WHERE a.student_id = p_student AND a.post_id = p_post AND a.kind = p_kind
  ) THEN
    RETURN;
  END IF;

  -- Rule 2. Checked BEFORE the ledger row is written, so a capped day does not
  -- burn the post's one payment: the like still stands, it simply pays nothing,
  -- and the same post can pay on another day.
  IF (
    SELECT count(*) FROM feed_engagement_awards a
    WHERE a.student_id = p_student AND a.kind = p_kind
      AND a.created_at >= date_trunc('day', now())
  ) >= p_cap THEN
    RETURN;
  END IF;

  INSERT INTO feed_engagement_awards (student_id, post_id, kind, amount)
  VALUES (p_student, p_post, p_kind, p_amount)
  ON CONFLICT (student_id, post_id, kind) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- Lost the race against a concurrent insert: the other one paid.
  IF v_rows = 0 THEN
    RETURN;
  END IF;

  PERFORM award_xp_internal(p_student, p_amount, 'feed_' || p_kind, NULL);
END;
$$;

-- ------------------------------------------------------------
-- 3. The triggers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_feed_like_xp()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM feed_engagement_award(NEW.user_id, NEW.post_id, 'like', 1, 3);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feed_likes_award_xp ON feed_likes;
CREATE TRIGGER feed_likes_award_xp
  AFTER INSERT ON feed_likes
  FOR EACH ROW EXECUTE FUNCTION trg_feed_like_xp();

CREATE OR REPLACE FUNCTION trg_feed_comment_xp()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Rule 5: a comment has to say something.
  IF char_length(btrim(NEW.body)) < 10 THEN
    RETURN NEW;
  END IF;
  PERFORM feed_engagement_award(NEW.author_id, NEW.post_id, 'comment', 2, 3);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feed_comments_award_xp ON feed_comments;
CREATE TRIGGER feed_comments_award_xp
  AFTER INSERT ON feed_comments
  FOR EACH ROW EXECUTE FUNCTION trg_feed_comment_xp();

-- ------------------------------------------------------------
-- 4. Internal only (the 2026-09-20 hardening's rule: nothing extra for anon)
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION feed_engagement_award(UUID, UUID, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- Verification (expected: one NOTICE, no exception)
DO $$
DECLARE n INTEGER;
BEGIN
  IF to_regclass('public.feed_engagement_awards') IS NULL THEN
    RAISE EXCEPTION 'FAIL: feed_engagement_awards missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'feed_likes_award_xp' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: feed_likes trigger missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'feed_comments_award_xp' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: feed_comments trigger missing'; END IF;
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relname = 'feed_engagement_awards' AND c.relrowsecurity;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: RLS is off on feed_engagement_awards'; END IF;
  IF has_function_privilege('authenticated', 'feed_engagement_award(uuid,uuid,text,integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'feed_engagement_award(uuid,uuid,text,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: feed_engagement_award is callable from the client'; END IF;
  RAISE NOTICE 'PASS: stream engagement XP installed (like 1, comment 2, 3+3 per day)';
END $$;
NOTIFY pgrst, 'reload schema';
