# Internship groups: collapsing the model to advisor / student / mentor

**Date:** 2026-08-19
**Status:** approved, ready for planning
**Scope:** subsystem A of three (see "What this spec is not")

## Why

The project team told the product owner the app's premise was wrong. The
intended model is Google Classroom-shaped:

- The **academic advisor** runs the process. They define the internship
  content and its learning outcomes, and assign tasks to their interns.
- There is **no admin role** and **no faculty/university layer**.
- Three actors only: advisor, intern student, workplace mentor.

The app as built assumes an institution administrator who creates an
institution and departments, with advisors and students joining underneath.
That hierarchy has to go.

## What this spec is not

This is subsystem **A** of three. It stops at the group concept.

| | Subsystem | Status |
|---|---|---|
| **A** | Collapse the model: drop admin and institution/department, introduce advisor-owned internship groups | **this spec** |
| **B** | Internship content and learning outcomes defined by the advisor | later spec |
| **C** | Assignments: advisor sets, student submits, advisor reviews | later spec |

B and C cannot be specified before A, because both hang off whatever "group"
turns out to mean. A leaves the app working on its own — nothing is
half-built at the end of it.

## How deep the coupling actually is

Shallower than the pivot suggests. Verified by reading the code, not assumed:

**Untouched by institutions today, therefore untouched by this work:** the
daily-log lifecycle (`draft → submitted → under_review → approved →
needs_revision → revised → validated`), the XP/badge/streak engine (database
triggers on `daily_logs`), `mentor_feedbacks` and its competency ratings, the
advisor's validation / student-monitor / reports screens (they read
`student_profiles.advisor_id`), GDPR consent, login branding, notifications,
and `advisor_profiles`.

**Already independent:** `student_profiles` carries `university`, `faculty`
and `department` as free text captured at registration
(`docs/database-schema.sql:47-66`), unrelated to the `institutions` table.
Dropping `institutions` loses no university information — it was never stored
there.

`institutions` and `departments` gate only five things: admin management, join
codes, the advisor↔student institution match inside `link_student_by_code`,
poll scoping, and composite student codes. Every one of those is either
deleted or replaced below.

## The model

```sql
CREATE TABLE internship_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                    -- "Computer Eng. Summer Internship"
  term        TEXT,                             -- "2026 Fall", free text
  join_code   TEXT UNIQUE NOT NULL DEFAULT generate_random_code(6),
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at    TIMESTAMPTZ                        -- NULL = the active membership
);

-- The entire "one active group at a time, history preserved" rule.
CREATE UNIQUE INDEX one_active_group_per_student
  ON group_memberships(student_id) WHERE left_at IS NULL;
```

**No unique constraint on `advisor_id`** — an advisor owns as many groups as
they like, one per term or course. This is the direct opposite of
`institutions_admin_id_unique`, which is dropped.

**The partial unique index is load-bearing and silent when wrong.** It is the
only thing enforcing one active membership per student. A plain unique index
would forbid history; no index at all would let two active memberships exist
and nothing visible would break — the student would simply appear in two
advisors' lists. It must be verified explicitly (test 3 below).

Joining a second group closes the first by setting `left_at`. The closed
membership row stays, and the logs, assignments and reviews from that term
stay attached to it.

The advisor can also close a membership from their side, for a student who
joined by mistake or dropped out. That is the same operation — set `left_at`
— never a delete, so the student's logs and their history remain intact. It
replaces the admin's "remove from institution" action, which is deleted with
that screen.

### Two linking mechanisms, each matched to its case

| Link | Mechanism | Why |
|---|---|---|
| Student ↔ Advisor | Student enters the **group's join code** | One advisor, many students — share the code once. Classroom's model. |
| Student ↔ Mentor | Mentor enters the **student's code** | Each student interns at a different company under a different supervisor — necessarily one at a time. |

The second already works this way and `link_student_by_code` already exempts
mentors from institution checks, so the mentor side is very nearly untouched.

Joining a group sets `student_profiles.advisor_id`, so the advisor's
validation, student-monitor and reports screens keep working unchanged.

## Deletions

**Database:** tables `institutions`, `departments`, `admin_profiles`; columns
`profiles.institution_id` and `profiles.department_id`; `'admin'` from
`profiles_role_check`; index `institutions_admin_id_unique`; functions
`is_admin()` and `is_admin_of_institution()`; and five RPCs —
`join_institution_by_code`, `validate_institution_code`,
`join_department_by_code`, `validate_department_code`,
`regenerate_institution_code`.

**App:** all six screens under `app/(admin)/`; `src/services/admin.ts`,
`institutionCode.ts`, `departmentCode.ts`; `src/store/adminStore.ts`; the
admin option in the registration role picker; `src/types/institution.ts`.

**Package A casualties.** Roughly half of the partner-feedback package dies
with the model it was built on. Recorded plainly because it was real work:

- Composite student codes (Task 11, part of 13) — the format was
  `INSTITUTION_DEPARTMENT_STUDENT`; two of its three segments no longer exist.
  Reverts to the bare 6-character code. Deletes the composite branch of
  `parseStudentCode`, the `CODE_SEGMENT_MISMATCH` error, the institution and
  department joins in `get_my_student_code`, and the 22-character input
  fields.
- Per-institution allowed e-mail domains (Task 14) — column, UI, and
  `normalizeDomainList`.
- Join issue reporting (Task 12) — `join_issue_reports`, `report_join_issue`,
  `JoinIssueDialog.tsx`, `codeErrorAlert.ts`, `joinIssue.ts`.
- Most of `docs/join-hardening-migration.sql`.
- The admin dashboard translation — the screen is deleted.

**Package A survivors:** the GDPR/KVKK consent flow (the heaviest legal
item), login and register branding, the Jest setup, `mapRpcError` and the
stable error-code convention, and today's 42702 ambiguous-`id` fix.

**The `feature/advisor-owned-institution` branch is abandoned.** Its one
commit (`291ace1`) added an `OWNS_INSTITUTION` lock protecting a concept this
spec deletes, and it was never reviewed — the reviewer died on an API session
limit before returning a verdict. The commit stays in git history; it is not
merged.

## Replacements

- **New RPCs** `join_group_by_code(p_code TEXT)` and
  `validate_group_code(p_code TEXT)`, mirroring the shape of the functions
  they replace. `join_group_by_code` closes any existing active membership,
  opens a new one, and sets `student_profiles.advisor_id`. Joining an archived
  group is refused.
- **`link_student_by_code` becomes mentor-only.** The advisor branch and the
  `INSTITUTION_MISMATCH` error are deleted outright: advisors now acquire
  students through group membership and never link individually.
- **`polls.institution_id` → `group_id`.**
- **Leaderboard scoped by group.** It currently filters
  `leaderboard_public.university` and `.department`, free text copied from
  `student_profiles` (`docs/leaderboard-scope-migration.sql:10-12`). That
  matching is fragile — a student who typed "BTÜ" never appears alongside one
  who typed "Bursa Teknik Üniversitesi" — and ranking by university name in a
  model with no university concept is incoherent. Scoping to the group is both
  correct and small, since the group id is already on the membership.

## Screens

**Advisor — the one structural change.** The advisor has seven tabs already
and an eighth is too many, but groups are now central to their job rather
than an incidental setting.

**The `student-monitor` tab becomes `groups`.** Concretely: a new
`app/(advisor)/groups.tsx` takes the tab slot and lists the advisor's groups,
with creation, join-code sharing and archiving on it.
`app/(advisor)/student-monitor.tsx` stays as a file but leaves the tab bar
(`href: null`) and is opened from a group row, scoped to that group's
members — its existing UI is reused rather than rewritten. The tab count
stays fixed and the navigation matches how an advisor actually thinks: my
group, then my students. `validation`, `reports` and `polls` are untouched.

**Student.** Joining already happens from `app/(student)/profile.tsx` — same
place, same flow, now "join with a group code". Joining fills in the advisor,
the group, and the leaderboard scope at once.

**Mentor.** Unchanged.

## Existing data

Clean start, chosen deliberately: the app is not in production and the two
institutions in the live database are test data. The new tables are created
and the old ones dropped; no migration code is written and no ownership
transfer has to be decided. Existing test logs and XP are lost with the
accounts, which is accepted.

**Two ordering hazards inside that "clean start":**

1. Removing `'admin'` from `profiles_role_check` fails while any row still
   holds `role = 'admin'`. Existing admin profiles must be deleted (or their
   role changed) *before* the constraint is replaced, in the same migration.
2. Deleting an admin's `profiles` row cascades into `institutions` via
   `admin_id … ON DELETE CASCADE`, and from there into `departments`. That is
   the desired outcome here, but it means the drop order is: admin profiles
   first, then the constraint, then the tables — not the reverse.

`student_profiles.university`, `.faculty` and `.department` **stay**, and
registration keeps asking for them. They are the student's own description of
themselves, were never tied to the `institutions` table, and appear on
profiles and reports.

`leaderboard_public.university` and `.department` **are dropped** along with
their sync trigger, replaced by the group scoping described above. Leaving
them would preserve a second, contradictory notion of who competes with whom.

## Testing

This subsystem is mostly deletion and schema, so it produces little pure
logic. No new Jest target; the existing 31 tests must stay green, with the
composite-code cases simplifying as that format is removed.

The weight is in SQL. A verification script following the established pattern
of `docs/join-hardening-verification.sql` — one submission, identity borrowed
via `set_config(..., true)`, results accumulated in a transaction-local GUC
rather than a temp table, `ROLLBACK` at the end, anonymous `$$` tags only.

| # | Scenario | Expected |
|---|---|---|
| 1 | Student joins with a group code | membership opened, `advisor_id` set |
| 2 | Same student joins a second group | first gets `left_at`, second opens |
| 3 | Two active memberships forced directly | rejected by the partial unique index |
| 4 | Advisor creates a second group | accepted — the multi-group regression test |
| 5 | Joining with an archived group's code | rejected |

Row 3 is the one that cannot be skipped: it is the only check on the index
that carries the whole one-active-group rule, and a wrong index fails
silently rather than visibly.

On device, one chain end to end: advisor creates a group → shares the code →
student joins → advisor sees them in the list → advisor validates one of
their logs. If that chain works, A is done.
