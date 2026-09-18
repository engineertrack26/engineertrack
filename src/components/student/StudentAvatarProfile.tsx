import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { avatarErrorKey, getStudentAvatar, setStudentAvatar, type StudentAvatarState } from '@/services/studentAvatar';
import type { StudentAvatarId } from '@/utils/studentAvatar';
import { ProfileSheet } from '@/components/mentor/ProfileSheet';
import { StudentAvatar } from './StudentAvatar';
import { AvatarPicker } from './AvatarPicker';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';

export function StudentAvatarProfile({ userId, disabled = false }: { userId: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const [state, setState] = useState<StudentAvatarState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<StudentAvatarId | null>(null);
  const sequence = useRef(0);
  const lock = useRef(false);
  const sameAccount = () => useAuthStore.getState().user?.id === userId;
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const result = await getStudentAvatar();
      if (request === sequence.current && useAuthStore.getState().user?.id === userId) setState(result);
    } catch (err) {
      if (request === sequence.current && useAuthStore.getState().user?.id === userId) {
        setState(null); setError(avatarErrorKey(err));
      }
    } finally { if (request === sequence.current) setLoading(false); }
  }, [userId]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { sequence.current += 1; setOpen(false); };
  }, [load]));
  const close = () => {
    if (lock.current) return;
    const leave = () => { setOpen(false); setError(null); };
    if (draft !== state?.avatarId) Alert.alert(t('mentorProfile.discardTitle'), t('mentorProfile.discardHint'), [
      { text: t('common.cancel'), style: 'cancel' }, { text: t('mentorProfile.discard'), onPress: leave },
    ]); else leave();
  };
  const save = async () => {
    if (!draft || lock.current || disabled || !sameAccount()) return;
    lock.current = true; setBusy(true); setError(null); setSuccess(false);
    const request = ++sequence.current;
    try {
      const result = await setStudentAvatar(draft);
      if (request === sequence.current && sameAccount()) { setState(result); setOpen(false); setSuccess(true); }
    } catch (err) {
      if (request === sequence.current && sameAccount()) setError(avatarErrorKey(err));
    } finally { lock.current = false; setBusy(false); }
  };
  return <View style={{ gap: 12 }}>
    <Text style={ui.label}>{t('avatarUi.title')}</Text>
    {loading ? <ActivityIndicator color={colors.primaryDark} /> : state ? <>
      {state.avatarId ? <View style={{ alignItems: 'center', gap: 8 }}>
        <StudentAvatar avatarId={state.avatarId} level={state.level} size={200} />
        <Text style={ui.secondary}>{t('avatarUi.stage', { level: state.level })}</Text>
      </View> : <Text style={ui.secondary}>{t('avatarUi.noChoice')}</Text>}
      <Pressable accessibilityRole="button" disabled={disabled || busy} style={ui.primary}
        onPress={() => { setDraft(state.avatarId); setError(null); setSuccess(false); setOpen(true); }}>
        <Text style={ui.primaryText}>{t(state.avatarId ? 'avatarUi.change' : 'avatarUi.choose')}</Text>
      </Pressable>
    </> : <Pressable accessibilityRole="button" disabled={disabled || busy} style={{ minHeight: 48, justifyContent: 'center' }} onPress={() => void load()}>
      <Text style={ui.link}>{t('common.retry')}</Text>
    </Pressable>}
    {error && !open && <Text accessibilityRole="alert" style={[ui.body, { color: colors.error }]}>{t(error)}</Text>}
    {success && <Text accessibilityLiveRegion="polite" style={ui.body}>{t('avatarUi.saved')}</Text>}
    {open && state && <ProfileSheet title={t('avatarUi.choose')} busy={busy || disabled} onClose={close}>
      <AvatarPicker value={draft} onChange={setDraft} level={state.level} disabled={busy || disabled} />
      {error && <Text accessibilityRole="alert" style={[ui.body, { color: colors.error }]}>{t(error)}</Text>}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !draft || busy || disabled, busy }}
        disabled={!draft || busy || disabled} onPress={() => void save()} style={[ui.primary, (!draft || busy || disabled) && { opacity: 0.5 }]}>
        {busy && <ActivityIndicator color="#fff" />}<Text style={ui.primaryText}>{t('common.save')}</Text>
      </Pressable>
    </ProfileSheet>}
  </View>;
}
