import { supabase } from './supabase';
import type { Institution, InstitutionType, AdminDashboardStats, MemberWithProfile, Department } from '@/types/institution';

function mapInstitution(row: Record<string, unknown>): Institution {
  return {
    id: row.id as string,
    name: (row.name as string) || '',
    type: (row.type as InstitutionType) || 'university',
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

function mapMember(row: Record<string, unknown>): MemberWithProfile {
  return {
    id: row.id as string,
    firstName: (row.first_name as string) || '',
    lastName: (row.last_name as string) || '',
    email: (row.email as string) || '',
    role: (row.role as string) || '',
    avatarUrl: (row.avatar_url as string) || undefined,
    departmentId: (row.department_id as string) || undefined,
    createdAt: (row.created_at as string) || '',
  };
}

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

export const adminService = {
  async createInstitution(
    adminId: string,
    data: {
      name: string;
      type: InstitutionType;
      faculty?: string;
      department?: string;
      city?: string;
      country: string;
    },
  ): Promise<Institution> {
    const { data: row, error } = await supabase
      .from('institutions')
      .insert({
        admin_id: adminId,
        name: data.name,
        type: data.type,
        faculty: data.faculty || null,
        department: data.department || null,
        city: data.city || null,
        country: data.country,
      })
      .select()
      .single();
    if (error) throw error;

    const institution = mapInstitution(row as Record<string, unknown>);

    // Link admin profile to institution
    await supabase
      .from('admin_profiles')
      .update({ institution_id: institution.id })
      .eq('id', adminId);

    // Link admin's own profile to institution
    await supabase
      .from('profiles')
      .update({ institution_id: institution.id })
      .eq('id', adminId);

    return institution;
  },

  async getInstitution(adminId: string): Promise<Institution | null> {
    const { data, error } = await supabase
      .from('institutions')
      .select('*')
      .eq('admin_id', adminId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapInstitution(data as Record<string, unknown>);
  },

  async updateInstitution(
    institutionId: string,
    updates: Partial<{
      name: string;
      type: InstitutionType;
      faculty: string;
      department: string;
      city: string;
      country: string;
    }>,
  ): Promise<Institution> {
    const dbUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.faculty !== undefined) dbUpdates.faculty = updates.faculty;
    if (updates.department !== undefined) dbUpdates.department = updates.department;
    if (updates.city !== undefined) dbUpdates.city = updates.city;
    if (updates.country !== undefined) dbUpdates.country = updates.country;

    const { data, error } = await supabase
      .from('institutions')
      .update(dbUpdates)
      .eq('id', institutionId)
      .select()
      .single();
    if (error) throw error;
    return mapInstitution(data as Record<string, unknown>);
  },

  async regenerateInstitutionCode(institutionId: string): Promise<string> {
    const { data, error } = await supabase.rpc('regenerate_institution_code', {
      p_institution_id: institutionId,
    });
    if (error) throw error;
    return data as string;
  },

  async getInstitutionMembers(
    institutionId: string,
    filters?: { role?: string; search?: string; departmentId?: string },
  ): Promise<MemberWithProfile[]> {
    let query = supabase
      .from('profiles')
      .select('id, first_name, last_name, email, role, avatar_url, created_at, department_id')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false });

    if (filters?.role && filters.role !== 'all') {
      query = query.eq('role', filters.role);
    }
    if (filters?.departmentId && filters.departmentId !== 'all') {
      query = query.eq('department_id', filters.departmentId);
    }
    if (filters?.search) {
      query = query.or(
        `first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((r) => mapMember(r as Record<string, unknown>));
  },

  async getDashboardStats(institutionId: string): Promise<AdminDashboardStats> {
    // Total students in institution
    const { count: studentCount } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId)
      .eq('role', 'student');

    // Total advisors in institution
    const { count: advisorCount } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId)
      .eq('role', 'advisor');

    // Active internships (students with internship dates)
    const { data: activeStudents } = await supabase
      .from('student_profiles')
      .select('id, internship_start_date, internship_end_date')
      .in(
        'id',
        // Get student IDs in this institution
        (await supabase
          .from('profiles')
          .select('id')
          .eq('institution_id', institutionId)
          .eq('role', 'student')).data?.map((p) => (p as Record<string, unknown>).id as string) || [],
      );

    const now = new Date();
    const activeInternships = (activeStudents || []).filter((s) => {
      const row = s as Record<string, unknown>;
      const start = row.internship_start_date as string | null;
      const end = row.internship_end_date as string | null;
      if (!start || !end) return false;
      return new Date(start) <= now && new Date(end) >= now;
    }).length;

    // Completion rate
    const totalStudents = studentCount || 0;
    const completionRate = totalStudents > 0
      ? Math.round((activeInternships / totalStudents) * 100)
      : 0;

    return {
      totalStudents,
      activeInternships,
      totalAdvisors: advisorCount || 0,
      completionRate,
    };
  },

  async getInstitutionReports(institutionId: string) {
    const stats = await this.getDashboardStats(institutionId);
    const members = await this.getInstitutionMembers(institutionId);

    // Role breakdown
    const roleBreakdown = {
      students: members.filter((m) => m.role === 'student').length,
      advisors: members.filter((m) => m.role === 'advisor').length,
      mentors: members.filter((m) => m.role === 'mentor').length,
    };

    return { ...stats, members, roleBreakdown };
  },

  async getDepartments(institutionId: string): Promise<Department[]> {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => mapDepartment(r as Record<string, unknown>));
  },

  async createDepartment(institutionId: string, name: string): Promise<Department> {
    const { data, error } = await supabase
      .from('departments')
      .insert({ institution_id: institutionId, name })
      .select()
      .single();
    if (error) throw error;
    return mapDepartment(data as Record<string, unknown>);
  },

  async removeFromInstitution(userId: string): Promise<void> {
    const { error } = await supabase
      .from('profiles')
      .update({ institution_id: null, department_id: null })
      .eq('id', userId);
    if (error) throw error;
  },
};
