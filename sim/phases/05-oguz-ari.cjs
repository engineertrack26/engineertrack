// Phase 5 — Oğuz Arı reviews Deniz Yıldırım's week and her submitted tasks.
// Adapted from the template (sim/phases/05-hakan-demir.cjs); see task-8a-report.md
// for the real shapes/adaptations this script relies on.
//
// Oğuz's style differences from the template (task-8-brief.md Step 2):
//  - Deniz opened one day late (2026-09-16, per sim/log/deniz-yildirim.md phase 4:
//    "Sağlık raporu, ektedir." / journal says she "was not at the facility due to
//    a health report"). That day is marked `excused` with a fixed note, not
//    `present`. It is found by content (the journal text), not by a hardcoded
//    date, in case the live data shifts.
//  - The rest of the week is marked `present`.
//  - One OTHER journal (not the excused day) gets a correction request via
//    `internship_note(..., p_correction=true)`; which day is recorded in state
//    under `mentors['oguz-ari'].correctionDay`.
//  - Her three submissions are approved with short, honest notes/levels.
//  - No cross-mentor probe here — the brief assigns that test to Hakan only.
const { Actor, parseCode, daysAgoIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('oguz-ari');

const ABSENCE_RE = /sağlık|rapor|değildim|çıkamadım/i;

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const student = s.students[P.studentSlug];
  const reviewed = [];
  const attendance = [];

  // --- attendance: find the late-opened absence day by its journal content ---
  const week1 = await me.attempt("read my student's week", () => me.internshipWeek(student.userId, daysAgoIso(6)));
  let excusedDay = (week1 || []).find((d) => ABSENCE_RE.test(d.experience || '') || ABSENCE_RE.test(d.report_reason || ''));
  if (!excusedDay) {
    const fallbackDate = daysAgoIso(3);
    excusedDay = (week1 || []).find((d) => d.day_date === fallbackDate);
    if (excusedDay) me.note(`no journal text matched the absence pattern; fell back to daysAgoIso(3) = ${fallbackDate}.`);
  }
  if (!excusedDay) {
    me.bug({ did: "find Deniz's absence day in her week", expected: 'one day with an absence journal/reason', got: `none found among ${(week1 || []).length} day(s)`, severity: 'blocker' });
  } else {
    me.note(`absence day found: ${excusedDay.day_date} (id ${excusedDay.id}) — journal: "${(excusedDay.experience || '').slice(0, 80)}" / reason: "${(excusedDay.report_reason || '').slice(0, 80)}".`);
    const presentDays = (week1 || []).filter((d) => d.id !== excusedDay.id);
    await me.attempt('mark the absence day excused', () => me.internshipReview([excusedDay], 'excused', 'Sağlık raporu görüldü.'));
    attendance.push({ id: excusedDay.id, date: excusedDay.day_date, status: 'excused' });
    if (presentDays.length) {
      await me.attempt(`mark ${presentDays.length} day(s) present`, () => me.internshipReview(presentDays, 'present', 'Sahadaydı.'));
      for (const d of presentDays) attendance.push({ id: d.id, date: d.day_date, status: 'present' });
    }
  }

  // --- correction: ask for a correction on ONE other journal (fresh version after the review writes above) ---
  // Adaptation: internship_note's own guard — "(p_correction AND actor_role<>'advisor') →
  // ID_FORBIDDEN" (docs/internship-closure-guards.sql:692-693) — reserves p_correction=true
  // for the advisor role. The mentor screen agrees: only role==='advisor' renders the
  // "Request correction" button (src/components/internship/InternshipDaysScreen.tsx:384);
  // the mentor's own button at line 381-383 always calls note(..., false) ("sendFeedback").
  // So a mentor asking for a correction, as the brief's literal call describes, cannot
  // succeed live. Filed as a bug (sim/bugs.md: "oguz-ari — ask for a correction on one
  // journal. Expected: success. Got: ID_FORBIDDEN.") the first time this ran, since the
  // brief's whole action failed, not just a guessed code. Do not re-file on any rerun.
  // Adapting here: fall back to what a mentor can actually do — the same note, left as
  // ordinary feedback (p_correction=false) — so the day still gets the intended message
  // and a real event to read back.
  const week2 = await me.attempt("re-read the week for fresh versions", () => me.internshipWeek(student.userId, daysAgoIso(6)));
  const correctionDay = excusedDay ? (week2 || []).find((d) => d.id !== excusedDay.id) : (week2 || [])[0];
  if (correctionDay) {
    const noteText = 'Öğrendiklerini bir cümleyle netleştir.';
    let asCorrection = false;
    try {
      await me.internshipNote(correctionDay, noteText, true);
      asCorrection = true;
      me.note(`internship_note(p_correction=true) unexpectedly succeeded as a mentor for ${correctionDay.day_date} — the ID_FORBIDDEN guard did not trigger this time; worth re-checking.`);
    } catch (e) {
      const { code } = parseCode(e);
      if (code === 'ID_FORBIDDEN') me.note(`expected refusal ID_FORBIDDEN for: ask for a correction on one journal (advisor-only by design, per adaptation note above — already filed once in sim/bugs.md, not re-filed).`);
      else me.bug({ did: 'ask for a correction on one journal', expected: 'ID_FORBIDDEN (advisor-only) or success', got: e.message, code, severity: 'wrong' });
      await me.attempt('leave the same note as ordinary feedback instead (mentors cannot flag corrections)', () => me.internshipNote(correctionDay, noteText, false));
    }
    state.merge((st) => { st.mentors['oguz-ari'].correctionDay = { id: correctionDay.id, date: correctionDay.day_date }; });
    me.note(`${asCorrection ? 'correction requested' : 'feedback left (correction request is advisor-only, so this is the mentor-equivalent)'} on ${correctionDay.day_date} (id ${correctionDay.id}).`);
    const events = await me.attempt("read the corrected day's events", () => me.internshipEvents(correctionDay.id));
    me.note(`internship_events(${correctionDay.id}) → ${(events || []).length} event(s): ${(events || []).map((e) => e.event_type).join(', ') || '(none)'}.`);
  } else {
    me.bug({ did: 'find a journal to request a correction on', expected: 'at least one other day in the week', got: `week has ${(week2 || []).length} day(s)`, severity: 'wrong' });
  }

  // --- reviews: approve her three submissions with short notes and honest levels ---
  const pending = await me.attempt('read pending reviews', () => me.listPendingReviews());
  const mineOnly = (pending || []).filter((p) => p.student_id === student.userId);
  if (mineOnly.length !== (pending || []).length) me.bug({ did: 'read pending reviews', expected: "only my student's submissions", got: `${(pending || []).length} rows, ${mineOnly.length} mine`, severity: 'wrong' });
  else me.note(`listPendingReviews → ${(pending || []).length} row(s), all mine.`);

  if (mineOnly[0]) await me.expectRefusal('LEVEL_REQUIRED', 'approve without a level', () => me.reviewAssignment(mineOnly[0].id, true, 'Onay', undefined));

  const NOTES = [
    'Ölçüm kaydı düzenli, teşekkürler.',
    'Belge eksiksiz, onaylandı.',
    'Mesaj akışı net ve zamanında.',
  ];
  for (const [i, sub] of mineOnly.entries()) {
    const level = Math.min(3, Math.max(1, sub.self_level ?? 2));
    const note = NOTES[i] || 'Onaylandı.';
    await me.attempt(`approve "${sub.group_assignments.title}"`, () => me.reviewAssignment(sub.id, true, note, level));
    reviewed.push({ submissionId: sub.id, approved: true, level });
  }

  await me.attempt('read the self-vs-mentor comparison', () => me.competencySelfVsMentor(student.userId));
  await me.attempt('read notifications', () => me.listNotifications());
  state.merge((st) => { Object.assign(st.mentors[P.slug], { reviewed, attendance }); });
  me.note('Faz 5 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
