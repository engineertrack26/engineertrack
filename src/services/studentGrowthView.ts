import { gamificationService } from './gamification';
import { competencyService } from './competency';
import { supabase } from './supabase';
import { getGrowthJourney } from './growthJourney';

export const studentGrowthViewService = {
  async load(studentId: string) {
    const [badges, history, profile, competencies, selfVsMentor, journey] = await Promise.allSettled([
      gamificationService.getEarnedBadges(studentId),
      gamificationService.getXpHistory(studentId),
      (async () => {
        const { data, error } = await supabase.from('student_profiles')
          .select('total_xp, current_level, current_streak, longest_streak').eq('id', studentId).single();
        if (error) throw error;
        if (!data) throw new Error('Profile unavailable');
        return { totalXp: Number(data.total_xp) || 0, currentLevel: Number(data.current_level) || 1,
          currentStreak: Number(data.current_streak) || 0, longestStreak: Number(data.longest_streak) || 0 };
      })(),
      competencyService.getProgress(studentId),
      competencyService.selfVsMentor(studentId),
      getGrowthJourney(),
    ]);
    return { badges, history, profile, competencies, selfVsMentor, journey };
  },
};
