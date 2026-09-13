-- ============================================================
-- Direct messages verification. Run in the Supabase SQL editor, one part
-- per submission. Anonymous dollar-quoting only.
-- Apply order: docs/direct-messages-migration.sql, docs/direct-messages-rpcs.sql,
-- then this file.
-- PART A is STRUCTURAL (owner session bypasses RLS). Part C evaluates the
-- policies under SET LOCAL ROLE authenticated.
-- ============================================================

-- ============================================================
-- PART A — schema assertions. Expected: one row "PASS: schema assertions held".
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversations','messages','conversation_reads','conversation_blocks'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      RAISE EXCEPTION 'FAIL: table % is missing', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = t AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'FAIL: RLS is not enabled on %', t;
    END IF;
    -- SELECT-only: any INSERT/UPDATE/DELETE policy is a second write path.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND cmd <> 'SELECT') THEN
      RAISE EXCEPTION 'FAIL: % has a direct write policy', t;
    END IF;
    -- Privacy: owns_group must not appear in any policy on these tables.
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t
               AND (coalesce(qual, '') LIKE '%owns_group%' OR coalesce(with_check, '') LIKE '%owns_group%')) THEN
      RAISE EXCEPTION 'FAIL: a policy on % mentions owns_group -- the advisor must not be able to read messages', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_pair_ordered') THEN
    RAISE EXCEPTION 'FAIL: conversations_pair_ordered CHECK is missing';
  END IF;
  FOREACH t IN ARRAY ARRAY['can_message','can_access_conversation'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = t) THEN
      RAISE EXCEPTION 'FAIL: %() is missing', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['trg_dm_membership_closed','trg_dm_group_archived','trg_dm_mentor_changed'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'FAIL: trigger % is missing', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
    RAISE EXCEPTION 'FAIL: messages is not in the supabase_realtime publication';
  END IF;
  RAISE NOTICE 'PASS: schema assertions held';
END $$;
SELECT 'PASS: schema assertions held' AS result;

-- Parts B and C are appended by Task 2.
