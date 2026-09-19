// Phase 3 — Ayça Yıldız links her student Burak Şahin, then (extra, per
// task-6-brief.md Step 2) tries to also link Elif Kaya's code — Elif already
// has a mentor (Hakan Demir, linked earlier in this phase). The spec says a
// student has one mentor; this probes what the app actually does when a
// second mentor tries to attach to an already-mentored student.
//
// Adaptations from the brief's literal skeleton (same as the Hakan template,
// sim/phases/03-hakan-demir.cjs — see task-6a-report.md):
//  1. --resume flag: a crash mid-way is recovered by signing in instead of a
//     second signUp.
//  2. link_student_by_code is RETURNS TABLE(student_id, student_name) —
//     PostgREST returns an ARRAY of rows.
//  3. 'ABC123' (6 chars) clears the length check, so the made-up-code
//     refusal is INVALID_CODE, not INVALID_CODE_FORMAT.
//  4. The Elif probe's outcome is unknown ahead of time, so it is NOT run
//     through expectRefusal(code, ...) (which requires knowing the exact
//     code) — it is a plain try/catch, logged either way via me.note() so
//     an unannotated refusal doesn't read as a bug. Only an unexpected
//     SUCCESS is filed as a bug (a student ending up with two mentors would
//     violate the one-mentor-per-student rule in the domain model).
const { Actor, parseCode } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('ayca-yildiz');
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

  const student = s.students[P.studentSlug]; // burak-sahin
  await me.expectRefusal('INVALID_CODE', 'link with a made-up code', () => me.linkStudentByCode('ABC123', 'mentor'));
  const linked = await me.attempt('link my student by code', () => me.linkStudentByCode(student.studentCode, 'mentor'));
  me.note(`link_student_by_code → ${JSON.stringify(linked)} (an ARRAY of one row {student_id, student_name} — RETURNS TABLE; adaptation #2)`);

  const people = await me.attempt('read my students', () => me.internshipPeople());
  if (!(people || []).some((p) => p.id === student.userId)) me.bug({ did: 'read internship_people after linking', expected: 'my student listed', got: JSON.stringify(people), severity: 'wrong' });
  else me.note(`internship_people → ${(people || []).length} student(s); Burak is listed.`);

  // --- Extra: try to also link Elif Kaya, who already has a mentor (Hakan) ---
  const elif = s.students['elif-kaya'];
  if (!elif) {
    me.note('Elif Kaya not yet in state.students — skipping the second-mentor probe (phase 2 for Elif has not run/merged yet).');
  } else {
    let elifSucceeded = false;
    let elifResult;
    try {
      elifResult = await me.linkStudentByCode(elif.studentCode, 'mentor');
      elifSucceeded = true;
      me.note(`Second-mentor probe: linking Elif's code (${elif.studentCode}, already mentored by Hakan Demir) → SUCCEEDED: ${JSON.stringify(elifResult)}. Unexpected — the domain model says a student has one mentor.`);
    } catch (e) {
      const { code } = parseCode(e);
      me.note(`Second-mentor probe: linking Elif's code (${elif.studentCode}, already mentored by Hakan Demir) → refused with ${code}. This is the expected shape (one mentor per student); not filed as a bug.`);
    }
    if (elifSucceeded) {
      const peopleAfter = await me.attempt('read internship_people after the unexpected second-mentor link', () => me.internshipPeople());
      let elifProfile = 'not read';
      try {
        elifProfile = await me.table('student_profiles', 'select', (q) => q.select('id, mentor_id').eq('id', elif.userId).maybeSingle());
      } catch (e) {
        const { code } = parseCode(e);
        elifProfile = `RLS hid it (${code})`;
        me.note(`student_profiles read for Elif after the second-mentor link was blocked: ${code}. Noting instead of failing.`);
      }
      me.bug({
        did: 'link a second mentor (myself) onto Elif, who already has a mentor (Hakan Demir)',
        expected: 'refused — a student has one mentor',
        got: `link_student_by_code succeeded: ${JSON.stringify(elifResult)}; internship_people → ${JSON.stringify(peopleAfter)}; student_profiles(Elif) → ${JSON.stringify(elifProfile)}`,
        code: 'NONE',
        severity: 'wrong',
      });
    }
  }

  await me.attempt('read pending reviews (none yet)', () => me.listPendingReviews());
  const contacts = await me.attempt('read mentor message contacts', () => me.listMentorMessageContacts());
  if (!(contacts || []).some((c) => c.id === student.userId)) me.bug({ did: 'read mentor message contacts after linking', expected: 'the advisor and my linked student (Burak)', got: JSON.stringify(contacts), severity: 'wrong' });
  else me.note(`list_mentor_message_contacts → Burak is listed alongside the advisor.`);

  state.merge((st) => { st.mentors = st.mentors || {}; st.mentors[P.slug] = { userId: me.userId }; });
  me.note('Faz 3 bitti. Sıkı bir mentor olarak: Burak\'ı bağladım, Elif\'in kodunu da denedim (ikinci mentor kontrolü). Sonucu kayıt altına aldım.');
})().catch((e) => { console.error(e); process.exit(1); });
