// Phase 3 — Selin Kurt links her student, Can Doğan, and opens a conversation
// with him right away (her extra Step 2: "Replies to everything").
//
// Adaptations from the brief's literal skeleton (per the template, phase 3a
// report, and this run — see me.note() calls below for the same, logged
// in-band):
//  1. --resume flag, same idiom as the template: a crash mid-way is
//     recovered by signing in instead of a second signUp (auth.users
//     already has the row, so a repeat signUp would fail).
//  2. link_student_by_code is RETURNS TABLE(student_id, student_name)
//     (docs/internship-groups-rpcs.sql). PostgREST returns its result as an
//     ARRAY of rows, not the single object the brief's skeleton guessed.
//  3. 'ABC123' is 6 characters, so the made-up-code refusal is INVALID_CODE
//     (no student_codes row matches), not INVALID_CODE_FORMAT.
const { Actor } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('selin-kurt');
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
  me.note(`list_mentor_message_contacts → ${JSON.stringify(contacts)}`);
  const canContact = (contacts || []).find((c) => c.id === student.userId);
  if (!canContact) {
    me.bug({ did: 'read mentor message contacts after linking', expected: 'the advisor and my linked student (Can Doğan)', got: JSON.stringify(contacts), severity: 'wrong' });
  } else {
    me.note(`Can Doğan is in my message contacts as ${JSON.stringify(canContact)}.`);
  }

  // Extra (Step 2): reply to everything — open a conversation with Can right
  // away and welcome him, whether or not he showed up in the contacts list.
  const canId = student.userId;
  const conv = await me.attempt('open a conversation with Can', () => me.openConversation(s.groupId, canId));
  if (conv) {
    const conversationId = conv.id ?? conv.conversation_id ?? conv;
    me.note(`open_conversation → ${JSON.stringify(conv)}`);
    await me.attempt('welcome Can', () => me.sendMessage(conversationId, 'Hoş geldin Can, sorularını buradan yazabilirsin.'));
    state.merge((st) => { st.mentors = st.mentors || {}; st.mentors[P.slug] = st.mentors[P.slug] || {}; st.mentors[P.slug].conversationWithCan = conversationId; });
  } else {
    me.note('open_conversation with Can failed; no welcome message sent, no conversation id stored.');
  }

  state.merge((st) => { st.mentors = st.mentors || {}; st.mentors[P.slug] = { ...(st.mentors[P.slug] || {}), userId: me.userId }; });
  me.note('Faz 3 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
