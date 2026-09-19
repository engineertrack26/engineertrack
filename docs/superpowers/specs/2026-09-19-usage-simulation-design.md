# Usage simulation — design

**Date:** 2026-09-19
**Status:** approved in conversation, awaiting written review
**Why:** before the pilot, the owner wants the whole app *used* end to end by people who are not its authors: an advisor running a one-week internship group of seven environmental-engineering students, each with a workplace mentor, every feature and screen exercised, every oddity written down. Nobody will click a phone for a week, so agents play the people. The output is a bug list to fix afterwards and a set of real accounts the owner can sign in with to inspect what happened.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Agents use the app's **front door**: real `signUp` / `signInWithPassword` with the anon key, then exactly the RPCs, tables, buckets the client calls (`src/services/*`). No service-role key, no direct SQL. | RLS and every `SECURITY DEFINER` rule run for real; what the owner later sees on the device is the product of these calls. A refusal the app would show is a refusal the agent sees. |
| 2 | The week is **compressed into one session**: internship dates are six days ago → today. Students check in today (server-stamped) and open past days with a reason. | Check-in is only ever *today*; the past-day-with-reason path is a real feature and gets tested for free. |
| 3 | One shared **actor toolkit** (`sim/actor.cjs`) written first; every agent uses it. Its wrappers mirror `src/services/*` one to one (same RPC names, same argument names). | Bugs must surface in the app, not in fifteen hand-rolled Supabase scripts. A wrapper that *has* to differ from the service is itself a finding. |
| 4 | **Phases run in order; people inside a phase run in parallel.** | The flows depend on each other (group → join → link → task → submit → review → close); people do not share files or a git index, so parallelism is safe. |
| 5 | People are Turkish, content is Turkish, account language `tr`. Seven students differ in gender and character; seven mentors differ in reviewing style. | The owner reads the result in Turkish; varied characters reach the edges (late, absent, over-confident, silent, chatty). |
| 6 | Emails are `<ad>.<soyad>@sim.engineertrack.test`; passwords per person, listed in `sim/accounts.md`. Nothing outside that domain is touched. | The owner's existing data stays untouched; the sim can be deleted by domain. |
| 7 | The simulation **changes no app code**. Findings go to `sim/bugs.md`; fixes are a later, separate piece of work. | Keeps observation and repair apart; one bug list to triage. |
| 8 | Phase 0 is a gate: one probe sign-up must return a session. If it does not (email confirmation on), the run stops and the owner is asked to switch it off. | Fifteen unconfirmed accounts would be fifteen dead ends. |

## 2. People

**Advisor** — Doç. Dr. Selin Aydın, Çevre Mühendisliği. One group: *ÇEV 400 Staj — Güz 2026*.

| Student | Company | Character (drives what they do) | Mentor | Mentor's style |
|---|---|---|---|---|
| Elif Kaya | Marmara Su ve Kanalizasyon İdaresi (arıtma tesisi) | Meticulous: journal every day, evidence on every task, rates herself honestly | Hakan Demir | Reviews promptly, approves with a two-line note |
| Burak Şahin | Ege Çevre Danışmanlık | Late: submits at the last moment, misses one day's journal, gets a revision and resubmits | Ayça Yıldız | Strict: sends work back once with a precise reason |
| Zeynep Arslan | Ankara Büyükşehir Belediyesi Çevre Koruma | Terse: short notes, forgets evidence once, turns stream sharing off | Murat Koç | Approves everything, never writes a note |
| Mert Yılmaz | İzmir Atık Yönetimi A.Ş. | Over-confident: rates himself "independent" on everything; the mentor disagrees | Gamze Öztürk | Rates lower than the student, writes why |
| Ayşe Çelik | Karadeniz ÇED ve Çevre Hizmetleri | Quiet: does the work, never messages, never comments | Emre Aksoy | Slow: leaves one submission pending until the closure attempt |
| Can Doğan | DSİ 5. Bölge Su Kalitesi Laboratuvarı | Questioning: messages the advisor and mentor, comments on every post, asks for a case thread | Selin Kurt | Replies to everything, marks one day "partial" with a note |
| Deniz Yıldırım | Boğaziçi Geri Dönüşüm Tesisleri | Absent one day (excused), opens a past day with a reason, likes but rarely posts | Oğuz Arı | Records the absence as excused, asks for a correction on one journal |

**Auditor** — no account; signs in *as* each person read-only in phase 8.

## 3. Time

`start = today − 6`, `end = today`. Weekdays inside that window are the internship days. Past days are opened by the student with a reason (or by the mentor); today is a real check-in.

## 4. The toolkit — `sim/actor.cjs`

Node, `@supabase/supabase-js` already in `node_modules`, reads `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` from `.env`. One `Actor` per person holding its own client and session.

- `Actor.signUp({ email, password, firstName, lastName, role, language: 'tr', avatarId? })` → mirrors `authService.signUp` (metadata keys `first_name`, `last_name`, `role`, `language`, `consent_version`, `student_avatar_id`); asserts a session came back.
- `Actor.signIn(email, password)`.
- `actor.rpc(name, args)` — logs `who · name · args → result | ERROR code` to `sim/log/<person>.md` and returns data; throws an `RpcError` with the raw message so the caller can decide whether the refusal was expected.
- `actor.table(name)` — the client's `from()` with the same logging, for the tables the app reads/writes directly (`student_profiles`, `feed_comments`, `feed_likes`, `group_competency_targets`, `notifications` …).
- `actor.upload(bucket, path, bytes, contentType)` — storage upload with logging; `sim/fixtures.cjs` makes a 1×1 PNG and a one-page PDF buffer with the person's name in the file name.
- `actor.expectRefusal(code, fn)` — runs `fn`, passes only if it fails with that stable code; records either way.
- `note(person, text)` and `bug({ who, did, expected, got, code?, severity })` — append to `sim/log/<person>.md` and `sim/bugs.md`.

Wrapper names follow the services: `joinGroupByCode`, `linkStudentByCode`, `publishAssignments`, `submitAssignment`, `reviewAssignment`, `setSubmissionSharing`, `createFeedPost`, `publishFeedPost`, `voteFeedPoll`, `openConversation`, `openCase`, `sendMessage`, `internshipOpenDay`, `internshipSaveLog`, `internshipReview`, `internshipNote`, `closeInternship`, `reopenInternship`, `getInternshipReport`, `internshipClosureStatus`, `competencySelfVsMentor`, `listFeedPosts`, `listConversations`, `listMessages`, `unreadMessageCount`, `internshipWeek`, `internshipPeople`, `internshipGroupAttendance`, `getCompetencyProgress`, `getMyGroupLeaderboard`, `recordConsent`, `setStudentAvatar`, `getMyStudentCode`, `validateGroupCode`. Argument names are copied from the service that calls the RPC.

## 5. Phases

| # | Who | Does |
|---|---|---|
| 0 | coordinator | Probe sign-up → session? Otherwise stop. Delete the probe. |
| 1 | advisor | Sign up; create the group (term, name); set competency targets (all six, levels 2–3); draft one task per competency from the triplets plus two more, edit one, attach a brief PDF to one, publish six, leave two as drafts; post an announcement with photo + document + link; post a poll; save one announcement as a draft; read `group_assignment_counts`. |
| 2 | students (×7) | Sign up with an avatar; fill the internship form (`student_profiles`: university, department, company, student number, dates); `validate_group_code` then `join_group_by_code`; read `get_my_student_code`; read the stream; vote; Can comments, Deniz likes; Zeynep tries to join again with the same code (expects the short-circuit). |
| 3 | mentors (×7) | Sign up; `link_student_by_code`; read `internship_people`; one mentor tries a wrong code (expects `INVALID_CODE` or the app's code). |
| 4 | students (×7) | Per character: open past weekdays with a reason, check in today, write and submit journals (`internship_save_log` draft → submit, support level); submit tasks with photo + document evidence and a self level (Mert always 3, Elif honest, Zeynep once without evidence); messages: Can → advisor and mentor, Elif → Burak (student↔student), Ayşe none; Zeynep turns `share_to_feed` off on one task; everyone reads their notifications. |
| 5 | mentors (×7) | `internship_review` per day (present / partial / excused), journal feedback via `internship_note`, one correction request; `review_assignment`: Hakan approves with notes, Ayça sends Burak's back, Murat approves without notes, Gamze rates Mert lower, Emre leaves one *submitted*, Selin and Oğuz mixed; reply to messages; a mentor tries to review a submission that is not theirs (expects refusal). |
| 6 | students (×7) | Burak resubmits with a changed self level; Deniz answers the correction; everyone reads `competency_self_vs_mentor` and `get_competency_progress`; Elif checks the leaderboard; someone tries to submit an approved task again (expects `ALREADY_APPROVED`). |
| 7 | advisor | Reports data per student (progress, attendance, self vs mentor); `internship_group_attendance`; send a reminder notification to Burak; open a case thread (Can + his mentor) and write in it; publish the draft announcement; remove one comment as moderation; try to close Ayşe (expects `PENDING_REVIEWS`); Emre then approves; close Ayşe; read the report; reopen with a reason; close again (version 2); read the report as Ayşe and as Emre; a student tries to submit after closure (expects `INTERNSHIP_CLOSED`). |
| 8 | auditor | Signs in as each person; runs every read the person's screens run (`list_feed_posts`, `list_conversations`, `internship_week`, `get_competency_progress`, notifications, report); checks cross-person consistency (the mentor's count of pending equals the student's submitted rows; the advisor's attendance table equals the days; nobody can read what they should not: a student reads another student's submissions → 0 rows); reads the screen code for each and notes where the data would render oddly (empty title, `—`, NaN, wrong locale). |

Every phase ends with each agent's log and bug entries written; the coordinator appends a phase summary to `sim/RUN.md`.

## 6. Outputs

- `sim/accounts.md` — table: role, name, email, password, company, character, student code, group join code, avatar. Written as accounts are created, so a half-finished run still leaves usable credentials.
- `sim/log/<person>.md` — timestamped actions, RPC results, refusals (expected or not), free-text observations.
- `sim/bugs.md` — one entry per finding: who, what they did, expected, got, RPC/code, severity (`blocker` – the flow cannot continue / `wrong` – the rule or data is wrong / `rough` – works but reads badly), and whether it reproduces. Duplicates merged by the coordinator.
- `sim/RUN.md` — phase summaries, counts (accounts, tasks, submissions, days, messages, posts), the list of expected refusals that behaved, and the final tally.

## 7. Agents

One coordinator (this session) that writes the toolkit, runs phase 0, spawns the phase agents, merges their reports, and keeps `RUN.md`. Phase agents are general-purpose subagents, one per person in the phase, each given: the person's card (from §2), the toolkit's API, the phase's task list, the rule "act in character, write everything down, never touch app code or another person's account", and where to write. The auditor is one agent with all credentials.

## 8. Safety and limits

- Only `@sim.engineertrack.test` accounts; only the anon key; secrets are read from `.env` and never written to `sim/`.
- Supabase auth rate limits: sign-ups are spaced; a `429`/`over_email_send_rate_limit` pauses the phase rather than failing it.
- Uploads are tiny generated files; total storage under 1 MB.
- No app code changes; `sim/` is committed (toolkit, fixtures, outputs) so the run is reviewable and repeatable.
- Cleanup is the owner's call afterwards (delete auth users by domain; cascades remove the rest).

## 9. Out of scope

Visual/touch defects (the owner sees those on the device); push notifications; the retired daily-log tables; performance; running the week in real time.
