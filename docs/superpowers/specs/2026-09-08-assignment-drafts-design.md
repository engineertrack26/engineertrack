# Assignment drafts — the advisor prepares before sending

Date: 2026-09-08. Branch `feature/competency-framework`.

## Why

The advisor picks tasks from the framework and they reach students immediately.
There is no moment between choosing and sending, so a task arrives with whatever
the triplet said and nothing the advisor wanted to add — no context, no brief, no
attached document. The advisor asked for that moment.

What they described: pick tasks; give each one its own description and, if
useful, a `.pdf` or `.docx`; neither mandatory; then see the chosen tasks listed
and editable — including the task's own wording, which they may want to develop
further — and only then send them to the students.

## What this does NOT change

**Triplet text stays immutable.** Editing "the task itself" sounds like it
contradicts the settled decision that adaptation happens by selection, not by
rewriting. It does not, and this was verified rather than assumed:
`group_assignments` is a *copy* of the triplet's text made at creation, and
`freeze_assessed_assignment` locks `objective`, `criterion` and `triplet_id`
only once a submission exists (`docs/task-assignment-migration.sql`). A draft
has no submissions, so it is fully editable, while `kpi_triplets` is never
touched. The catalogue the framework promises stays as written.

## 1. Data model and the draft state

```sql
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS document_path TEXT;
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS document_name TEXT;
```

`published_at IS NULL` means draft. A timestamp rather than a status enum
because it also records **when** the task was sent — nothing captures that
today, and the advisor's card is a natural place to show it.

The read policy splits so drafts are invisible to everyone but their author:

```sql
owns_group(group_id)
OR (published_at IS NOT NULL
    AND (is_member_of_group(group_id) OR mentors_a_member_of_group(group_id)))
```

All three helpers already exist as `SECURITY DEFINER STABLE`. Hiding drafts is
enforced here, not by a filter on a screen: a client-side filter would leave the
rows readable to anything else that queries the table.

### Publishing

Publishing is an RPC:

```sql
publish_assignments(p_ids UUID[]) RETURNS INT  -- SECURITY DEFINER
```

It verifies `owns_group` for every row, re-checks competency scope for every
row, and sets `published_at = now()` — all or nothing.

A plain `UPDATE` would have been enough for the write itself; the update policy
already requires `owns_group`, and one statement is atomic. The scope re-check
is what makes an RPC necessary, because it has to run server-side against the
group's *current* targets and refuse before anything is published.

**Why the scope re-check exists.** `trg_assignment_within_scope` is
`BEFORE INSERT` only. An advisor can draft a task, switch that competency out of
the group's targets, then publish: nothing re-runs the check, the task reaches
the student, and the refusal finally lands on the *mentor* at review time, who
cannot fix it. The branch already hit exactly this trap once, as finding I-4.
The RPC refuses with `NOT_IN_SCOPE`.

### The freeze trigger is unchanged

It already draws the line in the right place. Drafts have no submissions, so
everything is editable; once a student submits, `objective` and `criterion`
lock while `title`, `description`, `due_date` and the document stay editable.

## 2. Documents

A new private bucket, `assignment-docs`.

`log-documents` cannot be reused. Its read policy requires the first path
segment to be the *reader's own* uid, or the reader to be that person's mentor
or advisor. An advisor uploading under their own id would be unreadable by the
student: they are not the advisor's advisor. That is not hypothetical — it is
the same class of failure as the private-bucket bug found on device on
2026-09-08, where evidence rendered blank because nobody signed the URLs.

### Path shape

`<groupId>/<assignmentId>/<timestamp>_<filename>`

The group id comes **first** because a storage policy can only reason about the
object's path — it cannot join to a row. With the group id in segment one, the
three existing group helpers apply directly:

| Operation | Policy |
|---|---|
| upload | `owns_group((storage.foldername(name))[1]::uuid)` |
| read | `owns_group(...) OR is_member_of_group(...) OR mentors_a_member_of_group(...)` |
| delete | `owns_group(...)` |

### The row stores a PATH, not a URL

`document_path`, not `document_url`. Two failures already on this branch say
why: `getPublicUrl` on a private bucket is a dead link, and a signed URL
expires. The path is the durable part. Signing happens at read time through
`src/services/evidenceUrls.ts`, which already does exactly this for submission
evidence and takes a third bucket without redesign.

**One document per task.** This matches the student's evidence cap of one
document, and a separate table for a single optional attachment would be
overhead with its own RLS to get wrong.

## 3. The advisor's flow

The picker is unchanged: competency → level → tick tasks, selection persisting
across competencies.

What follows it changes from a summary to a two-step:

1. **"Add to draft"** writes the ticked tasks in one batch with
   `published_at = NULL` and clears the selection. Rows are written here, not on
   every tick — a tick-and-untick would otherwise be a write and a delete, and
   the multi-select would stop feeling like a selection.
2. **The draft tray** lists those cards above the sent ones, each marked as not
   yet sent. Expanding one edits its title, description, objective, criterion,
   due date, and attaches or replaces its single document. A batch due date
   entered before step 1 is applied to all of them as a default and can be
   overridden per card.
3. **"Send to students"** calls `publish_assignments`, then sends one
   notification per student for the batch — the batch-level notification the
   advisor screen already uses, rather than one per task.

The card-plus-edit-panel pattern is not new: the sent assignments below already
work this way, so the draft tray borrows an interaction the advisor has used.

## 4. Student and mentor

**Student:** never sees drafts, and that comes from the policy rather than a
screen filter. A published task's card shows the description (already rendered)
and, when present, a document row that opens the signed URL.

**Mentor:** the same, and it is not optional. The mentor assesses against the
criterion; a brief the advisor attached is part of what they are judging
against, and they cannot judge what they cannot open.

`GroupAssignment` gains `documentPath` and `documentName`. The service signs
the document the same way it signs evidence, in the same module.

## 5. Verification

Four things can be silently wrong here, and all four are RLS behaviour — which
means they must be **evaluated** under `SET LOCAL ROLE authenticated`, never
asserted from the catalog. Two separate incidents on this branch have already
turned on that distinction.

1. **A student cannot read a draft.** If they can, unfinished preparation is
   visible before it is sent.
2. **The advisor CAN read their own draft.** The positive control. Without it,
   case 1 returning zero rows is indistinguishable from a policy that refuses
   everyone, or a fixture that was never built.
3. **Publishing an out-of-scope draft is refused.** The only evidence that the
   publish path re-checks scope rather than trusting the insert-time trigger.
4. **A student can sign the advisor's document.** The entire reason for the new
   bucket; storage policies need role evaluation exactly as table policies do.

**No jest suite is proposed.** Almost all of this logic is server-side, and
there is no pure helper worth extracting. Writing a test here to satisfy a habit
would be a test that asserts nothing.

## 6. Cost and sequencing

This requires **a new migration**: two columns, one rewritten read policy, one
RPC, one bucket and three storage policies. That means running SQL in the
Supabase editor again.

It is independent of D3 (mentor and advisor tab bars, the reports rewrite, the
deletion of `review-log.tsx` and `validation.tsx`). The two touch different
advisor screens and can be built in either order.

## 7. Risks

- **`publish_assignments` is the first RPC to refuse a batch wholesale.** If one
  drafted task has fallen out of scope, the whole publish fails. That is the
  right default — a partly-sent batch is harder to reason about than a refused
  one — but the message must name which task, or the advisor is left hunting.
- **An abandoned draft lives forever.** Nothing expires or cleans up drafts, and
  an uploaded document for a draft that is never sent stays in the bucket. This
  is deliberate: silently deleting an advisor's preparation is worse than
  storing it. Worth revisiting if it accumulates.
- **The document is not versioned.** Replacing it overwrites the reference; the
  old object is orphaned in the bucket rather than deleted, matching how the
  student's evidence picker already behaves.
