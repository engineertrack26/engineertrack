-- docs/assignment-drafts-rpcs.sql
-- Run AFTER docs/assignment-drafts-migration.sql. Idempotent.

-- ============================================
-- publish_assignments: send a batch of drafts to the students
-- ============================================
--
-- A plain UPDATE would be enough for the write; the update policy already
-- requires owns_group and one statement is atomic. The SCOPE RE-CHECK is what
-- makes this an RPC.
--
-- trg_assignment_within_scope is BEFORE INSERT only. An advisor can draft a
-- task, switch that competency out of the group's targets, then publish --
-- nothing re-runs the check, the task reaches the student, and the refusal
-- finally lands on the MENTOR at review time, who cannot fix it. This branch
-- already hit that exact trap once, as finding I-4.
--
-- All or nothing: a partly-sent batch is harder to reason about than a refused
-- one. The refusal names the offending task, because an advisor told only
-- "something is out of scope" has to go hunting through the tray.
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
