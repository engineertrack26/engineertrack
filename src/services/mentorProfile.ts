import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { authService } from './auth';
import { passwordFormError } from '@/utils/mentorProfile';

export const mentorProfileService = {
  async assertSession(userId: string) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session || data.session.user.id !== userId) throw new Error('Session changed');
    return data.session;
  },
  async changePassword(userId: string, email: string, current: string, next: string, confirm: string) {
    const validation = passwordFormError(current, next, confirm);
    if (validation) throw new Error(validation);
    await mentorProfileService.assertSession(userId);
    // Isolated reauthentication verifies the current password without replacing
    // the application's session or triggering its auth listeners.
    const client = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password: current });
      if (error) throw error;
      if (data.user?.id !== userId) throw new Error('Account mismatch');
      await mentorProfileService.assertSession(userId);
      const result = await client.auth.updateUser({ password: next });
      if (result.error) throw result.error;
    } finally {
      // Revoke only the temporary session, not the main application session.
      void client.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  },
  async uploadAvatar(userId: string, asset: { uri: string; mimeType?: string | null }) {
    const session = await mentorProfileService.assertSession(userId);
    const mime = asset.mimeType || 'image/jpeg';
    const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[mime];
    if (!extension) throw new Error('Unsupported image');
    const path = `${userId}/avatar_${Date.now()}.${extension}`;
    const body = new FormData();
    body.append('', { uri: asset.uri, name: `avatar.${extension}`, type: mime } as unknown as Blob);
    const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/avatars/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body,
    });
    if (!response.ok) throw new Error('Avatar upload failed');
    await mentorProfileService.assertSession(userId);
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    await authService.updateProfile(userId, { avatar_url: data.publicUrl });
    return data.publicUrl;
  },
};
