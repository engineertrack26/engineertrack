import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { useAdminStore } from '@/store/adminStore';
import { adminService } from '@/services/admin';
import { colors, spacing, borderRadius } from '@/theme';
import type { MemberWithProfile } from '@/types/institution';

const ADMIN_COLOR = '#e65100';

const SEGMENTS = [
  { key: 'all', label: 'All' },
  { key: 'student', label: 'Students' },
  { key: 'advisor', label: 'Advisors' },
  { key: 'mentor', label: 'Mentors' },
];

const ROLE_COLORS: Record<string, string> = {
  student: colors.primary,
  mentor: colors.secondary,
  advisor: colors.info,
  admin: ADMIN_COLOR,
};

export default function UsersScreen() {
  const user = useAuthStore((s) => s.user);
  const { institution } = useAdminStore();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [segment, setSegment] = useState('all');
  const [search, setSearch] = useState('');

  const loadData = useCallback(async () => {
    if (!institution) {
      setLoading(false);
      return;
    }
    try {
      const data = await adminService.getInstitutionMembers(institution.id, {
        role: segment !== 'all' ? segment : undefined,
        search: search.trim() || undefined,
      });
      setMembers(data);
    } catch (err) {
      console.error('Users load error:', err);
    } finally {
      setLoading(false);
    }
  }, [institution, segment, search]);

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

  const getInitials = (first: string, last: string) =>
    `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();

  const renderItem = ({ item }: { item: MemberWithProfile }) => {
    const roleColor = ROLE_COLORS[item.role] || colors.textSecondary;
    return (
      <View style={styles.memberCard}>
        <View style={[styles.memberAvatar, { backgroundColor: roleColor + '18' }]}>
          <Text style={[styles.memberInitials, { color: roleColor }]}>
            {getInitials(item.firstName, item.lastName)}
          </Text>
        </View>
        <View style={styles.memberInfo}>
          <Text style={styles.memberName} numberOfLines={1}>
            {item.firstName} {item.lastName}
          </Text>
          <Text style={styles.memberEmail} numberOfLines={1}>{item.email}</Text>
        </View>
        <View style={[styles.roleBadge, { backgroundColor: roleColor + '15' }]}>
          <Text style={[styles.roleBadgeText, { color: roleColor }]}>
            {item.role.charAt(0).toUpperCase() + item.role.slice(1)}
          </Text>
        </View>
      </View>
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
            ? 'No members have joined your institution yet. Share your institution code.'
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
        <Text style={styles.memberCount}>
          {members.length} member{members.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or email..."
          placeholderTextColor={colors.textDisabled}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={loadData}
          returnKeyType="search"
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => { setSearch(''); }} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textDisabled} />
          </TouchableOpacity>
        )}
      </View>

      {/* Segment Tabs */}
      <View style={styles.segmentRow}>
        {SEGMENTS.map((seg) => (
          <TouchableOpacity
            key={seg.key}
            style={[styles.segmentBtn, segment === seg.key && styles.segmentBtnActive]}
            onPress={() => setSegment(seg.key)}
          >
            <Text style={[styles.segmentText, segment === seg.key && styles.segmentTextActive]}>
              {seg.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Members List */}
      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={members.length === 0 ? styles.emptyList : styles.list}
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
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: '#fff',
    fontWeight: '600',
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
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  memberInitials: {
    fontSize: 15,
    fontWeight: '700',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  memberEmail: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  roleBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    marginLeft: spacing.sm,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
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
