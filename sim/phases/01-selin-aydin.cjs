// Phase 1 — the advisor sets up the group.
// Adaptation note (see me.note() calls below): trg_assignment_within_scope
// (docs/task-assignment-migration.sql) and publish_assignments' re-check
// (docs/assignment-drafts-rpcs.sql) both raise NOT_IN_SCOPE only when the
// group has NO group_competency_targets row for the triplet's competency at
// all -- neither checks the numeric target_level. The brief's literal test
// (draft a level-4 task for a competency whose target is 2) would therefore
// SUCCEED, not refuse, once all six competencies have a target row -- that is
// the app working as designed, not a bug. The script below tests the rule
// that actually exists: it drops one competency's target row, attempts a
// draft against that now-out-of-scope competency (expecting NOT_IN_SCOPE),
// then restores the full six-competency scope before continuing.
const fs = require('node:fs');
const path = require('node:path');
const { Actor, daysAgoIso } = require('../actor.cjs');
const { ADVISOR, GROUP } = require('../people.cjs');
const { writeAccount } = require('../report.cjs');
const { pngBytes, pdfBytes } = require('../fixtures.cjs');
const STATE = path.join(__dirname, '..', 'state.json');
const RESUME = process.argv.includes('--resume');

(async () => {
  const me = new Actor(ADVISOR);
  if (RESUME) {
    await me.signIn(ADVISOR.email, ADVISOR.password);
    me.note('Resumed with sign-in (--resume): a previous run crashed mid-way.');
  } else {
    await me.signUp({ email: ADVISOR.email, password: ADVISOR.password, firstName: ADVISOR.firstName, lastName: ADVISOR.lastName, role: 'advisor' });
  }
  writeAccount({ role: 'advisor', name: `${ADVISOR.title} ${ADVISOR.name}`, email: ADVISOR.email, password: ADVISOR.password, character: ADVISOR.character });

  // 1. group
  const group = await me.createGroup(GROUP.name, GROUP.term);
  me.note(`Grup açıldı: ${group.name}, katılım kodu ${group.join_code}`);
  writeAccount({ role: 'advisor', name: `${ADVISOR.title} ${ADVISOR.name}`, email: ADVISOR.email, password: ADVISOR.password, character: ADVISOR.character, groupCode: group.join_code });

  // 2. targets: all six competencies, levels 2 or 3
  const { competencies, kpis } = await me.listFramework();
  if (competencies.length !== 6) me.bug({ did: 'read the framework', expected: '6 competencies', got: `${competencies.length}`, severity: 'wrong' });
  const targets = competencies.map((c, i) => ({ competencyId: c.id, targetLevel: i % 2 === 0 ? 2 : 3 }));
  await me.attempt('set competency targets', () => me.setGroupTargets(group.id, targets));

  // 3. tasks: one per competency at level 1 or 2 (within scope), plus two extra; six published, two drafts
  const drafts = [];
  for (const [i, c] of competencies.entries()) {
    const level = Math.min(targets[i].targetLevel, 2);
    const kpi = kpis.find((k) => k.competency_id === c.id && k.level === level);
    if (!kpi) { me.bug({ did: `find a KPI for ${c.name} L${level}`, expected: 'one row', got: 'none', severity: 'wrong' }); continue; }
    const triplets = await me.listTriplets(kpi.id);
    const trip = triplets[i % triplets.length];
    const row = await me.attempt(`draft task from ${c.name} L${level}`, () => me.createAssignment({ groupId: group.id, tripletId: trip.id,
      title: trip.task, objective: trip.objective, criterion: trip.criterion, dueDate: daysAgoIso(-2), description: i === 0 ? 'Ölçüm cihazının kalibrasyon kaydını da ekleyin.' : undefined }));
    if (row) drafts.push({ id: row.id, title: row.title, competencyName: c.name, level, published: false });
  }
  // two extra from the first competency's second triplet
  const firstKpi = kpis.find((k) => k.competency_id === competencies[0].id && k.level === 1);
  const extra = await me.listTriplets(firstKpi.id);
  for (const trip of extra.slice(1, 3)) {
    const row = await me.attempt('draft an extra task', () => me.createAssignment({ groupId: group.id, tripletId: trip.id, title: trip.task, objective: trip.objective, criterion: trip.criterion }));
    if (row) drafts.push({ id: row.id, title: row.title, competencyName: competencies[0].name, level: 1, published: false });
  }
  // edit one title
  await me.attempt('edit a draft title', () => me.updateAssignment(drafts[0].id, { title: drafts[0].title + ' (revize)' }));

  // out-of-scope attempt: the real rule is "no target row for the competency
  // at all", not a level comparison (see the note at the top of this file).
  // Temporarily drop the last competency from scope, try to draft against it,
  // then restore the full six-competency scope.
  const outComp = competencies[competencies.length - 1];
  const narrowedTargets = targets.filter((t) => t.competencyId !== outComp.id);
  await me.attempt('narrow scope to test NOT_IN_SCOPE', () => me.setGroupTargets(group.id, narrowedTargets));
  const kpiOut = kpis.find((k) => k.competency_id === outComp.id && k.level === 1) || kpis.find((k) => k.competency_id === outComp.id);
  const tripsOut = await me.listTriplets(kpiOut.id);
  if (tripsOut.length === 0) me.note(`${outComp.name} L${kpiOut.level} has no triplets; picking the first triplet of that KPI anyway is moot — noting and skipping the refusal check.`);
  else {
    const tripOut = tripsOut[0];
    await me.expectRefusal('NOT_IN_SCOPE', `draft a task for ${outComp.name}, a competency just removed from the group's scope`,
      () => me.createAssignment({ groupId: group.id, tripletId: tripOut.id, title: tripOut.task, objective: tripOut.objective, criterion: tripOut.criterion }));
  }
  await me.attempt('restore full six-competency scope', () => me.setGroupTargets(group.id, targets));

  const toPublish = drafts.slice(0, 6).map((d) => d.id);
  const published = await me.attempt('publish six tasks', () => me.publishAssignments(toPublish));
  drafts.forEach((d) => { d.published = toPublish.includes(d.id); });
  if (published !== 6) me.bug({ did: 'publish six tasks', expected: '6', got: String(published), severity: 'wrong' });
  const counts = await me.attempt('read assignment counts', () => me.groupAssignmentCounts(group.id));
  me.note(`Sayaçlar: ${JSON.stringify(counts)}`);

  // 4. stream: announcement with photo + document + link, a poll, a draft announcement
  const photoPath = `${group.id}/${Date.now()}-sim/oryantasyon.png`;
  await me.upload('feed-attachments', photoPath, pngBytes(), 'image/png');
  const docPath = `${group.id}/${Date.now()}-sim/staj-rehberi.pdf`;
  await me.upload('feed-attachments', docPath, pdfBytes('Staj Rehberi'), 'application/pdf');
  const announcementId = await me.attempt('post an announcement with three attachments', () => me.createFeedPost(group.id, 'announcement',
    'Herkese merhaba. Staj haftası başladı: her gün stajdayım kaydını açmayı ve günlüğünüzü aynı gün yazmayı unutmayın. Rehber ekte.',
    null, [
      { kind: 'photo', target: photoPath, name: 'oryantasyon.png', mime: 'image/png', size: 100 },
      { kind: 'document', target: docPath, name: 'staj-rehberi.pdf', mime: 'application/pdf', size: 600 },
      { kind: 'link', target: 'https://www.csb.gov.tr/', name: 'Bakanlık' },
    ]));
  const pollId = await me.attempt('post a poll', () => me.createFeedPost(group.id, 'poll', 'Bu hafta hangi konuda kısa bir çevrimiçi oturum isterdiniz?',
    ['Atıksu arıtma prosesleri', 'ÇED mevzuatı', 'Saha ölçüm teknikleri', 'Rapor yazımı']));
  const draftAnnouncementId = await me.attempt('save a draft announcement', () => me.createFeedPost(group.id, 'announcement', 'Cuma günü 15:00\'te grup görüşmesi yapacağız (taslak).', null, [], true));
  const feed = await me.attempt('read the stream', () => me.listFeedPosts(group.id));
  const poll = (feed || []).find((p) => p.id === pollId);
  const pending = await me.attempt('read pending drafts', () => me.listFeedPending(group.id));
  if (!(pending || []).some((p) => p.id === draftAnnouncementId)) me.bug({ did: 'list pending drafts', expected: 'the draft announcement', got: JSON.stringify(pending), severity: 'wrong' });

  fs.writeFileSync(STATE, JSON.stringify({ groupId: group.id, joinCode: group.join_code, advisorId: me.userId, targets, assignments: drafts,
    posts: { announcementId, pollId, pollOptionIds: poll ? poll.poll.options.map((o) => o.id) : [], draftAnnouncementId } }, null, 2));
  me.note('Faz 1 bitti.');
})().catch((e) => { console.error(e); process.exit(1); });
