# A task can go to selected students, not only the whole group — 2026-09-26

**Status:** approved in conversation on 2026-09-26, on the project owners' request.
**Amends:** `2026-08-20-task-assignment-design.md`, where an assignment belongs to
a group and every member has it. That stays true by default; this document adds
the second audience.

## Why

The owners asked for it, and the reason they gave shapes the whole design:
**students progress through the competency levels at different rates, and the
advisor wants to give the ones who are ready a different task.** Targeting is
therefore not an exception for the occasional remedial task — over a term, each
student's list is expected to diverge from the group's. The design treats a
targeted task as a first-class case, not a bolt-on.

Two answers from the owner fix the boundaries:

1. **"The whole group" stays dynamic.** A student who joins later still sees the
   group-wide tasks published before they arrived, exactly as today. A student who
   starts their internship late is not left behind.
2. **The audience is explicit.** Of the two ways to record it, we chose the one
   whose failure mode is narrowing rather than widening (see below).

## Data model

`group_assignments` gains:

```sql
audience TEXT NOT NULL DEFAULT 'group' CHECK (audience IN ('group', 'selected'))
```

The default carries every existing row without a migration of meaning: everything
published so far is group-wide, which is what it was.

A new table records the targets:

```sql
CREATE TABLE assignment_targets (
  assignment_id UUID NOT NULL REFERENCES group_assignments(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id)
);
```

RLS on, **no write policy at all** — the same rule every other table that carries
a business rule follows here (`assignment_submissions`, `kpi_observations`). Only
`SECURITY DEFINER` RPCs write it.

**Why not the simpler "no rows means everyone".** A join table alone would work and
needs no `audience` column. It was rejected for its failure mode: if the target
rows are lost — a bad delete, a botched migration, a cascade nobody expected — a
task meant for two students silently becomes visible to the whole group. Under this
feature's purpose a targeted task encodes a judgement about a student's level, so
accidental widening is the worse direction. With the explicit column the same
accident makes the task visible to nobody, which is loud, gets reported, and is
fixed the same day.

Two guards keep the column and the table from disagreeing:

- `publish_assignments` refuses an assignment whose `audience = 'selected'` has no
  target rows, with the stable code `TARGETS_REQUIRED`.
- A trigger refuses an insert into `assignment_targets` for an assignment whose
  `audience = 'group'`.

## Writing the targets

The table has no write policy, so one advisor-only RPC owns it:

```sql
set_assignment_targets(p_assignment_id UUID, p_student_ids UUID[]) RETURNS INT
```

It refuses unless the caller owns the assignment's group (`NOT_GROUP_OWNER`), and
it sets the audience and the rows together, which is what keeps them consistent:

- **an empty array** sets `audience = 'group'` and deletes every target row — this is
  how an advisor takes a task back to the whole group;
- **a non-empty array** sets `audience = 'selected'` and replaces the rows with
  exactly those students, each of whom must be an active member of the assignment's
  group (`STUDENT_NOT_IN_GROUP`);
- a student being **removed** who already has a submission for this assignment is
  refused with `HAS_SUBMISSION`, before anything is written;
- it returns the number of targets after the call.

It works the same on a draft and on a published assignment, so the review screen and
a published card both go through it. The trigger that refuses a target row on a
`group`-audience assignment is a backstop for anything that ever writes the table
outside this function.

## Access

One helper carries the rule, in the same vocabulary as `owns_group` and
`is_member_of_group`, and `SECURITY DEFINER` for the same reason — a policy must be
able to call it without re-entering the table's own policies:

```sql
can_see_assignment(p_assignment_id UUID) RETURNS BOOLEAN
-- active member of the assignment's group
-- AND (audience = 'group' OR a target row exists for auth.uid())
```

Three rules change:

- **Read policy on `group_assignments`**: the advisor still sees every assignment in
  a group they own. A student sees an assignment only when `can_see_assignment` says
  so. A mentor sees an assignment when **their own student** is eligible for it —
  today they see every assignment in the group, which after targeting would mean
  showing them tasks their student was never given.
- **`submit_assignment`**: the eligibility check becomes "active member **and**
  targeted", refusing with the new stable code `NOT_TARGETED` rather than
  `ROLE_NOT_ALLOWED`, so the message can say the task was not assigned to you rather
  than that you lack a role.
- **Changing targets after publishing** goes through `set_assignment_targets` above:
  adding a student is allowed — a late joiner may need an already-published task —
  and removing one who has already submitted is refused with `HAS_SUBMISSION`, so no
  submission is orphaned. This mirrors the rule that already freezes an assignment's
  terms once work has come in.

## The advisor's flow

The existing wizard is unchanged: competency → level → triplets → edit the terms →
review → send. The audience is chosen **on the review screen, once per batch**:
"Who gets this — the whole group / selected students", defaulting to the whole
group, so today's behaviour survives untouched for an advisor who never opens the
picker. The audience is stored per assignment, so a single draft can be re-targeted
later from its own card; a second wizard is not added to the send flow.

**The picker shows each student's level.** The purpose is level-based
individualisation, so the screen has to answer "who is ready". Each name carries
their current level in the batch's competency (L0 / L1 / L2…), and the list sorts
by it. This needs one new read-only RPC, `group_levels_for_competency(p_group_id,
p_competency_id)`, advisor-only: the existing `get_competency_progress` answers per
student, and seven round-trips would make the picker crawl. When a batch spans more
than one competency the level badges are omitted — there is no single level to show.

The multi-select pattern is the one already built for the message broadcast:
checkboxes, "select all", a running count on the continue button.

A published assignment's card shows its audience — "Whole group" or "3 students" —
and opens the list, where a student can be added.

## What the others see

- **Student**: nothing new. The client query is unchanged; the policy simply does
  not return a task that is not theirs. There is deliberately **no "assigned only to
  you" badge** — labelling a task given for the student's level would single them
  out, and the task being in their list is enough.
- **Mentor**: the tasks their student actually has.
- **Counts**: `group_assignment_counts` gains `target_count` — the group's active
  member count when the audience is the group, the number of target rows when it is
  selected — so the advisor's card reads "2 / 3 submitted" instead of a bare 2 whose
  denominator is a guess.
- **Stream**: the publish trigger does **not** create an `assignment` card for a
  targeted task. The card exists to tell a group what it is all working on; a task
  given to two students is not that, and posting it would announce to everyone
  precisely what targeting exists to avoid. The targeted students still get the task
  in their list and a notification. Showing the card to targeted students only was
  considered and rejected: it puts an eligibility filter on `list_feed_posts`, a hot
  read path, for little gain.
- **Sharing approved work** is unchanged — still the student's own choice
  (`share_to_feed`).
- **Notifications**: publishing notifies the targeted students, not every member.
- **Closure** is unaffected: `PENDING_REVIEWS` already counts submissions per
  student, not assignments per group.

## Verification

`docs/assignment-targeting-verification.sql`, three parts, every part returning a
result set because the SQL editor hides `NOTICE` and shows only the last statement.

**A — structural:** the column and its CHECK; the table, its composite primary key,
RLS on and no write policy; `can_see_assignment` `SECURITY DEFINER` with a fixed
`search_path`; the trigger; `group_assignment_counts` returning `target_count`;
`group_levels_for_competency` and `set_assignment_targets` present and advisor-only.

**B — behaviour**, against the simulation group `58MMWL`, inside `BEGIN … ROLLBACK`,
each check recorded as its own PASS/FAIL line rather than raised:

- a group-audience assignment is visible to every active member, including one who
  joined after it was published;
- a selected-audience assignment is visible to its targets and returns zero rows for
  a member who is not targeted;
- that member calling `submit_assignment` gets `NOT_TARGETED`; a target can submit;
- publishing a selected assignment with no targets raises `TARGETS_REQUIRED`;
- inserting a target row for a group-audience assignment is refused by the trigger;
- removing a target who has submitted raises `HAS_SUBMISSION`; removing one who has
  not is allowed;
- `target_count` is the member count for a group audience and the target count for a
  selected one;
- a selected publish creates no `feed_posts` row; a group publish creates one;
- a mentor sees their student's targeted assignment and not one their student was
  never given;
- `set_assignment_targets` with an empty array returns a targeted task to the whole
  group, and a student who is not the group's advisor calling it is refused.

**C — policies** under `SET LOCAL ROLE authenticated`: a student cannot `SELECT` an
assignment they were not given; nobody can `INSERT` or `DELETE` `assignment_targets`
directly.

**Jest** covers the pure helpers: audience/target validation, the "2 / 3" count
string, the picker's level sort.

**Device walk**: the advisor sends a task to two of the seven simulation students;
those two see it and the other five do not; no card appears in the stream; the
assignment card reads 0 / 2.

## Out of scope

Assigning to a student outside the group, per-student due dates, and targeting by a
saved group ("everyone at level 2") rather than by name. Each is a separate design
if it is wanted.
