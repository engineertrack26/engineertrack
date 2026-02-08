import { supabase } from './supabase';
import type { StudentCode } from '@/types/institution';

function mapStudentCode(row: Record<string, unknown>): StudentCode {
  return {
    id: row.id as string,
    studentId: (row.student_id as string) || '',
    code: (row.code as string) || '',
    isActive: (row.is_active as boolean) ?? true,
    createdAt: (row.created_at as string) || '',
  };
}

export const studentCodeService = {
  async generateCode(studentId: string): Promise<StudentCode> {
    // Deactivate any existing active codes
    await supabase
      .from('student_codes')
      .update({ is_active: false })
      .eq('student_id', studentId)
      .eq('is_active', true);

    // Insert new code (DB generates the 6-char code via default)
    const { data, error } = await supabase
      .from('student_codes')
      .insert({ student_id: studentId })
      .select()
      .single();
    if (error) throw error;
    return mapStudentCode(data as Record<string, unknown>);
  },

  async getMyCode(studentId: string): Promise<StudentCode | null> {
    const { data, error } = await supabase
      .from('student_codes')
      .select('*')
      .eq('student_id', studentId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapStudentCode(data as Record<string, unknown>);
  },

  async deactivateCode(codeId: string): Promise<void> {
    const { error } = await supabase
      .from('student_codes')
      .update({ is_active: false })
      .eq('id', codeId);
    if (error) throw error;
  },

  async linkWithCode(
    code: string,
    userId: string,
    role: 'mentor' | 'advisor',
  ): Promise<{ studentId: string; studentName: string }> {
    const { data, error } = await supabase.rpc('link_student_by_code', {
      p_code: code.toUpperCase().trim(),
      p_role: role,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Invalid or expired student code');
    return {
      studentId: (row.student_id as string) || '',
      studentName: (row.student_name as string) || '',
    };
  },

  async getLinkedUsers(studentId: string): Promise<{
    mentor: { id: string; firstName: string; lastName: string } | null;
    advisor: { id: string; firstName: string; lastName: string } | null;
  }> {
    const { data, error } = await supabase
      .from('student_profiles')
      .select('mentor_id, advisor_id')
      .eq('id', studentId)
      .maybeSingle();
    if (error) throw error;

    const row = data as Record<string, unknown> | null;
    const mentorId = (row?.mentor_id as string) || null;
    const advisorId = (row?.advisor_id as string) || null;

    let mentor = null;
    let advisor = null;

    if (mentorId) {
      const { data: mp } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('id', mentorId)
        .single();
      const m = mp as Record<string, unknown> | null;
      if (m) {
        mentor = {
          id: m.id as string,
          firstName: (m.first_name as string) || '',
          lastName: (m.last_name as string) || '',
        };
      }
    }

    if (advisorId) {
      const { data: ap } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .eq('id', advisorId)
        .single();
      const a = ap as Record<string, unknown> | null;
      if (a) {
        advisor = {
          id: a.id as string,
          firstName: (a.first_name as string) || '',
          lastName: (a.last_name as string) || '',
        };
      }
    }

    return { mentor, advisor };
  },
};
