import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { useStudentTasks } from '@/hooks/useStudentTasks';
import { useClosureStatus } from '@/hooks/useClosureStatus';
import { groupService } from '@/services/group';
import { StudentHeader, TaskCard, ui } from '@/components/student/StudentUI';
import { ClosureBanner, LoadFailedBanner } from '@/components/common';
import { TASK_STATES, TaskState, taskState, taskStateKey, filterTasks } from '@/utils/studentTasks';
import { colors } from '@/theme';

export default function MyTasksScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const userId = useAuthStore(s => s.user?.id);
  const { open } = useLocalSearchParams<{ open?: string }>();
  const { items, hasGroup, loading, refreshing, failed, reload } = useStudentTasks();
  const [groupId, setGroupId] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) { setGroupId(null); return; }
    let current = true;
    groupService.getMyGroup(userId).then(g => { if (current) setGroupId(g?.id ?? null); })
      .catch(error => console.warn('Group load for closure banner failed:', error instanceof Error ? error.message : error));
    return () => { current = false; };
  }, [userId]);
  const { status: closure } = useClosureStatus(userId, groupId);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TaskState | 'all'>('all');
  const [expanded, setExpanded] = useState({ waiting: false, done: false });
  // Preserve notification links created before the detail route existed.
  useEffect(() => {
    if (!open) return;
    router.setParams({ open: undefined });
    router.push({ pathname: '/(student)/task-detail', params: { id: open } });
  }, [open, router]);
  const visible = useMemo(() => filterTasks(items, filter, query, i18n.language), [items, filter, query, i18n.language]);
  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing && !loading} onRefresh={reload} />}>
      <StudentHeader title={t('student.myTasks')} />
      <ClosureBanner status={closure} onReport={() => router.push({ pathname: '/(student)/internship-report', params: { studentId: userId, groupId: groupId! } })} />
      <TextInput style={ui.input} value={query} onChangeText={setQuery} placeholder={t('studentFlow.searchTasks')}
        accessibilityLabel={t('studentFlow.searchTasks')} placeholderTextColor={colors.textSecondary} returnKeyType="search" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {(['all', ...TASK_STATES] as const).map(state => <Pressable key={state} accessibilityRole="button"
          accessibilityState={{ selected: filter === state }} onPress={() => setFilter(state)}
          style={{ minHeight: 48, justifyContent: 'center', borderRadius: 6, paddingHorizontal: 16, borderWidth: 1, borderColor: filter === state ? colors.ink : colors.divider, backgroundColor: filter === state ? colors.ink : colors.paper }}>
          <Text style={{ color: filter === state ? colors.textOnPrimary : colors.text, fontWeight: '600' }}>
            {t(state === 'all' ? 'studentFlow.all' : taskStateKey(state))} {!loading && '(' + (state === 'all' ? items.length : items.filter(a => taskState(a) === state).length) + ')'}
          </Text>
        </Pressable>)}
      </ScrollView>
      {failed && <LoadFailedBanner onRetry={reload} />}
      {loading ? <ActivityIndicator color={colors.primary} size="large" /> : <>
        {!failed && visible.length === 0 && <View style={ui.card}><Text style={ui.body}>
          {t(!hasGroup ? 'student.noGroupTasks' : items.length === 0 ? 'student.noTasks' : 'studentFlow.noResults')}
        </Text></View>}
        {TASK_STATES.map(state => {
          const tasks = visible.filter(a => taskState(a) === state);
          if (!tasks.length) return null;
          const collapsible = (state === 'waiting' || state === 'done') && filter === 'all' && !query.trim();
          const collapsed = collapsible && !expanded[state as 'waiting' | 'done'];
          return <View key={state} style={{ gap: 12 }}>
            {collapsible ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: !collapsed }}
              onPress={() => setExpanded(s => ({ ...s, [state]: !s[state as 'waiting' | 'done'] }))} style={{ minHeight: 48, justifyContent: 'center' }}>
              <Text style={ui.section}>{t(taskStateKey(state))} ({tasks.length}) {collapsed ? '⌄' : '⌃'}</Text>
            </Pressable> : <Text style={ui.section}>{t(taskStateKey(state))} ({tasks.length})</Text>}
            {!collapsed && tasks.map(task => <TaskCard key={task.id} task={task} />)}
          </View>;
        })}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
