// Untrusted-user probe (security review 2026-09-20). Two actors:
//   1. anon — the public anon key with NO session (what anyone with the app
//      binary can do);
//   2. outsider — a freshly registered student who belongs to no group and
//      links to nobody.
// Each reads every table, calls every RPC that takes an id it should not
// have, and touches every bucket. Nothing here should return another
// person's data or succeed on a write. Output: sim/SECURITY-PROBE.md.
// node sim/security-probe.cjs
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { Actor, loadEnv, daysAgoIso, parseCode } = require('./actor.cjs');
const state = require('./lib/state.cjs');

const TABLES = [
  'profiles', 'profiles_public', 'student_profiles', 'student_codes', 'internship_groups', 'group_memberships',
  'group_competency_targets', 'group_assignments', 'assignment_submissions', 'kpi_observations', 'competencies',
  'competency_kpis', 'kpi_triplets', 'feed_posts', 'feed_comments', 'feed_likes', 'feed_attachments', 'feed_poll_options',
  'feed_poll_votes', 'conversations', 'conversation_participants', 'messages', 'conversation_reads', 'conversation_blocks',
  'notifications', 'internship_placements', 'internship_days', 'internship_day_events', 'internship_closures',
  'xp_transactions', 'earned_badges', 'daily_logs', 'mentor_feedbacks', 'log_photos', 'log_documents', 'polls',
];
const BUCKETS = ['log-photos', 'log-documents', 'assignment-docs', 'feed-attachments', 'avatars', 'internship-day-files'];
const REFERENCE = new Set(['competencies', 'competency_kpis', 'kpi_triplets']); // readable by any signed-in user by design

const lines = ['# Untrusted-user probe', '', `Run: ${new Date().toISOString()}`, ''];
const out = (s) => lines.push(s);
const short = (v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 90 ? s.slice(0, 87) + '…' : s; };

async function probeTables(client, label, isAnon) {
  out(`## ${label} — direct table reads`, '');
  out('| table | rows | note |', '|---|---|---|');
  for (const t of TABLES) {
    const r = await client.from(t).select('*').limit(5);
    const rows = r.error ? null : (r.data || []).length;
    let note = r.error ? `refused: ${short(r.error.message)}` : '';
    let flag = '';
    if (!r.error && rows > 0) {
      if (isAnon) flag = ' **LEAK (anon)**';
      else if (!REFERENCE.has(t)) {
        // the outsider may see only rows about themself
        const foreign = (r.data || []).filter((row) => !Object.values(row).includes(client.__uid));
        if (foreign.length) flag = ` **LEAK (${foreign.length} foreign rows)**`;
      }
    }
    out(`| ${t} | ${rows === null ? '—' : rows} | ${note}${flag} |`);
  }
  out('');
}

async function probeRpcs(client, label, s) {
  const elif = s.students['elif-kaya'].userId;
  const calls = [
    ['list_feed_posts', { p_group_id: s.groupId, p_before: null, p_limit: 5 }],
    ['internship_group_attendance', { p_group_id: s.groupId }],
    ['internship_week', { p_student_id: elif, p_from: daysAgoIso(6) }],
    ['internship_people', {}],
    ['get_competency_progress', { p_student_id: elif }],
    ['competency_self_vs_mentor', { p_student_id: elif }],
    ['get_internship_report', { p_student_id: s.students['ayse-celik'].userId, p_group_id: s.groupId }],
    ['internship_closure_status', { p_student_id: s.students['ayse-celik'].userId, p_group_id: s.groupId }],
    ['list_conversations', { p_group_id: s.groupId }],
    ['list_messages', { p_conversation_id: s.students['deniz-yildirim'].conversations.classmate, p_before: null, p_limit: 5 }],
    ['open_conversation', { p_group_id: s.groupId, p_other_id: elif }],
    ['open_case', { p_group_id: s.groupId, p_student_id: elif }],
    ['list_message_contacts', { p_group_id: s.groupId }],
    ['group_assignment_counts', { p_group_id: s.groupId }],
    ['list_feed_pending', { p_group_id: s.groupId }],
    ['get_my_group_leaderboard', { p_limit: 5 }],
    ['validate_group_code', { p_code: s.joinCode }],
    ['link_student_by_code', { p_code: s.students['elif-kaya'].studentCode, p_role: 'mentor' }],
    ['review_assignment', { p_submission_id: s.students['elif-kaya'].submissions[0].submissionId, p_approved: true, p_note: 'x', p_level: 2 }],
    ['set_submission_sharing', { p_submission_id: s.students['elif-kaya'].submissions[0].submissionId, p_share: false }],
    ['close_internship', { p_student_id: elif, p_group_id: s.groupId }],
    ['publish_assignments', { p_ids: [s.assignments[6].id] }],
    ['create_feed_post', { p_group_id: s.groupId, p_kind: 'announcement', p_body: 'probe', p_options: null, p_attachments: [], p_draft: false }],
    ['vote_feed_poll', { p_post_id: s.posts.pollId, p_option_id: s.posts.pollOptionIds[0] }],
    ['record_consent', { p_version: '1.0' }],
    // internal helpers that must not be callable from PostgREST at all
    ['can_message', { p_group_id: s.groupId, p_a: elif, p_b: elif }],
    ['internship_closed', { p_student_id: elif, p_group_id: s.groupId }],
    ['internship_notify', { p_user: elif, p_type: 'general', p_title: 'x', p_body: 'x', p_data: {} }],
    ['build_internship_report', { p_student_id: elif, p_group_id: s.groupId }],
    ['conversation_other', { p_conversation_id: s.students['deniz-yildirim'].conversations.classmate, p_user_id: elif }],
  ];
  out(`## ${label} — RPCs with ids they do not own`, '');
  out('| rpc | outcome |', '|---|---|');
  for (const [name, args] of calls) {
    const r = await client.rpc(name, args);
    if (r.error) out(`| ${name} | refused: ${short(r.error.message)} |`);
    else {
      const data = r.data;
      const empty = data === null || data === undefined || (Array.isArray(data) && data.length === 0) || data === 0 || data === false;
      out(`| ${name} | ${empty ? 'succeeded, empty' : '**SUCCEEDED** ' + short(data)} |`);
    }
  }
  out('');
}

async function probeStorage(client, label, s, knownPhotoPath) {
  out(`## ${label} — storage`, '');
  out('| bucket | list | download known path | upload into another user\'s folder |', '|---|---|---|---|');
  for (const b of BUCKETS) {
    const l = await client.storage.from(b).list('', { limit: 3 });
    const listNote = l.error ? `refused: ${short(l.error.message)}` : `${(l.data || []).length} entries${(l.data || []).length ? ' **LISTS**' : ''}`;
    let dl = 'n/a';
    if (b === 'log-photos' && knownPhotoPath) {
      const d = await client.storage.from(b).download(knownPhotoPath);
      dl = d.error ? `refused: ${short(d.error.message)}` : `**DOWNLOADED ${d.data?.size} bytes**`;
    }
    const up = await client.storage.from(b).upload(`${s.students['elif-kaya'].userId}/probe/${Date.now()}.txt`, Buffer.from('probe'), { contentType: 'text/plain' });
    const upNote = up.error ? `refused: ${short(up.error.message)}` : `**UPLOADED** ${up.data?.path}`;
    out(`| ${b} | ${listNote} | ${dl} | ${upNote} |`);
  }
  out('');
}

(async () => {
  const s = state.read();
  const env = loadEnv();
  // a known evidence path from Elif's phase-4 log (the first log-photos upload)
  const elifLog = fs.readFileSync(path.join(__dirname, 'log', 'elif-kaya.md'), 'utf8');
  const m = /storage\.log-photos\.upload\*\* \{"path":"([^"]+)"/.exec(elifLog);
  const knownPhotoPath = m ? m[1] : null;

  // 1. anon, no session
  const anon = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  anon.__uid = 'none';
  await probeTables(anon, 'anon (no session)', true);
  await probeRpcs(anon, 'anon (no session)', s);
  await probeStorage(anon, 'anon (no session)', s, knownPhotoPath);

  // 2. outsider: a fresh student in no group
  const stamp = Date.now();
  const outsider = new Actor({ slug: 'security-probe', name: 'Outsider' });
  await outsider.signUp({ email: `outsider.${stamp}@sim.engineertrack.test`, password: 'Sim-Outsider-2026!', firstName: 'Yabancı', lastName: String(stamp), role: 'student', avatarId: '01' });
  outsider.client.__uid = outsider.userId;
  out(`Outsider account: outsider.${stamp}@sim.engineertrack.test (student, no group, no mentor; delete afterwards)`, '');
  await probeTables(outsider.client, 'outsider (signed in, no group)', false);
  await probeRpcs(outsider.client, 'outsider (signed in, no group)', s);
  await probeStorage(outsider.client, 'outsider (signed in, no group)', s, knownPhotoPath);

  // 3. the anon client's realtime: can it subscribe to a table channel and receive rows?
  out('## Notes', '', '- Realtime and edge functions are not probed here (no edge functions exist; realtime respects RLS by construction).', '');
  fs.writeFileSync(path.join(__dirname, 'SECURITY-PROBE.md'), lines.join('\n') + '\n');
  console.log('written sim/SECURITY-PROBE.md');
})().catch((e) => { console.error(e); process.exit(1); });
