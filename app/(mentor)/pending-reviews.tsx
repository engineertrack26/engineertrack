import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { taskContent } from '@/utils/taskContent';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { useMentorReviewStore } from '@/store/mentorReviewStore';
import { mentorReviewService } from '@/services/mentorReviews';
import { filterReviews, reviewSubmittedAt, PendingReview, ReviewSort } from '@/utils/mentorReviews';
import { LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { ReviewBack, ReviewHeader } from '@/components/mentor/ReviewUI';
import { colors, fonts } from '@/theme';

export default function PendingReviewsScreen() {
  const userId = useAuthStore(s => s.user?.id);
  return <ReviewQueue key={userId || 'signed-out'} userId={userId} />;
}

function ReviewQueue({ userId }: { userId?: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { assignmentId, studentId } = useLocalSearchParams<{ assignmentId?: string; studentId?: string }>();
  const [items, setItems] = useState<PendingReview[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => { setQuery(''); }, [studentId, assignmentId]);
  const [order, setOrder] = useState<ReviewSort>('oldest');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setRefreshing(true);
    setFailed(false);
    try {
      const result = userId ? await mentorReviewService.list() : { items: [], names: {} };
      if (request !== generation.current) return;
      setItems(result.items);
      setNames(result.names);
      if (userId) useMentorReviewStore.getState().setCount(userId, result.items.length);
    } catch {
      if (request === generation.current) {
        setFailed(true);
        if (userId) useMentorReviewStore.getState().invalidate(userId);
      }
    } finally {
      if (request === generation.current) { setLoading(false); setRefreshing(false); }
    }
  }, [userId]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { generation.current++; };
  }, [load]));
  const visible = useMemo(() => filterReviews(items, names, query, order, i18n.language, assignmentId, studentId),
    [items, names, query, order, i18n.language, assignmentId, studentId]);

  return <SafeAreaView style={ui.safe}>
    <FlatList data={loading ? [] : visible} keyExtractor={item => item.id}
      contentContainerStyle={[ui.content, { flexGrow: 1, gap: 0 }]} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing && !loading} onRefresh={load} />}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <ReviewBack label={t(studentId ? 'mentorStudents.detail' : 'studentFlow.home')} onPress={() => studentId
          ? router.replace({ pathname: '/(mentor)/student-list', params: { studentId } }) : router.replace('/(mentor)/dashboard')} />
        <ReviewHeader />
        {!loading && !failed && <Text style={ui.secondary}>{t('mentorFlow.pendingCount', { count: items.length })}</Text>}
        <TextInput value={query} onChangeText={setQuery} style={ui.input} placeholder={t('mentorFlow.search')}
          placeholderTextColor={colors.textSecondary} accessibilityLabel={t('mentorFlow.search')} returnKeyType="search" />
        <View><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 40 }}>
          <Text style={ui.section}>{t('mentorFlow.pending')}{!loading ? ' (' + visible.length + ')' : ''}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('mentorFlow.sort') + ': ' + t('mentorFlow.' + order)} hitSlop={8}
            onPress={() => setOrder(order === 'oldest' ? 'newest' : 'oldest')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 14, color: colors.ink, fontFamily: fonts.medium }}>{t('mentorFlow.' + order)}</Text>
            <Ionicons name="swap-vertical-outline" size={16} color={colors.ink} />
          </Pressable>
        </View>
        <View style={{ borderTopWidth: 1, borderColor: colors.ruleStrong }} /></View>
        {!!(assignmentId || studentId) && <View style={ui.note}>
          <Text style={ui.body}>{studentId ? t('mentorStudents.studentFilter', { name: names[studentId] || t('mentorFlow.unknownStudent') }) : t('mentorFlow.notificationFilter')}</Text>
          <Pressable accessibilityRole="button" onPress={() => { setQuery(''); router.setParams({ assignmentId: '', studentId: '' }); }}>
            <Text style={ui.link}>{t('mentorFlow.showAll')}</Text>
          </Pressable>
        </View>}
        {failed && <LoadFailedBanner onRetry={load} />}
        {loading && <ActivityIndicator size="large" color={colors.primary} />}
      </View>}
      ListEmptyComponent={!loading && !failed ? <View style={[ui.card, { marginTop: 16 }]}>
        <Text style={ui.body}>{t(query.trim() || assignmentId || studentId ? 'mentorFlow.noResults' : 'mentor.noPendingReviews')}</Text>
      </View> : null}
      renderItem={({ item }) => {
        const name = names[item.studentId] || t('mentorFlow.unknownStudent');
        const facts = [reviewSubmittedAt(item.submittedAt, i18n.language),
          t('mentorFlow.attachments', { photos: item.photos?.length || 0, documents: item.documents?.length || 0 })].join(' · ');
        return <Pressable accessibilityRole="button"
          accessibilityLabel={t('mentorFlow.inspect') + ': ' + name + ', ' + taskContent(item.assignment.title, i18n.language) + '. ' + facts}
          onPress={() => router.push({ pathname: '/(mentor)/review-detail', params: { id: item.id, studentId: studentId || '', assignmentId: assignmentId || '' } })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.divider }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ fontSize: 15, lineHeight: 21, fontFamily: fonts.medium, color: colors.text }}>{name}</Text>
            <Text style={{ fontSize: 15, lineHeight: 21, fontFamily: fonts.regular, color: colors.text }}>{taskContent(item.assignment.title, i18n.language)}</Text>
            <Text style={{ fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.textSecondary, fontVariant: ['tabular-nums'] }}>{facts}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.ink} />
        </Pressable>;
      }}
      ListFooterComponent={!loading && !failed && visible.length > 0 ? <Text style={[ui.secondary, { textAlign: 'center', marginTop: 16 }]}>{t(query.trim() || assignmentId || studentId ? 'mentorFlow.filteredEnd' : 'mentorFlow.listEnd')}</Text> : null}
    />
  </SafeAreaView>;
}
