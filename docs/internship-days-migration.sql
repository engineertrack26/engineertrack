-- Internship days v1. Additive: no legacy daily_logs, XP, feed or messages writes.
-- Apply once before enabling the UI; safe to re-run this version. See internship-days-setup.md.
BEGIN;
CREATE TABLE IF NOT EXISTS public.internship_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.internship_groups(id),
  mentor_id uuid NOT NULL REFERENCES public.profiles(id),
  company_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date),
  timezone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id, group_id, mentor_id, company_name, start_date, end_date)
);
CREATE TABLE IF NOT EXISTS public.internship_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_id uuid NOT NULL REFERENCES public.internship_placements(id),
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_date date NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  check_in_at timestamptz,
  reported_by uuid NOT NULL REFERENCES public.profiles(id),
  report_reason text NOT NULL DEFAULT '' CHECK (char_length(report_reason) <= 2000),
  attendance text NOT NULL DEFAULT 'pending' CHECK (attendance IN ('pending','present','partial','excused','absent')),
  attendance_by uuid REFERENCES public.profiles(id),
  attendance_at timestamptz,
  attendance_note text NOT NULL DEFAULT '',
  correction_requested boolean NOT NULL DEFAULT false,
  experience text NOT NULL DEFAULT '' CHECK (char_length(experience) <= 4000),
  learning text NOT NULL DEFAULT '' CHECK (char_length(learning) <= 4000),
  next_step text NOT NULL DEFAULT '' CHECK (char_length(next_step) <= 2000),
  support_level integer CHECK (support_level BETWEEN 0 AND 3),
  task_id uuid,
  task_title text,
  competency_name text,
  attachment jsonb,
  log_status text NOT NULL DEFAULT 'draft' CHECK (log_status IN ('draft','submitted')),
  submitted_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id, day_date)
);
CREATE INDEX IF NOT EXISTS internship_days_placement_date ON public.internship_days(placement_id, day_date);
CREATE TABLE IF NOT EXISTS public.internship_day_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid NOT NULL REFERENCES public.internship_days(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  event_type text NOT NULL CHECK (event_type IN ('created','log_saved','log_submitted','attendance','feedback','correction')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 4000),
  previous_value jsonb,
  next_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS internship_events_day ON public.internship_day_events(day_id, created_at);

-- Private authorization helper: never expose a relationship oracle to PostgREST.
CREATE OR REPLACE FUNCTION public.internship_can_student(p_student uuid, p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM student_profiles sp JOIN profiles actor ON actor.id = p_actor
    WHERE sp.id = p_student AND (
      (actor.role = 'student' AND sp.id = p_actor)
      OR (actor.role = 'mentor' AND sp.mentor_id = p_actor)
      -- The advisor's access outlives the term: the university reports on
      -- attendance after the group is archived, so ownership of the group is
      -- enough -- for current members and for anyone with a placement there.
      OR (actor.role = 'advisor' AND (
        EXISTS (SELECT 1 FROM group_memberships m JOIN internship_groups g ON g.id = m.group_id
                WHERE m.student_id = sp.id AND m.left_at IS NULL AND g.advisor_id = p_actor)
        OR EXISTS (SELECT 1 FROM internship_placements pl JOIN internship_groups g ON g.id = pl.group_id
                   WHERE pl.student_id = sp.id AND g.advisor_id = p_actor)))
    ));
$$;
REVOKE ALL ON FUNCTION public.internship_can_student(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.internship_can_day(p_day uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM internship_days d JOIN internship_placements p ON p.id = d.placement_id
    JOIN student_profiles sp ON sp.id = d.student_id
    WHERE d.id = p_day AND (
      d.student_id = auth.uid()
      -- advisor: owns the placement's group; archived or not, member or not
      OR EXISTS (SELECT 1 FROM internship_groups g WHERE g.id = p.group_id AND g.advisor_id = auth.uid())
      -- mentor: only while the relationship and the membership are live
      OR (sp.mentor_id = auth.uid() AND p.mentor_id = auth.uid() AND EXISTS (
          SELECT 1 FROM group_memberships m JOIN internship_groups g ON g.id = m.group_id
          WHERE m.student_id = d.student_id AND m.group_id = p.group_id AND m.left_at IS NULL AND NOT g.is_archived))
    ));
$$;
REVOKE ALL ON FUNCTION public.internship_can_day(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.internship_can_day(uuid) TO authenticated;

ALTER TABLE public.internship_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internship_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internship_day_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.internship_placements, public.internship_days, public.internship_day_events FROM PUBLIC, anon, authenticated;
-- Read RPCs redact private drafts. No direct SELECT grants, even with row-level security.
DROP POLICY IF EXISTS internship_days_read ON public.internship_days;
CREATE POLICY internship_days_read ON public.internship_days FOR SELECT TO authenticated USING (public.internship_can_day(id));
DROP POLICY IF EXISTS internship_events_read ON public.internship_day_events;
CREATE POLICY internship_events_read ON public.internship_day_events FOR SELECT TO authenticated USING (public.internship_can_day(day_id));

CREATE OR REPLACE FUNCTION public.internship_people()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', sp.id, 'name', concat_ws(' ',p.first_name,p.last_name),
    'company',sp.company_name,'startDate',sp.internship_start_date,'endDate',sp.internship_end_date,
    'mentorId',sp.mentor_id) ORDER BY p.first_name,p.last_name,sp.id), '[]'::jsonb)
  FROM student_profiles sp JOIN profiles p ON p.id = sp.id
  WHERE internship_can_student(sp.id,auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.internship_week(p_student_id uuid, p_from date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_from IS NULL OR NOT internship_can_student(p_student_id,auth.uid()) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  RETURN (SELECT coalesce(jsonb_agg((CASE WHEN d.student_id=auth.uid() OR d.log_status='submitted' THEN to_jsonb(d)
    ELSE to_jsonb(d) || jsonb_build_object('experience','','learning','','next_step','','support_level',NULL,'task_id',NULL,'task_title',NULL,'competency_name',NULL,'attachment',NULL) END)
    || jsonb_build_object('company',p.company_name,'timezone',p.timezone) ORDER BY d.day_date), '[]'::jsonb)
    FROM internship_days d JOIN internship_placements p ON p.id = d.placement_id
    WHERE d.student_id = p_student_id AND d.day_date BETWEEN p_from AND p_from + 6 AND internship_can_day(d.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.internship_events(p_day uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE own boolean;
BEGIN
  IF NOT internship_can_day(p_day) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  SELECT student_id=auth.uid() INTO own FROM internship_days WHERE id=p_day;
  RETURN (SELECT coalesce(jsonb_agg(
    (CASE WHEN own OR e.event_type NOT IN ('log_saved','log_submitted') THEN to_jsonb(e)
      ELSE to_jsonb(e) || jsonb_build_object('previous_value',NULL,'next_value',NULL) END)
      || jsonb_build_object('actor_name',concat_ws(' ',p.first_name,p.last_name)) ORDER BY e.created_at DESC,e.id)
    ,'[]'::jsonb) FROM internship_day_events e JOIN profiles p ON p.id=e.actor_id
    WHERE e.day_id=p_day AND (own OR e.event_type<>'log_saved'));
END;
$$;

CREATE OR REPLACE FUNCTION public.internship_open_day(p_student_id uuid, p_date date, p_timezone text, p_reason text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sp student_profiles%ROWTYPE; g internship_groups%ROWTYPE; placement internship_placements%ROWTYPE;
  existing internship_days%ROWTYPE; result uuid; actor_role text; local_today date;
BEGIN
  SELECT role INTO actor_role FROM profiles WHERE id = auth.uid();
  IF actor_role NOT IN ('student','mentor') OR actor_role IS NULL OR NOT internship_can_student(p_student_id,auth.uid()) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  IF p_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
  SELECT * INTO sp FROM student_profiles WHERE id=p_student_id FOR UPDATE;
  IF sp.mentor_id IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=sp.mentor_id AND role='mentor')
    OR nullif(trim(sp.company_name),'') IS NULL OR sp.internship_start_date IS NULL OR sp.internship_end_date IS NULL
    OR sp.internship_end_date < sp.internship_start_date THEN RAISE EXCEPTION 'ID_SETUP'; END IF;
  -- The app currently supports one active group. Do not choose arbitrarily if that invariant is broken.
  IF (SELECT count(*) FROM group_memberships m JOIN internship_groups gr ON gr.id=m.group_id
      WHERE m.student_id=sp.id AND m.left_at IS NULL AND NOT gr.is_archived) <> 1 THEN RAISE EXCEPTION 'ID_SETUP'; END IF;
  SELECT gr.* INTO g FROM internship_groups gr JOIN group_memberships m ON m.group_id=gr.id
    WHERE m.student_id=sp.id AND m.left_at IS NULL AND NOT gr.is_archived;
  SELECT * INTO existing FROM internship_days WHERE student_id=sp.id AND day_date=p_date;
  IF FOUND THEN
    IF NOT internship_can_day(existing.id) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
    RETURN existing.id; -- idempotent reconnect/double tap; never changes the original check-in time
  END IF;
  INSERT INTO internship_placements(student_id,group_id,mentor_id,company_name,start_date,end_date,timezone)
    VALUES(sp.id,g.id,sp.mentor_id,trim(sp.company_name),sp.internship_start_date,sp.internship_end_date,p_timezone)
    ON CONFLICT(student_id,group_id,mentor_id,company_name,start_date,end_date) DO NOTHING;
  SELECT * INTO placement FROM internship_placements WHERE student_id=sp.id AND group_id=g.id AND mentor_id=sp.mentor_id
    AND company_name=trim(sp.company_name) AND start_date=sp.internship_start_date AND end_date=sp.internship_end_date;
  local_today := (now() AT TIME ZONE placement.timezone)::date;
  IF p_date IS NULL OR p_date > local_today OR p_date NOT BETWEEN placement.start_date AND placement.end_date
    OR char_length(coalesce(p_reason,'')) > 2000 THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
  IF (p_date < local_today OR actor_role='mentor') AND nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'ID_REASON'; END IF;
  INSERT INTO internship_days(placement_id,student_id,day_date,reported_by,check_in_at,report_reason)
    VALUES(placement.id,sp.id,p_date,auth.uid(),CASE WHEN actor_role='student' AND p_date=local_today THEN now() ELSE NULL END,coalesce(trim(p_reason),'')) RETURNING id INTO result;
  INSERT INTO internship_day_events(day_id,actor_id,event_type,note,next_value)
    VALUES(result,auth.uid(),'created',coalesce(trim(p_reason),''),jsonb_build_object('date',p_date,'source',actor_role));
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.internship_save_log(p_day uuid,p_version integer,p_experience text,p_learning text,p_next_step text,p_support integer,p_submit boolean,p_reason text DEFAULT '',p_task uuid DEFAULT NULL,p_attachment jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d internship_days%ROWTYPE; task_label text; competency_label text;
BEGIN
  SELECT * INTO d FROM internship_days WHERE id=p_day FOR UPDATE;
  IF NOT FOUND OR d.student_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  IF d.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'ID_CONFLICT'; END IF;
  IF p_submit IS NULL OR p_experience IS NULL OR p_learning IS NULL OR p_next_step IS NULL
    OR char_length(p_experience)>4000 OR char_length(p_learning)>4000 OR char_length(p_next_step)>2000
    OR p_support NOT BETWEEN 0 AND 3 OR char_length(coalesce(p_reason,''))>2000 THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
  IF p_submit AND (nullif(trim(p_experience),'') IS NULL OR nullif(trim(p_learning),'') IS NULL OR p_support IS NULL) THEN RAISE EXCEPTION 'ID_REQUIRED'; END IF;
  IF d.log_status='submitted' AND (NOT p_submit OR nullif(trim(p_reason),'') IS NULL) THEN RAISE EXCEPTION 'ID_REASON'; END IF;
  IF p_task IS NOT NULL THEN
    IF p_task = d.task_id THEN task_label:=d.task_title; competency_label:=d.competency_name;
    ELSE
      SELECT a.title,c.name INTO task_label,competency_label FROM group_assignments a
        JOIN internship_placements p ON p.id=d.placement_id AND p.group_id=a.group_id
        JOIN kpi_triplets kt ON kt.id=a.triplet_id JOIN competency_kpis k ON k.id=kt.kpi_id JOIN competencies c ON c.id=k.competency_id
        WHERE a.id=p_task AND a.published_at IS NOT NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
    END IF;
  END IF;
  IF p_attachment IS NOT NULL AND (jsonb_typeof(p_attachment) IS DISTINCT FROM 'object'
    OR nullif(trim(p_attachment->>'name'),'') IS NULL OR char_length(p_attachment->>'name')>255
    OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='internship-day-files' AND o.name=p_attachment->>'path'
      AND split_part(o.name,'/',1)=auth.uid()::text AND split_part(o.name,'/',2)=d.id::text)) THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
  UPDATE internship_days SET experience=trim(p_experience),learning=trim(p_learning),next_step=trim(p_next_step),support_level=p_support,
    task_id=p_task,task_title=task_label,competency_name=competency_label,attachment=p_attachment,
    log_status=CASE WHEN p_submit THEN 'submitted' ELSE 'draft' END,
    submitted_at=CASE WHEN p_submit THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=p_day;
  INSERT INTO internship_day_events(day_id,actor_id,event_type,note,previous_value,next_value)
    SELECT p_day,auth.uid(),CASE WHEN p_submit THEN 'log_submitted' ELSE 'log_saved' END,coalesce(trim(p_reason),''),
      jsonb_build_object('experience',d.experience,'learning',d.learning,'next_step',d.next_step,'support_level',d.support_level,'log_status',d.log_status,'task_title',d.task_title,'attachment',d.attachment),
      jsonb_build_object('experience',experience,'learning',learning,'next_step',next_step,'support_level',support_level,'log_status',log_status,'task_title',task_title,'attachment',attachment)
    FROM internship_days WHERE id=p_day;
END;
$$;

-- Atomic bulk review, version checked. Any unauthorized or stale row rolls back the whole selection.
CREATE OR REPLACE FUNCTION public.internship_totals(p_student_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT internship_can_student(p_student_id,auth.uid()) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  RETURN (SELECT jsonb_build_object('present',count(*) FILTER(WHERE attendance='present'),
    'partial',count(*) FILTER(WHERE attendance='partial'),'pending',count(*) FILTER(WHERE attendance='pending'),
    'corrections',count(*) FILTER(WHERE correction_requested),
    'missingLogs',count(*) FILTER(WHERE attendance IN ('present','partial') AND log_status<>'submitted'))
    FROM internship_days WHERE student_id=p_student_id AND internship_can_day(id));
END;
$$;
REVOKE ALL ON FUNCTION public.internship_totals(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.internship_totals(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.internship_review(p_days jsonb,p_status text,p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item jsonb; d internship_days%ROWTYPE;
BEGIN
  IF (SELECT role FROM profiles WHERE id=auth.uid()) IS DISTINCT FROM 'mentor' THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('present','partial','excused','absent') OR jsonb_typeof(p_days) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_days) NOT BETWEEN 1 AND 31 OR char_length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'ID_INVALID'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_days) ORDER BY value->>'id' LOOP
    SELECT * INTO d FROM internship_days WHERE id=(item->>'id')::uuid FOR UPDATE;
    IF NOT FOUND OR NOT internship_can_day(d.id) OR NOT EXISTS(
      SELECT 1 FROM internship_placements p JOIN student_profiles sp ON sp.id=p.student_id
      WHERE p.id=d.placement_id AND p.mentor_id=auth.uid() AND sp.mentor_id=auth.uid()) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
    IF d.version IS DISTINCT FROM (item->>'version')::integer THEN RAISE EXCEPTION 'ID_CONFLICT'; END IF;
    IF (d.attendance<>'pending' OR p_status<>'present' OR d.correction_requested) AND nullif(trim(p_note),'') IS NULL THEN RAISE EXCEPTION 'ID_REASON'; END IF;
    UPDATE internship_days SET attendance=p_status,attendance_by=auth.uid(),attendance_at=now(),attendance_note=coalesce(trim(p_note),''),
      correction_requested=false,version=version+1,updated_at=now() WHERE id=d.id;
    INSERT INTO internship_day_events(day_id,actor_id,event_type,note,previous_value,next_value)
      VALUES(d.id,auth.uid(),'attendance',coalesce(trim(p_note),''),jsonb_build_object('attendance',d.attendance,'correction_requested',d.correction_requested),jsonb_build_object('attendance',p_status));
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.internship_note(p_day uuid,p_version integer,p_note text,p_correction boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d internship_days%ROWTYPE; actor_role text;
BEGIN
  SELECT role INTO actor_role FROM profiles WHERE id=auth.uid();
  SELECT * INTO d FROM internship_days WHERE id=p_day FOR UPDATE;
  IF NOT FOUND OR NOT internship_can_day(p_day) OR actor_role IS NULL OR actor_role NOT IN ('mentor','advisor')
    OR (p_correction AND actor_role<>'advisor') THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  -- After the archive the record is closed: the advisor can still read it, not write to it.
  IF EXISTS (SELECT 1 FROM internship_placements p JOIN internship_groups g ON g.id=p.group_id
             WHERE p.id=d.placement_id AND g.is_archived) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  IF d.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'ID_CONFLICT'; END IF;
  IF p_correction IS NULL OR nullif(trim(p_note),'') IS NULL OR char_length(p_note)>2000 THEN RAISE EXCEPTION 'ID_REQUIRED'; END IF;
  UPDATE internship_days SET correction_requested=CASE WHEN p_correction THEN true ELSE correction_requested END,version=version+1,updated_at=now() WHERE id=p_day;
  INSERT INTO internship_day_events(day_id,actor_id,event_type,note)
    VALUES(p_day,auth.uid(),CASE WHEN p_correction THEN 'correction' ELSE 'feedback' END,trim(p_note));
END;
$$;

REVOKE ALL ON FUNCTION public.internship_people(), public.internship_week(uuid,date), public.internship_open_day(uuid,date,text,text),
  public.internship_save_log(uuid,integer,text,text,text,integer,boolean,text,uuid,jsonb), public.internship_review(jsonb,text,text), public.internship_note(uuid,integer,text,boolean), public.internship_events(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.internship_people(), public.internship_week(uuid,date), public.internship_open_day(uuid,date,text,text),
  public.internship_save_log(uuid,integer,text,text,text,integer,boolean,text,uuid,jsonb), public.internship_review(jsonb,text,text), public.internship_note(uuid,integer,text,boolean), public.internship_events(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.internship_tasks(p_day uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM internship_days WHERE id=p_day AND student_id=auth.uid()) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'competency',c.name) ORDER BY a.created_at DESC),'[]'::jsonb)
    FROM group_assignments a JOIN internship_placements p ON p.group_id=a.group_id JOIN internship_days d ON d.placement_id=p.id
    JOIN kpi_triplets kt ON kt.id=a.triplet_id JOIN competency_kpis k ON k.id=kt.kpi_id JOIN competencies c ON c.id=k.competency_id
    WHERE d.id=p_day AND a.published_at IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.internship_tasks(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.internship_tasks(uuid) TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('internship-day-files','internship-day-files',false,10485760,ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='internship-day-files' AND (public OR file_size_limit IS DISTINCT FROM 10485760)) THEN
    RAISE EXCEPTION 'internship-day-files must be private and limited to 10 MiB';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.internship_file_allowed(p_path text,p_write boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM internship_days d WHERE d.id::text=split_part(p_path,'/',2)
    AND d.student_id::text=split_part(p_path,'/',1) AND (
      d.student_id=auth.uid() OR (NOT p_write AND d.log_status='submitted' AND d.attachment->>'path'=p_path AND internship_can_day(d.id))));
$$;
REVOKE ALL ON FUNCTION public.internship_file_allowed(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.internship_file_allowed(text,boolean) TO authenticated;
DROP POLICY IF EXISTS internship_files_insert ON storage.objects;
CREATE POLICY internship_files_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='internship-day-files' AND public.internship_file_allowed(name,true));
DROP POLICY IF EXISTS internship_files_select ON storage.objects;
CREATE POLICY internship_files_select ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='internship-day-files' AND public.internship_file_allowed(name,false));
-- No overwrite/delete permission: earlier attachments remain part of the audit trail.
-- Working days (Mon-Fri) in an inclusive date range; 0 when the range is
-- empty. No public-holiday calendar: the report says so.
CREATE OR REPLACE FUNCTION public.internship_weekdays(p_from date, p_to date)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN 0
    ELSE (SELECT count(*)::int FROM generate_series(p_from, p_to, interval '1 day') AS d WHERE extract(isodow FROM d) < 6) END;
$$;

-- Group attendance for the advisor's report: per-student totals and the
-- per-day record that backs the CSV. Expected days come from the placement's
-- own start/end (weekdays only, in the placement's timezone); "so far" stops
-- at today so a student mid-internship is not shown as missing the future. Ownership of the group is enough,
-- archived or not -- the university reports after the term. Log CONTENT is
-- never returned here, only each day's attendance and log status.
CREATE OR REPLACE FUNCTION public.internship_group_attendance(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM internship_groups g WHERE g.id=p_group_id AND g.advisor_id=auth.uid()) THEN RAISE EXCEPTION 'ID_FORBIDDEN'; END IF;
  RETURN jsonb_build_object(
    'students', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id',s.student_id,'name',s.name,'company',s.company,'mentor',s.mentor,
        'present',s.present,'partial',s.partial,'excused',s.excused,'absent',s.absent,'pending',s.pending,
        'corrections',s.corrections,'submittedLogs',s.submitted_logs,
        'recorded',s.recorded,'expectedDays',s.expected_days,'expectedSoFar',s.expected_so_far,
        'unrecorded',GREATEST(0,s.expected_so_far - s.recorded)) ORDER BY s.name,s.student_id),'[]'::jsonb)
      FROM (SELECT pl.student_id, concat_ws(' ',p.first_name,p.last_name) AS name,
          string_agg(DISTINCT pl.company_name,', ') AS company,
          string_agg(DISTINCT concat_ws(' ',mp.first_name,mp.last_name),', ') AS mentor,
          count(*) FILTER (WHERE d.attendance='present') AS present,
          count(*) FILTER (WHERE d.attendance='partial') AS partial,
          count(*) FILTER (WHERE d.attendance='excused') AS excused,
          count(*) FILTER (WHERE d.attendance='absent') AS absent,
          count(*) FILTER (WHERE d.attendance='pending') AS pending,
          count(*) FILTER (WHERE d.correction_requested) AS corrections,
          count(*) FILTER (WHERE d.log_status='submitted') AS submitted_logs,
          count(d.id) AS recorded,
          -- one placement may carry many days: sum each placement's range once
          (SELECT coalesce(sum(internship_weekdays(x.start_date,x.end_date)),0)::int FROM internship_placements x
             WHERE x.student_id=pl.student_id AND x.group_id=p_group_id) AS expected_days,
          (SELECT coalesce(sum(internship_weekdays(x.start_date,LEAST(x.end_date,(now() AT TIME ZONE x.timezone)::date))),0)::int
             FROM internship_placements x WHERE x.student_id=pl.student_id AND x.group_id=p_group_id) AS expected_so_far
        FROM internship_placements pl LEFT JOIN internship_days d ON d.placement_id=pl.id
        JOIN profiles p ON p.id=pl.student_id LEFT JOIN profiles mp ON mp.id=pl.mentor_id
        WHERE pl.group_id=p_group_id GROUP BY pl.student_id,p.first_name,p.last_name) s),
    'days', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'studentId',d.student_id,'name',concat_ws(' ',p.first_name,p.last_name),'date',d.day_date,
        'attendance',d.attendance,'checkedIn',d.check_in_at IS NOT NULL,'checkInAt',d.check_in_at,
        'decidedBy',concat_ws(' ',ap.first_name,ap.last_name),'decidedAt',d.attendance_at,
        'correctionRequested',d.correction_requested,'logStatus',d.log_status) ORDER BY p.first_name,p.last_name,d.student_id,d.day_date),'[]'::jsonb)
      FROM internship_days d JOIN internship_placements pl ON pl.id=d.placement_id
      JOIN profiles p ON p.id=d.student_id LEFT JOIN profiles ap ON ap.id=d.attendance_by
      WHERE pl.group_id=p_group_id));
END;
$$;
REVOKE ALL ON FUNCTION public.internship_group_attendance(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.internship_group_attendance(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
