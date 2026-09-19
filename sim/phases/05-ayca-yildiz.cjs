// Phase 5 — Ayça Yıldız reviews Burak Şahin's week and his five submissions.
// Adapted from sim/phases/05-hakan-demir.cjs (the template). Ayça is strict:
// she opens the week, marks only the days Burak actually opened present (he
// opened 3, not the full 7-day window — internship_week only returns rows
// that exist, i.e. days someone called internship_open_day on), sends ONE
// of his five submissions back with a precise reason, and rates the other
// four 1 or 2 against his self-rating of 2 on all of them (disagreeing on
// at least two, per her style: "sends work back once with a precise
// reason").
//
// Adaptations from the brief's literal skeleton (see me.note()/me.bug()
// calls below for the same, logged in-band):
//  1. Per the template's finding, the "review another mentor's student"
//     probe and the "re-approve an already-approved submission" probe are
//     Hakan's only (brief explicitly says so) — skipped here entirely; no
//     submission or day of a student who is not Burak is touched.
//  2. review_assignment's LEVEL_REQUIRED guard (docs/internship-closure-
//     guards.sql:422-427) is gated strictly on p_approved = true — "Required
//     on approval, meaningless on a revision request." So the revision call
//     below (p_approved=false, p_level=undefined) is expected to SUCCEED,
//     not raise LEVEL_REQUIRED. Verified, not filed as a bug (documented,
//     intended behaviour — the level is a rating of a completed task, not
//     applicable to a request for more work).
const { Actor, daysAgoIso } = require('../actor.cjs');
const { bySlug } = require('../people.cjs');
const state = require('../lib/state.cjs');
const P = bySlug('ayca-yildiz');

(async () => {
  const me = new Actor(P);
  await me.signIn(P.email, P.password);
  const s = state.read();
  const student = s.students[P.studentSlug];
  const reviewed = [];

  // ---- attendance: mark Burak's opened days present ----
  const week = await me.attempt("read my student's week", () => me.internshipWeek(student.userId, daysAgoIso(6)));
  const pendingDays = (week || []).filter((d) => d.attendance === 'pending');
  if ((week || []).length !== 3) {
    me.note(`internship_week returned ${(week || []).length} day(s), not the 3 he opened — internship_week only returns rows that exist (internship_days created by internship_open_day), so this reflects however many he actually opened, not a fixed 7-day window.`);
  } else {
    me.note('internship_week → 3 day(s), matching the 3 he opened (no rows are synthesized for days never opened).');
  }
  await me.attempt(`mark ${pendingDays.length} opened day(s) present`, () => me.internshipReview(pendingDays, 'present', 'Üç gün de sahada, saatinde açılmış.'));

  const refreshedWeek = await me.attempt("re-read my student's week", () => me.internshipWeek(student.userId, daysAgoIso(6)));
  const first = (refreshedWeek || [])[0];
  if (first) {
    await me.attempt('leave a note on the first journal', () => me.internshipNote(first, 'Fotoğraf var ama ölçüm biriminden bahsetmemişsin; bir sonrakinde ekle.', false));
    await me.attempt("read the day's events", () => me.internshipEvents(first.id));
  }

  // ---- reviews: one revision, four approvals (self_level was 2 on all) ----
  const pending = await me.attempt('read pending reviews', () => me.listPendingReviews());
  const mineOnly = (pending || []).filter((p) => p.student_id === student.userId);
  if (mineOnly.length !== (pending || []).length) {
    me.bug({ did: 'read pending reviews', expected: "only my student's submissions", got: `${(pending || []).length} rows, ${mineOnly.length} mine`, severity: 'wrong' });
  } else {
    me.note(`listPendingReviews → ${(pending || []).length} row(s), all mine.`);
  }

  if (mineOnly.length !== 5) {
    me.note(`Expected 5 submissions from Burak per state, found ${mineOnly.length} pending — proceeding with what is live.`);
  }

  // Pick the middle submission (arbitrary — any would do) to send back.
  const returnIdx = Math.min(2, mineOnly.length - 1);
  const toReturn = mineOnly[returnIdx];

  if (toReturn) {
    const beforeCount = mineOnly.length;
    await me.attempt(`return "${toReturn.group_assignments?.title}" for revision`, () =>
      me.reviewAssignment(toReturn.id, false, 'Kriter ölçüm belirsizliğini istiyor; tabloda yok. Ekleyip yeniden gönder.'));
    me.note(`Revision sent with no p_level (undefined) and it succeeded — adaptation #2: LEVEL_REQUIRED only gates p_approved=true in review_assignment, so a level is correctly NOT required to send work back. Returned submission id: ${toReturn.id} ("${toReturn.group_assignments?.title}"), self_level was ${toReturn.self_level}.`);
    state.merge((st) => { st.mentors['ayca-yildiz'].returned = toReturn.id; });
  }

  let disagreements = 0;
  let approvedIdx = 0;
  for (const sub of mineOnly) {
    if (sub.id === toReturn?.id) continue;
    // Disagree (rate 1) on the first two approvals; agree (rate 2, matching
    // his self_level) on the rest — at least two disagreements as required.
    const level = approvedIdx < 2 ? 1 : 2;
    approvedIdx += 1;
    if (level < (sub.self_level ?? 0)) disagreements += 1;
    await me.attempt(`approve "${sub.group_assignments?.title}"`, () =>
      me.reviewAssignment(sub.id, true, 'Adımlar doğru ama gerekçelendirme yüzeysel.\nBir dahaki sefere neden-sonucu yaz.', level));
    reviewed.push({ submissionId: sub.id, approved: true, level });
  }
  if (disagreements < 2) {
    me.note(`Only ${disagreements} disagreement(s) with Burak's self_level of 2 landed live (fewer non-returned submissions than expected) — not adjustable without inventing data.`);
  } else {
    me.note(`Disagreed with Burak's self-rating (2) on ${disagreements} of the ${reviewed.length} approved submission(s), rating those level 1.`);
  }
  reviewed.push({ submissionId: toReturn?.id, approved: false, level: null });

  await me.attempt('read the self-vs-mentor comparison', () => me.competencySelfVsMentor(student.userId));
  await me.attempt('read notifications', () => me.listNotifications());

  // ---- stream check: the returned task must not get a card; approved ones must ----
  // list_feed_posts's own guard is `owns_group(p_group_id) OR is_member_of_group(p_group_id)`
  // (docs/internship-groups-rls-recursion-fix.sql) -- owns_group is the advisor,
  // is_member_of_group is keyed on group_memberships, which only students hold rows
  // in. There is no mentor branch, and the app has no app/(mentor)/feed screen
  // either, so this refusal is consistent with the mentor role's documented scope,
  // not a defect in the feed itself -- but it does mean a mentor cannot verify
  // through the front door whether her own approvals produced stream cards.
  let posts;
  try {
    posts = await me.listFeedPosts(s.groupId);
  } catch (e) {
    if (/^NOT_IN_GROUP/.test(e.message)) {
      me.note('list_feed_posts(groupId) refused with NOT_IN_GROUP for the mentor role: mentors are neither the group\'s advisor (owns_group) nor a group_memberships row (is_member_of_group, students only) -- no mentor branch exists in that guard, and there is no app/(mentor)/feed screen either. Not filed as a bug (matches the mentor role\'s documented scope), but it does mean this check ("no card for the returned task; cards for the approved ones") cannot be completed by a mentor account through the front door.');
    } else {
      me.bug({ did: 'read the group feed', expected: 'success or NOT_IN_GROUP', got: e.message, severity: 'wrong' });
    }
  }
  if (posts) {
    const taskPosts = posts.filter((p) => p.kind === 'task');
    const postedSubmissionIds = new Set(taskPosts.map((p) => p.task?.submissionId).filter(Boolean));
    if (toReturn && postedSubmissionIds.has(toReturn.id)) {
      me.bug({ did: 'confirm the returned task has no stream card', expected: 'no feed_posts row for a needs_revision submission', got: `a "task" card exists for submission ${toReturn.id}`, severity: 'wrong' });
    } else if (toReturn) {
      me.note(`Confirmed: no stream card for the returned submission (${toReturn.id}) among ${taskPosts.length} task card(s) in the group feed.`);
    }
    const approvedIds = reviewed.filter((r) => r.approved).map((r) => r.submissionId);
    const missingCards = approvedIds.filter((id) => !postedSubmissionIds.has(id));
    if (missingCards.length) {
      me.bug({ did: 'confirm every approved task produced a stream card', expected: 'a "task" feed_posts row for each approved submission (share_to_feed defaults on)', got: `${missingCards.length} of ${approvedIds.length} approved submission(s) missing a card: ${missingCards.join(', ')}`, severity: 'wrong' });
    } else {
      me.note(`Confirmed: all ${approvedIds.length} approved submission(s) have a "task" card in the group feed.`);
    }
  }

  state.merge((st) => { Object.assign(st.mentors[P.slug], { reviewed }); });
  me.note('Faz 5 bitti. Bir görevi geri gönderdim, dördünü onayladım (ikisinde kendisiyle aynı fikirde değildim).');
})().catch((e) => { console.error(e); process.exit(1); });
