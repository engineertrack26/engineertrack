import { supabase } from '../supabase';
import { internshipDayService as service } from '../internshipDays';
import type { InternshipDay } from '@/types/internshipDay';
jest.mock('../supabase',()=>({supabase:{rpc:jest.fn(),auth:{getSession:jest.fn()}}}));
jest.mock('../evidenceUrls',()=>({uploadToBucket:jest.fn()}));
const abortSignal=jest.fn();
beforeEach(()=>{
  jest.resetAllMocks();
  abortSignal.mockResolvedValue({data:[],error:null});
  jest.mocked(supabase.rpc).mockReturnValue({abortSignal} as never);
});
test('server owns attendance authority, timestamps and atomic batch review',async()=>{
  await service.review([{id:'a',version:2},{id:'b',version:3}] as InternshipDay[],'present',' checked ');
  expect(supabase.rpc).toHaveBeenCalledWith('internship_review',{p_days:[{id:'a',version:2},{id:'b',version:3}],p_status:'present',p_note:'checked'});
});
test('submission carries a version and never writes attendance or XP',async()=>{
  await service.saveLog({id:'day',version:4} as InternshipDay,{experience:' work ',learning:' lesson ',nextStep:'',support:0,reason:'',taskId:null,attachment:null},true);
  expect(supabase.rpc).toHaveBeenCalledWith('internship_save_log',{
    p_day:'day',p_version:4,p_experience:'work',p_learning:'lesson',p_next_step:'',p_support:0,p_submit:true,p_reason:'',p_task:null,p_attachment:null,
  });
});
test('advisor correction does not send a replacement attendance value',async()=>{
  await service.note({id:'day',version:4} as InternshipDay,' Please check ',true);
  expect(supabase.rpc).toHaveBeenCalledWith('internship_note',{p_day:'day',p_version:4,p_note:'Please check',p_correction:true});
});
test('read errors are not turned into an empty week',async()=>{
  abortSignal.mockResolvedValue({data:null,error:{code:'PGRST202'}});
  await expect(service.week('student','2026-09-14')).rejects.toEqual({code:'PGRST202'});
});
test('a stalled request times out instead of trapping the screen in loading',async()=>{
  jest.useFakeTimers();
  try {
    abortSignal.mockReturnValue(new Promise(()=>{}));
    const result=expect(service.people()).rejects.toThrow('Request timeout');
    await jest.advanceTimersByTimeAsync(15000);
    await result;
    expect(abortSignal.mock.calls[0][0].aborted).toBe(true);
  } finally {jest.useRealTimers();}
});
test('oversized or unsupported files fail before touching storage',async()=>{
  await expect(service.upload({student_id:'u',id:'d'} as InternshipDay,{uri:'file:',name:'a',mimeType:'application/pdf',size:10485761})).rejects.toEqual({message:'ID_INVALID'});
  expect(supabase.auth.getSession).not.toHaveBeenCalled();
});
