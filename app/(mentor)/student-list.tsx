import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { mentorStudentService } from '@/services/mentorStudents';
import { filterMentorStudents, MentorStudent } from '@/utils/mentorStudents';
import { LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { ReviewHeader } from '@/components/mentor/ReviewUI';
import { StudentDates, StudentIdentity } from '@/components/mentor/StudentIdentity';
import { StudentDetail } from '@/components/mentor/StudentDetail';
import { LinkStudentSheet } from '@/components/mentor/LinkStudentSheet';
import { colors } from '@/theme';

export default function StudentListScreen() {
  const userId = useAuthStore(s => s.user?.id);
  return userId ? <Students key={userId} userId={userId} /> : null;
}

function Students({ userId }: { userId: string }) {
  const router = useRouter();
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const [query, setQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const back = useCallback(() => router.setParams({ studentId: '' }), [router]);
  if (studentId) return <StudentDetail key={studentId} userId={userId} studentId={studentId} onBack={back} />;
  return <StudentList userId={userId} query={query} setQuery={setQuery} pendingOnly={pendingOnly} setPendingOnly={setPendingOnly} />;
}

function StudentList({ userId, query, setQuery, pendingOnly, setPendingOnly }: {
  userId: string; query: string; setQuery: (value: string) => void;
  pendingOnly: boolean; setPendingOnly: (value: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [students, setStudents] = useState<MentorStudent[]>([]);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [countsFailed, setCountsFailed] = useState(false);
  const [linking, setLinking] = useState(false);
  const [success, setSuccess] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    const current = () => request === generation.current && useAuthStore.getState().user?.id === userId;
    setRefreshing(true); setFailed(false); setCountsFailed(false);
    try {
      const result = await mentorStudentService.students(userId);
      if (!current()) return;
      setStudents(result); setCounts(null);
      try {
        const pending = await mentorStudentService.pendingCounts(result.map(item => item.id));
        if (current()) setCounts(pending);
      } catch { if (current()) setCountsFailed(true); }
    } catch { if (current()) { setFailed(true); setStudents([]); setCounts(null); } }
    finally { if (current()) { setLoading(false); setRefreshing(false); } }
  }, [userId]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; }; }, [load]));
  const visible = useMemo(() => filterMentorStudents(students, query, pendingOnly, counts, i18n.language),
    [students, query, pendingOnly, counts, i18n.language]);
  const pendingStudents = students.filter(student => (counts?.[student.id] || 0) > 0).length;

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <View style={[ui.content, { paddingTop: 12, paddingBottom: 12 }]}><ReviewHeader brand /></View>
    <FlatList data={loading || failed ? [] : visible} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled"
      contentContainerStyle={[ui.content, { flexGrow: 1 }]}
      refreshControl={<RefreshControl refreshing={refreshing && !loading} onRefresh={load} />}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <Text accessibilityRole="header" style={ui.title}>{t('mentorHome.students')}</Text>
        {!loading && !failed && <Text style={ui.secondary}>{t('mentorStudents.count', { count: students.length })}</Text>}
        <View style={[ui.input, ui.header, { paddingVertical: 0 }]}>
          <Ionicons name="search-outline" size={22} color={colors.textSecondary} />
          <TextInput value={query} onChangeText={setQuery} placeholder={t('mentorStudents.search')}
            accessibilityLabel={t('mentorStudents.search')} placeholderTextColor={colors.textSecondary}
            style={{ flex: 1, fontSize: 16, minHeight: 52, color: colors.text }} returnKeyType="search" />
          {!!query && <Pressable accessibilityRole="button" accessibilityLabel={t('mentorStudents.clearSearch')}
            onPress={() => setQuery('')} style={ui.iconButton}><Ionicons name="close" size={22} color={colors.textSecondary} /></Pressable>}
        </View>
        <Pressable accessibilityRole="button" style={[ui.primary, { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.ink }]}
          onPress={() => { setSuccess(''); setLinking(true); }}>
          <Ionicons name="add" size={22} color={colors.primaryDark} />
          <Text style={[ui.primaryText, { color: colors.primaryDark }]}>{t('mentorStudents.link')}</Text>
        </Pressable>
        {!!success && <Text accessibilityLiveRegion="polite" style={ui.body}>{success}</Text>}
        <View style={[ui.header, { flexWrap: 'wrap' }]}>
          {[false, true].map(value => <Pressable key={String(value)} accessibilityRole="button"
            accessibilityState={{ selected: pendingOnly === value, disabled: value && counts === null }}
            disabled={value && counts === null} onPress={() => setPendingOnly(value)}
            style={[ui.badge, { minHeight: 48, justifyContent: 'center', backgroundColor: pendingOnly === value ? colors.inkBg : colors.paper, borderWidth: 1, borderColor: pendingOnly === value ? colors.ink : colors.divider }]}>
            <Text style={[ui.secondary, pendingOnly === value && { color: colors.primaryDark, fontWeight: '600' }]}>
              {value ? t('mentorStudents.pendingFilter') : t('mentorStudents.all')} ({value ? counts === null ? '—' : pendingStudents : loading || failed ? '—' : students.length})
            </Text>
          </Pressable>)}
        </View>
        {(failed || countsFailed) && <LoadFailedBanner onRetry={load} />}
        {loading && <ActivityIndicator color={colors.primaryDark} />}
      </View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button"
        accessibilityLabel={t('mentorStudents.viewDetail') + ': ' + (item.name || t('mentorFlow.unknownStudent'))}
        onPress={() => router.setParams({ studentId: item.id })} style={ui.card}>
        <StudentIdentity student={item} />
        <StudentDates student={item} />
        <Text style={[ui.badge, { color: counts && counts[item.id] > 0 ? colors.warnText : colors.textSecondary,
          backgroundColor: counts && counts[item.id] > 0 ? colors.warnBg : colors.page }]}>
          {counts === null ? t('mentorStudents.countUnknown') : counts[item.id] > 0 ? t('mentorStudents.waiting', { count: counts[item.id] }) : t('mentorStudents.noPending')}
        </Text>
        <View style={[ui.header, { borderTopWidth: 1, borderColor: colors.divider, minHeight: 48 }]}>
          <Text style={[ui.link, { flexShrink: 1 }]}>{t('mentorStudents.viewDetail')}</Text>
          <Ionicons name="arrow-forward" size={20} color={colors.primaryDark} />
        </View>
      </Pressable>}
      ListEmptyComponent={!loading && !failed && !(pendingOnly && counts === null) ? <View style={ui.card}>
        <Text style={ui.section}>{t(students.length ? 'mentorStudents.noResults' : 'mentorStudents.empty')}</Text>
        <Text style={ui.body}>{t(students.length ? 'mentorStudents.searchHint' : 'mentorStudents.emptyHint')}</Text>
      </View> : null}
      ListFooterComponent={!loading && !failed && visible.length > 0 ? <Text style={ui.secondary}>{t('mentorStudents.listHint')}</Text> : null}
    />
    {linking && <LinkStudentSheet userId={userId} onClose={() => setLinking(false)}
      onLinked={name => { setLinking(false); setSuccess(t('mentorStudents.linked', { name })); void load(); }} />}
  </SafeAreaView>;
}
