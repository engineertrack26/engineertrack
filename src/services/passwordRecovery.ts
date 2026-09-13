import { createClient } from '@supabase/supabase-js';
import { recoveryTokens, recoveryPasswordError } from '@/utils/passwordRecovery';

export async function openPasswordRecovery(url: string) {
  const tokens = recoveryTokens(url);
  if (!tokens) throw new Error('recoveryUi.invalid');
  // Do not install the email's session in the shared client or persistent storage.
  const client = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try { return await fetch(input, { ...init, signal: controller.signal }); }
      finally { clearTimeout(timer); }
    } },
  });
  const { error } = await client.auth.setSession(tokens);
  if (error) throw new Error('recoveryUi.invalid');
  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data.user) throw new Error('recoveryUi.invalid');
  const userId = data.user.id;
  let completed = false;
  let busy = false;
  return {
    email: data.user.email || '',
    async save(password: string, confirmation: string) {
      const validation = recoveryPasswordError(password, confirmation);
      if (validation) throw new Error(validation);
      if (completed || busy) throw new Error('recoveryUi.invalid');
      busy = true;
      try {
        const verified = await client.auth.getUser();
        if (verified.error || verified.data.user?.id !== userId) throw new Error('recoveryUi.invalid');
        const result = await client.auth.updateUser({ password });
        if (result.error) throw new Error(result.error.code === 'same_password' ? 'recoveryUi.different' : 'recoveryUi.saveFailed');
        completed = true;
        // Password was saved even if optional recovery-session revocation fails.
        await client.auth.signOut({ scope: 'local' }).catch(() => {});
      } finally { busy = false; }
    },
  };
}
