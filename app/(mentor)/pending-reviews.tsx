import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, Image, Modal, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { assignmentService } from '@/services/assignments';
import { notificationService } from '@/services/notifications';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import { mapRpcError } from '@/utils/rpcErrors';
import { colors, spacing, borderRadius } from '@/theme';
import type { AssignmentSubmission, GroupAssignment } from '@/types/assignment';

type PendingReview = AssignmentSubmission & { assignment: GroupAssignment };

// The database column is DATE and the app passes it around as a 'YYYY-MM-DD'
// string, so parsing stays in local time -- new Date('2026-09-01') is parsed
// as UTC and rendered locally, which can silently shift the date by a day.
function fromIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function PendingReviewsScreen() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<PendingReview[]>([]);
  const [studentNames, setStudentNames] = useState<Record<string, string>>({});

  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState<'approve' | 'revise' | null>(null);
  // Shared across every card -- only one can be open at a time, so a single
  // lightbox is simpler than tracking one per card.
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      // No mentor id here on purpose -- RLS already scopes these rows to
      // is_mentor_of(student_id), so a parameter would be decoration over a
      // rule the database enforces, and an invitation to pass someone else's.
      const items = await assignmentService.listPendingReviews();
      setPending(items);

      // The student's name is not on the returned shape, so it is resolved
      // with a second, batched query keyed by the student ids already in
      // hand. `profiles`, not `profiles_public`: profiles_select admits
      // is_mentor_of(id), so a mentor can read their own students' rows
      // directly, and only `profiles` carries the names.
      const ids = Array.from(new Set(items.map((it) => it.studentId).filter(Boolean)));
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', ids);
        if (error) throw error;
        const names: Record<string, string> = {};
        for (const row of data || []) {
          const r = row as Record<string, unknown>;
          names[r.id as string] =
            `${(r.first_name as string) || ''} ${(r.last_name as string) || ''}`.trim();
        }
        setStudentNames(names);
      } else {
        setStudentNames({});
      }
    } catch (err) {
      console.error('Pending reviews load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  function toggleOpen(item: PendingReview) {
    if (openId === item.id) {
      setOpenId(null);
      return;
    }
    setOpenId(item.id);
    setNote('');
  }

  async function handleReview(item: PendingReview, approved: boolean) {
    setSubmitting(approved ? 'approve' : 'revise');
    try {
      await assignmentService.reviewAssignment(item.id, approved, note.trim());

      // Notification delivery is best-effort: a failure here must never
      // make a successful review look failed.
      try {
        const mentorName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Your mentor';
        await notificationService.create(
          item.studentId,
          approved ? t('notifications.taskApprovedTitle') : t('notifications.taskRevisionTitle'),
          approved
            ? t('notifications.taskApprovedBody', { mentorName, title: item.assignment.title })
            : t('notifications.taskRevisionBody', { mentorName, title: item.assignment.title }),
          approved ? 'task_approved' : 'task_revision_requested',
          { assignmentId: item.assignmentId },
        );
      } catch (e) {
        console.warn('notify failed:', e);
      }

      Alert.alert(
        t('common.done'),
        approved ? t('mentor.taskApproved') : t('mentor.taskRevisionRequested'),
      );
      setOpenId(null);
      setNote('');
      await loadData();
    } catch (err) {
      // STUDENT_LEFT_GROUP and NOT_IN_SCOPE are the two reachable refusals
      // here, and neither is something the mentor can fix -- both messages
      // point at the advisor.
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setSubmitting(null);
    }
  }

  // Below 1 MB in KB, at or above in MB with one decimal -- the same split a
  // user picking the file already sees in their own OS file browser.
  function formatFileSize(bytes: number): string {
    if (bytes >= 1024 * 1024) {
      return t('common.fileSizeMB', { size: (bytes / (1024 * 1024)).toFixed(1) });
    }
    return t('common.fileSizeKB', { size: Math.max(1, Math.round(bytes / 1024)) });
  }

  async function openDocument(uri: string) {
    try {
      await Linking.openURL(uri);
    } catch (err) {
      console.error('Open document error:', err);
      Alert.alert(t('common.error'), t('common.tryAgain'));
    }
  }

  function renderCard(item: PendingReview) {
    const isOpen = openId === item.id;
    const due = item.assignment.dueDate ? fromIsoDate(item.assignment.dueDate) : null;
    const name = studentNames[item.studentId] || '';
    return (
      <View key={item.id} style={styles.card}>
        <TouchableOpacity
          style={styles.cardHeaderRow}
          onPress={() => toggleOpen(item)}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeaderText}>
            {!!name && <Text style={styles.studentName}>{name}</Text>}
            <Text style={styles.cardTitle}>{item.assignment.title}</Text>
            {!!due && (
              <Text style={styles.subtle}>
                {t('mentor.taskDueDate')}: {due.toLocaleDateString(i18n.language)}
              </Text>
            )}
          </View>
          <Ionicons
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textSecondary}
          />
        </TouchableOpacity>

        {isOpen && (
          <View style={styles.detail}>
            {/* The advisor's own words about this task. It is the natural
                place to put the real instructions -- the field sits right
                under the title and says "Description (optional)" -- and until
                now only the advisor's own card ever read it back. It leads the
                panel, ahead of the objective and criterion, the same order the
                student's own card uses. */}
            {!!item.assignment.description && (
              <>
                <Text style={styles.label}>{t('mentor.taskDescription')}</Text>
                <Text style={styles.detailText}>{item.assignment.description}</Text>
              </>
            )}

            <Text style={styles.label}>{t('mentor.taskObjective')}</Text>
            <Text style={styles.detailText}>{item.assignment.objective}</Text>

            {/* The criterion is what the mentor judges against, so it still
                gets its own highlighted block even though it no longer leads
                the panel -- description and objective now set it up. */}
            <View style={styles.criterionBox}>
              <Text style={styles.criterionLabel}>{t('mentor.taskCriterion')}</Text>
              <Text style={styles.criterionText}>{item.assignment.criterion}</Text>
            </View>

            {!!item.studentNote && (
              <>
                <Text style={styles.label}>{t('mentor.whatIDid')}</Text>
                <Text style={styles.detailText}>{item.studentNote}</Text>
              </>
            )}

            {!!item.reflection && (
              <>
                <Text style={styles.label}>{t('mentor.whatILearned')}</Text>
                <Text style={styles.detailText}>{item.reflection}</Text>
              </>
            )}

            {/* Nothing renders here at all when there is no evidence -- a bare
                "Evidence" heading with nothing under it reads as a failed
                load, the same defect D1's review flagged on the old
                linked-log panel this replaced. */}
            {((item.photos && item.photos.length > 0) || (item.documents && item.documents.length > 0)) && (
              <>
                <Text style={styles.label}>{t('mentor.evidence')}</Text>

                {!!item.photos && item.photos.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.photosScroll}
                  >
                    {item.photos.map((photo, index) => (
                      <TouchableOpacity
                        key={`photo-${index}`}
                        style={styles.photoWrapper}
                        onPress={() => setLightboxUri(photo.uri)}
                        activeOpacity={0.85}
                      >
                        <Image source={{ uri: photo.uri }} style={styles.photo} />
                        <View style={styles.photoZoomHint}>
                          <Ionicons name="expand-outline" size={14} color="#fff" />
                        </View>
                        {!!photo.caption && (
                          <Text style={styles.photoCaption} numberOfLines={1}>{photo.caption}</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {!!item.documents && item.documents.length > 0 && (
                  <View style={styles.docList}>
                    {item.documents.map((doc, index) => (
                      <TouchableOpacity
                        key={`doc-${index}`}
                        style={styles.docRow}
                        onPress={() => openDocument(doc.uri)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="document-outline" size={20} color={colors.primary} />
                        <Text style={styles.docName} numberOfLines={1}>{doc.fileName}</Text>
                        <Text style={styles.docSize}>{formatFileSize(doc.fileSize)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            <Text style={styles.label}>{t('mentor.reviewNote')}</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={note}
              onChangeText={setNote}
              multiline
              placeholderTextColor={colors.textDisabled}
            />

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => handleReview(item, false)}
                disabled={submitting !== null}
                activeOpacity={0.7}
              >
                {submitting === 'revise' ? (
                  <ActivityIndicator size="small" color={colors.error} />
                ) : (
                  <Text style={styles.secondaryBtnText}>{t('mentor.requestTaskRevision')}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => handleReview(item, true)}
                disabled={submitting !== null}
                activeOpacity={0.7}
              >
                {submitting === 'approve' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('mentor.approveTask')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      >
        <Text style={styles.screenTitle}>{t('mentor.pendingReviews')}</Text>

        {pending.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.success} />
            <Text style={styles.emptyText}>{t('mentor.noPendingReviews')}</Text>
          </View>
        ) : (
          pending.map(renderCard)
        )}

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      {/* One shared lightbox for every card -- only one can be open at a
          time, so there is never more than one photo to enlarge at once. */}
      <Modal
        visible={lightboxUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxUri(null)}
      >
        <TouchableOpacity
          style={styles.lightboxOverlay}
          activeOpacity={1}
          onPress={() => setLightboxUri(null)}
        >
          <TouchableOpacity activeOpacity={1}>
            <Image
              source={{ uri: lightboxUri ?? undefined }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.lightboxClose}
            onPress={() => setLightboxUri(null)}
            hitSlop={12}
          >
            <Ionicons name="close-circle" size={36} color="#fff" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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

  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardHeaderText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  studentName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginTop: 2,
  },
  subtle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  detail: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  detailText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },

  // The criterion is the point of the screen, so it gets its own
  // highlighted block rather than reading as one label among several.
  criterionBox: {
    backgroundColor: colors.primary + '12',
    borderWidth: 1,
    borderColor: colors.primary + '30',
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
  },
  criterionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  criterionText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },

  // Photos
  photosScroll: {
    marginTop: spacing.xs,
  },
  photoWrapper: {
    marginRight: spacing.sm,
    position: 'relative',
  },
  photo: {
    width: 96,
    height: 96,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.border,
  },
  photoZoomHint: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10,
    padding: 3,
  },
  photoCaption: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
    width: 96,
  },

  // Lightbox
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxImage: {
    width: 360,
    height: 480,
    borderRadius: borderRadius.sm,
  },
  lightboxClose: {
    position: 'absolute',
    top: 52,
    right: 20,
  },

  // Documents
  docList: {
    marginTop: spacing.xs,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  docName: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
  },
  docSize: {
    fontSize: 12,
    color: colors.textSecondary,
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
  multilineInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },

  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.error,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
