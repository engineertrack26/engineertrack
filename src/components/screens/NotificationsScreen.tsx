import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router, useFocusEffect } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { routeForNotification } from '@/utils/notificationRoutes';
import { notificationTimeAgo } from '@/utils/notificationTime';
import { BackButton } from '@/components/common';
import { useNotificationStore } from '@/store/notificationStore';
import { AppNotification } from '@/types/notification';
import type { UserRole } from '@/types/user';
import { colors, fonts } from '@/theme';

const ICON_MAP: Record<AppNotification['type'], { name: string; color: string }> = {
  log_approved: { name: 'checkmark-circle', color: colors.success },
  log_revision_requested: { name: 'alert-circle', color: colors.error },
  log_sent_back: { name: 'arrow-undo', color: colors.warning },
  new_feedback: { name: 'chatbubble-ellipses', color: colors.info },
  badge_earned: { name: 'trophy', color: colors.gamification.badge },
  level_up: { name: 'arrow-up-circle', color: colors.gamification.levelUp },
  poll_available: { name: 'clipboard', color: colors.primary },
  general: { name: 'notifications', color: colors.primary },
  task_assigned: { name: 'clipboard-outline', color: colors.info },
  task_submitted: { name: 'paper-plane', color: colors.primary },
  task_approved: { name: 'checkmark-circle', color: colors.success },
  task_revision_requested: { name: 'alert-circle', color: colors.error },
  feed_announcement: { name: 'megaphone', color: colors.primary },
  feed_poll: { name: 'bar-chart', color: colors.primary },
  feed_comment: { name: 'chatbubble-ellipses', color: colors.info },
  feed_task_post: { name: 'clipboard-outline', color: colors.info },
  direct_message: { name: 'chatbubble-ellipses-outline', color: colors.primary },
  internship_log_submitted: { name: 'book-outline', color: colors.primary },
  internship_attendance: { name: 'calendar-outline', color: colors.success },
  internship_correction: { name: 'alert-circle-outline', color: colors.error },
  internship_feedback: { name: 'chatbox-ellipses-outline', color: colors.info },
  internship_closed: { name: 'lock-closed-outline', color: colors.warning },
  internship_reopened: { name: 'lock-open-outline', color: colors.warning },
};

interface NotificationsScreenProps {
  /** Decides where a tapped notification goes; see routeForNotification. */
  role: UserRole;
}

export function NotificationsScreen({ role }: NotificationsScreenProps) {
  const userId = useAuthStore((s) => s.user?.id);
  return <NotificationsContent key={userId ?? 'signed-out'} role={role} userId={userId} />;
}

function NotificationsContent({ role, userId }: NotificationsScreenProps & { userId?: string }) {
  const { t, i18n } = useTranslation();
  const { notifications, unreadCount, isLoading, isLoadingMore, fetchNotifications,
    fetchMore, markAsRead, markAllAsRead } = useNotificationStore();
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [notice, setNotice] = useState<'success' | 'error' | null>(null);
  const busy = useRef(false);
  const focusVersion = useRef(0);
  const loadSequence = useRef(0);
  const isCurrentUser = () => useAuthStore.getState().user?.id === userId;

  const loadData = useCallback(async () => {
    if (!userId) return;
    const request = ++loadSequence.current;
    const ok = await fetchNotifications(userId);
    if (useAuthStore.getState().user?.id !== userId || request !== loadSequence.current) return;
    setLoadFailed(!ok);
    if (ok) { setLoaded(true); setMoreFailed(false); }
  }, [userId, fetchNotifications]);

  useFocusEffect(useCallback(() => {
    focusVersion.current += 1;
    void loadData();
    return () => {
      focusVersion.current += 1;
      loadSequence.current += 1;
    };
  }, [loadData]));

  const onRefresh = async () => {
    if (busy.current || isLoading || isLoadingMore) return;
    setRefreshing(true);
    setNotice(null);
    try { await loadData(); } finally { setRefreshing(false); }
  };
  const loadMore = async (retry = false) => {
    if (!userId || loadFailed || (moreFailed && !retry) || busy.current) return;
    const ok = await fetchMore(userId);
    if (isCurrentUser()) setMoreFailed(!ok);
  };
  const handleMarkAllRead = async () => {
    if (!userId || !unreadCount || busy.current || isLoading || isLoadingMore) return;
    busy.current = true;
    setMarkingAll(true);
    setNotice(null);
    try {
      const ok = await markAllAsRead(userId);
      if (isCurrentUser()) setNotice(ok ? 'success' : 'error');
    } finally { busy.current = false; setMarkingAll(false); }
  };
  const handlePress = async (item: AppNotification) => {
    if (busy.current || isLoading || isLoadingMore) return;
    const focus = focusVersion.current;
    busy.current = true;
    setOpeningId(item.id);
    setNotice(null);
    try {
      if (!item.isRead) {
        const ok = await markAsRead(item.id);
        if (!isCurrentUser() || focus !== focusVersion.current) return;
        if (!ok) Alert.alert(t('common.notifications'), t('notificationUi.readFailed'));
      }
      // A delayed response must not reopen content after the user went back.
      if (!isCurrentUser() || focus !== focusVersion.current) return;
      const route = routeForNotification(item.type, item.data, role);
      // Routing remains shared with push notifications, including Feed content.
      if (route) router.push(route as never);
    } finally { busy.current = false; setOpeningId(null); }
  };
  const failure = (retry: () => void) => (
    <View style={styles.feedback} accessibilityLiveRegion="polite">
      <Text style={styles.body}>{t('common.loadFailed')}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={retry} disabled={isLoading || isLoadingMore} style={styles.action}>
        <Text style={styles.actionText}>{t('common.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
  const renderItem = ({ item }: { item: AppNotification }) => {
    const icon = ICON_MAP[item.type] || ICON_MAP.general;
    const route = routeForNotification(item.type, item.data, role);
    const actionable = !!route || !item.isRead;
    const timestamp = notificationTimeAgo(item.createdAt, t, i18n.language);
    return (
      <TouchableOpacity
        style={[styles.card, !item.isRead && styles.unreadCard]}
        onPress={() => void handlePress(item)}
        disabled={!actionable || markingAll || openingId !== null || isLoading || isLoadingMore}
        accessibilityRole={actionable ? 'button' : 'text'}
        accessibilityState={{
          busy: openingId === item.id,
          disabled: !actionable || markingAll || openingId !== null || isLoading || isLoadingMore,
        }}
        accessibilityLabel={[item.isRead ? t('notificationUi.read') : t('notificationUi.unread'), item.title, item.body, timestamp].filter(Boolean).join('. ')}
        accessibilityHint={actionable ? t(route ? 'notificationUi.openHint' : 'notificationUi.markHint') : undefined}
        activeOpacity={0.75}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.icon, { backgroundColor: icon.color + '18' }]} accessible={false}>
            <Ionicons name={icon.name as keyof typeof Ionicons.glyphMap} size={22} color={colors.primaryDark} />
          </View>
          <Text style={[styles.status, !item.isRead && styles.unreadText]}>
            {t(item.isRead ? 'notificationUi.read' : 'notificationUi.unread')}
          </Text>
          {openingId === item.id ? <ActivityIndicator color={colors.primaryDark} /> :
            route ? <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} /> : null}
        </View>
        <Text style={styles.cardTitle}>{item.title}</Text>
        {!!item.body && <Text style={styles.body}>{item.body}</Text>}
        {!!timestamp && <Text style={styles.time}>{timestamp}</Text>}
      </TouchableOpacity>
    );
  };
  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        style={styles.viewport}
        contentContainerStyle={styles.content}
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View style={styles.header}>
            {role === 'student' && <BackButton href="/(student)/dashboard" />}
            {role === 'mentor' && <BackButton href="/(mentor)/dashboard" />}
            {role === 'advisor' && <BackButton href="/(advisor)/dashboard" />}
            <Text accessibilityRole="header" style={styles.title}>{t('common.notifications')}</Text>
            {(loaded || notifications.length > 0 || unreadCount > 0) && <View style={styles.summary}>
              <Text style={styles.summaryText}>{t('notificationUi.unreadCount', { count: unreadCount })}</Text>
              {unreadCount > 0 && <TouchableOpacity
                style={styles.action} accessibilityRole="button"
                accessibilityState={{ disabled: markingAll || openingId !== null || isLoading || isLoadingMore, busy: markingAll }}
                disabled={markingAll || openingId !== null || isLoading || isLoadingMore}
                onPress={() => void handleMarkAllRead()}>
                {markingAll && <ActivityIndicator color={colors.primaryDark} />}
                <Text style={styles.actionText}>{t('common.markAllRead')}</Text>
              </TouchableOpacity>}
            </View>}
            {notice && <View style={styles.feedback} accessibilityLiveRegion="polite">
              <Text style={styles.body}>{t(notice === 'success' ? 'notificationUi.allRead' : 'notificationUi.readFailed')}</Text>
              {notice === 'error' && <TouchableOpacity style={styles.action} accessibilityRole="button" onPress={() => void handleMarkAllRead()}>
                <Text style={styles.actionText}>{t('common.retry')}</Text>
              </TouchableOpacity>}
            </View>}
            {loadFailed && failure(() => void loadData())}
          </View>
        }
        ListEmptyComponent={
          isLoading || (!loaded && !loadFailed) ? <ActivityIndicator style={styles.empty} size="large" color={colors.primaryDark} /> :
          loadFailed ? null : <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.cardTitle}>{t('common.noNotifications')}</Text>
            <Text style={[styles.body, styles.center]}>{t('common.noNotificationsDesc')}</Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} colors={[colors.primaryDark]} tintColor={colors.primaryDark} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        ListFooterComponent={isLoadingMore ? <ActivityIndicator style={styles.footer} color={colors.primaryDark} /> :
          moreFailed ? failure(() => void loadMore(true)) : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  viewport: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  content: { padding: 24, paddingBottom: 32, flexGrow: 1 },
  header: { gap: 16, marginBottom: 20 },
  title: { fontSize: 26, fontWeight: '600', fontFamily: fonts.semibold, color: colors.ink },
  summary: { backgroundColor: colors.inkBg, borderRadius: 6, padding: 16, gap: 8 },
  summaryText: { fontSize: 16, lineHeight: 24, fontWeight: '600', fontFamily: fonts.semibold, color: colors.ink },
  action: { minHeight: 48, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  actionText: { fontSize: 16, lineHeight: 24, fontWeight: '600', fontFamily: fonts.semibold, color: colors.ink, flexShrink: 1 },
  feedback: { padding: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
  card: { padding: 20, gap: 10, borderRadius: 6, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.divider, marginBottom: 12 },
  unreadCard: { borderColor: colors.ink, borderWidth: 1.5 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  status: { flex: 1, fontSize: 14, fontFamily: fonts.regular, lineHeight: 21, color: colors.textSecondary },
  unreadText: { color: colors.ink, fontWeight: '600', fontFamily: fonts.semibold },
  cardTitle: { fontSize: 18, lineHeight: 26, fontWeight: '600', fontFamily: fonts.semibold, color: colors.text },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fonts.regular, color: colors.textSecondary },
  time: { fontSize: 14, lineHeight: 21, fontFamily: fonts.regular, color: colors.textSecondary },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 48 },
  center: { textAlign: 'center' },
  footer: { paddingVertical: 20 },
});
