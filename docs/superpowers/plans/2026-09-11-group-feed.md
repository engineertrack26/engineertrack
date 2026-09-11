# Group Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-group feed between an advisor and their group's students — approved tasks appear automatically (unless the student opts out per task), the advisor posts announcements and one-question polls, everyone likes and comments — replacing the Polls screens.

**Architecture:** One `feed_posts` table with three kinds; likes, comments and poll votes hang off `post_id`. A trigger on `assignment_submissions` writes a task post on approval. Reads go through one `SECURITY DEFINER` RPC (`list_feed_posts`) because students cannot select each other's submissions and must never see the reflection or the mentor's note. RLS on every feed table is the single rule `owns_group(group_id) OR is_member_of_group(group_id)`, routed through a `can_see_post` helper for the child tables. One `FeedScreen({ role })` renders for student and advisor.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / TypeScript 6 / Supabase (Postgres + RLS + realtime) / Zustand / i18next / jest.

**Spec:** `docs/superpowers/specs/2026-09-11-group-feed-design.md`

## Global Constraints

- SQL is applied by the user in the Supabase SQL editor, one file per message, in this order: `docs/group-feed-migration.sql`, `docs/group-feed-rpcs.sql`, `docs/group-feed-verification.sql`. Anonymous `$$` only — a named dollar tag fails with `42601` in that editor.
- Verification Part A is structural (the editor runs as table owner and bypasses RLS). Part C evaluates policies under `SET LOCAL ROLE authenticated` with `request.jwt.claims` carrying both `sub` and `'role': 'authenticated'`.
- Reflection (`assignment_submissions.reflection`) and the mentor's note (`mentor_note`) never leave `list_feed_posts`.
- Every RLS policy on `feed_comments`, `feed_likes`, `feed_poll_options`, `feed_poll_votes` goes through `can_see_post(post_id)`; no policy body selects `feed_posts` directly (`42P17` guard).
- Limits as CHECK constraints: body ≤ 2000, poll question ≤ 200, option label ≤ 80, options 2–6.
- Only `src/i18n/locales/en.json` among the seven locale files; every user-facing string through `t()`.
- Every RPC refusal reaches the user through `mapRpcError`; new codes: `NOT_GROUP_OWNER`, `NOT_IN_GROUP`, `NOT_OWNER`, `KIND_NOT_ALLOWED`, `POLL_OPTIONS_RANGE`, `OPTION_MISMATCH`, `POST_NOT_FOUND`.
- Path aliases (`@/...`), never relative imports out of `src/`.
- Tab bars end at: **student 7 visible, advisor 6 visible, mentor 6 visible** (mentor loses Polls and gets nothing back).
- `npx tsc --noEmit` silent (with `noUnusedLocals` / `noUnusedParameters` on); `npx jest --silent` green at **8 suites / 49 tests** plus what Task 3 adds (**9 suites / 58 tests** after Task 3).
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and the `Claude-Session:` line if your tooling adds one.
- Do not touch `app/(advisor)/group-assignments.tsx`, `src/components/cards/AssignmentCard.tsx`, `app/(advisor)/reports.tsx`, `src/services/advisor.ts`.

---

## File Structure

**SQL (create)**
- `docs/group-feed-migration.sql` — column, four tables, CHECKs, indexes, `can_see_post`, RLS, `feed_publish_submission`, two triggers, realtime publication.
- `docs/group-feed-rpcs.sql` — `set_submission_sharing`, `create_feed_post`, `vote_feed_poll`, `list_feed_posts`.
- `docs/group-feed-verification.sql` — Parts A / B / C.

**Client (create)**
- `src/types/feed.ts` — `FeedPost`, `FeedTask`, `FeedPoll`, `FeedComment`.
- `src/services/feed.ts` — `feedService`: `listPosts`, `createPost`, `vote`, `setLiked`, `listComments`, `addComment`, `deleteComment`, `deletePost`, `setSubmissionSharing`.
- `src/utils/feedMetrics.ts` + `src/utils/__tests__/feedMetrics.test.ts` — `pollPercentages`, `withLike`.
- `src/components/screens/FeedScreen.tsx` — list, group selector, composers' entry points, realtime, pagination.
- `src/components/feed/FeedPostCard.tsx` — one post (task / announcement / poll) with like + comment footer.
- `src/components/feed/FeedComments.tsx` — inline flat comment list + input.
- `src/components/feed/FeedComposer.tsx` — announcement / poll modal.
- `src/components/feed/index.ts` — barrel.
- `app/(student)/feed.tsx`, `app/(advisor)/feed.tsx` — route wrappers.

**Client (modify)**
- `src/utils/rpcErrors.ts` — seven codes. `src/i18n/locales/en.json` — `errors.*`, `feed.*`, `tabs.feed`, `student.shareToFeed*`.
- `src/types/notification.ts` — four types. `src/utils/notificationRoutes.ts` + test — four routes.
- `src/services/assignments.ts` — nothing. `app/(student)/my-tasks.tsx` — the sharing switch.
- `app/(student)/_layout.tsx`, `app/(advisor)/_layout.tsx` — `polls` → `feed`. `app/(mentor)/_layout.tsx` — `polls` removed.

**Delete**
- `app/(student)/polls.tsx`, `app/(mentor)/polls.tsx`, `app/(advisor)/polls.tsx`, `src/components/screens/PollsManagerScreen.tsx`, `src/services/polls.ts`, `src/types/poll.ts`, the `polls.*` block in `en.json`, the `poll_available` branches in `notificationRoutes.ts`.

---

### Task 1: Migration — tables, policies, the task-post trigger

**Files:**
- Create: `docs/group-feed-migration.sql`
- Create: `docs/group-feed-verification.sql` (Part A only in this task; Parts B and C are added in Task 2)

**Interfaces:**
- Consumes: `owns_group(uuid)`, `is_member_of_group(uuid)` from `docs/internship-groups-rls-recursion-fix.sql`; `notifications(user_id, title, body, type, data)`.
- Produces: tables `feed_posts`, `feed_poll_options`, `feed_poll_votes`, `feed_likes`, `feed_comments`; column `assignment_submissions.share_to_feed`; functions `can_see_post(uuid)`, `feed_publish_submission(uuid)`; triggers `trg_feed_task_post`, `trg_feed_comment_notify`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================
-- Group feed: tables, policies, and the trigger that turns an approved
-- task into a post.
--
-- Idempotent and safe to re-apply. Apply order: this file, then
-- docs/group-feed-rpcs.sql, then docs/group-feed-verification.sql.
-- Anonymous $$ only in the Supabase SQL editor.
-- ============================================

-- ---- The per-task sharing decision ----
ALTER TABLE assignment_submissions
  ADD COLUMN IF NOT EXISTS share_to_feed BOOLEAN NOT NULL DEFAULT true;

-- ---- feed_posts ----
CREATE TABLE IF NOT EXISTS feed_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES internship_groups(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('task', 'announcement', 'poll')),
  submission_id UUID UNIQUE REFERENCES assignment_submissions(id) ON DELETE CASCADE,
  body          TEXT CHECK (body IS NULL OR char_length(body) <= 2000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A task post is exactly a post with a submission; the other two kinds have
-- none. Stated as one equality so neither half can drift.
ALTER TABLE feed_posts DROP CONSTRAINT IF EXISTS feed_posts_task_has_submission;
ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_task_has_submission
  CHECK ((kind = 'task') = (submission_id IS NOT NULL));

-- A poll's question is its body; capped shorter than an announcement.
ALTER TABLE feed_posts DROP CONSTRAINT IF EXISTS feed_posts_poll_question_length;
ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_poll_question_length
  CHECK (kind <> 'poll' OR (body IS NOT NULL AND char_length(body) <= 200));

CREATE INDEX IF NOT EXISTS idx_feed_posts_group_created
  ON feed_posts(group_id, created_at DESC);

-- ---- feed_poll_options ----
CREATE TABLE IF NOT EXISTS feed_poll_options (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id  UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  position INT  NOT NULL,
  label    TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  UNIQUE (post_id, position)
);

-- ---- feed_poll_votes ----
CREATE TABLE IF NOT EXISTS feed_poll_votes (
  post_id    UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  option_id  UUID NOT NULL REFERENCES feed_poll_options(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- ---- feed_likes ----
CREATE TABLE IF NOT EXISTS feed_likes (
  post_id    UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- ---- feed_comments ----
CREATE TABLE IF NOT EXISTS feed_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_comments_post_created
  ON feed_comments(post_id, created_at);

-- ---- The one visibility rule, as a helper the child tables route through ----
-- SECURITY DEFINER so a policy on feed_comments calling it does not re-enter
-- the feed_posts policy (42P17). Same shape as owns_group / is_member_of_group.
CREATE OR REPLACE FUNCTION can_see_post(p_post_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM feed_posts p
    WHERE p.id = p_post_id
      AND (owns_group(p.group_id) OR is_member_of_group(p.group_id))
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
GRANT EXECUTE ON FUNCTION can_see_post(UUID) TO authenticated;

-- ---- RLS ----
ALTER TABLE feed_posts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_poll_votes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_likes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_comments     ENABLE ROW LEVEL SECURITY;

-- feed_posts: read by owner or member. Direct INSERT is allowed only for the
-- advisor's own announcements and polls (create_feed_post is the normal
-- path, but the policy is what makes a task post unforgeable: kind = 'task'
-- never passes here, only the SECURITY DEFINER publisher writes it).
-- DELETE: the advisor of the group, any kind. A student never deletes a
-- task post directly -- set_submission_sharing(false) does, so the flag and
-- the row cannot disagree.
DROP POLICY IF EXISTS feed_posts_select ON feed_posts;
CREATE POLICY feed_posts_select ON feed_posts FOR SELECT TO authenticated
  USING (owns_group(group_id) OR is_member_of_group(group_id));

DROP POLICY IF EXISTS feed_posts_insert ON feed_posts;
CREATE POLICY feed_posts_insert ON feed_posts FOR INSERT TO authenticated
  WITH CHECK (kind IN ('announcement', 'poll')
              AND author_id = auth.uid()
              AND owns_group(group_id));

DROP POLICY IF EXISTS feed_posts_delete ON feed_posts;
CREATE POLICY feed_posts_delete ON feed_posts FOR DELETE TO authenticated
  USING (owns_group(group_id));

-- feed_poll_options: readable with the post; written only by create_feed_post.
DROP POLICY IF EXISTS feed_poll_options_select ON feed_poll_options;
CREATE POLICY feed_poll_options_select ON feed_poll_options FOR SELECT TO authenticated
  USING (can_see_post(post_id));

-- feed_poll_votes: readable with the post; written only by vote_feed_poll;
-- a voter may withdraw their own vote.
DROP POLICY IF EXISTS feed_poll_votes_select ON feed_poll_votes;
CREATE POLICY feed_poll_votes_select ON feed_poll_votes FOR SELECT TO authenticated
  USING (can_see_post(post_id));
DROP POLICY IF EXISTS feed_poll_votes_delete ON feed_poll_votes;
CREATE POLICY feed_poll_votes_delete ON feed_poll_votes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- feed_likes: anyone who can see the post may like it as themselves and
-- withdraw their own like.
DROP POLICY IF EXISTS feed_likes_select ON feed_likes;
CREATE POLICY feed_likes_select ON feed_likes FOR SELECT TO authenticated
  USING (can_see_post(post_id));
DROP POLICY IF EXISTS feed_likes_insert ON feed_likes;
CREATE POLICY feed_likes_insert ON feed_likes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND can_see_post(post_id));
DROP POLICY IF EXISTS feed_likes_delete ON feed_likes;
CREATE POLICY feed_likes_delete ON feed_likes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- feed_comments: same, plus the group's advisor may remove any comment.
DROP POLICY IF EXISTS feed_comments_select ON feed_comments;
CREATE POLICY feed_comments_select ON feed_comments FOR SELECT TO authenticated
  USING (can_see_post(post_id));
DROP POLICY IF EXISTS feed_comments_insert ON feed_comments;
CREATE POLICY feed_comments_insert ON feed_comments FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND can_see_post(post_id));
DROP POLICY IF EXISTS feed_comments_delete ON feed_comments;
CREATE POLICY feed_comments_delete ON feed_comments FOR DELETE TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (SELECT 1 FROM feed_posts p
               WHERE p.id = feed_comments.post_id AND owns_group(p.group_id))
  );

-- ---- Turning an approved submission into a post ----
-- One implementation, called from the approval trigger AND from
-- set_submission_sharing(true), so the two paths cannot disagree.
-- Idempotent: a submission that already has a post gets nothing.
CREATE OR REPLACE FUNCTION feed_publish_submission(p_submission_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student    UUID;
  v_share      BOOLEAN;
  v_status     TEXT;
  v_group      UUID;
  v_advisor    UUID;
  v_title      TEXT;
  v_name       TEXT;
  v_post       UUID;
BEGIN
  SELECT s.student_id, s.share_to_feed, s.status, a.title
  INTO v_student, v_share, v_status, v_title
  FROM assignment_submissions s
  JOIN group_assignments a ON a.id = s.assignment_id
  WHERE s.id = p_submission_id;

  IF v_student IS NULL OR NOT v_share OR v_status <> 'approved' THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM feed_posts WHERE submission_id = p_submission_id) THEN
    RETURN NULL;
  END IF;

  -- The student's ACTIVE group. one_active_group_per_student guarantees at
  -- most one row; none means the student has left every group and the post
  -- has no feed to land in.
  SELECT m.group_id INTO v_group
  FROM group_memberships m
  WHERE m.student_id = v_student AND m.left_at IS NULL
  LIMIT 1;
  IF v_group IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO feed_posts (group_id, author_id, kind, submission_id)
  VALUES (v_group, v_student, 'task', p_submission_id)
  RETURNING id INTO v_post;

  -- Tell the advisor. Wrapped so a notification failure cannot undo the
  -- post -- but WARN, never swallow: the notification bug that hid for
  -- weeks was a silent catch.
  BEGIN
    SELECT g.advisor_id INTO v_advisor FROM internship_groups g WHERE g.id = v_group;
    SELECT trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    INTO v_name FROM profiles p WHERE p.id = v_student;
    IF v_advisor IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, body, type, data)
      VALUES (
        v_advisor,
        'New in the feed',
        coalesce(nullif(v_name, ''), 'A student')
          || ' shared "' || coalesce(v_title, 'a task') || '".',
        'feed_task_post',
        jsonb_build_object('postId', v_post, 'groupId', v_group)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'feed_publish_submission: advisor notification failed: %', SQLERRM;
  END;

  RETURN v_post;
END;
$$;
-- Not granted to authenticated: only the trigger below and
-- set_submission_sharing (both SECURITY DEFINER, both owner-run) call it.
REVOKE EXECUTE ON FUNCTION feed_publish_submission(UUID) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION trg_feed_task_post_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM feed_publish_submission(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_task_post ON assignment_submissions;
CREATE TRIGGER trg_feed_task_post
  AFTER UPDATE OF status ON assignment_submissions
  FOR EACH ROW
  WHEN (NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved')
  EXECUTE FUNCTION trg_feed_task_post_fn();

-- ---- A comment notifies the post's author (not for their own comment) ----
CREATE OR REPLACE FUNCTION trg_feed_comment_notify_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author UUID;
  v_group  UUID;
  v_name   TEXT;
BEGIN
  SELECT p.author_id, p.group_id INTO v_author, v_group
  FROM feed_posts p WHERE p.id = NEW.post_id;
  IF v_author IS NULL OR v_author = NEW.author_id THEN
    RETURN NEW;
  END IF;
  SELECT trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, ''))
  INTO v_name FROM profiles pr WHERE pr.id = NEW.author_id;
  BEGIN
    INSERT INTO notifications (user_id, title, body, type, data)
    VALUES (
      v_author,
      'New comment',
      coalesce(nullif(v_name, ''), 'Someone') || ' commented on your post.',
      'feed_comment',
      jsonb_build_object('postId', NEW.post_id, 'groupId', v_group)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'feed comment notification failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_comment_notify ON feed_comments;
CREATE TRIGGER trg_feed_comment_notify
  AFTER INSERT ON feed_comments
  FOR EACH ROW EXECUTE FUNCTION trg_feed_comment_notify_fn();

-- ---- Realtime: the screen prepends new posts as they arrive ----
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'feed_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE feed_posts;
  END IF;
END $$;
```

- [ ] **Step 2: Write verification Part A**

Create `docs/group-feed-verification.sql` with this header and Part A. Parts B and C are appended in Task 2.

```sql
-- ============================================================
-- Group feed verification
--
-- Run in the Supabase SQL editor. Anonymous $$ only.
-- Apply order: docs/group-feed-migration.sql, docs/group-feed-rpcs.sql,
-- then this file, ONE PART PER SUBMISSION.
--
-- PART A is STRUCTURAL: the editor runs as the table owner and bypasses
-- RLS, so these prove a table, column, constraint, trigger or policy
-- EXISTS -- never that a policy EVALUATES correctly. Part C does that.
-- ============================================================

-- ============================================================
-- PART A — schema assertions. Expected: one row "PASS: schema assertions held".
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'assignment_submissions' AND column_name = 'share_to_feed') THEN
    RAISE EXCEPTION 'FAIL: assignment_submissions.share_to_feed is missing';
  END IF;

  FOREACH t IN ARRAY ARRAY['feed_posts','feed_poll_options','feed_poll_votes','feed_likes','feed_comments'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      RAISE EXCEPTION 'FAIL: table % is missing', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = t AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'FAIL: RLS is not enabled on %', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feed_posts_task_has_submission') THEN
    RAISE EXCEPTION 'FAIL: feed_posts_task_has_submission CHECK is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_see_post') THEN
    RAISE EXCEPTION 'FAIL: can_see_post() is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'feed_publish_submission') THEN
    RAISE EXCEPTION 'FAIL: feed_publish_submission() is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_feed_task_post' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: trg_feed_task_post is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_feed_comment_notify' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: trg_feed_comment_notify is missing';
  END IF;

  -- Every child-table policy must route through can_see_post, never read
  -- feed_posts directly (42P17 guard). The one exception is
  -- feed_comments_delete's advisor branch, which is an EXISTS on feed_posts
  -- inside a DELETE policy and cannot recurse.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename IN ('feed_poll_options','feed_poll_votes','feed_likes','feed_comments')
      AND cmd = 'SELECT'
      AND coalesce(qual, '') NOT LIKE '%can_see_post%'
  ) THEN
    RAISE EXCEPTION 'FAIL: a child-table SELECT policy does not go through can_see_post';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'feed_posts') THEN
    RAISE EXCEPTION 'FAIL: feed_posts is not in the supabase_realtime publication';
  END IF;

  RAISE NOTICE 'PASS: schema assertions held';
END $$;
SELECT 'PASS: schema assertions held' AS result;
```

- [ ] **Step 3: Lint the SQL locally for balanced dollar quotes**

Run: `grep -c '\$\$' docs/group-feed-migration.sql`
Expected: an even number (every `$$` opens or closes a body).

- [ ] **Step 4: Commit**

```bash
git add docs/group-feed-migration.sql docs/group-feed-verification.sql
git commit -m "feat(feed): tables, policies and the approval-to-post trigger

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: RPCs — sharing, composing, voting, and the one read

**Files:**
- Create: `docs/group-feed-rpcs.sql`
- Modify: `docs/group-feed-verification.sql` (append Parts B and C)

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces (callable by `authenticated`):
  - `set_submission_sharing(p_submission_id UUID, p_share BOOLEAN) RETURNS VOID` — raises `NOT_AUTHENTICATED`, `SUBMISSION_NOT_FOUND`, `NOT_OWNER`.
  - `create_feed_post(p_group_id UUID, p_kind TEXT, p_body TEXT, p_options TEXT[] DEFAULT NULL) RETURNS UUID` — raises `NOT_AUTHENTICATED`, `NOT_GROUP_OWNER`, `KIND_NOT_ALLOWED`, `POLL_OPTIONS_RANGE`.
  - `vote_feed_poll(p_post_id UUID, p_option_id UUID) RETURNS VOID` — raises `NOT_AUTHENTICATED`, `POST_NOT_FOUND`, `NOT_IN_GROUP`, `OPTION_MISMATCH`.
  - `list_feed_posts(p_group_id UUID, p_before TIMESTAMPTZ DEFAULT NULL, p_limit INT DEFAULT 20) RETURNS SETOF JSONB` — raises `NOT_AUTHENTICATED`, `NOT_IN_GROUP`. Each row is one post object with exactly this shape:

```json
{
  "id": "uuid", "kind": "task|announcement|poll", "groupId": "uuid",
  "authorId": "uuid", "authorName": "Ada Lovelace", "body": "text or null",
  "createdAt": "2026-09-11T10:00:00+00:00",
  "likeCount": 3, "commentCount": 2, "likedByMe": false,
  "task": { "submissionId": "uuid", "title": "…", "competencyName": "…", "level": 2,
            "note": "student note or null",
            "photos": [{ "uri": "…", "caption": "…" }],
            "documents": [{ "uri": "…", "fileName": "…", "fileType": "…", "fileSize": 0 }] },
  "poll": { "options": [{ "id": "uuid", "label": "…", "position": 0, "votes": 4 }],
            "totalVotes": 9, "myOptionId": "uuid or null" }
}
```
`task` is `null` unless `kind = 'task'`; `poll` is `null` unless `kind = 'poll'`. Ordered `created_at DESC`; pass the oldest row's `createdAt` as `p_before` for the next page.

- [ ] **Step 1: Write the RPCs**

```sql
-- ============================================
-- Group feed RPCs. Apply after docs/group-feed-migration.sql.
-- All SECURITY DEFINER; the actor is always auth.uid(), never a parameter.
-- ============================================

-- ---- set_submission_sharing ----
-- The student's per-task decision, changeable at any time. false removes
-- the post (likes and comments cascade); true republishes if approved,
-- through the same function the approval trigger uses.
CREATE OR REPLACE FUNCTION set_submission_sharing(p_submission_id UUID, p_share BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  SELECT student_id INTO v_owner FROM assignment_submissions WHERE id = p_submission_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'SUBMISSION_NOT_FOUND';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'NOT_OWNER';
  END IF;

  UPDATE assignment_submissions SET share_to_feed = p_share WHERE id = p_submission_id;

  IF p_share THEN
    PERFORM feed_publish_submission(p_submission_id);
  ELSE
    DELETE FROM feed_posts WHERE submission_id = p_submission_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION set_submission_sharing(UUID, BOOLEAN) TO authenticated;

-- ---- create_feed_post ----
-- Advisor-only. Writes the post, the poll options, and one notification per
-- ACTIVE student in the same transaction -- a client-side notification
-- write failed with 42501 on every call once and a .catch hid it.
CREATE OR REPLACE FUNCTION create_feed_post(
  p_group_id UUID,
  p_kind     TEXT,
  p_body     TEXT,
  p_options  TEXT[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post   UUID;
  v_name   TEXT;
  v_count  INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF NOT owns_group(p_group_id) THEN
    RAISE EXCEPTION 'NOT_GROUP_OWNER';
  END IF;
  IF p_kind NOT IN ('announcement', 'poll') THEN
    RAISE EXCEPTION 'KIND_NOT_ALLOWED';
  END IF;
  IF btrim(coalesce(p_body, '')) = '' THEN
    RAISE EXCEPTION 'KIND_NOT_ALLOWED';
  END IF;

  IF p_kind = 'poll' THEN
    SELECT count(*) INTO v_count
    FROM unnest(coalesce(p_options, ARRAY[]::TEXT[])) AS o
    WHERE btrim(o) <> '';
    IF v_count < 2 OR v_count > 6 THEN
      RAISE EXCEPTION 'POLL_OPTIONS_RANGE';
    END IF;
  END IF;

  INSERT INTO feed_posts (group_id, author_id, kind, body)
  VALUES (p_group_id, auth.uid(), p_kind, btrim(p_body))
  RETURNING id INTO v_post;

  IF p_kind = 'poll' THEN
    INSERT INTO feed_poll_options (post_id, position, label)
    SELECT v_post, ord - 1, btrim(o)
    FROM unnest(p_options) WITH ORDINALITY AS u(o, ord)
    WHERE btrim(o) <> '';
  END IF;

  SELECT trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
  INTO v_name FROM profiles p WHERE p.id = auth.uid();

  INSERT INTO notifications (user_id, title, body, type, data)
  SELECT m.student_id,
         CASE WHEN p_kind = 'poll' THEN 'New poll' ELSE 'New announcement' END,
         coalesce(nullif(v_name, ''), 'Your advisor')
           || CASE WHEN p_kind = 'poll' THEN ' asked: ' ELSE ' posted: ' END
           || left(btrim(p_body), 80),
         CASE WHEN p_kind = 'poll' THEN 'feed_poll' ELSE 'feed_announcement' END,
         jsonb_build_object('postId', v_post, 'groupId', p_group_id)
  FROM group_memberships m
  WHERE m.group_id = p_group_id AND m.left_at IS NULL;

  RETURN v_post;
END;
$$;
GRANT EXECUTE ON FUNCTION create_feed_post(UUID, TEXT, TEXT, TEXT[]) TO authenticated;

-- ---- vote_feed_poll ----
-- One vote per person per poll; voting again moves it.
CREATE OR REPLACE FUNCTION vote_feed_poll(p_post_id UUID, p_option_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group UUID;
  v_kind  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  SELECT group_id, kind INTO v_group, v_kind FROM feed_posts WHERE id = p_post_id;
  IF v_group IS NULL OR v_kind <> 'poll' THEN
    RAISE EXCEPTION 'POST_NOT_FOUND';
  END IF;
  IF NOT (owns_group(v_group) OR is_member_of_group(v_group)) THEN
    RAISE EXCEPTION 'NOT_IN_GROUP';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM feed_poll_options WHERE id = p_option_id AND post_id = p_post_id) THEN
    RAISE EXCEPTION 'OPTION_MISMATCH';
  END IF;

  INSERT INTO feed_poll_votes (post_id, option_id, user_id)
  VALUES (p_post_id, p_option_id, auth.uid())
  ON CONFLICT (post_id, user_id) DO UPDATE
    SET option_id = EXCLUDED.option_id, created_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION vote_feed_poll(UUID, UUID) TO authenticated;

-- ---- list_feed_posts ----
-- THE read. SECURITY DEFINER because a student cannot select a classmate's
-- assignment_submissions / log_photos / log_documents rows, and widening
-- those policies would expose the reflection and the mentor's note. This
-- function projects exactly the shared fields and nothing else.
CREATE OR REPLACE FUNCTION list_feed_posts(
  p_group_id UUID,
  p_before   TIMESTAMPTZ DEFAULT NULL,
  p_limit    INT DEFAULT 20
)
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF NOT (owns_group(p_group_id) OR is_member_of_group(p_group_id)) THEN
    RAISE EXCEPTION 'NOT_IN_GROUP';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id',           p.id,
    'kind',         p.kind,
    'groupId',      p.group_id,
    'authorId',     p.author_id,
    'authorName',   trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')),
    'body',         p.body,
    'createdAt',    p.created_at,
    'likeCount',    (SELECT count(*) FROM feed_likes l WHERE l.post_id = p.id),
    'commentCount', (SELECT count(*) FROM feed_comments c WHERE c.post_id = p.id),
    'likedByMe',    EXISTS (SELECT 1 FROM feed_likes l WHERE l.post_id = p.id AND l.user_id = auth.uid()),
    'task', CASE WHEN p.kind = 'task' THEN (
      SELECT jsonb_build_object(
        'submissionId',   s.id,
        'title',          a.title,
        'competencyName', c.name,
        'level',          k.level,
        'note',           s.student_note,
        'photos', coalesce((
          SELECT jsonb_agg(jsonb_build_object('uri', ph.uri, 'caption', ph.caption) ORDER BY ph.created_at)
          FROM log_photos ph WHERE ph.submission_id = s.id), '[]'::jsonb),
        'documents', coalesce((
          SELECT jsonb_agg(jsonb_build_object('uri', d.uri, 'fileName', d.file_name,
                                              'fileType', d.file_type, 'fileSize', d.file_size)
                           ORDER BY d.created_at)
          FROM log_documents d WHERE d.submission_id = s.id), '[]'::jsonb)
      )
      FROM assignment_submissions s
      JOIN group_assignments a ON a.id = s.assignment_id
      LEFT JOIN kpi_triplets tr ON tr.id = a.triplet_id
      LEFT JOIN competency_kpis k ON k.id = tr.kpi_id
      LEFT JOIN competencies c ON c.id = k.competency_id
      WHERE s.id = p.submission_id
    ) ELSE NULL END,
    'poll', CASE WHEN p.kind = 'poll' THEN jsonb_build_object(
      'options', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', o.id, 'label', o.label, 'position', o.position,
                 'votes', (SELECT count(*) FROM feed_poll_votes v WHERE v.option_id = o.id))
               ORDER BY o.position)
        FROM feed_poll_options o WHERE o.post_id = p.id), '[]'::jsonb),
      'totalVotes', (SELECT count(*) FROM feed_poll_votes v WHERE v.post_id = p.id),
      'myOptionId', (SELECT v.option_id FROM feed_poll_votes v
                     WHERE v.post_id = p.id AND v.user_id = auth.uid())
    ) ELSE NULL END
  )
  FROM feed_posts p
  JOIN profiles pr ON pr.id = p.author_id
  WHERE p.group_id = p_group_id
    AND (p_before IS NULL OR p.created_at < p_before)
  ORDER BY p.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 50));
END;
$$;
GRANT EXECUTE ON FUNCTION list_feed_posts(UUID, TIMESTAMPTZ, INT) TO authenticated;
```

Note on `log_photos.created_at` / `log_documents.created_at`: check the column exists (`grep -n "created_at" docs/database-schema.sql` around the `log_photos` table). If either table has no `created_at`, order by `id` instead in the two `jsonb_agg ... ORDER BY` clauses.

- [ ] **Step 2: Append verification Part B (RPC behaviour, owner-run)**

Append to `docs/group-feed-verification.sql`:

```sql
-- ============================================================
-- PART B — RPC behaviour, run as owner (auth.uid() is impersonated through
-- request.jwt.claims). Submit BEGIN..ROLLBACK in one go.
--   B1 approval with share_to_feed = true   -> exactly one task post
--   B2 approval with share_to_feed = false  -> no post
--   B3 second approval-shaped update        -> still one post (no duplicate)
--   B4 set_submission_sharing(false)        -> post AND its 2 comments gone
--   B5 set_submission_sharing(true)         -> a post is back
--   B6 create_feed_post poll with 1 option  -> POLL_OPTIONS_RANGE
--   B7 create_feed_post poll with 3 options -> 3 options, 1 notification per ACTIVE student
--   B8 vote twice as the same user          -> 1 vote, on the second option
-- Expected: eight rows, none beginning FAIL / SKIP / ABORTED.
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; stu2 UUID; grp UUID; kpi UUID; asg UUID; sub UUID; sub2 UUID;
  post UUID; opt1 UUID; opt2 UUID; n INT; m INT; log TEXT := '';
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu2 FROM profiles WHERE role = 'student' AND id <> stu ORDER BY created_at LIMIT 1;
  SELECT k.id INTO kpi FROM competency_kpis k WHERE k.level = 1 ORDER BY k.kpi_index LIMIT 1;

  IF adv IS NULL OR stu IS NULL OR kpi IS NULL THEN
    PERFORM set_config('probe.results', 'B1-B8' || E'\t' || 'SKIP: needs an advisor, a student and a KPI' || E'\n', true);
    RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe feed') RETURNING id INTO grp;
  UPDATE group_memberships SET left_at = now() WHERE student_id IN (stu, stu2) AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu);
  IF stu2 IS NOT NULL THEN
    -- stu2 is active for B2 and is closed out before B7, which asserts a
    -- member who has left gets no notification.
    INSERT INTO group_memberships (group_id, student_id) VALUES (grp, stu2);
  END IF;

  INSERT INTO group_assignments (group_id, triplet_id, title, objective, criterion, created_by, published_at)
  SELECT grp, tr.id, 'Probe task', tr.objective, tr.criterion, adv, now()
  FROM kpi_triplets tr WHERE tr.kpi_id = kpi ORDER BY tr.triplet_index LIMIT 1
  RETURNING id INTO asg;

  -- Two submissions by stu on two assignments would need two triplets; one
  -- assignment with the second submission by stu2 keeps the fixture small.
  INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection, share_to_feed)
  VALUES (asg, stu, 'submitted', 'r', true) RETURNING id INTO sub;

  -- B1
  UPDATE assignment_submissions SET status = 'approved' WHERE id = sub;
  SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
  log := log || 'B1 approval creates a task post' || E'\t'
      || CASE WHEN n = 1 THEN '1 post' ELSE 'FAIL: ' || n || ' posts' END || E'\n';

  -- B2
  IF stu2 IS NOT NULL THEN
    INSERT INTO assignment_submissions (assignment_id, student_id, status, reflection, share_to_feed)
    VALUES (asg, stu2, 'submitted', 'r', false) RETURNING id INTO sub2;
    UPDATE assignment_submissions SET status = 'approved' WHERE id = sub2;
    SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub2;
    log := log || 'B2 approval with sharing off creates nothing' || E'\t'
        || CASE WHEN n = 0 THEN '0 posts' ELSE 'FAIL: ' || n || ' posts' END || E'\n';
  ELSE
    log := log || 'B2 approval with sharing off creates nothing' || E'\t' || 'SKIP: needs a second student' || E'\n';
  END IF;

  -- B3: re-fire the trigger condition; the publisher must not duplicate.
  UPDATE assignment_submissions SET status = 'submitted' WHERE id = sub;
  UPDATE assignment_submissions SET status = 'approved' WHERE id = sub;
  SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
  log := log || 'B3 re-approval does not duplicate' || E'\t'
      || CASE WHEN n = 1 THEN '1 post' ELSE 'FAIL: ' || n || ' posts' END || E'\n';

  -- B4
  SELECT id INTO post FROM feed_posts WHERE submission_id = sub;
  INSERT INTO feed_comments (post_id, author_id, body) VALUES (post, adv, 'c1'), (post, adv, 'c2');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM set_submission_sharing(sub, false);
  SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
  SELECT count(*) INTO m FROM feed_comments WHERE post_id = post;
  log := log || 'B4 sharing off removes post and comments' || E'\t'
      || CASE WHEN n = 0 AND m = 0 THEN '0 posts, 0 comments'
              ELSE 'FAIL: ' || n || ' posts, ' || m || ' comments' END || E'\n';

  -- B5
  PERFORM set_submission_sharing(sub, true);
  SELECT count(*) INTO n FROM feed_posts WHERE submission_id = sub;
  log := log || 'B5 sharing on republishes' || E'\t'
      || CASE WHEN n = 1 THEN '1 post' ELSE 'FAIL: ' || n || ' posts' END || E'\n';

  -- B6
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adv, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM create_feed_post(grp, 'poll', 'One option?', ARRAY['only']);
    log := log || 'B6 poll with one option refused' || E'\t' || 'FAIL: accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'B6 poll with one option refused' || E'\t'
        || CASE WHEN SQLERRM LIKE 'POLL_OPTIONS_RANGE%' THEN 'POLL_OPTIONS_RANGE'
                ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;

  -- B7: stu2 leaves first; only stu (active) may be notified.
  UPDATE group_memberships SET left_at = now() WHERE group_id = grp AND student_id = stu2;
  DELETE FROM notifications WHERE type IN ('feed_poll', 'feed_announcement') AND user_id IN (stu, stu2);
  post := create_feed_post(grp, 'poll', 'Which?', ARRAY['A', 'B', 'C']);
  SELECT count(*) INTO n FROM feed_poll_options WHERE post_id = post;
  SELECT count(*) INTO m FROM notifications WHERE type = 'feed_poll' AND (data->>'postId')::uuid = post;
  log := log || 'B7 poll writes options and notifies active members' || E'\t'
      || CASE WHEN n = 3 AND m = 1 THEN '3 options, 1 notification'
              ELSE 'FAIL: ' || n || ' options, ' || m || ' notifications' END || E'\n';

  -- B8
  SELECT id INTO opt1 FROM feed_poll_options WHERE post_id = post AND position = 0;
  SELECT id INTO opt2 FROM feed_poll_options WHERE post_id = post AND position = 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  PERFORM vote_feed_poll(post, opt1);
  PERFORM vote_feed_poll(post, opt2);
  SELECT count(*) INTO n FROM feed_poll_votes WHERE post_id = post AND user_id = stu;
  SELECT count(*) INTO m FROM feed_poll_votes WHERE post_id = post AND user_id = stu AND option_id = opt2;
  log := log || 'B8 second vote moves the first' || E'\t'
      || CASE WHEN n = 1 AND m = 1 THEN '1 vote, on option 2'
              ELSE 'FAIL: ' || n || ' votes, ' || m || ' on option 2' END || E'\n';

  PERFORM set_config('probe.results', log, true);
END $$;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;
```

- [ ] **Step 3: Append verification Part C (policies, evaluated as `authenticated`)**

```sql
-- ============================================================
-- PART C — the policies, actually evaluated. Submit BEGIN..ROLLBACK in one go.
--   C1 member of group A lists A's feed              1 post   (positive control)
--   C2 member of group A reads B's post              0 rows
--   C3 member of group A reads B's comment           0 rows
--   C4 member of group A reads B's vote              0 rows
--   C5 member of group A calls list_feed_posts(B)    NOT_IN_GROUP
--   C6 student inserts an announcement               refused (42501)
--   C7 mentor selects feed_posts                     0 rows
--   C8 student whose membership closed lists A       NOT_IN_GROUP; post still exists
-- If SET LOCAL ROLE raises 42501 in your editor, STOP and report Part C as
-- unrunnable -- do not replace these with pg_policies lookups.
-- ============================================================
BEGIN;

DO $$
DECLARE
  adv UUID; stu UUID; mentor UUID; grpA UUID; grpB UUID; postA UUID; postB UUID; optB UUID;
BEGIN
  SELECT id INTO adv FROM profiles WHERE role = 'advisor' ORDER BY created_at LIMIT 1;
  SELECT id INTO stu FROM profiles WHERE role = 'student' ORDER BY created_at LIMIT 1;
  SELECT id INTO mentor FROM profiles WHERE role = 'mentor' ORDER BY created_at LIMIT 1;
  IF adv IS NULL OR stu IS NULL THEN
    PERFORM set_config('probe.ready', 'no', true); RETURN;
  END IF;

  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe feed A') RETURNING id INTO grpA;
  INSERT INTO internship_groups (advisor_id, name) VALUES (adv, 'Probe feed B') RETURNING id INTO grpB;
  UPDATE group_memberships SET left_at = now() WHERE student_id = stu AND left_at IS NULL;
  INSERT INTO group_memberships (group_id, student_id) VALUES (grpA, stu);

  INSERT INTO feed_posts (group_id, author_id, kind, body) VALUES (grpA, adv, 'announcement', 'hello A') RETURNING id INTO postA;
  INSERT INTO feed_posts (group_id, author_id, kind, body) VALUES (grpB, adv, 'poll', 'B?') RETURNING id INTO postB;
  INSERT INTO feed_poll_options (post_id, position, label) VALUES (postB, 0, 'x') RETURNING id INTO optB;
  INSERT INTO feed_poll_votes (post_id, option_id, user_id) VALUES (postB, optB, adv);
  INSERT INTO feed_comments (post_id, author_id, body) VALUES (postB, adv, 'B comment');

  PERFORM set_config('probe.ready', 'yes', true);
  PERFORM set_config('probe.adv', adv::text, true);
  PERFORM set_config('probe.stu', stu::text, true);
  PERFORM set_config('probe.mentor', coalesce(mentor::text, ''), true);
  PERFORM set_config('probe.grpA', grpA::text, true);
  PERFORM set_config('probe.grpB', grpB::text, true);
  PERFORM set_config('probe.postA', postA::text, true);
  PERFORM set_config('probe.postB', postB::text, true);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  adv UUID; stu UUID; mentor UUID; grpA UUID; grpB UUID; postA UUID; postB UUID;
  n INT; log TEXT := '';
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN
    PERFORM set_config('probe.results', 'C1-C8' || E'\t' || 'SKIP: needs an advisor and a student' || E'\n', true);
    RETURN;
  END IF;
  adv := current_setting('probe.adv')::uuid;  stu := current_setting('probe.stu')::uuid;
  mentor := NULLIF(current_setting('probe.mentor'), '')::uuid;
  grpA := current_setting('probe.grpA')::uuid; grpB := current_setting('probe.grpB')::uuid;
  postA := current_setting('probe.postA')::uuid; postB := current_setting('probe.postB')::uuid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);

  BEGIN
    SELECT count(*) INTO n FROM list_feed_posts(grpA);
    log := log || 'C1 member lists own group' || E'\t' || CASE WHEN n = 1 THEN '1 post' ELSE 'FAIL: ' || n END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C1 member lists own group' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;

  BEGIN
    SELECT count(*) INTO n FROM feed_posts WHERE id = postB;
    log := log || 'C2 member reads other group post' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: leaked' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C2 member reads other group post' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;

  BEGIN
    SELECT count(*) INTO n FROM feed_comments WHERE post_id = postB;
    log := log || 'C3 member reads other group comment' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: leaked' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C3 member reads other group comment' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;

  BEGIN
    SELECT count(*) INTO n FROM feed_poll_votes WHERE post_id = postB;
    log := log || 'C4 member reads other group vote' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: leaked' END || E'\n';
  EXCEPTION WHEN OTHERS THEN log := log || 'C4 member reads other group vote' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;

  BEGIN
    SELECT count(*) INTO n FROM list_feed_posts(grpB);
    log := log || 'C5 member lists other group' || E'\t' || 'FAIL: returned ' || n || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C5 member lists other group' || E'\t'
        || CASE WHEN SQLERRM LIKE 'NOT_IN_GROUP%' THEN 'NOT_IN_GROUP' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;

  BEGIN
    INSERT INTO feed_posts (group_id, author_id, kind, body) VALUES (grpA, stu, 'announcement', 'nope');
    log := log || 'C6 student inserts announcement' || E'\t' || 'FAIL: accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C6 student inserts announcement' || E'\t'
        || CASE WHEN SQLSTATE = '42501' THEN 'refused 42501' ELSE 'FAIL: ' || SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  IF mentor IS NULL THEN
    log := log || 'C7 mentor sees nothing' || E'\t' || 'SKIP: no mentor profile' || E'\n';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', mentor, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT count(*) INTO n FROM feed_posts;
      log := log || 'C7 mentor sees nothing' || E'\t' || CASE WHEN n = 0 THEN '0 rows' ELSE 'FAIL: ' || n || ' rows' END || E'\n';
    EXCEPTION WHEN OTHERS THEN log := log || 'C7 mentor sees nothing' || E'\t' || 'ABORTED: ' || SQLERRM || E'\n'; END;
  END IF;

  PERFORM set_config('probe.results', log, true);
END $$;

RESET ROLE;

-- C8 needs the membership closed as owner, then the read attempted as the student.
DO $$
DECLARE stu UUID; grpA UUID; postA UUID; n INT; log TEXT;
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  stu := current_setting('probe.stu')::uuid; grpA := current_setting('probe.grpA')::uuid;
  postA := current_setting('probe.postA')::uuid;
  UPDATE group_memberships SET left_at = now() WHERE group_id = grpA AND student_id = stu;
  SELECT count(*) INTO n FROM feed_posts WHERE id = postA;   -- owner-run: proves the row survived
  log := current_setting('probe.results', true);
  log := log || 'C8a post survives the member leaving' || E'\t' || CASE WHEN n = 1 THEN '1 row' ELSE 'FAIL: ' || n END || E'\n';
  PERFORM set_config('probe.results', log, true);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE stu UUID; grpA UUID; n INT; log TEXT;
BEGIN
  IF coalesce(current_setting('probe.ready', true), 'no') <> 'yes' THEN RETURN; END IF;
  stu := current_setting('probe.stu')::uuid; grpA := current_setting('probe.grpA')::uuid;
  log := current_setting('probe.results', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM list_feed_posts(grpA);
    log := log || 'C8b left member lists old group' || E'\t' || 'FAIL: returned ' || n || E'\n';
  EXCEPTION WHEN OTHERS THEN
    log := log || 'C8b left member lists old group' || E'\t'
        || CASE WHEN SQLERRM LIKE 'NOT_IN_GROUP%' THEN 'NOT_IN_GROUP' ELSE 'FAIL: ' || SQLERRM END || E'\n';
  END;
  PERFORM set_config('probe.results', log, true);
END $$;
RESET ROLE;

SELECT split_part(line, E'\t', 1) AS "case", split_part(line, E'\t', 2) AS result
FROM regexp_split_to_table(current_setting('probe.results', true), E'\n') AS line
WHERE line <> '';

ROLLBACK;
```

- [ ] **Step 4: Commit**

```bash
git add docs/group-feed-rpcs.sql docs/group-feed-verification.sql
git commit -m "feat(feed): sharing, composing, voting and the one read RPC, with verification

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand the three files to the user to apply, in order, one per message.** Report Part A's row, Part B's eight rows and Part C's nine rows verbatim. Anything beginning FAIL, SKIP, INCONCLUSIVE or ABORTED is a result to act on before Task 3.

---

### Task 3: Client foundation — types, service, error codes, routes, metrics

**Files:**
- Create: `src/types/feed.ts`, `src/services/feed.ts`, `src/utils/feedMetrics.ts`, `src/utils/__tests__/feedMetrics.test.ts`
- Modify: `src/utils/rpcErrors.ts`, `src/types/notification.ts`, `src/utils/notificationRoutes.ts`, `src/utils/__tests__/notificationRoutes.test.ts`, `src/i18n/locales/en.json`

**Interfaces:**
- Consumes: the RPC signatures from Task 2; `signEvidence` from `@/services/evidenceUrls`; `RpcError`, `mapRpcError`.
- Produces: `feedService` (signatures below), `FeedPost` et al., `pollPercentages(options)`, `withLike(post, liked)`, `routeForNotification` for the four feed types.

- [ ] **Step 1: Types**

```ts
// src/types/feed.ts
import type { PhotoEvidence, DocumentEvidence } from '@/types/assignment';

export type FeedPostKind = 'task' | 'announcement' | 'poll';

export interface FeedTask {
  submissionId: string;
  title: string;
  competencyName?: string;
  level?: number;
  note?: string;
  /** Signed at read time by feedService; a stored public URL of a private
   *  bucket is a dead link. */
  photos: PhotoEvidence[];
  documents: DocumentEvidence[];
}

export interface FeedPollOption {
  id: string;
  label: string;
  position: number;
  votes: number;
}

export interface FeedPoll {
  options: FeedPollOption[];
  totalVotes: number;
  myOptionId?: string;
}

export interface FeedPost {
  id: string;
  kind: FeedPostKind;
  groupId: string;
  authorId: string;
  authorName: string;
  body?: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  task?: FeedTask;
  poll?: FeedPoll;
}

export interface FeedComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}
```

- [ ] **Step 2: Write the failing metrics tests**

```ts
// src/utils/__tests__/feedMetrics.test.ts
import { pollPercentages, withLike } from '@/utils/feedMetrics';
import type { FeedPost } from '@/types/feed';

describe('pollPercentages', () => {
  it('returns all zeros with no votes', () => {
    expect(pollPercentages([{ votes: 0 }, { votes: 0 }])).toEqual([0, 0]);
  });

  it('sums to exactly 100 even when thirds would not', () => {
    const p = pollPercentages([{ votes: 1 }, { votes: 1 }, { votes: 1 }]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
    expect(p).toEqual([34, 33, 33]);
  });

  it('gives the whole hundred to a single option', () => {
    expect(pollPercentages([{ votes: 5 }, { votes: 0 }])).toEqual([100, 0]);
  });

  it('breaks remainder ties in favour of the larger fraction', () => {
    expect(pollPercentages([{ votes: 2 }, { votes: 1 }, { votes: 1 }])).toEqual([50, 25, 25]);
  });
});

describe('withLike', () => {
  const post = { id: 'p', likeCount: 2, likedByMe: false } as FeedPost;

  it('adds one when liking', () => {
    expect(withLike(post, true)).toMatchObject({ likeCount: 3, likedByMe: true });
  });

  it('removes one when unliking and never goes below zero', () => {
    expect(withLike({ ...post, likeCount: 1, likedByMe: true }, false)).toMatchObject({ likeCount: 0, likedByMe: false });
    expect(withLike({ ...post, likeCount: 0, likedByMe: true }, false).likeCount).toBe(0);
  });

  it('is a no-op when the state already matches', () => {
    expect(withLike({ ...post, likedByMe: true, likeCount: 3 }, true).likeCount).toBe(3);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest src/utils/__tests__/feedMetrics.test.ts`
Expected: FAIL — cannot find module `@/utils/feedMetrics`.

- [ ] **Step 4: Implement the metrics**

```ts
// src/utils/feedMetrics.ts
import type { FeedPost } from '@/types/feed';

/** Largest-remainder rounding so the bars always add up to 100 (or all
 *  zero when nobody has voted). Plain rounding shows 33/33/33 = 99. */
export function pollPercentages(options: Array<{ votes: number }>): number[] {
  const total = options.reduce((sum, o) => sum + o.votes, 0);
  if (total === 0) return options.map(() => 0);
  const exact = options.map((o) => (o.votes * 100) / total);
  const floors = exact.map(Math.floor);
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

/** The optimistic like toggle, in one place so the card and the list agree. */
export function withLike(post: FeedPost, liked: boolean): FeedPost {
  if (post.likedByMe === liked) return post;
  return {
    ...post,
    likedByMe: liked,
    likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)),
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/utils/__tests__/feedMetrics.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Error codes**

In `src/utils/rpcErrors.ts`, extend `ERROR_KEYS`:

```ts
  NOT_GROUP_OWNER: 'errors.notGroupOwner',
  NOT_IN_GROUP: 'errors.notInGroup',
  NOT_OWNER: 'errors.notOwner',
  KIND_NOT_ALLOWED: 'errors.kindNotAllowed',
  POLL_OPTIONS_RANGE: 'errors.pollOptionsRange',
  OPTION_MISMATCH: 'errors.optionMismatch',
  POST_NOT_FOUND: 'errors.postNotFound',
```

- [ ] **Step 7: Notification types and routes**

In `src/types/notification.ts`, add to the union:
```ts
  | 'feed_announcement'
  | 'feed_poll'
  | 'feed_comment'
  | 'feed_task_post';
```

In `src/utils/notificationRoutes.ts`: remove both `case 'poll_available':` branches (student and mentor and advisor), and add — inside the `student` switch and again inside the `advisor` switch — this block, with the pathname `/(student)/feed` for the student and `/(advisor)/feed` for the advisor:
```ts
        case 'feed_announcement':
        case 'feed_poll':
        case 'feed_comment':
        case 'feed_task_post': {
          const postId = str(data?.postId);
          return { pathname: '/(student)/feed', params: postId ? { post: postId } : undefined };
        }
```
The mentor switch gets no feed case — a mentor is never in a feed.

In `src/utils/__tests__/notificationRoutes.test.ts`, replace the `poll_available`-dependent expectations (there are none by name; check with `grep -n poll_available`) and add:
```ts
  it('sends feed notifications to the role feed, opened on the post', () => {
    for (const type of ['feed_announcement', 'feed_poll', 'feed_comment']) {
      expect(routeForNotification(type, { postId: 'p1' }, 'student')).toEqual({
        pathname: '/(student)/feed',
        params: { post: 'p1' },
      });
    }
    expect(routeForNotification('feed_task_post', { postId: 'p1' }, 'advisor')).toEqual({
      pathname: '/(advisor)/feed',
      params: { post: 'p1' },
    });
  });

  it('never sends a mentor to a feed', () => {
    expect(routeForNotification('feed_announcement', { postId: 'p1' }, 'mentor')).toBeNull();
  });
```

Run: `npx jest src/utils/__tests__/notificationRoutes.test.ts` — Expected: PASS, 8 tests.

- [ ] **Step 8: Service**

```ts
// src/services/feed.ts
import { supabase } from './supabase';
import { signEvidence } from './evidenceUrls';
import { RpcError } from '@/utils/rpcErrors';
import type { FeedPost, FeedComment, FeedPostKind } from '@/types/feed';
import type { PhotoEvidence, DocumentEvidence } from '@/types/assignment';

export const FEED_PAGE_SIZE = 20;

function toPost(raw: Record<string, unknown>): FeedPost {
  const task = raw.task as Record<string, unknown> | null;
  const poll = raw.poll as Record<string, unknown> | null;
  return {
    id: raw.id as string,
    kind: raw.kind as FeedPostKind,
    groupId: raw.groupId as string,
    authorId: raw.authorId as string,
    authorName: (raw.authorName as string) || '',
    body: (raw.body as string) || undefined,
    createdAt: raw.createdAt as string,
    likeCount: Number(raw.likeCount) || 0,
    commentCount: Number(raw.commentCount) || 0,
    likedByMe: !!raw.likedByMe,
    task: task
      ? {
          submissionId: task.submissionId as string,
          title: (task.title as string) || '',
          competencyName: (task.competencyName as string) || undefined,
          level: typeof task.level === 'number' ? task.level : undefined,
          note: (task.note as string) || undefined,
          // Filled by listPosts after signing; the raw rows hold stored URLs
          // of a private bucket, which are dead links until exchanged.
          photos: [],
          documents: [],
        }
      : undefined,
    poll: poll
      ? {
          options: ((poll.options as Array<Record<string, unknown>>) || []).map((o) => ({
            id: o.id as string,
            label: (o.label as string) || '',
            position: Number(o.position) || 0,
            votes: Number(o.votes) || 0,
          })),
          totalVotes: Number(poll.totalVotes) || 0,
          myOptionId: (poll.myOptionId as string) || undefined,
        }
      : undefined,
  };
}

export const feedService = {
  /** One page, newest first. `before` is the oldest createdAt already on
   *  screen. Evidence URIs come back signed. */
  async listPosts(groupId: string, before?: string): Promise<FeedPost[]> {
    const { data, error } = await supabase.rpc('list_feed_posts', {
      p_group_id: groupId,
      p_before: before ?? null,
      p_limit: FEED_PAGE_SIZE,
    });
    if (error) throw new RpcError(error.message);
    const rows = (data || []) as Array<Record<string, unknown>>;
    return Promise.all(rows.map(async (raw) => {
      const post = toPost(raw);
      const task = raw.task as Record<string, unknown> | null;
      if (post.task && task) {
        const signed = await signEvidence(
          (task.photos as PhotoEvidence[] | undefined) || [],
          (task.documents as DocumentEvidence[] | undefined) || [],
        );
        post.task.photos = signed.photos;
        post.task.documents = signed.documents;
      }
      return post;
    }));
  },

  async createPost(groupId: string, kind: 'announcement' | 'poll', body: string, options?: string[]): Promise<string> {
    const { data, error } = await supabase.rpc('create_feed_post', {
      p_group_id: groupId,
      p_kind: kind,
      p_body: body,
      p_options: options ?? null,
    });
    if (error) throw new RpcError(error.message);
    return data as string;
  },

  async vote(postId: string, optionId: string): Promise<void> {
    const { error } = await supabase.rpc('vote_feed_poll', { p_post_id: postId, p_option_id: optionId });
    if (error) throw new RpcError(error.message);
  },

  /** Direct table writes under RLS; user_id is the caller by policy. */
  async setLiked(postId: string, userId: string, liked: boolean): Promise<void> {
    if (liked) {
      const { error } = await supabase.from('feed_likes').upsert({ post_id: postId, user_id: userId });
      if (error) throw error;
    } else {
      const { error } = await supabase.from('feed_likes').delete().eq('post_id', postId).eq('user_id', userId);
      if (error) throw error;
    }
  },

  async listComments(postId: string): Promise<FeedComment[]> {
    const { data, error } = await supabase
      .from('feed_comments')
      .select('id, post_id, author_id, body, created_at, profiles:author_id(first_name, last_name)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => {
      const row = r as Record<string, unknown>;
      const p = row.profiles as Record<string, unknown> | null;
      return {
        id: row.id as string,
        postId: row.post_id as string,
        authorId: row.author_id as string,
        authorName: `${(p?.first_name as string) || ''} ${(p?.last_name as string) || ''}`.trim(),
        body: row.body as string,
        createdAt: row.created_at as string,
      };
    });
  },

  async addComment(postId: string, userId: string, body: string): Promise<void> {
    const { error } = await supabase.from('feed_comments').insert({ post_id: postId, author_id: userId, body });
    if (error) throw error;
  },

  async deleteComment(commentId: string): Promise<void> {
    const { error } = await supabase.from('feed_comments').delete().eq('id', commentId);
    if (error) throw error;
  },

  /** Advisor moderation. A student's own task post is removed through
   *  setSubmissionSharing(false), never here. */
  async deletePost(postId: string): Promise<void> {
    const { error } = await supabase.from('feed_posts').delete().eq('id', postId);
    if (error) throw error;
  },

  async setSubmissionSharing(submissionId: string, share: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_submission_sharing', { p_submission_id: submissionId, p_share: share });
    if (error) throw new RpcError(error.message);
  },
};
```

(The `profiles:author_id(...)` embed requires the `feed_comments.author_id → profiles` FK, which Task 1 declared; PostgREST resolves it by column name.)

- [ ] **Step 9: i18n**

Add to `src/i18n/locales/en.json` — under `errors`:
```json
    "notGroupOwner": "Only the group's advisor can post here.",
    "notInGroup": "You are not a member of this group.",
    "notOwner": "Only the student who submitted this can change it.",
    "kindNotAllowed": "That kind of post cannot be created here.",
    "pollOptionsRange": "A poll needs between 2 and 6 options.",
    "optionMismatch": "That option does not belong to this poll.",
    "postNotFound": "This post no longer exists."
```
under `tabs`: `"feed": "Feed"`. Under `student`:
```json
    "shareToFeed": "Share in the group feed when approved",
    "shareToFeedHint": "Your classmates and advisor will see the task, your note and your evidence. Your reflection stays private.",
    "sharingUpdateFailed": "Your sharing choice could not be saved. The task was submitted; check the switch on the card."
```
And a new top-level `feed` block:
```json
  "feed": {
    "title": "Feed",
    "writeAnnouncement": "Write announcement",
    "createPoll": "Create poll",
    "announcement": "Announcement",
    "poll": "Poll",
    "sharedTask": "shared a task",
    "empty": "Nothing shared yet — approved tasks will appear here.",
    "noGroup": "You'll see your group's feed once you join one.",
    "like": "Like",
    "comments": "Comments",
    "commentCount_one": "{{count}} comment",
    "commentCount_other": "{{count}} comments",
    "likeCount_one": "{{count}} like",
    "likeCount_other": "{{count}} likes",
    "writeComment": "Write a comment…",
    "send": "Send",
    "noComments": "No comments yet.",
    "removeFromFeed": "Remove from feed",
    "removeFromFeedConfirm": "Your classmates will no longer see this task. You can share it again from the task card.",
    "removePost": "Remove post",
    "removePostConfirm": "Remove this post and its comments for everyone in the group?",
    "removeComment": "Remove comment",
    "remove": "Remove",
    "votes_one": "{{count}} vote",
    "votes_other": "{{count}} votes",
    "changeVote": "Tap another option to change your vote",
    "composerBodyPlaceholder": "What do you want to tell the group?",
    "composerQuestionPlaceholder": "Ask the group a question",
    "optionPlaceholder": "Option {{index}}",
    "addOption": "Add option",
    "post": "Post",
    "postFailed": "Could not post.",
    "posted": "Posted to the group.",
    "charCount": "{{count}}/{{max}}",
    "document": "Document"
  },
```
Remove the whole `"polls": { … }` block.

- [ ] **Step 10: Gates and commit**

Run: `npx tsc --noEmit` — Expected: errors ONLY in the three `polls.tsx` routes and `PollsManagerScreen.tsx` (their `polls.*` keys are gone; `t()` is untyped so possibly none). If tsc is silent, fine. Run: `npx jest --silent` — Expected: 9 suites / 58 tests.

```bash
git add src/types/feed.ts src/services/feed.ts src/utils/feedMetrics.ts src/utils/__tests__/feedMetrics.test.ts src/utils/rpcErrors.ts src/types/notification.ts src/utils/notificationRoutes.ts src/utils/__tests__/notificationRoutes.test.ts src/i18n/locales/en.json
git commit -m "feat(feed): client types, service, error codes, routes and tested poll arithmetic

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The screen — list, cards, comments, composers; Polls retires

**Files:**
- Create: `src/components/feed/FeedPostCard.tsx`, `src/components/feed/FeedComments.tsx`, `src/components/feed/FeedComposer.tsx`, `src/components/feed/index.ts`, `src/components/screens/FeedScreen.tsx`, `app/(student)/feed.tsx`, `app/(advisor)/feed.tsx`
- Modify: `app/(student)/_layout.tsx`, `app/(advisor)/_layout.tsx`, `app/(mentor)/_layout.tsx`
- Delete: `app/(student)/polls.tsx`, `app/(mentor)/polls.tsx`, `app/(advisor)/polls.tsx`, `src/components/screens/PollsManagerScreen.tsx`, `src/services/polls.ts`, `src/types/poll.ts`

**Interfaces:**
- Consumes: `feedService`, `pollPercentages`, `withLike`, `groupService.listMyGroups(advisorId)` / `groupService.getMyGroup(studentId)`, `useRealtimeSubscription`, `LoadFailedBanner`, `mapRpcError`.
- Produces: `FeedScreen({ role, })` reading `?post=` from the route.

- [ ] **Step 1: The comments component**

```tsx
// src/components/feed/FeedComments.tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { feedService } from '@/services/feed';
import { colors, spacing, borderRadius } from '@/theme';
import type { FeedComment } from '@/types/feed';

interface Props {
  postId: string;
  userId: string;
  /** The group's advisor may remove any comment; everyone removes their own. */
  canModerate: boolean;
  onCountChange: (delta: number) => void;
}

const MAX = 2000;

export function FeedComments({ postId, userId, canModerate, onCountChange }: Props) {
  const { t } = useTranslation();
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    feedService.listComments(postId)
      .then((list) => { if (alive) setComments(list); })
      .catch((err) => {
        console.warn('Feed comments load failed:', err instanceof Error ? err.message : err);
        if (alive) setComments([]);
      });
    return () => { alive = false; };
  }, [postId]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await feedService.addComment(postId, userId, body);
      setText('');
      const list = await feedService.listComments(postId);
      setComments(list);
      onCountChange(1);
    } catch (err) {
      console.warn('Feed comment failed:', err instanceof Error ? err.message : err);
      Alert.alert(t('common.error'), t('feed.postFailed'));
    } finally {
      setSending(false);
    }
  }

  function remove(c: FeedComment) {
    Alert.alert(t('feed.removeComment'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.remove'), style: 'destructive',
        onPress: async () => {
          try {
            await feedService.deleteComment(c.id);
            setComments((prev) => (prev || []).filter((x) => x.id !== c.id));
            onCountChange(-1);
          } catch (err) {
            console.warn('Feed comment delete failed:', err instanceof Error ? err.message : err);
            Alert.alert(t('common.error'), t('common.loadFailed'));
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.wrap}>
      {comments === null ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : comments.length === 0 ? (
        <Text style={styles.empty}>{t('feed.noComments')}</Text>
      ) : (
        comments.map((c) => (
          <View key={c.id} style={styles.row}>
            <View style={styles.bubble}>
              <Text style={styles.author}>{c.authorName}</Text>
              <Text style={styles.body}>{c.body}</Text>
            </View>
            {(canModerate || c.authorId === userId) && (
              <TouchableOpacity onPress={() => remove(c)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={colors.textDisabled} />
              </TouchableOpacity>
            )}
          </View>
        ))
      )}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={t('feed.writeComment')}
          placeholderTextColor={colors.textSecondary}
          value={text}
          onChangeText={(v) => setText(v.slice(0, MAX))}
          multiline
        />
        <TouchableOpacity onPress={send} disabled={sending || !text.trim()} hitSlop={8}>
          {sending
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="send" size={20} color={text.trim() ? colors.primary : colors.textDisabled} />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  empty: { fontSize: 13, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bubble: { flex: 1, backgroundColor: colors.background, borderRadius: borderRadius.md, padding: spacing.sm },
  author: { fontSize: 12, fontWeight: '600', color: colors.text, marginBottom: 2 },
  body: { fontSize: 14, color: colors.text },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1, fontSize: 14, color: colors.text, maxHeight: 100,
    borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 6,
  },
});
```

- [ ] **Step 2: The post card**

```tsx
// src/components/feed/FeedPostCard.tsx
import { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Alert, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { feedService } from '@/services/feed';
import { pollPercentages, withLike } from '@/utils/feedMetrics';
import { mapRpcError } from '@/utils/rpcErrors';
import { colors, spacing, borderRadius } from '@/theme';
import type { FeedPost } from '@/types/feed';
import { FeedComments } from './FeedComments';

interface Props {
  post: FeedPost;
  userId: string;
  /** The advisor of this post's group. */
  canModerate: boolean;
  highlighted?: boolean;
  onChange: (next: FeedPost) => void;
  onRemoved: (postId: string) => void;
  onOpenPhoto: (uri: string) => void;
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('');
}

export function FeedPostCard({ post, userId, canModerate, highlighted, onChange, onRemoved, onOpenPhoto }: Props) {
  const { t, i18n } = useTranslation();
  const [showComments, setShowComments] = useState(false);
  const isMine = post.authorId === userId;

  async function toggleLike() {
    const next = withLike(post, !post.likedByMe);
    onChange(next); // optimistic
    try {
      await feedService.setLiked(post.id, userId, next.likedByMe);
    } catch (err) {
      console.warn('Feed like failed:', err instanceof Error ? err.message : err);
      onChange(post); // roll back
    }
  }

  async function vote(optionId: string) {
    if (!post.poll) return;
    const prev = post;
    const options = post.poll.options.map((o) => ({
      ...o,
      votes: o.votes
        + (o.id === optionId ? 1 : 0)
        - (o.id === post.poll?.myOptionId ? 1 : 0),
    }));
    const totalVotes = post.poll.totalVotes + (post.poll.myOptionId ? 0 : 1);
    onChange({ ...post, poll: { options, totalVotes, myOptionId: optionId } });
    try {
      await feedService.vote(post.id, optionId);
    } catch (err) {
      onChange(prev);
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    }
  }

  function removeTask() {
    if (!post.task) return;
    Alert.alert(t('feed.removeFromFeed'), t('feed.removeFromFeedConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.remove'), style: 'destructive',
        onPress: async () => {
          try {
            await feedService.setSubmissionSharing(post.task!.submissionId, false);
            onRemoved(post.id);
          } catch (err) {
            const { key } = mapRpcError(err instanceof Error ? err.message : '');
            Alert.alert(t('common.error'), t(key));
          }
        },
      },
    ]);
  }

  function removePost() {
    Alert.alert(t('feed.removePost'), t('feed.removePostConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.remove'), style: 'destructive',
        onPress: async () => {
          try {
            await feedService.deletePost(post.id);
            onRemoved(post.id);
          } catch (err) {
            console.warn('Feed post delete failed:', err instanceof Error ? err.message : err);
            Alert.alert(t('common.error'), t('common.loadFailed'));
          }
        },
      },
    ]);
  }

  const percentages = post.poll ? pollPercentages(post.poll.options) : [];

  return (
    <View style={[styles.card, highlighted && styles.cardHighlighted]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(post.authorName)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.author} numberOfLines={1}>
            {post.authorName}
            {post.kind === 'task' && <Text style={styles.subtle}>  {t('feed.sharedTask')}</Text>}
          </Text>
          <Text style={styles.subtle}>
            {post.kind === 'announcement' ? t('feed.announcement') : post.kind === 'poll' ? t('feed.poll') : ''}
            {post.kind !== 'task' ? ' · ' : ''}
            {new Date(post.createdAt).toLocaleDateString(i18n.language)}
          </Text>
        </View>
        {post.kind === 'task' && isMine && (
          <TouchableOpacity onPress={removeTask} hitSlop={8}>
            <Ionicons name="eye-off-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
        {canModerate && (
          <TouchableOpacity onPress={removePost} hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Body by kind */}
      {post.kind === 'task' && post.task && (
        <View style={styles.section}>
          {!!post.task.competencyName && (
            <Text style={styles.competency}>
              {post.task.competencyName}{post.task.level ? ` · L${post.task.level}` : ''}
            </Text>
          )}
          <Text style={styles.title}>{post.task.title}</Text>
          {!!post.task.note && <Text style={styles.body}>{post.task.note}</Text>}
          {post.task.photos.length > 0 && (
            <View style={styles.photoRow}>
              {post.task.photos.map((p, i) => (
                <TouchableOpacity key={`${p.uri}-${i}`} onPress={() => onOpenPhoto(p.uri)} activeOpacity={0.8}>
                  <Image source={{ uri: p.uri }} style={styles.photo} />
                </TouchableOpacity>
              ))}
            </View>
          )}
          {post.task.documents.map((d, i) => (
            <TouchableOpacity key={`${d.uri}-${i}`} style={styles.docRow} onPress={() => Linking.openURL(d.uri)} activeOpacity={0.7}>
              <Ionicons name="document-outline" size={18} color={colors.primary} />
              <Text style={styles.docName} numberOfLines={1}>{d.fileName || t('feed.document')}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {post.kind === 'announcement' && (
        <Text style={styles.body}>{post.body}</Text>
      )}

      {post.kind === 'poll' && post.poll && (
        <View style={styles.section}>
          <Text style={styles.title}>{post.body}</Text>
          {post.poll.options.map((o, i) => {
            const mine = post.poll?.myOptionId === o.id;
            const voted = !!post.poll?.myOptionId;
            return (
              <TouchableOpacity key={o.id} style={[styles.option, mine && styles.optionMine]} onPress={() => vote(o.id)} activeOpacity={0.7}>
                {voted && <View style={[styles.optionFill, { width: `${percentages[i]}%` }]} />}
                <Text style={[styles.optionLabel, mine && styles.optionLabelMine]}>{o.label}</Text>
                {voted && <Text style={styles.optionPct}>{percentages[i]}%</Text>}
              </TouchableOpacity>
            );
          })}
          <Text style={styles.subtle}>
            {t('feed.votes', { count: post.poll.totalVotes })}
            {post.poll.myOptionId ? ` · ${t('feed.changeVote')}` : ''}
          </Text>
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.footerBtn} onPress={toggleLike} hitSlop={8}>
          <Ionicons name={post.likedByMe ? 'heart' : 'heart-outline'} size={20} color={post.likedByMe ? colors.error : colors.textSecondary} />
          <Text style={styles.footerText}>{t('feed.likeCount', { count: post.likeCount })}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerBtn} onPress={() => setShowComments((v) => !v)} hitSlop={8}>
          <Ionicons name="chatbubble-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.footerText}>{t('feed.commentCount', { count: post.commentCount })}</Text>
        </TouchableOpacity>
      </View>

      {showComments && (
        <FeedComments
          postId={post.id}
          userId={userId}
          canModerate={canModerate}
          onCountChange={(delta) => onChange({ ...post, commentCount: Math.max(0, post.commentCount + delta) })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  cardHighlighted: { borderWidth: 2, borderColor: colors.primary },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + '20', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  author: { fontSize: 14, fontWeight: '600', color: colors.text },
  subtle: { fontSize: 12, color: colors.textSecondary },
  section: { gap: spacing.xs },
  competency: { fontSize: 12, fontWeight: '600', color: colors.primary },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 14, color: colors.text, lineHeight: 20 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  photo: { width: 96, height: 96, borderRadius: borderRadius.sm },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  docName: { flex: 1, fontSize: 13, color: colors.primary, fontWeight: '500' },
  option: { position: 'relative', overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  optionMine: { borderColor: colors.primary },
  optionFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.primary + '18' },
  optionLabel: { fontSize: 14, color: colors.text },
  optionLabelMine: { fontWeight: '600', color: colors.primary },
  optionPct: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  footer: { flexDirection: 'row', gap: spacing.lg, paddingTop: spacing.xs },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerText: { fontSize: 13, color: colors.textSecondary },
});
```

- [ ] **Step 3: The composer**

```tsx
// src/components/feed/FeedComposer.tsx
import { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { feedService } from '@/services/feed';
import { mapRpcError } from '@/utils/rpcErrors';
import { colors, spacing, borderRadius } from '@/theme';

interface Props {
  visible: boolean;
  kind: 'announcement' | 'poll';
  groupId: string;
  onClose: () => void;
  onPosted: () => void;
}

const BODY_MAX = 2000;
const QUESTION_MAX = 200;
const OPTION_MAX = 80;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

export function FeedComposer({ visible, kind, groupId, onClose, onPosted }: Props) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [posting, setPosting] = useState(false);
  const max = kind === 'poll' ? QUESTION_MAX : BODY_MAX;

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const canPost = body.trim().length > 0 && (kind === 'announcement' || (filled.length >= MIN_OPTIONS && filled.length <= MAX_OPTIONS));

  function reset() {
    setBody('');
    setOptions(['', '']);
  }

  async function post() {
    if (!canPost || posting) return;
    setPosting(true);
    try {
      await feedService.createPost(groupId, kind, body.trim(), kind === 'poll' ? filled : undefined);
      reset();
      onPosted();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setPosting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { reset(); onClose(); }} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>{kind === 'poll' ? t('feed.createPoll') : t('feed.writeAnnouncement')}</Text>
          <TouchableOpacity onPress={post} disabled={!canPost || posting} hitSlop={8}>
            {posting
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={[styles.postBtn, !canPost && styles.postBtnDisabled]}>{t('feed.post')}</Text>}
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.body}
            placeholder={kind === 'poll' ? t('feed.composerQuestionPlaceholder') : t('feed.composerBodyPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            value={body}
            onChangeText={(v) => setBody(v.slice(0, max))}
            multiline
            autoFocus
          />
          <Text style={styles.counter}>{t('feed.charCount', { count: body.length, max })}</Text>

          {kind === 'poll' && (
            <View style={styles.options}>
              {options.map((o, i) => (
                <View key={i} style={styles.optionRow}>
                  <TextInput
                    style={styles.optionInput}
                    placeholder={t('feed.optionPlaceholder', { index: i + 1 })}
                    placeholderTextColor={colors.textSecondary}
                    value={o}
                    onChangeText={(v) => setOptions((prev) => prev.map((x, j) => (j === i ? v.slice(0, OPTION_MAX) : x)))}
                  />
                  {options.length > MIN_OPTIONS && (
                    <TouchableOpacity onPress={() => setOptions((prev) => prev.filter((_, j) => j !== i))} hitSlop={8}>
                      <Ionicons name="close-circle" size={20} color={colors.textDisabled} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {options.length < MAX_OPTIONS && (
                <TouchableOpacity style={styles.addOption} onPress={() => setOptions((prev) => [...prev, ''])} activeOpacity={0.7}>
                  <Ionicons name="add" size={18} color={colors.primary} />
                  <Text style={styles.addOptionText}>{t('feed.addOption')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  postBtn: { fontSize: 16, fontWeight: '600', color: colors.primary },
  postBtnDisabled: { color: colors.textDisabled },
  content: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  body: { minHeight: 120, fontSize: 16, color: colors.text, textAlignVertical: 'top' },
  counter: { fontSize: 12, color: colors.textSecondary, textAlign: 'right' },
  options: { gap: spacing.sm, marginTop: spacing.md },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionInput: { flex: 1, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  addOptionText: { fontSize: 14, color: colors.primary, fontWeight: '500' },
});
```

- [ ] **Step 4: Barrel**

```ts
// src/components/feed/index.ts
export { FeedPostCard } from './FeedPostCard';
export { FeedComments } from './FeedComments';
export { FeedComposer } from './FeedComposer';
```

- [ ] **Step 5: The screen**

```tsx
// src/components/screens/FeedScreen.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, TouchableOpacity, Modal, Image, Pressable } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { feedService, FEED_PAGE_SIZE } from '@/services/feed';
import { groupService } from '@/services/group';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { LoadFailedBanner } from '@/components/common';
import { FeedPostCard, FeedComposer } from '@/components/feed';
import { colors, spacing, borderRadius } from '@/theme';
import type { FeedPost } from '@/types/feed';
import type { InternshipGroup } from '@/types/group';

interface FeedScreenProps {
  role: 'student' | 'advisor';
}

interface GroupChoice { id: string; name: string; isArchived?: boolean }

/** The group feed for the student (their one active group) and the advisor
 *  (a selector over their groups, the same treatment Reports gives it). */
export function FeedScreen({ role }: FeedScreenProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { post: postParam } = useLocalSearchParams<{ post?: string }>();

  const [groups, setGroups] = useState<GroupChoice[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [composer, setComposer] = useState<'announcement' | 'poll' | null>(null);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const consumedParam = useRef<string | null>(null);
  const request = useRef(0);
  const listRef = useRef<FlatList<FeedPost>>(null);

  const canModerate = role === 'advisor';

  const loadGroups = useCallback(async () => {
    if (!user) return;
    setLoadingGroups(true);
    try {
      if (role === 'advisor') {
        const list: InternshipGroup[] = await groupService.listMyGroups(user.id);
        const choices = list.map((g) => ({ id: g.id, name: g.name, isArchived: g.isArchived }));
        setGroups(choices);
        // Never default to an archived group while an active one exists.
        setGroupId((cur) => cur && choices.some((g) => g.id === cur) ? cur : (choices.find((g) => !g.isArchived) ?? choices[0])?.id ?? null);
      } else {
        const g = await groupService.getMyGroup(user.id);
        setGroups(g ? [{ id: g.id, name: g.name }] : []);
        setGroupId(g?.id ?? null);
      }
      setLoadFailed(false);
    } catch (err) {
      console.error('Feed groups load error:', err);
      setLoadFailed(true);
    } finally {
      setLoadingGroups(false);
    }
  }, [user, role]);

  const loadPosts = useCallback(async (gid: string | null) => {
    const req = ++request.current;
    if (!gid) { setPosts([]); return; }
    setLoading(true);
    setLoadFailed(false);
    try {
      const page = await feedService.listPosts(gid);
      if (req !== request.current) return;
      setPosts(page);
      setHasMore(page.length === FEED_PAGE_SIZE);
    } catch (err) {
      if (req !== request.current) return;
      console.error('Feed load error:', err);
      setLoadFailed(true);
    } finally {
      if (req === request.current) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!groupId || !hasMore || loadingMore || loading || posts.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = posts[posts.length - 1].createdAt;
      const page = await feedService.listPosts(groupId, oldest);
      const seen = new Set(posts.map((p) => p.id));
      setPosts((prev) => [...prev, ...page.filter((p) => !seen.has(p.id))]);
      setHasMore(page.length === FEED_PAGE_SIZE);
    } catch (err) {
      console.error('Feed load more error:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [groupId, hasMore, loadingMore, loading, posts]);

  useFocusEffect(useCallback(() => { loadGroups(); }, [loadGroups]));
  useEffect(() => { loadPosts(groupId); }, [groupId, loadPosts]);

  // A new post in the selected group: refetch the top page rather than
  // trusting the bare row -- the realtime payload has no author name,
  // counts or signed evidence, and list_feed_posts is where those live.
  useRealtimeSubscription({
    table: 'feed_posts',
    event: 'INSERT',
    filter: groupId ? `group_id=eq.${groupId}` : undefined,
    enabled: !!groupId,
    onPayload: () => { loadPosts(groupId); },
  });

  // Scroll to the post a notification pointed at, once, if it is in the list.
  useEffect(() => {
    if (!postParam || postParam === consumedParam.current || posts.length === 0) return;
    const index = posts.findIndex((p) => p.id === postParam);
    if (index < 0) return;
    consumedParam.current = postParam;
    setHighlightId(postParam);
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
    const timer = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(timer);
  }, [postParam, posts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadGroups();
    await loadPosts(groupId);
    setRefreshing(false);
  }, [loadGroups, loadPosts, groupId]);

  function updatePost(next: FeedPost) {
    setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  }
  function removePost(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }

  if (!user) return null;

  const header = (
    <View>
      {loadFailed && <LoadFailedBanner onRetry={() => { loadGroups(); loadPosts(groupId); }} />}
      {role === 'advisor' && groups.length > 1 && (
        <View style={styles.chipRow}>
          {groups.map((g) => (
            <TouchableOpacity
              key={g.id}
              style={[styles.chip, g.id === groupId && styles.chipActive, g.isArchived && { opacity: 0.6 }]}
              onPress={() => setGroupId(g.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, g.id === groupId && styles.chipTextActive]} numberOfLines={1}>{g.name}</Text>
              {g.isArchived && <Text style={styles.chipBadge}>{t('advisor.archived')}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
      {role === 'advisor' && groupId && (
        <View style={styles.composeRow}>
          <TouchableOpacity style={styles.composeBtn} onPress={() => setComposer('announcement')} activeOpacity={0.7}>
            <Ionicons name="megaphone-outline" size={18} color={colors.primary} />
            <Text style={styles.composeText}>{t('feed.writeAnnouncement')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.composeBtn} onPress={() => setComposer('poll')} activeOpacity={0.7}>
            <Ionicons name="stats-chart-outline" size={18} color={colors.primary} />
            <Text style={styles.composeText}>{t('feed.createPoll')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const empty = loadingGroups || loading ? (
    <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 60 }} />
  ) : (
    <View style={styles.empty}>
      <Ionicons name="newspaper-outline" size={48} color={colors.textDisabled} />
      <Text style={styles.emptyText}>{groupId ? t('feed.empty') : t('feed.noGroup')}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.titleRow}><Text style={styles.screenTitle}>{t('feed.title')}</Text></View>
      <FlatList
        ref={listRef}
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <FeedPostCard
            post={item}
            userId={user.id}
            canModerate={canModerate}
            highlighted={item.id === highlightId}
            onChange={updatePost}
            onRemoved={removePost}
            onOpenPhoto={setLightboxUri}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={loadingMore ? <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 16 }} /> : null}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        onScrollToIndexFailed={() => { /* the list re-renders; the highlight still shows */ }}
        showsVerticalScrollIndicator={false}
      />

      {role === 'advisor' && groupId && composer && (
        <FeedComposer
          visible
          kind={composer}
          groupId={groupId}
          onClose={() => setComposer(null)}
          onPosted={() => { setComposer(null); loadPosts(groupId); }}
        />
      )}

      <Modal visible={lightboxUri !== null} transparent animationType="fade" onRequestClose={() => setLightboxUri(null)}>
        <Pressable style={styles.lightbox} onPress={() => setLightboxUri(null)}>
          {lightboxUri && <Image source={{ uri: lightboxUri }} style={styles.lightboxImage} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  screenTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: borderRadius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, maxWidth: 160 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  chipBadge: { fontSize: 11, color: colors.textSecondary, backgroundColor: colors.divider, paddingHorizontal: 6, borderRadius: borderRadius.full },
  composeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  composeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary + '40' },
  composeText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: 60, paddingHorizontal: spacing.xl },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  lightbox: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  lightboxImage: { width: '100%', height: '80%' },
});
```

If `borderRadius.full` does not exist in `src/theme`, use `999`. If `InternshipGroup` has no `isArchived`, check `src/types/group.ts` — `groupService.listMyGroups` maps `isArchived`, so it should.

- [ ] **Step 6: Routes and tab bars; delete Polls**

```tsx
// app/(student)/feed.tsx
import { FeedScreen } from '@/components/screens/FeedScreen';

export default function StudentFeedScreen() {
  return <FeedScreen role="student" />;
}
```
```tsx
// app/(advisor)/feed.tsx
import { FeedScreen } from '@/components/screens/FeedScreen';

export default function AdvisorFeedScreen() {
  return <FeedScreen role="advisor" />;
}
```

In `app/(student)/_layout.tsx` and `app/(advisor)/_layout.tsx`, change the `<Tabs.Screen name="polls" …>` entry to `name="feed"`, `title: t('tabs.feed')`, icon `newspaper-outline`. In `app/(mentor)/_layout.tsx`, delete the `polls` `<Tabs.Screen>` entirely.

```bash
git rm "app/(student)/polls.tsx" "app/(mentor)/polls.tsx" "app/(advisor)/polls.tsx" src/components/screens/PollsManagerScreen.tsx src/services/polls.ts src/types/poll.ts
```

Then: `grep -rn "pollService\|types/poll\|PollsManagerScreen\|'/(.*)/polls'\|poll_available" app/ src/` — Expected: zero hits. Fix any that remain (the student dashboard's `poll_available` icon map entry, if present, may stay as an icon mapping; a navigation target may not).

- [ ] **Step 7: Gates, count the tabs, commit**

Run: `npx tsc --noEmit` — Expected: silent. Run: `npx jest --silent` — Expected: 9 suites / 58 tests.
Count `<Tabs.Screen>` without `href: null` in each layout: student 7, advisor 6, mentor 6.

```bash
git add -A app/ src/components/feed src/components/screens/FeedScreen.tsx
git commit -m "feat(feed): the group feed screen replaces Polls

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The student's sharing switch

**Files:**
- Modify: `app/(student)/my-tasks.tsx`

**Interfaces:**
- Consumes: `feedService.setSubmissionSharing(submissionId, share)`; `assignmentService.submitAssignment(...)` which returns the submission id (`Promise<string>`); `MyAssignment.submission?.id` and `.status`.
- Produces: nothing new.

Note: `AssignmentSubmission` does not carry `share_to_feed`. Add `shareToFeed?: boolean` to the interface in `src/types/assignment.ts` and map it in `toSubmission` in `src/services/assignments.ts` as `shareToFeed: r.share_to_feed === undefined ? true : !!r.share_to_feed` — `listMyAssignments` selects `*` on submissions, so the column arrives.

- [ ] **Step 1: State**

Next to the other form state in `my-tasks.tsx`:
```ts
  // Per-task, default on (spec decision 2). Sent as a second call after
  // submit_assignment returns; see handleSubmit.
  const [shareToFeed, setShareToFeed] = useState(true);
```
In `clearForm()` add `setShareToFeed(true);`. In `toggleOpen`, when prefilling from a draft add `setShareToFeed(draft.shareToFeed)`, and from the server `setShareToFeed(a.submission?.shareToFeed ?? true)`. Add `shareToFeed: boolean` to `FormDraft` and to `parkDraft`'s object.

- [ ] **Step 2: Submit sends the decision**

In `handleSubmit`, replace the `await assignmentService.submitAssignment(...)` line with:
```ts
      const submissionId = await assignmentService.submitAssignment(
        a.id, note.trim(), reflection.trim(), photos, documents,
      );
      // The decision travels as a second call rather than a sixth RPC
      // parameter (spec §3). It must not fail silently: a task shared
      // against the student's wish is the one outcome this switch exists
      // to prevent, so a failure here is told to them, with where to fix it.
      if (!shareToFeed) {
        try {
          await feedService.setSubmissionSharing(submissionId, false);
        } catch (err) {
          console.warn('Sharing update failed:', err instanceof Error ? err.message : err);
          Alert.alert(t('common.error'), t('student.sharingUpdateFailed'));
        }
      }
```
Import `feedService` from `@/services/feed`.

- [ ] **Step 3: The switch on the form**

Above the Submit button (before `<TouchableOpacity style={[styles.primaryBtn, …`):
```tsx
                <View style={styles.shareRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shareLabel}>{t('student.shareToFeed')}</Text>
                    <Text style={styles.shareHint}>{t('student.shareToFeedHint')}</Text>
                  </View>
                  <Switch
                    value={shareToFeed}
                    onValueChange={setShareToFeed}
                    disabled={submitting}
                    trackColor={{ true: colors.primary }}
                  />
                </View>
```
Add `Switch` to the `react-native` import and these styles:
```ts
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  shareLabel: { fontSize: 14, fontWeight: '500', color: colors.text },
  shareHint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
```

- [ ] **Step 4: The switch on an approved card**

Where the card renders an approved submission's read-only summary (the `a.submission?.status === 'approved'` branch — find it with `grep -n "'approved'" app/\(student\)/my-tasks.tsx`), add the same row, live:
```tsx
                <View style={styles.shareRow}>
                  <Text style={[styles.shareLabel, { flex: 1 }]}>{t('student.shareToFeed')}</Text>
                  <Switch
                    value={a.submission?.shareToFeed ?? true}
                    onValueChange={(v) => handleShareChange(a, v)}
                    trackColor={{ true: colors.primary }}
                  />
                </View>
```
with
```ts
  async function handleShareChange(a: MyAssignment, share: boolean) {
    if (!a.submission) return;
    // Optimistic, rolled back on refusal.
    setAssignments((prev) => prev.map((x) =>
      x.id === a.id && x.submission ? { ...x, submission: { ...x.submission, shareToFeed: share } } : x));
    try {
      await feedService.setSubmissionSharing(a.submission.id, share);
    } catch (err) {
      setAssignments((prev) => prev.map((x) =>
        x.id === a.id && x.submission ? { ...x, submission: { ...x.submission, shareToFeed: !share } } : x));
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    }
  }
```

- [ ] **Step 5: Gates and commit**

Run: `npx tsc --noEmit` — silent. `npx jest --silent` — 9 / 58.

```bash
git add "app/(student)/my-tasks.tsx" src/types/assignment.ts src/services/assignments.ts
git commit -m "feat(feed): the student decides per task whether an approved task is shared

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Walk it on a device

**Files:** none. SQL must already be applied (Task 2, step 5) with Parts A, B, C clean.

- [ ] **Step 1: The student**
1. Tab bar: **Feed**, not Polls. Seven tabs. Feed shows "Nothing shared yet" or existing posts of their group.
2. My Tasks: the "Share in the group feed when approved" switch is on by default; turn it off on one task, submit; have the mentor approve → **no** post. Turn the switch on from the approved card → post appears.
3. Submit a second task with the switch on; approve → post appears with title, competency, note, photos, document; **no reflection, no mentor note** anywhere on the card.
4. Like it (heart fills, count +1; toggle off), comment on a classmate's post → they receive `feed_comment`; comment on your own → no notification.
5. "Remove from feed" on your own task → gone with its comments; the switch on the card reads off.

- [ ] **Step 2: The advisor**
6. Tab bar: **Feed**, six tabs. Multi-group advisor: chips; archived dimmed and never the default. **Switch groups: the posts change.**
7. Write an announcement → appears at top; every active student gets `feed_announcement`; tapping it opens Feed scrolled to and highlighting that post.
8. Create a poll with 3 options → students vote; vote again on another option → count moves, total unchanged; bars sum to 100.
9. Remove a student's comment and a post → gone for everyone.
10. Confirm a student in **another** group sees none of it.

- [ ] **Step 3: The mentor**
11. Tab bar has **no** Feed and no Polls: six tabs. Approving a task still works and still awards XP.

- [ ] **Step 4: Nothing earlier broke**
12. Assignments: pick → draft → edit inline → attach → send. Reports: group selector, CSV.

---

## Risks

- **`list_feed_posts` is the privacy boundary.** It is the one place a classmate's submission is read on a student's behalf; it must never select `reflection` or `mentor_note`. Part C does not test this (it tests group isolation); the reviewer of Task 2 must read the projection line by line.
- **The trigger fires from `review_assignment`, an existing SECURITY DEFINER path.** A bug in `feed_publish_submission` that raises (rather than warns) would make every approval fail. The function returns NULL on every "nothing to do" branch and wraps the notification; the post INSERT itself is the only line that can raise, and the UNIQUE on `submission_id` is guarded by the EXISTS before it.
- **Realtime.** `feed_posts` is added to the publication in the migration; if the project's realtime is not enabled at all, the screen still works through pull-to-refresh and focus reload.
- **`profiles:author_id(...)` embed in `listComments`** depends on the FK Task 1 declares; if PostgREST reports an ambiguity, name the constraint: `profiles!feed_comments_author_id_fkey(first_name, last_name)`.
