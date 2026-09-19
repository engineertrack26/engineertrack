// Phase 3 — Hakan Demir links his student, Elif Kaya. Template for the
// other six mentors' scripts.
//
// Adaptations from the brief's literal skeleton (see me.note() calls below
// for the same, logged in-band):
//  1. --resume flag, same idiom as phase 2: a crash mid-way is recovered by
//     signing in instead of a second signUp (auth.users already has the
//     row, so a repeat signUp would fail).
//  2. link_student_by_code is RETURNS TABLE(student_id, student_name)
//     (docs/internship-groups-rpcs.sql). PostgREST returns its result as an
//     ARRAY of rows, not the single object the brief's skeleton guessed.
//  3. 'ABC123' is 6 characters, so the made-up-code refusal is INVALID_CODE
//     (no student_codes row matches), not INVALID_CODE_FORMAT — that code
//     only fires when the trimmed/upper-cased string isn't 6 chars long.
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('hakan-demir');
const RESUME = process.argv.includes('--resume');

(async () => {
  const me = new Actor(P);
  const s = state.read();
  if (RESUME) {
    await me.signIn(P.email, P.password);
    me.note('Resumed with sign-in (--resume): a previous run crashed mid-way.');
  } else {
    await me.signUp({ email: P.email, password: P.password, firstName: P.firstName, lastName: P.lastName, role: 'mentor' });
  }
  writeAccount({ role: 'mentor', name: P.name, email: P.email, password: P.password, company: P.company, character: P.style });

  const student = s.students[P.studentSlug];
  await me.expectRefusal('INVALID_CODE', 'link with a made-up code', () => me.linkStudentByCode('ABC123', 'mentor'));
  const linked = await me.attempt('link my student by code', () => me.linkStudentByCode(student.studentCode, 'mentor'));
  me.note(`link_student_by_code → ${JSON.stringify(linked)} (an ARRAY of one row {student_id, student_name} — RETURNS TABLE; adaptation #2)`);

  const people = await me.attempt('read my students', () => me.internshipPeople());
  if (!(people || []).some((p) => p.id === student.userId)) me.bug({ did: 'read internship_people after linking', expected: 'my student listed', got: JSON.stringify(people), severity: 'wrong' });
  else me.note(`internship_people → ${(people || []).length} student(s); mine is listed.`);

  await me.attempt('read pending reviews (none yet)', () => me.listPendingReviews());
  await me.attempt('read mentor message contacts', () => me.listMentorMessageContacts());

  state.merge((st) => { st.mentors = st.mentors || {}; st.mentors[P.slug] = { userId: me.userId }; });
  me.note('Faz 3 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
