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

  async getGroupLeaderboard(limit = 50) {
    const { data, error } = await supabase.rpc('get_my_group_leaderboard', {
      p_limit: limit,
    });
    if (error) throw error;
    return data || [];
  },
};
