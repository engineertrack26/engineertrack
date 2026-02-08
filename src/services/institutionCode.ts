import { supabase } from './supabase';
import type { Institution } from '@/types/institution';

function mapInstitution(row: Record<string, unknown>): Institution {
  return {
    id: row.id as string,
    name: (row.name as string) || '',
    type: (row.type as Institution['type']) || 'university',
    faculty: (row.faculty as string) || undefined,
    department: (row.department as string) || undefined,
    city: (row.city as string) || undefined,
    country: (row.country as string) || '',
    adminId: (row.admin_id as string) || '',
    institutionCode: (row.institution_code as string) || '',
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}

export const institutionCodeService = {
  async validateCode(code: string): Promise<Institution | null> {
    const { data, error } = await supabase.rpc('validate_institution_code', {
      p_code: code.toUpperCase().trim(),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return mapInstitution(row as Record<string, unknown>);
  },

  async joinInstitution(code: string, userId: string): Promise<Institution> {
    const { data, error } = await supabase.rpc('join_institution_by_code', {
      p_code: code.toUpperCase().trim(),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Invalid institution code');
    return mapInstitution(row as Record<string, unknown>);
  },

  async leaveInstitution(userId: string): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ institution_id: null })
      .eq('id', userId);
    if (error) throw error;
  },

  async getMyInstitution(userId: string): Promise<Institution | null> {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('institution_id')
      .eq('id', userId)
      .single();
    if (profileError) throw profileError;

    const institutionId = (profile as Record<string, unknown>).institution_id as string | null;
    if (!institutionId) return null;

    const { data, error } = await supabase
      .from('institutions')
      .select('*')
      .eq('id', institutionId)
      .single();
    if (error) throw error;
    return mapInstitution(data as Record<string, unknown>);
  },
};
