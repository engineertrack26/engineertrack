import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { mentorService } from '@/services/mentor';
import { colors } from '@/theme';
import { BackButton, LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { mapTaskFeedback, mapLegacyFeedback, filterFeedback, feedbackDate, feedbackOutcome,
  type FeedbackItem, type FeedbackFilter } from '@/utils/mentorFeedbackView';

export default function FeedbackScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  return userId ? <FeedbackContent key={userId} mentorId={userId} /> : null;
}

function FeedbackContent({ mentorId }: { mentorId: string }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'task' | 'legacy'>('task');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FeedbackFilter>('all');
  const [taskItems, setTaskItems] = useState<FeedbackItem[] | null>(null);
  const [legacyItems, setLegacyItems] = useState<FeedbackItem[] | null>(null);
  const [failed, setFailed] = useState({ task: false, legacy: false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    const [tasks, legacy] = await Promise.allSettled([
      mentorService.getFeedbackHistory(mentorId), mentorService.getLegacyFeedbackHistory(mentorId),
    ]);
    if (request !== sequence.current || useAuthStore.getState().user?.id !== mentorId) return;
    setTaskItems(tasks.status === 'fulfilled' ? tasks.value.map((row) => mapTaskFeedback(row as unknown as Record<string, unknown>)) : null);
    setLegacyItems(legacy.status === 'fulfilled' ? (legacy.value || []).map((row) => mapLegacyFeedback(row as unknown as Record<string, unknown>)) : null);
    setFailed({ task: tasks.status === 'rejected', legacy: legacy.status === 'rejected' });
    setLoading(false); setRefreshing(false);
  }, [mentorId]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { sequence.current += 1; };
  }, [load]));
  const items = tab === 'task' ? taskItems : legacyItems;
  const visible = filterFeedback(items || [], search, filter, i18n.language);
  const filtered = !!search.trim() || filter !== 'all';
  const formatDate = (value: string) => feedbackDate(value, i18n.language) || t('feedbackUi.dateUnknown');

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <FlatList data={visible} keyExtractor={(item) => item.kind + ':' + item.id}
      contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} colors={[colors.primaryDark]}
        onRefresh={() => { setRefreshing(true); void load(); }} />}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <BackButton href="/(mentor)/dashboard" />
        <Text style={ui.title} accessibilityRole="header">{t('mentorHome.history')}</Text>
        <Text style={ui.secondary}>{t('feedbackUi.intro')}</Text>
        <View style={styles.wrap} accessibilityRole="tablist">
          {(['task', 'legacy'] as const).map((value) => <TouchableOpacity key={value}
            accessibilityRole="tab" accessibilityState={{ selected: tab === value }}
            style={[styles.chip, tab === value && styles.selected]}
            onPress={() => { setTab(value); setSearch(''); setFilter('all'); }}>
            <Text style={styles.link}>{t(value === 'task' ? 'mentor.taskFeedback' : 'mentor.earlierFeedback')}
              {' '}({(value === 'task' ? taskItems : legacyItems)?.length ?? '—'})</Text>
          </TouchableOpacity>)}
        </View>
        {tab === 'legacy' && <View style={ui.note}><Text style={ui.secondary}>{t('mentor.earlierFeedbackHint')}</Text></View>}
        {failed[tab] && <LoadFailedBanner onRetry={() => void load()} />}
        <TextInput style={ui.input} value={search} onChangeText={setSearch} autoCorrect={false}
          accessibilityLabel={t('feedbackUi.search')} placeholder={t('feedbackUi.search')} placeholderTextColor={colors.textSecondary} />
        <View style={styles.wrap}>
          {(['all', 'approved', 'revision'] as const).map((value) => <TouchableOpacity key={value}
            accessibilityRole="button" accessibilityState={{ selected: filter === value }}
            style={[styles.chip, filter === value && styles.selected]} onPress={() => setFilter(value)}>
            <Text style={styles.link}>{t(value === 'all' ? 'feedbackUi.all' :
              value === 'approved' ? 'mentor.statusApproved' : 'mentor.statusRevision')}</Text>
          </TouchableOpacity>)}
        </View>
        {items !== null && <Text style={ui.secondary} accessibilityLiveRegion="polite">
          {t('feedbackUi.results', { shown: visible.length, total: items.length })}
        </Text>}
        {filtered && <TouchableOpacity accessibilityRole="button" onPress={() => { setSearch(''); setFilter('all'); }}>
          <Text style={ui.link}>{t('feedbackUi.clear')}</Text>
        </TouchableOpacity>}
      </View>}
      ListEmptyComponent={loading ? <ActivityIndicator size="large" color={colors.primaryDark} /> :
        !failed[tab] && items !== null ? <View style={ui.card}>
          <Ionicons name="chatbubble-outline" size={32} color={colors.primaryDark} />
          <Text style={ui.section}>{t(filtered ? 'feedbackUi.noMatches' : 'mentor.noFeedbackYet')}</Text>
          <Text style={ui.secondary}>{t(filtered ? 'feedbackUi.searchHint' : 'mentor.noFeedbackYetDesc')}</Text>
        </View> : null}
      renderItem={({ item }) => {
        const outcome = feedbackOutcome(item);
        const color = outcome === 'approved' ? '#21613e' : outcome === 'revision' ? '#854f0b' : colors.textSecondary;
        const note = item.kind === 'task' ? item.note : item.comments;
        return <View style={ui.card}>
          <View style={ui.header}>
            <View style={styles.avatar} accessible={false}><Text style={styles.initials}>
              {(item.studentFirstName[0] || '') + (item.studentLastName[0] || '') || '?'}
            </Text></View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={ui.label}>{item.studentFirstName} {item.studentLastName}</Text>
              <Text style={ui.secondary}>{t('feedbackUi.reviewed', { date: formatDate(item.kind === 'task' ? item.reviewedAt : item.createdAt) })}</Text>
            </View>
          </View>
          <View style={[styles.badge, { backgroundColor: outcome === 'approved' ? '#eaf5ee' : '#fff5e5' }]}>
            <Ionicons name={outcome === 'approved' ? 'checkmark-circle-outline' : outcome === 'revision' ? 'refresh-outline' : 'time-outline'}
              size={20} color={color} />
            <Text style={[ui.label, { color, flexShrink: 1 }]}>{t(outcome === 'approved' ? 'mentor.statusApproved' :
              outcome === 'revision' ? 'mentor.statusRevision' : 'feedbackUi.other')}</Text>
          </View>
          <Text style={ui.cardTitle}>{item.kind === 'task' ? item.assignmentTitle : item.logTitle}</Text>
          {item.kind === 'legacy' && <>
            <Text style={ui.secondary}>{t('feedbackUi.logDate', { date: formatDate(item.logDate) })}</Text>
            <View style={styles.wrap} accessible accessibilityLabel={t('feedbackUi.rating', { rating: item.rating })}>
              {[1, 2, 3, 4, 5].map((star) => <Ionicons key={star} name={star <= item.rating ? 'star' : 'star-outline'} size={20} color="#805400" />)}
              <Text style={ui.label}>{item.rating}/5</Text>
            </View>
          </>}
          <View style={styles.note}>
            <Text style={ui.label}>{t('feedbackUi.note')}</Text>
            <Text selectable style={ui.body}>{note || t('feedbackUi.noNote')}</Text>
          </View>
          {item.kind === 'legacy' && !item.isApproved && !!item.revisionNotes &&
            <View style={ui.note}><Text style={ui.label}>{t('feedbackUi.revisionNotes')}</Text>
              <Text selectable style={ui.body}>{item.revisionNotes}</Text></View>}
        </View>;
      }} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.divider, justifyContent: 'center', maxWidth: '100%' },
  selected: { backgroundColor: '#eaf1fb', borderColor: colors.primaryDark },
  link: { color: colors.primaryDark, fontSize: 16, fontWeight: '600' },
  avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#eaf1fb', alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 18, color: colors.primaryDark, fontWeight: '700', textTransform: 'uppercase' },
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', padding: 10, gap: 8, borderRadius: 12, maxWidth: '100%' },
  note: { padding: 16, borderRadius: 12, backgroundColor: colors.background, gap: 8 },
});
