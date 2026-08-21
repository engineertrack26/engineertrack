# EngineerTrack - Development Progress

## Phase Overview

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Setup & Foundation | Complete |
| Phase 2 | Auth & Navigation | Complete |
| Phase 3 | Student Features | Complete |
| Phase 4 | Mentor & Advisor Features + Realtime | Complete |
| Phase 4.5 | Admin Role & Code-Based Linking | Superseded (removed 2026-08-19, see Session 14) |
| Phase 5 | Gamification, i18n & Realtime | Complete |
| Phase 6 | Polish & Deployment | Not Started |

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
- [x] Student polls screen (`app/(student)/polls.tsx`)
- [x] Mentor polls screen (`app/(mentor)/polls.tsx`)
- [x] Advisor polls screen (`app/(advisor)/polls.tsx`)

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
