import { supabase } from './supabase';
import { UserRole, SupportedLanguage } from '@/types/user';

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
    return data;
  },

  async getStudentProfile(userId: string) {
    const { data, error } = await supabase
      .from('student_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  },

  async updateProfile(userId: string, updates: Record<string, unknown>) {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
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
