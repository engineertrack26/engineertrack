// Phase 8 — the auditor. Signs in as everyone (read-only), runs each role's
// screen reads, checks cross-person consistency and isolation, and writes
// sim/AUDIT.md (one section per person). The screen-reading notes are
// appended to AUDIT.md by the auditor agent afterwards, not by this script.
//
// Adaptations to the brief's script (all in-band):
//  1. `assignment_submissions[0]` → the LATEST submission by submitted_at
//     (Burak's returned task has two rows: needs_revision then resubmitted).
//  2. The mentor pending check compares against the student's rows with
//     status === 'submitted' (latest per assignment).
//  3. The outsider report check uses MENTORS[1] (Ayça, Burak's mentor), who is
//     not Ayşe's mentor → REPORT_FORBIDDEN.
//  4. Table probes go through probeRows: a refusal (permission denied — the
//     internship-days tables grant no client privileges; RPC-only by design)
//     or 0 rows is the pass; only a non-empty result is a leak → [blocker].
//  4b. Extra isolation: student → another student's internship_week
//     (ID_FORBIDDEN), progress (ROLE_NOT_ALLOWED), self-vs-mentor
//     (SELF_ASSESSMENT_FORBIDDEN), report (REPORT_FORBIDDEN); mentor →
//     a student that is not theirs (same codes); mentor → list_feed_posts
//     (NOT_IN_GROUP, mentors are outside the stream by design).
//  5. Extra consistency: the comment set on the announcement as the advisor
//     vs as Can (the advisor deleted Can's comment in phase 7); the stream
//     read with paging (limit 50, loop on p_before) and each student's
//     approved-and-shared submissions vs their task cards; the advisor's
//     attendance table vs each student's week; the advisor's assignment
//     counts vs the students' rows; every mentor's full contact list logged.
const fs = require('node:fs');
const path = require('node:path');
const { Actor, daysAgoIso, parseCode } = require('../actor.cjs');
const { STUDENTS, MENTORS, ADVISOR, mentorOf } = require('../people.cjs');
const state = require('../lib/state.cjs');
const OUT = path.join(__dirname, '..', 'AUDIT.md');
const lines = ['# Audit', '', `_Run ${new Date().toISOString()} by the auditor (read-only sign-ins as everyone)._`, ''];
const auditor = { slug: 'auditor', name: 'Auditor' };
const actors = {};
async function as(p) {
  if (!actors[p.slug]) { actors[p.slug] = new Actor({ ...p, slug: 'auditor' }); await actors[p.slug].signIn(p.email, p.password); }
  return actors[p.slug];
}
function section(title) { lines.push(`## ${title}`, ''); }
function row(label, value) { lines.push(`- ${label}: ${typeof value === 'string' ? value : JSON.stringify(value).slice(0, 400)}`); }
function latest(subs) { return (subs || []).slice().sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')))[0] || null; }
async function allFeedPosts(me, groupId) {
  const out = []; let before = null;
  for (let i = 0; i < 10; i++) {
    const page = await me.listFeedPosts(groupId, before, 50);
    out.push(...page);
    if (page.length < 50) break;
    before = page[page.length - 1].createdAt;
  }
  return out;
}
/** Read that must succeed; a failure is a bug (any non-expected ERROR line) and yields undefined. */
async function read(me, did, fn) { return me.attempt(did, fn); }
/** Isolation probe on a table: a refusal (permission denied / RLS) or 0 rows is the pass;
 *  only a non-empty result is a leak → [blocker]. Returns the row count (0 on refusal). */
async function probeRows(me, did, fn) {
  try { const rows = (await fn()) || []; if (rows.length) me.bug({ did, expected: '0 rows or a refusal', got: `${rows.length} row(s)`, severity: 'blocker' }); return rows.length; }
  catch (e) { const { code, detail } = parseCode(e); me.note(`expected refusal for: ${did} → ${detail || code || e.message}`); return 0; }
}

(async () => {
  const s = state.read();
  const A = new Actor(auditor);
  const bug = (entry) => A.bug(entry);
  const findings = [];
  const note = (t) => { A.note(t); findings.push(t); };
  const from = daysAgoIso(6); // 2026-09-14 when run on 2026-09-20 — the internship week

  // ---------------------------------------------------------------- students
  const submittedByStudent = {}; // slug -> count of latest-submission rows with status 'submitted'
  const approvedByStudent = {}; // slug -> [{submissionId, shared}]
  const streamByReader = {}; // slug -> { count, taskCards: submissionId[] }
  const weekByStudent = {}; // slug -> [{date, attendance, log_status}]
  const leaderboardByReader = {};
  const commentsByReader = {};
  for (const p of STUDENTS) {
    const me = await as(p); section(`${p.name} (student)`);
    const uid = s.students[p.slug].userId;
    if (me.userId !== uid) bug({ did: `${p.name} signs in`, expected: `user id ${uid} (state.json)`, got: me.userId, severity: 'wrong' });

    const tasks = await read(me, `${p.name}: my-tasks`, () => me.listMyAssignments()) || [];
    row('tasks (my-tasks)', tasks.map((t) => `${t.title.slice(0, 30)}:${(latest(t.assignment_submissions) || {}).status || 'todo'}`));
    row('task rows / submissions rows', `${tasks.length} / ${tasks.reduce((n, t) => n + (t.assignment_submissions || []).length, 0)}`);
    const multi = tasks.filter((t) => (t.assignment_submissions || []).length > 1).map((t) => `${t.title.slice(0, 30)} ×${t.assignment_submissions.length} [${t.assignment_submissions.map((x) => x.status).join(',')}]`);
    if (multi.length) row('assignments with several submission rows', multi);
    submittedByStudent[p.slug] = tasks.filter((t) => (latest(t.assignment_submissions) || {}).status === 'submitted').length;
    approvedByStudent[p.slug] = tasks.map((t) => latest(t.assignment_submissions)).filter((x) => x && x.status === 'approved').map((x) => ({ submissionId: x.id, shared: x.share_to_feed !== false }));
    row('submitted (awaiting mentor)', submittedByStudent[p.slug]);
    row('approved / shared', `${approvedByStudent[p.slug].length} / ${approvedByStudent[p.slug].filter((x) => x.shared).length}`);
    // any submission row that belongs to someone else came through the embed?
    const foreign = tasks.flatMap((t) => t.assignment_submissions || []).filter((x) => x.student_id !== uid);
    if (foreign.length) bug({ did: `${p.name} reads my-tasks (assignment_submissions embed)`, expected: 'only my own submission rows', got: `${foreign.length} row(s) of another student: ${foreign.map((x) => x.student_id).join(',')}`, severity: 'blocker' });

    const progress = await read(me, `${p.name}: growth`, () => me.getCompetencyProgress(uid));
    row('progress (growth)', (progress || []).map((c) => `${c.competency_name}:${c.current_level}/${c.target_level}`));
    const svm = await read(me, `${p.name}: self vs mentor`, () => me.competencySelfVsMentor(uid));
    row('self vs mentor', (svm || []).map((c) => `${c.name}: tasks ${c.tasks} self ${c.avgSelf} mentor ${c.avgMentor} gap ${c.gap} over ${c.overRated} under ${c.underRated}`));
    const week = await read(me, `${p.name}: internship days`, () => me.internshipWeek(uid, from)) || [];
    weekByStudent[p.slug] = week.map((d) => ({ date: d.day_date, attendance: d.attendance, log_status: d.log_status, correction: d.correction_requested }));
    row('week (internship days)', week.map((d) => `${d.day_date}:${d.attendance}/${d.log_status}${d.correction_requested ? '/correction' : ''}`));
    const totals = await read(me, `${p.name}: internship totals`, () => me.internshipTotals(uid));
    row('totals', totals);
    const posts = await read(me, `${p.name}: stream (paged)`, () => allFeedPosts(me, s.groupId)) || [];
    streamByReader[p.slug] = { count: posts.length, taskCards: posts.filter((x) => x.kind === 'task').map((x) => x.task && x.task.submissionId), kinds: posts.reduce((m, x) => { m[x.kind] = (m[x.kind] || 0) + 1; return m; }, {}) };
    row('stream count (paged, all)', `${posts.length} ${JSON.stringify(streamByReader[p.slug].kinds)}`);
    const emptyTitle = posts.filter((x) => x.kind === 'task' && (!x.task || !x.task.title));
    if (emptyTitle.length) bug({ did: `${p.name} reads the stream`, expected: 'every task card carries its title', got: `${emptyTitle.length} task card(s) without a title: ${emptyTitle.map((x) => x.id).join(',')}`, severity: 'wrong' });
    // my approved+shared submissions must each have a card; my unshared one must not
    const mine = approvedByStudent[p.slug];
    const missing = mine.filter((x) => x.shared && !streamByReader[p.slug].taskCards.includes(x.submissionId));
    const leakedUnshared = mine.filter((x) => !x.shared && streamByReader[p.slug].taskCards.includes(x.submissionId));
    if (missing.length) bug({ did: `${p.name}: approved + shared submissions vs task cards in the stream (paged)`, expected: 'a card per approved submission with share_to_feed on', got: `${missing.length} without a card: ${missing.map((x) => x.submissionId).join(',')}`, severity: 'wrong' });
    if (leakedUnshared.length) bug({ did: `${p.name}: submission with share_to_feed off`, expected: 'no card in the stream', got: `card present for ${leakedUnshared.map((x) => x.submissionId).join(',')}`, severity: 'wrong' });
    row('my task cards in the stream', `${mine.filter((x) => streamByReader[p.slug].taskCards.includes(x.submissionId)).length} of ${mine.length} approved (${mine.filter((x) => x.shared).length} shared)`);

    const convs = await read(me, `${p.name}: conversations`, () => me.listConversations(s.groupId)) || [];
    row('conversations', convs.map((c) => `${c.kind || '?'}:${c.title || c.otherName || c.name || '—'}:unread ${c.unreadCount ?? c.unread ?? '?'}`));
    const unread = await read(me, `${p.name}: unread`, () => me.unreadMessageCount());
    row('unread', unread);
    const sumUnread = convs.reduce((n, c) => n + (Number(c.unreadCount ?? c.unread) || 0), 0);
    if (unread != null && convs.length && sumUnread !== Number(unread)) note(`${p.name}: unread_message_count ${unread} vs sum of conversation unread ${sumUnread} (fields: ${Object.keys(convs[0]).join(',')})`);
    const notifs = await read(me, `${p.name}: notifications`, () => me.listNotifications()) || [];
    row('notifications', `${notifs.length} — ${JSON.stringify(notifs.reduce((m, n) => { m[n.type] = (m[n.type] || 0) + 1; return m; }, {}))}`);
    row('notification titles (first 6)', notifs.slice(0, 6).map((n) => `${n.type}:${n.title}`));
    const emptyNotif = notifs.filter((n) => !n.title || !n.body);
    if (emptyNotif.length) note(`${p.name}: ${emptyNotif.length} notification(s) with an empty title or body: ${emptyNotif.map((n) => `${n.type}/${n.id}`).join(',')}`);
    row('closure', await read(me, `${p.name}: closure status`, () => me.internshipClosureStatus(uid, s.groupId)));
    const lb = await read(me, `${p.name}: leaderboard`, () => me.getMyGroupLeaderboard(20)) || [];
    leaderboardByReader[p.slug] = lb.map((r) => `${r.student_id || r.id || r.userId}:${r.total_xp ?? r.xp ?? r.totalXp}`);
    row('leaderboard', lb.map((r) => `${(r.name || r.full_name || r.first_name || '').toString().slice(0, 12)}:${r.total_xp ?? r.xp ?? r.totalXp}`));
    const onBoard = lb.some((r) => (r.student_id || r.id || r.userId) === uid);
    if (lb.length && !onBoard) note(`${p.name}: not on their own group leaderboard (${lb.length} rows)`);
    if (p.slug === 'ayse-celik') {
      const rep = await read(me, `${p.name}: my closure report`, () => me.getInternshipReport(uid, s.groupId));
      row('report (first line / length)', rep ? `${rep.split('\n')[0]} / ${rep.length} chars; version line: ${(rep.match(/Report version[^\n]*/) || ['—'])[0]}` : rep);
    }
    if (p.slug === 'can-dogan') {
      commentsByReader.can = await read(me, 'Can: comments on the announcement', () => me.listComments(s.posts.announcementId)) || [];
      row('announcement comment authors', commentsByReader.can.map((c) => `${c.author_id.slice(0, 8)}:${c.body.slice(0, 20)}`));
    }

    // ---- isolation: another student's data must be invisible / refused
    const other = STUDENTS.find((o) => o.slug !== p.slug);
    const otherId = s.students[other.slug].userId;
    row(`isolation: ${other.name}'s submissions`, `${await probeRows(me, `${p.name} reads ${other.name}'s submissions`, () => me.table('assignment_submissions', 'select-other', (q) => q.select('id').eq('student_id', otherId)))} rows`);
    const anyOther = await read(me, `${p.name}: select all submissions`, () => me.table('assignment_submissions', 'select-all', (q) => q.select('id, student_id'))) || [];
    const notMine = anyOther.filter((x) => x.student_id !== uid);
    if (notMine.length) bug({ did: `${p.name} selects assignment_submissions without a filter`, expected: 'only my rows', got: `${notMine.length} of ${anyOther.length} rows belong to others`, severity: 'blocker' });
    row('isolation: unfiltered submissions select', `${anyOther.length} rows, ${notMine.length} not mine`);
    const okWeek = await me.expectRefusal('ID_FORBIDDEN', `${p.name} reads ${other.name}'s internship week`, () => me.internshipWeek(otherId, from));
    const okProg = await me.expectRefusal('ROLE_NOT_ALLOWED', `${p.name} reads ${other.name}'s competency progress`, () => me.getCompetencyProgress(otherId));
    const okSvm = await me.expectRefusal('SELF_ASSESSMENT_FORBIDDEN', `${p.name} reads ${other.name}'s self-vs-mentor`, () => me.competencySelfVsMentor(otherId));
    const okRep = await me.expectRefusal('REPORT_FORBIDDEN', `${p.name} reads ${other.name}'s report`, () => me.getInternshipReport(otherId, s.groupId));
    row('isolation: refusals (week/progress/selfVsMentor/report)', [okWeek, okProg, okSvm, okRep].map((x) => (x ? 'refused' : 'NOT refused')).join('/'));
    row(`isolation: ${other.name}'s internship_days rows (refusal or 0 = pass)`, await probeRows(me, `${p.name} selects ${other.name}'s internship_days directly`, () => me.table('internship_days', 'select-other', (q) => q.select('id').eq('student_id', otherId))));
    row(`isolation: ${other.name}'s kpi_observations rows`, await probeRows(me, `${p.name} selects ${other.name}'s kpi_observations directly`, () => me.table('kpi_observations', 'select-other', (q) => q.select('id').eq('student_id', otherId))));
    row(`isolation: ${other.name}'s notifications rows`, await probeRows(me, `${p.name} selects ${other.name}'s notifications directly`, () => me.table('notifications', 'select-other', (q) => q.select('id').eq('user_id', otherId))));
    lines.push('');
  }
  // leaderboards: every student sees the same board
  const boards = Object.values(leaderboardByReader).map((b) => b.join('|'));
  if (new Set(boards).size > 1) bug({ did: 'compare the group leaderboard across the seven students', expected: 'the same board for everyone', got: JSON.stringify(leaderboardByReader).slice(0, 400), severity: 'wrong' });
  else note(`leaderboard identical across the 7 students (${leaderboardByReader[STUDENTS[0].slug].length} rows)`);
  // stream: every student sees the same count
  const streamCounts = Object.entries(streamByReader).map(([k, v]) => `${k}:${v.count}`);
  if (new Set(Object.values(streamByReader).map((v) => v.count)).size > 1) bug({ did: 'compare the stream count across the seven students (paged)', expected: 'the same count', got: streamCounts.join(', '), severity: 'wrong' });
  else note(`stream count identical across the 7 students: ${Object.values(streamByReader)[0].count}`);

  // ---------------------------------------------------------------- mentors
  const peopleByMentor = {};
  for (const m of MENTORS) {
    const me = await as(m); section(`${m.name} (mentor of ${m.studentSlug})`);
    const myStudentId = s.students[m.studentSlug].userId;
    const pending = await read(me, `${m.name}: pending reviews`, () => me.listPendingReviews()) || [];
    row('pending reviews', `${pending.length} ${JSON.stringify(pending.map((x) => `${x.student_id.slice(0, 8)}:${(x.group_assignments || {}).title ? x.group_assignments.title.slice(0, 25) : 'NO TITLE'}`))}`);
    const expectedPending = submittedByStudent[m.studentSlug];
    if (pending.length !== expectedPending) bug({ did: `${m.name}'s pending count vs ${m.studentSlug}'s submitted rows`, expected: String(expectedPending), got: String(pending.length), severity: 'wrong' });
    const foreignPending = pending.filter((x) => x.student_id !== myStudentId);
    if (foreignPending.length) bug({ did: `${m.name} reads pending reviews`, expected: 'only my student\'s submissions', got: `${foreignPending.length} row(s) of ${foreignPending.map((x) => x.student_id).join(',')}`, severity: 'blocker' });
    const allSubs = await read(me, `${m.name}: select all submissions`, () => me.table('assignment_submissions', 'select-all', (q) => q.select('id, student_id, status'))) || [];
    const foreignSubs = allSubs.filter((x) => x.student_id !== myStudentId);
    row('submissions visible (unfiltered select)', `${allSubs.length} rows, ${foreignSubs.length} of other students`);
    if (foreignSubs.length) bug({ did: `${m.name} selects assignment_submissions without a filter`, expected: 'only my student\'s rows', got: `${foreignSubs.length} of ${allSubs.length} rows belong to ${[...new Set(foreignSubs.map((x) => x.student_id))].join(',')}`, severity: 'blocker' });
    const people = await read(me, `${m.name}: internship people`, () => me.internshipPeople()) || [];
    peopleByMentor[m.slug] = people;
    row('people', people.map((x) => `${x.name} (${x.company}) ${x.startDate}→${x.endDate}`));
    if (!people.some((x) => x.id === myStudentId)) bug({ did: `${m.name} reads internship_people`, expected: `${m.studentSlug} listed`, got: JSON.stringify(people).slice(0, 200), severity: 'wrong' });
    const extra = people.filter((x) => x.id !== myStudentId);
    if (extra.length) note(`${m.name}: internship_people lists ${extra.length} extra student(s): ${extra.map((x) => x.name).join(', ')}`);
    const contacts = await read(me, `${m.name}: mentor message contacts`, () => me.listMentorMessageContacts()) || [];
    me.note(`FULL list_mentor_message_contacts for ${m.name}: ${JSON.stringify(contacts)}`);
    row('contacts', contacts.map((x) => `${x.name} (${x.role})`));
    if (!contacts.some((x) => x.role === 'advisor')) note(`${m.name}: no advisor among message contacts`);
    if (!contacts.some((x) => x.id === myStudentId)) note(`${m.name}: own student missing from message contacts`);
    const convs = await read(me, `${m.name}: conversations`, () => me.listConversations(null)) || [];
    row('conversations', convs.map((c) => `${c.kind || '?'}:${c.title || c.otherName || c.name || '—'}`));
    row('unread', await read(me, `${m.name}: unread`, () => me.unreadMessageCount()));
    const notifs = await read(me, `${m.name}: notifications`, () => me.listNotifications()) || [];
    row('notifications', `${notifs.length} — ${JSON.stringify(notifs.reduce((o, n) => { o[n.type] = (o[n.type] || 0) + 1; return o; }, {}))}`);
    const week = await read(me, `${m.name}: my student's week`, () => me.internshipWeek(myStudentId, from)) || [];
    row("student's week (mentor view)", week.map((d) => `${d.day_date}:${d.attendance}/${d.log_status}`));
    const own = weekByStudent[m.studentSlug] || [];
    const mismatch = own.filter((d) => { const w = week.find((x) => x.day_date === d.date); return !w || w.attendance !== d.attendance || w.log_status !== d.log_status; });
    if (mismatch.length) bug({ did: `${m.name}'s view of ${m.studentSlug}'s week vs the student's own view`, expected: 'same attendance/log_status per day', got: JSON.stringify(mismatch).slice(0, 300), severity: 'wrong' });
    const prog = await read(me, `${m.name}: my student's progress`, () => me.getCompetencyProgress(myStudentId)) || [];
    row("student's progress (mentor view)", prog.map((c) => `${c.competency_name}:${c.current_level}/${c.target_level}`));
    const svm = await read(me, `${m.name}: my student's self vs mentor`, () => me.competencySelfVsMentor(myStudentId)) || [];
    row("student's self vs mentor (mentor view)", svm.map((c) => `${c.name}: gap ${c.gap} over ${c.overRated}`));
    // ---- isolation: a student that is not mine
    const other = STUDENTS.find((o) => o.slug !== m.studentSlug && !people.some((x) => x.id === s.students[o.slug].userId));
    const otherId = s.students[other.slug].userId;
    const okWeek = await me.expectRefusal('ID_FORBIDDEN', `${m.name} reads ${other.name}'s internship week (not my student)`, () => me.internshipWeek(otherId, from));
    const okRep = await me.expectRefusal('REPORT_FORBIDDEN', `${m.name} reads ${other.name}'s report (not my student)`, () => me.getInternshipReport(otherId, s.groupId));
    const okProg = await me.expectRefusal('ROLE_NOT_ALLOWED', `${m.name} reads ${other.name}'s progress (not my student)`, () => me.getCompetencyProgress(otherId));
    const okFeed = await me.expectRefusal('NOT_IN_GROUP', `${m.name} reads the group stream (mentors are outside the stream)`, () => me.listFeedPosts(s.groupId, null, 50));
    row(`isolation vs ${other.name} (week/report/progress) + stream`, [okWeek, okRep, okProg, okFeed].map((x) => (x ? 'refused' : 'NOT refused')).join('/'));
    row(`isolation: ${other.name}'s internship_days rows (refusal or 0 = pass)`, await probeRows(me, `${m.name} selects ${other.name}'s internship_days directly`, () => me.table('internship_days', 'select-other', (q) => q.select('id').eq('student_id', otherId))));
    lines.push('');
  }

  // ---------------------------------------------------------------- advisor
  const adv = await as(ADVISOR); section(`${ADVISOR.name} (advisor)`);
  const att = await read(adv, 'advisor: attendance table', () => adv.internshipGroupAttendance(s.groupId)) || { students: [], days: [] };
  row('attendance (students)', (att.students || []).map((x) => `${x.name}: P${x.present} p${x.partial} E${x.excused} A${x.absent} ?${x.pending} corr${x.corrections} logs${x.submittedLogs} rec${x.recorded}/${x.expectedSoFar}/${x.expectedDays} unrec${x.unrecorded} mentor=${x.mentor}`));
  row('attendance (days rows)', (att.days || []).length);
  row('attendance student row keys', Object.keys((att.students || [])[0] || {}));
  for (const p of STUDENTS) {
    const arow = (att.students || []).find((x) => x.id === s.students[p.slug].userId);
    const own = weekByStudent[p.slug] || [];
    if (!arow) { bug({ did: `advisor attendance table vs ${p.name}`, expected: 'a row per placed student', got: 'no row', severity: 'wrong' }); continue; }
    const cnt = (st) => own.filter((d) => d.attendance === st).length;
    const diffs = ['present', 'partial', 'excused', 'absent', 'pending'].filter((st) => Number(arow[st]) !== cnt(st)).map((st) => `${st}: table ${arow[st]} vs week ${cnt(st)}`);
    const logs = own.filter((d) => d.log_status === 'submitted').length;
    if (Number(arow.submittedLogs) !== logs) diffs.push(`submittedLogs: table ${arow.submittedLogs} vs week ${logs}`);
    if (Number(arow.recorded) !== own.length) diffs.push(`recorded: table ${arow.recorded} vs week ${own.length}`);
    if (diffs.length) bug({ did: `advisor attendance table vs ${p.name}'s own week (${from}..+6)`, expected: 'same counts', got: diffs.join('; '), severity: 'wrong' });
    else note(`${p.name}: attendance table matches the student's week (${own.length} days, ${logs} logs)`);
    const mentorName = mentorOf(p.slug).name;
    if (arow.mentor !== mentorName) note(`${p.name}: attendance table mentor column "${arow.mentor}" vs expected "${mentorName}"`);
  }
  const counts = await read(adv, 'advisor: assignment counts', () => adv.groupAssignmentCounts(s.groupId));
  row('counts', counts);
  const memberCount = STUDENTS.length;
  const totalApproved = Object.values(approvedByStudent).reduce((n, a) => n + a.length, 0);
  const totalSubmitted = Object.values(submittedByStudent).reduce((n, a) => n + a, 0);
  row('students\' own totals', `approved ${totalApproved}, awaiting mentor ${totalSubmitted}, members ${memberCount}`);
  note(`advisor group_assignment_counts = ${JSON.stringify(counts)}; students' own rows: approved ${totalApproved}, submitted ${totalSubmitted}`);
  const pendingDrafts = await read(adv, 'advisor: pending stream drafts', () => adv.listFeedPending(s.groupId)) || [];
  row('pending drafts', `${pendingDrafts.length} ${JSON.stringify(pendingDrafts.map((x) => `${x.kind}:${(x.body || '').slice(0, 20)}`))}`);
  const members = await read(adv, 'advisor: group members', () => adv.groupMembers(s.groupId)) || [];
  row('members', `${members.length} ${JSON.stringify(members.map((m) => (m.student ? `${m.student.first_name} ${m.student.last_name}` : 'NO PROFILE EMBED')))}`);
  if (members.length !== memberCount) bug({ did: 'advisor reads group members', expected: `${memberCount}`, got: `${members.length}`, severity: 'wrong' });
  const noEmbed = members.filter((m) => !m.student);
  if (noEmbed.length) bug({ did: 'advisor reads group members (profiles embed)', expected: 'a profile per member', got: `${noEmbed.length} member(s) without the embed`, severity: 'wrong' });
  const advPosts = await read(adv, 'advisor: stream (paged)', () => allFeedPosts(adv, s.groupId)) || [];
  row('stream count (paged, all)', `${advPosts.length} ${JSON.stringify(advPosts.reduce((m, x) => { m[x.kind] = (m[x.kind] || 0) + 1; return m; }, {}))}`);
  const studentCount = Object.values(streamByReader)[0].count;
  if (advPosts.length !== studentCount) bug({ did: 'advisor stream count vs the students\' stream count', expected: String(studentCount), got: String(advPosts.length), severity: 'wrong' });
  const taskCards = advPosts.filter((x) => x.kind === 'task');
  row('task cards by author', JSON.stringify(taskCards.reduce((m, x) => { m[x.authorName] = (m[x.authorName] || 0) + 1; return m; }, {})));
  const sharedTotal = Object.values(approvedByStudent).reduce((n, a) => n + a.filter((x) => x.shared).length, 0);
  if (taskCards.length !== sharedTotal) note(`task cards in the stream ${taskCards.length} vs students' approved+shared submissions ${sharedTotal}`);
  const longestTitle = taskCards.reduce((m, x) => Math.max(m, ((x.task || {}).title || '').length), 0);
  row('longest task-card title', longestTitle);
  commentsByReader.advisor = await read(adv, 'advisor: comments on the announcement', () => adv.listComments(s.posts.announcementId)) || [];
  row('announcement comment authors', commentsByReader.advisor.map((c) => `${c.author_id.slice(0, 8)}:${c.body.slice(0, 20)}`));
  const canId = s.students['can-dogan'].userId;
  const setA = new Set((commentsByReader.advisor || []).map((c) => c.id));
  const setC = new Set((commentsByReader.can || []).map((c) => c.id));
  const same = setA.size === setC.size && [...setA].every((id) => setC.has(id));
  if (!same) bug({ did: 'compare the announcement\'s comment set as the advisor vs as Can', expected: 'the same set (the advisor deleted Can\'s comment in phase 7)', got: `advisor ${JSON.stringify([...setA])} vs Can ${JSON.stringify([...setC])}`, severity: 'wrong' });
  else note(`announcement comment set identical for advisor and Can: ${setA.size} comment(s)`);
  for (const [who, list] of Object.entries(commentsByReader)) {
    if ((list || []).some((c) => c.author_id === canId)) bug({ did: `${who} reads the announcement comments`, expected: 'Can\'s comment absent (deleted by the advisor in phase 7)', got: 'present', severity: 'wrong' });
  }
  const zeynepId = s.students['zeynep-arslan'].userId;
  for (const [who, list] of Object.entries(commentsByReader)) {
    if (!(list || []).some((c) => c.author_id === zeynepId)) note(`${who}: Zeynep's comment ("Tamam.") is NOT among the announcement comments`);
  }
  const announcementPost = advPosts.find((x) => x.id === s.posts.announcementId);
  if (announcementPost && Number(announcementPost.commentCount) !== setA.size) bug({ did: 'announcement card commentCount vs the comment rows', expected: String(setA.size), got: String(announcementPost.commentCount), severity: 'wrong' });
  row('announcement card', announcementPost ? `likes ${announcementPost.likeCount} comments ${announcementPost.commentCount} attachments ${(announcementPost.attachments || []).length}` : 'NOT IN STREAM');
  const pollPost = advPosts.find((x) => x.id === s.posts.pollId);
  row('poll card', pollPost ? `total ${pollPost.poll.totalVotes} ${JSON.stringify(pollPost.poll.options.map((o) => `${o.label.slice(0, 15)}:${o.votes}`))}` : 'NOT IN STREAM');
  for (const p of STUDENTS) {
    const uid = s.students[p.slug].userId;
    const prog = await read(adv, `advisor: ${p.name}'s progress`, () => adv.getCompetencyProgress(uid)) || [];
    const svm = await read(adv, `advisor: ${p.name}'s self vs mentor`, () => adv.competencySelfVsMentor(uid)) || [];
    const cs = await read(adv, `advisor: ${p.name}'s closure status`, () => adv.internshipClosureStatus(uid, s.groupId));
    row(`${p.name} (monitor)`, `progress ${prog.map((c) => `${c.competency_code || c.competency_name.slice(0, 4)}:${c.current_level}/${c.target_level}`).join(' ')} | gaps ${svm.map((c) => `${c.code || c.name.slice(0, 4)}:${c.gap}`).join(' ')} | closure ${JSON.stringify(cs)}`);
  }
  const ayseId = s.students['ayse-celik'].userId;
  const report = await read(adv, 'advisor: Ayşe\'s report', () => adv.getInternshipReport(ayseId, s.groupId));
  row('Ayşe report', report ? `${report.length} chars; ${(report.match(/Report version[^\n]*/) || ['no version line'])[0]}; headings: ${(report.match(/^#+ .*$/gm) || []).join(' | ').slice(0, 300)}` : report);
  const emre = await as(mentorOf('ayse-celik'));
  const mentorReport = await read(emre, 'Emre: Ayşe\'s report (linked mentor)', () => emre.getInternshipReport(ayseId, s.groupId));
  row('Ayşe report as her mentor', mentorReport ? `${mentorReport.length} chars, same as advisor's: ${mentorReport === report}` : mentorReport);
  const advWeekAyse = await read(adv, 'advisor: Ayşe\'s week', () => adv.internshipWeek(ayseId, from)) || [];
  row('Ayşe week (advisor view)', advWeekAyse.map((d) => `${d.day_date}:${d.attendance}/${d.log_status}`));
  // advisor isolation: a stranger's group / student
  const okAtt = await adv.expectRefusal('ID_FORBIDDEN', 'advisor reads the attendance table of a random group id', () => adv.internshipGroupAttendance('00000000-0000-0000-0000-000000000000'));
  row('isolation: attendance of a foreign group', okAtt ? 'refused' : 'NOT refused');

  // outsider: a mentor reading the advisor's report for a student not theirs
  const stranger = await as(MENTORS[1]);
  const okStranger = await stranger.expectRefusal('REPORT_FORBIDDEN', `${MENTORS[1].name} (a non-linked mentor) reads Ayşe's report`, () => stranger.getInternshipReport(ayseId, s.groupId));
  row(`outsider: ${MENTORS[1].name} reads Ayşe's report`, okStranger ? 'refused REPORT_FORBIDDEN' : 'NOT refused');

  section('Cross-person checks');
  for (const f of findings) lines.push(`- ${f}`);
  lines.push('');
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  A.note('Faz 8 (denetim) bitti.');
  console.log('audit written');
})().catch((e) => { console.error(e); process.exit(1); });
