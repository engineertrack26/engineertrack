import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator, TouchableOpacity, Modal, Image, Pressable } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { feedService, FEED_PAGE_SIZE } from '@/services/feed';
import { groupService } from '@/services/group';
import { assignmentService } from '@/services/assignments';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';
import { LoadFailedBanner } from '@/components/common';
import { FeedPostCard, FeedComposer, UpcomingTasksBox } from '@/components/feed';
import { isActionable } from '@/utils/studentTasks';
import { upcomingTasks } from '@/utils/feedUpcoming';
import { colors, spacing, borderRadius } from '@/theme';
import type { FeedPost } from '@/types/feed';
import type { InternshipGroup } from '@/types/group';
import type { UpcomingCandidate } from '@/utils/feedUpcoming';

interface FeedScreenProps {
  role: 'student' | 'advisor';
}

interface GroupChoice { id: string; name: string; isArchived?: boolean }

/** The group feed for the student (their one active group) and the advisor
 *  (a selector over their groups, the same treatment Reports gives it). */
export function FeedScreen({ role }: FeedScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { post: postParam } = useLocalSearchParams<{ post?: string }>();

  const [groups, setGroups] = useState<GroupChoice[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [composer, setComposer] = useState<'announcement' | 'poll' | null>(null);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const consumedParam = useRef<string | null>(null);
  const request = useRef(0);
  const upcomingRequest = useRef(0);
  const listRef = useRef<FlatList<FeedPost>>(null);
  const groupIdRef = useRef<string | null>(null);
  const scrollRetries = useRef(0);

  const canModerate = role === 'advisor';

  const loadGroups = useCallback(async () => {
    if (!user) return;
    setLoadingGroups(true);
    try {
      if (role === 'advisor') {
        const list: InternshipGroup[] = await groupService.listMyGroups(user.id);
        const choices = list.map((g) => ({ id: g.id, name: g.name, isArchived: g.isArchived }));
        setGroups(choices);
        // Never default to an archived group while an active one exists.
        setGroupId((cur) => cur && choices.some((g) => g.id === cur) ? cur : (choices.find((g) => !g.isArchived) ?? choices[0])?.id ?? null);
      } else {
        const g = await groupService.getMyGroup(user.id);
        setGroups(g ? [{ id: g.id, name: g.name }] : []);
        setGroupId(g?.id ?? null);
      }
      setLoadFailed(false);
    } catch (err) {
      console.error('Feed groups load error:', err);
      setLoadFailed(true);
    } finally {
      setLoadingGroups(false);
    }
  }, [user, role]);

  const loadPosts = useCallback(async (gid: string | null) => {
    const req = ++request.current;
    if (!gid) { setPosts([]); setLoading(false); return; }
    setLoading(true);
    setLoadFailed(false);
    try {
      const page = await feedService.listPosts(gid);
      if (req !== request.current) return;
      setPosts(page);
      setHasMore(page.length === FEED_PAGE_SIZE);
    } catch (err) {
      if (req !== request.current) return;
      console.error('Feed load error:', err);
      setLoadFailed(true);
    } finally {
      if (req === request.current) setLoading(false);
    }
  }, []);

  // A counter of its own, not `request`: this box is auxiliary to the
  // stream (fetched from group_assignments, not feed_posts) and must not be
  // invalidated by, or invalidate, an unrelated posts refetch that happens
  // to land around the same time.
  const loadUpcoming = useCallback(async (gid: string | null) => {
    const req = ++upcomingRequest.current;
    if (!gid || !user) { setUpcoming([]); return; }
    try {
      const list = role === 'advisor'
        ? (await assignmentService.listGroupAssignments(gid)).filter((a) => !!a.publishedAt)
        : (await assignmentService.listMyAssignments(gid, user.id)).filter(isActionable);
      if (req !== upcomingRequest.current) return;
      setUpcoming(upcomingTasks(list, new Date()));
    } catch (err) {
      if (req !== upcomingRequest.current) return;
      // Auxiliary to the stream: the stream's own LoadFailedBanner is the
      // user-facing failure signal, and a box that quietly disappears is
      // not a wrong statement -- unlike a banner, silence here claims
      // nothing about whether anything is due.
      console.warn('Upcoming tasks load failed:', err);
      setUpcoming([]);
    }
  }, [role, user]);

  const loadMore = useCallback(async () => {
    if (!groupId || !hasMore || loadingMore || loading || posts.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = posts[posts.length - 1].createdAt;
      const page = await feedService.listPosts(groupId, oldest);
      const seen = new Set(posts.map((p) => p.id));
      setPosts((prev) => [...prev, ...page.filter((p) => !seen.has(p.id))]);
      setHasMore(page.length === FEED_PAGE_SIZE);
    } catch (err) {
      console.error('Feed load more error:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [groupId, hasMore, loadingMore, loading, posts]);

  useEffect(() => { groupIdRef.current = groupId; }, [groupId]);

  // Read groupId through a ref rather than depending on it directly: a
  // dependency on groupId would re-fire this on every group switch (not
  // just on refocus), since useFocusEffect re-runs its callback whenever
  // the callback identity changes while the screen is focused.
  useFocusEffect(useCallback(() => {
    loadGroups();
    loadPosts(groupIdRef.current);
    loadUpcoming(groupIdRef.current);
  }, [loadGroups, loadPosts, loadUpcoming]));
  useEffect(() => { loadPosts(groupId); loadUpcoming(groupId); }, [groupId, loadPosts, loadUpcoming]);

  // A new post in the selected group: refetch the top page rather than
  // trusting the bare row -- the realtime payload has no author name,
  // counts or signed evidence, and list_feed_posts is where those live.
  useRealtimeSubscription({
    table: 'feed_posts',
    event: 'INSERT',
    filter: groupId ? `group_id=eq.${groupId}` : undefined,
    enabled: !!groupId,
    onPayload: () => { loadPosts(groupId); },
  });

  // Scroll to the post a notification pointed at, once, if it is in the list.
  useEffect(() => {
    if (!postParam || postParam === consumedParam.current || posts.length === 0) return;
    const index = posts.findIndex((p) => p.id === postParam);
    if (index < 0) return;
    consumedParam.current = postParam;
    setHighlightId(postParam);
    scrollRetries.current = 0;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
  }, [postParam, posts]);

  // Kept separate from the scroll effect above: that effect re-runs on
  // every `posts` change (a like, a realtime refetch, loadMore), which
  // would otherwise clear and restart -- or on a rerun after
  // `consumedParam` is already set, simply drop -- this timer before it
  // ever fires, leaving the highlight border on indefinitely.
  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadGroups();
    await loadPosts(groupId);
    await loadUpcoming(groupId);
    setRefreshing(false);
  }, [loadGroups, loadPosts, loadUpcoming, groupId]);

  function updatePost(next: FeedPost) {
    setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  }
  function removePost(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }

  if (!user) return null;

  const header = (
    <View>
      {loadFailed && <LoadFailedBanner onRetry={() => { loadGroups(); loadPosts(groupId); }} />}
      {role === 'advisor' && groups.length > 1 && (
        <View style={styles.chipRow}>
          {groups.map((g) => (
            <TouchableOpacity
              key={g.id}
              style={[styles.chip, g.id === groupId && styles.chipActive, g.isArchived && { opacity: 0.6 }]}
              onPress={() => setGroupId(g.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, g.id === groupId && styles.chipTextActive]} numberOfLines={1}>{g.name}</Text>
              {g.isArchived && <Text style={styles.chipBadge}>{t('advisor.archived')}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
      <UpcomingTasksBox
        tasks={upcoming}
        onOpen={(task) => {
          if (role === 'advisor') {
            router.push(`/(advisor)/group-assignments?groupId=${groupId}`);
          } else {
            router.push({ pathname: '/(student)/task-detail', params: { id: task.id } });
          }
        }}
      />
      {role === 'advisor' && groupId && (
        <View style={styles.composeRow}>
          <TouchableOpacity style={styles.composeBtn} onPress={() => setComposer('announcement')} activeOpacity={0.7}>
            <Ionicons name="megaphone-outline" size={18} color={colors.primary} />
            <Text style={styles.composeText}>{t('feed.writeAnnouncement')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.composeBtn} onPress={() => setComposer('poll')} activeOpacity={0.7}>
            <Ionicons name="stats-chart-outline" size={18} color={colors.primary} />
            <Text style={styles.composeText}>{t('feed.createPoll')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const empty = loadingGroups || loading ? (
    <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 60 }} />
  ) : (
    <View style={styles.empty}>
      <Ionicons name="newspaper-outline" size={48} color={colors.textDisabled} />
      <Text style={styles.emptyText}>{groupId ? t('feed.empty') : t('feed.noGroup')}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.titleRow}><Text style={styles.screenTitle}>{t('feed.title')}</Text></View>
      <FlatList
        ref={listRef}
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <FeedPostCard
            post={item}
            userId={user.id}
            role={role}
            canModerate={canModerate}
            highlighted={item.id === highlightId}
            onChange={updatePost}
            onRemoved={removePost}
            onOpenPhoto={setLightboxUri}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={loadingMore ? <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 16 }} /> : null}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        onScrollToIndexFailed={(info) => {
          if (scrollRetries.current >= 3) { scrollRetries.current = 0; return; } // give up; the highlight still shows
          scrollRetries.current += 1;
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.1 }), 50);
        }}
        showsVerticalScrollIndicator={false}
      />

      {role === 'advisor' && groupId && composer && (
        <FeedComposer
          visible
          kind={composer}
          groupId={groupId}
          onClose={() => setComposer(null)}
          onPosted={() => { setComposer(null); loadPosts(groupId); }}
        />
      )}

      <Modal visible={lightboxUri !== null} transparent animationType="fade" onRequestClose={() => setLightboxUri(null)}>
        <Pressable style={styles.lightbox} onPress={() => setLightboxUri(null)}>
          {lightboxUri && <Image source={{ uri: lightboxUri }} style={styles.lightboxImage} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  titleRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  screenTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: borderRadius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, maxWidth: 160 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  chipBadge: { fontSize: 11, color: colors.textSecondary, backgroundColor: colors.divider, paddingHorizontal: 6, borderRadius: borderRadius.full },
  composeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  composeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary + '40' },
  composeText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: 60, paddingHorizontal: spacing.xl },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  lightbox: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  lightboxImage: { width: '100%', height: '80%' },
});
