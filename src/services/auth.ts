import { supabase } from './supabase';
import { createClient, Session } from '@supabase/supabase-js';
import { User, UserRole, SupportedLanguage } from '@/types/user';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

interface SignUpParams {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  language: SupportedLanguage;
  eduEmail?: string;
}

export function isEduEmail(email: string): boolean {
  const lower = email.toLowerCase().trim();
  return lower.endsWith('.edu') || lower.endsWith('.edu.tr');
}

interface SignInParams {
  email: string;
  password: string;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export const authService = {
  async signUp({ email, password, firstName, lastName, role, language, eduEmail }: SignUpParams) {
    const metadata: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
      role,
      language,
    };
    if (role === 'admin' && eduEmail) {
      metadata.edu_email = eduEmail;
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

  async changePassword(_email: string, _currentPassword: string, newPassword: string) {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      throw new Error('Your session expired. Please sign in again and retry.');
    }

    // Use a throwaway client so we bypass the main client's auth lock and listeners.
    const tempClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    await tempClient.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });

    const { error } = await withTimeout(
      tempClient.auth.updateUser({ password: newPassword }),
      15000,
      'Timed out while updating the password. Check your connection and try again.',
    );
    if (error) {
      if (error.message === 'Auth session missing!') {
        throw new Error('Your session expired. Please sign in again and retry.');
      }
      throw error;
    }
  },

  onAuthStateChange(callback: (event: string, session: Session | null) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },
};
