// Phase 3 — Emre Aksoy links his student, Ayşe Çelik. He is the slow
// mentor: signs up, does the wrong-code refusal, links, and reads only the
// message contacts (the brief's required check) — skips internship_people
// and pending reviews, unlike the template.
//
// Adaptations (same idiom as the template, sim/phases/03-hakan-demir.cjs):
//  1. --resume flag: a crash mid-way is recovered by signing in instead of
//     a second signUp (auth.users already has the row).
//  2. link_student_by_code is RETURNS TABLE(student_id, student_name), so
//     PostgREST returns an ARRAY of one row, not a single object.
//  3. 'ABC123' is 6 characters, so the made-up-code refusal is
//     INVALID_CODE (no student_codes row matches), not
//     INVALID_CODE_FORMAT.
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('emre-aksoy');
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

  // Slow: reads only the required contacts check; skips internship_people
  // and listPendingReviews entirely.
  const contacts = await me.attempt('read mentor message contacts', () => me.listMentorMessageContacts());
  const hasStudent = (contacts || []).some((c) => c.id === student.userId);
  if (!hasStudent) me.bug({ did: 'read mentor message contacts after linking', expected: 'the advisor and my linked student', got: JSON.stringify(contacts), severity: 'wrong' });
  else me.note(`list_mentor_message_contacts → ${(contacts || []).length} contact(s); my student is listed.`);

  state.merge((st) => { st.mentors = st.mentors || {}; st.mentors[P.slug] = { userId: me.userId }; });
  me.note('Faz 3 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
