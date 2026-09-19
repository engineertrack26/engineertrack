// Phase 3 — Gamze Öztürk links her student, Mert Yılmaz.
// Follows sim/phases/03-hakan-demir.cjs (the template) with no per-person
// extras: the brief only adds extras for Ayça, Emre and Selin Kurt.
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('gamze-ozturk');
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
  me.note(`link_student_by_code → ${JSON.stringify(linked)} (array of one row {student_id, student_name} — RETURNS TABLE, per task-6a-report.md)`);

  const people = await me.attempt('read my students', () => me.internshipPeople());
  if (!(people || []).some((p) => p.id === student.userId)) me.bug({ did: 'read internship_people after linking', expected: 'my student listed', got: JSON.stringify(people), severity: 'wrong' });
  else me.note(`internship_people → ${(people || []).length} student(s); mine (Mert) is listed.`);

  await me.attempt('read pending reviews (none yet)', () => me.listPendingReviews());
  const contacts = await me.attempt('read mentor message contacts', () => me.listMentorMessageContacts());
  if (!(contacts || []).some((c) => c.id === student.userId)) {
    me.bug({ did: 'read mentor message contacts after linking', expected: 'the advisor and my linked student', got: JSON.stringify(contacts), severity: 'wrong' });
  } else {
    me.note(`list_mentor_message_contacts → ${(contacts || []).length} contact(s); Mert is listed.`);
  }

  state.merge((st) => { st.mentors = st.mentors || {}; st.mentors[P.slug] = { userId: me.userId }; });
  me.note('Faz 3 bitti. Mert kendini her konuda 3 (bağımsız) olarak değerlendiriyor ama ben katılmıyorum — inceleme aşamasında neden düşük puan verdiğimi yazacağım.');
})().catch((e) => { console.error(e); process.exit(1); });
