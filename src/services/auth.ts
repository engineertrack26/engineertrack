import { supabase } from './supabase';
import { User, UserRole, SupportedLanguage } from '@/types/user';

interface SignUpParams {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  language: SupportedLanguage;
}

interface SignInParams {
  email: string;
  password: string;
}

export const authService = {
  async signUp({ email, password, firstName, lastName, role, language }: SignUpParams) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          role,
          language,
        },
      },
    });
    if (error) throw error;
    return data;
  },

  async signIn({ email, password }: SignInParams) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  },

  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  async getProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) throw error;
    const row = data as Record<string, unknown>;
    const profile: User = {
      id: row.id as string,
      email: (row.email as string) || '',
      role: ((row.role as string) || 'student') as UserRole,
      firstName: (row.first_name as string) || '',
      lastName: (row.last_name as string) || '',
      language: ((row.language as string) || 'en') as SupportedLanguage,
      avatarUrl: (row.avatar_url as string) || undefined,
      createdAt: (row.created_at as string) || '',
      updatedAt: (row.updated_at as string) || '',
    };
    return profile;
  },

  async getStudentProfile(userId: string) {
    const { data, error } = await supabase
      .from('student_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async upsertStudentProfile(userId: string, updates: Record<string, unknown>) {
    const { data, error } = await supabase
      .from('student_profiles')
      .upsert({ id: userId, ...updates }, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateProfile(userId: string, updates: Record<string, unknown>) {
    const allowed = ['first_name', 'last_name', 'language', 'avatar_url'];
    const safeUpdates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) safeUpdates[key] = updates[key];
    }
    if (Object.keys(safeUpdates).length === 0) {
      throw new Error('No valid fields to update.');
    }
    const { data, error } = await supabase
      .from('profiles')
      .update(safeUpdates)
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateLanguage(userId: string, language: SupportedLanguage) {
    return this.updateProfile(userId, { language });
  },

  onAuthStateChange(callback: (event: string, session: unknown) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },
};
