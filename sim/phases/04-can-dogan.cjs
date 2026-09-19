// Phase 4 — Can's week. Adapted from sim/phases/04-elif-kaya.cjs (the
// template), following Ayşe's baseline (see 2026-09-19-usage-simulation
// brief, Step 2): opens every day, journals every day and submits all of
// them, submits four tasks with real evidence and honest self-levels, reads
// the leaderboard. Can's own deltas (the "questioning intern" character):
//   - opens a conversation with the advisor and asks two separate questions
//   - finds the conversation his mentor Selin Kurt already opened with him
//     (state.mentors['selin-kurt'].conversationWithCan, cross-checked against
//     listConversations), reads it, and replies to her welcome
//   - calls list_case_candidates as a student (advisor-only per
//     docs/superpowers/plans/2026-09-14-conversation-cases.md — expects
//     CANNOT_OPEN_CASE; a success would be a [wrong] bug)
//   - reads the stream and looks for his own task card (none yet — no
//     submission has been approved for anyone at this point in the
//     simulation, so nothing should be there to comment on)
//   - reads notifications and the unread message count
const { Actor, daysAgoIso, todayIso, parseCode } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('can-dogan');
const WEEKDAY = (iso) => { const d = new Date(iso + 'T12:00:00'); return d.getDay() >= 1 && d.getDay() <= 5; };
const JOURNAL = {
  experience: ['Numune kabul biriminde gelen su numunelerinin etiket kontrolünü yaptım.', 'Titrasyonla klor tayini deneyine eşlik ettim.', 'Spektrofotometre ile bulanıklık ölçümü aldık.', 'Numune saklama dolabındaki sıcaklık kayıtlarını kontrol ettim.', 'pH metrenin günlük kalibrasyonunu izledim.', 'Analiz sonuçlarını laboratuvar defterine işledim.'],
  learning: ['Numune etiketi eksikse analiz reddediliyor.', 'Klor tayini numune alındıktan hemen sonra yapılmalı, yoksa değer düşüyor.', 'Bulanıklık NTU birimiyle ölçülüyor ve raporda ayrıca belirtiliyor.', 'Soğuk zincir kırılırsa numune analize uygun sayılmıyor.', 'Kalibrasyon yapılmadan ölçülen pH değeri güvenilir değil.', 'Laboratuvar defterindeki her satır tarih ve imza istiyor.'],
};

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  me.note('Signed in (as in the template): Can already exists from phase 2, so this script does not sign up again.');
  const s = state.read();
  const mine = s.students[P.slug];
  const days = (mine && mine.days) || [];
  const submissions = (mine && mine.submissions) || [];
  const conversations = (mine && mine.conversations) || {};

  // attendance: opens every day, like Ayşe (all weekdays of the window + today).
  const past = [6, 5, 4, 3, 2, 1].map(daysAgoIso).filter(WEEKDAY);
  for (const date of past) {
    if (days.find((d) => d.date === date)) { me.note(`day ${date} already open (resume) — skipping.`); continue; }
    const id = await me.attempt(`open past day ${date} with a reason`, () => me.internshipOpenDay(me.userId, date, 'Kaydı gün içinde açamadım, laboratuvardaydım.'));
    if (id) days.push({ date, id });
  }
  if (!days.find((d) => d.date === todayIso())) {
    const todayId = await me.attempt('check in today', () => me.internshipOpenDay(me.userId, todayIso()));
    if (todayId) days.push({ date: todayIso(), id: todayId });
  } else {
    me.note('today already open (resume) — skipping.');
  }

  const week = await me.attempt('read my week', () => me.internshipWeek(me.userId, daysAgoIso(6)));

  // journals: every day, submitted (support 1-2, like Ayşe).
  for (const [i, day] of (week || []).entries()) {
    if (day.log_status === 'submitted') { me.note(`journal ${day.day_date} already submitted (resume) — skipping.`); continue; }
    const form = { experience: JOURNAL.experience[i % 6], learning: JOURNAL.learning[i % 6], nextStep: 'Yarın mentöre bulanıklık sonucundaki sapmayı soracağım.', support: i < 3 ? 1 : 2, reason: '', taskId: null, attachment: null };
    await me.attempt(`save journal draft ${day.day_date}`, () => me.internshipSaveLog(day, form, false));
    const freshWeek = await me.attempt('re-read my week for the fresh version', () => me.internshipWeek(me.userId, daysAgoIso(6)));
    const fresh = (freshWeek || []).find((d) => d.id === day.id); // version bumped by the draft save
    if (fresh) await me.attempt(`submit journal ${day.day_date}`, () => me.internshipSaveLog(fresh, form, true));
  }

  // tasks: four submissions, real evidence, honest self-levels.
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  for (const [i, task] of (tasks || []).slice(0, 4).entries()) {
    const already = (task.assignment_submissions || []).find((sub) => sub.student_id === me.userId);
    if (already) { me.note(`task "${task.title}" already has a submission (status ${already.status}, resume) — skipping.`); if (already.id) submissions.push({ assignmentId: task.id, submissionId: already.id }); continue; }
    const photo = await me.attempt('upload a photo', () => me.uploadPhoto(task.id));
    const doc = await me.attempt('upload a document', () => me.uploadDocument(task.id, 'analiz-kaydi.pdf'));
    const submissionId = await me.attempt(`submit task "${task.title}"`, () => me.submitAssignment(task.id,
      `Görevi laboratuvarda tamamladım; analiz kaydı ve numune fotoğrafı ekte.`,
      'Bu görevde en çok soğuk zincirin neden bu kadar sıkı takip edildiğini anladım.',
      photo ? [{ uri: photo, caption: 'Numune fotoğrafı' }] : [], doc ? [{ uri: doc, fileName: 'analiz-kaydi.pdf', fileType: 'application/pdf', fileSize: 600 }] : [], i < 2 ? 1 : 2));
    if (submissionId) submissions.push({ assignmentId: task.id, submissionId });
  }

  // leaderboard, like Ayşe.
  await me.attempt('read the leaderboard', () => me.getMyGroupLeaderboard());

  // Can's delta 1: a conversation with the advisor, two separate questions.
  if (conversations.advisor) {
    me.note('conversation with the advisor already recorded (resume) — not re-sending the two questions.');
  } else {
    const advisorConv = await me.attempt('open a conversation with the advisor', () => me.openConversation(s.groupId, s.advisorId));
    if (advisorConv) {
      await me.attempt('ask the advisor question 1', () => me.sendMessage(advisorConv, 'Selin Hocam, bu haftaki görevlerden hangisi Numune Analiz KPI\'ları için öncelikli sayılmalı?'));
      await me.attempt('ask the advisor question 2', () => me.sendMessage(advisorConv, 'Ayrıca bir sorum daha var: kriterde geçen "kalibrasyon" ifadesi sadece pH metreyi mi kapsıyor, yoksa spektrofotometreyi de mi?'));
      conversations.advisor = advisorConv;
    }
  }

  // Can's delta 2: find the conversation Selin Kurt (mentor) already opened, read it, reply to her welcome.
  let mentorConv = conversations.mentor || (s.mentors && s.mentors['selin-kurt'] && s.mentors['selin-kurt'].conversationWithCan);
  const groupConvs = await me.attempt('list my conversations', () => me.listConversations(s.groupId));
  const foundMentorConv = (groupConvs || []).find((c) => c.otherId === s.mentors['selin-kurt'].userId || c.other_id === s.mentors['selin-kurt'].userId || c.id === mentorConv);
  if (foundMentorConv) {
    mentorConv = foundMentorConv.id || mentorConv;
    me.note(`found the mentor conversation via listConversations: ${JSON.stringify(foundMentorConv)}`);
  } else if (mentorConv) {
    me.note(`listConversations did not surface the mentor conversation by a recognizable field — falling back to the recorded id ${mentorConv} from state.mentors['selin-kurt'].conversationWithCan.`);
  } else {
    me.bug({ did: 'find the conversation my mentor Selin Kurt opened with me', expected: 'a conversation to be listed (she opened one and sent a welcome in phase 3)', got: `listConversations → ${JSON.stringify(groupConvs)}; no recorded conversationWithCan in state either`, severity: 'wrong' });
  }
  if (mentorConv) {
    const mentorMessages = await me.attempt('read messages with my mentor', () => me.listMessages(mentorConv));
    me.note(`mentor conversation messages: ${JSON.stringify(mentorMessages)}`);
    const alreadyReplied = (mentorMessages || []).some((m) => (m.sender_id === me.userId || m.senderId === me.userId));
    if (alreadyReplied) {
      me.note('already replied to the mentor\'s welcome (resume) — skipping.');
    } else {
      await me.attempt('reply to my mentor\'s welcome', () => me.sendMessage(mentorConv, 'Teşekkürler Selin Hanım, hoş geldim mesajınız için. İlk haftamla ilgili birkaç sorum olacak, uygun olduğunuzda buradan yazabilir miyim?'));
    }
    conversations.mentor = mentorConv;
  }

  // Can's delta 3: list_case_candidates as a student — should be refused (advisor-only).
  try {
    const r = await me.listCaseCandidates(s.groupId);
    me.bug({ did: 'call list_case_candidates as a student', expected: 'a refusal — students cannot open cases (advisor-only per docs/superpowers/plans/2026-09-14-conversation-cases.md)', got: `success: ${JSON.stringify(r)}`, code: 'NONE', severity: 'wrong' });
  } catch (e) {
    const { code } = parseCode(e);
    me.note(`list_case_candidates as a student was refused with code ${code}${code === 'CANNOT_OPEN_CASE' ? ' — matches the documented advisor-only guard' : ' — a different stable code than the documented CANNOT_OPEN_CASE, recorded as the real refusal, not filed'}.`);
  }

  // Can's delta 4: read the stream, comment on his own task card if one exists (it shouldn't yet).
  const stream = await me.attempt('read the stream', () => me.listFeedPosts(s.groupId));
  const myTaskCard = (stream || []).find((post) => post.kind === 'task' && (post.student_id === me.userId || post.studentId === me.userId || post.author_id === me.userId || (post.submission && post.submission.student_id === me.userId)));
  if (myTaskCard) {
    await me.attempt('comment on my own task card', () => me.addComment(myTaskCard.id, 'Bu görevi tamamlarken en çok soğuk zincir takibini öğrendim, mentörümün notunu bekliyorum.'));
  } else {
    me.note(`no task-kind card of mine in the stream yet (expected — no submission has been approved for anyone at this point). Stream kinds present: ${JSON.stringify((stream || []).map((p) => p.kind))}.`);
  }

  await me.attempt('read notifications', () => me.listNotifications());
  await me.attempt('read unread message count', () => me.unreadMessageCount());
  await me.attempt('sync growth awards', () => me.syncMyGrowthAwards());

  state.merge((st) => { Object.assign(st.students[P.slug], { days, submissions, conversations }); });
  me.note('Faz 4 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
