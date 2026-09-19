// Phase 4 — Mert's week. Adapted from sim/phases/04-elif-kaya.cjs (the
// template that already ran successfully for Elif).
//
// Character (task-7-brief.md, Step 2): over-confident. Opens all weekdays +
// today; journals every day with support: 3 ("bağımsız" / independent) in a
// confident tone, submitted; submits FOUR tasks with photo + document
// evidence and selfLevel: 3 on every one, confident notes; messages nobody;
// reads the stream and notes whether any task card of his own exists yet
// (it should not — nothing is approved yet) and whether he could like it if
// it did (skipped — there is none); reads notifications and his own
// competency progress.
//
// Adaptations from the template (logged in-band via me.note() below too):
//  1. me.signIn, not me.signUp — Mert's account already exists from phase 2
//     (sim/log/mert-yilmaz.md shows the sign-up, join and phase-2 feed read).
//  2. No duplicate-open-day probe and no REFLECTION_REQUIRED /
//     SELF_LEVEL_REQUIRED probes — task-7-brief.md's Step 2 line for Mert
//     does not call for either; his four submissions are all confident,
//     complete ones, so there is no fifth "spare" assignment to probe with.
//  3. No messaging block at all (not even reading contacts) — "messages
//     nobody" is explicit; unlike Elif's template there is nothing to open.
//  4. Resume safety via live-state checks (day.log_status, this student's
//     own assignment_submissions row), same as the template, instead of a
//     --from=<step> flag — internship_open_day is idempotent by design and
//     submit_assignment is safe to repeat pre-approval.
const { Actor, daysAgoIso, todayIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('mert-yilmaz');
const WEEKDAY = (iso) => { const d = new Date(iso + 'T12:00:00'); return d.getDay() >= 1 && d.getDay() <= 5; };

// Confident, first-person, landfill-site (Düzenli Depolama Sahası) content.
// Support is always 3 ("bağımsız") — Mert never asks for help.
const JOURNAL = {
  experience: [
    'Depolama sahasında günlük atık tartımını tek başıma yönettim, tartı raporlarını ben kontrol ettim.',
    'Sızıntı suyu toplama havuzunda seviye ölçümünü hızlıca bitirdim, kimseyi beklemedim.',
    'Gaz toplama bacalarının basınç kontrolünü hiç yardım almadan yaptım ve raporladım.',
    'Kompaktör operatörüyle sahada atık sıkıştırma verimini değerlendirdim, önerilerimi doğrudan ilettim.',
    'Depo örtü toprağı uygulamasını baştan sona ben denetledim.',
    'Haftalık saha raporunu tamamen kendi başıma hazırladım.',
  ],
  learning: [
    'Tartı fişlerinin neden çift kopya tutulduğunu zaten tahmin etmiştim, doğrulanmış oldu.',
    'Sızıntı suyu seviyesinin yağışla ilişkisini hemen kavradım, hesabı kendim yaptım.',
    'Gaz basıncı limitlerini bir seferde öğrendim, ikinci kez sormama gerek kalmadı.',
    'Sıkıştırma oranını kendi yöntemimle daha hızlı hesaplayabileceğimi gördüm.',
    'Örtü toprağı kalınlığı standardını zaten biliyordum, sahada teyit ettim.',
    'Raporlama şablonunu geliştirebilirim; mentoruma önereceğim.',
  ],
};
const TASK_NOTE = (i) => `Görevi ${['pazartesi', 'salı', 'çarşamba', 'perşembe'][i]} tek başıma, yardım almadan tamamladım; ölçüm tablosu ve saha fotoğrafı ekte.`;
const TASK_REFLECTION = ['Bu görevi ilk denemede doğru yaptım, ekstra açıklamaya gerek yok.', 'Kriterleri baştan biliyordum, sorunsuz tamamladım.', 'Zaten bildiğim bir konuydu, hızlıca bitirdim.', 'Herhangi bir zorlukla karşılaşmadım, bağımsız çalıştım.'];

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  me.note('Signed in (adaptation #1): Mert already exists from phase 2, so this script does not sign up again.');
  const s = state.read();
  const mine = s.students[P.slug];
  const days = [];
  const submissions = [];

  // attendance: open every weekday of the window plus today, all as a
  // confident, no-drama check-in.
  const past = [6, 5, 4, 3, 2, 1].map(daysAgoIso).filter(WEEKDAY);
  for (const date of past) {
    const id = await me.attempt(`open past day ${date} with a reason`, () => me.internshipOpenDay(me.userId, date, 'O gün sahadaydım, kaydı hemen açamadım ama işi hallettim.'));
    if (id) days.push({ date, id });
  }
  const todayId = await me.attempt('check in today', () => me.internshipOpenDay(me.userId, todayIso()));
  if (todayId) days.push({ date: todayIso(), id: todayId });

  const week = await me.attempt('read my week', () => me.internshipWeek(me.userId, daysAgoIso(6)));

  // journals: every day, support 3 (independent), confident tone, submitted.
  for (const [i, day] of (week || []).entries()) {
    if (day.log_status === 'submitted') { me.note(`journal ${day.day_date} already submitted (resume) — skipping.`); continue; }
    const form = { experience: JOURNAL.experience[i % 6], learning: JOURNAL.learning[i % 6], nextStep: 'Yarın sahadaki ölçümleri yine kendi başıma tamamlayacağım.', support: 3, reason: '', taskId: null, attachment: null };
    await me.attempt(`save journal draft ${day.day_date}`, () => me.internshipSaveLog(day, form, false));
    const freshWeek = await me.attempt('re-read my week for the fresh version', () => me.internshipWeek(me.userId, daysAgoIso(6)));
    const fresh = (freshWeek || []).find((d) => d.id === day.id); // version bumped by the draft save
    if (fresh) await me.attempt(`submit journal ${day.day_date}`, () => me.internshipSaveLog(fresh, form, true));
  }

  // tasks: four submissions, photo + document evidence, selfLevel 3 (independent)
  // on every one, confident notes — Mert rates himself top level regardless.
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  for (const [i, task] of (tasks || []).slice(0, 4).entries()) {
    const already = (task.assignment_submissions || []).find((sub) => sub.student_id === me.userId);
    if (already) { me.note(`task "${task.title}" already has a submission (status ${already.status}, resume) — skipping.`); if (already.id) submissions.push({ assignmentId: task.id, submissionId: already.id }); continue; }
    const photo = await me.attempt('upload a photo', () => me.uploadPhoto(task.id));
    const doc = await me.attempt('upload a document', () => me.uploadDocument(task.id, 'olcum-tablosu.pdf'));
    const submissionId = await me.attempt(`submit task "${task.title}"`, () => me.submitAssignment(task.id,
      TASK_NOTE(i), TASK_REFLECTION[i % TASK_REFLECTION.length],
      photo ? [{ uri: photo, caption: 'Saha fotoğrafı' }] : [], doc ? [{ uri: doc, fileName: 'olcum-tablosu.pdf', fileType: 'application/pdf', fileSize: 600 }] : [], 3));
    if (submissionId) submissions.push({ assignmentId: task.id, submissionId });
  }

  // messages: none — Mert messages nobody this week.
  me.note('Mesajlaşma: kimseye mesaj yok (karakter gereği) — mesaj kutusuna hiç girilmedi.');

  // stream: read it and check whether a task card of his own already exists
  // (it should not — nothing of his is approved yet).
  const feed = await me.attempt('read the stream', () => me.listFeedPosts(s.groupId));
  if (feed) {
    const myTaskCards = feed.filter((p) => p.kind === 'task' && p.authorId === me.userId);
    if (myTaskCards.length === 0) {
      me.note(`Akışta ${feed.length} gönderi var (kind sayımı: ${JSON.stringify(feed.reduce((acc, p) => { acc[p.kind] = (acc[p.kind] || 0) + 1; return acc; }, {}))}) ama kendi task kartım yok — beklenen: hiçbir gönderim henüz onaylanmadı. Beğenecek kendi kartım olmadığı için "kendi kartımı beğenme" adımı atlandı.`);
    } else {
      me.bug({ did: 'check for my own task card in the stream before any approval', expected: 'no task-kind post authored by me (nothing of mine is approved yet)', got: `found ${myTaskCards.length} task post(s) authored by me: ${JSON.stringify(myTaskCards.map((p) => p.id))}`, severity: 'wrong' });
      for (const card of myTaskCards) await me.attempt(`like my own task card ${card.id}`, () => me.likePost(card.id));
    }
  }

  // notifications and my own progress
  await me.attempt('read notifications', () => me.listNotifications());
  await me.attempt('read unread message count', () => me.unreadMessageCount());
  await me.attempt('read my competency progress', () => me.getCompetencyProgress(me.userId));
  await me.attempt('read my internship totals', () => me.internshipTotals(me.userId));
  await me.attempt('sync growth awards', () => me.syncMyGrowthAwards());

  state.merge((st) => { Object.assign(st.students[P.slug], { days, submissions, conversations: {} }); });
  me.note('Faz 4 bitti. Emin: her şeyi kendi başıma, kusursuz yaptım (support 3, selfLevel 3, dört görev).');
})().catch((e) => { console.error(e); process.exit(1); });
