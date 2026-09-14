// Isolated PostgreSQL regression harness. No network or production credentials.
// node scripts/test-internship-days.cjs <absolute path to @electric-sql/pglite>
const { PGlite } = require(process.argv[2]);
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const student=id(1), mentor=id(2), advisor=id(3), outsider=id(4), group=id(5), task=id(10), draftTask=id(11);
let checks=0;
async function as(uid, sql, args=[]) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
  await db.exec('SET ROLE authenticated');
  return db.query(sql,args);
}
async function rejected(uid, sql, args, message) {
  await assert.rejects(()=>as(uid,sql,args),message ? new RegExp(message) : undefined); checks++;
}
(async()=>{
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth,public,storage TO authenticated,anon;
    CREATE TABLE profiles(id uuid PRIMARY KEY,role text,first_name text,last_name text);
    CREATE TABLE student_profiles(id uuid PRIMARY KEY REFERENCES profiles,mentor_id uuid,advisor_id uuid,company_name text,internship_start_date date,internship_end_date date);
    CREATE TABLE internship_groups(id uuid PRIMARY KEY,advisor_id uuid,is_archived boolean DEFAULT false);
    CREATE TABLE group_memberships(id uuid PRIMARY KEY,group_id uuid,student_id uuid,left_at timestamptz);
    CREATE TABLE competencies(id uuid PRIMARY KEY,name text);
    CREATE TABLE competency_kpis(id uuid PRIMARY KEY,competency_id uuid);
    CREATE TABLE kpi_triplets(id uuid PRIMARY KEY,kpi_id uuid);
    CREATE TABLE group_assignments(id uuid PRIMARY KEY,group_id uuid,triplet_id uuid,title text,published_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT ON storage.objects TO authenticated;
  `);
  const migration=readFileSync('docs/internship-days-migration.sql','utf8');
  await db.exec(migration);
  await db.exec(migration); // repeat application must preserve schema and grants
  checks++;
  for(const [uid,role] of [[student,'student'],[mentor,'mentor'],[advisor,'advisor'],[outsider,'mentor']])
    await db.query('INSERT INTO profiles VALUES($1,$2,$2,$2)',[uid,role]);
  await db.query("INSERT INTO student_profiles VALUES($1,$2,$3,'Company',(now() AT TIME ZONE 'Europe/Istanbul')::date-30,(now() AT TIME ZONE 'Europe/Istanbul')::date+30)",[student,mentor,advisor]);
  await db.query('INSERT INTO internship_groups(id,advisor_id) VALUES($1,$2)',[group,advisor]);
  await db.query('INSERT INTO group_memberships VALUES($1,$2,$3,NULL)',[id(6),group,student]);
  await db.query("INSERT INTO competencies VALUES($1,'Competency')",[id(7)]);
  await db.query('INSERT INTO competency_kpis VALUES($1,$2)',[id(8),id(7)]);
  await db.query('INSERT INTO kpi_triplets VALUES($1,$2)',[id(9),id(8)]);
  await db.query("INSERT INTO group_assignments VALUES($1,$2,$3,'Published',now(),now()),($4,$2,$3,'Draft',NULL,now())",[task,group,id(9),draftTask]);
  const date=(await db.query("SELECT to_char((now() AT TIME ZONE 'Europe/Istanbul')::date,'YYYY-MM-DD') AS day")).rows[0].day;
  const yesterday=(await db.query("SELECT to_char((now() AT TIME ZONE 'Europe/Istanbul')::date-1,'YYYY-MM-DD') AS day")).rows[0].day;
  const open='SELECT internship_open_day($1,$2,\'Europe/Istanbul\',$3) AS id';
  const day=(await as(student,open,[student,date,''])).rows[0].id;
  assert.equal((await as(student,open,[student,date,''])).rows[0].id,day);checks++;
  await rejected(outsider,open,[student,yesterday,'reason'],'ID_FORBIDDEN');
  await rejected(advisor,open,[student,yesterday,'reason'],'ID_FORBIDDEN');
  await rejected(student,open,[student,yesterday,''],'ID_REASON');
  await rejected(student,"SELECT internship_open_day($1,'2099-01-01','Europe/Istanbul','reason')",[student],'ID_INVALID');
  const day2=(await as(mentor,open,[student,yesterday,'Missed declaration'])).rows[0].id;
  const week=async uid=>(await as(uid,'SELECT internship_week($1,$2) AS days',[student,yesterday])).rows[0].days;
  assert.equal((await week(student)).find(d=>d.id===day2).check_in_at,null);checks++;
  const save='SELECT internship_save_log($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)';
  await as(student,save,[day,1,'Private draft','Learning','',0,false,'',null,null]);
  assert.equal((await week(mentor)).find(d=>d.id===day).experience,'');
  assert.equal((await week(advisor)).find(d=>d.id===day).support_level,null);checks++;
  await rejected(mentor,save,[day,2,'Other','Learning','',0,true,'',null,null],'ID_FORBIDDEN');
  await rejected(student,save,[day,1,'Other','Learning','',0,true,'',null,null],'ID_CONFLICT');
  await rejected(student,save,[day,2,'','Learning','',0,true,'',null,null],'ID_REQUIRED');
  await rejected(student,save,[day,2,'Work','Learning','',0,true,'',draftTask,null],'ID_INVALID');
  const options=(await as(student,'SELECT internship_tasks($1) AS tasks',[day])).rows[0].tasks;
  assert.deepEqual(options.map(t=>t.id),[task]);checks++;
  await as(student,save,[day,2,'Work','Learning','Tomorrow',0,true,'',task,null]);
  assert.equal((await week(mentor)).find(d=>d.id===day).experience,'Work');checks++;
  await rejected(student,save,[day,3,'Edited','Learning','',0,true,'',task,null],'ID_REASON');
  const review='SELECT internship_review($1,$2,$3)';
  await rejected(advisor,review,[JSON.stringify([{id:day,version:3}]),'present',''],'ID_FORBIDDEN');
  await rejected(mentor,review,[JSON.stringify([{id:day,version:3},{id:day2,version:999}]),'present',''],'ID_CONFLICT');
  assert.equal((await week(student)).find(d=>d.id===day).attendance,'pending');checks++;
  await as(mentor,review,[JSON.stringify([{id:day,version:3},{id:day2,version:1}]),'present','']);
  assert.equal((await week(student)).filter(d=>d.attendance==='present').length,2);checks++;
  const total=(await as(advisor,'SELECT internship_totals($1) AS total',[student])).rows[0].total;
  assert.equal(total.present,2); assert.equal(total.missingLogs,1);checks++;
  await as(advisor,'SELECT internship_note($1,4,$2,true)',[day,'Please verify this date']);
  assert.equal((await week(student)).find(d=>d.id===day).correction_requested,true);checks++;
  await rejected(mentor,review,[JSON.stringify([{id:day,version:5}]),'partial',''],'ID_REASON');
  await as(mentor,review,[JSON.stringify([{id:day,version:5}]),'partial','Corrected after checking']);
  const events=(await as(advisor,'SELECT internship_events($1) AS events',[day])).rows[0].events;
  assert.ok(events.some(e=>e.event_type==='correction'));
  assert.ok(!events.some(e=>e.event_type==='log_saved'));
  assert.equal(events.find(e=>e.event_type==='log_submitted').previous_value,null);checks++;
  await rejected(outsider,'SELECT internship_week($1,$2)',[student,yesterday],'ID_FORBIDDEN');
  await rejected(student,"UPDATE internship_days SET attendance='present' WHERE id=$1",[day],'permission denied');
  await rejected(mentor,'SELECT * FROM internship_days',[],'permission denied');
  await rejected(student,'SELECT internship_can_student($1,$2)',[student,outsider],'permission denied');
  const path=student+'/'+day+'/file';
  await as(student,"INSERT INTO storage.objects(bucket_id,name) VALUES('internship-day-files',$1)",[path]);
  assert.equal((await as(mentor,'SELECT * FROM storage.objects')).rows.length,0);checks++;
  await as(student,save,[day,6,'Work','Learning','',1,true,'Added evidence',task,JSON.stringify({path,name:'evidence.pdf'})]);
  assert.equal((await as(mentor,'SELECT * FROM storage.objects')).rows.length,1);checks++;
  await rejected(outsider,"INSERT INTO storage.objects(bucket_id,name) VALUES('internship-day-files',$1)",[student+'/'+day+'/evil']);
  await db.exec('RESET ROLE');
  await db.query('UPDATE student_profiles SET mentor_id=$1 WHERE id=$2',[outsider,student]);
  await rejected(mentor,'SELECT internship_week($1,$2)',[student,yesterday],'ID_FORBIDDEN');
  assert.equal((await as(mentor,'SELECT * FROM storage.objects')).rows.length,0);checks++;
  assert.equal((await week(student)).length,2);checks++;
  assert.deepEqual((await as(outsider,'SELECT internship_week($1,$2) AS days',[student,yesterday])).rows[0].days,[]);checks++;
  await db.exec('RESET ROLE');
  await db.query('UPDATE internship_groups SET is_archived=true WHERE id=$1',[group]);
  await rejected(advisor,'SELECT internship_week($1,$2)',[student,yesterday],'ID_FORBIDDEN');
  assert.equal((await week(student)).length,2);checks++;
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(()=>db.query('SELECT internship_people()'),/permission denied/);checks++;
})().then(()=>{console.log(`PASS ${checks} PostgreSQL checks`);return db.close();}).catch(async error=>{
  console.error(error);await db.close();process.exitCode=1;
});
