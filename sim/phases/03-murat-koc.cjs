// Phase 3 — Murat Koç links his student, Zeynep Arslan. Adapted from the
// template (sim/phases/03-hakan-demir.cjs); no extras for this phase.
//
// Adaptations from the brief's literal skeleton (already known from the
// template / task-6a-report.md, not re-discovered here):
//  1. --resume flag: a crash mid-way is recovered by signing in instead of a
//     second signUp (auth.users already has the row).
//  2. link_student_by_code is RETURNS TABLE(student_id, student_name) —
//     PostgREST returns an ARRAY of one row, not a single object.
//  3. 'ABC123' (6 chars) clears the length check and just finds no matching
//     student_codes row, so the made-up-code refusal is INVALID_CODE.
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('murat-koc');
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
  me.note(`link_student_by_code → ${JSON.stringify(linked)} (an ARRAY of one row {student_id, student_name} — RETURNS TABLE)`);

  const people = await me.attempt('read my students', () => me.internshipPeople());
  if (!(people || []).some((p) => p.id === student.userId)) me.bug({ did: 'read internship_people after linking', expected: 'my student listed', got: JSON.stringify(people), severity: 'wrong' });
  else me.note(`internship_people → ${(people || []).length} student(s); mine is listed.`);

  await me.attempt('read pending reviews (none yet)', () => me.listPendingReviews());

  const contacts = await me.attempt('read mentor message contacts', () => me.listMentorMessageContacts());
  if (!(contacts || []).some((c) => c.id === student.userId)) {
    me.bug({ did: 'read mentor message contacts after linking', expected: 'the advisor and my linked student', got: JSON.stringify(contacts), severity: 'wrong' });
  } else {
    me.note(`list_mentor_message_contacts → ${(contacts || []).length} contact(s), my student included.`);
  }

  state.merge((st) => { st.mentors = st.mentors || {}; st.mentors[P.slug] = { userId: me.userId }; });
  me.note('Faz 3 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
