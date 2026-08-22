import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '@/store/authStore';
import { useGroupStore } from '@/store/groupStore';
import { groupService } from '@/services/group';
import { colors, spacing, borderRadius } from '@/theme';
import type { InternshipGroup } from '@/types/group';

const ADVISOR_COLOR = colors.info;

export default function AdvisorGroupsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { groups, fetchGroups } = useGroupStore();

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [term, setTerm] = useState('');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      await fetchGroups(user.id);
      setCounts(await groupService.countMembersByGroup());
    } catch (err) {
      console.error('Groups load error:', err);
    }
  }, [user, fetchGroups]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  async function handleCreate() {
    if (!user) return;
    if (!name.trim()) {
      Alert.alert(t('common.error'), t('advisor.groupNameRequired'));
      return;
    }
    setCreating(true);
    try {
      await groupService.createGroup(user.id, {
        name: name.trim(),
        term: term.trim() || undefined,
      });
      setName('');
      setTerm('');
      await loadData();
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.unknown'));
    } finally {
      setCreating(false);
    }
  }

  function confirmArchive(group: InternshipGroup) {
    // Unarchiving is not destructive, so it needs no confirmation.
    if (group.isArchived) {
      groupService.setArchived(group.id, false).then(loadData).catch((err) =>
        Alert.alert(t('common.error'), err.message || t('errors.unknown')));
      return;
    }
    Alert.alert(
      t('advisor.archive'),
      t('advisor.archiveConfirm', { name: group.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('advisor.archive'),
          style: 'destructive',
          onPress: async () => {
            try {
              await groupService.setArchived(group.id, true);
              await loadData();
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('errors.unknown'));
            }
          },
        },
      ],
    );
  }

  // Archived groups sort last; within each half, newest first (the service
  // already returns created_at descending).
  const ordered = [...groups].sort(
    (a, b) => Number(a.isArchived) - Number(b.isArchived),
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ADVISOR_COLOR]} />
        }
      >
        <Text style={styles.screenTitle}>{t('advisor.myGroups')}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>{t('advisor.groupName')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('advisor.groupNamePlaceholder')}
            placeholderTextColor={colors.textDisabled}
          />
          <Text style={styles.label}>{t('advisor.groupTerm')}</Text>
          <TextInput
            style={styles.input}
            value={term}
            onChangeText={setTerm}
            placeholder={t('advisor.groupTermPlaceholder')}
            placeholderTextColor={colors.textDisabled}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, !name.trim() && { opacity: 0.5 }]}
            disabled={!name.trim() || creating}
            onPress={handleCreate}
            activeOpacity={0.7}
          >
            {creating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{t('advisor.createGroup')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {ordered.length === 0 && <Text style={styles.empty}>{t('advisor.noGroups')}</Text>}

        {ordered.map((g) => (
          <View key={g.id} style={[styles.card, g.isArchived && { opacity: 0.6 }]}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{g.name}</Text>
              {g.isArchived && <Text style={styles.badge}>{t('advisor.archived')}</Text>}
            </View>
            {!!g.term && <Text style={styles.subtle}>{g.term}</Text>}
            <Text style={styles.subtle}>
              {t('advisor.memberCount', { count: counts[g.id] || 0 })}
            </Text>

            <TouchableOpacity
              style={styles.codeRow}
              activeOpacity={0.7}
              onPress={async () => {
                await Clipboard.setStringAsync(g.joinCode);
                Alert.alert(t('advisor.joinCode'), t('advisor.joinCodeCopied'));
              }}
            >
              <Text style={styles.codeText}>{g.joinCode}</Text>
              <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.subtle}>{t('advisor.joinCodeHint')}</Text>

            <View style={styles.actions}>
              <TouchableOpacity
                onPress={() => router.push(`/(advisor)/student-monitor?groupId=${g.id}`)}
                activeOpacity={0.7}
              >
                <Text style={styles.action}>{t('advisor.viewStudents')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push(`/(advisor)/group-competencies?groupId=${g.id}`)}
                activeOpacity={0.7}
              >
                <Text style={styles.action}>{t('advisor.competencies')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push(`/(advisor)/group-assignments?groupId=${g.id}`)}
                activeOpacity={0.7}
              >
                <Text style={styles.action}>{t('advisor.assignments')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmArchive(g)} activeOpacity={0.7}>
                <Text style={styles.action}>
                  {g.isArchived ? t('advisor.unarchive') : t('advisor.archive')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

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
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  badge: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    backgroundColor: colors.divider,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  subtle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Create-group form
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
    marginTop: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.background,
  },
  primaryBtn: {
    backgroundColor: ADVISOR_COLOR,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  // Join code
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    marginTop: spacing.sm,
    backgroundColor: colors.background,
  },
  codeText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 2,
  },

  // Card actions
  //
  // flexWrap is load-bearing, not tidiness: React Native defaults flexShrink to
  // 0, so four labels at gap spacing.lg overflow a 360dp screen rather than
  // shrink, and with justifyContent 'flex-end' it is the LEFTMOST label that
  // leaves the screen. rowGap keeps a wrapped second line off the first.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    rowGap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  action: {
    fontSize: 14,
    fontWeight: '600',
    color: ADVISOR_COLOR,
  },

  // Empty
  empty: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
});
