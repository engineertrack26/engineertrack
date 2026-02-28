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
import i18n from '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth';
import { studentCodeService } from '@/services/studentCode';
import { departmentCodeService } from '@/services/departmentCode';
import { supabase } from '@/services/supabase';
import { colors, spacing, borderRadius } from '@/theme';

export default function AdvisorProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const reset = useAuthStore((s) => s.reset);

  const [studentCodeInput, setStudentCodeInput] = useState('');
  const [linkingStudent, setLinkingStudent] = useState(false);
  const [deptCodeInput, setDeptCodeInput] = useState('');
  const [joiningDepartment, setJoiningDepartment] = useState(false);
  const [departmentName, setDepartmentName] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [currentLang, setCurrentLang] = useState(i18n.language || 'en');
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const LANGUAGES: { code: string; label: string }[] = [
    { code: 'en', label: 'English' },
    { code: 'tr', label: 'Türkçe' },
    { code: 'sr', label: 'Srpski' },
    { code: 'el', label: 'Ελληνικά' },
    { code: 'it', label: 'Italiano' },
    { code: 'ro', label: 'Română' },
    { code: 'de', label: 'Deutsch' },
  ];

  const handleChangeLanguage = () => {
    const buttons = LANGUAGES.map((lang) => ({
      text: `${lang.label}${lang.code === currentLang ? ' ✓' : ''}`,
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
        {
          text: t('common.camera') || 'Camera',
          onPress: () => launchPicker('camera'),
        },
        {
          text: t('common.gallery') || 'Gallery',
          onPress: () => launchPicker('gallery'),
        },
        { text: t('common.cancel') || 'Cancel', style: 'cancel' },
      ],
    );
  }, [user, t]);

  const launchPicker = async (source: 'camera' | 'gallery') => {
    if (!user) return;

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.7,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.7,
          });

    if (result.canceled || !result.assets?.[0]) return;

    setUploadingAvatar(true);
    try {
      const uri = result.assets[0].uri;
      const fileName = `${user.id}/avatar_${Date.now()}.jpg`;

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error('No session');

      const formData = new FormData();
      formData.append('', {
        uri,
        name: 'avatar.jpg',
        type: 'image/jpeg',
      } as unknown as Blob);

      const uploadRes = await fetch(
        `${supabaseUrl}/storage/v1/object/avatars/${fileName}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'x-upsert': 'true',
          },
          body: formData,
        },
      );

      if (!uploadRes.ok) {
        const errBody = await uploadRes.text();
        throw new Error(errBody || 'Upload failed');
      }

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

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
      await authService.updateProfile(user.id, {
        first_name: trimmedFirst,
        last_name: trimmedLast,
      });
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

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      await authService.changePassword(newPassword);
      Alert.alert('Success', 'Password changed successfully.');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordChange(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to change password.';
      Alert.alert('Error', msg);
    } finally {
      setChangingPassword(false);
    }
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
        {/* Header */}
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
                <Ionicons name="pencil" size={20} color={colors.primary} />
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

          {/* First Name */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('auth.firstName') || 'First Name'}</Text>
            {isEditing ? (
              <TextInput
                style={styles.infoInput}
                value={firstName}
                onChangeText={setFirstName}
                placeholder={t('auth.firstName') || 'First Name'}
                placeholderTextColor={colors.textDisabled}
              />
            ) : (
              <Text style={styles.infoValue}>{user?.firstName || '-'}</Text>
            )}
          </View>

          {/* Last Name */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('auth.lastName') || 'Last Name'}</Text>
            {isEditing ? (
              <TextInput
                style={styles.infoInput}
                value={lastName}
                onChangeText={setLastName}
                placeholder={t('auth.lastName') || 'Last Name'}
                placeholderTextColor={colors.textDisabled}
              />
            ) : (
              <Text style={styles.infoValue}>{user?.lastName || '-'}</Text>
            )}
          </View>

          {/* Email */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('auth.email') || 'Email'}</Text>
            <Text style={styles.infoValue}>{user?.email || '-'}</Text>
          </View>

          {/* Role */}
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.infoLabel}>{t('common.role') || 'Role'}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>Advisor</Text>
            </View>
          </View>
        </View>

        {/* Join Department Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Join Department</Text>
          <Text style={styles.linkHint}>
            Enter the department code provided by your institution admin.
          </Text>
          <View style={styles.linkRow}>
            <TextInput
              style={styles.linkInput}
              value={deptCodeInput}
              onChangeText={setDeptCodeInput}
              placeholder="e.g. ABCD12"
              placeholderTextColor={colors.textDisabled}
              autoCapitalize="characters"
              maxLength={6}
            />
            <TouchableOpacity
              style={[styles.linkBtn, !deptCodeInput.trim() && { opacity: 0.5 }]}
              disabled={!deptCodeInput.trim() || joiningDepartment}
              onPress={async () => {
                if (!user || !deptCodeInput.trim()) return;
                setJoiningDepartment(true);
                try {
                  const dept = await departmentCodeService.joinDepartment(deptCodeInput.trim());
                  setDepartmentName(dept.name);
                  Alert.alert('Success', `Joined department: ${dept.name}`);
                  setDeptCodeInput('');
                } catch (err: any) {
                  Alert.alert('Error', err.message || 'Invalid department code.');
                } finally {
                  setJoiningDepartment(false);
                }
              }}
              activeOpacity={0.7}
            >
              {joiningDepartment ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.linkBtnText}>Join</Text>
              )}
            </TouchableOpacity>
          </View>
          {departmentName && (
            <Text style={styles.institutionInfo}>Current: {departmentName}</Text>
          )}
        </View>

        {/* Link Student Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Link Student</Text>
          <Text style={styles.linkHint}>
            Enter a student's 6-digit code to link to their account as an advisor.
          </Text>
          <View style={styles.linkRow}>
            <TextInput
              style={styles.linkInput}
              value={studentCodeInput}
              onChangeText={setStudentCodeInput}
              placeholder="e.g. ABC123"
              placeholderTextColor={colors.textDisabled}
              autoCapitalize="characters"
              maxLength={6}
            />
            <TouchableOpacity
              style={[styles.linkBtn, !studentCodeInput.trim() && { opacity: 0.5 }]}
              disabled={!studentCodeInput.trim() || linkingStudent}
              onPress={async () => {
                if (!user || !studentCodeInput.trim()) return;
                setLinkingStudent(true);
                try {
                  const result = await studentCodeService.linkWithCode(
                    studentCodeInput.trim(),
                    user.id,
                    'advisor',
                  );
                  Alert.alert('Success', `Linked to student: ${result.studentName}`);
                  setStudentCodeInput('');
                } catch (err: any) {
                  Alert.alert('Error', err.message || 'Invalid code.');
                } finally {
                  setLinkingStudent(false);
                }
              }}
              activeOpacity={0.7}
            >
              {linkingStudent ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.linkBtnText}>Link</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Settings Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('common.settings') || 'Settings'}</Text>

          {/* Language */}
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={handleChangeLanguage}
            activeOpacity={0.6}
          >
            <View style={styles.settingsLeft}>
              <Ionicons name="language-outline" size={22} color={colors.primary} />
              <Text style={styles.settingsLabel}>{t('common.language') || 'Language'}</Text>
            </View>
            <View style={styles.settingsRight}>
              <Text style={styles.settingsValue}>
                {LANGUAGES.find((l) => l.code === currentLang)?.label || currentLang.toUpperCase()}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
            </View>
          </TouchableOpacity>

          {/* Theme (Coming Soon) */}
          <View style={[styles.settingsRow, { borderBottomWidth: 0, opacity: 0.5 }]}>
            <View style={styles.settingsLeft}>
              <Ionicons name="color-palette-outline" size={22} color={colors.primary} />
              <Text style={styles.settingsLabel}>{t('common.theme') || 'Theme'}</Text>
            </View>
            <View style={styles.settingsRight}>
              <Text style={styles.comingSoon}>Coming Soon</Text>
            </View>
          </View>
        </View>

        {/* Change Password */}
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.changePasswordToggle}
            onPress={() => setShowPasswordChange((v) => !v)}
            activeOpacity={0.7}
          >
            <Ionicons name="lock-closed-outline" size={20} color={colors.primary} />
            <Text style={styles.changePasswordLabel}>Change Password</Text>
            <Ionicons
              name={showPasswordChange ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
          {showPasswordChange && (
            <View style={styles.changePasswordForm}>
              <TextInput
                style={styles.passwordInput}
                placeholder="New Password"
                placeholderTextColor={colors.textDisabled}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoCapitalize="none"
              />
              <TextInput
                style={styles.passwordInput}
                placeholder="Confirm New Password"
                placeholderTextColor={colors.textDisabled}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[styles.passwordSaveBtn, changingPassword && { opacity: 0.6 }]}
                onPress={handleChangePassword}
                disabled={changingPassword}
                activeOpacity={0.7}
              >
                {changingPassword ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.passwordSaveBtnText}>Update Password</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Sign Out Button */}
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
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },

  // Avatar
  avatarSection: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.border,
  },
  avatarFallback: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.primary,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 60,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraIcon: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },

  // Edit actions
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cancelBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  cancelText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    minWidth: 60,
    alignItems: 'center',
  },
  saveText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },

  // Info rows
  infoRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
  },
  infoInput: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
    borderBottomWidth: 1.5,
    borderBottomColor: colors.primary,
    paddingVertical: 4,
    paddingHorizontal: 0,
  },

  // Role badge
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.info + '15',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    marginTop: 2,
  },
  roleBadgeText: {
    fontSize: 13,
    color: colors.info,
    fontWeight: '600',
  },

  // Link Student / Institution
  linkHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  linkRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  linkInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: 2,
    backgroundColor: colors.background,
  },
  linkBtn: {
    backgroundColor: colors.info,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 70,
  },
  linkBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  institutionInfo: {
    fontSize: 13,
    color: colors.success,
    fontWeight: '500',
    marginTop: spacing.sm,
  },

  // Settings
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  settingsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  settingsLabel: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  settingsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  settingsValue: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  comingSoon: {
    fontSize: 13,
    color: colors.textDisabled,
    fontStyle: 'italic',
  },

  // Change Password
  changePasswordToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  changePasswordLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  changePasswordForm: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.background,
  },
  passwordSaveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  passwordSaveBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  // Sign Out
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.error,
    borderRadius: borderRadius.md,
    marginTop: spacing.sm,
  },
  signOutText: {
    fontSize: 16,
    color: colors.error,
    fontWeight: '600',
  },
});
