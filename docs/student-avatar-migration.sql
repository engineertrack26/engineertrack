-- Cosmetic preferences only. No XP/level writes and no changes to existing signup triggers.
BEGIN;

CREATE TABLE IF NOT EXISTS public.student_avatar_preferences (
  student_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  avatar_id text NOT NULL CHECK (avatar_id ~ '^0[1-9]$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.student_avatar_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_avatar_preferences FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_student_avatar()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'student'
  ) THEN RAISE EXCEPTION 'AVATAR_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('avatarId', a.avatar_id,
    'level', public.calculate_level(coalesce(s.total_xp, 0))) INTO result
  FROM public.profiles p
  LEFT JOIN public.student_avatar_preferences a ON a.student_id = p.id
  LEFT JOIN public.student_profiles s ON s.id = p.id
  WHERE p.id = auth.uid();
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_student_avatar(p_avatar_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'student'
  ) THEN RAISE EXCEPTION 'AVATAR_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_avatar_id IS NULL OR p_avatar_id !~ '^0[1-9]$' THEN
    RAISE EXCEPTION 'AVATAR_INVALID' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.student_avatar_preferences(student_id, avatar_id)
    VALUES (auth.uid(), p_avatar_id)
    ON CONFLICT (student_id) DO UPDATE SET avatar_id = EXCLUDED.avatar_id, updated_at = now();
  RETURN public.my_student_avatar();
END;
$$;

-- Capture registration choice even when email confirmation means there is no session yet.
-- Independent AFTER INSERT trigger preserves the existing consent/profile creation logic.
CREATE OR REPLACE FUNCTION public.capture_student_avatar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE selected text;
BEGIN
  IF NEW.role = 'student' THEN
    SELECT u.raw_user_meta_data->>'student_avatar_id' INTO selected
      FROM auth.users u WHERE u.id = NEW.id;
    IF selected ~ '^0[1-9]$' THEN
      INSERT INTO public.student_avatar_preferences(student_id, avatar_id)
      VALUES (NEW.id, selected) ON CONFLICT (student_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_capture_student_avatar ON public.profiles;
CREATE TRIGGER trg_capture_student_avatar AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.capture_student_avatar();

REVOKE ALL ON FUNCTION public.my_student_avatar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_student_avatar(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_student_avatar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_student_avatar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_student_avatar(text) TO authenticated;
COMMIT;
