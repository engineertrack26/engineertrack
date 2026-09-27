-- docs/assignment-targeting.sql
-- A task can go to selected students, not only the whole group.
-- Spec: docs/superpowers/specs/2026-09-26-assignment-targeting-design.md
--
-- Apply AFTER docs/task-assignment-migration.sql, docs/assignment-drafts-migration.sql,
-- docs/assignment-drafts-rpcs.sql and docs/group-feed-assignment-cards.sql.
-- Apply THIS FILE FIRST, then re-apply docs/review-by-advisor.sql -- its
-- submit_assignment calls can_see_assignment, defined below, and a database
-- that has not seen this file yet does not have it. (The order is about the
-- object existing when submit_assignment is later CALLED, not about the order
-- the two files' CREATE statements run in -- plpgsql does not resolve a
-- callee at creation time -- but re-applying this file first is the one
-- order that needs no such caveat.)
-- Idempotent, anonymous $$ only.
--
-- THIS FILE IS NOW THE HOME OF publish_assignments (was
-- docs/assignment-drafts-rpcs.sql), group_assignment_counts (was
-- docs/task-assignment-rpcs.sql) and the trg_feed_assignment_post trigger
-- (was docs/group-feed-assignment-cards.sql). Re-running any of those three
-- files reverts this feature; each carries a NOTE saying so.
--
-- NOTE (2026-09-27): set_assignment_targets and group_assignment_counts NO
-- LONGER LIVE HERE. docs/assignment-targeting-followups.sql holds the copies
-- that stand -- one exempts a submitter who has LEFT the group from
-- HAS_SUBMISSION (without it, such an assignment can never be re-targeted
-- again), the other counts only active members on the 'selected' branch of
-- target_count. Re-running THIS file restores both older bodies; re-apply
-- docs/assignment-targeting-followups.sql afterwards. The rest of this file
-- still stands.
-- ============================================

-- ---- 1. The audience column ----
-- The default is what every existing row already means: published so far ==
-- published to the whole group. No migration of meaning is needed.
ALTER TABLE group_assignments
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'group';

ALTER TABLE group_assignments DROP CONSTRAINT IF EXISTS group_assignments_audience_check;
ALTER TABLE group_assignments ADD CONSTRAINT group_assignments_audience_check
  CHECK (audience IN ('group', 'selected'));

-- ---- 2. The targets ----
CREATE TABLE IF NOT EXISTS assignment_targets (
  assignment_id UUID NOT NULL REFERENCES group_assignments(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS assignment_targets_student_idx
  ON assignment_targets(student_id);

ALTER TABLE assignment_targets ENABLE ROW LEVEL SECURITY;

-- NO WRITE POLICY, deliberately -- the same rule assignment_submissions and
-- kpi_observations follow. set_assignment_targets is the only writer.
-- A read policy IS needed: the advisor's re-target sheet lists the current
-- targets. It is owner-only; every other role's visibility is decided by the
-- two SECURITY DEFINER predicates below, which bypass this policy.
DROP POLICY IF EXISTS "advisor reads targets" ON assignment_targets;
CREATE POLICY "advisor reads targets" ON assignment_targets
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM group_assignments a
            WHERE a.id = assignment_targets.assignment_id AND owns_group(a.group_id))
  );

-- ---- 3. Who may see an assignment ----
-- SECURITY DEFINER for the same reason owns_group is: a policy must be able to
-- call it without re-entering the policies of the tables it reads.
-- Both predicates require published_at, which is what keeps drafts invisible --
-- the condition the read policy used to carry inline.
CREATE OR REPLACE FUNCTION can_see_assignment(p_assignment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_assignments a
    JOIN group_memberships m ON m.group_id = a.group_id
                            AND m.student_id = auth.uid()
                            AND m.left_at IS NULL
    WHERE a.id = p_assignment_id
      AND a.published_at IS NOT NULL
      AND (a.audience = 'group'
           OR EXISTS (SELECT 1 FROM assignment_targets tg
                      WHERE tg.assignment_id = a.id AND tg.student_id = auth.uid()))
  );
$$;

GRANT EXECUTE ON FUNCTION can_see_assignment(UUID) TO authenticated;
-- Explicit, not left to docs/security-hardening-2026-09-20.sql's ALTER DEFAULT
-- PRIVILEGES REVOKE ... FROM PUBLIC, anon. That net was meant to catch exactly
-- this, and on this database it did not: verification found EXECUTE still
-- granted to PUBLIC (and so to anon) on all six functions below. None of the
-- six is exploitable that way -- each refuses an unauthenticated or
-- non-owning caller on its own -- but it is a defence-in-depth gap this file
-- introduced and every other file with a SECURITY DEFINER function closes
-- explicitly. Do the same here rather than trust the default-privileges net.
REVOKE EXECUTE ON FUNCTION can_see_assignment(UUID) FROM PUBLIC, anon;

-- The mentor sees what THEIR student was given -- not every task in the group,
-- which after targeting would mean showing them tasks their student never had.
CREATE OR REPLACE FUNCTION mentor_sees_assignment(p_assignment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM group_assignments a
    WHERE a.id = p_assignment_id
      AND a.published_at IS NOT NULL
      AND mentors_a_member_of_group(a.group_id)
      AND (a.audience = 'group'
           OR EXISTS (
             SELECT 1
             FROM assignment_targets tg
             JOIN group_memberships m ON m.student_id = tg.student_id
                                     AND m.group_id = a.group_id
                                     AND m.left_at IS NULL
             WHERE tg.assignment_id = a.id AND is_mentor_of(tg.student_id)))
  );
$$;

GRANT EXECUTE ON FUNCTION mentor_sees_assignment(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION mentor_sees_assignment(UUID) FROM PUBLIC, anon;

-- ---- 4. The read policy ----
-- Replaces the version in docs/assignment-drafts-migration.sql. The advisor's
-- branch is unchanged; the other two moved into the predicates above, which
-- keep the published_at condition.
DROP POLICY IF EXISTS "assignments read" ON group_assignments;
CREATE POLICY "assignments read" ON group_assignments
  FOR SELECT TO authenticated USING (
    owns_group(group_id)
    OR can_see_assignment(id)
    OR mentor_sees_assignment(id)
  );

-- ---- 5. A target row only exists on a 'selected' assignment ----
-- The backstop for anything that ever writes the table outside
-- set_assignment_targets. It is why that function sets the audience BEFORE it
-- inserts rows.
CREATE OR REPLACE FUNCTION trg_target_requires_selected_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_assignments a
    WHERE a.id = NEW.assignment_id AND a.audience = 'selected'
  ) THEN
    RAISE EXCEPTION 'AUDIENCE_NOT_SELECTED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_target_requires_selected ON assignment_targets;
CREATE TRIGGER trg_target_requires_selected
  BEFORE INSERT OR UPDATE ON assignment_targets
  FOR EACH ROW EXECUTE FUNCTION trg_target_requires_selected_fn();

-- ---- 6. The one writer ----
-- Sets the audience and the rows together, which is what keeps them
-- consistent. Works the same on a draft and on a published assignment, so the
-- review screen and a published card both go through it.
CREATE OR REPLACE FUNCTION set_assignment_targets(p_assignment_id UUID, p_student_ids UUID[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group     UUID;
  v_published TIMESTAMPTZ;
  v_ids       UUID[];
  v_bad       UUID;
  n           INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT a.group_id, a.published_at INTO v_group, v_published
  FROM group_assignments a WHERE a.id = p_assignment_id;

  IF v_group IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  -- SECURITY DEFINER has no RLS of its own, so ownership is checked here or
  -- not at all.
  IF NOT owns_group(v_group) THEN
    RAISE EXCEPTION 'NOT_GROUP_OWNER';
  END IF;

  -- Duplicates would hit the composite primary key. Naming the same student
  -- twice means the same thing as naming them once, so it is not an error.
  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::UUID[]) INTO v_ids
  FROM unnest(COALESCE(p_student_ids, ARRAY[]::UUID[])) AS x;

  -- A NULL element must be refused, not filtered: stripping it in the dedupe
  -- above would turn ARRAY[NULL] into an empty array, which this function
  -- reads as "send it to the whole group" -- silently widening on malformed
  -- input is the dangerous direction for this feature. Checked with an
  -- explicit IS NULL, not folded into the membership scan below, because
  -- `x = ANY(...)` and `NOT EXISTS (... x ...)` involve x in a comparison,
  -- and three-valued logic would make a NULL either vanish from both sides or
  -- report as "not a member" -- either way it would reach the INSERT and die
  -- on assignment_targets.student_id's NOT NULL constraint as a raw 23502
  -- instead of a stable code.
  IF EXISTS (SELECT 1 FROM unnest(v_ids) AS x WHERE x IS NULL) THEN
    RAISE EXCEPTION 'STUDENT_NOT_IN_GROUP';
  END IF;

  -- Every named student must be an active member of THIS group.
  SELECT x INTO v_bad
  FROM unnest(v_ids) AS x
  WHERE NOT EXISTS (
    SELECT 1 FROM group_memberships m
    WHERE m.group_id = v_group AND m.student_id = x AND m.left_at IS NULL
  )
  LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'STUDENT_NOT_IN_GROUP';
  END IF;

  -- Nothing already worked on may be taken away, and the check runs before any
  -- write so a refusal leaves the targets exactly as they were. Widening to the
  -- whole group removes nobody, so it is never refused -- an advisor whose
  -- targeted student has submitted must still be able to open the task up.
  --
  -- Keyed off assignment_submissions, not assignment_targets: a published
  -- GROUP-audience assignment has submissions but no target rows at all, so a
  -- check that joined through assignment_targets was always vacuously false
  -- for that case -- an advisor narrowing a published group task could remove
  -- a student who had already submitted, silently, and the read policy would
  -- then hide that student's own work from their history. A submission can
  -- only exist from someone who had access when they submitted (can_see_
  -- assignment or the pre-targeting group-wide policy), which is what makes
  -- this check correct for both audiences without consulting audience at all.
  IF array_length(v_ids, 1) IS NOT NULL AND EXISTS (
    SELECT 1 FROM assignment_submissions s
    WHERE s.assignment_id = p_assignment_id
      AND NOT (s.student_id = ANY(v_ids))
  ) THEN
    RAISE EXCEPTION 'HAS_SUBMISSION';
  END IF;

  IF array_length(v_ids, 1) IS NULL THEN
    DELETE FROM assignment_targets WHERE assignment_id = p_assignment_id;
    UPDATE group_assignments SET audience = 'group' WHERE id = p_assignment_id;
    -- A published task that widens to the group gets the stream card it never
    -- had. feed_publish_assignment is idempotent and returns NULL for a draft;
    -- the IF is here so the intent is readable, not because it is needed.
    IF v_published IS NOT NULL THEN
      PERFORM feed_publish_assignment(p_assignment_id);
    END IF;
    RETURN 0;
  END IF;

  -- Audience first: trg_target_requires_selected refuses a row whose
  -- assignment still reads 'group'.
  UPDATE group_assignments SET audience = 'selected' WHERE id = p_assignment_id;

  DELETE FROM assignment_targets
  WHERE assignment_id = p_assignment_id AND NOT (student_id = ANY(v_ids));

  INSERT INTO assignment_targets (assignment_id, student_id)
  SELECT p_assignment_id, x FROM unnest(v_ids) AS x
  ON CONFLICT DO NOTHING;

  -- Narrowing a published task takes its stream card down with it: the card
  -- announces the task to the whole group, which is precisely what targeting
  -- exists to avoid.
  DELETE FROM feed_posts WHERE assignment_id = p_assignment_id;

  SELECT count(*)::INT INTO n
  FROM assignment_targets WHERE assignment_id = p_assignment_id;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION set_assignment_targets(UUID, UUID[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION set_assignment_targets(UUID, UUID[]) FROM PUBLIC, anon;

-- ---- 7. publish_assignments: NEW HOME ----
-- Body copied verbatim from docs/assignment-drafts-rpcs.sql, plus the
-- TARGETS_REQUIRED re-check. That file now carries a NOTE: re-running it drops
-- this guard.
CREATE OR REPLACE FUNCTION publish_assignments(p_ids UUID[])
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

  -- SECURITY DEFINER has no RLS of its own, so ownership is checked here or
  -- not at all. Any row in the batch the caller does not own refuses the batch.
  IF EXISTS (
    SELECT 1 FROM group_assignments a
    WHERE a.id = ANY(p_ids) AND NOT owns_group(a.group_id)
  ) THEN
    RAISE EXCEPTION 'ROLE_NOT_ALLOWED';
  END IF;

  -- The re-check. Named title, not just a refusal.
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

  -- NEW: an assignment whose audience is 'selected' and which names nobody
  -- would reach no one at all. Same all-or-nothing shape as NOT_IN_SCOPE, and
  -- it names the task for the same reason.
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

  -- Only drafts move. Re-publishing an already-sent task must not rewrite its
  -- published_at -- that timestamp is the record of when students first saw it.
  UPDATE group_assignments
  SET published_at = now()
  WHERE id = ANY(p_ids) AND published_at IS NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION publish_assignments(UUID[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION publish_assignments(UUID[]) FROM PUBLIC, anon;

-- ---- 8. group_assignment_counts: NEW HOME, one column wider ----
-- "2 submitted" means nothing without its denominator once a task can go to
-- three students out of seven. target_count is the group's active member count
-- for a group audience and the number of target rows for a selected one.
--
-- DROP first: CREATE OR REPLACE cannot change a RETURNS TABLE.
DROP FUNCTION IF EXISTS group_assignment_counts(UUID);
CREATE OR REPLACE FUNCTION group_assignment_counts(p_group_id UUID)
RETURNS TABLE (assignment_id UUID, submitted INT, approved INT,
               needs_revision INT, target_count INT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id,
         count(s.id)::INT,
         count(s.id) FILTER (WHERE s.status = 'approved')::INT,
         count(s.id) FILTER (WHERE s.status = 'needs_revision')::INT,
         CASE WHEN a.audience = 'selected'
              THEN (SELECT count(*)::INT FROM assignment_targets tg
                    WHERE tg.assignment_id = a.id)
              ELSE (SELECT count(*)::INT FROM group_memberships m
                    WHERE m.group_id = a.group_id AND m.left_at IS NULL)
         END
  FROM group_assignments a
  LEFT JOIN assignment_submissions s ON s.assignment_id = a.id
  WHERE a.group_id = p_group_id
    AND owns_group(p_group_id)
  GROUP BY a.id, a.audience, a.group_id;
$$;

GRANT EXECUTE ON FUNCTION group_assignment_counts(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION group_assignment_counts(UUID) FROM PUBLIC, anon;

-- ---- 9. The picker's level badges ----
-- The purpose of targeting is level-based individualisation, so the picker has
-- to answer "who is ready". get_competency_progress answers per student; seven
-- round-trips would make the sheet crawl. The ladder logic is the same as that
-- function's, deliberately: a level counts only when both its KPIs have two
-- observations from someone other than the student, and a gap below stops the
-- ladder there.
CREATE OR REPLACE FUNCTION group_levels_for_competency(p_group_id UUID, p_competency_id UUID)
RETURNS TABLE (student_id UUID, current_level INT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH members AS (
    SELECT m.student_id AS sid
    FROM group_memberships m
    WHERE m.group_id = p_group_id
      AND m.left_at IS NULL
      AND owns_group(p_group_id)
  ),
  demonstrated AS (
    SELECT mm.sid, k.id AS kid, k.level AS lvl
    FROM members mm
    JOIN competency_kpis k ON k.competency_id = p_competency_id
    WHERE (
      SELECT count(*) FROM kpi_observations o
      WHERE o.kpi_id = k.id AND o.student_id = mm.sid AND o.observed_by <> mm.sid
    ) >= 2
  ),
  levels_done AS (
    SELECT d.sid, d.lvl
    FROM demonstrated d
    GROUP BY d.sid, d.lvl
    HAVING count(*) = 2
  )
  SELECT mm.sid,
    COALESCE((
      SELECT max(candidate.lvl)
      FROM generate_series(1, 4) AS candidate(lvl)
      WHERE NOT EXISTS (
        SELECT 1 FROM generate_series(1, candidate.lvl) AS needed(lvl)
        WHERE NOT EXISTS (
          SELECT 1 FROM levels_done ld WHERE ld.sid = mm.sid AND ld.lvl = needed.lvl
        )
      )
    ), 0)::INT
  FROM members mm;
$$;

GRANT EXECUTE ON FUNCTION group_levels_for_competency(UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION group_levels_for_competency(UUID, UUID) FROM PUBLIC, anon;

-- ---- 10. No stream card for a targeted task: NEW HOME of the trigger ----
-- The card tells a group what it is all working on. A task given to two
-- students is not that, and posting it would announce to everyone exactly what
-- targeting exists to avoid. The condition is in the WHEN clause, so
-- trg_feed_assignment_post_fn and feed_publish_assignment are untouched.
-- docs/group-feed-assignment-cards.sql carries a NOTE: re-running it drops this
-- condition and every targeted publish starts posting a card again.
DROP TRIGGER IF EXISTS trg_feed_assignment_post ON group_assignments;
CREATE TRIGGER trg_feed_assignment_post
  AFTER UPDATE OF published_at ON group_assignments
  FOR EACH ROW
  WHEN (NEW.published_at IS NOT NULL
        AND OLD.published_at IS NULL
        AND NEW.audience = 'group')
  EXECUTE FUNCTION trg_feed_assignment_post_fn();
