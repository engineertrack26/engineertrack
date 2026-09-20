# Simulation run

## Phase 0 — probe (2026-09-19T11:21:38.696Z)

GO — sign-up returned a session; profile row exists (role=student, language=tr). Probe account probe.1789816896565@sim.engineertrack.test left for the owner to delete.

## Summary

| Phase | People | Calls | Expected refusals that behaved | Bugs filed |
|---|---|---|---|---|
| 0 — probe | 1 | ≈3 | — (go/no-go check only) | 0 |
| 1 — advisor sets up the group | 1 | ≈37 | NOT_IN_SCOPE ×1 | 1 (#6) |
| 2 — students join | 7 | ≈122 | INVALID_CODE ×7 (wrong join code); same-code rejoin is idempotent by design, not a refusal | 2 (#7, #8) |
| 3 — mentors link | 7 | ≈50 | INVALID_CODE ×7 (made-up link code) | 1 (#1) |
| 4 — students' week | 7 | ≈304 | REFLECTION_REQUIRED ×1, SELF_LEVEL_REQUIRED ×1, CANNOT_OPEN_CASE ×1 | 3 (#2, #9 submit-time, #10) |
| 5 — mentors decide | 7 | ≈99 | LEVEL_REQUIRED ×3 | 2 (#3, #9 review-time — same merged entry as phase 4) |
| 6 — students follow up | 7 | ≈114 | — (none of the tracked stable codes; 11 phase-6 lines removed as script errors — Mert's `overRated` ×4 (a count, not a boolean), Elif's leaderboard id mismatch ×1, Can's first-page-only stream reads ×5, plus one duplicate notification entry — and four per-person `task_approved` entries merged into #11) | 1 (#11) |
| 7 — advisor reports and closes | 3 (advisor, Emre, Ayşe) | ≈52 | PENDING_REVIEWS ×1, ALREADY_CLOSED ×1, REASON_REQUIRED ×1, INTERNSHIP_CLOSED ×3 | 0 |
| 8 — audit | 15 | ≈387 | ROLE_NOT_ALLOWED ×14, REPORT_FORBIDDEN ×15, ID_FORBIDDEN ×15, SELF_ASSESSMENT_FORBIDDEN ×7, NOT_IN_GROUP ×7 | 8 (#4, #5, #12–#17) |

Calls are counted as `- \`` lines in the relevant sections of `sim/log/*.md` (per-person logs span several phases; boundaries taken at each script's own "Faz N bitti" marker) — approximate, not machine-exact.

**Rate-limit interruptions.** Phases 4 and 6, and the audit (phase 8), were interrupted mid-run by API rate limits and resumed from where they stopped; no phase was repeated end-to-end except Burak's phase-6 script, which ran twice and produced one duplicate message to Elif Kaya (documented in `sim/log/burak-sahin.md` and counted once as a real duplicate in the message total below).

**Totals.** Accounts: 15 (+1 probe, `probe.1789816896565@sim.engineertrack.test`). Group: ÇEV 400 Staj — Güz 2026, code `58MMWL`. Tasks: 8 (6 published). Submissions: 28 (27 rows across `state.json.students[*].submissions` + Burak's resubmission of assignment `1591a485`, which reused the same submission id). Days: 39 (`sum of students[*].days`, confirmed by the audit's `internship_group_attendance` row count). Journals: ≈39 (`internship_log_submitted` notification counts across the 7 mentors: 6+2+6+6+6+6+7 — Burak short one, Deniz's correction resubmission adding one). Messages: 12 `send_message` calls (includes Burak's one duplicate to Elif from the phase-6 double run). Posts: 34 in the stream at audit time (25 task, 2 announcement, 1 poll, 6 assignment — identical for all 8 readers checked). Closure: Ayşe Çelik, report version 2 (v1 → reopened → v2).

Findings: 0 blockers, 5 wrong, 12 rough — 17 total, see `sim/bugs.md`.

## For the owner

- Sign in with any row of `sim/accounts.md`.
- The bug list is `sim/bugs.md` (ordered blocker → wrong → rough, numbered, with a "Removed as non-findings" section at the end).
- The probe account `probe.1789816896565@sim.engineertrack.test` can be deleted.
- Nothing under `app/` or `src/` was changed by the simulation — all writes are `sim/**` plus live Supabase data in the seeded group.

