# EngineerTrack - Development Progress

## Phase Overview

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Setup & Foundation | Complete |
| Phase 2 | Auth & Navigation | Complete |
| Phase 3 | Student Features | Complete |
| Phase 4 | Mentor & Advisor Features + Realtime | Complete |
| Phase 4.5 | Admin Role & Code-Based Linking | Superseded (removed 2026-08-19, see Session 14) |
| Phase 5 | Gamification, i18n & Realtime | Complete (Polls screens retired 2026-09-11, see Session 22) |
| Phase 6 | Polish & Deployment | In progress (builds not yet cut) |
| Phase 7 | Pivot: groups, competency framework, task assignment (subsystems A, B, C) | Complete (Sessions 14-17) |
| Phase 8 | Daily log retired (D1-D3), Expo SDK 57, review-driven hardening | Complete (Sessions 18-21) |
| Phase 9 | Group stream: approved tasks, announcements, polls, task cards, attachments, multi-group, drafts | Complete (Sessions 22-23) |
| Phase 10 | UI/UX redesign (Codex, in parallel on the same branch) | In progress |
| Phase 11 | Direct messages (1:1, group-scoped, deleted with the relationship) | Complete (Session 24) |
| Phase 12 | Internship days: attendance proof + reflective journal (Codex), advisor report, notifications, verification | Complete (Session 25) |
| Phase 13 | Conversations v2: case threads (advisor + student + mentor), advisor↔mentor 1:1 | Complete (Session 26) |
| Phase 14 | Self-assessment + mentor comparison; internship closure with a server-built Markdown report | Complete (Session 27) |
| Phase 15 | "Staj Defteri" design system: tokens, IBM Plex Sans, stamp, level rail, ledger dashboards for all three roles | In progress (Session 27) |
| Phase 16 | Usage simulation (15 agent-played people through the front door) and the fixes for its findings | Complete (Session 28) |
| Phase 17 | Pre-launch: security review + hardening, password policy, architecture/UX audit and its first 13 items, EAS/Sentry wiring, lint + CI | In progress (Session 28, cont.) |
| Phase 18 | Review and approval move from the workplace mentor to the group's advisor | Complete (Session 29) |

> The checklists below Phase 6 are the v1 (daily-log era) record and are kept as history. The Session Log at the bottom is the source of truth for what the app is today; `CLAUDE.md` summarises the current model.

---

## Phase 1: Setup & Foundation - Detailed Checklist

### Setup
- [x] Git repository initialized
- [x] GitHub remote connected
- [x] Expo project created (blank-typescript)
- [x] Folder structure created
- [x] Configuration files (app.json, tsconfig, babel, eas.json)
- [x] Environment variables (.env, .env.example)
- [x] Dependencies installed (runtime + dev)
- [x] Path aliases configured (@/ prefix)

### Backend (Supabase)
- [x] Supabase project created
- [x] Database schema (users, profiles, logs, gamification)
- [x] Row Level Security (RLS) policies
- [x] Storage buckets (photos, documents, avatars)
- [x] Auth trigger (auto-create profile on signup)
- [x] Service files (auth.ts, logs.ts, gamification.ts)
- [x] Zustand stores (authStore, logStore, gamificationStore, uiStore)
- [ ] Edge functions (if needed)

### Authentication
- [x] Login screen
- [x] Register screen (with role selection)
- [x] Forgot password screen (with success state)
- [x] Language selection screen (7 languages)
- [x] Auth state management (listener in root layout)
- [x] Protected routes (role-based redirect)

### Navigation (Expo Router)
- [x] Root layout (app/_layout.tsx)
- [x] Auth stack (app/(auth)/)
- [x] Student tabs (app/(student)/)
- [x] Mentor tabs (app/(mentor)/)
- [x] Advisor tabs (app/(advisor)/)
- [x] Role-based redirect (app/index.tsx)

### UI Components
- [x] Button component (primary, secondary, outline, ghost variants)
- [x] Input component (icon, password toggle, error state)
- [x] StatCard component (icon + value + label)
- [x] ProgressBar component (XP progress bar)
- [x] LogCard component (log list card with status badge)
- [x] BadgeCard component (achievement badge with tier colors)
- [x] LeaderboardRow component (ranked list item)
- [ ] Modal component
- [ ] Avatar component
- [x] ScreenWrapper component (SafeArea + Keyboard + Scroll)

---

## Phase 3: Student Features - Detailed Checklist

### Student Screens
- [x] Dashboard (stats grid, XP progress, today's log, recent logs)
- [x] Create Log (form with validation, save draft, submit)
- [x] Log History (FlatList with status filter chips, pull-to-refresh)
- [x] Achievements (level progress, badges grid, XP history)
- [x] Leaderboard (top 3 podium, ranked list, current user highlight)

### Data Integration
- [x] Supabase data loading with snake_case → camelCase mapping
- [x] Zustand store integration (logStore, gamificationStore, authStore)
- [x] Gamification XP processing on log submission
- [x] Pull-to-refresh on all screens
- [x] Loading states with ActivityIndicator

---

## Phase 4: Mentor Features - Detailed Checklist

### Mentor Service
- [x] mentorService.getAssignedStudents()
- [x] mentorService.getPendingReviewLogs()
- [x] mentorService.getReviewedLogsCount()
- [x] mentorService.getDashboardStats()
- [x] mentorService.getFeedbackHistory()

### Mentor Screens
- [x] Dashboard (stats grid, pending reviews, my students)
- [x] Student List (FlatList with progress, XP, level, streak)
- [x] Review Log (pending list + detail/review form with competency ratings)
- [x] Feedback History (FlatList with status badge, rating, comments)
- [x] Profile (avatar, name edit, language, sign out, Mentor role badge)
- [x] Layout updated with 5th Profile tab

### TypeScript
- [x] `npx tsc --noEmit` passes with zero errors

---

## Phase 4: Advisor Features - Detailed Checklist

### Advisor Service
- [x] advisorService.getAssignedStudents()
- [x] advisorService.getPendingValidationLogs()
- [x] advisorService.getValidatedLogsCount()
- [x] advisorService.getDashboardStats()
- [x] advisorService.validateLog()
- [x] advisorService.getStudentDetailedProgress()
- [x] advisorService.getReportsData()

### Advisor Screens
- [x] Dashboard (stats grid, pending validations, student overview)
- [x] Student Monitor (FlatList with progress bar, XP, streak, completion %)
- [x] Validation (pending list + detail view with mentor feedback, self-assessment comparison, validate button)
- [x] Reports (summary stats, log status breakdown bar, student completion list)
- [x] Profile (avatar, name edit, language, sign out, Advisor role badge)
- [x] Notifications (notification list, mark all read, unread banner)
- [x] Layout updated with 6 tabs (Dashboard, Monitor, Validate, Reports, Alerts, Profile)

### TypeScript
- [x] `npx tsc --noEmit` passes with zero errors

---

## Phase 5: Gamification, i18n & Realtime - Detailed Checklist

### Gamification
- [x] XP system (log submit, log approved, streak, poll completion)
- [x] Level progression (gamificationStore, level-up notification)
- [x] Badges (earned_badges table, BadgeCard component)
- [x] XP history (xp_transactions table)
- [x] Leaderboard scoped to same university + department (superseded 2026-08-19: now scoped to the student's internship group)
  - [x] `leaderboard_public` extended with university, faculty, department columns
  - [x] Sync trigger updated to include new columns
  - [x] `getLeaderboard(limit, university, department)` filter params
  - [x] Leaderboard screen loads student profile, passes filter

### Push Notifications
- [x] `expo-notifications` + `expo-device` installed and configured
- [x] `src/services/pushNotifications.ts` (register, saveToken, removeToken, sendPush, sendToMultiple)
- [x] `docs/push-notifications-migration.sql` — `expo_push_token` column on profiles
- [x] Root layout: token registration on login, foreground handler, tap-to-navigate
- [x] Token cleared on logout (auth state change listener)
- [x] Expo Go guard — no crash when running in Expo Go (SDK 53+ limitation)
- [x] Notification service triggers push after every DB notification insert

### Polls / Quiz
- [x] `src/types/poll.ts` — Poll, PollOption, PollResponse types
- [x] `src/services/polls.ts` — CRUD + response submit
- [x] `docs/phase5-polls-realtime-migration.sql` — polls + poll_responses tables
- [x] ~~Student / mentor / advisor polls screens~~ — retired 2026-09-11; polls now live inside the group stream as one-question posts (Session 22). The `polls*` tables remain in the database, unused.

### Realtime
- [x] `src/hooks/useRealtimeSubscription.ts` — generic Supabase Realtime hook
- [x] Realtime wired into notification stores and dashboard screens

### Notifications (DB + Push)
- [x] `notificationStore.ts` updated with unread count, mark-read actions
- [x] Notification screens updated across all 4 roles
- [x] `docs/partial-features-migration.sql` — partial feature DB patches

### i18n
- [x] `auth.fillAllFields` key added to all 7 locales (en, tr, de, el, it, ro, sr)
- [x] Register screen shows Alert on validation failure (no more silent no-op)

### TypeScript
- [x] `npx tsc --noEmit` passes with zero errors

---

## Phase 6: Polish & Deployment - Detailed Checklist

### Incomplete Features (to finish before deployment)
- [x] Photo upload — wire "Attach Photo" in log creation to Supabase Storage
- [x] Document upload — wire "Attach Document" in log creation to Supabase Storage
- [x] Profile avatar upload — wire avatar change to Supabase Storage across all role profiles
- [x] Password change — add change password option to profile screens (all 4 roles)
- [x] Reports export — CSV export via Share API for advisor reports
- [x] Admin users page redesign — stats bar, role-colored cards, join date/dept info, tap-to-expand remove action
- [x] Admin institution code flow — institution code + student code linking works end-to-end (mentor & advisor)

### i18n (all 7 languages)
- [x] Translate all locale files: tr, de, el, it, ro, sr
- [x] Verify all i18n keys used in screens are present in every locale (key parity script-checked)
- [x] Device language used on first launch; saved profile language applied after login (en force removed)

### Polish
- [x] App icon finalize (all sizes) — branded mark generated via scripts/generate-icons.js
- [x] Splash screen finalize (glyph on brand blue)
- [x] Remove all console.log / debug statements (babel strips console.log in production; error/warn kept)
- [x] Error boundary for unexpected crashes (ErrorFallback + expo-router ErrorBoundary export in root layout)
- [x] Empty states — icon + title + description pattern verified across all list screens
- [x] Sentry crash reporting wired (no-op without EXPO_PUBLIC_SENTRY_DSN; boundary errors captured)

### EAS Build & Deployment
- [x] Install `expo-dev-client` — development build for push notification testing: `eas build --profile development --platform android`
- [ ] Configure EAS project ID in `app.json` (required for production push tokens)
- [ ] `eas build --profile preview --platform android` — internal testing APK
- [ ] `eas build --profile preview --platform ios` — TestFlight build
- [ ] Google Play Store: screenshots, description, privacy policy
- [ ] Apple App Store: screenshots, description, privacy policy, review submission

### TypeScript
- [ ] `npx tsc --noEmit` passes with zero errors before each build

---

## Codex Delivery Notes - 2026-09-19

### Advisor student-monitor avatars

- Student Monitor now displays the selected student character beside the name using the shared 48px avatar renderer without level markers. The appearance uses the server-calculated level; absent selections or unavailable avatar data retain initials. Both group and overview entry points load a single batch, refresh on focus, and discard stale/account-switched results.
- Added `docs/advisor-student-avatars-migration.sql`: read-only RPC restricted to authenticated advisors and active student memberships in their own groups. Avatar preference table privileges remain unchanged; no XP/profile writes. Owner applied the SQL successfully in Supabase and confirmed avatars appear in Expo Go.
- Verification: TypeScript passed; 4 targeted suites / 67 tests passed, including response validation, selected-group scope, fallback/source guards and static SQL authorization checks. Live negative authorization tests remain pending. Owner requested commit/push after device verification; concurrent simulation work untouched.

### Turkish group subpages and competency targets

- Owner reviewed the changes in Expo Go and confirmed no issues before requesting commit/push.
- Completed the missing Turkish `advisor` labels used by student monitoring, group management, assignment selection/review/editing and target selection, including pluralized selection/send/draft results and safety/locked-field messages. Existing mentor-history and report changes retained.
- Added display-only Turkish translations for all 48 seeded competency KPI statements. Group targets and task selection now render these through `kpiContent`; English remains the source, other languages retain English, and unknown/custom/revised statements remain unchanged. No database writes or changes to assignment/target behavior.
- Verification: TypeScript passed; 6 targeted suites / 90 tests passed. Regression checks cover namespace completeness, placeholders, screen/card labels, all 48 seed statements, other-language fallback and custom-content preservation. Expo Go verification pending. No SQL required; concurrent `sim/` work left untouched.

### Turkish advisor reports

- Filled 33 missing Turkish report labels covering the title, summary metrics, competency/student completion, empty states, export headers, explanatory notes and export errors.
- Localized catalog competency names in self-vs-mentor CSV rows using the selected language. Existing report calculations, stored names, custom competencies and non-Turkish catalog display remain unchanged.
- Verification: TypeScript passed; 39 targeted report/self-assessment/mentor-history tests passed, including report translation coverage, interpolation placeholders and CSV data preservation. Expo Go verification pending. No SQL changes; concurrent `sim/` work left untouched.

### Turkish mentor review history

- Filled seven missing Turkish history labels: task/legacy tabs, legacy explanation, approval/revision filters and empty-state title/description. Checked the screen's referenced interface keys for missing Turkish values.
- Added `feedbackTitle` to localize ready-catalog task titles at display time and included translated titles in search alongside original titles. Custom task titles, mentor notes, legacy log titles and stored records remain unchanged; non-Turkish languages retain the original task text.
- Verification: TypeScript passed; 61 targeted feedback/catalog/review tests passed, including Turkish search, outcome filtering, source preservation and legacy handling. Expo Go verification pending. No SQL changes; concurrent `sim/` work left untouched.

### Turkish in-app notification content

- Added missing Turkish assignment/reminder copy and relative-time labels. Extended locale completeness checks to `notifications`, `notificationUi` and `time`.
- Notifications previously displayed persisted title/body strings verbatim. Added display-only `notificationContent` for known English system templates (tasks, stream, direct-message titles/case openings, internship journal/attendance/corrections/closure, levels, badges and reminders), including ready-catalog task titles and known badge names. Both visible text and accessibility labels use the same localized result.
- Preserved stored records, custom/unknown wording, message previews, feedback notes, announcement/poll content and non-Turkish display. No SQL migration, notification routing, read-state or delivery changes. Native push payload localization is outside this in-app fix; unrecognized historical templates intentionally remain unchanged.
- Verification: TypeScript passed; full Jest suite passed (61 suites / 593 tests), including template matching, user-content preservation, locale fallback and immutability. Device verification pending. Concurrent `sim/` work remains untouched.

### Conversation composer keyboard visibility

- The owner reported the message input disappearing beneath the keyboard after starting a conversation. The shared screen had no Android keyboard-avoidance behavior. Enabled Android `height` / iOS `padding` and moved avoidance around the entire safe-area screen so the header and keyboard frame share the screen origin.
- Made the list/loading area flexible with zero minimum height, kept the composer from shrinking, and added handled keyboard taps / drag-to-dismiss to the message list. Student, mentor and advisor use this same screen. No message service, permission, SQL or native configuration changes.
- Verification: TypeScript passed; 12 targeted layout/helper tests passed. Layout tests are source-level guards, not a native keyboard simulation. The owner tested in Expo Go and confirmed the message input now works correctly with the keyboard. Exhaustive cross-device/iOS coverage was not claimed. Concurrent `sim/` work was left untouched.

### Official EngineerTrack logo integration

- Expo Go follow-up: the owner still saw the previous icon during launch. Changed `expo.icon` to a newly named generated asset (`engineertrack-app-icon.png`) to avoid reuse of the old asset URL. The owner subsequently confirmed the launch logo is now correct and reported no issue. Native release-build verification remains separate.
- Follow-up after the owner reported seeing only the logo after sign-out: the native Image could inherit the asset's intrinsic height because only width/aspect ratio were supplied. Moved branding into a shared `AuthBrand` with an aspect-ratio frame and absolutely positioned image sized to that frame, preventing the 740 px source height from displacing the auth form. Sign-out/session behavior was not changed. The owner's subsequent Android screenshot shows the new logo, both input fields, sign-in button, registration link and language control together without clipping; actual sign-in interaction was not verified by that screenshot.
- Integrated the owner's transparent horizontal logo into Login and Register with a responsive, aspect-preserving layout and an accessible brand label; removed the duplicate text brand heading. Original `engineertrack_logo.png` and `engineertrack_logo_square.png` remain unchanged.
- Replaced the old generated track/star artwork pipeline with deterministic packaging of the supplied square logo: opaque 1024 px icon, transparent adaptive foreground with safe padding, splash artwork and 48 px favicon. Native background matches the light page color (`#EEF0EC`); splash image width is 200. No redesign of the supplied artwork.
- Verification: TypeScript passed; 11 targeted branding/auth tests passed, including dimensions, opacity, adaptive safe-circle bounds and auth/config references. After the layout fix, the full suite passed (59 suites / 565 tests). Generated full icon visually inspected. The wordmark remains small at launcher/favicon sizes; no native build or export was run. Login layout was visually checked from the owner's Expo Go screenshot; registration and final native launcher/splash appearance still need device checks. No SQL changes.

### Turkish stream interface completion

- Fixed the stream's English fallback: the Turkish `feed` section previously contained only its title. Added all missing stream labels for comments, likes, polls, attachments, group publishing, drafts, confirmations and empty/error states, preserving interpolation placeholders and plural variants.
- Added six missing stream RPC error translations, the archived-group label and the assigned-task post label. User-written posts, comments, poll choices and custom task content remain unchanged; no SQL migration is needed.
- Added regression coverage for feed translation completeness, counters, draft actions and RPC errors. TypeScript passed; full Jest suite passed (58 suites / 561 tests). Expo Go visual verification remains with the owner.

### Turkish ready-task content and competency names

- **Delivered and pushed:** `0048870` on `feature/competency-framework`.
- Added Turkish display translations for all 480 ready tasks (1,440 fields: learning objective, task, assessment criterion) and the six competency names. English remains the canonical source; languages other than Turkish currently display English catalog content.
- Bundled English/Turkish catalogs in `src/i18n/task-content/`, with display helpers `taskContent` and `competencyContent`. Unknown/custom text falls back to its original value; opening and saving an unchanged translated field preserves the original English source.
- Integrated display translations into student, mentor and advisor task views, selection/review flows, stream cards, internship task references, competency displays and relevant search paths. No database migration or SQL action is required.
- Initial translation used an external service with the owner's explicit consent, sending only English ready-catalog text. Reviewed corrections are recorded in `docs/task-content-tr-corrections.json`; generation/review scripts and maintenance guidance are documented in `docs/task-content-localization.md`. The app does not call a translation service at runtime.
- **Scope limits:** KPI statements and previously stored notification bodies were not translated in this delivery. Device acceptance of every translated screen was not performed by Codex.
- **Verification:** TypeScript passed; full Jest suite passed (57 suites / 558 tests); staged diff checks passed. Concurrent design work in three shared files was preserved outside this commit and subsequently committed separately by Claude (see Session 27).

### Selected avatar beside the student dashboard greeting

- **Delivered and pushed:** `3f7d641` on `feature/competency-framework`.
- Added `StudentHeaderAvatar` to the left of the student dashboard greeting through an optional `StudentHeader.leading` slot. Other headers remain unchanged.
- Reuses the profile's `StudentAvatar` renderer at 56 px without level markers, using the saved character and server-provided level from `my_student_avatar()`.
- Reloads when the dashboard regains focus so profile changes appear on return. Guards against stale requests/account changes; shows a loading indicator or neutral person icon when no avatar is available.
- **Verification:** TypeScript passed; existing avatar service/helper tests passed (2 suites / 46 tests); diff checks passed. Device visual verification was left to the owner in Expo Go. No SQL change, build or export was needed.

## Session Log

| Date | Session | Work Done |
|------|---------|-----------|
| 2026-02-07 | Session 1 | Project infrastructure setup - Git, Expo, configs, types, theme, i18n, Supabase client |
| 2026-02-07 | Session 2 | Expo Router, NativeWind, docs, Supabase DB schema + RLS + services + stores |
| 2026-02-07 | Session 3 | Auth screens (Login, Register, Forgot Password, Language Select), UI components, auth state listener, protected routing |
| 2026-02-07 | Session 4 | Phase 3 Student Features - 5 UI components + 5 screens (Dashboard, Create Log, Log History, Achievements, Leaderboard) |
| 2026-02-07 | Session 5 | Phase 4 Mentor Features - mentor service + 5 screens (Dashboard, Student List, Review Log, Feedback, Profile) + layout update |
| 2026-02-08 | Session 6 | Phase 4 Advisor Features - advisor service + 6 screens (Dashboard, Student Monitor, Validation, Reports, Profile, Notifications) + layout update |
| 2026-02-11 | Session 7 | Phase 5 - Polls/Quiz, Push Notifications, Realtime hook, Leaderboard scoping, i18n fixes, register UX fix |
| 2026-02-28 | Session 8 | Phase 6 Polish - Document upload UI, Password change (all 4 roles), Advisor reports CSV export |
| 2026-02-28 | Session 9 | Security hardening (RLS fixes on earned_badges + polls, service-layer defense-in-depth), Admin users page redesign (stats bar, richer cards, remove-from-institution action, flexWrap department chips) |
| 2026-02-28 | Session 10 | Mentor UX fixes: Link Student moved to student-list page, i18n key fixes across all role profiles (mentor/advisor/admin), mentor Institution Mismatch bug fixed (SQL patch — skip institution check for mentors), photo lightbox in review-log, self-assessment data persistence on create-log refocus, self-assessment visible to mentor (separate Supabase query bypassing PostgREST nested join RLS issue) |
| 2026-02-28 | Session 11 | Android APK build (.npmrc legacy-peer-deps fix for EAS), EAS project ID linked, revision flow fixes: mentor revision banner in student create-log, photos/docs/self-assessment restored on revision reopen, self_assessments RLS fixed (SECURITY DEFINER functions for SELECT+INSERT+UPDATE policies), store data leak fixed (all stores reset on SIGNED_OUT), feedback history deduplication (show only latest feedback per log) |
| 2026-07-10 | Session 12 | i18n fix (14 missing keys + broken t() \|\| fallback pattern in 10 screens), deps aligned with SDK 54 (worklets 0.5.1, removed unused worklets-core, expo-doctor 18/18), dead code removed (src/screens, src/navigation, @screens alias), .gitignore cleanup, console.log stripped from production builds (babel plugin), global error boundary (ErrorFallback + expo-router), gamification moved server-side (DB triggers for XP/streak/badges, client write access revoked — migration applied to Supabase). Also fixed: mentor approval XP (was silently failing), streaks (had no callers), daily_logs.xp_earned (was always 0) |
| 2026-08-03 | Session 13 | Partner feedback package A (consortium review, `Turkiye – Feedback.xlsx`): GDPR/KVKK consent — versioned `record_consent` RPC, in-app privacy policy in 7 locales (**draft, `legal.privacy._status` marks it as awaiting legal review**), registration checkbox, one-time blocking gate for existing users; branded mark on Login and Register; composite student codes (`institution_department_student`) shown on the student profile, with both the composite and the bare 6-character form accepted at all 4 entry points; per-institution allowed e-mail domain rule enforced in `join_department_by_code`, editable from the admin dashboard (the setting fails closed, so the edit card is the only in-app escape from a typo'd domain); join issue reporting routed to the institution admin, rate limited to 3 reports / 5 minutes with a 500-character note cap enforced database-side; stable RPC error codes mapped to translated messages via `mapRpcError`; Jest set up for the pure helpers (31 tests). Migrations: `docs/consent-migration.sql`, `docs/join-hardening-migration.sql`; verification: `docs/join-hardening-verification.sql` |
| 2026-08-19 | Session 14 | Pivot to advisor-owned internship groups (subsystem A of three). The project team corrected the premise: the academic advisor runs the process, there is no admin role and no faculty/university layer. Two tables (`internship_groups`, `group_memberships`) replace the institution/department hierarchy, with a partial unique index carrying the one-active-group-per-student rule. Students join by group code; mentors still link by student code. Deleted: the admin role and its six screens, both institution tables, and the half of partner-feedback package A that only made sense inside that model (composite student codes, per-institution e-mail domains, join issue reporting). Kept: GDPR consent, branding, Jest, mapRpcError. Leaderboard rescoped from free-text university names to the student's group. Migrations: `docs/internship-groups-migration.sql`, `docs/internship-groups-rpcs.sql`; verification: `docs/internship-groups-verification.sql` |
| 2026-08-20 | Session 15 | Competency framework (subsystem B of three). The project's own framework replaces the eight hardcoded competencies scored on 1-5 sliders: six competencies, four levels, forty-eight KPI statements, extracted from `INTERNSHIP-CONTENT-DRAFT.pdf` and seeded as read-only reference data. Assessment is now ticking the KPIs a student actually demonstrated, not scoring a label. Two rules carry the design and are enforced server-side: a level counts as reached only when **both** its KPIs have two observations from someone other than the student (so a student cannot promote themselves), and level L is reachable only when every level below it is complete (so the ladder cannot be climbed out of order). `record_kpi_observations` is the only write path — `kpi_observations` has no INSERT policy at all, because a direct insert would let a client set `observed_by` to someone else and manufacture the two independent observations a level requires. New advisor screen sets which competencies a group works on and to what level; new groups are seeded with all six at level 2 by trigger. The advisor's validation screen replaces the numeric self-vs-mentor table with a three-group tick comparison (agreed / student only / mentor only). Deleted: `COMPETENCIES`, `COMPETENCY_RUBRIC`, the `competencyRatings` plumbing and both `competency_ratings` JSONB columns. Migrations (all four applied): `docs/competency-framework-migration.sql`, `docs/competency-assessment-migration.sql`, `docs/competency-rpcs.sql`, `docs/competency-cleanup-migration.sql`; verification: `docs/competency-verification.sql`; device checklist: `docs/competency-device-checklist.md`. Also `docs/internship-groups-rls-recursion-fix.sql`: the first device check hit `42P17` — the `internship_groups` and `group_memberships` read policies each queried the other table, and each subquery is subject to the other's RLS, so every authenticated read of either table failed. Both verification scripts had passed against this, because the Supabase SQL editor runs as the table owner and an owner bypasses RLS; asserting a policy exists is not asserting it can be evaluated. Fixed with two `SECURITY DEFINER` helpers keyed on the group id, with all five policies that touch those tables routed through them |
| 2026-08-21 | Session 16 | Task assignment, subsystem C1 (schema and data; screens are C2). The internship content document's pedagogical unit is not the KPI but the triplet — Learning Objective -> Task/Responsibility -> Assessment Criterion, ten per KPI. All **480** are now seeded reference data linked to `competency_kpis`; the extractor that produced them was rewritten to carry the KPI link and grew three assertions after it was found to be losing triplets to page-break continuation rows and to a substring filter that ate any objective containing the word "learning". An advisor turns a triplet into a task assigned to their group, a student submits, and the **workplace mentor** evaluates it against the criterion — an approval writes a KPI observation, so planned work and spontaneous behaviour feed the same two-observation threshold. `objective` and `criterion` are copied at assignment time and frozen once a submission exists, so an approval keeps meaning what it meant. `assignment_submissions` has no write policy at all: `submit_assignment` and `review_assignment` are the only paths, because a forgeable observation would defeat the whole rule. Migrations: `docs/task-triplets-migration.sql`, `docs/task-assignment-migration.sql`, `docs/task-assignment-rpcs.sql`, plus deltas to `competency-assessment-migration.sql` and `competency-rpcs.sql` so that one file owns `record_kpi_observations`. Verification: `docs/task-assignment-verification.sql` — and its **Part C is the first thing in this project that actually evaluates an RLS policy**, via `SET LOCAL ROLE authenticated`, rather than reading its catalog entry. Every RLS check before it was structural, which is how a `42P17` policy recursion once hid behind two green verification runs |
| 2026-08-22 | Session 17 | Task assignment, subsystem C2 (screens; closes the task-assignment plan). Three new screens complete the loop C1 only wired at the schema level: the advisor's `app/(advisor)/group-assignments.tsx` (in-scope competency picker -> level -> one of twenty triplets -> assign, plus edit and withdraw on existing assignments), the student's `app/(student)/my-tasks.tsx` (four-section board — revise / to do / waiting / done — submit with a note and an optional linked daily log), and the mentor's `app/(mentor)/pending-reviews.tsx` (criterion-led review panel, approve or request revision). The edit path enforces `trg_freeze_assessed_assignment` in the UI as well as the database: title and description stay editable on an assessed assignment, objective and criterion fields disable once a submission exists. Withdraw refuses the same way once a submission exists. Four notification kinds now fire around the loop: task assigned, task submitted, task approved, task revision requested. This session closed the plan rather than adding to it: `npx tsc --noEmit` silent, `npx jest --silent` at 4 suites / 23 tests, tab bars unchanged (8 student, 7 mentor, 7 advisor, every new screen `href: null`), no locale file but `en.json` touched. The i18n key sweep found one real pre-existing gap — `student.selectDate`, called by `group-assignments.tsx` and by `internship-form.tsx` since before this plan, resolves nowhere in `en.json` and survives only on its inline fallback string — left as a follow-up rather than fixed here, since neither of this task's two touchable files (the checklist and this row) is the right place to change screen or locale code. Device checklist: `docs/task-assignment-c2-device-checklist.md`, twelve items across all three accounts, ordered so Task 1 (approved) and Task 2 (sent back for revision) carry the edit, withdraw, and notification checks that follow; it also names two things only a phone can settle (the twenty-triplet picker's usability, the criterion's readability above a long student note) and three known-open items to watch rather than fix (the mentor's panel omits the objective the student saw, `errors.notInScope` reads oddly on an advisor's own create path, and the `student.selectDate` gap above) |
| 2026-08-23 → 2026-09-11 | Session 18 | Daily log retired (subsystem D, three plans). D1: evidence tables gained a second owner (`assignment_submissions`), `reflection` moved onto the submission, streaks re-based from days to weeks, the log gamification trigger dropped. D2: the student's side — `my-tasks` submission loop with photos/documents, `submit_assignment` (5-arg) writes the mentor's notification itself (the client-side write had failed with 42501 on every call and a `.catch` hid it), private buckets signed at read time. D3: the mentor's and advisor's side — mentor dashboard/student list/feedback read `assignment_submissions` (legacy `mentor_feedbacks` shown as "Earlier Feedback"), advisor reports rebuilt on competencies with a group selector and CSV, `review-log.tsx` and `validation.tsx` deleted (mentor approval is final; no advisor validation), advisor dashboard and student monitor repointed off `daily_logs` (inactivity = no submission in 7 days, and never for a student whose group has no published task). Tables `daily_logs` / `mentor_feedbacks` kept. Migrations: `docs/daily-log-retirement-{migration,rpcs,verification}.sql`. Also: Expo SDK 54 → 57 (RN 0.86, React 19.2, TS 6; `expo-notifications` lazy-loaded for Expo Go; `EXPO_PUBLIC_USE_RN_FETCH=1` because expo/fetch cannot send RN FormData parts). |
| 2026-09-08 | Session 19 | Assignment drafts: `group_assignments.published_at` (NULL = draft), per-task description and PDF/DOCX brief (`assignment-docs` bucket), batch selection across competencies, inline title/description editing, `publish_assignments` RPC with `NOT_IN_SCOPE: <title>`. Draft rows AND their files hidden from students by policy. Migrations: `docs/assignment-drafts-{migration,rpcs,verification}.sql`. |
| 2026-09-11 | Session 20 | External review round (a colleague's findings, 14 items) — all verified against the code, 11 real: evidence-picker upload races and submit-before-upload; per-task form drafts; notification deep links (role-aware `routeForNotification`); notification badge/list/pagination/focus; push token registered on SIGNED_IN; role + consent enforced on every route; dead daily-log API and stores removed; `noUnusedLocals`/`noUnusedParameters` turned on; advisor task-picker stale-response race; 13 screens gained `LoadFailedBanner` instead of a false empty state; notifications ×3 and staff profile ×2 collapsed into one component each; tab titles / time strings / poll manager through `t()`; the daily-log migration's unconditional streak reset bound to first application. Jest 8 suites / 49 tests. |
| 2026-09-11 | Session 21 | Tooling note: the tree is now shared with a parallel Codex session doing UI/UX (Phase 10). Rules adopted: agents stage by explicit path only, never `git add -A`, never touch the other session's uncommitted files; locale files are Codex's lane (new keys use `t(key, default)` and go to `en.json` only when it is free). |
| 2026-09-11 → 2026-09-12 | Session 22 | Group stream ("Akış/Stream"), replacing Polls. Spec `docs/superpowers/specs/2026-09-11-group-feed-design.md`, plan `docs/superpowers/plans/2026-09-11-group-feed.md`, six tasks + final review. One `feed_posts` table, kinds `task \| announcement \| poll`; a trigger posts an approved task automatically unless the student's per-task `share_to_feed` is off (switch on the task form and on the approved card; withdrawal deletes the post with its comments); retraction (`needs_revision`) deletes it; posts land in the assignment's group. Advisor writes announcements and one-question polls (2-6 options, changeable vote); likes, flat comments, advisor moderation (`remove_feed_post` also turns the student's sharing off). One rule for every table: `owns_group OR is_member_of_group`, child tables via `can_see_post` (42P17 guard). The read is `list_feed_posts` (SECURITY DEFINER — classmates cannot select each other's submissions, and it must never project `reflection` or `mentor_note`). Notifications `feed_announcement / feed_poll / feed_comment / feed_task_post`, in-transaction. Polls screens, `PollsManagerScreen`, `pollService`, `types/poll.ts` deleted; `polls*` tables kept. Then the Classroom-style additions: **A** a card in the stream for every task the advisor publishes (trigger on `published_at`); **F** "Upcoming deadline" box (next 3 tasks due within 14 days); **B** announcement attachments — 1 photo, 1 document, 1 link (`feed-attachments` bucket, link scheme checked server-side) — which surfaced and fixed a real gap: `log_photos_read`/`log_documents_read` never let a classmate read a shared task's evidence (now allowed exactly while the post exists, via `feed_shares_evidence`). Migrations, in apply order: `docs/group-feed-migration.sql`, `-rpcs.sql`, `-assignment-cards.sql`, `-attachments.sql`, `-drafts.sql`, `-read.sql` (single home of `list_feed_posts`; Part A fails loudly on a stale copy), then `-verification.sql` (Parts A / B 15 cases / C 11 cases, C9-C10 SKIP on a one-student database). Device walk 16/16. |
| 2026-09-13 | Session 23 | Stream, continued: **C** post an announcement/poll to several groups at once (one post per group, attachments re-uploaded per group, honest partial-failure summary; single-group posts stay silent); **D** drafts for announcements and polls (`feed_posts.published_at`, NULL = draft; members' visibility now requires it, inherited by comments/likes/votes/attachments through `can_see_post`; `feed_publish_post` publishes atomically and notifies exactly once; `publish_feed_post`, `list_feed_pending`; realtime subscription widened to `*` because a draft published later is an UPDATE). Scheduling deliberately not built (would need pg_cron) — project owners' call. Jest 38 suites / 324 tests (incl. Codex's). Docs: `CLAUDE.md` rewritten for the current model; this table and the Phase Overview updated. Open: the GitHub token pasted in an earlier session has still not been rotated. |
| 2026-09-13 | Session 24 | **Direct messages.** Spec `docs/superpowers/specs/2026-09-13-direct-messages-design.md`, plan `docs/superpowers/plans/2026-09-13-direct-messages.md`, six tasks + final review. One-to-one, text only, inside a group: advisor↔student, student↔student, mentor↔their linked student (mentor↔advisor refused). Readable by the two participants only — `owns_group` appears in no policy on `conversations` / `messages` / `conversation_reads` / `conversation_blocks` (Part A asserts it from `pg_policies`), and `can_message(group, a, b)` — the one relationship rule — is re-evaluated on every read through `can_access_conversation` and is REVOKEd from PostgREST (it would be a relationship oracle). Every write is a SECURITY DEFINER RPC (`open_conversation`, `send_message` → one in-transaction `direct_message` notification, `mark_conversation_read`, `block_conversation` — refused when the advisor is a participant, `list_conversations`, `list_messages`, `list_message_contacts`, `list_mentor_message_contacts` — the mentor cannot read `group_memberships`, `unread_message_count`, `count_deletable_conversations`). Messages do not outlive the relationship: triggers delete the conversations when a membership closes, a group is archived, or a mentor link changes, and a fourth deletes the `direct_message` notifications with them; `can_message` is NULL for an archived group; `join_group_by_code` gained a same-group short-circuit because re-entering one's own code used to close-and-reopen the membership, which would now wipe the student's conversations. Client: Messages tab with an unread badge in all three bars (`messageStore`, refreshed on focus, after reads, and on realtime `messages` INSERT), contact picker, inverted conversation screen (keyset pagination, realtime with id dedupe, optimistic append of the sent message, Block/Unblock, "You can't message this person." when blocked), `direct_message` deep link for all roles, archive / remove-member / join-another-group confirmations that say how many conversations will be deleted. Migrations, in apply order: `docs/direct-messages-migration.sql`, `docs/direct-messages-rpcs.sql`, `docs/internship-groups-rpcs.sql` (re-applied for the join guard), `docs/direct-messages-verification.sql` (Part A PASS; Part B 11/13 — B1/B9 need a second student; Part C 5/6 — C4 needs a third student; the advisor-is-an-outsider proof (C2/C3/C5) runs against the student↔mentor conversation on this one-student database). Locale: `tabs.messages` in all seven, five `errors.*` keys in `en.json`; the `messages.*` copy uses `t(key, default)` and awaits the locale pass. Jest 43 suites / 368 tests. Open: the GitHub token from an earlier session is still not rotated. |
| 2026-09-14 | Session 25 | **Internship days** (attendance + reflective journal). The module itself was built by the parallel Codex session (`3bb0a85`: `internship_placements` / `internship_days` / `internship_day_events`, RPC-only access with no client table privileges, server-stamped check-in only when the student opens *today*, past and mentor-opened days need a reason, attendance (mentor's decision) separate from the journal (student's content), drafts redacted server-side, version-checked writes with an audit trail, advisor correction requests, one optional attachment in the private `internship-day-files` bucket; setup doc `docs/internship-days-setup.md`, PGlite harness `scripts/test-internship-days.cjs`). Reviewed here and then extended: (1) **advisor access outlives the archive** — `internship_can_student` / `internship_can_day` grant the advisor read access by ownership of the placement's group regardless of archive or membership state, `internship_note` refuses writes after the archive (the university reports after the term; the original rule closed the door at exactly that moment); (2) **attendance in the advisor report** — `internship_group_attendance(p_group_id)` (per-student totals + per-day record: decision, decider, check-in, journal status; never journal text), a fourth "Attendance" tab in Reports and two CSV sections, `attendance: null` when the module is not installed; (3) **expected working days** — `internship_weekdays(from, to)` (Mon–Fri, no holiday calendar), `expectedDays` / `expectedSoFar` (stopped at today in the placement's timezone) / `recorded` / `unrecorded`, a student with a placement and no days now appears in the report; unrecorded is labelled unknown, never absent; (4) **in-app notifications** written inside the RPCs via `internship_notify()` — journal submitted → mentor, attendance decided → student (one per selection), correction requested → mentor, feedback → student, correction closed → advisor; four notification types routed to each role's internship-days screen; (5) **verification** `docs/internship-days-verification.sql` Parts A / B (12) / C (6, `SET LOCAL ROLE authenticated`, storage policy evaluated for real) — all clean on the owner's database (C4 and the third C5 value need a second student). Not built: a scheduled "N days awaiting your decision" reminder (pg_cron). Locale: the six `advisorFeed` draft/publish keys left unstaged since the stream drafts feature finally landed in `en.json`; the 35 `advisorReports` attendance keys and `common.yes/no` were added to all seven locales (the locale test requires matching key sets) — ro / sr / el are machine-quality and should get a native read; `messages.*` still exists in `en.json` only. Jest 48 suites / 407 tests. Open: the GitHub token is still not rotated. |
| 2026-09-14 → 2026-09-15 | Session 26 | **Workflow audit and conversations v2.** The owners' original workflow diagram (Dec 2025) was compared with the app: structurally the app goes further (groups, an operational competency scale, task evidence, stream, attendance proof, private messaging), but three items of the diagram's pedagogical core were missing — the student's self-assessment on the formal scale with mentor comparison, an internship closure / final approval step, and the "three-way discussion" for major issues. The owners asked for the third first. Spec `docs/superpowers/specs/2026-09-14-conversation-cases-design.md`, plan `docs/superpowers/plans/2026-09-14-conversation-cases.md`, three tasks + final review. Direct messages generalised from a two-column pair to `conversation_participants`; kinds `member | mentor | staff` (advisor↔mentor, new) `| case` (advisor + student + the student's mentor, new). A case is opened by the advisor only (`open_case`: needs a linked mentor, one per student per group, idempotent, conflict-safe, notifies student + mentor once); `list_case_candidates`; access = participant AND the relationship still holds, re-evaluated on every read (`can_access_conversation` branches on kind; `can_message` and `conversation_other` REVOKEd from PostgREST; `owns_group` still in no policy); blocking only for student↔student and mentor↔student; lifetime: leaving/archiving delete cases too, a mentor change re-points the case (old mentor out, new in, messages kept) and removes the old mentor's staff 1:1 where they mentor nobody left; `send_message` notifies every other participant. Migration **drops and recreates** the five message tables (no production rows existed; decision 9). Client: case rows ("Case · name" + participants), sender names in case bubbles, "New case" flow for the advisor, picker loads guarded by a request counter; Turkish keys added for the new copy (Codex's en↔tr parity test). 1:1 conversations stay for the pilot; removable later by a `can_message` rule + UI flag. Verification: Part A PASS; Part B 16/19 (B1/B4/B9 need a second student); Part C 7/9 (C4/C7 need more students) — C2 (advisor cannot read a conversation they are not in) still `0 rows`. Device walk done. Jest 48 suites / 409 tests. Next candidates from the audit: self-assessment per KPI + mentor/student comparison; internship closure with final approval and PDF. Open: the GitHub token is still not rotated. |
| 2026-09-15 → 2026-09-19 | Session 27 | **Self-assessment, internship closure, and the "Staj Defteri" design.** *(1) Self-assessment* — spec `docs/superpowers/specs/2026-09-15-self-assessment-design.md`, plan `docs/superpowers/plans/2026-09-15-self-assessment.md`. The unit is the task submission, the scale the journal's four steps (0 observed · 1 heavy · 2 partial · 3 independent): the student rates on submit (required), the mentor on approval (required, not on revision), the mentor's rating does **not** affect progression (owner's call for v1). `assignment_submissions.self_level / mentor_level`; `submit_assignment` (6 args) and `review_assignment` (4 args) with the old overloads dropped; `competency_self_vs_mentor(student)` → per-competency `tasks / avgSelf / avgMentor / gap / overRated / underRated` for the student, their mentor and the group's advisor; `list_feed_posts` asserted never to project either column. Client: `LevelPicker`, task detail (rating + "You / Mentor" + gap tag), mentor review (student's rating shown, Approve disabled until a level is chosen), Growth screen bars, advisor Reports (gap column, CSV, "Self-assessment by competency"); helpers `levelLabel / gapTag / selfVsMentorCsvRows / weightedGap / weightedAverage`. `docs/self-assessment-migration.sql`, `-verification.sql` (A PASS; B 13 incl. two negative-auth cases; C 4). *(2) Internship closure* — spec `2026-09-16-internship-closure-design.md`, plan `2026-09-16-internship-closure.md`. Per student per group, by the advisor, no grade (owner's call); refused with submissions awaiting the mentor (`PENDING_REVIEWS`); after closure the record is read-only (10 write RPCs guarded by `internship_closed()` — submissions, review, sharing, internship days, journal, notes, conversations; stream likes/comments stay open); reopen with a mandatory reason, re-close bumps `report_version`; the report is **Markdown built on the server** (`build_internship_report`: counts and levels only, never reflection / mentor note / journal text), stored on `internship_closures`, readable by student, mentor and advisor; notifications `internship_closed / internship_reopened`. PDF deferred by the owner ("pdf dursun, md üretelim"). Single-home rule: `docs/internship-closure-guards.sql` now owns the guarded RPC bodies and the historical files carry a NOTE that re-running them removes the guard; Part A asserts guard presence in all ten. Files, in apply order: `docs/internship-closure-migration.sql`, `-guards.sql`, `-evidence-policies.sql` (log_photos / log_documents policies honour closure, self-verifying), `-verification.sql` (A PASS; B 13; C 4). Client: `InternshipReportScreen` with an in-house Markdown renderer (`markdownBlocks`), Share of the raw Markdown, advisor Close / Reopen / View report on the student monitor, student lock banners + "My report", mentor badge. *(3) Design* — Codex's UI pass was judged usable but plain; a new direction was previewed as an artifact and approved: **"Staj Defteri"** (the internship logbook). Tokens in `src/theme` (ink `#12315E`, page `#EEF0EC`, paper, rule, stamp green, amber warn; radius 6, no shadows), IBM Plex Sans 400/500/600 via `@expo-google-fonts/ibm-plex-sans` (covers Greek and Cyrillic), `Stamp` (the one bold element: rotated uppercase label + who · date, kinds approved / revision / pending / closed) and `LevelRail` (4 rungs: filled / dashed target / plain). Every hard-coded hex in the screens Codex was not editing now reads a token; the Stamp replaced the tinted badges (closed, awaiting review, feedback outcome). The three home screens were rebuilt on one pattern — *greeting as the only header + a status line → one featured card (the next task / the next review / the students to follow up) → ruled rows* — after the owner found the first prototype still cluttered; the student's week became a five-cell attendance strip with today's check-in as the entry point to internship days, competency rails moved to Growth. **Runtime finding:** `Pressable`'s function-form `style` renders nothing on this Expo Go / RN 0.86 build — the job card had no box until the style became a static array; every instance was converted. **Design, second half (2026-09-19):** the typeface was not universal — RN applies a family per `Text`, and 43 files set `fontSize`/`fontWeight` without one, so those texts were still Roboto; a scripted sweep (`fontWeight` → the matching Plex face, 700/bold → 600, override objects after a base style inherit its family) fixed 195 styles, then the 11 files Codex had held. Once Codex committed the task-content localisation (`0048870`), the three home files went in with their `taskContent`/`competencyContent` calls merged (`1806f30`). The stamp reached its real homes: `TaskStatus` (task list and detail: approved with the review date / revision / awaiting, a quiet badge for to-do) and the stream's shared-task card; the last non-lightbox hexes went to tokens. Then the list screens: My tasks (`TaskCard` → `TaskRow`, ruled groups, the row opens the task), Pending reviews (student / task / submitted · attachments rows, no per-card button), Stream (paper cards with a rule, Upcoming as rows, shared chips), Messages (ink chips, badge, bubbles), Profile (ruled rows). The dead `StaffProfileScreen.tsx` was deleted. Every home and list screen now follows one pattern — greeting or title as the only header, a status line, one featured card, ruled rows. **Detail screens (2026-09-19, later):** the same page anatomy on every detail — title with the stamp beneath, a fact table (label column 96, tabular values) closed by a rule, sections instead of tinted cards, folding instructions under a left rule, ruled rows for lists, one featured card where a decision is made. Task detail (self/mentor comparison folded into the facts, share-to-stream as a ruled row, dashed evidence add-areas on plain paper); mentor review detail (the student's two answers in one paper card, evidence documents as rows, the decision block as the featured card with the student's own rating as a fact row); internship days (attendance as a stamp — `Stamp` gained a `label` prop — student pickers as rows, icons for radio/checkbox/toggles, the ghost `AuthButton` outlined in ink); group centre (group rows, name + term · count + a small info link, next-step as the featured card, destinations as rows, competency targets framed in ink with a `LevelRail` of the target). Commits `40c78b2` … `e00928e`. Jest 558 / 558. Open: the GitHub token is still not rotated. |
| 2026-09-19 → 2026-09-20 | Session 28 | **Usage simulation and its fixes.** *(1) Simulation* — spec `docs/superpowers/specs/2026-09-19-usage-simulation-design.md`, plan `docs/superpowers/plans/2026-09-19-usage-simulation.md`, executed subagent-driven (12 tasks, ~40 agents). Fifteen agent-played people — Doç. Dr. Selin Aydın (advisor), seven environmental-engineering students of differing character (Elif meticulous, Burak late, Zeynep terse, Mert over-confident, Ayşe quiet, Can questioning, Deniz absent one day) and their seven workplace mentors — used the **live** app through its front door: real sign-ups with the anon key and the same RPCs the client calls (`sim/actor.cjs` mirrors `src/services/*` argument for argument), one compressed week (start = today − 6). Eight phases: group + targets + 8 tasks (6 published) + announcement/poll/draft; join by code; mentor links; 39 internship days, 39 journals, 28 evidence submissions with self levels, messages, a block; attendance decisions, 24 approvals + 1 revision; resubmission, stream cards, self-vs-mentor; reports, reminder, case thread, moderation, closure refused with a pending review → approved → closed → reopened → closed again (report v2); an audit signing in as everyone (no data leak in 7×7 cross probes; counts, stream, leaderboard and attendance table consistent). Outputs under `sim/`: `accounts.md` (credentials, group `58MMWL`), `bugs.md` (17 numbered findings, 0 blocker / 5 wrong / 12 rough, with a "removed as non-findings" section — ~30 false positives were pruned: plan mistakes, wrong-polarity probes, first-page-only stream reads, `overRated` read as a boolean), `RUN.md`, `AUDIT.md`, `log/<person>.md`, `phases/*.cjs`. Rate limits interrupted phases 4, 6, 8 and the final review; every agent was resumed from disk state; one script ran twice (Burak, phase 6 — one duplicate message). *(2) Fixes* — 16 of 17 findings, in the owning SQL files (single-home rule) and the client, verified by `docs/simulation-fixes-verification.sql` (A 10 / B 13 impersonating the sim accounts under ROLLBACK / C 2): `link_student_by_code` refuses a second mentor unless the student generated a fresh code after the link (`student_profiles.mentor_linked_at`, backfilled); `send_message` honours a block in both directions; `review_assignment` raises `ALREADY_APPROVED` on a second approval and writes the decision's notification in-transaction (the client stopped inserting it); `submit_assignment` requires a photo or a document (`EVIDENCE_REQUIRED`), 20 characters of reflection (`REFLECTION_TOO_SHORT`) and clears the old revision note; `internship_review` notifies a min..max range; `build_internship_report` builds its dashes with `chr()` (the deployed copy had CP437 mojibake from a console paste — copy SQL from the editor, or `Set-Clipboard` from PowerShell); `internship_group_attendance` counts recorded weekend days as working days (Saturdays exist); a trim trigger and an `end ≥ start` CHECK on `student_profiles`; client: evidence/reflection gates with a counter, the dashboard week strip marks every recorded day, "Working towards level 1" replaces "Not started" on a competency with rated work, `taskContent` keeps the translation under a trailing "(…)" tag, the resubmitted task hides the old note, the days screen localises the period. Left by design: #6 (a task above the group's target level is accepted — the 2026-08-20 spec scopes by competency only). Historical sim data was not repaired (the overwritten approval, the old notifications). Jest 619 / 619. Open: the GitHub token is still not rotated; the probe account `probe.1789816896565@sim.engineertrack.test` can be deleted. |
| 2026-09-20 → 2026-09-21 | Session 28 (cont.) | **Pre-launch: security, password policy, audit.** *(1) Security review* (`docs/security-review-2026-09-20.md`, prompted by a 20-item checklist): an untrusted-user probe (`sim/security-probe.cjs` → `sim/SECURITY-PROBE.md`, anon + a fresh outsider against every table, 30 RPCs, every bucket), the owner-run inventory (`docs/security-review-inventory.sql`) and the fix (`docs/security-hardening-2026-09-20.sql`): S1 66 functions executable by anon — function creation grants EXECUTE to PUBLIC, which anon inherits, so the earlier `REVOKE … FROM PUBLIC, authenticated` on helpers left anon able to call relationship oracles (`is_mentor_of`, `can_message`, …); the loop grants authenticated explicitly where it had access and revokes PUBLIC + anon, default privileges changed; S2 five buckets without size limits (10 MB + image MIME on photo buckets, 20 MB on document buckets); S3 the public avatars bucket was listable (owner-only listing). Second probe clean. The hardening made a client race visible: `removeToken` ran after SIGNED_OUT as anon (and had never actually cleared the token) and a stream load landing after sign-out — the token is now nulled inside `authService.signOut`, loaders stay silent without a user. *(2) Password policy* (Free plan, so not the dashboard's paid toggle): `src/services/pwnedPasswords.ts` does the leaked-password check on the phone (HIBP range API, k-anonymity, `expo-crypto` SHA-1, fail-open) on sign-up, reset and change; `PASSWORD_MIN_LENGTH = 8` mirrored in the dashboard; `authErrorKey` maps GoTrue codes to locale copy (register/login/forgot showed raw English `error.message`). *(3) Architecture + UX audit* (`docs/audit-2026-09-21.md`: 4 blockers, 7 UX, 10 debt items, each with file:line). Done the same day: B1 EAS env (`EXPO_PUBLIC_*` × 3 + Sentry DSN in production + preview via `eas env:create` — `.env` is git-ignored and EAS does not upload it, so a production build would have crashed on `supabaseUrl is required`); B2 Sentry project `engineertrack26/react-native` (EU ingest), plugin org/project in `app.json`, source maps need `SENTRY_AUTH_TOKEN`; B3 unused permissions (`RECORD_AUDIO`, external storage, non-existent `NOTIFICATIONS`) and the never-imported `expo-camera` removed; U1 join/link calls to action on the empty student and mentor dashboards (`join=1` / `link=1` open the form once); U2 register alert body; U3 44 pt targets + labels on dashboard links and stream card actions; U4 Archive link only with legacy logs; U5 `ToastHost` for eight success confirmations; U7 `OfflineBanner` + offline-aware `LoadFailedBanner` (netinfo); T1 NativeWind/Tailwind removed (0 `className`, every JSX element went through its runtime); T3 `src/utils/localDate.ts` replaces five local-date copies, dead `authService.changePassword` deleted; T4 `supabase gen types` → `src/types/database.ts`, `createClient<Database>`, `services/rpc.ts` (caught nullable-vs-optional RPC params and an over-wide payload type); T6 framework fetched once per run; T8 ESLint (`eslint-config-expo`, compiler rules as warnings, tooling dirs ignored) + `.github/workflows/ci.yml` (tsc, jest, eslint — green on first run); T9 profile retry only for PGRST116. Decisions: the advisor dashboard's "average progress" stays as is (competency-at-target ratio; it will read 0 % until a student reaches a target — explained in chat, owner's call); no build yet. Jest 634 / 634. Open: B4 (session > 2048 B in SecureStore — test on the oldest pilot device), U6, T2, T5, T7, T10; rotate the GitHub token; delete `probe.*` / `outsider.*` accounts; `SENTRY_AUTH_TOKEN` before the first production build. |
| 2026-09-24 → 2026-09-26 | Session 29 | **Review and approval move to the advisor.** Spec `docs/superpowers/specs/2026-09-24-advisor-review-design.md` (amends `2026-08-20-task-assignment-design.md`, which carries a pointer to it, as does `2026-09-16-internship-closure-design.md`), plan under the same date, five tasks, subagent-driven with a review after each. The owners want the person who assigns a task to judge it; the simulation had already shown the cost of the old rule (a slow mentor left a submission pending until closure, and a student with no mentor linked had nobody to review them). *(1) Server* — `docs/review-by-advisor.sql` becomes the home of `submit_assignment` and `review_assignment` (they lived in `docs/internship-closure-guards.sql`, which now warns that re-running it restores the mentor gate; the same warning was added to `self-assessment-migration.sql`, `task-assignment-rpcs.sql` and `daily-log-retirement-rpcs.sql`): the review gate is `is_group_advisor_of` instead of `is_mentor_of`, still refusing `ROLE_NOT_ALLOWED`, and the "Task Submitted" notification goes to the group's advisor instead of `student_profiles.mentor_id`. Every other guard is byte-identical (a reviewer diffed the copied bodies against the originals). `docs/closure-report-reviewer-column.sql` relabels the closure report's two rating columns "Reviewer": they are fed from `mentor_level`, which the advisor now writes, while the same report names the workplace mentor in its header — old reports keep meaning what they say, new ones are correct. Verified live by the owner: A 5/5, B 6/6 (advisor approval sets `approved` and level 2, `kpi_observations.observed_by` is the advisor, **the mentor is refused with `ROLE_NOT_ALLOWED`**, a second approval raises `ALREADY_APPROVED`, `task_submitted` notifies the advisor and not the mentor, a closed internship refuses), C 2/2 (the mentor still SELECTs the submission, their UPDATE affects 0 rows). *(2) Client* — `pending-reviews.tsx` and `review-detail.tsx` moved to `app/(advisor)/` with their tab, badge, store owner and notification route, reusing `ReviewUI` / `ReviewNoteSheet` / `ReviewEvidence` unchanged; the advisor's multi-group queue gained a group chip and an "All" chip (a notification now selects the matching group once, and a chip the advisor picks themselves survives every reload). The advisor's home leads with the next review, the mentor's with attendance; the mentor's home lost the permanently-zero review stats and only shows "Review history" when there is history. **The mentor's read-only access was built rather than assumed**: `assignmentService.listStudentSubmissions`, a submissions list in `StudentDetail`, and `app/(mentor)/submission-detail.tsx` — the advisor's page without the decision controls, the outcome, level and note shown as facts. RLS already admitted `is_mentor_of`; only the UI was missing, which the whole-branch review caught. *(3) Copy* — the student reads "advisor note" and "your advisor will review"; `studentFlow.mentorNote` / `reviewHint` needed real translations in de, el, it, ro and sr too (the keys existed locally, so they never fell back); `assessment.*` (self vs advisor, including the advisor's own report and CSV), `closure.pendingReviews`, `errors.alreadyApproved`, `errors.pendingReviews`, `mentorStudents.*` and the mentor's feedback-history empty state all stopped naming the wrong person; the privacy notice's role attribution was corrected in all seven locales (the rest of that DRAFT stays on the legal track). JSON keys and the SQL columns (`mentor_note`, `mentor_level`, `competency_self_vs_mentor`) keep their historical names on purpose. *(4) Whole-branch review* (most capable model) found what the per-task reviews structurally could not: the closure report's mislabelled columns, the missing mentor UI, a mentor told to "make review decisions" on a screen their role no longer has, five unlocalised strings, a notification that could land a multi-group advisor on an empty queue, and a new mentor's first screen flashing the wrong card. All fixed and re-reviewed. *(5) Device walk* on the emulator as advisor and mentor: the advisor's next-review card, badge and queue agree; the mentor has no review tab, leads with attendance, and can open a submission read-only with evidence, the self-vs-advisor comparison and the advisor's note, with no decision control anywhere. 20 commits `885996f`..`d070031`; jest 648, `tsc` silent, `eslint` clean. Open, left for the owners: whether the mentor should get a workplace note of their own on a submission; and the six non-English `legal.privacy.sharing` strings still mention an "institution administrator", a role this app does not have (pre-existing, legal track). |
