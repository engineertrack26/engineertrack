-- Fix student log save/submit failures
-- Run in Supabase SQL Editor

-- 1) Ensure column exists (used by app payload)
ALTER TABLE public.daily_logs
ADD COLUMN IF NOT EXISTS hours_spent INTEGER DEFAULT 0;

-- 2) Allow students to move own logs from draft/needs_revision to submitted
DROP POLICY IF EXISTS daily_logs_update_student ON public.daily_logs;

CREATE POLICY daily_logs_update_student ON public.daily_logs
FOR UPDATE TO authenticated
USING (
  auth.uid() = student_id
  AND status IN ('draft', 'needs_revision')
)
WITH CHECK (
  auth.uid() = student_id
  AND status IN ('draft', 'submitted', 'needs_revision')
);
