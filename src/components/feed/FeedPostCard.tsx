import { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Alert, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { feedService } from '@/services/feed';
import { pollPercentages, withLike } from '@/utils/feedMetrics';
import { mapRpcError } from '@/utils/rpcErrors';
import { taskDueDate } from '@/utils/studentTasks';
import { isValidLink } from '@/utils/feedAttachments';
import { colors, spacing, borderRadius } from '@/theme';
import type { FeedPost } from '@/types/feed';
import { FeedComments } from './FeedComments';

interface Props {
  post: FeedPost;
  userId: string;
  /** Decides where an assignment card opens: the student's task detail or
   *  the advisor's assignments list for the group. */
  role: 'student' | 'advisor';
  /** The advisor of this post's group. */
  canModerate: boolean;
  highlighted?: boolean;
  onChange: (next: FeedPost) => void;
  onRemoved: (postId: string) => void;
  onOpenPhoto: (uri: string) => void;
}

function openAttachment(target: string) {
  Linking.openURL(target).catch((err) => console.warn('Open attachment failed:', err instanceof Error ? err.message : err));
}

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('');
}

export function FeedPostCard({ post, userId, role, canModerate, highlighted, onChange, onRemoved, onOpenPhoto }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [showComments, setShowComments] = useState(false);
  const isMine = post.authorId === userId;

  async function toggleLike() {
    const next = withLike(post, !post.likedByMe);
    onChange(next); // optimistic
    try {
      await feedService.setLiked(post.id, userId, next.likedByMe);
    } catch (err) {
      console.warn('Feed like failed:', err instanceof Error ? err.message : err);
      onChange(post); // roll back
    }
  }

  async function vote(optionId: string) {
    // A draft poll is a preview: no vote exists for it yet, not even the
    // advisor's own.
    if (!post.poll || post.draft) return;
    const prev = post;
    const options = post.poll.options.map((o) => ({
      ...o,
      votes: o.votes
        + (o.id === optionId ? 1 : 0)
        - (o.id === post.poll?.myOptionId ? 1 : 0),
    }));
    const totalVotes = post.poll.totalVotes + (post.poll.myOptionId ? 0 : 1);
    onChange({ ...post, poll: { options, totalVotes, myOptionId: optionId } });
    try {
      await feedService.vote(post.id, optionId);
    } catch (err) {
      onChange(prev);
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    }
  }

  function removeTask() {
    if (!post.task) return;
    Alert.alert(t('feed.removeFromFeed'), t('feed.removeFromFeedConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.remove'), style: 'destructive',
        onPress: async () => {
          try {
            await feedService.setSubmissionSharing(post.task!.submissionId, false);
            onRemoved(post.id);
          } catch (err) {
            const { key } = mapRpcError(err instanceof Error ? err.message : '');
            Alert.alert(t('common.error'), t(key));
          }
        },
      },
    ]);
  }

  function removePost() {
    Alert.alert(t('feed.removePost'), t('feed.removePostConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.remove'), style: 'destructive',
        onPress: async () => {
          try {
            await feedService.deletePost(post.id);
            onRemoved(post.id);
          } catch (err) {
            console.warn('Feed post delete failed:', err instanceof Error ? err.message : err);
            Alert.alert(t('common.error'), t('feed.removeFailed'));
          }
        },
      },
    ]);
  }

  function openAssignment() {
    if (!post.assignment) return;
    if (role === 'student') {
      router.push({ pathname: '/(student)/task-detail', params: { id: post.assignment.id } });
    } else {
      router.push(`/(advisor)/group-assignments?groupId=${post.groupId}`);
    }
  }

  const percentages = post.poll ? pollPercentages(post.poll.options) : [];
  // Local date from the bare YYYY-MM-DD; new Date(...) would read it as UTC
  // midnight and show the previous day west of UTC.
  const due = post.assignment ? taskDueDate(post.assignment.dueDate, i18n.language) : undefined;

  return (
    <View style={[styles.card, highlighted && styles.cardHighlighted]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(post.authorName)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.author} numberOfLines={1}>
            {post.authorName}
            {post.kind === 'task' && <Text style={styles.subtle}>  {t('feed.sharedTask')}</Text>}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.subtle}>
              {post.kind === 'announcement' ? t('feed.announcement')
                : post.kind === 'poll' ? t('feed.poll')
                : post.kind === 'assignment' ? t('notifications.taskAssignedTitle')
                : ''}
              {post.kind !== 'task' ? ' · ' : ''}
              {new Date(post.createdAt).toLocaleDateString(i18n.language)}
            </Text>
            {/* Only the advisor ever sees a draft (list_feed_pending is
                owner-only); the badge says this card is not live yet. */}
            {post.draft && <Text style={styles.draftBadge}>{t('feed.draft', 'Draft')}</Text>}
          </View>
        </View>
        {post.kind === 'task' && isMine && (
          <TouchableOpacity onPress={removeTask} hitSlop={8}>
            <Ionicons name="eye-off-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
        {canModerate && (
          <TouchableOpacity onPress={removePost} hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Body by kind */}
      {post.kind === 'task' && post.task && (
        <View style={styles.section}>
          {!!post.task.competencyName && (
            <Text style={styles.competency}>
              {post.task.competencyName}{post.task.level ? ` · L${post.task.level}` : ''}
            </Text>
          )}
          <Text style={styles.title}>{post.task.title}</Text>
          {!!post.task.note && <Text style={styles.body}>{post.task.note}</Text>}
          {post.task.photos.length > 0 && (
            <View style={styles.photoRow}>
              {post.task.photos.map((p, i) => (
                <TouchableOpacity key={`${p.uri}-${i}`} onPress={() => onOpenPhoto(p.uri)} activeOpacity={0.8}>
                  <Image source={{ uri: p.uri }} style={styles.photo} />
                </TouchableOpacity>
              ))}
            </View>
          )}
          {post.task.documents.map((d, i) => (
            <TouchableOpacity key={`${d.uri}-${i}`} style={styles.docRow} onPress={() => openAttachment(d.uri)} activeOpacity={0.7}>
              <Ionicons name="document-outline" size={18} color={colors.primary} />
              <Text style={styles.docName} numberOfLines={1}>{d.fileName || t('feed.document')}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {post.kind === 'announcement' && (
        <View style={styles.section}>
          <Text style={styles.body}>{post.body}</Text>
          {/* Already in photo -> document -> link order and already signed
              by feedService; a photo/document whose signing failed was
              dropped there, so every file target here is openable. A link
              is opened only when it is http(s) with a host -- the row CHECK
              refuses anything else, but the card does not trust the row. */}
          {post.attachments.map((a) => {
            if (a.kind === 'photo') {
              return (
                <View key={a.id} style={styles.photoRow}>
                  <TouchableOpacity onPress={() => onOpenPhoto(a.target)} activeOpacity={0.8}>
                    <Image source={{ uri: a.target }} style={styles.photo} />
                  </TouchableOpacity>
                </View>
              );
            }
            const isLink = a.kind === 'link';
            const openable = !isLink || isValidLink(a.target);
            const label = isLink ? (a.name || a.target) : (a.name || t('feed.document'));
            if (!openable) {
              return (
                <View key={a.id} style={styles.docRow}>
                  <Ionicons name="link-outline" size={18} color={colors.textSecondary} />
                  <Text style={[styles.docName, styles.docNameInert]} numberOfLines={1}>{label}</Text>
                </View>
              );
            }
            return (
              <TouchableOpacity key={a.id} style={styles.docRow} onPress={() => openAttachment(a.target)} activeOpacity={0.7}>
                <Ionicons name={isLink ? 'link-outline' : 'document-outline'} size={18} color={colors.primary} />
                <Text style={styles.docName} numberOfLines={1}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {post.kind === 'assignment' && post.assignment && (
        <View style={styles.section}>
          {!!post.assignment.competencyName && (
            <Text style={styles.competency}>
              {post.assignment.competencyName}{post.assignment.level ? ` · L${post.assignment.level}` : ''}
            </Text>
          )}
          <Text style={styles.title}>{post.assignment.title}</Text>
          {!!due && (
            <Text style={styles.subtle}>{t('student.taskDueDate')}: {due}</Text>
          )}
          <TouchableOpacity style={styles.docRow} onPress={openAssignment} activeOpacity={0.7}>
            <Text style={styles.docName}>{t('studentFlow.viewTask')} →</Text>
          </TouchableOpacity>
        </View>
      )}

      {post.kind === 'poll' && post.poll && (
        <View style={styles.section}>
          <Text style={styles.title}>{post.body}</Text>
          {post.poll.options.map((o, i) => {
            const mine = post.poll?.myOptionId === o.id;
            const voted = !!post.poll?.myOptionId;
            return (
              <TouchableOpacity key={o.id} style={[styles.option, mine && styles.optionMine]} onPress={() => vote(o.id)} activeOpacity={0.7}>
                {voted && <View style={[styles.optionFill, { width: `${percentages[i]}%` }]} />}
                <Text style={[styles.optionLabel, mine && styles.optionLabelMine]}>{o.label}</Text>
                {voted && <Text style={styles.optionPct}>{percentages[i]}%</Text>}
              </TouchableOpacity>
            );
          })}
          <Text style={styles.subtle}>
            {t('feed.votes', { count: post.poll.totalVotes })}
            {post.poll.myOptionId ? ` · ${t('feed.changeVote')}` : ''}
          </Text>
        </View>
      )}

      {/* Footer. A draft has no likes or comments to count (nobody but the
          advisor can see it), so the row is hidden rather than shown at 0;
          the trash in the header is how a draft is deleted (remove_feed_post). */}
      {!post.draft && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.footerBtn} onPress={toggleLike} hitSlop={8}>
            <Ionicons name={post.likedByMe ? 'heart' : 'heart-outline'} size={20} color={post.likedByMe ? colors.error : colors.textSecondary} />
            <Text style={styles.footerText}>{t('feed.likeCount', { count: post.likeCount })}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerBtn} onPress={() => setShowComments((v) => !v)} hitSlop={8}>
            <Ionicons name="chatbubble-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.footerText}>{t('feed.commentCount', { count: post.commentCount })}</Text>
          </TouchableOpacity>
        </View>
      )}

      {showComments && !post.draft && (
        <FeedComments
          postId={post.id}
          userId={userId}
          canModerate={canModerate}
          onCountChange={(delta) => onChange({ ...post, commentCount: Math.max(0, post.commentCount + delta) })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  cardHighlighted: { borderWidth: 2, borderColor: colors.primary },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + '20', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  author: { fontSize: 14, fontWeight: '600', color: colors.text },
  subtle: { fontSize: 12, color: colors.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  draftBadge: { fontSize: 10, fontWeight: '700', color: colors.warning, textTransform: 'uppercase', letterSpacing: 0.5, borderWidth: 1, borderColor: colors.warning, borderRadius: borderRadius.sm, paddingHorizontal: 5, paddingVertical: 1 },
  section: { gap: spacing.xs },
  competency: { fontSize: 12, fontWeight: '600', color: colors.primary },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 14, color: colors.text, lineHeight: 20 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  photo: { width: 96, height: 96, borderRadius: borderRadius.sm },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  docName: { flex: 1, fontSize: 13, color: colors.primary, fontWeight: '500' },
  docNameInert: { color: colors.textSecondary },
  option: { position: 'relative', overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  optionMine: { borderColor: colors.primary },
  optionFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.primary + '18' },
  optionLabel: { fontSize: 14, color: colors.text },
  optionLabelMine: { fontWeight: '600', color: colors.primary },
  optionPct: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  footer: { flexDirection: 'row', gap: spacing.lg, paddingTop: spacing.xs },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerText: { fontSize: 13, color: colors.textSecondary },
});
