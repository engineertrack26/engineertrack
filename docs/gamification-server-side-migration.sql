-- ============================================================
-- GAMIFICATION SERVER-SIDE MIGRATION
-- Moves all XP / streak / badge writes from the client into
-- SECURITY DEFINER trigger functions, and revokes direct client
-- write access to gamification tables and columns.
--
-- Why: previously any student could call the Supabase REST API
-- directly (anon key + own JWT) and insert arbitrary amounts into
-- xp_transactions, update student_profiles.total_xp, or grant
-- themselves badges. RLS only checked row ownership, not amounts.
-- This also fixes mentor-approval XP, which silently failed under
-- the old RLS (mentor could not insert XP for the student).
--
-- Run in Supabase SQL Editor.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Level calculation (mirrors LEVELS in src/types/gamification.ts)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_level(p_xp INTEGER)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_xp >= 4500 THEN 10
    WHEN p_xp >= 3600 THEN 9
    WHEN p_xp >= 2800 THEN 8
    WHEN p_xp >= 2100 THEN 7
    WHEN p_xp >= 1500 THEN 6
    WHEN p_xp >= 1000 THEN 5
    WHEN p_xp >= 600 THEN 4
    WHEN p_xp >= 300 THEN 3
    WHEN p_xp >= 100 THEN 2
    ELSE 1
  END;
$$;

-- ------------------------------------------------------------
-- 2. Internal helpers (NOT callable by clients)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION award_xp_internal(
  p_student UUID,
  p_amount INTEGER,
  p_reason TEXT,
  p_log UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_total INTEGER;
  v_old_level INTEGER;
  v_new_level INTEGER;
BEGIN
  INSERT INTO xp_transactions (student_id, amount, reason, log_id)
  VALUES (p_student, p_amount, p_reason, p_log);

  UPDATE student_profiles
  SET total_xp = GREATEST(total_xp + p_amount, 0)
  WHERE id = p_student
  RETURNING total_xp, current_level INTO v_new_total, v_old_level;

  v_new_level := calculate_level(v_new_total);

  IF v_new_level <> v_old_level THEN
    UPDATE student_profiles SET current_level = v_new_level WHERE id = p_student;

    IF v_new_level > v_old_level THEN
      INSERT INTO notifications (user_id, title, body, type, data)
      VALUES (
        p_student,
        'Level Up!',
        'Congratulations! You reached Level ' || v_new_level || '!',
        'level_up',
        jsonb_build_object('newLevel', v_new_level, 'totalXp', v_new_total)
      );
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION award_badge_internal(p_student UUID, p_badge_key TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  INSERT INTO earned_badges (student_id, badge_key)
  VALUES (p_student, p_badge_key)
  ON CONFLICT (student_id, badge_key) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    INSERT INTO notifications (user_id, title, body, type, data)
    VALUES (
      p_student,
      'Badge Earned!',
      'You earned the "' || p_badge_key || '" badge! Keep up the great work!',
      'badge_earned',
      jsonb_build_object('badgeKey', p_badge_key)
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION award_xp_internal(UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION award_badge_internal(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. Daily log gamification trigger
--    Point values mirror POINT_VALUES in src/types/gamification.ts
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_log_gamification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_photos INTEGER;
  v_prev_date DATE;
  v_streak INTEGER;
BEGIN
  -- A) First-time submission: draft -> submitted (or inserted as submitted).
  --    Revision resubmits (needs_revision -> revised) earn nothing, and the
  --    xp_transactions guard makes the award idempotent either way.
  IF NEW.status = 'submitted'
     AND (TG_OP = 'INSERT' OR OLD.status = 'draft')
     AND NOT EXISTS (
       SELECT 1 FROM xp_transactions
       WHERE log_id = NEW.id AND reason = 'daily_log_submit'
     )
  THEN
    PERFORM award_xp_internal(NEW.student_id, 10, 'daily_log_submit', NEW.id);

    -- Photo bonus: 3 XP per photo attached at submit time (capped at 5 photos)
    SELECT COUNT(*) INTO v_photos FROM log_photos WHERE log_id = NEW.id;
    IF v_photos > 0 THEN
      PERFORM award_xp_internal(NEW.student_id, 3 * LEAST(v_photos, 5), 'photo_attached', NEW.id);
    END IF;

    -- Self-assessment bonus (saved before submit in the client flow)
    IF EXISTS (SELECT 1 FROM self_assessments WHERE log_id = NEW.id) THEN
      PERFORM award_xp_internal(NEW.student_id, 5, 'self_assessment', NEW.id);
    END IF;

    -- First log badge
    PERFORM award_badge_internal(NEW.student_id, 'first_log');

    -- Streak: consecutive-day submissions (by log date)
    SELECT MAX(date) INTO v_prev_date
    FROM daily_logs
    WHERE student_id = NEW.student_id AND id <> NEW.id AND status <> 'draft';

    IF v_prev_date = NEW.date - 1 THEN
      SELECT current_streak + 1 INTO v_streak
      FROM student_profiles WHERE id = NEW.student_id;
    ELSE
      v_streak := 1;
    END IF;

    UPDATE student_profiles
    SET current_streak = v_streak,
        longest_streak = GREATEST(longest_streak, v_streak)
    WHERE id = NEW.student_id;

    IF v_streak >= 30 THEN
      PERFORM award_badge_internal(NEW.student_id, 'streak_30');
    ELSIF v_streak >= 7 THEN
      PERFORM award_badge_internal(NEW.student_id, 'streak_7');
    END IF;
  END IF;

  -- B) Mentor approval: award once per log
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'approved'
     AND OLD.status IS DISTINCT FROM 'approved'
     AND NOT EXISTS (
       SELECT 1 FROM xp_transactions
       WHERE log_id = NEW.id AND reason = 'log_approved'
     )
  THEN
    PERFORM award_xp_internal(NEW.student_id, 20, 'log_approved', NEW.id);
  END IF;

  -- Keep the per-log XP total in sync for display (LogCard shows xpEarned).
  -- This self-UPDATE re-fires the trigger, but no branch matches (status
  -- unchanged), so it cannot recurse further.
  UPDATE daily_logs
  SET xp_earned = COALESCE(
    (SELECT SUM(amount) FROM xp_transactions WHERE log_id = NEW.id), 0)
  WHERE id = NEW.id
    AND xp_earned IS DISTINCT FROM COALESCE(
      (SELECT SUM(amount) FROM xp_transactions WHERE log_id = NEW.id), 0);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_logs_gamification ON daily_logs;
CREATE TRIGGER trg_daily_logs_gamification
  AFTER INSERT OR UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION handle_log_gamification();

-- ------------------------------------------------------------
-- 4. Poll completion gamification trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_poll_gamification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_poll_type TEXT;
  v_total INTEGER;
  v_correct INTEGER;
  v_responses INTEGER;
BEGIN
  -- Only students earn XP (mentors can also answer polls)
  IF NOT EXISTS (SELECT 1 FROM student_profiles WHERE id = NEW.user_id) THEN
    RETURN NEW;
  END IF;

  PERFORM award_xp_internal(NEW.user_id, 15, 'poll_completed', NULL);

  -- Perfect quiz bonus: recompute correctness server-side from answers,
  -- never trust the client-supplied score column.
  SELECT poll_type INTO v_poll_type FROM polls WHERE id = NEW.poll_id;
  IF v_poll_type = 'quiz' THEN
    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE (NEW.answers ->> q.id::text) = q.correct_option_id::text)
    INTO v_total, v_correct
    FROM poll_questions q
    WHERE q.poll_id = NEW.poll_id AND q.correct_option_id IS NOT NULL;

    IF v_total > 0 AND v_correct = v_total THEN
      PERFORM award_xp_internal(NEW.user_id, 25, 'quiz_perfect_score', NULL);
    END IF;
  END IF;

  -- Quiz master badge: 5+ poll responses
  SELECT COUNT(*) INTO v_responses FROM poll_responses WHERE user_id = NEW.user_id;
  IF v_responses >= 5 THEN
    PERFORM award_badge_internal(NEW.user_id, 'quiz_master');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_poll_responses_gamification ON poll_responses;
CREATE TRIGGER trg_poll_responses_gamification
  AFTER INSERT ON poll_responses
  FOR EACH ROW EXECUTE FUNCTION handle_poll_gamification();

-- ------------------------------------------------------------
-- 5. Lock down direct client writes
-- ------------------------------------------------------------

-- No client may insert XP or badges anymore (triggers run as definer
-- and bypass RLS, so they are unaffected).
DROP POLICY IF EXISTS "xp_transactions_insert" ON xp_transactions;
DROP POLICY IF EXISTS "earned_badges_insert" ON earned_badges;

-- Students may still edit their internship info, but never the
-- gamification columns (total_xp, current_level, current_streak,
-- longest_streak) — enforced with column-level privileges, which
-- PostgREST respects. INSERT is restricted too so registration
-- cannot seed a non-zero total_xp.
REVOKE INSERT, UPDATE ON student_profiles FROM anon, authenticated;
GRANT INSERT (
  id, university, faculty, department, department_branch, student_id,
  mentor_id, advisor_id, internship_start_date, internship_end_date,
  company_name, company_address, company_sector
) ON student_profiles TO authenticated;
GRANT UPDATE (
  university, faculty, department, department_branch, student_id,
  mentor_id, advisor_id, internship_start_date, internship_end_date,
  company_name, company_address, company_sector
) ON student_profiles TO authenticated;

-- daily_logs.xp_earned is now maintained by the trigger only.
-- (Column REVOKE alone cannot narrow a table-wide grant, so re-grant
-- everything except xp_earned / created_at.)
REVOKE INSERT, UPDATE ON daily_logs FROM anon, authenticated;
GRANT INSERT (
  student_id, date, title, content, activities_performed, skills_learned,
  challenges_faced, status, hours_spent, updated_at
) ON daily_logs TO authenticated;
GRANT UPDATE (
  date, title, content, activities_performed, skills_learned,
  challenges_faced, status, hours_spent, advisor_notes,
  advisor_validated_at, updated_at
) ON daily_logs TO authenticated;
