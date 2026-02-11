-- Fix: allow mentor/advisor to create notifications for assigned students
-- Run in Supabase SQL Editor

DROP POLICY IF EXISTS notifications_insert ON public.notifications;

CREATE POLICY notifications_insert ON public.notifications
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR is_mentor_of(user_id)
  OR is_advisor_of(user_id)
);
