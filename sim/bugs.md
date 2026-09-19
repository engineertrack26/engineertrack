# Simulation findings

Severity: blocker = flow cannot continue · wrong = rule/data wrong · rough = works but reads badly.

- **[rough]** selin-aydin — drafted a level-4 task for a competency whose group target is level 2. Expected: a guardrail (refusal or warning) — an advisor should not assign above the level the group is working towards. Got: accepted: the NOT_IN_SCOPE trigger and publish_assignments check only that the competency is targeted, never the level (matches the 2026-08-20 spec, which promises no level check) (`NOT_IN_SCOPE`).
- **[rough]** burak-sahin — submit student_id '21023456 ' (trailing space) and read student_profiles back. Expected: trimmed to '21023456', or at least not stored/shown with a stray trailing space. Got: stored verbatim as '21023456 '.
- **[rough]** deniz-yildirim — fill the internship form with internship_end_date before internship_start_date. Expected: refusal or a validation error (an internship cannot end before it starts). Got: accepted silently — row written with start=2026-09-19, end=2026-09-13; a later internship_open_day call would raise ID_SETUP per docs/internship-days-migration.sql (sp.internship_end_date < sp.internship_start_date), but nothing at write time stops it.
- **[wrong]** can-dogan — list the group's active memberships (ground truth for the contacts check). Expected: success. Got: UNKNOWN: Could not find a relationship between 'group_memberships' and 'profiles_public' in the schema cache (`UNKNOWN`).
