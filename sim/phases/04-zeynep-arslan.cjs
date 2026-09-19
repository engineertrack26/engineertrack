// Phase 4 — Zeynep's week. Adapted from sim/phases/04-elif-kaya.cjs (the
// template); differences are her character (Step 2 of the brief): terse
// one-line journals, three task submissions probing evidence (none /
// photo-only / photo+document) all self-level 2, sharing turned off right
// after the photo-only submission, and no messages at all.
const { Actor, daysAgoIso, todayIso, parseCode } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('zeynep-arslan');
const WEEKDAY = (iso) => { const d = new Date(iso + 'T12:00:00'); return d.getDay() >= 1 && d.getDay() <= 5; };
// Terse: one short sentence per field, no elaboration.
const JOURNAL = {
  experience: ['Hava kalitesi istasyonunda PM10 verisini kontrol ettim.', 'Şikayet dosyalarını inceledim.', 'Ölçüm cihazının kalibrasyon kaydına baktım.', 'Saha ziyaretinde baca gazı ölçümüne eşlik ettim.', 'Aylık rapor taslağını hazırladım.', 'İstasyon bakım defterini güncelledim.'],
  learning: ['PM10 limiti yönetmelikte yazıyor.', 'Şikayetler bölgeye göre gruplanıyor.', 'Kalibrasyon süresi geçince veri güvenilmiyor.', 'Baca gazı ölçümü rüzgara duyarlı.', 'Rapor şablonu sabit, veri değişiyor.', 'Bakım defteri imza istiyor.'],
  nextStep: ['Yarın veri girişini bitireceğim.', 'Yarın dosyaları arşivleyeceğim.', 'Yarın cihazı tekrar kontrol edeceğim.', 'Yarın ölçüm sonucunu yazacağım.', 'Yarın raporu mentöre göstereceğim.', 'Yarın defteri teslim edeceğim.'],
};

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  me.note('Signed in (adaptation, as in the template): Zeynep already exists from phase 2, so this script does not sign up again.');
  const s = state.read();
  const mine = s.students[P.slug];
  const days = (mine && mine.days) || [];
  const submissions = (mine && mine.submissions) || [];

  // attendance: open every weekday of the window + today, same pattern as the template.
  const past = [6, 5, 4, 3, 2, 1].map(daysAgoIso).filter(WEEKDAY);
  for (const date of past) {
    if (days.find((d) => d.date === date)) { me.note(`day ${date} already open (resume) — skipping.`); continue; }
    const id = await me.attempt(`open past day ${date} with a reason`, () => me.internshipOpenDay(me.userId, date, 'Günü zamanında kapatamadım, sahadaydım.'));
    if (id) days.push({ date, id });
  }
  if (!days.find((d) => d.date === todayIso())) {
    const todayId = await me.attempt('check in today', () => me.internshipOpenDay(me.userId, todayIso()));
    if (todayId) days.push({ date: todayIso(), id: todayId });
  } else {
    me.note('today already open (resume) — skipping.');
  }

  const week = await me.attempt('read my week', () => me.internshipWeek(me.userId, daysAgoIso(6)));

  // journals: one line per field, submitted every day (terse, not elaborate).
  for (const [i, day] of (week || []).entries()) {
    if (day.log_status === 'submitted') { me.note(`journal ${day.day_date} already submitted (resume) — skipping.`); continue; }
    const form = { experience: JOURNAL.experience[i % 6], learning: JOURNAL.learning[i % 6], nextStep: JOURNAL.nextStep[i % 6], support: 2, reason: '', taskId: null, attachment: null };
    await me.attempt(`save journal draft ${day.day_date}`, () => me.internshipSaveLog(day, form, false));
    const freshWeek = await me.attempt('re-read my week for the fresh version', () => me.internshipWeek(me.userId, daysAgoIso(6)));
    const fresh = (freshWeek || []).find((d) => d.id === day.id); // version bumped by the draft save
    if (fresh) await me.attempt(`submit journal ${day.day_date}`, () => me.internshipSaveLog(fresh, form, true));
  }

  // tasks: three submissions, self level 2 each, probing evidence requirements.
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  const already = (t) => (t.assignment_submissions || []).find((sub) => sub.student_id === me.userId);

  if (tasks && tasks[0]) {
    const t0 = tasks[0];
    const done0 = already(t0);
    if (done0) { me.note(`task "${t0.title}" (no-evidence probe) already has a submission (status ${done0.status}, resume) — skipping.`); if (done0.id) submissions.push({ assignmentId: t0.id, submissionId: done0.id }); }
    else {
      const submissionId = await me.attempt(`submit task "${t0.title}" with no evidence`, () => me.submitAssignment(t0.id,
        'Tamamlandı.', 'Fotoğraf çekemedim, ölçüm sözlüydü.', [], [], 2));
      if (submissionId) {
        submissions.push({ assignmentId: t0.id, submissionId });
        me.bug({ did: 'submit a task with no photo and no document', expected: 'a refusal — the task form says evidence: at least one photo', got: `accepted silently, submission id ${submissionId}`, severity: 'rough' });
      }
    }
  } else {
    me.note('fewer than 1 published assignment — skipped the no-evidence probe.');
  }

  let photoOnlySubmissionId;
  if (tasks && tasks[1]) {
    const t1 = tasks[1];
    const done1 = already(t1);
    if (done1) { me.note(`task "${t1.title}" (photo-only) already has a submission (status ${done1.status}, resume) — skipping.`); if (done1.id) { submissions.push({ assignmentId: t1.id, submissionId: done1.id }); photoOnlySubmissionId = done1.id; } }
    else {
      const photo = await me.attempt('upload a photo', () => me.uploadPhoto(t1.id));
      const submissionId = await me.attempt(`submit task "${t1.title}" with a photo only`, () => me.submitAssignment(t1.id,
        'Fotoğraf ekte.', 'Cihazı doğru kullanmayı öğrendim.', photo ? [{ uri: photo, caption: 'Ölçüm anı' }] : [], [], 2));
      if (submissionId) { submissions.push({ assignmentId: t1.id, submissionId }); photoOnlySubmissionId = submissionId; }
    }
  } else {
    me.note('fewer than 2 published assignments — skipped the photo-only submission.');
  }
  if (photoOnlySubmissionId) {
    const shareResult = await me.attempt(`turn off stream sharing for submission ${photoOnlySubmissionId}`, () => me.setSubmissionSharing(photoOnlySubmissionId, false));
    me.note(`setSubmissionSharing(${photoOnlySubmissionId}, false) → ${JSON.stringify(shareResult)}`);
  } else {
    me.note('no photo-only submission id to turn sharing off on — skipped.');
  }

  if (tasks && tasks[2]) {
    const t2 = tasks[2];
    const done2 = already(t2);
    if (done2) { me.note(`task "${t2.title}" (photo+document) already has a submission (status ${done2.status}, resume) — skipping.`); if (done2.id) submissions.push({ assignmentId: t2.id, submissionId: done2.id }); }
    else {
      const photo = await me.attempt('upload a photo', () => me.uploadPhoto(t2.id));
      const doc = await me.attempt('upload a document', () => me.uploadDocument(t2.id, 'olcum-kaydi.pdf'));
      const submissionId = await me.attempt(`submit task "${t2.title}" with photo and document`, () => me.submitAssignment(t2.id,
        'Fotoğraf ve belge ekte.', 'Belgeleme sırasını öğrendim.',
        photo ? [{ uri: photo, caption: 'Saha fotoğrafı' }] : [], doc ? [{ uri: doc, fileName: 'olcum-kaydi.pdf', fileType: 'application/pdf', fileSize: 600 }] : [], 2));
      if (submissionId) submissions.push({ assignmentId: t2.id, submissionId });
    }
  } else {
    me.note('fewer than 3 published assignments — skipped the photo+document submission.');
  }

  // no messages, per character; still reads notifications.
  await me.attempt('read notifications', () => me.listNotifications());
  await me.attempt('read unread message count', () => me.unreadMessageCount());
  await me.attempt('sync growth awards', () => me.syncMyGrowthAwards());

  state.merge((st) => { Object.assign(st.students[P.slug], { days, submissions, conversations: (mine && mine.conversations) || {} }); });
  me.note('Faz 4 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
