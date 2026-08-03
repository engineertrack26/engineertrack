import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '@/store/authStore';
import { useAdminStore } from '@/store/adminStore';
import { adminService } from '@/services/admin';
import { StatCard } from '@/components/common';
import { colors, spacing, borderRadius } from '@/theme';
import type { InstitutionType } from '@/types/institution';
import { normalizeDomainList } from '@/utils/emailDomain';

const ADMIN_COLOR = '#e65100';

export default function AdminDashboard() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { institution, stats, setInstitution } = useAdminStore();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupType, setSetupType] = useState<InstitutionType>('university');
  const [setupCountry, setSetupCountry] = useState('');
  const [setupDomains, setSetupDomains] = useState('');
  const [creatingInstitution, setCreatingInstitution] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string; departmentCode: string }[]>([]);
  const [deptName, setDeptName] = useState('');
  const [creatingDepartment, setCreatingDepartment] = useState(false);
  const [domainsInput, setDomainsInput] = useState('');
  const [savingDomains, setSavingDomains] = useState(false);

  useEffect(() => {
    setDomainsInput((institution?.allowedEmailDomains || []).join(', '));
  }, [institution?.id, institution?.allowedEmailDomains]);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const inst = await adminService.getInstitution(user.id);
      setInstitution(inst);
      if (inst) {
        const s = await adminService.getDashboardStats(inst.id);
        useAdminStore.setState({ stats: s });
        const deptList = await adminService.getDepartments(inst.id);
        setDepartments(deptList.map((d) => ({ id: d.id, name: d.name, departmentCode: d.departmentCode })));
      }
    } catch (err) {
      console.error('Admin dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, setInstitution]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const copyCode = async () => {
    if (!institution?.institutionCode) return;
    await Clipboard.setStringAsync(institution.institutionCode);
    Alert.alert(t('admin.copied'), t('admin.institutionCodeCopied'));
  };

  const handleCreateInstitution = async () => {
    if (!user) return;
    if (!setupName.trim()) {
      Alert.alert(t('common.error'), t('admin.institutionNameRequired'));
      return;
    }
    if (!setupCountry.trim()) {
      Alert.alert(t('common.error'), t('admin.countryRequired'));
      return;
    }
    setCreatingInstitution(true);
    try {
      const inst = await adminService.createInstitution(user.id, {
        name: setupName.trim(),
        type: setupType,
        country: setupCountry.trim(),
        allowedEmailDomains: normalizeDomainList(setupDomains),
      });
      setInstitution(inst);
      setShowSetup(false);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('admin.createInstitutionFailed'));
    } finally {
      setCreatingInstitution(false);
    }
  };

  async function handleSaveDomains() {
    if (!institution) return;
    setSavingDomains(true);
    try {
      const domains = normalizeDomainList(domainsInput);
      await adminService.updateAllowedEmailDomains(institution.id, domains);
      setInstitution({ ...institution, allowedEmailDomains: domains });
      setDomainsInput(domains.join(', '));
      Alert.alert(t('common.done'), t('common.allowedEmailDomainsSaved'));
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.unknown'));
    } finally {
      setSavingDomains(false);
    }
  }

  const handleCreateDepartment = async () => {
    if (!institution) return;
    if (!deptName.trim()) {
      Alert.alert(t('common.error'), t('admin.departmentNameRequired'));
      return;
    }
    setCreatingDepartment(true);
    try {
      const dept = await adminService.createDepartment(institution.id, deptName.trim());
      setDepartments((prev) => [...prev, { id: dept.id, name: dept.name, departmentCode: dept.departmentCode }]);
      setDeptName('');
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('admin.createDepartmentFailed'));
    } finally {
      setCreatingDepartment(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ADMIN_COLOR} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ADMIN_COLOR]} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.greeting} numberOfLines={1}>
              {t('admin.greeting', { name: user?.firstName || t('admin.fallbackName') })}
            </Text>
            <Text style={styles.subtitle}>
              {institution ? institution.name : t('admin.dashboard')}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.avatarPlaceholder}
            onPress={() => router.push('/(admin)/profile')}
            activeOpacity={0.7}
          >
            <Ionicons name="person" size={24} color={ADMIN_COLOR} />
          </TouchableOpacity>
        </View>

        {/* No Institution Setup */}
        {!institution && !showSetup && (
          <View style={styles.setupCard}>
            <Ionicons name="business-outline" size={48} color={ADMIN_COLOR} />
            <Text style={styles.setupTitle}>{t('admin.setupTitle')}</Text>
            <Text style={styles.setupText}>{t('admin.setupText')}</Text>
            <TouchableOpacity
              style={styles.setupButton}
              onPress={() => setShowSetup(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.setupButtonText}>{t('admin.createInstitution')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Institution Setup Form */}
        {!institution && showSetup && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>{t('admin.createInstitution')}</Text>

            <Text style={styles.formLabel}>{t('admin.institutionName')} *</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="business-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.inputText}
                  value={setupName}
                  onChangeText={setSetupName}
                  placeholder={t('admin.institutionNamePlaceholder')}
                  placeholderTextColor={colors.textDisabled}
                />
              </View>
            </View>

            <Text style={styles.formLabel}>{t('admin.institutionType')}</Text>
            <View style={styles.typeRow}>
              {(['university', 'vocational_school', 'other'] as const).map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.typeChip, setupType === option && styles.typeChipActive]}
                  onPress={() => setSetupType(option)}
                >
                  <Text style={[styles.typeChipText, setupType === option && styles.typeChipTextActive]}>
                    {option === 'university'
                      ? t('admin.typeUniversity')
                      : option === 'vocational_school'
                        ? t('admin.typeVocational')
                        : t('admin.typeOther')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formLabel}>{t('admin.country')} *</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="globe-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.inputText}
                  value={setupCountry}
                  onChangeText={setSetupCountry}
                  placeholder={t('admin.countryPlaceholder')}
                  placeholderTextColor={colors.textDisabled}
                />
              </View>
            </View>

            <Text style={styles.formLabel}>{t('common.allowedEmailDomains')}</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.inputText}
                  value={setupDomains}
                  onChangeText={setSetupDomains}
                  placeholder="btu.edu.tr, ogr.btu.edu.tr"
                  placeholderTextColor={colors.textDisabled}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
              </View>
            </View>
            <Text style={styles.formHint}>{t('common.allowedEmailDomainsHint')}</Text>

            <View style={styles.formActions}>
              <TouchableOpacity
                style={styles.cancelFormBtn}
                onPress={() => setShowSetup(false)}
              >
                <Text style={styles.cancelFormText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.createFormBtn}
                onPress={handleCreateInstitution}
                disabled={creatingInstitution}
              >
                {creatingInstitution ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.createFormText}>{t('admin.create')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Institution Code Card */}
        {institution && (
          <TouchableOpacity
            style={styles.codeCard}
            onPress={copyCode}
            activeOpacity={0.7}
          >
            <View style={styles.codeCardHeader}>
              <Ionicons name="key-outline" size={22} color={ADMIN_COLOR} />
              <Text style={styles.codeCardTitle}>{t('admin.institutionCode')}</Text>
              <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
            </View>
            <Text style={styles.codeText}>{institution.institutionCode}</Text>
            <Text style={styles.codeHint}>{t('admin.institutionCodeHint')}</Text>
          </TouchableOpacity>
        )}

        {/* Allowed E-mail Domains */}
        {institution && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{t('common.allowedEmailDomains')}</Text>
            </View>
            <Text style={styles.linkHint}>{t('common.allowedEmailDomainsHint')}</Text>

            <View style={styles.linkRow}>
              <TextInput
                style={styles.linkInput}
                value={domainsInput}
                onChangeText={setDomainsInput}
                placeholder="btu.edu.tr, ogr.btu.edu.tr"
                placeholderTextColor={colors.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <TouchableOpacity
                style={styles.linkBtn}
                disabled={savingDomains}
                onPress={handleSaveDomains}
                activeOpacity={0.7}
              >
                {savingDomains ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.linkBtnText}>{t('common.save')}</Text>
                )}
              </TouchableOpacity>
            </View>

            {(institution.allowedEmailDomains || []).length === 0 && (
              <Text style={styles.departmentHint}>
                {t('common.allowedEmailDomainsNone')}
              </Text>
            )}
          </View>
        )}

        {/* Department Codes */}
        {institution && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{t('admin.departments')}</Text>
            </View>
            <Text style={styles.linkHint}>{t('admin.departmentsHint')}</Text>

            <View style={styles.linkRow}>
              <TextInput
                style={styles.linkInput}
                value={deptName}
                onChangeText={setDeptName}
                placeholder={t('admin.departmentNamePlaceholder')}
                placeholderTextColor={colors.textDisabled}
              />
              <TouchableOpacity
                style={[styles.linkBtn, !deptName.trim() && { opacity: 0.5 }]}
                disabled={!deptName.trim() || creatingDepartment}
                onPress={handleCreateDepartment}
                activeOpacity={0.7}
              >
                {creatingDepartment ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.linkBtnText}>{t('admin.addDepartment')}</Text>
                )}
              </TouchableOpacity>
            </View>

            {departments.length > 0 && (
              <View style={{ marginTop: spacing.md }}>
                {departments.map((d) => (
                  <View key={d.id} style={styles.departmentRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.departmentName}>{d.name}</Text>
                      <Text style={styles.departmentHint}>
                        {t('admin.departmentCode', { code: d.departmentCode })}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={async () => {
                        await Clipboard.setStringAsync(d.departmentCode);
                        Alert.alert(t('admin.copied'), t('admin.departmentCodeCopied'));
                      }}
                    >
                      <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Stats Grid */}
        {institution && (
          <View style={styles.statsGrid}>
            <View style={styles.statsRow}>
              <StatCard
                title={t('admin.totalStudents')}
                value={stats.totalStudents}
                icon="people"
                color={ADMIN_COLOR}
              />
              <View style={{ width: spacing.sm }} />
              <StatCard
                title={t('admin.activeInternships')}
                value={stats.activeInternships}
                icon="briefcase"
                color={colors.success}
              />
            </View>
            <View style={styles.statsRow}>
              <StatCard
                title={t('admin.totalAdvisors')}
                value={stats.totalAdvisors}
                icon="school"
                color={colors.info}
              />
              <View style={{ width: spacing.sm }} />
              <StatCard
                title={t('admin.completionRate')}
                value={`${stats.completionRate}%`}
                icon="trending-up"
                color={colors.warning}
              />
            </View>
          </View>
        )}

        {/* Quick Actions */}
        {institution && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('admin.quickActions')}</Text>
            <View style={styles.quickActions}>
              <TouchableOpacity
                style={styles.actionCard}
                onPress={() => router.push('/(admin)/users')}
                activeOpacity={0.7}
              >
                <View style={[styles.actionIcon, { backgroundColor: ADMIN_COLOR + '15' }]}>
                  <Ionicons name="people" size={22} color={ADMIN_COLOR} />
                </View>
                <Text style={styles.actionLabel}>{t('admin.viewUsers')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionCard}
                onPress={() => router.push('/(admin)/reports')}
                activeOpacity={0.7}
              >
                <View style={[styles.actionIcon, { backgroundColor: colors.info + '15' }]}>
                  <Ionicons name="bar-chart" size={22} color={colors.info} />
                </View>
                <Text style={styles.actionLabel}>{t('admin.reports')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionCard}
                onPress={copyCode}
                activeOpacity={0.7}
              >
                <View style={[styles.actionIcon, { backgroundColor: colors.success + '15' }]}>
                  <Ionicons name="share-social" size={22} color={colors.success} />
                </View>
                <Text style={styles.actionLabel}>{t('admin.shareCode')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    backgroundColor: ADMIN_COLOR + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Setup
  setupCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  setupTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.md,
  },
  setupText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  setupButton: {
    backgroundColor: ADMIN_COLOR,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.md,
  },
  setupButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  // Form
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  formHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 16,
  },
  inputText: {
    fontSize: 15,
    color: colors.text,
    paddingVertical: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.background,
  },
  typeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  typeChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  typeChipActive: {
    borderColor: ADMIN_COLOR,
    backgroundColor: ADMIN_COLOR + '15',
  },
  typeChipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  typeChipTextActive: {
    color: ADMIN_COLOR,
    fontWeight: '600',
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  cancelFormBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cancelFormText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  createFormBtn: {
    backgroundColor: ADMIN_COLOR,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    minWidth: 80,
    alignItems: 'center',
  },
  createFormText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },

  // Code Card
  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: ADMIN_COLOR,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  codeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  codeCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  codeText: {
    fontSize: 32,
    fontWeight: '800',
    color: ADMIN_COLOR,
    letterSpacing: 4,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  codeHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  departmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  departmentName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  departmentHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Stats
  statsGrid: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
  },

  // Sections
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },

  // Card (departments)
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
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
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  linkHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  linkInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.background,
  },
  linkBtn: {
    backgroundColor: ADMIN_COLOR,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
  },
  linkBtnText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },

  // Quick Actions
  quickActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
});
