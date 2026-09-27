# Advisor-authored group quizzes

## Scope and decisions

- A group advisor creates a quiz as a draft and sends it to the whole group or selected active students. A quiz contains 1–10 questions; each has 2–5 text choices, exactly one correct choice, and optionally one image (JPEG/PNG/WebP, at most 5 MB). A title is required; description and deadline are optional.
- Sending freezes the content and target list. A draft can be edited or deleted; a sent quiz can only be closed. Closing or reaching the deadline ends answering and releases scores and correct choices to students. Archiving the group also ends answering and releases results.
- The student sees quizzes from Tasks, an actionable card on the dashboard, and a notification. Each selected answer is saved server-side for crash/restart recovery. All questions must be answered to submit. Only one final submission is permitted; the score is calculated on the server.
- The advisor sees completion and per-student scores plus question-level correct counts. No mentor grading step, automatic KPI observation, XP, or new badge: a quiz is formative, not evidence of workplace performance. The retired `polls*` tables and stream's one-question polls are not used.

## Data and security

- `group_quizzes` stores the frozen question set; `group_quiz_targets` names selected recipients; `group_quiz_attempts` contains drafts and one final score. The direct client table grants are removed and RLS enabled. All changes and reads go through role-checking `SECURITY DEFINER` RPCs.
- `quiz_detail` explicitly projects question text, choices and image path. It omits the correct choice and score for a student until the quiz ends. The advisor gets the answer key and results. The recipient check is repeated in answer saving; an ID alone conveys no access.
- Images are stored in the private `quiz-images` bucket. Upload/delete is limited to the owning advisor while the quiz is a draft; read is limited to that advisor and eligible students, and a student may read only images actually referenced by the quiz. The app stores paths and obtains short-lived signed URLs when displaying them.
- The server enforces the 10/5 limits, choice validity, target membership, deadline, one-submission rule and score. Publishing and notifications are one transaction. A new member inherits a whole-group quiz while it remains accessible, matching existing group-task audience semantics; a selected quiz stays limited to named students.

## Deployment and acceptance

1. Apply `docs/group-quizzes.sql` in Supabase SQL Editor. This introduces new tables, RPCs, private storage bucket and notification type; it does not alter retired polls or existing assignment data.
2. Run `docs/group-quizzes-verify-a.sql`, `docs/group-quizzes-verify-b.sql`, then `docs/group-quizzes-verify-c.sql` separately and confirm each visible PASS row. B rolls back its temporary quiz, attempt and notification. If there is no active group with a student, B reports SKIP instead of PASS. The former combined script remains as a reference.
3. Test in Expo Go as advisor and student: save/resume an incomplete draft, add a question image, preview, send to a selected student, confirm a nonrecipient cannot open it, save a student answer and resume, submit once, refuse a second submission, then close or pass the deadline and inspect both results views. Repeat with an archived group and on a narrow phone screen.

After the owner applied the migration, `src/types/database.ts` was regenerated from the live schema. Quiz RPCs are now invoked directly on the typed Supabase client; the initial detached-method call lost `this` and prevented both role screens from loading, so a context-sensitive regression test covers this path. The other five app languages use the established English fallback for this new UI until reviewed translations are supplied.
