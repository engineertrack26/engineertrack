# Assignment drafts implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the advisor a moment between choosing a task and sending it — to write a description, attach a document, and edit the task's wording — then publish the batch to students.

**Architecture:** `published_at IS NULL` marks a draft, and the read policy hides drafts from everyone but their author. Publishing goes through an RPC because it must re-check competency scope, which the insert-time trigger cannot. Documents live in a new private bucket keyed by group id so the existing group helpers serve as its storage policies, and the row stores the storage path rather than a URL.

**Tech Stack:** PostgreSQL 15 (Supabase), `plpgsql` RPC, RLS and storage policies, Expo SDK 57 / React Native / TypeScript, `expo-document-picker`, i18next (`en.json` only).

**Spec:** `docs/superpowers/specs/2026-09-08-assignment-drafts-design.md`

## Global Constraints

- **Do not run any migration and do not connect to a database.** SQL is written to files; the user applies it in the Supabase SQL editor.
- All SQL **idempotent and safe to re-apply**. `ADD CONSTRAINT` has no `IF NOT EXISTS` — `DROP CONSTRAINT IF EXISTS` first. Same for policies and triggers. **No `CASCADE` on any `DROP`.**
- The Supabase SQL editor accepts **anonymous `$$` only**; a named dollar tag fails with `42601`.
- Every RPC refusal reaches the user through `mapRpcError`, never a raw `err.message`.
- Only `src/i18n/locales/en.json` among the seven locale files. Translation is paused project-wide.
- Imports use path aliases (`@/...`), never relative paths out of `src/`.
- `npx tsc --noEmit` silent; `npx jest --silent` green at **6 suites / 36 tests** — this plan adds no suite (see the spec's section 5 for why).
- Advisor tab bar stays at 7 visible tabs.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Existing interfaces this plan builds on

Read these before starting; the plan assumes their shapes.

- `src/services/evidenceUrls.ts` — exports `PHOTO_BUCKET`, `DOCUMENT_BUCKET`, `extractStoragePath(urlOrPath, bucket)`, `signEvidence(photos, documents)`. Task 3 extends it.
- `src/utils/rpcErrors.ts` — already maps `NOT_IN_SCOPE` → `errors.notInScope` and `ASSIGNMENT_LOCKED` → `errors.assignmentLocked`.
- `owns_group(uuid)`, `is_member_of_group(uuid)`, `mentors_a_member_of_group(uuid)` — all `SECURITY DEFINER STABLE`, defined in `docs/internship-groups-rls-recursion-fix.sql` and `docs/task-assignment-migration.sql`.
- `app/(advisor)/group-assignments.tsx` (1,172 lines) — the picker, the batch selection (`picked: Map<string, KpiTriplet>`), `handleAssign`, and the sent-assignment cards with their inline edit panel.

## File Structure

- **Create** `docs/assignment-drafts-migration.sql` — columns, read policy, bucket, storage policies (Task 1).
- **Create** `docs/assignment-drafts-rpcs.sql` — `publish_assignments` (Task 2).
- **Create** `docs/assignment-drafts-verification.sql` — Parts A/B/C (Tasks 1, 2, 6).
- **Modify** `src/services/evidenceUrls.ts` — the third bucket and its signer (Task 3).
- **Modify** `src/services/assignments.ts`, `src/types/assignment.ts` — draft fields, publish, document upload (Task 3).
- **Modify** `app/(advisor)/group-assignments.tsx` — the draft tray (Tasks 4 and 5).
- **Modify** `app/(student)/my-tasks.tsx`, `app/(mentor)/pending-reviews.tsx` — render the brief (Task 5).

---

### Task 1: Schema, the draft read policy, and the bucket

**Files:**
- Create: `docs/assignment-drafts-migration.sql`
- Create: `docs/assignment-drafts-verification.sql`

**Interfaces:**
- Consumes: `owns_group`, `is_member_of_group`, `mentors_a_member_of_group`.
- Produces: `group_assignments.published_at TIMESTAMPTZ NULL`, `.document_path TEXT`, `.document_name TEXT`; the rewritten `assignments read` policy; the `assignment-docs` bucket and its three storage policies.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================
-- Assignment drafts: the advisor prepares before sending
--
-- Idempotent and safe to re-apply.
-- ============================================

-- published_at IS NULL means draft. A timestamp rather than a status enum
-- because it also records WHEN a task was sent, which nothing captures today.
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- The storage PATH, not a URL. getPublicUrl on a private bucket is a dead link
-- and a signed URL expires -- both already cost this branch a bug. The path is
-- the durable part; signing happens at read time.
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS document_path TEXT;
ALTER TABLE group_assignments ADD COLUMN IF NOT EXISTS document_name TEXT;
```

**Every existing row must become published, not draft.** A plain `ADD COLUMN`
leaves `published_at` NULL on every assignment already out there, which under
the new policy would hide the entire live catalogue from every student and
mentor at once. Backfill in the same file, before the policy changes:

```sql
-- Existing assignments were sent the moment they were created; created_at is
-- the closest true record of when. Without this the new read policy hides
-- every already-assigned task from the students working on it.
UPDATE group_assignments SET published_at = created_at WHERE published_at IS NULL;
```

- [ ] **Step 2: Rewrite the read policy**

```sql
-- Drafts are invisible to everyone but their author, and that is enforced
-- here rather than by a filter on a screen: a client-side filter would leave
-- the rows readable to anything else that queries this table.
DROP POLICY IF EXISTS "assignments read" ON group_assignments;
CREATE POLICY "assignments read" ON group_assignments
  FOR SELECT TO authenticated USING (
    owns_group(group_id)
    OR (published_at IS NOT NULL
        AND (is_member_of_group(group_id) OR mentors_a_member_of_group(group_id)))
  );
```

Leave the insert, update and delete policies exactly as they are.

- [ ] **Step 3: Create the bucket and its policies**

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('assignment-docs', 'assignment-docs', false)
ON CONFLICT (id) DO NOTHING;
```

The path is `<groupId>/<assignmentId>/<timestamp>_<filename>` — the group id
first, because a storage policy can only reason about the object's path and
cannot join to a row. That single fact is why the three existing group helpers
work here unchanged.

```sql
-- The group id is the FIRST path segment on purpose: a storage policy sees the
-- object name and nothing else, so anything it must decide has to be in the
-- path. With the group there, owns_group / is_member_of_group /
-- mentors_a_member_of_group answer directly.
DROP POLICY IF EXISTS "assignment_docs_upload" ON storage.objects;
CREATE POLICY "assignment_docs_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'assignment-docs'
    AND auth.role() = 'authenticated'
    AND owns_group((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "assignment_docs_read" ON storage.objects;
CREATE POLICY "assignment_docs_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'assignment-docs'
    AND auth.role() = 'authenticated'
    AND (
      owns_group((storage.foldername(name))[1]::uuid)
      OR is_member_of_group((storage.foldername(name))[1]::uuid)
      OR mentors_a_member_of_group((storage.foldername(name))[1]::uuid)
    )
  );

DROP POLICY IF EXISTS "assignment_docs_delete" ON storage.objects;
CREATE POLICY "assignment_docs_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'assignment-docs'
    AND owns_group((storage.foldername(name))[1]::uuid)
  );
```

A malformed path whose first segment is not a UUID makes the `::uuid` cast
raise rather than return false. That is the safe direction — the write is
refused — and the only writer is our own uploader, which always leads with a
real group id.

Do not reuse `log-documents`: its read policy requires the first path segment to
be the reader's own uid, so a student could never open a file the advisor
uploaded. Say so in a comment — a future reader will otherwise try to merge the
two buckets.

- [ ] **Step 4: Write Part A of the verification**

Create `docs/assignment-drafts-verification.sql`. Follow the header and tone of
`docs/daily-log-retirement-verification.sql`, including its warning that Part A
is structural because the editor runs as table owner and an owner bypasses RLS.

Part A asserts: the three columns exist; the `assignment-docs` bucket exists and
has `public = false`; three policies exist on `storage.objects` for that bucket;
**and no `group_assignments` row has a NULL `published_at`** — that last one is
the backfill's only proof, and without it a forgotten backfill looks identical
to a working migration until a student opens the app.

Close Part A with `SELECT 'PASS: schema assertions held' AS part_a;`.

- [ ] **Step 5: Commit**

```bash
git add docs/assignment-drafts-migration.sql docs/assignment-drafts-verification.sql
git commit -m "feat(drafts): draft column, read policy and the document bucket

published_at IS NULL marks a draft and the read policy hides drafts from
everyone but their author. Existing rows are backfilled to published --
without that the new policy would hide the entire live catalogue.

assignment-docs is its own bucket because log-documents' read policy wants
the first path segment to be the reader's own uid, so a student could never
open a file the advisor uploaded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `publish_assignments`

**Files:**
- Create: `docs/assignment-drafts-rpcs.sql`
- Modify: `docs/assignment-drafts-verification.sql` (append Part B)

**Interfaces:**
- Consumes: `published_at` from Task 1; `owns_group`; `group_competency_targets`; `kpi_triplets`, `competency_kpis`.
- Produces: `publish_assignments(p_ids UUID[]) RETURNS INT`, granted to `authenticated`.

- [ ] **Step 1: Write the RPC**

```sql
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
```

- [ ] **Step 2: Write Part B**

Append a Part B to the verification file, as owner, inside one
`BEGIN;`…`ROLLBACK;` block, following the shape of
`docs/daily-log-retirement-verification.sql`'s Part B — including its
per-case `BEGIN … EXCEPTION` wrappers so one throw cannot lose every result,
and its `probe.results` GUC handoff.

Cases, each capable of failing:

| Case | Expected |
|---|---|
| B1 publish an in-scope draft | returns 1, `published_at` is not null |
| B2 publish an out-of-scope draft | refused, and the message contains the task's title |
| B3 re-publish an already-published row | returns 0, `published_at` unchanged |

B3 is the one that looks redundant and is not: without the
`AND published_at IS NULL` guard it would silently reset the timestamp that
records when students first saw the task.

The fixture needs an advisor, a group, and two draft assignments — one from a
competency the group targets and one from a competency removed from
`group_competency_targets` after the draft was created. Note that inserting a
group fires `tr_seed_group_competency_targets`, which seeds **every** competency
as a target, so B2's fixture has to DELETE the target row to create the
out-of-scope condition rather than assuming it starts absent.

- [ ] **Step 3: Commit**

```bash
git add docs/assignment-drafts-rpcs.sql docs/assignment-drafts-verification.sql
git commit -m "feat(drafts): publish_assignments re-checks scope

The write alone did not need an RPC. The scope re-check does:
trg_assignment_within_scope is BEFORE INSERT, so an advisor could draft a
task, narrow the group's targets, publish, and leave the refusal to land on
the mentor at review time. The branch already hit that as I-4.

All or nothing, and the refusal names the task -- 'something is out of
scope' sends the advisor hunting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The service layer

**Files:**
- Modify: `src/services/evidenceUrls.ts`
- Modify: `src/types/assignment.ts`
- Modify: `src/services/assignments.ts`
- Modify: `src/utils/rpcErrors.ts`, `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `publish_assignments` from Task 2; the columns from Task 1.
- Produces:
  - `ASSIGNMENT_DOC_BUCKET = 'assignment-docs'` and
    `signAssignmentDocument(path: string | undefined): Promise<string | undefined>` in `evidenceUrls.ts`
  - `GroupAssignment.publishedAt?: string`, `.documentPath?: string`, `.documentName?: string`, `.documentUrl?: string`
  - `assignmentService.createDrafts(inputs: Array<{ groupId: string; tripletId: string; title: string; objective: string; criterion: string; dueDate?: string; createdBy: string }>): Promise<PromiseSettledResult<GroupAssignment>[]>`
  - `.publishAssignments(ids: string[]): Promise<number>`
  - `.uploadAssignmentDocument(groupId, assignmentId, uri, fileName, fileType): Promise<{ path: string; name: string }>`
  - `.setAssignmentDocument(id: string, path: string | null, name: string | null): Promise<GroupAssignment>` — writes the two columns; `null, null` detaches

- [ ] **Step 1: Extend the signing module**

`evidenceUrls.ts` already owns bucket names, `extractStoragePath` and read-time
signing. Add the third bucket and a signer for a single optional document. It
takes a **path**, not a URL, because that is what the column stores now — but
route it through `extractStoragePath` anyway so a row that somehow holds a URL
still resolves. `extractStoragePath` already accepts a bare path.

Return `undefined` on failure rather than throwing, matching `sign()`: a brief
that will not open is worth more than a screen that will not load.

- [ ] **Step 2: Types and the mapper**

Add the four fields to `GroupAssignment`. In `toAssignment`, map
`published_at`, `document_path`, `document_name`. Leave `documentUrl` unset
there — it is filled by the signing step, so the mapper stays synchronous and
the one place that signs is obvious.

- [ ] **Step 3: Drafts, publishing and upload**

- `createDrafts` is today's `createAssignment` loop with `published_at` left
  NULL. Keep `Promise.allSettled` and the partial-result reporting the advisor
  screen already relies on.
- `publishAssignments(ids)` calls the RPC and wraps errors in `RpcError` so
  `mapRpcError` reaches them.
- `uploadAssignmentDocument` uploads to `assignment-docs` under
  `${groupId}/${assignmentId}/${Date.now()}_${fileName}` and returns the
  **path**, not a URL. Reuse the FormData/fetch shape from
  `logService.uploadDocumentFile`; do not invent a second uploader.
- `listGroupAssignments` signs `documentPath` into `documentUrl` for each row,
  the way `listMyAssignments` already signs evidence.

- [ ] **Step 4: The refusal message**

`publish_assignments` raises `NOT_IN_SCOPE: <title>`. `mapRpcError` already maps
the bare `NOT_IN_SCOPE` code — check whether it matches a prefix or the whole
string, and make the title reach the user either way. If `mapRpcError` needs a
prefix match, add it there rather than special-casing at the call site.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit && npx jest --silent
```

Expected: silent; green at 6 suites / 36 tests.

- [ ] **Step 6: Commit**

```bash
git add src/services/ src/types/assignment.ts src/utils/rpcErrors.ts src/i18n/locales/en.json
git commit -m "feat(drafts): service layer for drafts, publishing and briefs

The document column holds a storage path and evidenceUrls signs it at read
time -- the third bucket costs that module one constant and one function,
which is why the private-bucket fix was worth generalising.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The draft tray

**Files:**
- Modify: `app/(advisor)/group-assignments.tsx`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: the advisor's two-step flow.

- [ ] **Step 1: Split the list**

`assignments` currently holds one list. Derive two from it —
`drafts = assignments.filter(a => !a.publishedAt)` and the rest — and render the
drafts **above** the sent ones, under their own heading, each card marked as not
yet sent.

Do not add a second query. One list, two views of it: a second fetch is a second
thing that can disagree with the first.

- [ ] **Step 2: "Add to draft"**

Rename the selection summary's action from Assign to **Add to draft**, and point
it at `createDrafts`. On success, clear the selection and reload — the new cards
appear in the tray.

Rows are written here rather than on every tick. A tick-and-untick would
otherwise be a write and a delete, and the multi-select would stop behaving like
a selection.

The batch due date keeps its current meaning: a default applied to every task in
the batch, overridable per card afterwards.

- [ ] **Step 3: The draft card's edit panel**

The sent cards already have an inline edit panel for title, description,
objective, criterion and due date. Draft cards use the same panel — a draft has
no submissions, so `freeze_assessed_assignment` cannot fire and every field is
editable.

Add one control the sent panel does not have: **attach a document**. Use
`expo-document-picker` with the option object copied from
`src/components/forms/EvidencePicker.tsx`, restricted to PDF and Word:

```ts
type: ['application/pdf',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
```

Attaching is two calls, in this order: `uploadAssignmentDocument` puts the file
in the bucket and returns its path, then `setAssignmentDocument(id, path, name)`
writes the two columns. Upload first — a row pointing at an object that failed
to upload is a broken link, while an uploaded object no row references is only
wasted bytes.

One document per task. When one is already attached, show its name with a
replace and a remove control; remove calls `setAssignmentDocument(id, null, null)`.
Replacing overwrites the row's reference and leaves the old object in the bucket
— same as the student's picker, and worth a comment saying it is deliberate
rather than forgotten.

- [ ] **Step 4: "Send to students"**

One button under the tray publishes **every** draft in it. Call
`publishAssignments`, then send one notification per student for the batch,
reusing the batch-notification shape `handleAssign` already uses.

On `NOT_IN_SCOPE`, show the message with the offending task's title. Do not
clear the tray — the advisor has to fix that task, and clearing would take away
what they need to fix.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit && npx jest --silent
```

Expected: silent; green at 6 suites / 36 tests.

- [ ] **Step 6: Commit**

```bash
git add "app/(advisor)/group-assignments.tsx" src/i18n/locales/en.json
git commit -m "feat(drafts): the advisor's draft tray

Add to draft writes the batch unpublished; the tray lists those cards above
the sent ones and reuses the inline edit panel they already use, plus a
document picker. Send to students publishes the whole tray.

A NOT_IN_SCOPE refusal keeps the tray -- the advisor needs the task it
names in order to fix it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The student and the mentor see the brief

**Files:**
- Modify: `app/(student)/my-tasks.tsx`
- Modify: `app/(mentor)/pending-reviews.tsx`
- Modify: `src/services/assignments.ts`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `documentUrl` / `documentName` from Task 3.
- Produces: nothing downstream.

- [ ] **Step 1: Sign the document in both queries**

`listMyAssignments` and `listPendingReviews` already sign evidence. Sign the
assignment's document in the same pass, so one round of signing covers
everything a card renders.

- [ ] **Step 2: Render it**

On the student's card detail and the mentor's review panel, below the
description and above the objective, render a document row when
`documentName` is present: the filename, tappable, opening `documentUrl` with
`Linking.openURL` — the pattern `pending-reviews.tsx` already uses for evidence
documents.

Render nothing when there is no document. An empty "Brief" heading reads as a
failed load; that exact shape was already flagged once on this branch.

The mentor's copy is not optional: they assess against the criterion, and a
brief the advisor attached is part of what they are judging against.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit && npx jest --silent
```

Expected: silent; green at 6 suites / 36 tests.

- [ ] **Step 4: Commit**

```bash
git add "app/(student)/my-tasks.tsx" "app/(mentor)/pending-reviews.tsx" src/services/assignments.ts src/i18n/locales/en.json
git commit -m "feat(drafts): students and mentors can open the brief

Signed in the same pass as the evidence. Renders nothing when absent -- an
empty heading reads as a failed load.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Part C — the policies, actually evaluated

**Files:**
- Modify: `docs/assignment-drafts-verification.sql`

**Interfaces:**
- Consumes: the policies from Task 1.
- Produces: nothing downstream.

Parts A and B run as the table owner, and an owner bypasses RLS. They prove a
policy exists. Part C is the only place that proves one can be evaluated — the
distinction that has already cost this branch two separate incidents.

- [ ] **Step 1: Write Part C**

Mirror `docs/daily-log-retirement-verification.sql`'s Part C exactly:
owner-built fixtures, ids handed over in transaction-local GUCs,
`SET LOCAL ROLE authenticated`, `RESET ROLE` before the results are read,
`ROLLBACK` at the end, and the `SKIP` path when the database lacks the profiles
the fixture needs.

| Case | Expected |
|---|---|
| C1 advisor reads own draft | 1 row — **positive control** |
| C2 student reads a draft | 0 rows |
| C3 student reads a published assignment | 1 row — the second positive control |
| C4 student signs the advisor's document | succeeds |

C1 and C3 are not decoration. Without C1, C2 returning zero is
indistinguishable from a policy that refuses everyone or a fixture that was
never built. Without C3, a policy that hid *everything* from students would
pass C2 and look correct.

C4 exercises `storage.objects`, which needs an object to exist — insert one as
owner in the fixture, then attempt `createSignedUrl` as the student. If signing
cannot be driven from SQL in this editor, say so and report C4 as unrunnable
rather than replacing it with a catalog lookup that asserts less while reading
as though it proved more.

- [ ] **Step 2: Write the run instructions**

Append a closing section: the three parts are submitted **separately**, Parts B
and C each as one block from `BEGIN;` to `ROLLBACK;` because the editor gives
each submission its own connection. Expected row counts per part. Any cell
beginning `FAIL`, `SKIP`, `INCONCLUSIVE` or `ABORTED` is a real result.

State the apply order plainly: **migration, then rpcs, then verification** — and
that the client changes and the SQL must land together, because the advisor
screen calls `publish_assignments` and the student's read depends on the
backfill.

- [ ] **Step 3: Commit**

```bash
git add docs/assignment-drafts-verification.sql
git commit -m "test(drafts): Part C evaluates the draft policy under RLS

Two positive controls, not one: without the advisor's read, C2's zero rows
could be a policy refusing everyone; without the published read, a policy
hiding everything from students would pass and look correct.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Apply the SQL and walk it on a device

**Files:** none.

The only task that touches the database. It runs after Task 6, never before.

- [ ] **Step 1: Apply, in order**

1. `docs/assignment-drafts-migration.sql`
2. `docs/assignment-drafts-rpcs.sql`
3. `docs/assignment-drafts-verification.sql` — Parts A, B and C submitted separately

- [ ] **Step 2: Read the results honestly**

Expected: Part A one `PASS` row; Part B three rows; Part C four rows. Report any
`FAIL`, `SKIP`, `INCONCLUSIVE` or `ABORTED` verbatim rather than interpreting it.

If `SET LOCAL ROLE authenticated` raises `42501`, Part C is unrunnable in that
editor — report it as unrunnable. Do **not** substitute catalog lookups.

- [ ] **Step 3: Walk it**

1. Advisor picks three tasks across two competencies, sets a batch due date, taps **Add to draft**.
2. The tray lists three cards marked not yet sent. **A student logged in at this moment sees none of them.**
3. Advisor edits one card's description and its title, attaches a PDF to another.
4. **Send to students.** One notification per student, not one per task.
5. Student opens a task: description and the brief, tappable, opens.
6. Mentor's review panel shows the same brief.
7. Advisor switches one of the two competencies out of the group's scope, drafts a task from it, and taps Send — **refused, naming that task**, and the tray still holds it.

Step 2 and step 7 are the two that cannot be checked any other way. Record what
actually happened at each step, including anything not run.

---

## Risks

- **The backfill is the highest-consequence line in this plan.** Miss it and the
  new read policy hides every existing assignment from every student and mentor
  at once — the app looks empty rather than broken. Part A asserts it.
- **`NOT_IN_SCOPE: <title>` changes the shape of an existing error code.**
  `mapRpcError` matches on the code; a message with a suffix may fall through to
  the unknown-error path and lose the title. Task 3 step 4 exists for this and
  must be checked, not assumed.
- **Task 4 touches a 1,172-line screen** that already carries the picker, the
  batch selection, the sent list and an inline edit panel. The draft tray is a
  fourth region in the same file. If it fights, splitting the card into its own
  component is the right response — not squeezing.
