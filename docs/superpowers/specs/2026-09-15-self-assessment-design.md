# Self-assessment and mentor comparison — design

**Date:** 2026-09-15
**Status:** approved in conversation, awaiting written review
**Why:** the owners' workflow diagram (Dec 2025) names the student's self-assessment "according to the formal learning outcomes scale" three times — the student makes it, the mentor compares it with their own judgement, the advisor compares the two scores. The app had no student voice on performance at all. This is the first of the two remaining audit gaps (the other is internship closure).

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The unit is the **task submission**, the scale is the four-step supervision scale already used by the internship journal: `0 observed · 1 heavy support · 2 partial support · 3 independent`. | One vocabulary across the app; a task is one KPI, so a per-task rating is a per-KPI rating. (Owner's choice over a periodic per-competency self-placement.) |
| 2 | The student rates on submit (**required**); the mentor rates on **approval** (required) and not when requesting revision. On resubmission the student may change their rating; the mentor's rating is the one given at the approval that stands. | Two ratings on the same act, from the two people who were there. |
| 3 | The mentor's rating **does not affect progression**: approval still creates the KPI observation exactly as today. | Owner's choice for v1; the data will show whether a threshold is wanted, and adding one later is a rule change, not a schema change. |
| 4 | The comparison is `gap = mentor − student` per task; per competency: `tasks`, `avgSelf`, `avgMentor`, `gap`, `overRated` (self > mentor), `underRated` (self < mentor). Visible to the student (own), the mentor (their students), the advisor (their group's students). | The gap, not the absolute numbers, is the pedagogical signal ("early intervention" in the diagram). |
| 5 | Ratings are evaluation data, never stream data: `list_feed_posts` does not project them, and the stream card does not show them. | Same boundary as `reflection` / `mentor_note`. |
| 6 | Historic submissions keep `NULL` ratings and are excluded from averages; a comparison row needs at least one submission with both ratings. | No back-filling of judgements nobody made. |
| 7 | No new notification type; the approval notification already carries the mentor's note and the student opens the task to see the two ratings. | Nothing new happens that the student is not already told about. |

## 2. Data model

`assignment_submissions` gains:

| column | type | notes |
|---|---|---|
| `self_level` | `SMALLINT CHECK (self_level BETWEEN 0 AND 3)` | NULL only on legacy rows; `submit_assignment` requires it |
| `mentor_level` | `SMALLINT CHECK (mentor_level BETWEEN 0 AND 3)` | set by `review_assignment` on approval; cleared to NULL on a later revision request (the approval it belonged to is gone) |

No new tables. No new policies: both columns live under the existing submission policies (the student and their mentor read the row; the advisor's read is through RPCs).

## 3. RPCs

- `submit_assignment(p_assignment_id, p_note, p_reflection, p_photos, p_documents, p_self_level SMALLINT)` — new trailing parameter; `SELF_LEVEL_REQUIRED` when NULL or outside 0–3. The existing 5-argument overload is dropped so the client cannot bypass it.
- `review_assignment(p_submission_id, p_approved, p_note, p_level SMALLINT DEFAULT NULL)` — when `p_approved` is true: `LEVEL_REQUIRED` unless `p_level` is 0–3, stored in `mentor_level`; when false: `mentor_level` set to NULL. The observation logic is untouched (decision 3). The 3-argument overload is dropped.
- **`competency_self_vs_mentor(p_student_id UUID) RETURNS SETOF JSONB`** — SECURITY DEFINER; caller must be the student, `is_mentor_of(student)`, or the advisor who owns a group the student is an active member of (`SELF_ASSESSMENT_FORBIDDEN` otherwise). One row per competency that has at least one approved submission with both ratings: `{ competencyId, code, name, tasks, avgSelf, avgMentor, gap, overRated, underRated }` — averages to one decimal, gap = avgMentor − avgSelf.
- `list_feed_posts` — unchanged; Part A asserts its definition contains neither `self_level` nor `mentor_level`.

## 4. Screens

- **Student — task detail (submit form)** (`app/(student)/task-detail.tsx`): above the submit button a required four-option segmented control, "How did you do this task?" with the four labels; the button stays disabled until one is chosen; on resubmission it is pre-filled with the previous choice. After approval the card shows both: "You: partial support · Mentor: independent" and, when they differ, a one-word tag (`They saw more` / `They saw less`, neutral tone).
- **Mentor — review** (`src/components/mentor/ReviewUI.tsx` / `app/(mentor)/review-detail.tsx`, Codex's files): the student's rating is shown above the decision ("Student's own rating: partial support"), then the mentor's four-option control; **Approve** is disabled until a level is chosen; Request revision needs none. Delivery: a change request to the parallel session, or done here if the files are clean at execution time — the plan decides.
- **Student — growth screen** (`src/services/studentGrowthView.ts` and its screen): per competency, two short bars "You / Mentor" from `competency_self_vs_mentor`, hidden when no rated task exists.
- **Advisor — Reports**: the Students tab row gains "Self vs mentor: +0.4" (or "—") with a small tag when |gap| ≥ 1 (`Rates self high` / `Rates self low`); the CSV student table gains `avgSelf`, `avgMentor`, `gap` columns, and a new section "Self-assessment by competency" (competency × student gap). Fetched per student in the existing `getReportsData` fan-out.

## 5. Verification (`docs/self-assessment-verification.sql`)

- A: the two columns with their CHECKs; only the new overloads of `submit_assignment` / `review_assignment` exist (old signatures gone); `competency_self_vs_mentor` exists and is granted; `list_feed_posts`'s definition (`pg_get_functiondef`) does not contain `self_level` or `mentor_level`.
- B (owner-run, impersonated): submit without a level → `SELF_LEVEL_REQUIRED`; submit with 1; approve without a level → `LEVEL_REQUIRED`; approve with 3 → `mentor_level = 3` and exactly one `kpi_observations` row (unchanged rule); revision request clears `mentor_level`; resubmit with 2 then approve with 2 → comparison row `tasks = 1, avgSelf = 2, avgMentor = 2, gap = 0`; a second task self 3 / mentor 1 → `gap = −1, overRated = 1`; another mentor → `SELF_ASSESSMENT_FORBIDDEN`; `list_feed_posts` output for the shared task contains no rating.
- C (`SET LOCAL ROLE authenticated`): the student reads their own comparison; the advisor of the group reads it; a student of another group → `SELF_ASSESSMENT_FORBIDDEN`.
- Jest: pure helpers `levelLabel(level)`, `gapTag(gap)`, `selfVsMentorCsvRows(rows)`.

## 6. Out of scope

A progression threshold on the mentor's rating (decision 3); periodic per-competency self-placement; the advisor editing either rating; rating history across resubmissions (only the last stands); ratings in the stream.
