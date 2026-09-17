# Internship closure — design

**Date:** 2026-09-16
**Status:** approved in conversation, awaiting written review
**Why:** the owners' workflow diagram ends with "Final approval: the internship is officially over, the final grade is approved" and a reports step. The app has no end: a group is archived as an administrative act, but a student's internship never closes, nothing is ever locked, and nothing summarises it. This is the last of the three audit gaps (after case threads and self-assessment).

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Closure is **per student per group**, by the group's advisor. It is not a grade and not a pass/fail: the university's grading lives outside the app; the report is the input to it. | Owner's choice (option a). Students finish at different times; a group archive is a different, administrative act and stays separate. |
| 2 | Closure is refused while the student has submissions **awaiting the mentor** (`status = 'submitted'`): `PENDING_REVIEWS`, with the count. The advisor gets the decision made first (or has the mentor send them back). | The report must be consistent: every task is approved, sent back, or never started — nothing "undecided at closure". |
| 3 | After closure the student's record is **read-only**: no new submissions, internship days, journal edits, messages in the group, stream sharing toggles; the mentor cannot review or decide attendance for that student; the advisor cannot add notes or correction requests. Reading stays open for everyone who could read before. Stream likes/comments stay open (they are conversation, not record). | "Officially over" means the record stops changing. |
| 4 | The advisor can **reopen** with a mandatory reason; the closure row keeps `reopened_by/at/reason`. Closing again produces report version N+1 on the same row. | Mistakes happen; the trail shows they were corrected. |
| 5 | The report is **Markdown, built on the server** by one SQL function, stored on the closure row, and re-readable by the student, their mentor and the advisor. English only in v1. | One source of truth, identical for all readers, no client rendering to keep in sync. PDF is deferred (the owner's call); Markdown converts later. |
| 6 | The report contains **counts and levels, never free text**: no reflection, no mentor note, no journal body, no message. | Same privacy boundary as the stream and the attendance report. |
| 7 | Notifications: `internship_closed` to the student and the mentor on close; `internship_reopened` to both on reopen. Both route to the student's / mentor's home. | The two people whose record changed are told. |

## 2. Data model

```
internship_closures
  id uuid pk
  student_id → profiles ON DELETE CASCADE
  group_id → internship_groups ON DELETE CASCADE
  closed_by → profiles, closed_at timestamptz NOT NULL DEFAULT now()
  reopened_by → profiles NULL, reopened_at timestamptz NULL, reopen_reason text NULL CHECK (≤ 2000)
  report_md text NOT NULL, report_version int NOT NULL DEFAULT 1
  UNIQUE (student_id, group_id)
```
"Closed" ⇔ a row exists with `reopened_at IS NULL`. RLS: SELECT for the student, `is_mentor_of(student_id)`, `owns_group(group_id)`; no direct write policy (all through RPCs).

## 3. The lock

`internship_closed(p_student_id UUID, p_group_id UUID) RETURNS BOOLEAN` — SECURITY DEFINER, STABLE, `REVOKE … FROM authenticated` (internal; the status RPC is the client's view). True iff a closure row exists for the pair with `reopened_at IS NULL`.

Guards added (one `IF internship_closed(...) THEN RAISE EXCEPTION 'INTERNSHIP_CLOSED'` each, after authentication and before any write) in: `submit_assignment` (assignment's group), `review_assignment` (the submission's group), `set_submission_sharing`, `internship_open_day`, `internship_save_log`, `internship_review` (per day), `internship_note`, `open_conversation` / `open_case` / `send_message` (the conversation's group, when the caller **or the subject** is a closed student of that group). `create_feed_post`, likes and comments are not guarded (decision 3).

The direct evidence policies on `log_photos` / `log_documents` (student INSERT/DELETE on non-approved submissions) also refuse while a closure is live — `docs/internship-closure-evidence-policies.sql`.

## 4. RPCs (SECURITY DEFINER; stable codes)

- `close_internship(p_student_id, p_group_id) RETURNS JSONB {closureId, reportVersion}` — caller owns the group (`NOT_GROUP_OWNER`); the student is an active member (`STUDENT_NOT_IN_GROUP`); no `submitted` rows on the group's assignments for the student (`PENDING_REVIEWS: <n>`); already closed → `ALREADY_CLOSED`. Builds the report, inserts or updates the row (version +1 on a re-close, clears `reopened_*`), notifies student + mentor.
- `reopen_internship(p_student_id, p_group_id, p_reason) RETURNS VOID` — owner; `NOT_CLOSED` when no live closure; `REASON_REQUIRED` when blank; sets `reopened_*`; notifies student + mentor.
- `get_internship_report(p_student_id, p_group_id) RETURNS TEXT` — student, their mentor, or the owner (`REPORT_FORBIDDEN`); `NO_REPORT` when no row (a reopened closure still returns its last report — it is history).
- `internship_closure_status(p_student_id, p_group_id) RETURNS JSONB {closed, closedAt, closedBy, reopenedAt, reopenReason, reportVersion, pendingReviews}` — same readers; `pendingReviews` counts `submitted` rows so the advisor's button can explain itself.
- `build_internship_report(p_student_id, p_group_id) RETURNS TEXT` — internal (not granted), pure read, used by `close_internship`.

## 5. The report (Markdown)

```
# Internship report — <Student name>

| | |
|---|---|
| Workplace | <company> |
| Mentor | <mentor name> |
| Advisor | <advisor name> |
| Group | <group name> (<term>) |
| Internship dates | <start> – <end> |
| Closed | <closed_at UTC> by <advisor name> |
| Report version | N |

## Competencies
| Competency | Target level | Reached level | Observations | Self (avg) | Mentor (avg) | Gap |
(one row per competency in the group's targets; self/mentor/gap from competency_self_vs_mentor, "—" when unrated)

## Tasks
| Task | Competency | Status | Self | Mentor | Approved on |
(every published assignment of the group; status: approved / sent back / not started; levels as words)

## Attendance   (section present only when internship_placements has a row for the pair)
| Working days so far | Recorded | Present | Partial | Excused | Absent | Awaiting decision | Journals submitted |

## Journal
Submitted journals: N · Support levels: observed A · heavy B · partial C · independent D

_Generated by EngineerTrack on <date>. Counts and levels only; reflections, notes and journal text are not part of this report._
```
Names come from `profiles_public`; levels use the four words (`observed / heavy support / partial support / independent`); "—" where NULL.

## 6. Screens

- **Advisor — student monitor** (`app/(advisor)/student-monitor.tsx`, parallel session's file — delivered here if clean at execution time): per student, `internship_closure_status`; not closed → **Close internship** (disabled with "N awaiting the mentor" when `pendingReviews > 0`; confirm dialog explaining the lock); closed → a **Closed** badge with the date, **View report**, **Reopen** (reason sheet). Also reachable from the group report's Students tab (a small link).
- **Report viewer** (`src/components/screens/InternshipReportScreen.tsx`, routes `app/(role)/internship-report.tsx?studentId&groupId`, `href: null`): renders the Markdown with a small in-house renderer (headings, tables, bold, italics — no library), a **Share** button (`Share.share` with the raw Markdown), version + date in the header.
- **Student**: a persistent lock banner on My tasks, Internship days, Messages and the task form ("Your internship is closed — records are read-only"), with a **My report** link; the growth screen gets the same link when closed.
- **Mentor**: student detail shows the Closed badge and the report link; review actions hidden/disabled when closed.
- Locale: `en.json` + `tr.json` (`closure.*`, `errors.*`); other locales fall back.

## 7. Verification (`docs/internship-closure-verification.sql`)

- A: table + RLS + no write policy; `internship_closed` not executable by `authenticated`; every guarded RPC's `pg_get_functiondef` contains `internship_closed(`; four public RPCs granted.
- B (owner-run, impersonated): close with a pending submission → `PENDING_REVIEWS`; mentor approves; close → row v1, two notifications, report contains the student's name and the task title and does **not** contain the reflection text; after close: submit → `INTERNSHIP_CLOSED`, `internship_open_day` → `INTERNSHIP_CLOSED`, `send_message` in the group → `INTERNSHIP_CLOSED`, mentor `review_assignment` → `INTERNSHIP_CLOSED`, stream comment still allowed; close again → `ALREADY_CLOSED`; reopen without reason → `REASON_REQUIRED`; reopen → submit works again; close again → `report_version = 2`; report readable by the student and the mentor.
- C (`SET LOCAL ROLE authenticated`): the student reads the row / report; an advisor of another group → `REPORT_FORBIDDEN` (SKIP without one); a second student → 0 rows on direct SELECT.
- Jest: `parseMarkdownTables`/`renderMarkdownBlocks` helper for the viewer; `closureLabel(status)`.

## 8. Out of scope

PDF export; a grade or pass/fail outcome; report language selection; linking closure to group archive; editing the report; per-task or per-day exceptions after closure; a student-initiated closure request.
