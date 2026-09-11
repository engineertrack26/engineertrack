# Group Feed — design

**Date:** 2026-09-11
**Status:** approved in conversation, awaiting written review
**Replaces:** the Polls feature (screens only; tables stay)

## 1. What this is

A per-group sharing page, like a Google Classroom stream, between an advisor
and the students of one internship group. A group never sees another
group's feed. Three kinds of post live in it:

- **task** — a student's approved task, posted automatically when the mentor
  approves it, unless the student has turned sharing off for that task.
- **announcement** — free text written by the advisor.
- **poll** — one question, 2–6 options, one changeable vote per person,
  written by the advisor.

Everyone in the group can like and comment on any post. The advisor can
remove any post or comment in their own group.

Mentors are not part of the feed: students in one group intern at different
companies, so a mentor has no relationship with the group as a whole.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| 1 | A task post shows title, competency · level, the student's note, photos and the document. **Reflection and the mentor's note stay private.** | The reflection is personal writing; the mentor's note is addressed to the student. |
| 2 | Sharing is decided **per task**, default on, changeable after the fact. | The student decides per piece of work what the group sees, as in a classroom. |
| 3 | The advisor **posts announcements and polls**; students never post freely — their posts are their approved tasks. | The stream has an owner and does not sit empty; the app stays about the work. |
| 4 | The feed poll is **one question, 2–6 options**. The existing multi-question quiz/survey builder retires. | A quiz is a different feature; the stream wants a question, not a form. |
| 5 | The old `polls*` tables **stay**; the three polls screens, `PollsManagerScreen`, `pollService` and `types/poll.ts` go. The Polls tab slot becomes **Feed**. | Same retirement pattern as the daily log: no data loss, no dead screens. |
| 6 | Notifications: students get one for an advisor's announcement or poll and for a comment on their own post; the advisor gets one when a student's task reaches the feed. **Likes are silent.** | Fatigue is the failure mode of feeds. |
| 7 | One `feed_posts` table carries all three kinds; likes and comments hang off one `post_id`. | One feed, one query, one RLS rule. The alternative — computing task posts from submissions and merging with a second table — duplicates every rule twice. |
| 8 | Withdrawing a task from the feed **deletes** its post row, with its likes and comments. Re-enabling writes a fresh post. | Withdrawal is a privacy act; comments on a hidden post serve nobody. |
| 9 | A student who leaves the group loses access; their posts remain as the group's history. | Same rule the rest of the app applies to a closed membership. |

## 3. Data model

### `assignment_submissions.share_to_feed`
`BOOLEAN NOT NULL DEFAULT true`. `submit_assignment` is not changed: a
sixth defaulted parameter would overload the five-argument signature and
make every existing five-argument call ambiguous, and re-issuing a 150-line
SECURITY DEFINER body to add one column is more risk than the column is
worth. Instead the client calls `set_submission_sharing(id, false)`
immediately after `submit_assignment` returns when the switch is off, and
surfaces a failure of that second call rather than swallowing it. Changing
the flag later goes through the same RPC.

### `feed_posts`
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `group_id` | → `internship_groups` | every post belongs to exactly one group |
| `author_id` | → `profiles` | the student for `task`, the advisor otherwise |
| `kind` | text CHECK in (`task`,`announcement`,`poll`) | |
| `submission_id` | → `assignment_submissions`, **UNIQUE**, nullable | one submission, at most one post |
| `body` | text, ≤ 2000 chars | announcement / poll question; NULL for `task` |
| `created_at` | timestamptz | feed order |

CHECK: `(kind = 'task') = (submission_id IS NOT NULL)`.
A task post copies nothing from the submission — title, competency, note,
photos and document are read through the join, so there is one source of
truth and the feed cannot drift from the review screen.

**The feed is read through one RPC, `list_feed_posts`, not by selecting the
tables directly.** `assignment_submissions`' read policy is
`student_id = auth.uid() OR is_mentor_of OR is_group_advisor_of` — a
student cannot select a classmate's submission, and `log_photos` /
`log_documents` follow the same rule. Widening those policies would expose
the reflection and the mentor's note, which decision 1 keeps private. So
`list_feed_posts(p_group_id, p_before, p_limit)` runs `SECURITY DEFINER`,
checks `owns_group OR is_member_of_group` itself, and projects exactly the
shared fields: post, author name, task title, competency · level, the
student's note, evidence paths, like and comment counts, and the caller's
own like and vote. Reflection and mentor note never leave the function.
Comments are selected directly (their policy is `can_see_post`).

### `feed_poll_options`
`id`, `post_id` → `feed_posts` (cascade), `position` int, `label` text ≤ 80.
UNIQUE (`post_id`, `position`).

### `feed_poll_votes`
`post_id`, `option_id` → `feed_poll_options`, `user_id`, `created_at`.
UNIQUE (`post_id`, `user_id`) — one vote, upsert to change it.

### `feed_likes`
`post_id` (cascade), `user_id`, `created_at`. UNIQUE (`post_id`, `user_id`).

### `feed_comments`
`id`, `post_id` (cascade), `author_id`, `body` ≤ 2000, `created_at`. Flat;
no replies.

### Indexes
`feed_posts (group_id, created_at DESC)` for the feed page;
`feed_comments (post_id, created_at)`; the UNIQUE constraints above cover
likes and votes.

## 4. How a task post is born and dies

`trg_feed_task_post`: `AFTER UPDATE OF status ON assignment_submissions`,
`WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved')`.
It calls `feed_publish_submission(submission_id)`, which inserts a `task`
post into the student's **active** group (`group_memberships.left_at IS
NULL`) if `share_to_feed` is true and no post exists yet, and notifies the
group's advisor (`feed_task_post`).

`set_submission_sharing(p_submission_id, p_share)`:
- caller must own the submission (`NOT_OWNER`);
- `false` → `UPDATE share_to_feed`, then `DELETE FROM feed_posts WHERE
  submission_id = …` (likes and comments cascade);
- `true` → `UPDATE share_to_feed`, then if the submission is approved call
  the same `feed_publish_submission` — one implementation, not two.

## 5. Authorisation

One rule, stated once: a row is visible or writable iff
`owns_group(group_id) OR is_member_of_group(group_id)`. Both helpers already
exist (`docs/internship-groups-rls-recursion-fix.sql`), are `SECURITY
DEFINER`, and cannot re-enter a policy.

`feed_poll_options`, `feed_poll_votes`, `feed_likes` and `feed_comments`
carry no `group_id`; their policies go through one new helper,
`can_see_post(p_post_id)` (`SECURITY DEFINER`, reads `feed_posts` and applies
the rule above). Policies never read `feed_posts` directly — that is how the
`42P17` mutual recursion D1 hit is kept out.

| table | select | insert | delete |
|---|---|---|---|
| `feed_posts` | rule | `announcement`/`poll`: `owns_group`; `task`: trigger only (SECURITY DEFINER) | `owns_group` of the row's group. A student never deletes a `task` post directly — "Remove from feed" goes through `set_submission_sharing(false)`, so the flag and the row cannot disagree |
| `feed_comments` | `can_see_post` | `can_see_post` and `author_id = auth.uid()` | own row, or `owns_group` of the post's group |
| `feed_likes` | `can_see_post` | `can_see_post` and `user_id = auth.uid()` | own row |
| `feed_poll_options` | `can_see_post` | via `create_feed_post` only | cascade |
| `feed_poll_votes` | `can_see_post` | via `vote_feed_poll` only | own row |

Mentors match neither helper and see nothing.

## 6. RPCs

All `SECURITY DEFINER`, refusing with codes that `mapRpcError` maps to
`errors.*` keys.

- `create_feed_post(p_group_id, p_kind, p_body, p_options TEXT[] DEFAULT NULL)`
  — `NOT_GROUP_OWNER`; `kind = 'task'` refused (`KIND_NOT_ALLOWED`); for
  `poll`, 2–6 non-empty options or `POLL_OPTIONS_RANGE`. Writes the post,
  the options, and one `feed_announcement` / `feed_poll` notification per
  active student **in the same transaction** — the client-side notification
  path failed with 42501 on every call once and a `.catch` hid it; nothing
  here repeats that.
- `vote_feed_poll(p_post_id, p_option_id)` — `NOT_IN_GROUP`;
  `OPTION_MISMATCH` if the option is not that post's; upsert on
  (`post_id`, `user_id`).
- `set_submission_sharing(p_submission_id, p_share)` — see §4.
- Likes, comments and deletes are direct table writes under RLS. Comment
  notifications (`feed_comment`, to the post's author, skipped when the
  author comments on their own post) come from an `AFTER INSERT` trigger on
  `feed_comments`.

## 7. Screens

**Routes:** `app/(student)/feed.tsx` and `app/(advisor)/feed.tsx` replace
`polls.tsx`; both render `FeedScreen({ role })` from
`src/components/screens`. The mentor's `polls.tsx` is deleted with no
replacement; the mentor's tab bar ends at **6** visible.

**`FeedScreen`**
- *Top:* the advisor sees "Write announcement" and "Create poll"; a
  multi-group advisor gets the same group selector Reports uses (archived
  groups dimmed and badged, never the silent default). Students see their
  active group's feed, or "You'll see your group's feed once you join one".
- *List:* newest first, keyset pagination on `created_at` (the
  notifications pattern), pull-to-refresh, realtime prepend on
  `feed_posts` INSERT for the selected group, `LoadFailedBanner` on
  failure.
- *Card by kind:*
  - `task` — author (name + initials avatar), task title, competency ·
    level, the student's note, photo grid (tap → the existing lightbox),
    document row (signed URL via `signEvidence`, expiring, path stored).
    The author's own card carries "Remove from feed".
  - `announcement` — author + body.
  - `poll` — question; before voting, tappable options; after, percentage
    bars and the total; tapping another option changes the vote.
  - Footer: ♥ count (tap toggles), 💬 count (tap expands a flat comment
    list with an input).
- *Advisor:* "Remove" on every post and comment in their group, behind a
  confirm.

**Student task form (`my-tasks.tsx`):** a switch above Submit — "Share in
the group feed when approved", default on, passed as `p_share`. On an
approved task's card the same switch, live, through
`set_submission_sharing`.

**Composers (advisor):** announcement → one text field with a counter;
poll → question + 2–6 option rows (add / remove). Modal, in the same visual
language as the assignment card editor.

**Empty states:** "Nothing shared yet — approved tasks will appear here."

## 8. Notifications

Four new `NotificationType` values: `feed_announcement`, `feed_poll`,
`feed_comment`, `feed_task_post`. `routeForNotification` sends all four to
`/(role)/feed` with `post=<id>`; `FeedScreen` scrolls to and highlights that
post once loaded, and ignores an id that is not in the list. `poll_available`
routing is removed with the polls screens.

## 9. Limits (enforced as CHECK constraints; the client only shows counters)

Announcement and comment body ≤ 2000; poll question ≤ 200; option label
≤ 80; options 2–6.

## 10. Verification

`docs/group-feed-verification.sql`, evaluated under `SET LOCAL ROLE
authenticated` with `request.jwt.claims` set per case — an owner-run script
proves a policy exists, not that it evaluates:

1. A student of group A cannot select group B's posts, comments or votes
   (three tables, three assertions).
2. A student cannot insert an `announcement`; a mentor sees zero rows of
   every feed table.
3. Approval with `share_to_feed = true` creates exactly one post; approval
   with `false` creates none; a second approval-shaped update creates no
   duplicate.
4. `set_submission_sharing(false)` removes the post and its two comments;
   `set_submission_sharing(true)` brings a post back.
5. A second vote by the same user changes the first; the count stays 1.
6. A student whose membership is closed sees nothing; their post remains.
7. `create_feed_post` writes one notification per active student and none
   for a member who has left.

**Jest:** `routeForNotification` for the four new types; poll percentage
helper (0 votes → 0%, rounding sums sensibly); comment/like optimistic
update helpers.

## 11. Out of scope

Threaded replies, editing a post or comment, announcements with media,
mentors in the feed, reporting or flagging, reactions other than like,
cross-group or institution-wide feeds.
