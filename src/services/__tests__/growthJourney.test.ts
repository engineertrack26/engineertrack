import { getGrowthJourney, parseGrowthJourney, parseGrowthAwards } from '../growthJourney';
import { supabase } from '../supabase';
jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn() } }));
test('only a successful no-group response becomes an empty journey', () => {
  expect(parseGrowthJourney({groupId:null}).groupId).toBeNull();
  expect(() => parseGrowthJourney(null)).toThrow();
  expect(() => parseGrowthJourney({groupId:'g'})).toThrow();
});
test('missing migration and network errors are not silently reported as zero progress', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({data:null,error:{code:'PGRST202'}} as never);
  await expect(getGrowthJourney()).rejects.toEqual({code:'PGRST202'});
  expect(supabase.rpc).toHaveBeenCalledWith('sync_my_growth_awards');
});
test('award response requires server records; metrics alone cannot invent earned badges', () => {
  expect(parseGrowthAwards({metrics:{groupId:null},awards:[]}).awards).toEqual([]);
  expect(()=>parseGrowthAwards({metrics:{groupId:null}})).toThrow();
  expect(()=>parseGrowthAwards({metrics:{groupId:null},awards:[{stageId:'production_1'}]})).toThrow();
});
test('an optional missing closure does not discard the other progress metrics', () => {
  const value = { groupId:'g', approvedTasks:3, availableTasks:5, improvedTasks:0,
    reflectiveDays:2, activeWeeks:1, competenciesReached:0, competenciesTotal:6,
    plannedDays:180, plannedWeeks:26, prepared:true, closed:null };
  expect(parseGrowthJourney(value)).toEqual(value);
  expect(() => parseGrowthJourney({...value, closed:undefined})).toThrow();
});
