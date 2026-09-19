# Usage simulation

Agents play one advisor, seven students and seven mentors through the app's
front door (anon key + real sign-in + the same RPCs the client calls).
Spec: `docs/superpowers/specs/2026-09-19-usage-simulation-design.md`.

- `actor.cjs` — the toolkit; wrapper names mirror `src/services/*`.
- `people.cjs` — the fifteen people (Task 2).
- `phases/NN-<slug>.cjs` — one script per person per phase; `node sim/phases/01-selin-aydin.cjs`.
- `log/<slug>.md`, `bugs.md`, `accounts.md`, `RUN.md` — outputs.
- `node sim/selftest.cjs` — offline check of the pure parts.

Only `@sim.engineertrack.test` accounts are ever created. No app code changes.
