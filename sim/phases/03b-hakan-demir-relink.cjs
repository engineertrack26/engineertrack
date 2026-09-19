// Phase 3b — Hakan re-links Elif after a second mentor (Ayça Yıldız) used
// Elif's still-active student code and link_student_by_code silently
// overwrote mentor_id, taking Elif away from Hakan (filed [wrong] by
// ayca-yildiz). Confirms whether re-linking with the same code recovers the
// link, and dumps the full mentor message-contacts list untruncated (the
// default log line cuts off at 160 chars — phase 3's log showed only the
// advisor for this reason).
const { Actor, parseCode } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('hakan-demir');

(async () => {
  const me = new Actor(P);
  const s = state.read();
  await me.signIn(P.email, P.password);

  me.note('Elif\'in mentoru Ayça olarak görünüyor — kodla yeniden bağlanıyorum (ikinci mentor devralma hatasının sonucu).');

  const student = s.students[P.studentSlug]; // elif-kaya

  let relinked;
  let refusalCode = null;
  try {
    relinked = await me.linkStudentByCode(student.studentCode, 'mentor');
    me.note(`link_student_by_code (re-link) → ${JSON.stringify(relinked)}`);
  } catch (e) {
    const { code, detail } = parseCode(e);
    refusalCode = code;
    me.bug({ did: 're-link Elif by her student code after Ayça overwrote mentor_id', expected: 'success — a mentor should be able to reclaim the link with the same code', got: detail ? `${code}: ${detail}` : e.message, code, severity: 'blocker' });
    me.note(`Re-link refused: ${code}. Stopping here per instructions — not creating a new code myself.`);
  }

  if (refusalCode) {
    me.note('Faz 3b durduruldu (yeniden bağlanma reddedildi).');
    return;
  }

  const people = await me.attempt('read my students after re-link', () => me.internshipPeople());
  me.note(`internship_people → ${JSON.stringify(people)}`);
  const mine = (people || []).some((p) => p.id === student.userId);
  if (!mine) me.bug({ did: 're-link Elif and confirm via internship_people', expected: 'Elif listed among my students again', got: JSON.stringify(people), severity: 'wrong' });

  const profile = await me.attempt("read Elif's student_profiles row directly (mentor_id)", () =>
    me.table('student_profiles', 'select-mentor-id', (q) => q.select('id, mentor_id').eq('id', student.userId).maybeSingle()));
  me.note(`student_profiles.mentor_id for Elif → ${JSON.stringify(profile)} (me.userId = ${me.userId})`);
  if (!profile || profile.mentor_id !== me.userId) me.bug({ did: 'confirm student_profiles.mentor_id after re-link', expected: `mentor_id = ${me.userId}`, got: JSON.stringify(profile), severity: profile ? 'wrong' : 'blocker' });

  const contacts = await me.attempt('read mentor message contacts (full list)', () => me.listMentorMessageContacts());
  me.note(JSON.stringify(contacts));

  me.note('Faz 3b bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
