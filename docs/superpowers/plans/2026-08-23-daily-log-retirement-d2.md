# Subsystem D2 — closing the submission loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the student's task form carry the reflection and the evidence, make the mentor see both, and retire the daily log from the student's flow — so D1's SQL can finally be applied.

**Architecture:** The bucket-upload half of `logService.uploadPhoto`/`uploadDocument` is split away from the row-insert half, because D1 moved the row insert into `submit_assignment`. The task form uploads files to the existing buckets, collects the public URLs, and hands them to the RPC as JSONB. The mentor's review screen renders what comes back. `create-log.tsx` is deleted and `my-tasks` takes its tab.

**Tech Stack:** Expo SDK 54, React Native, TypeScript, Expo Router, Supabase JS, Zustand, i18next (`en.json` only), `expo-image-picker`, `expo-document-picker`.

**Spec:** `docs/superpowers/specs/2026-08-23-daily-log-retirement-design.md`

## Scope: D2 closes the loop, D3 cleans up

The spec's section 5 lists eight surfaces. D2 takes the ones that make a **working submission loop** — a student attaching evidence the mentor cannot see is half a feature, so `pending-reviews.tsx` is in scope here. Everything that surrounds the loop moves to a later D3 plan:

| In D2 | In D3 |
|---|---|
| the upload/insert service split | mentor tab bar, dashboard, `student-list`, `feedback` |
| `submitAssignment`'s new signature | advisor tab bar |
| the task form: reflection + evidence | the advisor's reports rewrite |
| `pending-reviews` renders evidence, drops the linked-log panel | deleting `review-log.tsx` and `validation.tsx` |
| student tab bar, student dashboard | deleting `KpiChecklist` and `competencyService.recordObservations` |
| deleting `create-log.tsx` | |

`KpiChecklist` cannot be deleted in D2: `review-log.tsx` is still its other caller and that screen is D3's.

**The advisor's reports were settled while planning this:** completion is measured by **competency level reached against target level**, read from the existing `get_competency_progress` RPC — not by task counts. The "minimum tasks per KPI" the spec's decision 3 mentions **was never built** (`group_competency_targets` holds only `target_level`), and it stays unbuilt; it belongs to subsystem E with the student's catalogue pick. This is recorded here because D3 will implement the reports and must not re-litigate it.

## Global Constraints

- **Apply D1's SQL at the end of this plan, not before it.** Task 2 of D1 dropped `submit_assignment(UUID, TEXT, UUID)`, which the shipped client still calls. Order: `docs/daily-log-retirement-migration.sql`, then `docs/daily-log-retirement-rpcs.sql`, then `docs/daily-log-retirement-verification.sql`. The final task covers this.
- **No task in this plan writes SQL or connects to a database.** D1 already wrote every statement.
- `npx tsc --noEmit` silent; `npx jest --silent` green — currently 4 suites / 23 tests, and this plan adds one suite.
- Only `src/i18n/locales/en.json` among the seven locale files. Translation is paused project-wide.
- Every RPC refusal reaches the user through `mapRpcError`, never a raw `err.message`.
- Tab bars after this plan: **student 7** (was 8), mentor 7 unchanged, advisor 7 unchanged.
- Imports use the path aliases (`@/services/...`), never relative paths out of `src/`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

- **Modify** `src/services/logs.ts` — split bucket upload from row insert (Task 1).
- **Modify** `src/services/assignments.ts` — `submitAssignment`'s new signature, evidence types (Task 1).
- **Modify** `src/types/assignment.ts` — `reflection` on `AssignmentSubmission`, the two evidence input types (Task 1).
- **Create** `src/utils/evidenceMapping.ts` + **create** `src/utils/__tests__/evidenceMapping.test.ts` — the camelCase→snake_case boundary, tested (Task 1).
- **Create** `src/components/forms/EvidencePicker.tsx` — photo and document picking, extracted from the screen being deleted (Task 2).
- **Modify** `app/(student)/my-tasks.tsx` — the form (Task 3).
- **Modify** `app/(mentor)/pending-reviews.tsx` — render evidence and reflection, drop the linked-log panel (Task 4).
- **Modify** `app/(student)/_layout.tsx`, `app/(student)/dashboard.tsx`; **delete** `app/(student)/create-log.tsx` (Task 5).
- **Modify** `src/i18n/locales/en.json` — new keys, alongside each task that needs them.

---

### Task 1: The service and type boundary

**Files:**
- Modify: `src/services/logs.ts`
- Modify: `src/services/assignments.ts:156-165`
- Modify: `src/types/assignment.ts`
- Create: `src/utils/evidenceMapping.ts`
- Test: `src/utils/__tests__/evidenceMapping.test.ts`

**Interfaces:**
- Consumes: `submit_assignment(p_assignment_id UUID, p_note TEXT, p_reflection TEXT, p_photos JSONB, p_documents JSONB)` from D1.
- Produces:
  - `logService.uploadPhotoFile(userId: string, scopeId: string, uri: string): Promise<string>` — returns the public URL.
  - `logService.uploadDocumentFile(userId: string, scopeId: string, uri: string, fileName: string, fileType: string): Promise<string>`
  - `PhotoEvidence { uri: string; caption?: string }`, `DocumentEvidence { uri: string; fileName: string; fileType: string; fileSize: number }`
  - `toPhotoPayload(photos: PhotoEvidence[]): unknown[]`, `toDocumentPayload(docs: DocumentEvidence[]): unknown[]`
  - `assignmentService.submitAssignment(assignmentId, note, reflection, photos, documents): Promise<string>`
  - `AssignmentSubmission.reflection?: string`

- [ ] **Step 1: Write the failing test for the payload mapping**

This is the seam D1's SQL warns about in a comment: `jsonb_to_recordset` matches JSON keys to **column names, case-sensitively**, so the payload must be snake_case while the whole TypeScript layer is camelCase. Get it wrong and `file_name` arrives NULL — and D1's fix wave made the RPC silently drop such rows, so the document just vanishes with no error anywhere. That silence is exactly why this mapping is a tested pure function instead of an inline object literal.

Create `src/utils/__tests__/evidenceMapping.test.ts`:

```typescript
import { toPhotoPayload, toDocumentPayload } from '@/utils/evidenceMapping';

describe('toPhotoPayload', () => {
  it('emits uri and caption', () => {
    expect(toPhotoPayload([{ uri: 'https://x/a.jpg', caption: 'hi' }]))
      .toEqual([{ uri: 'https://x/a.jpg', caption: 'hi' }]);
  });

  it('emits a null caption rather than omitting the key', () => {
    expect(toPhotoPayload([{ uri: 'https://x/a.jpg' }]))
      .toEqual([{ uri: 'https://x/a.jpg', caption: null }]);
  });

  it('returns an empty array for no photos', () => {
    expect(toPhotoPayload([])).toEqual([]);
  });
});

describe('toDocumentPayload', () => {
  // The whole reason this module exists. jsonb_to_recordset matches on column
  // names, so a camelCase key lands as NULL in a NOT NULL column -- and the RPC
  // drops such rows silently, so the document disappears with no error.
  it('converts fileName/fileType/fileSize to snake_case', () => {
    expect(toDocumentPayload([
      { uri: 'https://x/a.pdf', fileName: 'a.pdf', fileType: 'application/pdf', fileSize: 42 },
    ])).toEqual([
      { uri: 'https://x/a.pdf', file_name: 'a.pdf', file_type: 'application/pdf', file_size: 42 },
    ]);
  });

  it('emits no camelCase keys at all', () => {
    const [row] = toDocumentPayload([
      { uri: 'u', fileName: 'n', fileType: 't', fileSize: 1 },
    ]) as Record<string, unknown>[];
    expect(Object.keys(row).some((k) => /[A-Z]/.test(k))).toBe(false);
  });

  it('returns an empty array for no documents', () => {
    expect(toDocumentPayload([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx jest src/utils/__tests__/evidenceMapping.test.ts
```

Expected: FAIL — `Cannot find module '@/utils/evidenceMapping'`.

- [ ] **Step 3: Write the module**

Create `src/utils/evidenceMapping.ts`:

```typescript
import type { PhotoEvidence, DocumentEvidence } from '@/types/assignment';

/** The camelCase -> snake_case boundary for submit_assignment's evidence
 *  parameters.
 *
 *  submit_assignment reads these with jsonb_to_recordset, which matches JSON
 *  keys to COLUMN names and is case-sensitive. A `fileName` key therefore lands
 *  as a NULL `file_name`, and the RPC drops rows with a null NOT NULL field
 *  rather than aborting the submission -- so the document would simply vanish,
 *  with no error on either side. This module is the one place that conversion
 *  happens, and it is tested. */
export function toPhotoPayload(photos: PhotoEvidence[]): unknown[] {
  return photos.map((p) => ({ uri: p.uri, caption: p.caption ?? null }));
}

export function toDocumentPayload(docs: DocumentEvidence[]): unknown[] {
  return docs.map((d) => ({
    uri: d.uri,
    file_name: d.fileName,
    file_type: d.fileType,
    file_size: d.fileSize,
  }));
}
```

- [ ] **Step 4: Add the types**

In `src/types/assignment.ts`, add `reflection?: string;` to `AssignmentSubmission` after `studentNote`, and append:

```typescript
/** One photo as the client holds it before submitting. `uri` is the PUBLIC
 *  bucket URL returned by logService.uploadPhotoFile, not a device path -- the
 *  file is already uploaded by the time it reaches submit_assignment, which
 *  only writes the row. */
export interface PhotoEvidence {
  uri: string;
  caption?: string;
}

export interface DocumentEvidence {
  uri: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}
```

- [ ] **Step 5: Split the upload from the insert**

In `src/services/logs.ts`, `uploadPhoto` and `uploadDocument` currently do two things: POST the file to the bucket, then INSERT the row. D1 moved the row insert for the task path into `submit_assignment`, so the task path needs the first half alone.

Do **not** rewrite the existing two functions' behaviour — `log-history` and the daily-log read paths still rely on them until D3. Extract the upload half into new exported functions and have the existing ones call them, so there is one uploader rather than two copies that can drift.

```typescript
  /** POST a photo to the log-photos bucket and return its public URL.
   *
   *  The storage policy keys on (storage.foldername(name))[1] = auth.uid()::text
   *  -- only the FIRST path segment matters, so `scopeId` is free. The daily-log
   *  path passes a log id; the task path passes an assignment id, because the
   *  submission id does not exist until submit_assignment runs. */
  async uploadPhotoFile(userId: string, scopeId: string, uri: string): Promise<string> {
    const fileName = `${userId}/${scopeId}/${Date.now()}.jpg`;
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No session');

    const formData = new FormData();
    formData.append('', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);

    const uploadRes = await fetch(
      `${supabaseUrl}/storage/v1/object/log-photos/${fileName}`,
      { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: formData },
    );
    if (!uploadRes.ok) {
      const errBody = await uploadRes.text();
      throw new Error(errBody || 'Photo upload failed');
    }

    const { data: urlData } = supabase.storage.from('log-photos').getPublicUrl(fileName);
    return urlData.publicUrl;
  },
```

Then `uploadPhoto(logId, userId, uri, caption)` becomes: call `uploadPhotoFile(userId, logId, uri)`, then do its existing `log_photos` insert with the returned URL. Same shape for `uploadDocumentFile(userId, scopeId, uri, fileName, fileType)` — note it takes no `fileSize`, because size is metadata the caller already has and the bucket does not need it.

- [ ] **Step 6: Change `submitAssignment`**

Replace `src/services/assignments.ts:156-165`:

```typescript
  /** The `logId` parameter is gone. D1 dropped the three-argument signature --
   *  a differing argument list would have made an OVERLOAD, and PostgREST
   *  resolves overloads by the argument names the caller sends, so the old body
   *  would have kept answering old callers with no error anywhere. */
  async submitAssignment(
    assignmentId: string,
    note: string,
    reflection: string,
    photos: PhotoEvidence[],
    documents: DocumentEvidence[],
  ): Promise<string> {
    const { data, error } = await supabase.rpc('submit_assignment', {
      p_assignment_id: assignmentId,
      p_note: note,
      p_reflection: reflection,
      p_photos: toPhotoPayload(photos),
      p_documents: toDocumentPayload(documents),
    });
    if (error) throw new RpcError(error.message);
    return data as string;
  },
```

Add `reflection` to the `toSubmission` mapper in the same file so the field round-trips.

- [ ] **Step 7: Add the refusal message**

`submit_assignment` can now raise `REFLECTION_REQUIRED`. Add it to `src/utils/rpcErrors.ts` in the file's existing style, and add `errors.reflectionRequired` to `en.json`: `"Write what you learned before submitting."`

- [ ] **Step 8: Verify**

```bash
npx jest src/utils/__tests__/evidenceMapping.test.ts && npx tsc --noEmit
```

Expected: jest passes; **tsc FAILS** on `app/(student)/my-tasks.tsx`, which still calls `submitAssignment` with three arguments. That is correct and expected — Task 3 fixes it. Record the failure in your report rather than papering over it; do not edit `my-tasks.tsx` in this task.

- [ ] **Step 9: Commit**

```bash
git add src/services/logs.ts src/services/assignments.ts src/types/assignment.ts src/utils/evidenceMapping.ts src/utils/__tests__/evidenceMapping.test.ts src/utils/rpcErrors.ts src/i18n/locales/en.json
git commit -m "feat(d2): evidence types and the snake_case payload boundary

jsonb_to_recordset matches JSON keys to column names case-sensitively, and
the RPC drops rows with a null NOT NULL field rather than aborting -- so a
camelCase fileName makes the document vanish with no error on either side.
That conversion gets one tested module.

tsc fails on my-tasks.tsx until Task 3; the signature change is deliberate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The evidence picker

**Files:**
- Create: `src/components/forms/EvidencePicker.tsx`
- Modify: `src/components/forms/index.ts`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `PhotoEvidence`, `DocumentEvidence`, `logService.uploadPhotoFile`, `logService.uploadDocumentFile` from Task 1.
- Produces:
```typescript
interface EvidencePickerProps {
  userId: string;
  scopeId: string;              // the assignment id
  photos: PhotoEvidence[];
  documents: DocumentEvidence[];
  onChange: (photos: PhotoEvidence[], documents: DocumentEvidence[]) => void;
  disabled?: boolean;
}
export function EvidencePicker(props: EvidencePickerProps): JSX.Element;
```

- [ ] **Step 1: Read the code you are extracting from**

`app/(student)/create-log.tsx` already does photo and document picking, and it is being deleted in Task 5. Read its picker handlers and its attachment list rendering. **Extract, do not reinvent** — it carries the permission prompts, the MIME handling and the RN quirks that were debugged into it. Note especially how it calls `expo-image-picker` and `expo-document-picker`, and copy those option objects rather than writing new ones.

- [ ] **Step 2: Build the component**

The skeleton, so the structure is not invented — fill the picker handlers from what you read in Step 1:

```typescript
import { useState } from 'react';
import { View, Text, TouchableOpacity, Image, ActivityIndicator, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { logService } from '@/services/logs';
import { colors, spacing, borderRadius } from '@/theme';
import type { PhotoEvidence, DocumentEvidence } from '@/types/assignment';

const MAX_PHOTOS = 5;   // matches 3 * LEAST(v_photos, 5) in submit_assignment

interface EvidencePickerProps {
  userId: string;
  scopeId: string;
  photos: PhotoEvidence[];
  documents: DocumentEvidence[];
  onChange: (photos: PhotoEvidence[], documents: DocumentEvidence[]) => void;
  disabled?: boolean;
}

export function EvidencePicker({
  userId, scopeId, photos, documents, onChange, disabled,
}: EvidencePickerProps) {
  const { t } = useTranslation();
  // Keyed by a local id so a failed upload can be retried in place rather than
  // re-picked. Uploads are NOT held in the parent's arrays until they succeed.
  const [pending, setPending] = useState<Record<string, 'uploading' | 'failed'>>({});

  async function addPhoto() {
    // 1. expo-image-picker, options copied from create-log.tsx
    // 2. mark pending
    // 3. const url = await logService.uploadPhotoFile(userId, scopeId, result.uri);
    // 4. onChange([...photos, { uri: url }], documents)
  }

  async function addDocument() {
    // Same shape, but note where fileSize comes from: the PICKER result, not
    // the upload. uploadDocumentFile does not return it and the bucket does not
    // need it -- it is metadata the caller already has and log_documents wants.
    // const url = await logService.uploadDocumentFile(
    //   userId, scopeId, asset.uri, asset.name, asset.mimeType);
    // onChange(photos, [...documents, {
    //   uri: url, fileName: asset.name, fileType: asset.mimeType, fileSize: asset.size,
    // }]);
  }

  // ... render
}
```

It owns picking and uploading; the parent owns the arrays. On pick: upload immediately via `uploadPhotoFile`/`uploadDocumentFile`, then call `onChange` with the public URL appended. Uploading on pick rather than on submit means a slow upload does not sit inside the submit tap, and a failed upload is reported next to the thumbnail rather than as a failed submission.

Requirements:
- Show a spinner per item while its upload is in flight, and a retry affordance if it fails.
- Cap photos at **5**, matching the XP bonus cap in `submit_assignment` (`3 * LEAST(v_photos, 5)`). Past the cap, disable the add button rather than silently ignoring taps.
- Each photo row gets an optional caption input.
- Each item gets a remove control. Removing only drops it from the array — the uploaded file stays in the bucket. That is deliberate and worth a comment: deleting from storage needs the object path, the component holds only the public URL, and an orphaned object is cheaper than a broken reference.
- `disabled` greys out every control; the parent passes it while submitting and when the submission is approved.
- All strings via `t()`. New keys under `student.`: `addPhoto`, `addDocument`, `photoLimit`, `uploadFailed`, `retry`, `caption`, `evidence`.

- [ ] **Step 3: Export it**

Add `export { EvidencePicker } from './EvidencePicker';` to `src/components/forms/index.ts`.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
```

Expected: still failing on `my-tasks.tsx` only (Task 1's known break). No new errors. If any error names `EvidencePicker.tsx`, fix it before committing.

- [ ] **Step 5: Commit**

```bash
git add src/components/forms/ src/i18n/locales/en.json
git commit -m "feat(d2): EvidencePicker, extracted from the screen being deleted

Uploads on pick rather than on submit, so a slow upload does not sit inside
the submit tap and a failure is reported next to its thumbnail.

Photos cap at 5 to match the XP bonus cap in submit_assignment.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The task form

**Files:**
- Modify: `app/(student)/my-tasks.tsx`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: the only screen that calls `submitAssignment`.

- [ ] **Step 1: Remove the daily-log attachment**

The screen currently imports `logService`, fetches `todayLog`, and offers an `attachLog` toggle that passes a log id to `submitAssignment`. All of it goes: `logService` import, the `todayLog` state, the `Promise.all` branch that loads it, the toggle, and the `logId` argument. The record no longer attaches to a day.

- [ ] **Step 2: Add the two fields**

Replace the single note input with two, in this order:

- **"What I did"** — bound to the existing `note` state, `student.whatIDid`.
- **"What I learned"** — new `reflection` state, `student.whatILearned`.

Both `multiline`. Neither gets a title field: the advisor already wrote the task's title.

The reflection is **required**. Disable Submit while `reflection.trim()` is empty, and show the reason rather than an inert button — an inert control with no explanation is the commonest form of this bug. The server refuses too (`REFLECTION_REQUIRED`, wired in Task 1); the client check exists so the student is not told after the fact.

- [ ] **Step 3: Prefill on open**

`openCard` currently clears `note`. It must now prefill **both** fields and the evidence from the existing submission, because `submit_assignment` overwrites unconditionally and rewrites the evidence rather than appending. A student asked only to add a photo, who reopens a card and finds the note blank, resubmits and destroys the note they wrote — and the mentor's panel then renders nothing where it was.

Prefill `note` from `a.submission?.studentNote`, `reflection` from `a.submission?.reflection`, and the evidence arrays from the submission's existing photos and documents. Clear all of them when the card closes.

`listMyAssignments` does not currently return the evidence. Extend its select to embed `log_photos(*)` and `log_documents(*)` under the submission, and map them onto `MyAssignment.submission`. Add `photos?: PhotoEvidence[]` and `documents?: DocumentEvidence[]` to `AssignmentSubmission` for this.

- [ ] **Step 4: Wire the picker and the submit**

Render `<EvidencePicker>` between the two text fields and the Submit button, passing `userId={user.id}` and `scopeId={assignment.id}`, and `disabled` while submitting.

```typescript
const submissionId = await assignmentService.submitAssignment(
  assignment.id, note, reflection, photos, documents,
);
```

Refusals go through `mapRpcError`, as the screen already does.

- [ ] **Step 5: Gate the mentor's note**

Render `a.submission?.mentorNote` only when `a.submission?.status === 'needs_revision'`. After a resubmission a "waiting for review" card would otherwise still show the previous revision request, reading as a reply to work the mentor has not seen.

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit && npx jest --silent
```

Expected: **both clean now** — this is the task that closes Task 1's deliberate break. tsc silent, jest green at 5 suites / 29 tests (the 4 existing suites plus Task 1's).

- [ ] **Step 7: Commit**

```bash
git add "app/(student)/my-tasks.tsx" src/services/assignments.ts src/types/assignment.ts src/i18n/locales/en.json
git commit -m "feat(d2): the task form carries reflection and evidence

Two fields, not five: what I did, and what I learned. The reflection is
required -- optional, it would go empty and take with it the reason the
daily log was removed.

Opening a card prefills both fields and the evidence. submit_assignment
overwrites unconditionally and rewrites evidence rather than appending, so
a blank form would destroy the note the student already wrote.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The mentor sees the evidence

**Files:**
- Modify: `app/(mentor)/pending-reviews.tsx`
- Modify: `src/services/assignments.ts` (`listPendingReviews`)
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `AssignmentSubmission.reflection`, `.photos`, `.documents` from Tasks 1 and 3.
- Produces: nothing downstream.

Without this task the student attaches evidence nobody can see, which is why it is in D2 rather than D3.

- [ ] **Step 1: Remove the linked-log panel**

The screen fetches a linked daily log on card open, guarded by a `logRequest` useRef race token added in commit `7fbd821`. `log_id` is no longer written, so the panel is always empty. Remove the panel, the fetch, the `logService` import, and the now-unused race guard. Removing the guard is only safe because its subject is gone — do not remove it while any async fetch still writes into card state.

- [ ] **Step 2: Extend the query**

`listPendingReviews` embeds `group_assignments!inner(*)`. Add `log_photos(*)` and `log_documents(*)` and map them, the same way Task 3 did for the student.

Keep the `!inner` on `group_assignments` exactly as it is — the comment above that function explains why, and it is load-bearing: the two tables are reached by different policies, and a left join would produce a review card with no criterion, which is the one thing the mentor judges against.

- [ ] **Step 3: Render the three things the mentor now judges**

In the detail panel, in this order: the assignment's **description** (only when non-empty), the **objective**, the **criterion**, then the student's **"What I did"**, their **"What I learned"**, and the **evidence**.

Photos render as tappable thumbnails opening a full-size view; documents as a filename list with size, tappable to open. Reuse whatever `review-log.tsx` does for this — it renders the same two tables today and is not deleted until D3, so read it while it is still there.

If the submission has no evidence, render nothing rather than an empty "Evidence" heading. An empty heading reads as a failed load; D1's own review flagged the same shape on the old linked-log panel.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npx jest --silent
```

Expected: silent; green at 5 suites / 29 tests.

- [ ] **Step 5: Commit**

```bash
git add "app/(mentor)/pending-reviews.tsx" src/services/assignments.ts src/i18n/locales/en.json
git commit -m "feat(d2): the mentor sees the reflection and the evidence

Drops the linked-log panel -- log_id is no longer written, so it was
always empty -- and with it the race guard whose subject is gone.

Evidence renders nothing when absent rather than an empty heading, which
reads as a failed load.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The daily log leaves the student's flow

**Files:**
- Modify: `app/(student)/_layout.tsx`
- Modify: `app/(student)/dashboard.tsx`
- Delete: `app/(student)/create-log.tsx`
- Modify: `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Swap the tabs**

In `app/(student)/_layout.tsx`:
- `create-log` — remove the `Tabs.Screen` entirely (the file goes in Step 3).
- `log-history` — change to `options={{ href: null }}`, joining `internship-form`.
- `my-tasks` — promote from `href: null` to a visible tab, positioned second, right after `dashboard`. Title "Tasks", icon `checkbox-outline`.

Student tabs become 7: dashboard, my-tasks, achievements, leaderboard, polls, notifications, profile.

- [ ] **Step 2: Repoint the dashboard**

`app/(student)/dashboard.tsx` calls `logService.getLogsByStudent` and `logService.getLogByDate`, derives a revision count from log statuses, and subscribes to realtime on `daily_logs`.

Replace with task equivalents: load the student's group and `assignmentService.listMyAssignments`, then count by state using the **existing tested helper** `groupAssignmentsByState` in `src/utils/assignmentGrouping.ts` — `my-tasks.tsx` already uses it, and a second hand-rolled counter would be a second place for the "a missing submission row IS the to-do state" rule to drift. Change the realtime subscription's `table` to `assignment_submissions`.

The "today's log" card becomes a "tasks to do" card linking to `/(student)/my-tasks`.

Keep a link to the archive: one unobtrusive row reading `student.pastLogs` that routes to `/(student)/log-history`, so old logs stay reachable now that the tab is gone.

Do **not** fix the several hardcoded English strings already in this file. They predate this plan, and fixing one of many is inconsistent while fixing all is a different task.

- [ ] **Step 3: Delete the screen**

```bash
git rm "app/(student)/create-log.tsx"
```

Expo Router is file-based: a file under `app/` is a route whether or not it appears in the tab bar. Left on disk it stays reachable by deep link and still works, because `daily_logs` still exists — a student could write a log that earns the old XP and appears nowhere in the new model. Git is the archive.

Then grep for dangling references:

```bash
grep -rn "create-log" app/ src/
```

Expected: no matches. Any that remain are dead navigation targets that would crash on tap; fix them.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npx jest --silent
```

Expected: silent; green at 5 suites / 29 tests.

- [ ] **Step 5: Commit**

```bash
git add -A "app/(student)/" src/i18n/locales/en.json
git commit -m "feat(d2): my-tasks takes the tab, create-log is deleted

Every role had the same inversion: the retiring screen was a visible tab
and the new model's screen was behind href: null. This fixes the student's.

The file is deleted rather than hidden. Expo Router is file-based, so on
disk it stays reachable by deep link and still works against tables that
still exist -- a log earning old XP and appearing nowhere in the new model.

log-history survives as a read-only archive, linked from the dashboard.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Apply D1's SQL and run its verification

**Files:** none — this task changes no code.

This is the task D1 was deferred for. It is the **only** task in either plan that touches the database, and it must run after Task 5, never before.

- [ ] **Step 1: Hand the operator the three files, in order**

The user applies these in the Supabase SQL editor. The order is not cosmetic — applying the RPC file first **succeeds**, because plpgsql bodies are not resolved against the catalog at create time, while still dropping the old three-argument signature. The result is a deploy that reports success and breaks every submission.

1. `docs/daily-log-retirement-migration.sql`
2. `docs/daily-log-retirement-rpcs.sql`
3. `docs/daily-log-retirement-verification.sql`

Parts A, B and C of the verification script are submitted **separately**, and Parts B and C each go in as one block from `BEGIN;` to `ROLLBACK;` — the editor gives each submission its own connection, so a transaction split across submissions loses its state (`42P01`).

- [ ] **Step 2: Read the results honestly**

Expected: Part A one `PASS` row; Part B eight rows; Part C four rows. Any cell beginning `FAIL`, `SKIP`, `INCONCLUSIVE` or `ABORTED` is a real result to report, not noise. In particular:

- A `SKIP` on B1 means the database has no `daily_logs` row to borrow an id from — the case tested nothing, and that is the correct thing for it to say.
- A `SKIP` on Part C means it could not find one advisor and two distinct student profiles.
- If `SET LOCAL ROLE authenticated` raises `42501`, Part C is unrunnable in that editor. Report it as unrunnable. **Do not** substitute catalog lookups: they would assert exactly what Part A already asserts while reading as though they had proved more, which is the blind spot that let a `42P17` recursion through two green runs in August.

- [ ] **Step 3: Walk the loop on a device**

One student, one mentor, one pass:

1. Student opens **Tasks**, picks an assigned task, fills both fields, attaches one photo and one document, submits.
2. **The mentor receives a notification.** This is the Critical from C2's review that has never once been verified on a device — the client-side version failed with `42501` on every submission from the day it shipped and a deliberate `.catch` hid it. D1 moved it server-side into `submit_assignment`. Confirm the mentor's notification list actually shows it.
3. Mentor opens the review, sees both fields and both attachments, sends it back.
4. Student reopens the card: **both fields and both attachments are prefilled.** Removes the photo, resubmits.
5. Mentor sees one attachment, not two — the rewrite worked, not an append.
6. Mentor approves. Student's XP rises and the competency progress moves.

Record what actually happened for each step. A step that could not be run is reported as not run.

---

## Deferred to D3

Named so they are not mistaken for gaps: the mentor's tab bar, dashboard, `student-list` and `feedback`; the advisor's tab bar and the reports rewrite (measuring completion by competency level against target, per the decision recorded at the top of this plan); deleting `review-log.tsx` and `validation.tsx`; and deleting `KpiChecklist` and `competencyService.recordObservations`, which lose their last callers with those two screens.

One consequence to carry into D3: `mentor_feedbacks` holds a 1–5 star rating that the task path has no equivalent for — the mentor now approves or sends back. D3's `feedback.tsx` must present that history honestly rather than showing an empty star column.

## Risks

- **Task 1 deliberately leaves `npx tsc --noEmit` failing** until Task 3. Any reviewer or implementer who treats a red build as a blocker will stall. It is stated in both tasks, and Task 3's verification step is where it must go green.
- **The evidence prefill in Task 3 depends on a query change** that Task 3 also makes. If the embed is wrong, prefill silently yields empty arrays and a resubmission wipes the student's attachments — the same class of loss as the note. The device walk in Task 6, step 4, is what actually catches it.
- **Deleting `create-log.tsx` removes the only worked example** of the picker code that Task 2 extracts. Task 2 runs first for that reason; do not reorder them.
