import { studentGrowthViewService } from '../studentGrowthView';
import { gamificationService } from '../gamification';
import { competencyService } from '../competency';
import { supabase } from '../supabase';

jest.mock('../gamification', () => ({ gamificationService: { getEarnedBadges: jest.fn(), getXpHistory: jest.fn() } }));
jest.mock('../competency', () => ({ competencyService: { getProgress: jest.fn(), selfVsMentor: jest.fn() } }));
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

const single = jest.fn();
const eq = jest.fn(() => ({ single }));
const select = jest.fn(() => ({ eq }));

beforeEach(() => {
  jest.clearAllMocks();
  (supabase.from as jest.Mock).mockReturnValue({ select });
  single.mockResolvedValue({ data: { total_xp: 200, current_level: 2, current_streak: 3, longest_streak: 5 }, error: null });
  jest.mocked(gamificationService.getEarnedBadges).mockResolvedValue([]);
  jest.mocked(gamificationService.getXpHistory).mockResolvedValue([]);
  jest.mocked(competencyService.getProgress).mockResolvedValue([]);
  jest.mocked(competencyService.selfVsMentor).mockResolvedValue([]);
});

test('reads the signed-in student data through existing APIs', async () => {
  const result = await studentGrowthViewService.load('student-1');
  expect(eq).toHaveBeenCalledWith('id', 'student-1');
  expect(gamificationService.getEarnedBadges).toHaveBeenCalledWith('student-1');
  expect(gamificationService.getXpHistory).toHaveBeenCalledWith('student-1');
  expect(competencyService.getProgress).toHaveBeenCalledWith('student-1');
  expect(competencyService.selfVsMentor).toHaveBeenCalledWith('student-1');
  expect(result.profile).toEqual({ status: 'fulfilled', value: { totalXp: 200, currentLevel: 2, currentStreak: 3, longestStreak: 5 } });
  expect(result.selfVsMentor).toEqual({ status: 'fulfilled', value: [] });
});

test('profile errors remain unavailable rather than turning into zero XP', async () => {
  single.mockResolvedValue({ data: null, error: new Error('offline') });
  const result = await studentGrowthViewService.load('student-1');
  expect(result.profile.status).toBe('rejected');
  expect(result.badges).toEqual({ status: 'fulfilled', value: [] });
});

test('missing profile is not presented as a new level-one account', async () => {
  single.mockResolvedValue({ data: null, error: null });
  expect((await studentGrowthViewService.load('student-1')).profile.status).toBe('rejected');
});

test('individual section failures preserve other successful sections', async () => {
  jest.mocked(gamificationService.getEarnedBadges).mockRejectedValue(new Error('badges'));
  jest.mocked(competencyService.getProgress).mockRejectedValue(new Error('competencies'));
  const result = await studentGrowthViewService.load('student-1');
  expect(result.badges.status).toBe('rejected');
  expect(result.competencies.status).toBe('rejected');
  expect(result.profile.status).toBe('fulfilled');
  expect(result.history).toEqual({ status: 'fulfilled', value: [] });
});
