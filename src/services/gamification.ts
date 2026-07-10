import { supabase } from './supabase';
import { LEVELS } from '@/types/gamification';

// All XP, streak and badge WRITES happen server-side via database triggers
// (see docs/gamification-server-side-migration.sql): log submit/approval XP
// fires on daily_logs status transitions, poll XP on poll_responses inserts.
// Client-side writes were removed because RLS only checked row ownership,
// not amounts, so a student could grant themselves arbitrary XP through the
// REST API. This service is read-only.
export const gamificationService = {
  calculateLevel(totalXp: number): number {
    for (let i = LEVELS.length - 1; i >= 0; i--) {
      if (totalXp >= LEVELS[i].minXp) return LEVELS[i].level;
    }
    return 1;
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
};
