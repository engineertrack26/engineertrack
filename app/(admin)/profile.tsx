import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import i18n from '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { useAdminStore } from '@/store/adminStore';
import { authService } from '@/services/auth';
import { adminService } from '@/services/admin';
import { supabase } from '@/services/supabase';
import { colors, spacing, borderRadius } from '@/theme';

const ADMIN_COLOR = '#e65100';

export default function AdminProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const reset = useAuthStore((s) => s.reset);
  const { institution, setInstitution } = useAdminStore();

  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [currentLang, setCurrentLang] = useState(i18n.language || 'en');
  const [regenerating, setRegenerating] = useState(false);

  const LANGUAGES: { code: string; label: string }[] = [
    { code: 'en', label: 'English' },
    { code: 'tr', label: 'Turkce' },
    { code: 'sr', label: 'Srpski' },
    { code: 'el', label: 'Ellinika' },
    { code: 'it', label: 'Italiano' },
    { code: 'ro', label: 'Romana' },
    { code: 'de', label: 'Deutsch' },
  ];

  const handleChangeLanguage = () => {
    const buttons = LANGUAGES.map((lang) => ({
      text: `${lang.label}${lang.code === currentLang ? ' +' : ''}`,
      onPress: async () => {
        if (lang.code === currentLang) return;
        try {
          await i18n.changeLanguage(lang.code);
          setCurrentLang(lang.code);
          if (user) {
            await authService.updateProfile(user.id, { language: lang.code });
            setUser({ ...user, language: lang.code as typeof user.language });
          }
        } catch (err) {
          console.error('Language change error:', err);
        }
      },
    }));
    buttons.push({ text: t('common.cancel') || 'Cancel', onPress: async () => {} });
    Alert.alert(t('common.language') || 'Language', undefined, buttons);
  };

  const initials = `${(user?.firstName || '')[0] || ''}${(user?.lastName || '')[0] || ''}`.toUpperCase();

  const pickAvatar = useCallback(async () => {
    if (!user) return;
    Alert.alert(
      t('common.selectPhoto') || 'Select Photo',
      undefined,
      [
        { text: t('common.camera') || 'Camera', onPress: () => launchPicker('camera') },
        { text: t('common.gallery') || 'Gallery', onPress: () => launchPicker('gallery') },
        { text: t('common.cancel') || 'Cancel', style: 'cancel' },
      ],
    );
  }, [user, t]);

  const launchPicker = async (source: 'camera' | 'gallery') => {
    if (!user) return;
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingAvatar(true);
    try {
      const uri = result.assets[0].uri;
      const fileName = `${user.id}/avatar_${Date.now()}.jpg`;
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error('No session');
      const formData = new FormData();
      formData.append('', { uri, name: 'avatar.jpg', type: 'image/jpeg' } as unknown as Blob);
      const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/avatars/${fileName}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'x-upsert': 'true' },
        body: formData,
      });
      if (!uploadRes.ok) throw new Error(await uploadRes.text());
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
      await authService.updateProfile(user.id, { avatar_url: urlData.publicUrl });
      setUser({ ...user, avatarUrl: urlData.publicUrl });
    } catch (err) {
      console.error('Avatar upload error:', err);
      Alert.alert(t('common.error') || 'Error', t('common.tryAgain') || 'Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveName = async () => {
    if (!user) return;
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    if (!trimmedFirst) {
      Alert.alert(t('common.error') || 'Error', 'First name is required.');
      return;
    }
    setSaving(true);
    try {
      await authService.updateProfile(user.id, { first_name: trimmedFirst, last_name: trimmedLast });
      setUser({ ...user, firstName: trimmedFirst, lastName: trimmedLast });
      setIsEditing(false);
    } catch (err) {
      console.error('Update name error:', err);
      Alert.alert(t('common.error') || 'Error', t('common.tryAgain') || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setFirstName(user?.firstName || '');
    setLastName(user?.lastName || '');
    setIsEditing(false);
  };

  const handleRegenerateCode = () => {
    if (!institution) return;
    Alert.alert(
      'Regenerate Code',
      'This will invalidate the current code. Users who have already joined will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            setRegenerating(true);
            try {
              const newCode = await adminService.regenerateInstitutionCode(institution.id);
              setInstitution({ ...institution, institutionCode: newCode });
              Alert.alert('Success', `New code: ${newCode}`);
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to regenerate code.');
            } finally {
              setRegenerating(false);
            }
          },
        },
      ],
    );
  };

  const copyCode = async () => {
    if (!institution?.institutionCode) return;
    await Clipboard.setStringAsync(institution.institutionCode);
    Alert.alert('Copied!', 'Institution code copied to clipboard.');
  };

  const handleSignOut = () => {
    Alert.alert(
      t('auth.signOut') || 'Sign Out',
      t('auth.signOutConfirm') || 'Are you sure you want to sign out?',
      [
        { text: t('common.cancel') || 'Cancel', style: 'cancel' },
        {
          text: t('auth.signOut') || 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await authService.signOut();
              reset();
              useAdminStore.getState().reset();
              router.replace('/(auth)/login');
            } catch (err) {
              console.error('Sign out error:', err);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.screenTitle}>{t('student.profile') || 'Profile'}</Text>

        {/* Avatar Section */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={pickAvatar} activeOpacity={0.7} style={styles.avatarWrapper}>
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.initials}>{initials || '?'}</Text>
              </View>
            )}
            {uploadingAvatar ? (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : (
              <View style={styles.cameraIcon}>
                <Ionicons name="camera" size={16} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.avatarHint}>{t('common.tapToChange') || 'Tap to change photo'}</Text>
        </View>

        {/* User Info Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{t('student.personalInfo') || 'Personal Info'}</Text>
            {!isEditing ? (
              <TouchableOpacity onPress={() => setIsEditing(true)} hitSlop={8}>
                <Ionicons name="pencil" size={20} color={ADMIN_COLOR} />
              </TouchableOpacity>
            ) : (
              <View style={styles.editActions}>
                <TouchableOpacity onPress={handleCancelEdit} style={styles.cancelBtn}>
                  <Text style={styles.cancelText}>{t('common.cancel') || 'Cancel'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleSaveName} disabled={saving} style={styles.saveBtn}>
                  {saving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveText}>{t('common.save') || 'Save'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('auth.firstName') || 'First Name'}</Text>
            {isEditing ? (
              <TextInput style={styles.infoInput} value={firstName} onChangeText={setFirstName} placeholder={t('auth.firstName') || 'First Name'} placeholderTextColor={colors.textDisabled} />
            ) : (
              <Text style={styles.infoValue}>{user?.firstName || '-'}</Text>
            )}
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('auth.lastName') || 'Last Name'}</Text>
            {isEditing ? (
              <TextInput style={styles.infoInput} value={lastName} onChangeText={setLastName} placeholder={t('auth.lastName') || 'Last Name'} placeholderTextColor={colors.textDisabled} />
            ) : (
              <Text style={styles.infoValue}>{user?.lastName || '-'}</Text>
            )}
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('auth.email') || 'Email'}</Text>
            <Text style={styles.infoValue}>{user?.email || '-'}</Text>
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.infoLabel}>{t('common.role') || 'Role'}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>Admin</Text>
            </View>
          </View>
        </View>

        {/* Institution Code Card */}
        {institution && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Institution Code</Text>
            <TouchableOpacity onPress={copyCode} activeOpacity={0.7} style={styles.codeRow}>
              <Text style={styles.codeText}>{institution.institutionCode}</Text>
              <Ionicons name="copy-outline" size={20} color={ADMIN_COLOR} />
            </TouchableOpacity>
            <Text style={styles.codeHint}>Tap to copy. Share with advisors and students.</Text>
            <TouchableOpacity
              style={styles.regenerateBtn}
              onPress={handleRegenerateCode}
              disabled={regenerating}
              activeOpacity={0.7}
            >
              {regenerating ? (
                <ActivityIndicator size="small" color={ADMIN_COLOR} />
              ) : (
                <>
                  <Ionicons name="refresh-outline" size={16} color={ADMIN_COLOR} />
                  <Text style={styles.regenerateText}>Regenerate Code</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Institution Info */}
        {institution && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Institution Info</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Name</Text>
              <Text style={styles.infoValue}>{institution.name}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Type</Text>
              <Text style={styles.infoValue}>
                {institution.type === 'university' ? 'University' : institution.type === 'vocational_school' ? 'Vocational School' : 'Other'}
              </Text>
            </View>
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.infoLabel}>Country</Text>
              <Text style={styles.infoValue}>{institution.country || '-'}</Text>
            </View>
          </View>
        )}

        {/* Settings Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('common.settings') || 'Settings'}</Text>
          <TouchableOpacity style={styles.settingsRow} onPress={handleChangeLanguage} activeOpacity={0.6}>
            <View style={styles.settingsLeft}>
              <Ionicons name="language-outline" size={22} color={ADMIN_COLOR} />
              <Text style={styles.settingsLabel}>{t('common.language') || 'Language'}</Text>
            </View>
            <View style={styles.settingsRight}>
              <Text style={styles.settingsValue}>
                {LANGUAGES.find((l) => l.code === currentLang)?.label || currentLang.toUpperCase()}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
            </View>
          </TouchableOpacity>
          <View style={[styles.settingsRow, { borderBottomWidth: 0, opacity: 0.5 }]}>
            <View style={styles.settingsLeft}>
              <Ionicons name="color-palette-outline" size={22} color={ADMIN_COLOR} />
              <Text style={styles.settingsLabel}>{t('common.theme') || 'Theme'}</Text>
            </View>
            <View style={styles.settingsRight}>
              <Text style={styles.comingSoon}>Coming Soon</Text>
            </View>
          </View>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={22} color={colors.error} />
          <Text style={styles.signOutText}>{t('auth.signOut') || 'Sign Out'}</Text>
        </TouchableOpacity>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  screenTitle: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: spacing.lg },

  // Avatar
  avatarSection: { alignItems: 'center', marginBottom: spacing.lg },
  avatarWrapper: { position: 'relative' },
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.border },
  avatarFallback: { width: 120, height: 120, borderRadius: 60, backgroundColor: ADMIN_COLOR + '20', alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 40, fontWeight: '700', color: ADMIN_COLOR },
  avatarOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: 60, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  cameraIcon: { position: 'absolute', bottom: 4, right: 4, width: 32, height: 32, borderRadius: 16, backgroundColor: ADMIN_COLOR, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  avatarHint: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.sm },

  // Card
  card: { backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },

  // Edit
  editActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cancelBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  cancelText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  saveBtn: { backgroundColor: ADMIN_COLOR, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: borderRadius.sm, minWidth: 60, alignItems: 'center' },
  saveText: { fontSize: 14, color: '#fff', fontWeight: '600' },

  // Info
  infoRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  infoLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  infoValue: { fontSize: 16, color: colors.text, fontWeight: '500' },
  infoInput: { fontSize: 16, color: colors.text, fontWeight: '500', borderBottomWidth: 1.5, borderBottomColor: ADMIN_COLOR, paddingVertical: 4, paddingHorizontal: 0 },

  // Role badge
  roleBadge: { alignSelf: 'flex-start', backgroundColor: ADMIN_COLOR + '15', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.sm, marginTop: 2 },
  roleBadgeText: { fontSize: 13, color: ADMIN_COLOR, fontWeight: '600' },

  // Code
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  codeText: { fontSize: 28, fontWeight: '800', color: ADMIN_COLOR, letterSpacing: 3 },
  codeHint: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm },
  regenerateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  regenerateText: { fontSize: 13, color: ADMIN_COLOR, fontWeight: '600' },

  // Settings
  settingsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm + 4, borderBottomWidth: 1, borderBottomColor: colors.divider },
  settingsLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  settingsLabel: { fontSize: 15, color: colors.text, fontWeight: '500' },
  settingsRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  settingsValue: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  comingSoon: { fontSize: 13, color: colors.textDisabled, fontStyle: 'italic' },

  // Sign Out
  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderWidth: 1.5, borderColor: colors.error, borderRadius: borderRadius.md, marginTop: spacing.sm },
  signOutText: { fontSize: 16, color: colors.error, fontWeight: '600' },
});
