import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { AuthInput, AuthButton, authStyles } from '@/components/common/AuthForm';
import { openPasswordRecovery } from '@/services/passwordRecovery';
import { isPasswordPwned } from '@/services/pwnedPasswords';
import { recoveryPasswordError } from '@/utils/passwordRecovery';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';
import { takeRecoveryLink } from '@/utils/recoveryLinkInbox';

export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'done'>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const recovery = useRef<Awaited<ReturnType<typeof openPasswordRecovery>> | null>(null);
  const revision = useRef(0);
  const saving = useRef(false);

  useEffect(() => {
    let active = true;
    let lastUrl: string | null = null;
    async function receive(url: string | null) {
      if (!active || (url && url === lastUrl) || saving.current) return;
      lastUrl = url;
      const request = ++revision.current;
      recovery.current = null;
      setPassword(''); setConfirmation(''); setError(''); setState('loading');
      if (!url) { setState('invalid'); return; }
      try {
        const result = await openPasswordRecovery(url);
        if (!active || request !== revision.current) return;
        recovery.current = result; setEmail(result.email); setState('ready');
      } catch { if (active && request === revision.current) setState('invalid'); }
    }
    const subscription = Linking.addEventListener('url', ({ url }) => { void receive(url); });
    const pending = takeRecoveryLink();
    if (pending) void receive(pending);
    else void Linking.getInitialURL().then(url => { if (!lastUrl) void receive(url); }).catch(() => { if (active) setState('invalid'); });
    return () => { active = false; revision.current++; recovery.current = null; takeRecoveryLink(); subscription.remove(); };
  }, []);

  async function save() {
    if (saving.current || !recovery.current) return;
    const validation = recoveryPasswordError(password, confirmation);
    if (validation) { setError(validation); return; }
    saving.current = true; setBusy(true); setError('');
    const request = revision.current;
    try {
      if (await isPasswordPwned(password)) {
        if (request === revision.current) setError('authUi.weakPassword');
        return;
      }
      await recovery.current.save(password, confirmation);
      if (request !== revision.current) return;
      recovery.current = null; setPassword(''); setConfirmation(''); setState('done');
    } catch (failure) {
      if (request !== revision.current) return;
      const message = failure instanceof Error ? failure.message : '';
      if (message === 'recoveryUi.invalid') { recovery.current = null; setState('invalid'); }
      else setError(message === 'recoveryUi.different' ? message : 'recoveryUi.saveFailed');
    } finally { saving.current = false; if (request === revision.current) setBusy(false); }
  }

  return <ScreenWrapper><View style={[authStyles.container, { gap: 20 }]}>
    <Text style={ui.title} accessibilityRole="header">{t('auth.resetPassword')}</Text>
    {state === 'loading' && <><ActivityIndicator color={colors.primaryDark} /><Text style={ui.body}>{t('common.loading')}</Text></>}
    {state === 'invalid' && <>
      <Text style={ui.body} accessibilityRole="alert">{t('recoveryUi.invalid')}</Text>
      <AuthButton title={t('recoveryUi.request')} onPress={() => router.replace('/(auth)/forgot-password')} />
    </>}
    {state === 'ready' && <>
      <Text style={ui.body}>{t('recoveryUi.hint')}</Text>
      <Text style={ui.label}>{email}</Text>
      <AuthInput label={t('mentorProfile.newPassword')} isPassword value={password} onChangeText={setPassword}
        editable={!busy} autoComplete="new-password" autoCapitalize="none" autoCorrect={false} />
      <Text style={ui.secondary}>{t('authUi.passwordHint')}</Text>
      <AuthInput label={t('auth.confirmPassword')} isPassword value={confirmation} onChangeText={setConfirmation}
        editable={!busy} autoComplete="new-password" autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={save} />
      {!!error && <Text style={authStyles.error} accessibilityRole="alert">{t(error)}</Text>}
      <AuthButton title={t('common.save')} loading={busy} onPress={save} />
    </>}
    {state === 'done' && <Text style={ui.body} accessibilityLiveRegion="polite">{t('recoveryUi.done')}</Text>}
    {state !== 'loading' && <AuthButton title={t('auth.login')} disabled={busy} variant="ghost"
      onPress={() => router.replace('/(auth)/login')} />}
  </View></ScreenWrapper>;
}
