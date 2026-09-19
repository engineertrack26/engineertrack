// Phase 4 — Deniz's week. Adapted from the template, sim/phases/04-elif-kaya.cjs
// (see task-7a-report.md for the real RPC shapes/pitfalls it found).
//
// Character (task-7-brief.md Step 2): absent one day (excused), opens the
// missed day late with a health-report reason, likes but rarely posts.
// This run's specific brief: open all weekdays EXCEPT daysAgoIso(3) + today;
// journal the opened days, submitted; submit THREE tasks with evidence and
// honest levels; AFTER that, open the missed day late with reason
// 'Sağlık raporu, ektedir.' and journal it as an absence (support 0),
// submitted; open a conversation with Elif, block it, try to send (record
// the refusal code / file [wrong] if it succeeds), unblock, send a friendly
// line; like a post in the stream; read notifications.
//
// Adaptations (also logged in-band via me.note()/me.bug()):
//  1. me.signIn, not me.signUp — Deniz's account already exists from phase 2.
//  2. daysAgoIso(3) = 2026-09-16 is already a Wednesday (a weekday), so no
//     "nearest past weekday" substitution is needed — noted, not adjusted.
//  3. block_conversation only inserts a row with blocker_id = the blocker
//     (docs/direct-messages-rpcs.sql); send_message's BLOCKED check reads
//     `blocker_id = v_other` (the OTHER participant), i.e. it blocks messages
//     ARRIVING from whoever you blocked, not your own outgoing messages in
//     a conversation you blocked. So Deniz blocking the conversation and then
//     sending herself is expected, by this code, to SUCCEED rather than raise
//     BLOCKED — handled with a plain try/catch, not expectRefusal, and per
//     this run's own instructions a success here is filed as [wrong].
//  4. Resume safety instead of a --from=<step> flag: internship_open_day is
//     idempotent by design, and the journal/task loops re-check live state
//     (day.log_status, the assignment's own assignment_submissions row for
//     this student) and skip with a me.note() if that piece is already done.
const { Actor, daysAgoIso, todayIso, parseCode } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('deniz-yildirim');
const WEEKDAY = (iso) => { const d = new Date(iso + 'T12:00:00'); return d.getDay() >= 1 && d.getDay() <= 5; };
const JOURNAL = {
  experience: [
    'Ayrıştırma hattında plastik ve kağıt atıkları tür bazında ayırdık; bant hızını gözlemledim.',
    'Metal geri kazanım biriminde manyetik ayırıcının çalışmasını izledim.',
    'Tartım istasyonunda gelen atık partilerinin kayıt işlemlerine yardım ettim.',
    'Balya makinesinde preslenmiş kağıt balyalarının etiketlenmesine katıldım.',
    'Kalite kontrol noktasında yanlış ayrılan malzemeleri tekrar hatta yönlendirdik.',
  ],
  learning: [
    'Bant hızı arttığında yanlış ayrıştırma oranının yükseldiğini gördüm.',
    'Manyetik ayırıcının sadece demirli metalleri çektiğini, alüminyumun elle ayrıldığını öğrendim.',
    'Tartım kaydı olmadan günlük geri kazanım oranının hesaplanamadığını fark ettim.',
    'Balya etiketinde tarih ve ağırlık bilgisinin zorunlu olduğunu öğrendim.',
    'Kalite kontrolün hattın en kritik adımı olduğunu gördüm.',
  ],
};
const ABSENCE_REASON = 'Sağlık raporu, ektedir.';

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  me.note('Signed in (adaptation #1): Deniz already exists from phase 2, so this script does not sign up again.');
  const s = state.read();
  const mine = s.students[P.slug] || {};
  const days = [];
  const submissions = [];

  // attendance: every weekday this window except the excused one (daysAgoIso(3)), plus today
  const missedDate = daysAgoIso(3);
  if (!WEEKDAY(missedDate)) {
    me.note(`daysAgoIso(3) (${missedDate}) fell on a weekend — would have picked the nearest past weekday instead. (Did not occur this run.)`);
  } else {
    me.note(`daysAgoIso(3) is ${missedDate}, already a weekday — the excused/missed day, opened late after the week's tasks below.`);
  }
  const pastWeekdays = [6, 5, 4, 3, 2, 1].map(daysAgoIso).filter(WEEKDAY);
  const openNow = pastWeekdays.filter((d) => d !== missedDate);
  for (const date of openNow) {
    const id = await me.attempt(`open past day ${date} with a reason`, () => me.internshipOpenDay(me.userId, date, 'Kaydı vardiya bitince açabildim, sahadaydım.'));
    if (id) days.push({ date, id });
  }
  const todayId = await me.attempt('check in today', () => me.internshipOpenDay(me.userId, todayIso()));
  if (todayId) days.push({ date: todayIso(), id: todayId });

  // journals: only the days opened so far (NOT the excused day yet); all submitted
  let week = await me.attempt('read my week', () => me.internshipWeek(me.userId, daysAgoIso(6)));
  for (const [i, day] of (week || []).entries()) {
    if (day.day_date === missedDate) continue; // not opened yet — handled after tasks
    if (day.log_status === 'submitted') { me.note(`journal ${day.day_date} already submitted (resume) — skipping.`); continue; }
    const form = { experience: JOURNAL.experience[i % 5], learning: JOURNAL.learning[i % 5], nextStep: 'Yarın kalite kontrol noktasında mentörümle ayrıştırma hatalarını gözden geçireceğim.', support: i < 2 ? 1 : 2, reason: '', taskId: null, attachment: null };
    await me.attempt(`save journal draft ${day.day_date}`, () => me.internshipSaveLog(day, form, false));
    const freshWeek = await me.attempt('re-read my week for the fresh version', () => me.internshipWeek(me.userId, daysAgoIso(6)));
    const fresh = (freshWeek || []).find((d) => d.id === day.id); // version bumped by the draft save
    if (fresh) await me.attempt(`submit journal ${day.day_date}`, () => me.internshipSaveLog(fresh, form, true));
  }

  // tasks: THREE submissions with evidence and honest self levels
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  const notes = ['pazartesi', 'salı', 'çarşamba'];
  for (const [i, task] of (tasks || []).slice(0, 3).entries()) {
    const already = (task.assignment_submissions || []).find((sub) => sub.student_id === me.userId);
    if (already) { me.note(`task "${task.title}" already has a submission (status ${already.status}, resume) — skipping.`); if (already.id) submissions.push({ assignmentId: task.id, submissionId: already.id }); continue; }
    const photo = await me.attempt('upload a photo', () => me.uploadPhoto(task.id));
    const doc = await me.attempt('upload a document', () => me.uploadDocument(task.id, 'ayristirma-kayit.pdf'));
    const submissionId = await me.attempt(`submit task "${task.title}"`, () => me.submitAssignment(task.id,
      `Görevi ${notes[i] || 'bu hafta'} tamamladım; hat kaydı ve saha fotoğrafı ekte.`,
      'Bu görevde en çok yanlış ayrıştırmanın geri kazanım oranını nasıl düşürdüğünü anladım.',
      photo ? [{ uri: photo, caption: 'Ayrıştırma hattı fotoğrafı' }] : [], doc ? [{ uri: doc, fileName: 'ayristirma-kayit.pdf', fileType: 'application/pdf', fileSize: 550 }] : [], i === 0 ? 1 : 2));
    if (submissionId) submissions.push({ assignmentId: task.id, submissionId });
  }

  // AFTER the tasks: open the excused day late, journal it as an absence
  const lateId = await me.attempt(`open missed day ${missedDate} late (health report)`, () => me.internshipOpenDay(me.userId, missedDate, ABSENCE_REASON));
  if (lateId) {
    days.push({ date: missedDate, id: lateId });
    const weekAfterOpen = await me.attempt('re-read my week for the late-opened day', () => me.internshipWeek(me.userId, daysAgoIso(6)));
    const missedDay = (weekAfterOpen || []).find((d) => d.id === lateId);
    if (missedDay) {
      if (missedDay.log_status === 'submitted') {
        me.note(`journal for the excused day ${missedDate} already submitted (resume) — skipping.`);
      } else {
        const absentForm = { experience: 'Sağlık raporu nedeniyle bugün tesiste değildim, ayrıştırma hattına çıkamadım.', learning: 'Rapor sürecini ve devamsızlık bildirimini mentörüme nasıl ileteceğimi öğrendim.', nextStep: 'Yarın hatta kaldığım yerden ayrıştırma kontrolüne devam edeceğim.', support: 0, reason: '', taskId: null, attachment: null };
        await me.attempt(`save journal draft ${missedDate} (absence)`, () => me.internshipSaveLog(missedDay, absentForm, false));
        const weekAfterDraft = await me.attempt('re-read my week for the fresh version', () => me.internshipWeek(me.userId, daysAgoIso(6)));
        const freshMissed = (weekAfterDraft || []).find((d) => d.id === lateId);
        if (freshMissed) await me.attempt(`submit journal ${missedDate} (absence)`, () => me.internshipSaveLog(freshMissed, absentForm, true));
      }
    } else {
      me.bug({ did: `re-read week after opening the excused day ${missedDate}`, expected: `a row for ${missedDate} with id ${lateId}`, got: 'not found in internship_week', severity: 'wrong' });
    }
  }

  // messages: open a conversation with Elif, block it, try to send, unblock, send a friendly line
  const elifId = s.students['elif-kaya'] && s.students['elif-kaya'].userId;
  let classmate;
  if (elifId) {
    classmate = await me.attempt('open a conversation with Elif', () => me.openConversation(s.groupId, elifId));
    if (classmate) {
      await me.attempt('block the conversation with Elif', () => me.blockConversation(classmate, true));
      try {
        const r = await me.sendMessage(classmate, 'Elif, bir şey soracaktım.');
        me.log({ name: 'send_message (while self-blocked)', args: { conversationId: classmate }, ok: true, result: r });
        me.bug({ did: 'send a message in a conversation I just blocked myself', expected: 'refusal BLOCKED (or another stable refusal code)', got: `success ${JSON.stringify(r)} — block_conversation only records blocker_id=me, and send_message's BLOCKED check tests blocker_id=the OTHER participant, so blocking myself does not stop my own outgoing messages`, code: 'NONE', severity: 'wrong' });
      } catch (e) {
        const { code } = parseCode(e);
        if (code === 'BLOCKED') me.note('expected refusal BLOCKED for: send a message in a conversation I just blocked myself');
        else me.note(`send while self-blocked was refused with code ${code} (not the brief's guessed BLOCKED) — a different stable code, treated as the expected refusal per the brief, not filed.`);
      }
      await me.attempt('unblock the conversation with Elif', () => me.blockConversation(classmate, false));
      await me.attempt('message Elif (friendly, after unblocking)', () => me.sendMessage(classmate, 'Elif, merhaba! Bu hafta ayrıştırma hattında yoğundum, geç yazdım kusura bakma. Görevlerin nasıl gidiyor?'));
    }
  } else {
    me.bug({ did: 'find Elif in state to open a conversation', expected: 'state.students["elif-kaya"].userId present', got: JSON.stringify(s.students['elif-kaya']), severity: 'wrong' });
  }

  // stream: like a post
  const posts = await me.attempt('read the stream', () => me.listFeedPosts(s.groupId));
  const unliked = (posts || []).find((p) => !p.likedByMe);
  if (unliked) await me.attempt(`like a post in the stream (${unliked.kind})`, () => me.likePost(unliked.id));
  else if (posts) me.note('every post in the stream is already liked by me (resume) — nothing new to like.');

  await me.attempt('read notifications', () => me.listNotifications());
  await me.attempt('read unread message count', () => me.unreadMessageCount());
  await me.attempt('sync growth awards', () => me.syncMyGrowthAwards());

  state.merge((st) => { Object.assign(st.students[P.slug], { days, submissions, conversations: { ...(mine.conversations || {}), classmate } }); });
  me.note('Faz 4 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
