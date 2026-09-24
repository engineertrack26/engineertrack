# EngineerTrack - Claude Code Context

## Project Overview
Gamification-powered internship tracking app for engineering students, built
for a consortium of universities. An academic **advisor** runs an internship
**group**; **students** join it by code; each student's workplace **mentor**
links by student code. The advisor assigns **tasks** drawn from the
competency framework, the student submits evidence, the mentor approves —
and an approval is what advances a competency. A per-group **stream**
(Classroom-style) shows approved work, the advisor's announcements and polls.

Built with Expo SDK 57, React Native 0.86, React 19, TypeScript 6, Supabase, Zustand.

## Key Commands
```bash
npx expo start --clear     # Dev server (Expo Go; EXPO_PUBLIC_USE_RN_FETCH=1 in .env)
npx tsc --noEmit           # Must be silent (noUnusedLocals / noUnusedParameters are on)
npx jest --silent          # Pure helpers and services under src/**/__tests__
npx expo install <pkg>     # SDK-compatible install
npx supabase gen types typescript --project-id ocxpymvikzujdqefnoqg --schema public > src/types/database.ts
                           # Regenerate after any SQL change (needs `supabase login` once)
```

## Architecture
- **Routing**: Expo Router (file-based). Every file under `app/` is a route even when hidden from the tab bar with `href: null`.
- **Styling**: StyleSheet + theme tokens (`src/theme`); newer screens share `src/components/common/workflowStyles.ts`.
- **State**: Zustand — `authStore`, `gamificationStore`, `groupStore`, `logStore` (read-only legacy), `mentorReviewStore`, `notificationStore`.
- **Backend**: Supabase, typed client (`createClient<Database>`, `src/types/database.ts` generated — never hand-edited; RPCs through `services/rpc.ts`). Business rules live in `SECURITY DEFINER` RPCs; tables that carry a rule have **no direct write policy** (`assignment_submissions`, `kpi_observations`, `feed_posts` task rows…). SQL lives in `docs/*.sql`, applied by hand in the Supabase SQL editor.
- **i18n**: i18next, 7 locales (en, tr, el, it, ro, de, sr). New keys go to `en.json`; others fall back. Use `t(key, 'Default text')` when adding keys.
- **Auth tokens**: expo-secure-store.

## Route Groups (current)
- `app/(auth)/` — login, register, forgot-password, language-select, consent, privacy-policy
- `app/(student)/` — dashboard, my-tasks, task-detail, feed, achievements, leaderboard, notifications, profile, internship-form, log-history (read-only history of the retired daily log)
- `app/(mentor)/` — dashboard, student-list, pending-reviews, review-detail, feedback, notifications, profile
- `app/(advisor)/` — dashboard, groups, group-assignments, group-competencies, student-monitor, reports, feed, notifications, profile
- No admin role. No daily-log creation, no advisor validation, no Polls screens (retired; see below).

## Domain Model (read before touching anything)
1. **Groups** — `internship_groups` (advisor-owned) + `group_memberships`; one active group per student (partial unique index). Helpers `owns_group(id)` / `is_member_of_group(id)` are the RLS vocabulary everywhere.
2. **Competency framework** — 6 competencies × 4 levels × 2 KPIs (48), each KPI with 10 triplets (objective → task → criterion, 480). Read-only seed data. A level is reached only with two observations per KPI from someone other than the student, in order.
3. **Task assignment** — advisor drafts tasks from triplets (`group_assignments`, `published_at` NULL = draft), publishes; student submits (`assignment_submissions`, `submit_assignment`); mentor `review_assignment` approves → KPI observation. Mentor approval is final.
4. **Stream** (`feed_posts`, kinds `task | announcement | poll | assignment`) — approved tasks appear automatically unless the student turned `share_to_feed` off; advisor posts announcements (≤1 photo, ≤1 document, ≤1 link) and polls, to one or many groups, now or as drafts. Likes, flat comments, advisor moderation. Liking and commenting pay small XP (1 / 2, at most 3 + 3 a day, once per post, never for your own; `docs/feed-engagement-xp.sql` — triggers, not RPCs, because likes/comments are written straight to their tables). Read through `list_feed_posts` (privacy boundary: never the reflection or the mentor's note).
5. **Retired, tables kept**: `daily_logs`, `mentor_feedbacks`, `polls*`. Do not build on them.

## Conventions
- Path aliases (`@/…`), never relative imports out of `src/`.
- Every RPC refusal is a stable code (`NOT_IN_GROUP`, `ALREADY_APPROVED`, …) mapped by `mapRpcError` → `errors.*`; never show a raw `err.message`.
- Never a bare `catch {}`; a failed load shows `LoadFailedBanner`, not an empty state.
- Storage buckets are private: store the **path**, sign at read time (`src/services/evidenceUrls.ts`).
- SQL files: idempotent, anonymous `$$` only (a named tag fails in the SQL editor), one file per submission. Verification files have Part A (structural), Part B (RPC behaviour), Part C (policies under `SET LOCAL ROLE authenticated` — the only real RLS test; owner-run scripts prove existence, not evaluability).
- Design → spec (`docs/superpowers/specs/`) → plan (`docs/superpowers/plans/`) → subagent-driven execution with per-task review.

## Important Files to Read First
1. `PROGRESS.md` — session log, current status
2. `docs/superpowers/specs/` — the binding designs, newest first (`2026-09-11-group-feed-design.md`, `2026-08-23-daily-log-retirement-design.md`, `2026-08-20-task-assignment-design.md`)
3. `src/types/` — all interfaces
4. `docs/group-feed-*.sql`, `docs/task-assignment-*.sql`, `docs/competency-*.sql`, `docs/internship-groups-*.sql` — the schema as it actually is (apply order is in each file's header)
5. `EngineerTrack-Complete-Workflow.md` and `EngineerTrack-Development-Roadmap.md` — **historical (v1, daily-log era)**; do not derive requirements from them
