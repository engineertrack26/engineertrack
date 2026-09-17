// In-memory PostgreSQL; no production connection or credentials.
// node scripts/test-growth-journey.cjs <absolute path to @electric-sql/pglite>
const { PGlite } = require(process.argv[2]);
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const student=id(1), mentor=id(2), other=id(3), group=id(4), task=id(5), submission=id(6);
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function metrics(uid=student, awards=false) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
  await db.exec('SET ROLE authenticated');
  const result=(await db.query(awards?'SELECT sync_my_growth_awards() AS m':'SELECT my_growth_journey() AS m')).rows[0].m;
  await db.exec('RESET ROLE');return result;
}
(async()=>{
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
    CREATE TABLE profiles(id uuid PRIMARY KEY,role text);
    CREATE TABLE student_profiles(id uuid,mentor_id uuid,company_name text,internship_start_date date,internship_end_date date);
    CREATE TABLE group_memberships(student_id uuid,group_id uuid,left_at timestamptz);
    CREATE TABLE group_assignments(id uuid PRIMARY KEY,group_id uuid,published_at timestamptz);
    CREATE TABLE assignment_submissions(id uuid PRIMARY KEY,student_id uuid,assignment_id uuid,status text,mentor_note text);
    CREATE TABLE xp_transactions(student_id uuid,reason text,created_at timestamptz);
    CREATE TABLE internship_placements(id uuid PRIMARY KEY,group_id uuid);
    CREATE TABLE internship_days(student_id uuid,placement_id uuid,day_date date,attendance text,correction_requested boolean,log_status text,experience text,learning text,support_level int);
    CREATE TABLE internship_closures(student_id uuid,group_id uuid,reopened_at timestamptz,report_version int);
    CREATE FUNCTION get_competency_progress(uuid) RETURNS TABLE(current_level int,target_level int) LANGUAGE sql AS $$ SELECT 1,1 UNION ALL SELECT 0,2 $$;
  `);
  for(const [uid,role] of [[student,'student'],[mentor,'mentor'],[other,'student']]) await db.query('INSERT INTO profiles VALUES($1,$2)',[uid,role]);
  await db.query("INSERT INTO student_profiles VALUES($1,$2,'Company','2026-01-01','2026-12-31')",[student,mentor]);
  await db.query('INSERT INTO group_memberships VALUES($1,$2,NULL)',[student,group]);
  await db.query('INSERT INTO group_assignments VALUES($1,$2,now())',[task,group]);
  // A pre-migration approved record is not a new feedback success.
  await db.query("INSERT INTO assignment_submissions VALUES($1,$2,$3,'approved','')",[id(7),student,task]);
  const sql=readFileSync('docs/growth-journey-migration.sql','utf8');
  await db.exec(sql);await db.exec(sql);checks++;
  const awardsSql=readFileSync('docs/growth-awards-migration.sql','utf8');
  await db.exec(awardsSql);await db.exec(awardsSql);checks++;
  const firstAwards=(await metrics(student,true)).awards;
  eq(firstAwards.length,4);
  const stableAwards = list => list.map(({checkedAt,...a})=>a);
  eq(stableAwards((await metrics(student,true)).awards),stableAwards(firstAwards));
  eq((await metrics(other,true)).awards,[]);
  await assert.rejects(()=>metrics(mentor,true),/GROWTH_FORBIDDEN/);checks++;
  await db.exec('RESET ROLE');
  let m=await metrics();eq(m.approvedTasks,1);eq(m.improvedTasks,0);eq(m.competenciesReached,1);eq(m.prepared,true);
  eq((await metrics(other)).groupId,null);
  await assert.rejects(()=>metrics(mentor),/GROWTH_FORBIDDEN/);checks++;
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[student]);
  await db.query("INSERT INTO assignment_submissions VALUES($1,$2,$3,'submitted','')",[submission,student,task]);
  await db.query("UPDATE assignment_submissions SET status='needs_revision',mentor_note='Explain the result' WHERE id=$1",[submission]);
  await db.query("UPDATE assignment_submissions SET status='submitted',mentor_note=NULL WHERE id=$1",[submission]);
  await db.query("UPDATE assignment_submissions SET status='approved' WHERE id=$1",[submission]);
  m=await metrics();eq(m.improvedTasks,1);
  eq((await metrics(student,true)).awards.some(a=>a.stageId==='feedback_1'&&a.verified),true);
  await db.query("UPDATE assignment_submissions SET status='approved' WHERE id=$1",[submission]);
  eq((await metrics()).improvedTasks,1);
  eq(Number((await db.query('SELECT count(*) AS n FROM growth_submission_events WHERE submission_id=$1',[submission])).rows[0].n),4);
  await db.query("UPDATE assignment_submissions SET status='needs_revision',mentor_note='Reopen' WHERE id=$1",[submission]);
  eq((await metrics()).improvedTasks,0);
  eq((await metrics(student,true)).awards.find(a=>a.stageId==='feedback_1').verified,false);
  await db.query("UPDATE assignment_submissions SET status='submitted' WHERE id=$1",[submission]);
  await db.query("UPDATE assignment_submissions SET status='approved' WHERE id=$1",[submission]);
  eq((await metrics()).improvedTasks,1);
  eq((await metrics(student,true)).awards.filter(a=>a.stageId==='feedback_1'&&a.verified).length,1);
  await db.query("UPDATE assignment_submissions SET status='needs_revision',mentor_note='Reopen legacy' WHERE id=$1",[id(7)]);
  await db.query("UPDATE assignment_submissions SET status='submitted' WHERE id=$1",[id(7)]);
  await db.query("UPDATE assignment_submissions SET status='approved' WHERE id=$1",[id(7)]);
  eq((await metrics()).improvedTasks,1);
  await db.query('INSERT INTO internship_placements VALUES($1,$2)',[id(8),group]);
  await db.query("INSERT INTO internship_days VALUES($1,$2,'2026-01-05','present',false,'draft','Work','Learning',1)",[student,id(8)]);
  eq((await metrics()).reflectiveDays,0);
  await db.exec("UPDATE internship_days SET log_status='submitted'");
  eq((await metrics()).reflectiveDays,1);
  await db.exec("UPDATE internship_days SET attendance='partial'");
  eq((await metrics()).reflectiveDays,1);
  await db.exec('UPDATE internship_days SET correction_requested=true');
  eq((await metrics()).reflectiveDays,0);
  await db.exec('UPDATE internship_days SET correction_requested=false');
  await db.query("INSERT INTO xp_transactions VALUES($1,$2,'2026-01-06T12:00:00Z')",[student,'assignment_submitted:'+submission]);
  eq((await metrics()).activeWeeks,1); // task + journal in same ISO week
  await db.query("INSERT INTO xp_transactions VALUES($1,$2,'2026-02-09T12:00:00Z')",[student,'assignment_submitted:'+id(7)]);
  eq((await metrics()).activeWeeks,2); // gaps do not reset the count
  await db.query('INSERT INTO internship_closures VALUES($1,$2,NULL,1)',[student,group]);
  eq((await metrics()).closed,true);
  eq((await metrics(student,true)).awards.find(a=>a.stageId==='journey_closed').verified,true);
  await db.exec('UPDATE internship_closures SET reopened_at=now()');
  eq((await metrics()).closed,false);
  eq((await metrics(student,true)).awards.find(a=>a.stageId==='journey_closed').verified,false);
  await db.exec('DROP TABLE internship_closures');
  m=await metrics();eq(m.closed,null);eq(m.reflectiveDays,1);eq(m.activeWeeks,2);
  await db.query('UPDATE group_memberships SET group_id=$1',[id(9)]);
  m=await metrics();eq(m.approvedTasks,0);eq(m.reflectiveDays,0);eq(m.activeWeeks,0);
  eq((await metrics(student,true)).awards.some(a=>a.groupId===group&&a.stageId==='feedback_1'),true);
  const allMetrics={groupId:group,approvedTasks:30,availableTasks:30,improvedTasks:5,reflectiveDays:100,
    activeWeeks:24,competenciesReached:6,competenciesTotal:6,plannedDays:365,plannedWeeks:52,prepared:true,closed:true};
  // Isolate award thresholds after the real metric-query checks above.
  await db.exec(`CREATE OR REPLACE FUNCTION my_growth_journey() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN RETURN '${JSON.stringify(allMetrics)}'::jsonb; END; $$`);
  const allAwards=(await metrics(student,true)).awards.filter(a=>a.groupId===group);
  eq(allAwards.length,22);eq(allAwards.every(a=>a.verified),true);
  eq(new Set(allAwards.map(a=>a.stageId)).size,22);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(()=>db.exec('SELECT * FROM growth_submission_events'));checks++;
  await assert.rejects(()=>db.exec('DELETE FROM growth_submission_path'));checks++;
  await assert.rejects(()=>db.exec('SELECT * FROM growth_awards'));checks++;
  await assert.rejects(()=>db.exec('DELETE FROM growth_awards'));checks++;
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(()=>db.exec('SELECT my_growth_journey()'));checks++;
  await assert.rejects(()=>db.exec('SELECT sync_my_growth_awards()'));checks++;
  console.log(`${checks} PostgreSQL checks passed`);
  await db.close();
})().catch(async error=>{console.error(error);await db.close();process.exitCode=1;});
