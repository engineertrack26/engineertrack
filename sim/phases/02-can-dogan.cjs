// Phase 2 — Can Doğan joins. Adapted from sim/phases/02-elif-kaya.cjs (the
// template) per the brief's Step 3 for Can: "Questioning" — comments on
// EVERY post in the stream (task cards included) with a different Turkish
// question each; reads listMessageContacts(groupId) and notes who is
// listed (advisor must be there, already-joined classmates must be there,
// his mentor cannot be yet — none linked); votes in the poll; otherwise
// does what the template does.
//
// Adaptations carried over from the template (see 02-elif-kaya.cjs for the
// full explanation):
//  1. --resume flag: sign-in instead of sign-up on a crash-recovery rerun.
//  2. validate_group_code / join_group_by_code return an ARRAY of rows
//     ({id, name, term, advisor_name} — the GROUP's id, no membershipId
//     field). The real membership id is read back from group_memberships.
//  3. get_my_student_code is also RETURNS TABLE — an array, [] when none.
const { Actor, daysAgoIso, todayIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('can-dogan');
const RESUME = process.argv.includes('--resume');

// A different, in-character (questioning environmental-engineering intern)
// Turkish question per post kind / competency, so every post in the stream
// gets its own comment rather than a repeated line.
function questionFor(post) {
  if (post.kind === 'announcement') {
    return 'Bu duyurudaki son tarih tüm grup için mi geçerli, yoksa sadece katılmak isteyenler için mi?';
  }
  if (post.kind === 'poll') {
    return 'Anket ne zaman kapanacak ve sonuç duyuru olarak mı paylaşılacak, yoksa sadece oturuma katılanlar mı öğrenecek?';
  }
  if (post.kind === 'assignment') {
    const c = post.assignment && post.assignment.competencyName;
    const byCompetency = {
      'Engineering Problem Solving': 'İş akışı şemasını laboratuvardaki gerçek bir arıza örneğiyle mi çizmeliyim, yoksa örnek/varsayımsal bir senaryo yeterli mi?',
      'Technical Documentation': 'Ölçüm kayıtlarını hangi dijital formatta tutmamız bekleniyor — birim ve referans koşullarını da ayrı alanlara mı yazmalıyım?',
      'Professional Communication': 'Bu görev handoff mesajını gruptaki bir arkadaşıma mı göndermeliyim, mentörüm henüz atanmadığı için ona mı yoksa danışmana mı yazsam?',
      'Digital Tool Proficiency': 'Stand-up özetini uygulama içindeki hangi ekrandan paylaşacağız, ekran görüntüsü de eklemeli miyim?',
      'Responsibility & Ethics': 'SOP\'u takip ederken her adımı ayrı ayrı mı EngineerTrack\'e loglamalıyım, yoksa tamamlanınca tek özet mi yeterli?',
      'Collaboration & Teamwork': 'Ekibin ortak klasörüne yüklerken bir dosya adlandırma kuralımız var mı, ekran görüntüsünü uygulamaya ayrıca mı eklemem gerekiyor?',
    };
    return (c && byCompetency[c]) || `"${post.assignment && post.assignment.title}" görevinin kriteri tam olarak neyi kanıtlamamı istiyor, biraz açar mısınız?`;
  }
  if (post.kind === 'task') {
    return 'Bu onaylanmış görev için mentörden gelen notu da akışta görebilir miyiz, yoksa o özel mi kalıyor?';
  }
  return 'Bununla ilgili biraz daha bilgi verebilir misiniz?';
}

(async () => {
  const me = new Actor(P);
  const s = state.read();
  if (RESUME) {
    await me.signIn(P.email, P.password);
    me.note('Resumed with sign-in (--resume): a previous run crashed mid-way.');
  } else {
    await me.signUp({ email: P.email, password: P.password, firstName: P.firstName, lastName: P.lastName, role: 'student', avatarId: P.avatar });
  }
  writeAccount({ role: 'student', name: P.name, email: P.email, password: P.password, company: P.company, character: P.character, avatar: P.avatar, groupCode: s.joinCode });
  await me.attempt('confirm the avatar from the profile', () => me.rpc('my_student_avatar'));

  // internship form (the app forces this before anything else)
  await me.attempt('fill the internship form', () => me.upsertStudentProfile({
    university: 'Ankara Üniversitesi', faculty: 'Mühendislik Fakültesi', department: 'Çevre Mühendisliği', department_branch: '',
    student_id: '21045678', company_name: P.company, company_address: 'Yenimahalle, Ankara', company_sector: 'Su kalitesi ve laboratuvar analizleri',
    internship_start_date: daysAgoIso(6), internship_end_date: todayIso() }));

  // join by code
  const check = await me.attempt('validate the group code', () => me.validateGroupCode(s.joinCode));
  me.note(`validate_group_code → ${JSON.stringify(check)} (array — RETURNS TABLE)`);
  const joined = await me.attempt('join the group', () => me.joinGroupByCode(s.joinCode));
  me.note(`join_group_by_code → ${JSON.stringify(joined)} (array; row is {id, name, term, advisor_name} — the GROUP's id, no membershipId field)`);
  await me.expectRefusal('INVALID_CODE', 'join with a wrong code', () => me.joinGroupByCode('ZZZZZZ'));

  // the RPC does not return a membership id; read it back directly
  const myMembership = await me.attempt('read my own membership row', () =>
    me.table('group_memberships', 'select-own', (q) => q.select('id, joined_at').eq('student_id', me.userId).eq('group_id', s.groupId).is('left_at', null).maybeSingle()));
  const membershipId = myMembership && myMembership.id;
  if (!membershipId) me.bug({ did: 'read my own membership row after joining', expected: 'one active row', got: JSON.stringify(myMembership), severity: 'wrong' });

  // student code for the mentor
  let code = await me.attempt('read my student code', () => me.getMyStudentCode());
  me.note(`get_my_student_code → ${JSON.stringify(code)} (array; empty when no code exists yet)`);
  code = Array.isArray(code) ? code[0] : code;
  if (!code) { const created = await me.attempt('create a student code', () => me.createStudentCode()); code = created; }
  const studentCode = code && (code.code || code.student_code);
  if (!studentCode) me.bug({ did: 'obtain a student code', expected: 'a 6-char code', got: JSON.stringify(code), severity: 'blocker' });
  writeAccount({ role: 'student', name: P.name, email: P.email, password: P.password, company: P.company, character: P.character, avatar: P.avatar, groupCode: s.joinCode, studentCode });

  // stream: read, then — in character — comment a distinct question on EVERY post
  const feed = await me.attempt('read the stream', () => me.listFeedPosts(s.groupId));
  const kinds = (feed || []).map((p) => p.kind).sort();
  me.note(`Akışta ${kinds.length} gönderi: ${kinds.join(', ')} (6 görev kartı + duyuru + anket beklenir)`);

  for (const post of feed || []) {
    const body = questionFor(post);
    await me.attempt(`comment on post ${post.id} (${post.kind})`, () => me.addComment(post.id, body));
  }
  me.note(`${(feed || []).length} gönderinin hepsine ayrı bir soru yorumu bırakıldı.`);

  if (s.posts.pollId && s.posts.pollOptionIds[0]) await me.attempt('vote in the poll', () => me.voteFeedPoll(s.posts.pollId, s.posts.pollOptionIds[0]));
  await me.attempt('like the announcement', () => me.likePost(s.posts.announcementId));

  // Contacts check: advisor must be listed, classmates who already joined
  // must be listed, my mentor cannot be (no mentor linked to anyone yet).
  const members = await me.attempt('list the group\'s active memberships (ground truth for the contacts check)', () => me.groupMembers(s.groupId));
  const contacts = await me.attempt('read my message contacts', () => me.listMessageContacts(s.groupId));
  me.note(`list_message_contacts → ${JSON.stringify(contacts)}`);
  const contactIds = new Set((contacts || []).map((c) => c.id));
  const contactRoles = (contacts || []).map((c) => `${c.name} (${c.role})`).join(', ') || 'yok';
  me.note(`Mesaj kişileri: ${contactRoles}.`);

  if (!contactIds.has(s.advisorId)) {
    me.bug({ did: 'find the advisor (Selin Aydın) in list_message_contacts', expected: 'advisor present', got: JSON.stringify(contacts), severity: 'wrong' });
  } else {
    me.note('Danışman mesaj kişilerinde mevcut (beklenen).');
  }

  if (members === undefined) {
    me.note('Sınıf arkadaşı kontrolü yapılamadı: group_memberships okunamadı (araç seti hatası, düzeltildi).');
  } else {
    const memberIds = (members || []).map((m) => m.student_id).filter((id) => id && id !== me.userId);
    const missingClassmates = memberIds.filter((id) => !contactIds.has(id));
    if (missingClassmates.length) {
      me.bug({ did: 'find already-joined classmates in list_message_contacts', expected: `all active co-members present (${JSON.stringify(memberIds)})`, got: JSON.stringify(contacts), severity: 'wrong' });
    } else {
      me.note(`Gruba şu ana kadar katılmış ${memberIds.length} sınıf arkadaşımın hepsi mesaj kişilerinde mevcut (beklenen).`);
    }
  }

  const mentorContacts = (contacts || []).filter((c) => c.role === 'mentor');
  if (mentorContacts.length) {
    me.bug({ did: 'check no mentor appears in list_message_contacts yet (none linked)', expected: 'no mentor contact', got: JSON.stringify(mentorContacts), severity: 'wrong' });
  } else {
    me.note('Mentörüm henüz bağlanmadığı için mesaj kişilerinde görünmüyor (beklenen).');
  }

  await me.attempt('read my notifications', () => me.listNotifications());
  await me.attempt('read my progress (should be all zero)', () => me.getCompetencyProgress(me.userId));

  state.merge((st) => { st.students = st.students || {}; st.students[P.slug] = { userId: me.userId, studentCode, membershipId }; });
  me.note('Faz 2 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
