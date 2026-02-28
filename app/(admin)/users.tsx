import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAdminStore } from '@/store/adminStore';
import { adminService } from '@/services/admin';
import { colors, spacing, borderRadius } from '@/theme';
import type { MemberWithProfile } from '@/types/institution';

const ADMIN_COLOR = '#e65100';

type RoleKey = 'student' | 'mentor' | 'advisor' | 'admin';

const ROLE_CONFIG: Record<RoleKey, { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  student: { color: colors.primary, icon: 'school-outline', label: 'Student' },
  mentor: { color: colors.secondary, icon: 'briefcase-outline', label: 'Mentor' },
  advisor: { color: colors.info, icon: 'glasses-outline', label: 'Advisor' },
  admin: { color: ADMIN_COLOR, icon: 'shield-checkmark-outline', label: 'Admin' },
};

const SEGMENTS = [
  { key: 'all', label: 'All' },
  { key: 'student', label: 'Students' },
  { key: 'advisor', label: 'Advisors' },
  { key: 'mentor', label: 'Mentors' },
];

function formatJoinDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function UsersScreen() {
  const { institution } = useAdminStore();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [allMembers, setAllMembers] = useState<MemberWithProfile[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [segment, setSegment] = useState('all');
  const [departmentId, setDepartmentId] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!institution) {
      setLoading(false);
      return;
    }
    try {
      const [deptList, data] = await Promise.all([
        adminService.getDepartments(institution.id),
        adminService.getInstitutionMembers(institution.id),
      ]);
      setDepartments([
        { id: 'all', name: 'All Departments' },
        ...deptList.map((d) => ({ id: d.id, name: d.name })),
      ]);
      setAllMembers(data);
    } catch (err) {
      console.error('Users load error:', err);
    } finally {
      setLoading(false);
    }
  }, [institution]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // Client-side filtering
  const filtered = useMemo(() => {
    let result = allMembers;
    if (segment !== 'all') result = result.filter((m) => m.role === segment);
    if (departmentId !== 'all') result = result.filter((m) => m.departmentId === departmentId);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.firstName.toLowerCase().includes(q) ||
          m.lastName.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q),
      );
    }
    return result;
  }, [allMembers, segment, departmentId, search]);

  // Stats from full member list
  const stats = useMemo(() => ({
    students: allMembers.filter((m) => m.role === 'student').length,
    advisors: allMembers.filter((m) => m.role === 'advisor').length,
    mentors: allMembers.filter((m) => m.role === 'mentor').length,
  }), [allMembers]);

  const getDeptName = (deptId?: string) => {
    if (!deptId) return null;
    return departments.find((d) => d.id === deptId)?.name || null;
  };

  const getInitials = (first: string, last: string) =>
    `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();

  const handleRemove = (item: MemberWithProfile) => {
    Alert.alert(
      'Remove from Institution',
      `Remove ${item.firstName} ${item.lastName} from your institution? They will lose access to all institutional features.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(item.id);
            try {
              await adminService.removeFromInstitution(item.id);
              setAllMembers((prev) => prev.filter((m) => m.id !== item.id));
              setExpandedId(null);
            } catch {
              Alert.alert('Error', 'Failed to remove user. Please try again.');
            } finally {
              setRemoving(null);
            }
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: MemberWithProfile }) => {
    const cfg = ROLE_CONFIG[item.role as RoleKey] ?? { color: colors.textSecondary, icon: 'person-outline' as keyof typeof Ionicons.glyphMap, label: item.role };
    const deptName = getDeptName(item.departmentId);
    const isExpanded = expandedId === item.id;
    const isRemoving = removing === item.id;

    return (
      <TouchableOpacity
        style={[styles.memberCard, isExpanded && styles.memberCardExpanded]}
        onPress={() => setExpandedId(isExpanded ? null : item.id)}
        activeOpacity={0.85}
      >
        {/* Left role stripe */}
        <View style={[styles.roleStripe, { backgroundColor: cfg.color }]} />

        <View style={styles.cardContent}>
          {/* Main row */}
          <View style={styles.cardTopRow}>
            {/* Avatar */}
            <View style={[styles.memberAvatar, { backgroundColor: cfg.color + '18' }]}>
              <Text style={[styles.memberInitials, { color: cfg.color }]}>
                {getInitials(item.firstName, item.lastName)}
              </Text>
            </View>

            {/* Info */}
            <View style={styles.memberInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {item.firstName} {item.lastName}
                </Text>
                <View style={[styles.roleBadge, { backgroundColor: cfg.color + '15' }]}>
                  <Ionicons name={cfg.icon} size={11} color={cfg.color} />
                  <Text style={[styles.roleBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
              </View>

              <Text style={styles.memberEmail} numberOfLines={1}>{item.email}</Text>

              <View style={styles.metaRow}>
                {deptName && (
                  <>
                    <Ionicons name="business-outline" size={11} color={colors.textDisabled} />
                    <Text style={styles.metaText} numberOfLines={1}>{deptName}</Text>
                    <Text style={styles.metaDot}>·</Text>
                  </>
                )}
                <Ionicons name="calendar-outline" size={11} color={colors.textDisabled} />
                <Text style={styles.metaText}>Joined {formatJoinDate(item.createdAt)}</Text>
              </View>
            </View>

            {/* Chevron */}
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textDisabled}
            />
          </View>

          {/* Expanded actions */}
          {isExpanded && (
            <View style={styles.expandedSection}>
              <View style={styles.actionDivider} />
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => handleRemove(item)}
                disabled={isRemoving}
              >
                {isRemoving ? (
                  <ActivityIndicator size="small" color={colors.error} />
                ) : (
                  <>
                    <Ionicons name="person-remove-outline" size={15} color={colors.error} />
                    <Text style={styles.removeBtnText}>Remove from Institution</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => {
    if (loading) return <ActivityIndicator size="large" color={ADMIN_COLOR} style={{ marginTop: 60 }} />;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="people-outline" size={64} color={colors.textDisabled} />
        <Text style={styles.emptyTitle}>No Users Found</Text>
        <Text style={styles.emptyDesc}>
          {institution
            ? 'No members match your current filters.'
            : 'Create an institution first from the dashboard.'}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Users</Text>
        <Text style={styles.memberCount}>{allMembers.length} total</Text>
      </View>

      {/* Stats bar */}
      {!loading && allMembers.length > 0 && (
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <View style={[styles.statDot, { backgroundColor: colors.primary }]} />
            <Text style={styles.statNum}>{stats.students}</Text>
            <Text style={styles.statLabel}>Students</Text>
          </View>
          <View style={styles.statSep} />
          <View style={styles.statItem}>
            <View style={[styles.statDot, { backgroundColor: colors.info }]} />
            <Text style={styles.statNum}>{stats.advisors}</Text>
            <Text style={styles.statLabel}>Advisors</Text>
          </View>
          <View style={styles.statSep} />
          <View style={styles.statItem}>
            <View style={[styles.statDot, { backgroundColor: colors.secondary }]} />
            <Text style={styles.statNum}>{stats.mentors}</Text>
            <Text style={styles.statLabel}>Mentors</Text>
          </View>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or email..."
          placeholderTextColor={colors.textDisabled}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textDisabled} />
          </TouchableOpacity>
        )}
      </View>

      {/* Segment Tabs */}
      <View style={styles.segmentRow}>
        {SEGMENTS.map((seg) => {
          const count = seg.key === 'student' ? stats.students
            : seg.key === 'advisor' ? stats.advisors
            : seg.key === 'mentor' ? stats.mentors
            : null;
          return (
            <TouchableOpacity
              key={seg.key}
              style={[styles.segmentBtn, segment === seg.key && styles.segmentBtnActive]}
              onPress={() => setSegment(seg.key)}
            >
              <Text style={[styles.segmentText, segment === seg.key && styles.segmentTextActive]}>
                {seg.label}{count !== null ? ` (${count})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Department Filter */}
      {departments.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.departmentRow}>
          {departments.map((dept) => (
            <TouchableOpacity
              key={dept.id}
              style={[styles.departmentChip, departmentId === dept.id && styles.departmentChipActive]}
              onPress={() => setDepartmentId(dept.id)}
            >
              <Text style={[styles.departmentText, departmentId === dept.id && styles.departmentTextActive]}>
                {dept.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Result count when searching */}
      {(search.trim() || segment !== 'all' || departmentId !== 'all') && !loading && (
        <Text style={styles.resultCount}>{filtered.length} result{filtered.length !== 1 ? 's' : ''}</Text>
      )}

      {/* Members List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={filtered.length === 0 ? styles.emptyList : styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ADMIN_COLOR]} />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  memberCount: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },

  // Stats bar
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm + 2,
  },
  statItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statNum: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  statSep: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 2,
  },

  // Segments
  segmentRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentBtnActive: {
    backgroundColor: ADMIN_COLOR,
    borderColor: ADMIN_COLOR,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: '#fff',
    fontWeight: '600',
  },

  // Department chips
  departmentRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  departmentChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  departmentChipActive: {
    backgroundColor: ADMIN_COLOR,
    borderColor: ADMIN_COLOR,
  },
  departmentText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  departmentTextActive: {
    color: '#fff',
    fontWeight: '600',
  },

  resultCount: {
    fontSize: 12,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },

  // List
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },

  // Member Card
  memberCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
  },
  memberCardExpanded: {
    elevation: 3,
    shadowOpacity: 0.12,
  },
  roleStripe: {
    width: 4,
  },
  cardContent: {
    flex: 1,
    padding: spacing.md,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  memberAvatar: {
    width: 46,
    height: 46,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitials: {
    fontSize: 15,
    fontWeight: '700',
  },
  memberInfo: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  memberEmail: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  metaText: {
    fontSize: 11,
    color: colors.textDisabled,
    flexShrink: 1,
  },
  metaDot: {
    fontSize: 11,
    color: colors.textDisabled,
  },

  // Expanded actions
  expandedSection: {
    marginTop: spacing.sm,
  },
  actionDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.error + '12',
    alignSelf: 'flex-start',
  },
  removeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.error,
  },

  // Empty
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.md,
  },
  emptyDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 20,
  },
});
