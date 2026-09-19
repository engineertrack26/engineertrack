// Phase 4 — Ayşe's week. Adapted from sim/phases/04-elif-kaya.cjs (the template).
//
// Character (task-7-brief.md, Step 2 — Ayşe): quiet. Opens all weekdays + today;
// journals every day with support 1–2, submitted; submits FOUR tasks with photo +
// document evidence and honest self levels (1–2); leaves the OTHER TWO published
// tasks completely untouched — no submission, no refusal probes either, since a
// later phase needs one of her tasks left unsubmitted. Sends no messages, comments
// nothing, likes nothing. Reads the leaderboard (getMyGroupLeaderboard(10)) and
// notes her position. Reads notifications.
//
// Adaptations (also logged in-band via me.note()):
//  1. me.signIn, not me.signUp — Ayşe's account already exists from phase 2.
//  2. "open today twice" handled like the template: internship_open_day is
//     idempotent by design for a repeat call on the same (student, date) pair —
//     success with the SAME id, not a refusal. Not run through expectRefusal.
//  3. No REFLECTION_REQUIRED / SELF_LEVEL_REQUIRED probes on a 5th task, unlike
//     Elif's script — Ayşe must leave both remaining published tasks untouched
//     for a later phase, so no submit_assignment call is made against them at all.
//  4. No message/feed interaction of any kind (no listMessageContacts,
//     openConversation, sendMessage, likePost, addComment) — consistent with her
//     "quiet" character; the template's messaging block is dropped entirely.
//  5. Resume safety instead of a --from=<step> flag: each loop re-checks live
//     state (day.log_status, the assignment's own assignment_submissions row for
//     this student) and skips with a me.note() if that piece is already done —
//     safe to rerun the whole script after a crash.
const { Actor, daysAgoIso, todayIso, parseCode } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('ayse-celik');
const WEEKDAY = (iso) => { const d = new Date(iso + 'T12:00:00'); return d.getDay() >= 1 && d.getDay() <= 5; };
const JOURNAL = {
  experience: [
    'Deşarj öncesi ve sonrası noktalarda pH ve iletkenlik ölçümü aldık; taşınabilir cihazı ilk kez ben kalibre ettim.',
    'Gürültü ölçüm noktalarında sabah ve öğle turlarını tamamladık, tutanağı doldurdum.',
    'ÇED sahasında toz numunesi için örnekleme pompasını kurduk, akış hızını kaydettim.',
    'Yüzeysel su örneklemesinde şahit numune alma prosedürünü mentorumla birlikte uyguladım.',
    'Emisyon ölçüm raporunun saha eki için fotoğraf ve koordinat kaydını hazırladım.',
    'Hafta sonu bakım öncesi kalibrasyon kayıtlarını dosyaladım, cihaz seri numaralarını kontrol ettim.',
  ],
  learning: [
    'Kalibrasyonun her ölçüm öncesi neden tekrarlandığını, referans çözeltinin bozulma süresini öğrendim.',
    'Gürültü ölçümünde rüzgar hızının 5 m/s üstünde geçersiz sayıldığını gördüm.',
    'Örnekleme pompasının debisi sabit tutulmazsa toz konsantrasyonu hesabının hatalı çıktığını fark ettim.',
    'Şahit numunenin neden aynı gün aynı laboratuvara teslim edilmesi gerektiğini anladım.',
    'Saha fotoğrafında koordinat ve saat damgası olmadan raporun geçersiz sayılabildiğini öğrendim.',
    'Cihaz kalibrasyon kaydının seri numarasıyla eşleşmemesi durumunda ölçümün itiraz konusu olabileceğini öğrendim.',
  ],
};

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  me.note('Signed in (adaptation #1): Ayşe already exists from phase 2, so this script does not sign up again.');
  const s = state.read();
  const mine = s.students[P.slug];
  const days = [];
  const submissions = [];

  // attendance: open all weekdays in the window + today, a real check-in
  const past = [6, 5, 4, 3, 2, 1].map(daysAgoIso).filter(WEEKDAY);
  for (const date of past) {
    const id = await me.attempt(`open past day ${date} with a reason`, () => me.internshipOpenDay(me.userId, date, 'Kaydı akşam sahadan döndükten sonra açtım.'));
    if (id) days.push({ date, id });
  }
  const todayId = await me.attempt('check in today', () => me.internshipOpenDay(me.userId, todayIso()));
  if (todayId) days.push({ date: todayIso(), id: todayId });

  // "open today twice" (adaptation #2): success with the same id, not a refusal.
  try {
    const secondId = await me.internshipOpenDay(me.userId, todayIso());
    if (secondId === todayId) {
      me.note(`open today a second time succeeded and returned the SAME internship_days id (${secondId}) as the first check-in — idempotent by design (docs/internship-days-migration.sql). Not a duplicate day (no new row), so not filed as a bug, per the template's precedent in phase 4 (Elif).`);
    } else {
      me.bug({ did: 'open today twice', expected: 'a refusal, or the same day id back if idempotent by design', got: `success with a DIFFERENT id (${secondId} vs first id ${todayId}) — a genuine duplicate day`, severity: 'wrong' });
    }
  } catch (e) {
    const { code } = parseCode(e);
    if (code === 'ID_EXISTS') me.note('expected refusal ID_EXISTS for: open today twice');
    else me.note(`open today twice was refused with code ${code} (not the guessed ID_EXISTS) — a different stable code, treated as the expected refusal, not filed.`);
  }

  const week = await me.attempt('read my week', () => me.internshipWeek(me.userId, daysAgoIso(6)));

  // journals: every day, support 1–2, all submitted
  for (const [i, day] of (week || []).entries()) {
    if (day.log_status === 'submitted') { me.note(`journal ${day.day_date} already submitted (resume) — skipping.`); continue; }
    const form = { experience: JOURNAL.experience[i % 6], learning: JOURNAL.learning[i % 6], nextStep: 'Yarın ölçüm defterindeki eksik alanları mentorumla tamamlayacağım.', support: i < 3 ? 1 : 2, reason: '', taskId: null, attachment: null };
    await me.attempt(`save journal draft ${day.day_date}`, () => me.internshipSaveLog(day, form, false));
    const freshWeek = await me.attempt('re-read my week for the fresh version', () => me.internshipWeek(me.userId, daysAgoIso(6)));
    const fresh = (freshWeek || []).find((d) => d.id === day.id); // version bumped by the draft save
    if (fresh) await me.attempt(`submit journal ${day.day_date}`, () => me.internshipSaveLog(fresh, form, true));
  }

  // tasks: FOUR submissions with photo + document evidence, honest self levels 1–2;
  // the remaining published tasks are left completely untouched (adaptation #3).
  const tasks = await me.attempt('read my tasks', () => me.listMyAssignments());
  const NOTES = [
    'Görevi pazartesi tamamladım; kalibrasyon tutanağı ve saha fotoğrafı ekte.',
    'Görevi salı-çarşamba günlerinde bitirdim; ölçüm tablosunu ve pompa akış kaydını ekledim.',
    'Görevi perşembe tamamladım; şahit numune formunu ve saha fotoğrafını ekledim.',
    'Görevi cuma tamamladım; emisyon ölçüm raporunun saha ekini ve fotoğrafı ekledim.',
  ];
  const REFLECTIONS = [
    'Bu görevde en çok kalibrasyonun neden her ölçümden önce tekrarlandığını anladım; kendi başıma yapmam için mentorumun onayına hâlâ ihtiyacım var.',
    'Debi sabitlenmezse sonucun nasıl saptığını gördüm; adımları biliyorum ama hızımı artırmam gerekiyor.',
    'Şahit numune prosedürünü mentorumla birlikte uyguladım; tek başıma yapabileceğimden emin değilim.',
    'Saha ekini hazırlarken koordinat ve saat damgasının önemini kavradım; rehberlikle rahat çalışıyorum.',
  ];
  for (const [i, task] of (tasks || []).slice(0, 4).entries()) {
    const already = (task.assignment_submissions || []).find((sub) => sub.student_id === me.userId);
    if (already) { me.note(`task "${task.title}" already has a submission (status ${already.status}, resume) — skipping.`); if (already.id) submissions.push({ assignmentId: task.id, submissionId: already.id }); continue; }
    const photo = await me.attempt('upload a photo', () => me.uploadPhoto(task.id));
    const doc = await me.attempt('upload a document', () => me.uploadDocument(task.id, 'olcum-tutanagi.pdf'));
    const submissionId = await me.attempt(`submit task "${task.title}"`, () => me.submitAssignment(task.id,
      NOTES[i], REFLECTIONS[i],
      photo ? [{ uri: photo, caption: 'Saha ölçüm fotoğrafı' }] : [], doc ? [{ uri: doc, fileName: 'olcum-tutanagi.pdf', fileType: 'application/pdf', fileSize: 600 }] : [], i < 1 ? 1 : 2));
    if (submissionId) submissions.push({ assignmentId: task.id, submissionId });
  }
  const untouchedCount = Math.max(0, (tasks || []).length - 4);
  me.note(`${untouchedCount} published task(s) left completely untouched (no submission attempt, no refusal probe) — a later phase needs at least one unsubmitted task of Ayşe's.`);

  // leaderboard: read it, note her own position
  const leaderboard = await me.attempt('read my group leaderboard', () => me.getMyGroupLeaderboard(10));
  if (leaderboard) {
    const idx = leaderboard.findIndex((row) => row.student_id === me.userId || row.id === me.userId || row.user_id === me.userId);
    if (idx === -1) me.note(`leaderboard read (${leaderboard.length} rows) but Ayşe's own row was not found by student_id/id/user_id — shape: ${JSON.stringify(leaderboard[0] || {})}`);
    else me.note(`leaderboard read (${leaderboard.length} rows) — Ayşe is at position ${idx + 1} of ${leaderboard.length}: ${JSON.stringify(leaderboard[idx])}`);
  }

  // notifications: read only, no messages, no comments, no likes (quiet character)
  await me.attempt('read notifications', () => me.listNotifications());
  await me.attempt('read unread message count', () => me.unreadMessageCount());
  await me.attempt('sync growth awards', () => me.syncMyGrowthAwards());

  state.merge((st) => { Object.assign(st.students[P.slug], { days, submissions, conversations: {} }); });
  me.note('Faz 4 bitti. Sessiz karakter: mesaj yok, yorum yok, beğeni yok.');
})().catch((e) => { console.error(e); process.exit(1); });
