// Gate: does sign-up return a session? If not, email confirmation is on and the run must stop.
const fs = require('node:fs');
const path = require('node:path');
const { Actor, parseCode } = require('../actor.cjs');
(async () => {
  const stamp = Date.now();
  const probe = new Actor({ slug: 'probe', name: 'Probe' });
  const email = `probe.${stamp}@sim.engineertrack.test`;
  let verdict;
  try {
    await probe.signUp({ email, password: 'Sim-Probe-2026!', firstName: 'Probe', lastName: String(stamp), role: 'student', avatarId: '01' });
    const profile = await probe.myProfile();
    await probe.recordConsent();
    verdict = `GO — sign-up returned a session; profile row exists (role=${profile.role}, language=${profile.language}). Probe account ${email} left for the owner to delete.`;
  } catch (e) {
    const { code, detail } = parseCode(e);
    verdict = code === 'NO_SESSION'
      ? `STOP — sign-up returned no session: email confirmation is on. Turn it off (Authentication › Providers › Email › Confirm email) and rerun.`
      : `STOP — probe failed: ${code} ${detail || ''}`;
  }
  const run = path.join(__dirname, '..', 'RUN.md');
  if (!fs.existsSync(run)) fs.writeFileSync(run, '# Simulation run\n\n');
  fs.appendFileSync(run, `## Phase 0 — probe (${new Date().toISOString()})\n\n${verdict}\n\n`);
  console.log(verdict);
  process.exit(verdict.startsWith('GO') ? 0 : 1);
})();
