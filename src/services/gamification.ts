import { supabase } from './supabase';
import { POINT_VALUES, LEVELS } from '@/types/gamification';
import { notificationService } from './notifications';
import { pollService } from './polls';

export const gamificationService = {
  async addXp(studentId: string, amount: number, reason: string, logId?: string) {
    // Insert XP transaction
    const { error: txError } = await supabase
      .from('xp_transactions')
      .insert({
        student_id: studentId,
        amount,
        reason,
        log_id: logId,
      });
    if (txError) throw txError;

    // Update total XP and level
    const { data: profile, error: fetchError } = await supabase
      .from('student_profiles')
      .select('total_xp, current_level')
      .eq('id', studentId)
      .single();
    if (fetchError) throw fetchError;

    const newTotalXp = profile.total_xp + amount;
    const newLevel = this.calculateLevel(newTotalXp);

    const { error: updateError } = await supabase
      .from('student_profiles')
      .update({ total_xp: newTotalXp, current_level: newLevel })
      .eq('id', studentId);
    if (updateError) throw updateError;

    const leveledUp = newLevel > profile.current_level;

    if (leveledUp) {
      const levelData = LEVELS.find((l) => l.level === newLevel);
      try {
        await notificationService.create(
          studentId,
          'Level Up!',
          `Congratulations! You reached Level ${newLevel}${levelData ? ` - ${levelData.nameKey}` : ''}!`,
          'level_up',
          { newLevel, totalXp: newTotalXp },
        );
      } catch (e) {
        console.warn('Level up notification failed:', e);
      }
    }

    return { totalXp: newTotalXp, level: newLevel, leveledUp };
  },

  calculateLevel(totalXp: number): number {
    for (let i = LEVELS.length - 1; i >= 0; i--) {
      if (totalXp >= LEVELS[i].minXp) return LEVELS[i].level;
    }
    return 1;
  },

  async updateStreak(studentId: string) {
    const { data: profile, error: fetchError } = await supabase
      .from('student_profiles')
      .select('current_streak, longest_streak')
      .eq('id', studentId)
      .single();
    if (fetchError) throw fetchError;

    const newStreak = profile.current_streak + 1;
    const longestStreak = Math.max(newStreak, profile.longest_streak);

    const { error: updateError } = await supabase
      .from('student_profiles')
      .update({ current_streak: newStreak, longest_streak: longestStreak })
      .eq('id', studentId);
    if (updateError) throw updateError;

    return { streak: newStreak, longestStreak };
  },

  async resetStreak(studentId: string) {
    const { error } = await supabase
      .from('student_profiles')
      .update({ current_streak: 0 })
      .eq('id', studentId);
    if (error) throw error;
  },

  async awardBadge(studentId: string, badgeKey: string) {
    const { data, error } = await supabase
      .from('earned_badges')
      .insert({ student_id: studentId, badge_key: badgeKey })
      .select()
      .single();
    // Ignore unique constraint error (badge already earned)
    if (error && error.code !== '23505') throw error;

    // Send notification only if badge was newly earned (not duplicate)
    if (data) {
      try {
        await notificationService.create(
          studentId,
          'Badge Earned!',
          `You earned the "${badgeKey}" badge! Keep up the great work!`,
          'badge_earned',
          { badgeKey },
        );
      } catch (e) {
        console.warn('Badge notification failed:', e);
      }
    }

    return data;
  },

  async getEarnedBadges(studentId: string) {
    const { data, error } = await supabase
      .from('earned_badges')
      .select('*')
      .eq('student_id', studentId)
      .order('earned_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getXpHistory(studentId: string) {
    const { data, error } = await supabase
      .from('xp_transactions')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getLeaderboard(limit = 50, university?: string, department?: string) {
    let query = supabase
      .from('leaderboard_public')
      .select('id, total_xp, current_level, current_streak, first_name, last_name, avatar_url')
      .order('total_xp', { ascending: false })
      .limit(limit);

    if (university) query = query.eq('university', university);
    if (department) query = query.eq('department', department);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // Process XP for a log submission
  async processLogSubmission(studentId: string, logId: string) {
    return this.addXp(studentId, POINT_VALUES.dailyLogSubmit, 'daily_log_submit', logId);
  },

  async processLogApproval(studentId: string, logId: string) {
    return this.addXp(studentId, POINT_VALUES.logApproved, 'log_approved', logId);
  },

  async processPollCompletion(
    studentId: string,
    pollId: string,
    isQuiz: boolean,
    isPerfectScore: boolean,
  ) {
    // Award base XP for completing a poll
    await this.addXp(studentId, POINT_VALUES.pollCompleted, 'poll_completed');

    // Bonus XP for perfect quiz score
    if (isQuiz && isPerfectScore) {
      await this.addXp(studentId, POINT_VALUES.quizPerfectScore, 'quiz_perfect_score');
    }

    // Check if eligible for quiz_master badge (5+ poll completions)
    try {
      const count = await pollService.getResponseCount(studentId);
      if (count >= 5) {
        await this.awardBadge(studentId, 'quiz_master');
      }
    } catch (e) {
      console.warn('Quiz master badge check failed:', e);
    }
  },
};
