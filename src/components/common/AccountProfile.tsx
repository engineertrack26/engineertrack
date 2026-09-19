import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth';
import { mentorProfileService } from '@/services/mentorProfile';
import { PROFILE_LANGUAGES, passwordFormError, profileError } from '@/utils/mentorProfile';
import { reviewInitials } from '@/utils/mentorReviews';
import type { SupportedLanguage, User } from '@/types/user';
import { ui } from '@/components/common/workflowStyles';
import { ProfileSheet } from '@/components/mentor/ProfileSheet';
import { colors, fonts } from '@/theme';
import { StudentAvatarProfile } from '@/components/student/StudentAvatarProfile';

type Mode = 'name' | 'language' | 'password' | 'photo' | null;
/** Shared account UI; role-specific content and navigation are supplied by callers. */
export function AccountProfile({ user, header, roleLabel, children }: {
  user: User; header: ReactNode; roleLabel: string; children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [language, setLanguage] = useState<SupportedLanguage>(user.language);
  const [passwords, setPasswords] = useState(['', '', '']);
  const [visible, setVisible] = useState([false, false, false]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const lock = useRef(false);
  const active = useRef(true);
  const sameAccount = () => useAuthStore.getState().user?.id === user.id;
  const clearSecrets = useCallback(() => { setPasswords(['', '', '']); setVisible([false, false, false]); }, []);
  useFocusEffect(useCallback(() => {
    active.current = true;
    setBusy(lock.current);
    return () => { active.current = false; clearSecrets(); setMode(null); };
  }, [clearSecrets]));
  const patchUser = (patch: Partial<User>) => {
    const current = useAuthStore.getState().user;
    if (current?.id === user.id) useAuthStore.getState().setUser({ ...current, ...patch });
  };
  const open = (next: Mode) => {
    if (lock.current) return;
    setFirst(user.firstName); setLast(user.lastName); setLanguage(user.language);
    clearSecrets(); setError(null); setSuccess(null); setMode(next);
  };
  const close = () => {
    if (lock.current) return;
    const leave = () => { clearSecrets(); setMode(null); setError(null); };
    const dirty = mode === 'name' ? first !== user.firstName || last !== user.lastName : mode === 'password' && passwords.some(Boolean);
    if (dirty) Alert.alert(t('mentorProfile.discardTitle'), t('mentorProfile.discardHint'), [
      { text: t('common.cancel'), style: 'cancel' }, { text: t('mentorProfile.discard'), onPress: leave },
    ]);
    else leave();
  };
  const run = async (work: () => Promise<void>, message = 'mentorProfile.saved') => {
    if (lock.current || !sameAccount()) return;
    lock.current = true; setBusy(true); setError(null); setSuccess(null);
    try {
      await work();
      if (active.current && sameAccount()) { clearSecrets(); setMode(null); setSuccess(message); }
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'photo_canceled') return;
      if (active.current && sameAccount()) setError(profileError(err));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  };
  const save = () => {
    if (mode === 'name') {
      if (!first.trim()) { setError('mentorProfile.nameRequired'); return; }
      void run(async () => {
        await authService.updateProfile(user.id, { first_name: first.trim(), last_name: last.trim() });
        patchUser({ firstName: first.trim(), lastName: last.trim() });
      });
    } else if (mode === 'language') {
      void run(async () => {
        await authService.updateLanguage(user.id, language);
        if (!sameAccount()) return;
        patchUser({ language });
        await i18n.changeLanguage(language);
      });
    } else if (mode === 'password') {
      const validation = passwordFormError(passwords[0], passwords[1], passwords[2]);
      if (validation) { setError(validation); return; }
      void run(() => mentorProfileService.changePassword(user.id, user.email, passwords[0], passwords[1], passwords[2]), 'mentorProfile.passwordSaved');
    }
  };
  const photo = (source: 'camera' | 'gallery') => {
    void run(async () => {
      const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw { code: 'photo_permission' };
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets?.[0]) throw { code: 'photo_canceled' };
      if (!sameAccount()) return;
      const url = await mentorProfileService.uploadAvatar(user.id, result.assets[0]);
      patchUser({ avatarUrl: url }); setFailedAvatar(null);
    }, 'mentorProfile.photoSaved');
  };
  const signOut = () => {
    if (lock.current) return;
    Alert.alert(t('auth.signOut'), t('auth.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.signOut'), style: 'destructive', onPress: () => { void run(async () => {
        await authService.signOut();
        const current = useAuthStore.getState().user;
        if (current && current.id !== user.id) return;
        useAuthStore.getState().reset(); router.replace('/(auth)/login');
      }); } },
    ]);
  };
  const row = (label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void, value?: string) =>
    <Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={[ui.header, { minHeight: 64, padding: 16 }]}>
      <Ionicons name={icon} size={24} color={colors.textSecondary} />
      <View style={{ flex: 1, gap: 4 }}><Text style={ui.body}>{label}</Text>{!!value && <Text style={ui.secondary}>{value}</Text>}</View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </Pressable>;

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <View style={[ui.content, { paddingTop: 12, paddingBottom: 12 }]}>{header}</View>
    <ScrollView contentContainerStyle={ui.content}>
      <Text accessibilityRole="header" style={ui.title}>{t('tabs.profile')}</Text>
      {!!success && <Text accessibilityLiveRegion="polite" style={ui.body}>{t(success)}</Text>}
      {!!error && !mode && <Text accessibilityRole="alert" style={[ui.body, { color: colors.error }]}>{t(error)}</Text>}
      <View style={ui.card}>
        {user.role === 'student' && <StudentAvatarProfile key={user.id} userId={user.id} disabled={busy} />}
        <View style={ui.header}>
          {user.role !== 'student' && (user.avatarUrl && failedAvatar !== user.avatarUrl ? <Image source={{ uri: user.avatarUrl }} accessibilityLabel={t('mentorProfile.photo')}
            onError={() => setFailedAvatar(user.avatarUrl || null)} style={{ width: 72, height: 72, borderRadius: 36 }} /> :
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.inkBg, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[ui.title, { color: colors.primaryDark }]}>{reviewInitials(user.firstName + ' ' + user.lastName)}</Text>
            </View>)}
          <View style={{ flex: 1, gap: 8 }}><Text style={ui.section}>{[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}</Text>
            <Text style={[ui.badge, { backgroundColor: colors.inkBg, color: colors.ink }]}>{roleLabel}</Text></View>
        </View>
        {user.role !== 'student' && <Pressable accessibilityRole="button" disabled={busy} onPress={() => open('photo')} style={[ui.header, { minHeight: 48 }]}>
          <Ionicons name="camera-outline" size={22} color={colors.primaryDark} /><Text style={[ui.link, { flexShrink: 1 }]}>{t('mentorProfile.changePhoto')}</Text>
        </Pressable>}
        <View style={{ borderTopWidth: 1, borderColor: colors.divider, paddingTop: 16, gap: 4 }}>
          <Text style={ui.secondary}>{t('auth.email')}</Text><Text selectable style={ui.body}>{user.email || '—'}</Text>
        </View>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => open('name')} style={[ui.primary, { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.ink }]}>
          <Ionicons name="pencil-outline" size={22} color={colors.primaryDark} /><Text style={[ui.primaryText, { color: colors.primaryDark }]}>{t('mentorProfile.edit')}</Text>
        </Pressable>
      </View>
      {!!children && <View pointerEvents={busy ? 'none' : 'auto'} style={{ gap: 20 }}>{children}</View>}
      <Text accessibilityRole="header" style={ui.section}>{t('mentorProfile.preferences')}</Text>
      <View style={[ui.card, { padding: 0 }]}>{row(t('mentorProfile.language'), 'globe-outline', () => open('language'), PROFILE_LANGUAGES.find(item => item.code === user.language)?.label || user.language)}</View>
      <Text accessibilityRole="header" style={ui.section}>{t('mentorProfile.security')}</Text>
      <View style={[ui.card, { padding: 0, gap: 0 }]}>
        {row(t('mentorProfile.password'), 'lock-closed-outline', () => open('password'))}
        <View style={{ height: 1, backgroundColor: colors.divider, marginHorizontal: 16 }} />
        {row(t('legal.privacy.title'), 'shield-checkmark-outline', () => router.push('/(auth)/privacy-policy'))}
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={signOut}
        style={[ui.primary, { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.error }]}>
        {busy && !mode ? <ActivityIndicator color={colors.error} /> : <Ionicons name="log-out-outline" size={22} color={colors.error} />}
        <Text style={[ui.primaryText, { color: colors.error }]}>{t('auth.signOut')}</Text>
      </Pressable>
    </ScrollView>
    {mode && <ProfileSheet busy={busy} onClose={close} title={t(mode === 'name' ? 'mentorProfile.edit' : mode === 'language' ? 'mentorProfile.language' : mode === 'photo' ? 'mentorProfile.changePhoto' : 'mentorProfile.password')}>
      {mode === 'name' && <>
        <Text style={ui.label}>{t('auth.firstName')}</Text><TextInput value={first} editable={!busy} onChangeText={setFirst} accessibilityLabel={t('auth.firstName')} style={ui.input} autoCapitalize="words" />
        <Text style={ui.label}>{t('auth.lastName')}</Text><TextInput value={last} editable={!busy} onChangeText={setLast} accessibilityLabel={t('auth.lastName')} style={ui.input} autoCapitalize="words" />
      </>}
      {mode === 'language' && <>
        <Text style={ui.body}>{t('mentorProfile.languageHint')}</Text>
        <View accessibilityRole="radiogroup">
          {PROFILE_LANGUAGES.map(item => <Pressable key={item.code} accessibilityRole="radio" accessibilityState={{ checked: language === item.code, disabled: busy }}
            disabled={busy} onPress={() => setLanguage(item.code)} style={[ui.header, { minHeight: 52, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: language === item.code ? colors.ink : colors.divider, backgroundColor: language === item.code ? colors.inkBg : colors.paper }]}>
            <Ionicons name={language === item.code ? 'radio-button-on' : 'radio-button-off'} size={24} color={language === item.code ? colors.primaryDark : colors.textSecondary} />
            <Text style={ui.body}>{item.label}</Text>
          </Pressable>)}
        </View>
      </>}
      {mode === 'password' && <>
        {['mentorProfile.currentPassword', 'mentorProfile.newPassword', 'mentorProfile.confirmPassword'].map((key, index) => <View key={key} style={{ gap: 8 }}>
          <Text style={ui.label}>{t(key)}</Text>
          <View style={[ui.input, ui.header, { paddingVertical: 0 }]}>
            <TextInput value={passwords[index]} editable={!busy} secureTextEntry={!visible[index]} autoCapitalize="none" autoCorrect={false}
              textContentType={index === 0 ? 'password' : 'newPassword'} accessibilityLabel={t(key)}
              onChangeText={value => setPasswords(values => values.map((old, i) => i === index ? value : old))} style={{ flex: 1, minHeight: 52, fontSize: 16, fontFamily: fonts.regular, color: colors.text }} />
            <Pressable accessibilityRole="button" accessibilityLabel={t(visible[index] ? 'mentorProfile.hidePassword' : 'mentorProfile.showPassword') + ': ' + t(key)}
              onPress={() => setVisible(values => values.map((old, i) => i === index ? !old : old))} style={ui.iconButton}>
              <Ionicons name={visible[index] ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>)}
        <Text style={ui.secondary}>{t('mentorProfile.passwordLength')}</Text>
      </>}
      {mode === 'photo' && <View style={ui.card}>
        {row(t('mentorProfile.camera'), 'camera-outline', () => photo('camera'))}
        {row(t('mentorProfile.gallery'), 'images-outline', () => photo('gallery'))}
      </View>}
      {!!error && <Text accessibilityRole="alert" style={[ui.body, { color: colors.error }]}>{t(error)}</Text>}
      {mode !== 'photo' && <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={save} style={[ui.primary, busy && { opacity: 0.6 }]}>
        {busy && <ActivityIndicator color="#fff" />}<Text style={ui.primaryText}>{t('common.save')}</Text>
      </Pressable>}
      {mode === 'photo' && busy && <ActivityIndicator color={colors.primaryDark} />}
      <Pressable accessibilityRole="button" disabled={busy} onPress={close} style={{ minHeight: 48 }}><Text style={[ui.link, { textAlign: 'center' }]}>{t('common.cancel')}</Text></Pressable>
    </ProfileSheet>}
  </SafeAreaView>;
}
