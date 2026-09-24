-- docs/message-broadcast.sql — idempotent. Apply after docs/direct-messages-rpcs.sql
-- and docs/internship-closure-guards.sql (it calls open_conversation and send_message).
--
-- One message, several students, each in their own private one-to-one
-- conversation: the recipient sees an ordinary message from their advisor or
-- mentor, never the other recipients, and their reply goes only back to the
-- sender. There is no group chat here and none is implied.
--
-- The rules are NOT restated. Each recipient goes through the existing
-- open_conversation + send_message, so who may message whom (can_message), a
-- closed internship, a block, the recipient's notification and the sender's
-- read marker all keep living in exactly one place. What this function adds is
-- the loop, the caller's role gate, and per-recipient error isolation.

CREATE OR REPLACE FUNCTION broadcast_message(p_recipients UUID[], p_body TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role      TEXT;
  v_ids       UUID[];
  v_id        UUID;
  v_group     UUID;
  v_conv      UUID;
  v_sent      INTEGER := 0;
  v_failed    JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Only staff broadcast. A student writes to one classmate at a time; the
  -- app does not offer them this, and the API must not either.
  SELECT p.role INTO v_role FROM profiles p WHERE p.id = auth.uid();
  IF v_role NOT IN ('advisor', 'mentor') THEN RAISE EXCEPTION 'ROLE_NOT_ALLOWED'; END IF;

  IF btrim(coalesce(p_body, '')) = '' THEN RAISE EXCEPTION 'MESSAGE_EMPTY'; END IF;
  -- The messages table's own limit, refused here rather than as a constraint
  -- violation halfway through the loop.
  IF char_length(btrim(p_body)) > 2000 THEN RAISE EXCEPTION 'MESSAGE_TOO_LONG'; END IF;

  -- Distinct, never yourself, NULLs dropped.
  SELECT array_agg(DISTINCT r) INTO v_ids
  FROM unnest(coalesce(p_recipients, ARRAY[]::UUID[])) AS r
  WHERE r IS NOT NULL AND r <> auth.uid();

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN RAISE EXCEPTION 'RECIPIENTS_EMPTY'; END IF;
  -- A group is smaller than this; the ceiling is here so one call cannot turn
  -- into a mailing run.
  IF array_length(v_ids, 1) > 30 THEN RAISE EXCEPTION 'TOO_MANY_RECIPIENTS'; END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    -- Each recipient is attempted on its own: one refusal (a closed
    -- internship, a student who left) must not cost the others their message.
    BEGIN
      -- The recipient's own active group decides where the conversation
      -- lives. A student has exactly one, which is why the caller passes no
      -- group: it also makes a mentor's students in different groups work.
      SELECT m.group_id INTO v_group
      FROM group_memberships m
      WHERE m.student_id = v_id AND m.left_at IS NULL
      LIMIT 1;

      IF v_group IS NULL THEN
        RAISE EXCEPTION 'NOT_IN_GROUP';
      END IF;

      v_conv := open_conversation(v_group, v_id);
      PERFORM send_message(v_conv, p_body);
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || jsonb_build_object(
        'id', v_id,
        -- SQLERRM is the stable code the inner function raised
        -- (CANNOT_MESSAGE, INTERNSHIP_CLOSED, BLOCKED, NOT_IN_GROUP …).
        'code', split_part(SQLERRM, ':', 1)
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('sent', v_sent, 'failed', v_failed);
END;
$$;

GRANT EXECUTE ON FUNCTION broadcast_message(UUID[], TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION broadcast_message(UUID[], TEXT) FROM PUBLIC, anon;

-- Verification (expected: one NOTICE, no exception)
DO $$
BEGIN
  IF to_regprocedure('public.broadcast_message(uuid[],text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: broadcast_message missing'; END IF;
  IF NOT has_function_privilege('authenticated', 'broadcast_message(uuid[],text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated cannot call broadcast_message'; END IF;
  IF has_function_privilege('anon', 'broadcast_message(uuid[],text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can call broadcast_message'; END IF;
  RAISE NOTICE 'PASS: broadcast_message installed';
END $$;
NOTIFY pgrst, 'reload schema';
