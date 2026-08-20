# Competency framework — device checklist

Ten checks that only a real device can settle. `tsc`, Jest and the SQL verification
between them cover the schema, the two level rules and the type surface; none of them
can see a screen render, a state wipe, or an RLS denial that arrives as an empty list.

Run as three accounts: one advisor, one student, one mentor. Work down in order — later
items depend on data the earlier ones create.

## Setup

1. **Advisor creates a group, opens Competency Scope.**
   Expect all six competencies present and switched **on**, each at level **2**. That is
   the `seed_group_competency_targets` trigger firing on insert. A competency missing
   here means the trigger did not run; all six off means the screen is reading targets
   it did not get.

2. **Advisor toggles one competency off, sets another to level 4, saves, leaves the
   screen and returns.**
   Expect the change to have persisted exactly. Note that toggling a competency off and
   back on resets it to level 2 — that is deliberate, not a bug.

3. **Student joins the group by code, opens Create Log.**
   Expect the KPI checklist to show two statements per in-scope competency, all at
   level 1 — the working level. The competency turned off in step 2 must not appear.
   Ten checkboxes for five in-scope competencies, not twenty-four.

## The state bug this checklist exists for

4. **Student ticks two KPIs, taps Save Draft, and looks at the checklist without
   leaving the screen.**
   Expect both ticks still selected. This is the exact regression fix round 1 closed:
   saving a draft flips the log id from null to a real UUID, and the checklist used to
   reload and silently clear both its own display and the parent's state.

5. **Student force-closes the app, reopens the draft.**
   Expect the same two ticks restored from the database. Step 4 proves they survived in
   memory; only this proves they were written.

## The two gates

6. **Student submits the log with a reflection note written.**
   Expect XP awarded. Then, on another log, submit with ticks but **no** reflection
   note: expect the submit to succeed and no XP for self-assessment. Ticking is a claim;
   reflection is the effort that earns.

7. **Mentor opens the submitted log and submits the review with zero KPIs ticked.**
   Expect it to go through with no error and no validation message. A mentor who saw
   none of the working behaviours today must be able to say so.

## The comparison and the ladder

8. **Mentor ticks the same two KPIs on two different days' logs for that student.**
   Then open the student's Achievements: expect that competency to read level 1 of 2.
   Two observations by someone other than the student is the whole promotion rule.

9. **Advisor opens Validation on a log where student and mentor ticked overlapping but
   different sets.**
   Expect three groups: agreed, student-ticked-only, mentor-saw-only, each listing full
   KPI sentences rather than UUIDs. The middle group is the point of the screen.

10. **Student who belongs to no group opens Achievements and Create Log.**
    Expect no competency section on Achievements (not an empty heading, not an error)
    and a plain message on Create Log rather than a crash or a spinner that never ends.

## Known open item — worth watching during the above

The advisor's pending-log list is keyed on `student_profiles.advisor_id`, while the
competency RPCs and the `kpi_observations` policy gate on an **active
`group_memberships` row** via `is_group_advisor_of()`. `join_group_by_code` keeps the
two in sync, so the mainline path works. But a student linked to an advisor by the old
column and not in their group would appear in the pending list and then hit
`ROLE_NOT_ALLOWED` from the RPC.

That failure is now contained — the competency lookup is guarded, so the log detail
survives and the comparison card says it could not load the ticks. If you ever see that
message on a log that should have ticks, this divergence is the first thing to check:

```sql
SELECT p.id, p.first_name, sp.advisor_id, m.group_id, g.advisor_id AS group_advisor
FROM profiles p
JOIN student_profiles sp ON sp.id = p.id
LEFT JOIN group_memberships m ON m.student_id = p.id AND m.left_at IS NULL
LEFT JOIN internship_groups g ON g.id = m.group_id
WHERE p.role = 'student'
  AND (m.group_id IS NULL OR g.advisor_id IS DISTINCT FROM sp.advisor_id);
```

Rows here are students whose two advisor links disagree. An empty result means the
divergence is not present in the current data.
