import { supabase } from './supabase';
import type { Department } from '@/types/institution';

function mapDepartment(row: Record<string, unknown>): Department {
  return {
    id: row.id as string,
    institutionId: (row.institution_id as string) || '',
    name: (row.name as string) || '',
    departmentCode: (row.department_code as string) || '',
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}

export const departmentCodeService = {
  async validateCode(code: string): Promise<Department | null> {
    const { data, error } = await supabase.rpc('validate_department_code', {
      p_code: code.toUpperCase().trim(),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return mapDepartment(row as Record<string, unknown>);
  },

  async joinDepartment(code: string): Promise<Department> {
    const { data, error } = await supabase.rpc('join_department_by_code', {
      p_code: code.toUpperCase().trim(),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Invalid department code');
    return mapDepartment(row as Record<string, unknown>);
  },
};
