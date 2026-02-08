import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '@/store/authStore';
import { useAdminStore } from '@/store/adminStore';
import { adminService } from '@/services/admin';
import { StatCard } from '@/components/common';
import { colors, spacing, borderRadius } from '@/theme';
import type { InstitutionType } from '@/types/institution';

const ADMIN_COLOR = '#e65100';

export default function AdminDashboard() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { institution, stats, setInstitution } = useAdminStore();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupType, setSetupType] = useState<InstitutionType>('university');
  const [setupCountry, setSetupCountry] = useState('');
  const [creatingInstitution, setCreatingInstitution] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const inst = await adminService.getInstitution(user.id);
      setInstitution(inst);
      if (inst) {
        const s = await adminService.getDashboardStats(inst.id);
        useAdminStore.setState({ stats: s });
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
    Alert.alert('Copied!', 'Institution code copied to clipboard.');
  };

  const handleCreateInstitution = async () => {
    if (!user) return;
    if (!setupName.trim()) {
      Alert.alert('Error', 'Institution name is required.');
      return;
    }
    if (!setupCountry.trim()) {
      Alert.alert('Error', 'Country is required.');
      return;
    }
    setCreatingInstitution(true);
    try {
      const inst = await adminService.createInstitution(user.id, {
        name: setupName.trim(),
        type: setupType,
        country: setupCountry.trim(),
      });
      setInstitution(inst);
      setShowSetup(false);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create institution.');
    } finally {
      setCreatingInstitution(false);
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
              Hello, {user?.firstName || 'Admin'}
            </Text>
            <Text style={styles.subtitle}>
              {institution ? institution.name : 'Admin Dashboard'}
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
            <Text style={styles.setupTitle}>Set Up Your Institution</Text>
            <Text style={styles.setupText}>
              Create your institution to generate a code for advisors and students.
            </Text>
            <TouchableOpacity
              style={styles.setupButton}
              onPress={() => setShowSetup(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.setupButtonText}>Create Institution</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Institution Setup Form */}
        {!institution && showSetup && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Create Institution</Text>

            <Text style={styles.formLabel}>Institution Name *</Text>
            <View style={styles.formInput}>
              <Ionicons name="business-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.formInputText}>
                {/* Using Text as placeholder since we don't have Input imported */}
              </Text>
            </View>
            {/* Simple inline TextInput */}
            <View style={styles.inputWrapper}>
              <Ionicons name="business-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <TextInputField
                  value={setupName}
                  onChangeText={setSetupName}
                  placeholder="e.g. Istanbul Technical University"
                />
              </View>
            </View>

            <Text style={styles.formLabel}>Type</Text>
            <View style={styles.typeRow}>
              {(['university', 'vocational_school', 'other'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, setupType === t && styles.typeChipActive]}
                  onPress={() => setSetupType(t)}
                >
                  <Text style={[styles.typeChipText, setupType === t && styles.typeChipTextActive]}>
                    {t === 'university' ? 'University' : t === 'vocational_school' ? 'Vocational' : 'Other'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.formLabel}>Country *</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="globe-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <TextInputField
                  value={setupCountry}
                  onChangeText={setSetupCountry}
                  placeholder="e.g. Turkey"
                />
              </View>
            </View>

            <View style={styles.formActions}>
              <TouchableOpacity
                style={styles.cancelFormBtn}
                onPress={() => setShowSetup(false)}
              >
                <Text style={styles.cancelFormText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.createFormBtn}
                onPress={handleCreateInstitution}
                disabled={creatingInstitution}
              >
                {creatingInstitution ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.createFormText}>Create</Text>
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
              <Text style={styles.codeCardTitle}>Institution Code</Text>
              <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
            </View>
            <Text style={styles.codeText}>{institution.institutionCode}</Text>
            <Text style={styles.codeHint}>
              Share this code with advisors and students to join your institution
            </Text>
          </TouchableOpacity>
        )}

        {/* Stats Grid */}
        {institution && (
          <View style={styles.statsGrid}>
            <View style={styles.statsRow}>
              <StatCard
                title="Total Students"
                value={stats.totalStudents}
                icon="people"
                color={ADMIN_COLOR}
              />
              <View style={{ width: spacing.sm }} />
              <StatCard
                title="Active Internships"
                value={stats.activeInternships}
                icon="briefcase"
                color={colors.success}
              />
            </View>
            <View style={styles.statsRow}>
              <StatCard
                title="Total Advisors"
                value={stats.totalAdvisors}
                icon="school"
                color={colors.info}
              />
              <View style={{ width: spacing.sm }} />
              <StatCard
                title="Completion Rate"
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
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.quickActions}>
              <TouchableOpacity
                style={styles.actionCard}
                onPress={() => router.push('/(admin)/users')}
                activeOpacity={0.7}
              >
                <View style={[styles.actionIcon, { backgroundColor: ADMIN_COLOR + '15' }]}>
                  <Ionicons name="people" size={22} color={ADMIN_COLOR} />
                </View>
                <Text style={styles.actionLabel}>View Users</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionCard}
                onPress={() => router.push('/(admin)/reports')}
                activeOpacity={0.7}
              >
                <View style={[styles.actionIcon, { backgroundColor: colors.info + '15' }]}>
                  <Ionicons name="bar-chart" size={22} color={colors.info} />
                </View>
                <Text style={styles.actionLabel}>Reports</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionCard}
                onPress={copyCode}
                activeOpacity={0.7}
              >
                <View style={[styles.actionIcon, { backgroundColor: colors.success + '15' }]}>
                  <Ionicons name="share-social" size={22} color={colors.success} />
                </View>
                <Text style={styles.actionLabel}>Share Code</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// Simple inline TextInput component to avoid importing Input
function TextInputField({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}) {
  const { TextInput } = require('react-native');
  return (
    <TextInput
      style={{
        fontSize: 15,
        color: colors.text,
        paddingVertical: 4,
      }}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textDisabled}
    />
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
  formInput: {
    display: 'none',
  },
  formInputText: {
    display: 'none',
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
