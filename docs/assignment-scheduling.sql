-- docs/assignment-scheduling.sql
-- Sending a task can be scheduled.
-- Spec: docs/superpowers/specs/2026-10-10-assignment-scheduling-design.md
--
-- APPLY ORDER: after docs/assignment-targeting.sql and
-- docs/assignment-targeting-followups.sql. Idempotent, anonymous $$ only.
--
-- THIS FILE IS NOW THE HOME OF publish_assignments (was
-- docs/assignment-targeting.sql, which carries a NOTE saying so). Re-running
-- that file restores a publish_assignments that knows nothing about
-- scheduling or notifications.
--
-- APPLY TOGETHER WITH THE CLIENT CHANGE. This file moves the "New Task
-- Assigned" notifications into publish_assignments_internal, but
-- app/(advisor)/group-assignments.tsx still inserts them itself after a
-- publish. From the moment this file is applied until the client change that
-- removes that loop ships, every publish notifies every student twice. The
-- loop is removed in the same piece of work as this file; do not leave the
-- window open.
--
-- REQUIRES the pg_cron extension, enabled once in the Supabase dashboard
-- (Database -> Extensions) BEFORE this file is pasted: the job is registered
-- at the bottom, and a failure there rolls the whole file back.
-- ============================================

-- ---- 1. The third state ----
-- scheduled_for set with published_at still NULL is "scheduled". It is
-- deliberately NOT a future published_at: every existing rule tests
-- `published_at IS NOT NULL`, and rewriting all of them to `<= now()` would
-- make a missed one leak a scheduled task early. With a separate column the
-- worst case is a task that goes out a minute late.
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

-- Why the send failed at its scheduled time. Non-NULL also means "do not try
-- again": without it the job would retry and re-notify every minute forever.
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS schedule_error TEXT;

-- The job's only query. Partial, because the due set is tiny next to the table.
CREATE INDEX IF NOT EXISTS group_assignments_due_idx
  ON group_assignments (scheduled_for)
  WHERE published_at IS NULL AND scheduled_for IS NOT NULL AND schedule_error IS NULL;

-- ---- 2. The shared publish ----
-- A human tap and the timer must do the same thing, so the body lives here and
-- both call it. No identity check: the public wrapper does that, and the cron
-- job has no auth.uid() to check.
CREATE OR REPLACE FUNCTION publish_assignments_internal(p_ids UUID[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bad_title  TEXT;
  moved_ids  UUID[];
  one_title  TEXT;
  n          INT;
BEGIN
  -- Scope re-check. trg_assignment_within_scope is BEFORE INSERT only, so a
  -- competency dropped from the group's targets after drafting is caught here
  -- or not at all. Named title, not just a refusal.
  SELECT a.title INTO bad_title
  FROM group_assignments a
  JOIN kpi_triplets t    ON t.id = a.triplet_id
  JOIN competency_kpis k ON k.id = t.kpi_id
  WHERE a.id = ANY(p_ids)
    AND NOT EXISTS (
      SELECT 1 FROM group_competency_targets gt
      WHERE gt.group_id = a.group_id AND gt.competency_id = k.competency_id
    )
  LIMIT 1;
  IF bad_title IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_IN_SCOPE: %', bad_title;
  END IF;

  -- A 'selected' assignment naming nobody would reach no one at all.
  SELECT a.title INTO bad_title
  FROM group_assignments a
  WHERE a.id = ANY(p_ids)
    AND a.published_at IS NULL
    AND a.audience = 'selected'
    AND NOT EXISTS (SELECT 1 FROM assignment_targets tg WHERE tg.assignment_id = a.id)
  LIMIT 1;
  IF bad_title IS NOT NULL THEN
    RAISE EXCEPTION 'TARGETS_REQUIRED: %', bad_title;
  END IF;

  -- NEW: a group can be archived between scheduling and the hour. Publishing
  -- into an archived group would put a task in front of students whose
  -- internship the advisor has already wound up.
  IF EXISTS (
    SELECT 1 FROM group_assignments a
    JOIN internship_groups g ON g.id = a.group_id
    WHERE a.id = ANY(p_ids) AND g.is_archived
  ) THEN
    RAISE EXCEPTION 'GROUP_ARCHIVED';
  END IF;

  -- Only drafts move, and we keep exactly which ones did. Re-publishing an
  -- already-sent task must not rewrite its published_at -- that timestamp is
  -- the record of when students first saw it -- and must not notify again:
  -- the cron job and a "Send now" tap can reach the same row in the same
  -- second, and p_ids would tell us nothing about which of them won.
  WITH upd AS (
    UPDATE group_assignments
       SET published_at = now(), scheduled_for = NULL, schedule_error = NULL
     WHERE id = ANY(p_ids) AND published_at IS NULL
    RETURNING id, title
  )
  SELECT array_agg(id), CASE WHEN count(*) = 1 THEN min(title) END
    INTO moved_ids, one_title
  FROM upd;

  n := coalesce(array_length(moved_ids, 1), 0);
  IF n = 0 THEN
    RETURN 0;
  END IF;

  -- One notification per student for the whole batch, not one per task: three
  -- tasks sent together are one event to the student. The English wording is
  -- load-bearing -- src/utils/notificationContent.ts matches these exact
  -- templates to render Turkish, and a reworded string silently falls back to
  -- English.
  INSERT INTO notifications (user_id, title, body, type, data)
  SELECT r.student_id,
         'New Task Assigned',
         CASE WHEN n = 1
              THEN 'A new task has been assigned: "' || coalesce(one_title, '') || '".'
              ELSE n || ' new tasks have been assigned.'
         END,
         'task_assigned',
         '{}'::jsonb
  FROM (
    -- A group-audience task in the batch puts the whole group in the set,
    -- whatever any other task in the batch narrows to.
    SELECT m.student_id
    FROM group_assignments a
    JOIN group_memberships m ON m.group_id = a.group_id AND m.left_at IS NULL
    WHERE a.id = ANY(moved_ids) AND a.audience = 'group'
    UNION
    SELECT tg.student_id
    FROM group_assignments a
    JOIN assignment_targets tg ON tg.assignment_id = a.id
    JOIN group_memberships m   ON m.group_id = a.group_id
                              AND m.student_id = tg.student_id
                              AND m.left_at IS NULL
    WHERE a.id = ANY(moved_ids) AND a.audience = 'selected'
  ) r;

  RETURN n;
END;
$$;

-- Only callers inside the database, exactly like feed_publish_assignment.
REVOKE EXECUTE ON FUNCTION publish_assignments_internal(UUID[]) FROM PUBLIC, anon, authenticated;

-- ---- 3. publish_assignments: NEW HOME, now a thin wrapper ----
CREATE OR REPLACE FUNCTION publish_assignments(p_ids UUID[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- SECURITY DEFINER has no RLS of its own, so ownership is checked here or
  -- not at all. Any row in the batch the caller does not own refuses the batch.
  IF EXISTS (
    SELECT 1 FROM group_assignments a
    WHERE a.id = ANY(p_ids) AND NOT owns_group(a.group_id)
  ) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  RETURN publish_assignments_internal(p_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION publish_assignments(UUID[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION publish_assignments(UUID[]) FROM PUBLIC, anon;

-- ---- 4. Writing the schedule ----
-- Runs at schedule time every check publishing runs, because at 15:00 nobody
-- is there to read an alert. p_at NULL cancels.
CREATE OR REPLACE FUNCTION schedule_assignments(p_ids UUID[], p_at TIMESTAMPTZ)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bad_title TEXT;
  n INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM group_assignments a
    WHERE a.id = ANY(p_ids) AND NOT owns_group(a.group_id)
  ) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  -- A sent task cannot be un-sent by scheduling it again. Refuses the whole
  -- batch rather than scheduling the rest, the same all-or-nothing shape
  -- publishing already has.
  IF EXISTS (
    SELECT 1 FROM group_assignments a
    WHERE a.id = ANY(p_ids) AND a.published_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_PUBLISHED';
  END IF;

  IF p_at IS NOT NULL THEN
    IF p_at <= now() THEN
      RAISE EXCEPTION 'SCHEDULE_IN_PAST';
    END IF;

    -- Same guard publishing has, here so the advisor hears it on screen and
    -- not in a notification the next day. Inside this branch on purpose:
    -- cancelling (p_at NULL) only clears a row and must still work.
    IF EXISTS (
      SELECT 1 FROM group_assignments a
      JOIN internship_groups g ON g.id = a.group_id
      WHERE a.id = ANY(p_ids) AND g.is_archived
    ) THEN
      RAISE EXCEPTION 'GROUP_ARCHIVED';
    END IF;

    SELECT a.title INTO bad_title
    FROM group_assignments a
    JOIN kpi_triplets t    ON t.id = a.triplet_id
    JOIN competency_kpis k ON k.id = t.kpi_id
    WHERE a.id = ANY(p_ids)
      AND NOT EXISTS (
        SELECT 1 FROM group_competency_targets gt
        WHERE gt.group_id = a.group_id AND gt.competency_id = k.competency_id
      )
    LIMIT 1;
    IF bad_title IS NOT NULL THEN
      RAISE EXCEPTION 'NOT_IN_SCOPE: %', bad_title;
    END IF;

    SELECT a.title INTO bad_title
    FROM group_assignments a
    WHERE a.id = ANY(p_ids)
      AND a.audience = 'selected'
      AND NOT EXISTS (SELECT 1 FROM assignment_targets tg WHERE tg.assignment_id = a.id)
    LIMIT 1;
    IF bad_title IS NOT NULL THEN
      RAISE EXCEPTION 'TARGETS_REQUIRED: %', bad_title;
    END IF;
  END IF;

  -- Scheduling afresh clears a previous failure, which is how the advisor
  -- takes a failed row out of the skip list.
  UPDATE group_assignments
     SET scheduled_for = p_at, schedule_error = NULL
   WHERE id = ANY(p_ids) AND published_at IS NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION schedule_assignments(UUID[], TIMESTAMPTZ) TO authenticated;
REVOKE EXECUTE ON FUNCTION schedule_assignments(UUID[], TIMESTAMPTZ) FROM PUBLIC, anon;

-- ---- 5. What runs every minute ----
-- Batches, not rows: rows scheduled together by one action were one decision,
-- and publishing them row by row would turn a batch of three into three
-- notifications. Grouping also keeps the all-or-nothing refusal the manual
-- path has.
CREATE OR REPLACE FUNCTION publish_due_assignments()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b     RECORD;
  total INT := 0;
BEGIN
  -- A run that overruns its minute would otherwise meet the next one on the
  -- same due rows. This is a session-level lock, so it is released explicitly
  -- on every path below: a pooled session is not guaranteed to end with the
  -- statement.
  IF NOT pg_try_advisory_lock(hashtext('publish_due_assignments')) THEN
    RETURN 0;
  END IF;

  -- The outer block exists only so the lock is released even when something
  -- in the loop raises, including the failure handler itself.
  BEGIN
    FOR b IN
      SELECT a.group_id, a.scheduled_for, array_agg(a.id ORDER BY a.created_at) AS ids
      FROM group_assignments a
      WHERE a.published_at IS NULL
        AND a.scheduled_for IS NOT NULL
        AND a.scheduled_for <= now()
        AND a.schedule_error IS NULL
      GROUP BY a.group_id, a.scheduled_for
    LOOP
      BEGIN
        total := total + publish_assignments_internal(b.ids);
      EXCEPTION WHEN OTHERS THEN
        -- BEGIN .. EXCEPTION opens a savepoint, so a refused batch rolls back
        -- only itself and the healthy batches in this run still publish.
        UPDATE group_assignments
           SET schedule_error = left(SQLERRM, 200)
         WHERE id = ANY(b.ids);

        -- Without this the task would simply never arrive and nobody would
        -- know. The job runs inside the database, so it writes the row itself.
        INSERT INTO notifications (user_id, title, body, type, data)
        SELECT g.advisor_id,
               'Scheduled task not sent',
               'A task scheduled for ' || g.name || ' could not be sent: ' || left(SQLERRM, 120),
               'schedule_failed',
               jsonb_build_object('groupId', b.group_id)
        FROM internship_groups g
        WHERE g.id = b.group_id;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('publish_due_assignments'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('publish_due_assignments'));
  RETURN total;
END;
$$;

REVOKE EXECUTE ON FUNCTION publish_due_assignments() FROM PUBLIC, anon, authenticated;

-- ---- 6. The job ----
-- Enabling pg_cron is the owner's dashboard step (Database -> Extensions); this
-- file does not try to do it, so do it BEFORE pasting. The SQL editor runs a
-- pasted file as one implicit transaction: if cron.schedule below fails, the
-- WHOLE file is rolled back -- the columns, the index and all four functions --
-- and the database is left exactly as it was.
-- Idempotent: unschedule first, because cron.schedule on an existing jobname
-- behaves differently across pg_cron versions.
DO $$
BEGIN
  PERFORM cron.unschedule('publish-due-assignments')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-due-assignments');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- no such job, or pg_cron not yet enabled; the SELECT below reports it
END;
$$;

SELECT cron.schedule('publish-due-assignments', '* * * * *',
                     'SELECT publish_due_assignments();');
