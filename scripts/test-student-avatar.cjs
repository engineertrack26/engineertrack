// Isolated database tests; no network or production credentials.
const { PGlite } = require(process.argv[2]);
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let checks = 0;
const eq = (a,b) => { assert.deepEqual(a,b); checks++; };
async function role(uid, name = 'authenticated') {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid || '']);
  await db.exec('SET ROLE ' + name);
}
async function denied(sql, params = [], pattern = /permission denied|AVATAR_FORBIDDEN/) {
  await assert.rejects(() => db.query(sql, params), pattern); checks++;
}
(async () => {
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_user_meta_data jsonb);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text);
    CREATE TABLE public.student_profiles(id uuid PRIMARY KEY, total_xp integer);
  `);
  const levelSql = readFileSync('docs/gamification-server-side-migration.sql','utf8').match(/CREATE OR REPLACE FUNCTION calculate_level[\s\S]*?\$\$;/)[0];
  await db.exec(levelSql);
  const migration = readFileSync('docs/student-avatar-migration.sql','utf8');
  await db.exec(migration); await db.exec(migration); checks++;
  for (const [n, kind, choice] of [[1,'student','03'],[2,'student',null],[3,'mentor','04'],[4,'advisor','05'],[5,'student','99']]) {
    await db.query('INSERT INTO auth.users VALUES($1,$2)',[id(n), JSON.stringify({ student_avatar_id: choice })]);
    await db.query('INSERT INTO profiles VALUES($1,$2)',[id(n),kind]);
  }
  await db.query('INSERT INTO student_profiles VALUES($1,1000)',[id(1)]);
  const get = async () => (await db.query('SELECT my_student_avatar() AS a')).rows[0].a;
  await role(id(1)); eq(await get(), { avatarId:'03', level:5 });
  eq((await db.query("SELECT set_student_avatar('09') AS a")).rows[0].a, { avatarId:'09',level:5 });
  eq(await get(), { avatarId:'09',level:5 });
  await role(id(2)); eq(await get(), { avatarId:null,level:1 });
  await db.query("SELECT set_student_avatar('01')");
  eq(await get(), { avatarId:'01',level:1 });
  await role(id(5)); eq(await get(), { avatarId:null,level:1 });
  for (const invalid of [null,'','1','00','10','01 ', '../01']) await denied('SELECT set_student_avatar($1)',[invalid],/AVATAR_INVALID/);
  for (const n of [3,4]) {
    await role(id(n)); await denied('SELECT my_student_avatar()'); await denied("SELECT set_student_avatar('01')");
  }
  await role(id(1));
  for (const sql of ['SELECT * FROM student_avatar_preferences', "UPDATE student_avatar_preferences SET avatar_id='02'", 'DELETE FROM student_avatar_preferences', `INSERT INTO student_avatar_preferences VALUES('${id(3)}','01',now())`]) await denied(sql);
  await role(null); await denied('SELECT my_student_avatar()'); await denied("SELECT set_student_avatar('01')");
  await role(id(1), 'anon'); await denied('SELECT my_student_avatar()'); await denied("SELECT set_student_avatar('01')");
  await db.exec('RESET ROLE');
  eq((await db.query('SELECT total_xp FROM student_profiles WHERE id=$1',[id(1)])).rows[0].total_xp,1000);
  eq((await db.query("SELECT relrowsecurity FROM pg_class WHERE relname='student_avatar_preferences'")).rows[0].relrowsecurity,true);
  eq((await db.query("SELECT has_function_privilege('authenticated','capture_student_avatar()','EXECUTE') AS allowed")).rows[0].allowed,false);
  await db.query('UPDATE student_profiles SET total_xp=4500 WHERE id=$1',[id(1)]);
  await role(id(1)); eq(await get(), { avatarId:'09',level:10 });
  await db.exec('RESET ROLE'); await db.exec(migration);
  await role(id(1)); eq(await get(), { avatarId:'09',level:10 });
  console.log(`${checks} avatar SQL checks passed`); await db.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
