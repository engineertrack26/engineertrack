// Phase 5 — Selin Kurt reviews Can Doğan's week and his submitted tasks.
// Her Step 2 differences from the Hakan template: one day marked `partial`
// (not present) with a note; approves all four with notes/levels matching or
// one above his self level; replies in the conversation Can opened with her;
// comments on the advisor's announcement in the stream.
//
// Adaptations from the brief's literal skeleton (logged in-band too, per
// task-8a's real shapes — same two as the template, confirmed again here):
//  1. review_assignment on an already-approved submission SUCCEEDS (no
//     ALREADY_APPROVED guard on review_assignment, only on submit_assignment)
//     — already filed as [wrong] by the controller from the template run, so
//     this run only notes it, does not re-file.
//  2. The template's cross-mentor probe (review another mentor's student) is
//     Hakan's only, per the rules — skipped here entirely.
const { Actor, parseCode, daysAgoIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('selin-kurt');

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const student = s.students[P.studentSlug];
  const reviewed = [];

  // attendance: one day partial with a note, the rest present
  const week = await me.attempt("read my student's week", () => me.internshipWeek(student.userId, daysAgoIso(6)));
  const pendingDays = (week || []).filter((d) => d.attendance === 'pending');
  const partialIndex = pendingDays.length ? Math.min(2, pendingDays.length - 1) : -1;
  const partialDay = partialIndex >= 0 ? pendingDays[partialIndex] : null;
  const presentDays = pendingDays.filter((_, i) => i !== partialIndex);
  if (presentDays.length) await me.attempt(`mark ${presentDays.length} day(s) present`, () => me.internshipReview(presentDays, 'present', 'Her gün sahadaydı.'));
  if (partialDay) await me.attempt(`mark ${partialDay.date} partial`, () => me.internshipReview([partialDay], 'partial', 'Öğleden sonra laboratuvardan erken ayrıldı.'));
  const attendance = pendingDays.map((d) => ({ dayId: d.id, status: d.id === (partialDay && partialDay.id) ? 'partial' : 'present' }));

  const freshWeek = (await me.internshipWeek(student.userId, daysAgoIso(6))) || [];
  const first = freshWeek[0];
  if (first) await me.attempt('leave a note on the first journal', () => me.internshipNote(first, 'Gözlemlerin net yazılmış; bir dahaki sefere kullandığın cihazın kalibrasyon saatini de ekle.', false));
  if (first) await me.attempt("read the day's events", () => me.internshipEvents(first.id));

  // reviews: approve all four, level matching or one above his self level
  const pending = await me.attempt('read pending reviews', () => me.listPendingReviews());
  const mineOnly = (pending || []).filter((p) => p.student_id === student.userId);
  if (mineOnly.length !== (pending || []).length) me.bug({ did: 'read pending reviews', expected: "only my student's submissions", got: `${(pending || []).length} rows, ${mineOnly.length} mine`, severity: 'wrong' });
  else me.note(`listPendingReviews → ${(pending || []).length} row(s), all mine.`);

  await me.expectRefusal('LEVEL_REQUIRED', 'approve without a level', () => me.reviewAssignment(mineOnly[0].id, true, 'Onay', undefined));

  const notes = [
    'Numune hazırlama adımların düzenli, tebrikler. Bir sonrakinde kalibrasyon saatini de not düş.',
    'Sorduğun sorular çok yerinde; analiz sürecini iyi kavradığın belli oluyor.',
    'Rapor akışı net; küçük bir öneri: birim sembollerini SI standardına göre yaz.',
    'Bu görevde bağımsız çalıştığın çok belli, eline sağlık.',
  ];
  for (const [i, sub] of mineOnly.entries()) {
    const level = Math.min(3, (sub.self_level ?? 1) + (i % 2 === 0 ? 1 : 0)); // matching or one above his self level
    const note = notes[i] ?? 'Onaylandı, eline sağlık.';
    await me.attempt(`approve "${sub.group_assignments.title}"`, () => me.reviewAssignment(sub.id, true, note, level));
    reviewed.push({ submissionId: sub.id, approved: true, level });
  }

  // re-approving the same submission: expected to succeed (already filed by the controller, not re-filed here)
  if (mineOnly[0]) {
    try {
      await me.reviewAssignment(mineOnly[0].id, true, 'tekrar', 2);
      me.note(`review_assignment on an already-approved submission (${mineOnly[0].id}) succeeded — no ALREADY_APPROVED guard on review_assignment, only on submit_assignment; idempotent by design. Already filed as [wrong] by the controller from the template run, not re-filed here.`);
    } catch (e) {
      const { code } = parseCode(e);
      me.note(`review_assignment on an already-approved submission refused with ${code} this time (template run saw success) — noted, not re-filed since the controller already tracks this behaviour.`);
    }
  }

  await me.attempt('read the self-vs-mentor comparison', () => me.competencySelfVsMentor(student.userId));
  await me.attempt('read notifications', () => me.listNotifications());

  // reply to Can in the conversation she opened with him in phase 3
  const conversationId = s.mentors[P.slug] && s.mentors[P.slug].conversationWithCan;
  if (conversationId) {
    const messages = await me.attempt('read the conversation with Can', () => me.listMessages(conversationId));
    const canMessages = (messages || []).filter((m) => (m.senderId ?? m.sender_id) === student.userId);
    const lastFromCan = canMessages[canMessages.length - 1];
    if (lastFromCan) {
      me.note(`Can's latest message: "${lastFromCan.body}"`);
      await me.attempt('reply to Can', () => me.sendMessage(conversationId, 'Elbette Can, istediğin zaman buradan yazabilirsin. Bu haftaki dört görevini de inceledim ve onayladım; notlarımı ve seviyeleri her görevin altında bulabilirsin. Aklına takılan olursa buradan devam edelim.'));
    } else {
      me.note('no message from Can was found in the conversation yet; nothing to reply to.');
      me.bug({ did: 'find a message from Can to reply to in the conversation she opened with him', expected: 'at least one message from Can (he replied to her welcome in phase 4)', got: JSON.stringify(messages), severity: 'wrong' });
    }
  } else {
    me.bug({ did: 'find the conversation with Can', expected: 'state.mentors["selin-kurt"].conversationWithCan to be set (she opened it in phase 3)', got: JSON.stringify(s.mentors[P.slug]), severity: 'wrong' });
  }

  // comment on the advisor's announcement in the stream
  const announcementId = s.posts && s.posts.announcementId;
  if (announcementId) {
    await me.attempt('comment on the advisor\'s announcement', () => me.addComment(announcementId, 'Duyuru için teşekkürler Hocam, öğrencimle de paylaştım.'));
  } else {
    me.bug({ did: 'find the advisor\'s announcement to comment on', expected: 'state.posts.announcementId to be set', got: JSON.stringify(s.posts), severity: 'wrong' });
  }

  state.merge((st) => { Object.assign(st.mentors[P.slug], { reviewed, attendance }); });
  me.note('Faz 5 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
