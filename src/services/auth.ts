import { supabase } from './supabase';
import { Session } from '@supabase/supabase-js';
import { User, UserRole, SupportedLanguage } from '@/types/user';
import { isStudentAvatarId, type StudentAvatarId } from '@/utils/studentAvatar';

interface SignUpParams {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  language: SupportedLanguage;
  consentVersion?: string;
  avatarId?: StudentAvatarId | null;
}

interface SignInParams {
  email: string;
  password: string;
}

export const authService = {
  async signUp({ email, password, firstName, lastName, role, language, consentVersion, avatarId }: SignUpParams) {
    const metadata: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
      role,
      language,
    };
    if (consentVersion) {
      metadata.consent_version = consentVersion;
    }
    if (role === 'student' && avatarId != null) {
      if (!isStudentAvatarId(avatarId)) throw new Error('AVATAR_INVALID');
      metadata.student_avatar_id = avatarId;
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
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
    // Clear the push token WHILE the session still exists. It used to be
    // cleared after SIGNED_OUT, as anon, where the profiles policy silently
    // matched no row (and, since the 2026-09-20 hardening, is refused).
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (uid) {
      const { error: tokenError } = await supabase.from('profiles').update({ expo_push_token: null }).eq('id', uid);
      if (tokenError) console.warn('Push token not cleared before sign-out:', tokenError.message);
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async resetPassword(email: string, redirectTo: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
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
      consentVersion: (row.consent_version as string) || undefined,
      createdAt: (row.created_at as string) || '',
      updatedAt: (row.updated_at as string) || '',
    };
    return profile;
  },

  async getProfileWithRetry(userId: string, retries = 8, delayMs = 250) {
    let lastError: unknown = null;
    for (let i = 0; i < retries; i += 1) {
      try {
        return await this.getProfile(userId);
      } catch (error) {
        lastError = error;
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError;
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

  // Update-then-insert instead of upsert: PostgREST upsert puts `id` in the
  // ON CONFLICT UPDATE SET list, which requires an UPDATE(id) column grant
  // that the gamification lockdown intentionally does not give.
  async upsertStudentProfile(userId: string, updates: Record<string, unknown>) {
    const { data: updated, error: updateError } = await supabase
      .from('student_profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .maybeSingle();
    if (updateError) throw updateError;
    if (updated) return updated;

    const { data, error } = await supabase
      .from('student_profiles')
      .insert({ id: userId, ...updates })
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

  async recordConsent(version: string) {
    const { error } = await supabase.rpc('record_consent', { p_version: version });
    if (error) throw error;
  },

  onAuthStateChange(callback: (event: string, session: Session | null) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },
};
