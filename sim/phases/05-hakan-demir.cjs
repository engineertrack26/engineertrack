// Phase 5 — Hakan Demir reviews Elif Kaya's week and her submitted tasks.
// Template for the other six mentors' scripts.
//
// Adaptations from the brief's literal skeleton (see me.note()/me.bug() calls
// below for the same, logged in-band):
//  1. The "review another mentor's student" refusal is NOT the brief's guess
//     (SUBMISSION_NOT_FOUND). review_assignment is SECURITY DEFINER, so it
//     finds the row regardless of RLS, then checks `is_mentor_of(the_student)`
//     and raises ROLE_NOT_ALLOWED (docs/internship-closure-guards.sql:398-400).
//     A different stable code is expected and logged via me.note, per the
//     brief; only an outright SUCCESS would be filed as a [blocker] bug.
//  2. review_assignment has NO guard against re-approving an already-approved
//     submission — unlike submit_assignment, which does raise ALREADY_APPROVED
//     (that guard is the student-resubmits case, phase 6, not this one).
//     Confirmed by reading all three live definitions of review_assignment
//     (task-assignment-rpcs.sql, self-assessment-migration.sql,
//     internship-closure-guards.sql — the last is the one actually live: it
//     is the only one with the p_level parameter the client sends) plus
//     award_assignment_xp's own OLD.status guard, which exists precisely so a
//     repeat UPDATE ... SET status='approved' does not pay XP twice. The
//     RPC's own comments explain why on purpose: "Approving is a claim about
//     the present ... Only the claim has preconditions" (a withdrawal has
//     preconditions; a repeat approval does not, because it changes nothing
//     that matters once the observation already exists). So the second
//     review_assignment call is expected to SUCCEED (idempotent: note/level
//     overwritten, observation's observed_at refreshed, no second XP grant).
//     Logged via me.note, not filed as a bug — this is documented, intended
//     behaviour, not a rule the RPC forgot to enforce. A different error code
//     is filed as [wrong]; a success is verified against xp semantics, not
//     merely accepted.
const { Actor, parseCode, daysAgoIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('hakan-demir');

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const student = s.students[P.studentSlug];
  const reviewed = [];

  // attendance: every day present; one journal gets a note
  const week = await me.attempt("read my student's week", () => me.internshipWeek(student.userId, daysAgoIso(6)));
  const pendingDays = (week || []).filter((d) => d.attendance === 'pending');
  await me.attempt(`mark ${pendingDays.length} days present`, () => me.internshipReview(pendingDays, 'present', 'Her gün sahadaydı.'));
  const first = (await me.internshipWeek(student.userId, daysAgoIso(6)))[0];
  if (first) await me.attempt('leave a note on the first journal', () => me.internshipNote(first, 'Numune etiketi kısmı çok iyi; DO ölçüm saatini de yazsaydın tam olurdu.', false));
  if (first) await me.attempt("read the day's events", () => me.internshipEvents(first.id));

  // reviews: approve promptly with a two-line note and a level
  const pending = await me.attempt('read pending reviews', () => me.listPendingReviews());
  const mineOnly = (pending || []).filter((p) => p.student_id === student.userId);
  if (mineOnly.length !== (pending || []).length) me.bug({ did: 'read pending reviews', expected: "only my student's submissions", got: `${(pending || []).length} rows, ${mineOnly.length} mine`, severity: 'wrong' });
  else me.note(`listPendingReviews → ${(pending || []).length} row(s), all mine (RLS "submissions read": student_id = auth.uid() OR is_mentor_of() OR is_group_advisor_of() — scoped correctly at the read layer).`);

  await me.expectRefusal('LEVEL_REQUIRED', 'approve without a level', () => me.reviewAssignment(mineOnly[0].id, true, 'Onay', undefined));
  for (const [i, sub] of mineOnly.entries()) {
    const level = Math.min(3, (sub.self_level ?? 1) + (i === 1 ? 1 : 0)); // once sees more than the student
    await me.attempt(`approve "${sub.group_assignments.title}"`, () => me.reviewAssignment(sub.id, true, 'Ölçüm tablosu eksiksiz, fotoğraf net.\nBir sonraki görevde birimleri de yaz.', level));
    reviewed.push({ submissionId: sub.id, approved: true, level });
  }

  // re-approving the same submission: adaptation #2 — expected to succeed, not ALREADY_APPROVED
  if (mineOnly[0]) {
    try {
      await me.reviewAssignment(mineOnly[0].id, true, 'tekrar', 2);
      me.note(`review_assignment on an already-approved submission (${mineOnly[0].id}) succeeded — adaptation #2: no ALREADY_APPROVED guard in review_assignment (only submit_assignment has one); idempotent by design, XP not re-paid (award_assignment_xp guards on OLD.status). Not filed as a bug.`);
    } catch (e) {
      const { code } = parseCode(e);
      if (code === 'ALREADY_APPROVED') me.note('expected refusal ALREADY_APPROVED for: approve the same submission again');
      else me.bug({ did: 'approve the same submission again', expected: 'success (idempotent) or ALREADY_APPROVED', got: e.message, code, severity: 'wrong' });
    }
  }

  // another mentor's student must be refused — adaptation #1: real code is ROLE_NOT_ALLOWED, not SUBMISSION_NOT_FOUND
  const other = s.students['burak-sahin'].submissions[0];
  if (other) {
    try {
      const r = await me.reviewAssignment(other.submissionId, true, 'x', 2);
      me.bug({ did: "review another mentor's student", expected: 'refusal (isolation)', got: `success ${JSON.stringify(r)}`, severity: 'blocker' });
    } catch (e) {
      const { code } = parseCode(e);
      if (code === 'SUBMISSION_NOT_FOUND') me.note('expected refusal SUBMISSION_NOT_FOUND for: review another mentor\'s student');
      else me.note(`review another mentor's student refused with ${code} (guessed SUBMISSION_NOT_FOUND; real code is ROLE_NOT_ALLOWED via is_mentor_of() in review_assignment — expected, adaptation #1, not filed as a bug).`);
    }
  }

  await me.attempt('read the self-vs-mentor comparison', () => me.competencySelfVsMentor(student.userId));
  await me.attempt('read notifications', () => me.listNotifications());
  state.merge((st) => { Object.assign(st.mentors[P.slug], { reviewed }); });
  me.note('Faz 5 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
