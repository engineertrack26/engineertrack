-- docs/assignment-targeting-verification.sql
-- Proves docs/assignment-targeting.sql: a task can be sent to named students
-- instead of the whole group.
-- Spec: docs/superpowers/specs/2026-09-26-assignment-targeting-design.md
--
-- Run in the Supabase SQL editor, ONE PART PER SUBMISSION. Anonymous
-- dollar-quoting only (a named tag fails in the editor).
-- Apply order: docs/assignment-targeting.sql, then re-apply
-- docs/review-by-advisor.sql (its submit_assignment calls can_see_assignment),
-- then this file.
--
-- PART A is STRUCTURAL: the editor session is the table owner, so it proves
-- that objects, grants and trigger conditions exist -- not that any of them
-- is evaluated.
-- PART B is BEHAVIOUR: owner-run, actors impersonated through
-- request.jwt.claims, everything inside BEGIN ... ROLLBACK. The owner bypasses
-- RLS here, so where a check is about who may SEE an assignment it calls the
-- policy's own predicate (can_see_assignment / mentor_sees_assignment) -- a
-- raw SELECT from this session answers "yes" for everybody and would report
-- FAIL on perfectly correct code.
-- PART C is the only real RLS test: SET LOCAL ROLE authenticated, which is
-- what actually makes a policy evaluate (see the note in
-- docs/review-by-advisor-verification.sql).
--
-- Parts B and C accumulate PASS/FAIL lines into a v_log and publish it through
-- set_config('probe.results', ...) because the editor hides NOTICE and shows
-- only the last statement's result. Every check sits in its own
-- BEGIN ... EXCEPTION sub-block -- that is a savepoint, so one failing check
-- rolls back only itself and the checks after it still run.
-- ============================================================


-- ============================================================
-- PART A -- structural. Run this block alone. Expect 12 rows, all PASS.
-- ============================================================
WITH checks AS (
  SELECT 'A01 audience column, NOT NULL, defaults to group' AS check_name,
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'group_assignments'
                   AND column_name = 'audience'
                   AND is_nullable = 'NO' AND column_default LIKE '%group%') AS ok
  -- The default is the whole point of the migration: every row that existed
  -- before this feature must keep meaning "published to the whole group".
  UNION ALL SELECT 'A02 audience CHECK constraint',
         EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'group_assignments_audience_check')
  UNION ALL SELECT 'A03 assignment_targets exists',
         EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'assignment_targets')
  UNION ALL SELECT 'A04 composite primary key (assignment_id, student_id)',
         (SELECT count(*) FROM information_schema.key_column_usage
          WHERE table_schema = 'public' AND table_name = 'assignment_targets'
            AND constraint_name LIKE '%pkey%') = 2
  -- Two columns, not one: the primary key is also what makes naming the same
  -- student twice harmless.
  UNION ALL SELECT 'A05 targets RLS on',
         (SELECT relrowsecurity FROM pg_class
          WHERE relname = 'assignment_targets'
            AND relnamespace = 'public'::regnamespace)
  UNION ALL SELECT 'A06 targets: one policy, and it is the read policy',
         (SELECT count(*) FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'assignment_targets') = 1
     AND (SELECT count(*) FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'assignment_targets'
            AND cmd = 'SELECT') = 1
  -- The house rule for a table that carries a business rule: no write policy
  -- at all, set_assignment_targets is the only writer. A second policy here
  -- means somebody opened a direct write path.
  UNION ALL SELECT 'A07 can_see_assignment definer + search_path',
         EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.proname = 'can_see_assignment' AND p.prosecdef
                   AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%')
  UNION ALL SELECT 'A08 mentor_sees_assignment definer + search_path',
         EXISTS (SELECT 1 FROM pg_proc p
                 WHERE p.proname = 'mentor_sees_assignment' AND p.prosecdef
                   AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%')
  -- Both are called from a policy, so both must be able to read their tables
  -- without re-entering those tables' policies -- and must resolve their
  -- unqualified names whatever search_path the calling session carries.
  UNION ALL SELECT 'A09 trg_target_requires_selected',
         EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgname = 'trg_target_requires_selected' AND NOT tgisinternal)
  UNION ALL SELECT 'A10 feed trigger carries the audience condition',
         (SELECT pg_get_triggerdef(oid) FROM pg_trigger
          WHERE tgname = 'trg_feed_assignment_post' AND NOT tgisinternal)
         LIKE '%audience%'
  -- Re-applying docs/group-feed-assignment-cards.sql restores the old WHEN
  -- clause and every targeted publish starts announcing itself to the whole
  -- group again. This row is how that regression is caught.
  UNION ALL SELECT 'A11 group_assignment_counts returns target_count',
         EXISTS (SELECT 1 FROM information_schema.routines r
                 JOIN information_schema.parameters pa ON pa.specific_name = r.specific_name
                 WHERE r.routine_schema = 'public'
                   AND r.routine_name = 'group_assignment_counts'
                   AND pa.parameter_name = 'target_count')
  UNION ALL SELECT 'A12 set_assignment_targets + levels: authenticated yes, anon no',
         -- to_regprocedure returns NULL instead of raising when the function
         -- is absent, so a database that has not seen the migration gets a
         -- FAIL row here rather than an error that kills the whole of Part A.
         coalesce((SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   FROM pg_proc p
                   WHERE p.oid = to_regprocedure('public.set_assignment_targets(uuid,uuid[])')), false)
     AND coalesce((SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   FROM pg_proc p
                   WHERE p.oid = to_regprocedure('public.group_levels_for_competency(uuid,uuid)')), false)
     AND NOT coalesce((SELECT has_function_privilege('anon', p.oid, 'EXECUTE')
                   FROM pg_proc p
                   WHERE p.oid = to_regprocedure('public.set_assignment_targets(uuid,uuid[])')), false)
  -- anon must NOT hold EXECUTE. Creating a function grants it to PUBLIC, which
  -- anon inherits; docs/security-hardening-2026-09-20.sql changed the default
  -- privileges so that stops happening. If that hardening is ever reverted,
  -- this row goes red before anything else does.
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, check_name
FROM checks
-- coalesce, not a bare ok: a NULL from a missing object sorts last under the
-- default NULLS LAST and would hide a failure below the passing rows.
ORDER BY coalesce(ok, false), check_name;


-- ============================================================
-- PART B -- behaviour, live against the simulation group (join code 58MMWL).
-- Run this whole block alone. Expect one line per check, B1 .. B14.
-- Nothing is kept: the transaction rolls back.
--
-- Every actor and every row is resolved or built inside the transaction; no
-- uuid is hard-coded. The checks are stateful and build on each other, so the
-- order below is load-bearing and each step says what it leaves behind.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_log        TEXT := '';
  g            UUID;
  advisor      UUID;
  s1           UUID;   -- a target
  s2           UUID;   -- an active member who is never targeted
  s3           UUID;   -- the target who submits
  s_late       UUID;   -- joins after a_group was published (B5)
  v_triplet    UUID;
  v_comp       UUID;
  a_group      UUID;   -- group audience, published
  a_sel        UUID;   -- becomes selected audience, published
  a_bare       UUID;   -- 'selected' naming nobody, never published (B7)
  a_card_sel   UUID;   -- B12: a selected publish
  a_card_grp   UUID;   -- B12: a group publish, then narrowed and widened
  v_mentor1    UUID;
  v_mentor2    UUID;
  v_sub        UUID;
  v_mem_id     UUID;
  v_audience   TEXT;
  n            INT;
  v_members    INT;
  v_cnt        INT;
  v_tc_group   INT;
  v_tc_sel     INT;
  v_c1         INT;
  v_c2         INT;
  v_c3         INT;
  v_c4         INT;
  v_see_target BOOLEAN;
  v_see_other  BOOLEAN;
  v_see_group  BOOLEAN;
  v_mseen1     BOOLEAN;
  v_mseen2     BOOLEAN;
BEGIN
  -- ---- Setup. Deliberately unguarded: if the fixtures cannot be built, no
  -- ---- check below means anything, and the owner should see the raw error.
  SELECT ig.id, ig.advisor_id INTO g, advisor
  FROM internship_groups ig WHERE ig.join_code = '58MMWL';

  IF g IS NULL THEN
    PERFORM set_config('probe.results',
      'FAIL setup: no internship_groups row with join_code 58MMWL' || chr(10), true);
    RETURN;
  END IF;

  -- Three distinct active members with an OPEN internship: submit_assignment
  -- refuses a closed one with INTERNSHIP_CLOSED before it ever reaches the
  -- NOT_TARGETED guard B4 is about, and the simulation really does hold a
  -- closed student.
  SELECT m.student_id INTO s1 FROM group_memberships m
  WHERE m.group_id = g AND m.left_at IS NULL AND NOT internship_closed(m.student_id, g)
  ORDER BY m.joined_at, m.student_id OFFSET 0 LIMIT 1;
  SELECT m.student_id INTO s2 FROM group_memberships m
  WHERE m.group_id = g AND m.left_at IS NULL AND NOT internship_closed(m.student_id, g)
  ORDER BY m.joined_at, m.student_id OFFSET 1 LIMIT 1;
  SELECT m.student_id INTO s3 FROM group_memberships m
  WHERE m.group_id = g AND m.left_at IS NULL AND NOT internship_closed(m.student_id, g)
  ORDER BY m.joined_at, m.student_id OFFSET 2 LIMIT 1;

  IF s3 IS NULL THEN
    PERFORM set_config('probe.results',
      'FAIL setup: 58MMWL has fewer than three active members with an open internship' || chr(10), true);
    RETURN;
  END IF;

  -- A triplet, and its competency put inside the group's scope: every draft
  -- below would otherwise be refused by trg_assignment_within_scope on INSERT
  -- and by publish_assignments' NOT_IN_SCOPE re-check. ON CONFLICT DO NOTHING
  -- because the simulation group already has targets; the row, new or old,
  -- disappears with the ROLLBACK either way.
  SELECT t.id, k.competency_id INTO v_triplet, v_comp
  FROM kpi_triplets t
  JOIN competency_kpis k ON k.id = t.kpi_id
  ORDER BY k.competency_id, t.id
  LIMIT 1;

  INSERT INTO group_competency_targets (group_id, competency_id, target_level)
  VALUES (g, v_comp, 4)
  ON CONFLICT (group_id, competency_id) DO NOTHING;

  -- Five drafts. Each check that changes an assignment's audience gets its own
  -- assignment, so no check can pass or fail because of what another one left
  -- behind.
  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE targeting: group task', t.objective, t.criterion, advisor
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_group;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE targeting: selected task', t.objective, t.criterion, advisor
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_sel;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE targeting: selected, nobody named', t.objective, t.criterion, advisor
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_bare;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE targeting: card, selected', t.objective, t.criterion, advisor
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_card_sel;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by)
  SELECT g, t.id, 'PROBE targeting: card, group', t.objective, t.criterion, advisor
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_card_grp;

  -- Everything from here that writes goes through an RPC, and every RPC reads
  -- auth.uid(); without this they all raise NOT_AUTHENTICATED.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', advisor)::text, true);

  PERFORM publish_assignments(ARRAY[a_group]);

  -- Back-date the group task so B5's late joiner really is late: now() is the
  -- transaction timestamp, so a membership inserted later in this same block
  -- would otherwise carry the identical joined_at. An UPDATE of published_at
  -- on an already-published row fires nothing (trg_feed_assignment_post wants
  -- OLD.published_at IS NULL) and freeze_assessed_assignment only guards
  -- objective, criterion, triplet_id and group_id.
  UPDATE group_assignments SET published_at = now() - interval '1 day' WHERE id = a_group;

  -- ---- B1: the writer sets rows and audience together ----
  BEGIN
    n := set_assignment_targets(a_sel, ARRAY[s1, s3]);
    SELECT a.audience INTO v_audience FROM group_assignments a WHERE a.id = a_sel;
    IF n = 2 AND v_audience = 'selected' THEN
      v_log := v_log || 'PASS B1: set_assignment_targets returned 2 and the audience reads selected' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B1: returned ' || coalesce(n::text, '<null>')
                      || ', audience=' || coalesce(v_audience, '<null>') || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B1: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B2: naming the same student twice means naming them once ----
  BEGIN
    n := set_assignment_targets(a_sel, ARRAY[s1, s1, s3]);
    IF n = 2 THEN
      v_log := v_log || 'PASS B2: a duplicated student id returned 2, not an error' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B2: returned ' || coalesce(n::text, '<null>') || ', expected 2' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B2: duplicates raised ' || SQLERRM || chr(10);
  END;

  -- a_sel goes out now, with its targets already in place. Everything from B3
  -- on needs it published: can_see_assignment and submit_assignment both
  -- require published_at, and publishing it while it is 'selected' with
  -- targets is also the path B12 asserts leaves no stream card.
  PERFORM publish_assignments(ARRAY[a_sel]);

  -- ---- B3: who the assignment is visible to ----
  -- The predicate, not a SELECT: this session is the table owner and bypasses
  -- RLS, so "SELECT count(*) FROM group_assignments WHERE id = a_sel" answers
  -- 1 for every impersonated actor and the s2 case would read FAIL on correct
  -- code. can_see_assignment is exactly what the read policy calls; Part C
  -- proves the policy calls it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1)::text, true);
  v_see_target := can_see_assignment(a_sel);
  v_see_group  := can_see_assignment(a_group);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s2)::text, true);
  v_see_other  := can_see_assignment(a_sel);

  IF v_see_target AND NOT v_see_other AND v_see_group THEN
    v_log := v_log || 'PASS B3: the target sees the selected task, the untargeted member does not, both see the group task' || chr(10);
  ELSE
    v_log := v_log || 'FAIL B3: target sees selected=' || coalesce(v_see_target::text, '<null>')
                    || ', untargeted sees selected=' || coalesce(v_see_other::text, '<null>')
                    || ', target sees group=' || coalesce(v_see_group::text, '<null>') || chr(10);
  END IF;

  -- ---- B4: submitting ----
  -- The reflection and the document are real, not placeholders: with a NULL
  -- reflection submit_assignment raises REFLECTION_REQUIRED long before it
  -- reaches the NOT_TARGETED guard, and this check would report a refusal that
  -- says nothing about targeting. 2::SMALLINT, not 2 -- integer to smallint is
  -- not an implicit cast in function resolution and a bare 2 fails with
  -- "function does not exist".
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s2)::text, true);
  BEGIN
    PERFORM submit_assignment(a_sel, 'probe',
      'Probe reflection for the NOT_TARGETED check, comfortably over twenty characters.',
      '[]'::jsonb,
      '[{"uri":"probe","file_name":"evidence.pdf","file_type":"application/pdf"}]'::jsonb,
      2::SMALLINT);
    v_log := v_log || 'FAIL B4a: the untargeted member submitted, expected NOT_TARGETED' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'NOT_TARGETED' THEN
      v_log := v_log || 'PASS B4a: the untargeted member was refused with NOT_TARGETED' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B4a: refused with ' || SQLERRM || ', expected NOT_TARGETED' || chr(10);
    END IF;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s3)::text, true);
  BEGIN
    v_sub := submit_assignment(a_sel, 'probe',
      'Probe reflection from a targeted student, comfortably over twenty characters.',
      '[]'::jsonb,
      '[{"uri":"probe","file_name":"evidence.pdf","file_type":"application/pdf"}]'::jsonb,
      2::SMALLINT);
    IF v_sub IS NOT NULL THEN
      v_log := v_log || 'PASS B4b: the targeted student submitted' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B4b: submit_assignment returned NULL' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B4b: the targeted student was refused with ' || SQLERRM || chr(10);
  END;

  -- ---- B5: a late joiner inherits a group-audience task ----
  -- A student with no active membership anywhere, so the partial unique index
  -- one_active_group_per_student is not in the way. No fresh profile is
  -- created: profiles.id references auth.users(id) and this script does not
  -- write to the auth schema of a live project.
  SELECT p.id INTO s_late
  FROM profiles p
  WHERE p.role = 'student'
    AND NOT EXISTS (SELECT 1 FROM group_memberships m
                    WHERE m.student_id = p.id AND m.left_at IS NULL)
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF s_late IS NULL THEN
    v_log := v_log || 'SKIP B5: no student profile without an active membership to join late with' || chr(10);
  ELSE
    BEGIN
      INSERT INTO group_memberships (group_id, student_id) VALUES (g, s_late);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', s_late)::text, true);
      IF can_see_assignment(a_group) THEN
        v_log := v_log || 'PASS B5: a student who joined after the group task was published sees it' || chr(10);
      ELSE
        v_log := v_log || 'FAIL B5: the late joiner cannot see the group task' || chr(10);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_log := v_log || 'FAIL B5: unexpected error: ' || SQLERRM || chr(10);
    END;
  END IF;

  -- ---- B6: a target who leaves the group ----
  -- Leaving also fires trg_dm_membership_closed, which deletes that student's
  -- conversations in this group -- rolled back with everything else here.
  BEGIN
    -- The id is captured so the restore below touches exactly this row: a
    -- student may have older, already-closed memberships in the same group,
    -- and clearing left_at on all of them would break the partial unique
    -- index one_active_group_per_student.
    UPDATE group_memberships SET left_at = now()
    WHERE group_id = g AND student_id = s1 AND left_at IS NULL
    RETURNING id INTO v_mem_id;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', s1)::text, true);
    v_see_target := can_see_assignment(a_sel);

    SELECT count(*) INTO v_cnt FROM assignment_submissions
    WHERE assignment_id = a_sel AND student_id = s3;

    IF NOT v_see_target AND v_cnt = 1 THEN
      v_log := v_log || 'PASS B6: the departed target loses the task and the other target keeps their submission' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B6: departed target still sees it=' || coalesce(v_see_target::text, '<null>')
                      || ', surviving submissions=' || coalesce(v_cnt::text, '<null>') || chr(10);
    END IF;

    -- Restore: B9 needs s1 to be an active member again, or its refusal would
    -- come from STUDENT_NOT_IN_GROUP rather than from HAS_SUBMISSION.
    UPDATE group_memberships SET left_at = NULL WHERE id = v_mem_id;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B6: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B7: a 'selected' task that names nobody cannot be published ----
  -- a_bare, not a_sel: a_sel has had targets since B1, and set_assignment_targets
  -- never leaves an assignment selected-with-no-targets, so this state can only
  -- be reached with a direct UPDATE -- which is precisely the state the guard
  -- in publish_assignments exists for.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', advisor)::text, true);
  UPDATE group_assignments SET audience = 'selected' WHERE id = a_bare;
  BEGIN
    PERFORM publish_assignments(ARRAY[a_bare]);
    v_log := v_log || 'FAIL B7: a selected task with no targets was published, expected TARGETS_REQUIRED' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TARGETS_REQUIRED%' THEN
      v_log := v_log || 'PASS B7: publishing a selected task with no targets raised TARGETS_REQUIRED' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B7: refused with ' || SQLERRM || ', expected TARGETS_REQUIRED' || chr(10);
    END IF;
  END;

  -- ---- B8: the trigger backstop on the table itself ----
  BEGIN
    INSERT INTO assignment_targets (assignment_id, student_id) VALUES (a_group, s2);
    v_log := v_log || 'FAIL B8: a target row was accepted on a group-audience task, expected AUDIENCE_NOT_SELECTED' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'AUDIENCE_NOT_SELECTED' THEN
      v_log := v_log || 'PASS B8: a target row on a group-audience task raised AUDIENCE_NOT_SELECTED' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B8: refused with ' || SQLERRM || ', expected AUDIENCE_NOT_SELECTED' || chr(10);
    END IF;
  END;

  -- ---- B9: work already done cannot be taken away ----
  -- a_sel targets {s1, s3} and s3 has submitted (B4b).
  BEGIN
    n := set_assignment_targets(a_sel, ARRAY[s1]);
    v_log := v_log || 'FAIL B9a: dropping the student who submitted returned ' || coalesce(n::text, '<null>')
                    || ', expected HAS_SUBMISSION' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'HAS_SUBMISSION' THEN
      v_log := v_log || 'PASS B9a: dropping the student who submitted raised HAS_SUBMISSION' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B9a: refused with ' || SQLERRM || ', expected HAS_SUBMISSION' || chr(10);
    END IF;
  END;

  BEGIN
    n := set_assignment_targets(a_sel, ARRAY[s3]);
    IF n = 1 THEN
      v_log := v_log || 'PASS B9b: dropping a target who has not submitted returned 1' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B9b: returned ' || coalesce(n::text, '<null>') || ', expected 1' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B9b: refused with ' || SQLERRM || chr(10);
  END;

  -- B9c is the case a targets-based check could never see: a_group has
  -- submissions and NO target rows at all, so a guard that joined through
  -- assignment_targets is vacuously false here and would let the advisor
  -- narrow a published group task away from a student who had already
  -- submitted -- hiding that student's own work from their history.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s2)::text, true);
  BEGIN
    PERFORM submit_assignment(a_group, 'probe',
      'Probe reflection on the group-audience task, comfortably over twenty characters.',
      '[]'::jsonb,
      '[{"uri":"probe","file_name":"evidence.pdf","file_type":"application/pdf"}]'::jsonb,
      2::SMALLINT);
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B9c setup: the member could not submit to the group task: ' || SQLERRM || chr(10);
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', advisor)::text, true);
  BEGIN
    n := set_assignment_targets(a_group, ARRAY[s1]);
    v_log := v_log || 'FAIL B9c: narrowing a group task away from its submitter returned '
                    || coalesce(n::text, '<null>') || ', expected HAS_SUBMISSION' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'HAS_SUBMISSION' THEN
      v_log := v_log || 'PASS B9c: narrowing a group task away from its submitter raised HAS_SUBMISSION' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B9c: refused with ' || SQLERRM || ', expected HAS_SUBMISSION' || chr(10);
    END IF;
  END;

  -- ---- B10: widening is never refused ----
  -- The mirror of B9: s3 has submitted and is being removed from the target
  -- list, but an empty array removes nobody's access, so a guard that simply
  -- refuses every removal would wrongly raise here and trap an advisor whose
  -- targeted student has already worked.
  BEGIN
    n := set_assignment_targets(a_sel, '{}'::UUID[]);
    SELECT a.audience INTO v_audience FROM group_assignments a WHERE a.id = a_sel;
    IF n = 0 AND v_audience = 'group' THEN
      v_log := v_log || 'PASS B10: an empty array returned 0 and put the task back to the whole group' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B10: returned ' || coalesce(n::text, '<null>')
                      || ', audience=' || coalesce(v_audience, '<null>') || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B10: widening was refused with ' || SQLERRM || chr(10);
  END;

  -- ---- B11: the denominator on the advisor's card ----
  BEGIN
    -- Re-target a_sel (B10 widened it). s3 stays: they submitted.
    n := set_assignment_targets(a_sel, ARRAY[s3]);

    SELECT count(*)::INT INTO v_members FROM group_memberships m
    WHERE m.group_id = g AND m.left_at IS NULL;

    SELECT c.target_count INTO v_tc_group FROM group_assignment_counts(g) c
    WHERE c.assignment_id = a_group;
    SELECT c.target_count INTO v_tc_sel FROM group_assignment_counts(g) c
    WHERE c.assignment_id = a_sel;

    IF v_tc_group = v_members AND v_tc_sel = 1 THEN
      v_log := v_log || 'PASS B11: target_count is the member count (' || v_members
                      || ') for a group audience and the target count (1) for a selected one' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B11: group task target_count=' || coalesce(v_tc_group::text, '<null>')
                      || ' (members ' || coalesce(v_members::text, '<null>')
                      || '), selected task target_count=' || coalesce(v_tc_sel::text, '<null>')
                      || ', expected 1' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B11: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B12: the stream card ----
  -- Two fresh drafts, so nothing above can explain the counts. A card tells the
  -- group what it is all working on; a task given to two students is not that.
  BEGIN
    n := set_assignment_targets(a_card_sel, ARRAY[s1]);
    PERFORM publish_assignments(ARRAY[a_card_sel]);
    SELECT count(*)::INT INTO v_c1 FROM feed_posts WHERE assignment_id = a_card_sel;

    PERFORM publish_assignments(ARRAY[a_card_grp]);
    SELECT count(*)::INT INTO v_c2 FROM feed_posts WHERE assignment_id = a_card_grp;

    n := set_assignment_targets(a_card_grp, ARRAY[s1]);
    SELECT count(*)::INT INTO v_c3 FROM feed_posts WHERE assignment_id = a_card_grp;

    n := set_assignment_targets(a_card_grp, '{}'::UUID[]);
    SELECT count(*)::INT INTO v_c4 FROM feed_posts WHERE assignment_id = a_card_grp;

    IF v_c1 = 0 AND v_c2 = 1 AND v_c3 = 0 AND v_c4 = 1 THEN
      v_log := v_log || 'PASS B12: no card for a selected publish, one for a group publish, gone when narrowed, back when widened' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B12: selected publish=' || coalesce(v_c1::text, '<null>')
                      || ' (expected 0), group publish=' || coalesce(v_c2::text, '<null>')
                      || ' (1), after narrowing=' || coalesce(v_c3::text, '<null>')
                      || ' (0), after widening=' || coalesce(v_c4::text, '<null>') || ' (1)' || chr(10);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B12: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B13: the mentor sees what THEIR student was given ----
  -- a_sel targets {s3} after B11; bring s1 back in so there is a mentor on the
  -- inside of the task. s3 stays, they submitted.
  BEGIN
    n := set_assignment_targets(a_sel, ARRAY[s1, s3]);

    SELECT sp.mentor_id INTO v_mentor1 FROM student_profiles sp WHERE sp.id = s1;

    -- A mentor who mentors an active member of this group -- so
    -- mentors_a_member_of_group is true for them and the answer can only come
    -- from the targets branch -- but who mentors none of a_sel's targets.
    SELECT sp.mentor_id INTO v_mentor2
    FROM group_memberships m
    JOIN student_profiles sp ON sp.id = m.student_id
    WHERE m.group_id = g AND m.left_at IS NULL AND sp.mentor_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM assignment_targets tg
        JOIN student_profiles sp2 ON sp2.id = tg.student_id
        WHERE tg.assignment_id = a_sel AND sp2.mentor_id = sp.mentor_id)
    ORDER BY m.student_id
    LIMIT 1;

    IF v_mentor1 IS NULL OR v_mentor2 IS NULL THEN
      v_log := v_log || 'SKIP B13: 58MMWL has no mentored target plus a mentor of a non-target to compare against' || chr(10);
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mentor1)::text, true);
      v_mseen1 := mentor_sees_assignment(a_sel);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mentor2)::text, true);
      v_mseen2 := mentor_sees_assignment(a_sel);

      IF v_mseen1 AND NOT v_mseen2 THEN
        v_log := v_log || 'PASS B13: the target''s mentor sees the task, a mentor of no target does not' || chr(10);
      ELSE
        v_log := v_log || 'FAIL B13: target''s mentor sees it=' || coalesce(v_mseen1::text, '<null>')
                        || ', other mentor sees it=' || coalesce(v_mseen2::text, '<null>') || chr(10);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_log := v_log || 'FAIL B13: unexpected error: ' || SQLERRM || chr(10);
  END;

  -- ---- B14: only the group's advisor may re-target ----
  -- SECURITY DEFINER has no RLS of its own, so this refusal is the whole of
  -- the access control on the writer.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s2)::text, true);
  BEGIN
    n := set_assignment_targets(a_sel, ARRAY[s2]);
    v_log := v_log || 'FAIL B14: a student re-targeted the task and got ' || coalesce(n::text, '<null>')
                    || ', expected NOT_GROUP_OWNER' || chr(10);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'NOT_GROUP_OWNER' THEN
      v_log := v_log || 'PASS B14: a student calling set_assignment_targets was refused with NOT_GROUP_OWNER' || chr(10);
    ELSE
      v_log := v_log || 'FAIL B14: refused with ' || SQLERRM || ', expected NOT_GROUP_OWNER' || chr(10);
    END IF;
  END;

  PERFORM set_config('probe.results', v_log, true);
END $$;

SELECT btrim(line) AS result
FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE btrim(line) <> '';

ROLLBACK;


-- ============================================================
-- PART C -- policies. Run this whole block alone. Expect 4 rows, all PASS.
-- An owner-run script proves a policy exists; SET LOCAL ROLE authenticated is
-- what makes one evaluate. This is the only part of the file that tests the
-- read policy itself rather than the predicate behind it.
-- ============================================================

BEGIN;

-- The fixture is built here, as the owner, BEFORE the role switch -- under
-- role authenticated there is no write path to assignment_targets at all,
-- which is exactly what C3 and C4 exist to prove.
DO $$
DECLARE
  g         UUID;
  advisor   UUID;
  s_target  UUID;
  s_other   UUID;
  v_triplet UUID;
  v_comp    UUID;
  a_sel     UUID;
BEGIN
  SELECT ig.id, ig.advisor_id INTO g, advisor
  FROM internship_groups ig WHERE ig.join_code = '58MMWL';

  SELECT m.student_id INTO s_target FROM group_memberships m
  WHERE m.group_id = g AND m.left_at IS NULL
  ORDER BY m.joined_at, m.student_id OFFSET 0 LIMIT 1;
  SELECT m.student_id INTO s_other FROM group_memberships m
  WHERE m.group_id = g AND m.left_at IS NULL
  ORDER BY m.joined_at, m.student_id OFFSET 1 LIMIT 1;

  SELECT t.id, k.competency_id INTO v_triplet, v_comp
  FROM kpi_triplets t
  JOIN competency_kpis k ON k.id = t.kpi_id
  ORDER BY k.competency_id, t.id
  LIMIT 1;

  INSERT INTO group_competency_targets (group_id, competency_id, target_level)
  VALUES (g, v_comp, 4)
  ON CONFLICT (group_id, competency_id) DO NOTHING;

  -- 'selected' and published in the INSERT itself: the audience must already
  -- read 'selected' before a target row goes in (trg_target_requires_selected),
  -- and writing published_at at insert time keeps trg_feed_assignment_post --
  -- an AFTER UPDATE trigger -- out of this entirely.
  INSERT INTO group_assignments
    (group_id, triplet_id, title, objective, criterion, created_by, audience, published_at)
  SELECT g, t.id, 'PROBE targeting: Part C', t.objective, t.criterion, advisor, 'selected', now()
  FROM kpi_triplets t WHERE t.id = v_triplet
  RETURNING id INTO a_sel;

  INSERT INTO assignment_targets (assignment_id, student_id) VALUES (a_sel, s_target);

  PERFORM set_config('probe.assignment', a_sel::text, true);
  PERFORM set_config('probe.target', s_target::text, true);
  PERFORM set_config('probe.other', s_other::text, true);
  PERFORM set_config('probe.advisor', advisor::text, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  a_sel     UUID := current_setting('probe.assignment')::uuid;
  s_other   UUID := current_setting('probe.other')::uuid;
  v_cnt     INT;
  v_deleted INT;
  v_log     TEXT := '';
BEGIN
  -- C1: an active member of the group who was not named.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.other'))::text, true);
  SELECT count(*)::INT INTO v_cnt FROM group_assignments WHERE id = a_sel;
  IF v_cnt = 0 THEN
    v_log := v_log || 'PASS C1: the untargeted member''s SELECT returned no row' || chr(10);
  ELSE
    v_log := v_log || 'FAIL C1: the untargeted member read ' || v_cnt || ' row(s)' || chr(10);
  END IF;

  -- C2: the same query as the student who was named.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.target'))::text, true);
  SELECT count(*)::INT INTO v_cnt FROM group_assignments WHERE id = a_sel;
  IF v_cnt = 1 THEN
    v_log := v_log || 'PASS C2: the target''s SELECT returned the assignment' || chr(10);
  ELSE
    v_log := v_log || 'FAIL C2: the target read ' || v_cnt || ' row(s), expected 1' || chr(10);
  END IF;

  -- C3: the advisor owns the group and can READ the target rows, and still has
  -- no way to write one. Matched on SQLSTATE, not on message text: "new row
  -- violates row-level security policy" and "permission denied for table" are
  -- both 42501 and either one is the refusal this asserts.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.advisor'))::text, true);
  BEGIN
    INSERT INTO assignment_targets (assignment_id, student_id) VALUES (a_sel, s_other);
    v_log := v_log || 'FAIL C3: the advisor inserted a target row directly' || chr(10);
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_log := v_log || 'PASS C3: the advisor''s direct INSERT was refused with 42501' || chr(10);
    WHEN OTHERS THEN
      v_log := v_log || 'FAIL C3: refused with SQLSTATE ' || SQLSTATE || ' (' || SQLERRM
                      || '), expected 42501' || chr(10);
  END;

  -- C4: a DELETE with no policy is not an error -- it simply matches nothing.
  -- That is the quiet half of "no write policy", and the half a reader is
  -- likeliest to assume works the other way.
  BEGIN
    DELETE FROM assignment_targets WHERE assignment_id = a_sel;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    SELECT count(*)::INT INTO v_cnt FROM assignment_targets WHERE assignment_id = a_sel;
    IF v_deleted = 0 AND v_cnt = 1 THEN
      v_log := v_log || 'PASS C4: the advisor''s DELETE affected 0 rows and the target row is still there' || chr(10);
    ELSE
      v_log := v_log || 'FAIL C4: DELETE affected ' || v_deleted || ' row(s), '
                      || v_cnt || ' target row(s) remain' || chr(10);
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      -- Refused outright rather than filtered to nothing: a stronger outcome
      -- than the one asserted, so it is a pass, but say which one happened.
      v_log := v_log || 'PASS C4: the advisor''s DELETE was refused outright with 42501 (no table grant)' || chr(10);
    WHEN OTHERS THEN
      v_log := v_log || 'FAIL C4: unexpected error: ' || SQLERRM || chr(10);
  END;

  PERFORM set_config('probe.results', v_log, true);
END $$;

-- Back to the owner before anything reads the results, so a failure in the
-- SELECT below cannot be blamed on the role change (house pattern, see
-- docs/task-assignment-verification.sql Part C).
RESET ROLE;

SELECT btrim(line) AS result
FROM regexp_split_to_table(current_setting('probe.results'), chr(10)) AS line
WHERE btrim(line) <> '';

ROLLBACK;
