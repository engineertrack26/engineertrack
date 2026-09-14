import { readFileSync } from 'node:fs';
import { dayWeek, shiftDay, logFormError, daySummary, dayError, needsAttendanceReview, visibleDayDates } from '../internshipDays';
import type { DayLogForm, InternshipDay } from '@/types/internshipDay';
const form: DayLogForm = { experience:'Work',learning:'Lesson',nextStep:'',support:0,reason:'',taskId:null,attachment:null };
test('student landing shows only today; history and advisor retain the whole week', () => {
  expect(visibleDayDates('student', false, '2026-09-16', '2026-09-14', [])).toEqual(['2026-09-16']);
  expect(visibleDayDates('student', true, '2026-09-16', '2026-09-07', [])).toEqual(dayWeek('2026-09-07'));
  expect(visibleDayDates('advisor', false, '2026-09-16', '2026-09-14', [])).toEqual(dayWeek('2026-09-14'));
});
test('mentor queue includes pending attendance and corrections regardless of journal submission', () => {
  const records = [
    { day_date: '2026-09-14', attendance: 'pending', log_status: 'draft', correction_requested: false },
    { day_date: '2026-09-15', attendance: 'present', log_status: 'submitted', correction_requested: true },
    { day_date: '2026-09-16', attendance: 'present', log_status: 'draft', correction_requested: false },
    { day_date: '2026-09-17', attendance: 'absent', log_status: 'submitted', correction_requested: false },
  ] as InternshipDay[];
  expect(records.filter(needsAttendanceReview)).toEqual(records.slice(0, 2));
  expect(visibleDayDates('mentor', false, '2026-09-18', '2026-09-14', records)).toEqual(['2026-09-14', '2026-09-15']);
  expect(visibleDayDates('mentor', true, '2026-09-18', '2026-09-14', records)).toEqual(dayWeek('2026-09-14'));
  expect(visibleDayDates('mentor', false, '2026-09-18', '2026-09-07', records)).toEqual([]);
});
test('empty mentor week does not manufacture absent days or pending approvals', () => {
  expect(visibleDayDates('mentor', false, '2026-09-16', '2026-09-14', [])).toEqual([]);
});
test('weeks start on Monday and include weekends without assuming working days',()=>{
  expect(dayWeek('2026-09-14')).toEqual(['2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20']);
  expect(dayWeek('2026-09-20')[0]).toBe('2026-09-14');
  expect(dayWeek('2026-02-30')).toEqual([]);
  expect(shiftDay('2028-02-28',1)).toBe('2028-02-29');
  expect(shiftDay('2026-12-31',1)).toBe('2027-01-01');
});
test('observation level zero is a valid self assessment, never a missing value',()=>{
  expect(logFormError(form,true,false)).toBeNull();
  expect(logFormError({...form,support:null},true,false)).toBe('days.required');
  expect(logFormError({...form,support:4},true,false)).toBe('days.invalid');
});
test('empty drafts are allowed but submitted text and revisions require validation',()=>{
  expect(logFormError({...form,experience:'',learning:'',support:null},false,false)).toBeNull();
  expect(logFormError({...form,experience:' '},true,false)).toBe('days.required');
  expect(logFormError(form,true,true)).toBe('days.reasonRequired');
  expect(logFormError({...form,reason:'Updated'},false,true)).toBe('days.reasonRequired');
  expect(logFormError({...form,reason:'Updated'},true,true)).toBeNull();
  expect(logFormError({...form,experience:'x'.repeat(4001)},false,false)).toBe('days.invalid');
});
test('attendance totals do not infer presence from journals or absence from missing records',()=>{
  const days=[{attendance:'present',log_status:'draft'},{attendance:'partial',log_status:'submitted'},
    {attendance:'pending',log_status:'submitted',correction_requested:true},{attendance:'excused',log_status:'draft'}] as InternshipDay[];
  expect(daySummary(days)).toEqual({present:1,partial:1,pending:1,corrections:1,missingLogs:1});
  expect(daySummary([])).toEqual({present:0,partial:0,pending:0,corrections:0,missingLogs:0});
});
test('errors explain migration, concurrency and permission failures without leaking server data',()=>{
  expect(dayError({code:'PGRST202',message:'private schema'})).toBe('days.notInstalled');
  expect(dayError({message:'ID_CONFLICT'})).toBe('days.conflict');
  expect(dayError({message:'ID_FORBIDDEN'})).toBe('days.forbidden');
  expect(dayError({message:'secret'})).toBe('days.failed');
});
const en=JSON.parse(readFileSync('src/i18n/locales/en.json','utf8')).days;
test.each(['en','tr','de','it','ro','sr','el'])('%s contains all internship labels and placeholders',lang=>{
  const locale=JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`,'utf8')).days;
  expect(Object.keys(locale).sort()).toEqual(Object.keys(en).sort());
  for(const key of Object.keys(en)) {
    expect(locale[key].trim()).not.toBe('');
    expect((locale[key].match(/\{\{\w+\}\}/g)||[]).sort()).toEqual((en[key].match(/\{\{\w+\}\}/g)||[]).sort());
  }
});
test('every literal translation key used by the new screen is provided',()=>{
  const source=readFileSync('src/components/internship/InternshipDaysScreen.tsx','utf8');
  for(const match of source.matchAll(/['"]days\.([A-Za-z_]+)['"]/g)) {
    if(['support','event_'].includes(match[1])) continue;
    expect(en[match[1]]).toEqual(expect.any(String));
  }
});
