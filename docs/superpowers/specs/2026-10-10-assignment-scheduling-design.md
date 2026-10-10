# Sending a task can be scheduled — 2026-10-10

**Status:** approved in conversation on 2026-10-10, on the project owners' request.
**Amends:** `2026-08-20-task-assignment-design.md` and
`2026-09-26-assignment-targeting-design.md`. Publishing stays what it was; this
document adds a second way to trigger it.

## Why

The owners asked that a prepared task be able to go out at a chosen moment —
"tomorrow at 15:00, to these two students" — instead of only when the advisor
taps send. They gave no reason beyond that, so the design has to work for every
plausible one: an advisor who prepares in the evening and does not want to wake
students, a task meant to open as a lab session starts, or simply a week's work
queued in advance. Making it work for the strictest of those (the task appears
*and* is announced at the chosen time) also makes it work for the others, and
costs one Postgres extension the project has so far avoided.

## What a scheduled send is

A third state on an assignment, between draft and published:

| State | `scheduled_for` | `published_at` |
|---|---|---|
| Draft | NULL | NULL |
| Scheduled | set | NULL |
| Published | cleared | set |

**A scheduled assignment is still a draft to every rule that already exists.**
It is invisible to students, has no stream card, cannot be submitted to, stays
out of the closure report and the CSV export, and can still be edited, deleted
or re-targeted. Nothing about visibility changes, and no predicate is rewritten.

That is the whole reason for a separate column. The alternative — writing a
future timestamp into `published_at` and changing every `published_at IS NOT
NULL` test to `published_at <= now()` — would have been tidier on paper and
touched the read policy, both visibility predicates, `publish_assignments`'
own re-publish guard, the client's draft derivation, the counts, the closure
report and the CSV export. Missing one of those would make a scheduled task
visible early. With a separate column the worst case is that a task goes out a
minute late. This is the same reasoning that chose an explicit `audience`
column over "no target rows means everyone": when a mistake is possible, make
it fail towards hiding rather than revealing.

## Writing the schedule

```sql
schedule_assignments(p_ids UUID[], p_at TIMESTAMPTZ) RETURNS INT
```

Advisor-only, and it runs **at schedule time every check that publishing runs**:
the group's competency scope (`NOT_IN_SCOPE`, naming the offending task), a
`selected` audience with no targets (`TARGETS_REQUIRED`), and a time that is not
in the past (`SCHEDULE_IN_PAST`). Catching these while the advisor is looking at
the screen is the point — at 15:00 nobody is there to read an alert.

`p_at` NULL cancels: the rows go back to being plain drafts. It returns the
number of rows it scheduled, and refuses an assignment that is already
published (`ALREADY_PUBLISHED`) — a sent task cannot be un-sent by scheduling
it again.

Re-scheduling a row that previously failed clears its `schedule_error`.

## What runs at the chosen time

`pg_cron`, which this project has not used before. The internship-days work
deferred a weekly reminder for exactly this reason; enabling the extension
unblocks that too, though it stays out of scope here.

Publishing is split so that a human tap and a timer run the *same* code:

- **`publish_assignments_internal(p_ids)`** — the scope re-check, the targets
  re-check, `published_at = now()`, `scheduled_for` cleared, and the
  notifications. No identity check. `REVOKE`d from `authenticated` and `anon`,
  the way `feed_publish_assignment` already is: only callers inside the database
  reach it.
- **`publish_assignments(p_ids)`** — the existing public RPC, same signature.
  Checks `auth.uid()` and `owns_group`, then calls the internal one.
- **`publish_due_assignments()`** — the cron entry point. The job runs **every
  minute**, which is where the "up to a minute late" budget comes from; its cost
  is one query over a partial index on the due rows.

The stream card needs nothing: `trg_feed_assignment_post` already fires when
`published_at` goes from NULL to a timestamp, and already skips a `selected`
audience.

### Batches, not rows

`publish_due_assignments` groups due rows by `(group_id, scheduled_for)` and
publishes each group as one batch. This matters because of how students are
told: today the client writes **one notification per student for the whole
batch** — the task's title when a batch is one task, a count when it is several.
Publishing row by row would turn one scheduled batch of three tasks into three
notifications. Grouping also keeps the all-or-nothing refusal the manual path
already has, so a batch behaves the same whichever way it was triggered.

## Notifications move into SQL

They have to: a cron job cannot call the client. Rather than keep two writers,
notification writing moves into `publish_assignments_internal` and the client's
loop in `app/(advisor)/group-assignments.tsx` goes away. `submit_assignment` and
`review_assignment` already write their notifications in SQL; this removes the
last client-side writer and, with it, the duplicated recipient logic that the
2026-09-26 whole-branch review found a bug in.

**The language changes, and it is an improvement.** Because the client writes
the text today, the notification is written in **the advisor's** locale — a
Turkish advisor sends a Turkish notification to a Greek student. In SQL it is
written in English like every other system notification, and
`src/utils/notificationContent.ts` renders it in Turkish at display time; that
file already carries the `task_assigned` mapping. The other five locales keep
seeing English, exactly as they already do for `task_submitted`,
`task_approved` and every internship notification. No new class of problem, one
fewer inconsistency, and the five-locale gap stays what it was: pre-existing,
affecting every notification type, and a separate piece of work.

Recipients are unchanged: the group's active members for a `group` audience, the
target rows for a `selected` one.

## When a scheduled send fails

Most failures are caught at schedule time. What can still change before the hour
arrives: the advisor removes the competency from the group's targets, a targeted
student leaves the group, the group is archived.

When a batch is refused at its scheduled time:

- nothing is published, `scheduled_for` stays, and the reason is written to a
  new `schedule_error TEXT` column on every row in the batch;
- the job **skips rows that already carry an error** on later runs, so a
  permanent failure is reported once instead of every minute;
- the advisor gets an in-app notification — "A scheduled task could not be
  sent", with the reason — routed to the drafts tray. The cron job runs inside
  the database, so it writes the row directly;
- the card in the drafts tray shows the failure, and re-scheduling clears it.
  A failed row's time is necessarily in the past, so it satisfies the overdue
  condition below as well: **failed wins**, because it is the state that tells
  the advisor something is wrong rather than merely late.

Without that notification a scheduled task would simply never arrive and nobody
would know, which is the failure the owners would notice last and mind most.

## If the scheduler itself stops

A silent `pg_cron` outage would leave tasks sitting scheduled forever. The
cheap guard: a row whose `scheduled_for` is in the past and which is still
unpublished reads **overdue** in the drafts tray, with a "Send now" button
beside it. An infrastructure failure becomes something the advisor can see and
recover from in one tap, rather than a mystery.

## The advisor's flow

On the review screen, under the audience choice, a second choice: **Send now**
(today's behaviour, the default) or **Schedule**, which reveals a date and time
picker. The picker produces the advisor's local time and stores a
`timestamptz`, so a student in another country sees the moment in their own.

The screen already carries a **due date**. Two date fields next to each other
invite confusion, so they are visually separated and a send time later than the
due date is refused — otherwise the advisor would hand a student a task that was
already overdue when it arrived.

The drafts tab distinguishes scheduled rows: the card reads when it will go out,
offers **Cancel schedule** and **Send now**, and shows the overdue and failed
states above.

## Verification

`docs/assignment-scheduling-verification.sql`, the house structure, every part
returning a result set.

**A — structural:** `scheduled_for` and `schedule_error` exist;
`publish_assignments_internal` is `SECURITY DEFINER` with a fixed `search_path`
and is revoked from `authenticated` and `anon`; `schedule_assignments` is
granted to `authenticated`; the job is registered in `cron.job`.

**B — behaviour**, against the simulation group `58MMWL`, inside
`BEGIN … ROLLBACK`, each check its own PASS/FAIL line:

- scheduling into the past raises `SCHEDULE_IN_PAST`;
- scheduling a task outside the group's competency scope raises `NOT_IN_SCOPE`
  and names it;
- scheduling a `selected` task with no targets raises `TARGETS_REQUIRED`;
- a scheduled task is invisible to its own targets and cannot be submitted to;
- `publish_due_assignments()`, called directly, publishes a task whose time has
  passed and leaves one whose time has not;
- it writes one notification per recipient per batch, not per assignment;
- a group-audience publish creates a stream card, a selected one does not;
- a batch that fails is not published, carries `schedule_error`, notifies the
  advisor, and is skipped on the next run while a healthy batch in the same run
  still publishes;
- `p_at` NULL returns the rows to drafts.

**C — policies** under `SET LOCAL ROLE authenticated`: a student cannot see a
scheduled assignment, and `authenticated` cannot call
`publish_assignments_internal`.

**Jest** covers the pure helpers: the state derivation (draft / scheduled /
published / overdue / failed) and the send-time-before-due-date rule.

**Device walk**: schedule a task two minutes out for two students, watch it
arrive, confirm the notification and the absent stream card; then schedule one,
break its scope, and confirm the advisor is told.

## Owner action

`pg_cron` must be enabled once in the Supabase dashboard (Database →
Extensions). It is free. The job itself is registered by the migration file.

## Out of scope

Recurring schedules ("every Monday"), telling students in advance that a task is
coming, and the deferred weekly attendance reminder — which enabling `pg_cron`
makes possible but which is its own design.
