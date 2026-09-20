-- docs/security-hardening-2026-09-20.sql — idempotent. Apply after the
-- inventory (docs/security-review-inventory.sql) has been read.
--
-- Finding S1 (untrusted-user probe, sim/security-probe.cjs): Supabase's default
-- privileges grant EXECUTE on every new function to anon, so `REVOKE … FROM
-- PUBLIC, authenticated` on internal helpers (internship_closed,
-- build_internship_report, …) still left the ANON role able to call them —
-- internship_closed answered a caller with no session at all. Nothing in this
-- app is called without a session (sign-in and sign-up go through GoTrue, not
-- PostgREST), so anon needs no function at all.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prorettype <> 'trigger'::regtype
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', f.sig);
  END LOOP;
END $$;
-- And stop the default from re-granting it to functions created later.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Finding S2: five buckets had no size limit (only internship-day-files did).
-- Photo buckets also get a MIME allowlist; document buckets keep any type
-- (the picker accepts whatever the student's phone offers — CAD, archives —
-- and an allowlist there would refuse legitimate evidence) but are capped.
UPDATE storage.buckets SET file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id IN ('log-photos', 'avatars') AND (file_size_limit IS NULL OR allowed_mime_types IS NULL);
UPDATE storage.buckets SET file_size_limit = 20971520
WHERE id IN ('log-documents', 'assignment-docs', 'feed-attachments') AND file_size_limit IS NULL;

-- Finding S3: the public avatars bucket could be LISTED by anyone (the anon
-- probe saw entries). Files stay reachable by their public URL (the app stores
-- that URL in profiles.avatar_url); only listing/browsing is closed. The
-- policy's name comes from the inventory (#8) — drop whatever SELECT policy
-- lets anon list the bucket and replace it with one scoped to the owner.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
      AND (qual LIKE '%avatars%') AND (roles::text LIKE '%anon%' OR roles::text LIKE '%public%')
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;
DROP POLICY IF EXISTS "avatars owner lists own folder" ON storage.objects;
CREATE POLICY "avatars owner lists own folder" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Verification (expected: one NOTICE, no exception)
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF n > 0 THEN RAISE EXCEPTION 'FAIL S1: % functions still executable by anon', n; END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE file_size_limit IS NULL) THEN
    RAISE EXCEPTION 'FAIL S2: a bucket still has no size limit'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
             AND qual LIKE '%avatars%' AND (roles::text LIKE '%anon%' OR roles::text LIKE '%public%')) THEN
    RAISE EXCEPTION 'FAIL S3: anon can still list the avatars bucket'; END IF;
  RAISE NOTICE 'PASS: hardening applied (anon has no RPC, every bucket is size-limited, avatars are not listable)';
END $$;
NOTIFY pgrst, 'reload schema';
