// Phase 7 — Selin Aydın reports and closes. Two steps, run as two separate
// process invocations (`a` then `b`), with Emre's late approval (07b) run
// between them: step a reaches a real PENDING_REVIEWS refusal (Ayşe still
// has one submission awaiting Emre) and stops there; step b runs after
// Emre approves it, and does the actual close/report/reopen/close-again
// cycle.
//
// Adaptations (also logged in-band via me.note()):
//  1. `openCase` twice: the brief's guessed refusal code `CASE_EXISTS` is
//     not real. docs/direct-messages-rpcs.sql / the 2026-09-14 design say
//     open_case is idempotent: "returns the existing case if one exists".
//     So the second call is NOT run through expectRefusal — it is called
//     directly and compared to the first id; same id → noted, no bug; a
//     different id (a second case row) → filed as [wrong].
const { Actor } = require('../actor.cjs');
const { ADVISOR, STUDENTS } = require('../people.cjs');
const state = require('../lib/state.cjs');
const step = process.argv[2] || 'a'; // 'a' = up to the refused closure, 'b' = after Emre approves

(async () => {
  const me = new Actor(ADVISOR);
  await me.signIn(ADVISOR.email, ADVISOR.password);
  const s = state.read();
  const ayse = s.students['ayse-celik'];

  if (step === 'a') {
    for (const st of STUDENTS) {
      const u = s.students[st.slug];
      await me.attempt(`progress of ${st.name}`, () => me.getCompetencyProgress(u.userId));
      await me.attempt(`self vs mentor of ${st.name}`, () => me.competencySelfVsMentor(u.userId));
      await me.attempt(`closure status of ${st.name}`, () => me.internshipClosureStatus(u.userId, s.groupId));
    }
    await me.attempt('group attendance table', () => me.internshipGroupAttendance(s.groupId));

    // The advisor's reminder: a direct notifications insert. If RLS refuses
    // an advisor inserting for a student, that is a product bug (the
    // reminder feature would be broken) — attempt() files it as [wrong].
    await me.attempt('remind Burak', () => me.createNotification(s.students['burak-sahin'].userId, 'Görev hatırlatması', 'Selin Aydın: bekleyen görevlerin var.', 'general', {}));

    const candidates = await me.attempt('list case candidates', () => me.listCaseCandidates(s.groupId));
    me.note(`case candidates: ${JSON.stringify(candidates)}`);
    const caseId = await me.attempt('open a case for Can', () => me.openCase(s.groupId, s.students['can-dogan'].userId));
    if (caseId) await me.attempt('write in the case', () => me.sendMessage(caseId, 'Can, mentorunla birlikte ikinci haftanın hedeflerini burada netleştirelim.'));

    // Adaptation #1: open_case is spec'd idempotent, not refused. Call it
    // again directly and compare ids instead of expectRefusal.
    const caseIdAgain = await me.attempt('open the same case twice', () => me.openCase(s.groupId, s.students['can-dogan'].userId));
    if (caseId && caseIdAgain === caseId) {
      me.note(`open_case called a second time for Can returned the SAME case id (${caseIdAgain}) — idempotent by design (2026-09-14 conversation-cases design: "returns the existing case if one exists"). Not a bug.`);
    } else if (caseId && caseIdAgain && caseIdAgain !== caseId) {
      me.bug({ did: 'open the same case twice', expected: 'the same case id back (spec: open_case is idempotent)', got: `a DIFFERENT id (${caseIdAgain} vs first id ${caseId}) — a second case row for the same student`, severity: 'wrong' });
    }

    await me.attempt('publish the draft announcement', () => me.publishFeedPost(s.posts.draftAnnouncementId));
    const comments = await me.attempt('read comments on the announcement', () => me.listComments(s.posts.announcementId));
    const canComment = (comments || []).find((c) => c.author_id === s.students['can-dogan'].userId);
    if (canComment) {
      // Advisor moderation deletes comments directly
      // (docs/group-feed-migration.sql feed_comments_delete's advisor
      // branch). If refused, that is a [wrong] finding — moderation broken.
      await me.attempt('moderate: delete one comment', () => me.deleteComment(canComment.id));
    } else {
      me.note('no comment from Can on the announcement yet — nothing to moderate.');
    }

    await me.expectRefusal('PENDING_REVIEWS', 'close Ayşe while a submission awaits her mentor', () => me.closeInternship(ayse.userId, s.groupId));
    me.note('Adım a bitti — Emre onaylasın.');
  } else {
    const closed = await me.attempt('close Ayşe', () => me.closeInternship(ayse.userId, s.groupId));
    const report = await me.attempt('read the report', () => me.getInternshipReport(ayse.userId, s.groupId));
    if (report && !report.includes('Ayşe Çelik')) me.bug({ did: 'read the closure report', expected: "the student's name in the title", got: report.slice(0, 80), severity: 'wrong' });
    // Reflection leak check: Ayşe's phase-4 submit_assignment reflections
    // (sim/log/ayse-celik.md) — a distinctive phrase from one of them must
    // NOT appear in the report (design decision 6: counts and levels only).
    const REFLECTION_PHRASE = 'kalibrasyonun neden her ölçümden önce tekrarlandığını anladım';
    if (report && report.includes(REFLECTION_PHRASE)) {
      me.bug({ did: 'read the closure report', expected: 'no reflection text (design decision 6)', got: `report contains a distinctive phrase from Ayşe's phase-4 submit_assignment reflection: "${REFLECTION_PHRASE}"`, severity: 'wrong' });
    } else if (report) {
      me.note('confirmed: the report does not contain the reflection phrase checked.');
    }
    if (report && /Yansıma|Ne öğrendim/.test(report)) me.bug({ did: 'read the closure report', expected: 'no free text', got: 'reflection heading text present', severity: 'wrong' });
    if (report && !/## Attendance/.test(report)) me.bug({ did: 'read the closure report', expected: 'an Attendance section (Ayşe has a placement)', got: 'no "## Attendance" heading found', severity: 'wrong' });
    if (report && !/Report version/.test(report)) me.bug({ did: 'read the closure report', expected: 'a "Report version" line', got: 'no "Report version" text found', severity: 'wrong' });
    me.note(`report first lines: ${JSON.stringify((report || '').split('\n').slice(0, 15))}`);

    await me.expectRefusal('ALREADY_CLOSED', 'close again', () => me.closeInternship(ayse.userId, s.groupId));
    await me.expectRefusal('REASON_REQUIRED', 'reopen without a reason', () => me.reopenInternship(ayse.userId, s.groupId, '  '));
    await me.attempt('reopen with a reason', () => me.reopenInternship(ayse.userId, s.groupId, 'Eksik bir günlük vardı, öğrenci tamamlayacak.'));
    const again = await me.attempt('close again (version 2)', () => me.closeInternship(ayse.userId, s.groupId));
    if (again && again.reportVersion !== 2) me.bug({ did: 'close a second time', expected: 'reportVersion 2', got: JSON.stringify(again), severity: 'wrong' });
    await me.attempt('closure status', () => me.internshipClosureStatus(ayse.userId, s.groupId));
    state.merge((st) => { st.closed = { studentSlug: 'ayse-celik', closure: closed, closedAgain: again }; });
    me.note('Faz 7 bitti.');
  }
})().catch((e) => { console.error(e); process.exit(1); });
