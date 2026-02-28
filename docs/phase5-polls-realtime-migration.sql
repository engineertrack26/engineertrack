-- ============================================================
-- Phase 5: Poll/Quiz System + Realtime
-- Run in Supabase SQL Editor
-- ============================================================

-- polls table (created by mentor or advisor)
CREATE TABLE polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  institution_id UUID REFERENCES institutions(id),
  title TEXT NOT NULL,
  description TEXT,
  poll_type TEXT NOT NULL CHECK (poll_type IN ('quiz', 'survey', 'feedback')),
  target_role TEXT NOT NULL DEFAULT 'student' CHECK (target_role IN ('student', 'mentor', 'all')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- poll questions (multiple per poll)
CREATE TABLE poll_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('multiple_choice', 'single_choice', 'text', 'rating')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  correct_option_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- poll options (for choice-type questions)
CREATE TABLE poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES poll_questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- poll responses (one per user per poll)
CREATE TABLE poll_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '{}',
  score INTEGER,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(poll_id, user_id)
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_polls_creator ON polls(creator_id);
CREATE INDEX idx_polls_institution ON polls(institution_id);
CREATE INDEX idx_polls_active ON polls(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_poll_questions_poll ON poll_questions(poll_id);
CREATE INDEX idx_poll_options_question ON poll_options(question_id);
CREATE INDEX idx_poll_responses_poll ON poll_responses(poll_id);
CREATE INDEX idx_poll_responses_user ON poll_responses(user_id);

-- ============================================================
-- Triggers: auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_polls_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER polls_updated_at
  BEFORE UPDATE ON polls
  FOR EACH ROW
  EXECUTE FUNCTION update_polls_updated_at();

-- ============================================================
-- Realtime: Set replica identity for realtime subscriptions
-- ============================================================

ALTER TABLE notifications REPLICA IDENTITY FULL;
ALTER TABLE daily_logs REPLICA IDENTITY FULL;
ALTER TABLE polls REPLICA IDENTITY FULL;

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_responses ENABLE ROW LEVEL SECURITY;

-- Polls: creators can manage, target users can read active polls
CREATE POLICY "Creators can manage their polls"
  ON polls FOR ALL
  USING (creator_id = auth.uid())
  WITH CHECK (creator_id = auth.uid());

CREATE POLICY "Users can view active polls"
  ON polls FOR SELECT
  USING (is_active = TRUE);

-- Questions: viewable if poll is viewable, manageable by poll creator
CREATE POLICY "Users can view poll questions"
  ON poll_questions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM polls WHERE polls.id = poll_questions.poll_id
  ));

CREATE POLICY "Poll creators can manage questions"
  ON poll_questions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM polls WHERE polls.id = poll_questions.poll_id AND polls.creator_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM polls WHERE polls.id = poll_questions.poll_id AND polls.creator_id = auth.uid()
  ));

-- Options: viewable if question is viewable, manageable by poll creator
CREATE POLICY "Users can view poll options"
  ON poll_options FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM poll_questions pq
    JOIN polls p ON p.id = pq.poll_id
    WHERE pq.id = poll_options.question_id
  ));

CREATE POLICY "Poll creators can manage options"
  ON poll_options FOR ALL
  USING (EXISTS (
    SELECT 1 FROM poll_questions pq
    JOIN polls p ON p.id = pq.poll_id
    WHERE pq.id = poll_options.question_id AND p.creator_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM poll_questions pq
    JOIN polls p ON p.id = pq.poll_id
    WHERE pq.id = poll_options.question_id AND p.creator_id = auth.uid()
  ));

-- Responses: users can insert their own, creators can view all for their polls
CREATE POLICY "Users can submit responses"
  ON poll_responses FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view own responses"
  ON poll_responses FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Poll creators can view responses"
  ON poll_responses FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM polls WHERE polls.id = poll_responses.poll_id AND polls.creator_id = auth.uid()
  ));

-- ============================================================
-- IMPORTANT: After running this SQL, enable Realtime on these
-- tables in the Supabase Dashboard:
--   1. notifications
--   2. daily_logs
--   3. polls
-- ============================================================
