import { supabase } from './supabase';
import { RpcError } from './rpcError';
import type { InternshipGroup, GroupSummary, GroupMember } from '@/types/group';

function mapGroup(row: Record<string, unknown>): InternshipGroup {
  return {
    id: row.id as string,
    advisorId: (row.advisor_id as string) || '',
    name: (row.name as string) || '',
    term: (row.term as string) || undefined,
    joinCode: (row.join_code as string) || '',
    isArchived: (row.is_archived as boolean) ?? false,
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}

function mapSummary(row: Record<string, unknown>): GroupSummary {
  return {
    id: row.id as string,
    name: (row.name as string) || '',
    term: (row.term as string) || undefined,
    advisorName: (row.advisor_name as string) || '',
  };
}

export const groupService = {
  async listMyGroups(advisorId: string): Promise<InternshipGroup[]> {
    const { data, error } = await supabase
      .from('internship_groups')
      .select('*')
      .eq('advisor_id', advisorId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => mapGroup(r as Record<string, unknown>));
  },

  async createGroup(
    advisorId: string,
    data: { name: string; term?: string },
  ): Promise<InternshipGroup> {
    const { data: row, error } = await supabase
      .from('internship_groups')
      .insert({ advisor_id: advisorId, name: data.name, term: data.term || null })
      .select()
      .single();
    if (error) throw error;
    return mapGroup(row as Record<string, unknown>);
  },

  async setArchived(groupId: string, isArchived: boolean): Promise<void> {
    const { error } = await supabase
      .from('internship_groups')
      .update({ is_archived: isArchived, updated_at: new Date().toISOString() })
      .eq('id', groupId);
    if (error) throw error;
  },

  async listMembers(groupId: string): Promise<GroupMember[]> {
    const { data, error } = await supabase
      .from('group_memberships')
      .select('id, joined_at, student:profiles!group_memberships_student_id_fkey(id, first_name, last_name, email, avatar_url)')
      .eq('group_id', groupId)
      .is('left_at', null)
      .order('joined_at', { ascending: true });
    if (error) throw error;

    return (data || []).map((row) => {
      const r = row as Record<string, unknown>;
      const s = (r.student || {}) as Record<string, unknown>;
      return {
        membershipId: r.id as string,
        id: (s.id as string) || '',
        firstName: (s.first_name as string) || '',
        lastName: (s.last_name as string) || '',
        email: (s.email as string) || '',
        avatarUrl: (s.avatar_url as string) || undefined,
        joinedAt: (r.joined_at as string) || '',
      };
    });
  },

  /** One query for the whole screen rather than one per group card. */
  async countMembersByGroup(): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from('group_memberships')
      .select('group_id')
      .is('left_at', null);
    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const row of data || []) {
      const id = (row as Record<string, unknown>).group_id as string;
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  },

  /** Closing, never deleting: the student's logs and term history hang off
   *  this row. */
  async closeMembership(membershipId: string): Promise<void> {
    const { error } = await supabase
      .from('group_memberships')
      .update({ left_at: new Date().toISOString() })
      .eq('id', membershipId);
    if (error) throw error;
  },

  async validateCode(code: string): Promise<GroupSummary | null> {
    const { data, error } = await supabase.rpc('validate_group_code', {
      p_code: code.toUpperCase().trim(),
    });
    if (error) throw new RpcError(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return mapSummary(row as Record<string, unknown>);
  },

  async joinByCode(code: string): Promise<GroupSummary> {
    const { data, error } = await supabase.rpc('join_group_by_code', {
      p_code: code.toUpperCase().trim(),
    });
    if (error) throw new RpcError(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new RpcError('GROUP_NOT_FOUND');
    return mapSummary(row as Record<string, unknown>);
  },

  /** The student's own active group, or null before they have joined one. */
  async getMyGroup(studentId: string): Promise<GroupSummary | null> {
    const { data, error } = await supabase
      .from('group_memberships')
      .select('group:internship_groups(id, name, term, advisor:profiles_public!internship_groups_advisor_id_fkey(first_name, last_name))')
      .eq('student_id', studentId)
      .is('left_at', null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const g = ((data as Record<string, unknown>).group || {}) as Record<string, unknown>;
    const a = (g.advisor || {}) as Record<string, unknown>;
    return {
      id: (g.id as string) || '',
      name: (g.name as string) || '',
      term: (g.term as string) || undefined,
      advisorName: `${(a.first_name as string) || ''} ${(a.last_name as string) || ''}`.trim(),
    };
  },
};
