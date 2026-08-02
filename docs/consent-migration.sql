-- docs/consent-migration.sql
-- Slice 1 of partner feedback package A: GDPR/KVKK consent storage.

-- 1. Consent columns on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS consent_version  TEXT,
  ADD COLUMN IF NOT EXISTS consented_at     TIMESTAMPTZ;

-- 2. Record consent for the calling user
CREATE OR REPLACE FUNCTION record_consent(p_version TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_version IS NULL OR trim(p_version) = '' THEN
    RAISE EXCEPTION 'INVALID_CONSENT_VERSION';
  END IF;

  UPDATE profiles
  SET consent_version = trim(p_version),
      consented_at    = now()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION record_consent(TEXT) TO authenticated;

-- 3. Capture consent at signup, atomically with profile creation.
--    Replaces the version in docs/database-schema.sql:329.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, role, first_name, last_name, language,
    consent_version, consented_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'language', 'en'),
    NEW.raw_user_meta_data->>'consent_version',
    CASE
      WHEN NEW.raw_user_meta_data->>'consent_version' IS NOT NULL THEN now()
      ELSE NULL
    END
  );
  RETURN NEW;
END;
$$;
