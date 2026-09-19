# Simulation findings

Severity: blocker = flow cannot continue · wrong = rule/data wrong · rough = works but reads badly.

- **[rough]** selin-aydin — drafted a level-4 task for a competency whose group target is level 2. Expected: a guardrail (refusal or warning) — an advisor should not assign above the level the group is working towards. Got: accepted: the NOT_IN_SCOPE trigger and publish_assignments check only that the competency is targeted, never the level (matches the 2026-08-20 spec, which promises no level check) (`NOT_IN_SCOPE`).
