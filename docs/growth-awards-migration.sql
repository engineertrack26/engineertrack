-- Apply after growth-journey-migration.sql and optional-closure fix.
-- Refresh validates the caller's metrics and persists milestones, never XP.
BEGIN;
CREATE TABLE IF NOT EXISTS public.growth_awards (
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id uuid NOT NULL,
  stage_id text NOT NULL,
  rule_version integer NOT NULL DEFAULT 1 CHECK(rule_version = 1),
  family text NOT NULL CHECK(family IN ('production','feedback','reflection','competency','consistency','journey')),
  target integer NOT NULL CHECK(target > 0),
  label text,
  earned_at timestamptz NOT NULL DEFAULT now(),
  verified boolean NOT NULL DEFAULT true,
  checked_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL,
  PRIMARY KEY(student_id,group_id,stage_id,rule_version)
);
ALTER TABLE public.growth_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_awards FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_my_growth_awards()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE student uuid := auth.uid(); m jsonb; grp uuid; stage record; current_value integer;
  total integer; result jsonb;
BEGIN
  IF student IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=student AND p.role='student') THEN
    RAISE EXCEPTION 'GROWTH_FORBIDDEN';
  END IF;
  -- Only own-account refresh; no caller-supplied subject, threshold or award.
  PERFORM pg_advisory_xact_lock(hashtextextended('growth_awards:' || student::text,0));
  m := public.my_growth_journey();
  grp := (m->>'groupId')::uuid;
  IF grp IS NOT NULL THEN
    total := (m->>'competenciesTotal')::integer;
    -- Revalidate without deleting history or changing the first earned date.
    UPDATE public.growth_awards a SET verified = coalesce((CASE a.family
      WHEN 'production' THEN (m->>'approvedTasks')::integer
      WHEN 'feedback' THEN (m->>'improvedTasks')::integer
      WHEN 'reflection' THEN (m->>'reflectiveDays')::integer
      WHEN 'consistency' THEN (m->>'activeWeeks')::integer
      WHEN 'competency' THEN (m->>'competenciesReached')::integer
      WHEN 'journey' THEN CASE a.label
        WHEN 'prepared' THEN CASE WHEN (m->>'prepared')::boolean THEN 1 ELSE 0 END
        WHEN 'reviewed' THEN CASE WHEN (m->>'approvedTasks')::integer > 0 THEN 1 ELSE 0 END
        WHEN 'closed' THEN CASE WHEN (m->>'closed')::boolean THEN 1 ELSE 0 END END
      END) >= a.target,false), checked_at=now()
    WHERE a.student_id=student AND a.group_id=grp AND a.rule_version=1;

    FOR stage IN
      SELECT v.family, v.target, NULL::text AS label FROM (VALUES
        ('production',1),('production',5),('production',15),('production',30),
        ('feedback',1),('feedback',3),('feedback',5),
        ('reflection',5),('reflection',20),('reflection',50),('reflection',100),
        ('consistency',4),('consistency',8),('consistency',16),('consistency',24)
      ) v(family,target)
      UNION ALL
      SELECT 'competency', n, NULL::text FROM (
        SELECT DISTINCT unnest(ARRAY[1,ceil(total*.25)::int,ceil(total*.5)::int,total]) AS n
      ) thresholds WHERE total>0 AND n>0
      UNION ALL
      SELECT 'journey',1,v.label FROM (VALUES('prepared'),('reviewed'),('closed')) v(label)
    LOOP
      current_value := CASE stage.family
        WHEN 'production' THEN (m->>'approvedTasks')::integer
        WHEN 'feedback' THEN (m->>'improvedTasks')::integer
        WHEN 'reflection' THEN (m->>'reflectiveDays')::integer
        WHEN 'consistency' THEN (m->>'activeWeeks')::integer
        WHEN 'competency' THEN (m->>'competenciesReached')::integer
        WHEN 'journey' THEN CASE stage.label
          WHEN 'prepared' THEN CASE WHEN (m->>'prepared')::boolean THEN 1 ELSE 0 END
          WHEN 'reviewed' THEN CASE WHEN (m->>'approvedTasks')::integer>0 THEN 1 ELSE 0 END
          WHEN 'closed' THEN CASE WHEN (m->>'closed')::boolean THEN 1 ELSE 0 END END
        END;
      IF current_value >= stage.target THEN
        INSERT INTO public.growth_awards(student_id,group_id,stage_id,family,target,label,evidence)
          VALUES(student,grp,stage.family || '_' || coalesce(stage.label,stage.target::text),
            stage.family,stage.target,stage.label,m)
          ON CONFLICT(student_id,group_id,stage_id,rule_version) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'groupId',a.group_id,'stageId',a.stage_id,'family',a.family,'target',a.target,
    'label',a.label,'earnedAt',a.earned_at,'verified',a.verified,'checkedAt',a.checked_at,
    'ruleVersion',a.rule_version) ORDER BY a.earned_at DESC,a.stage_id),'[]'::jsonb)
    INTO result FROM public.growth_awards a WHERE a.student_id=student;
  RETURN jsonb_build_object('metrics',m,'awards',result);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_my_growth_awards() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_my_growth_awards() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
