import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { assignmentService } from '@/services/assignments';
import { mapRpcError } from '@/utils/rpcErrors';
import { colors, spacing, borderRadius } from '@/theme';
import type { GroupAssignment } from '@/types/assignment';

// The database column is DATE and the rest of the app passes these around as
// 'YYYY-MM-DD' strings -- duplicated from app/(advisor)/group-assignments.tsx
// rather than shared, matching how every other screen with a due-date picker
// (my-tasks.tsx, pending-reviews.tsx, internship-form.tsx) already keeps its
// own copy. Both helpers work in LOCAL time on purpose; see that file's
// comment for why toISOString()/`new Date(iso)` would silently shift the date.
function toIsoDate(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function fromIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

interface AssignmentCounts {
  submitted: number;
  approved: number;
  needsRevision: number;
}

interface AssignmentCardProps {
  assignment: GroupAssignment;
  /** Derived from `!assignment.publishedAt` by the caller, not recomputed
   *  here -- the screen already has to filter the one list into two views,
   *  and a second definition of "is this a draft" is a second place for that
   *  to drift. */
  isDraft: boolean;
  counts: AssignmentCounts;
  countsUnavailable: boolean;
  memberCount: number;
  outOfScope: boolean;
  /** Called after any successful mutation -- edit, withdraw, or a document
   *  attach/replace/remove. Re-runs the screen's single `loadData` query;
   *  this card keeps no copy of the row beyond what it seeds the edit form
   *  with when opened. */
  onChanged: () => void;
}

export function AssignmentCard({
  assignment: a, isDraft, counts, countsUnavailable, memberCount, outOfScope, onChanged,
}: AssignmentCardProps) {
  const { t, i18n } = useTranslation();

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editObjective, setEditObjective] = useState('');
  const [editCriterion, setEditCriterion] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editShowDatePicker, setEditShowDatePicker] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  // Covers both the initial attach and a replace -- one flag either way,
  // since only one of those two actions can be in flight for a single task.
  const [attaching, setAttaching] = useState(false);

  // A draft has no submissions, so trg_freeze_assessed_assignment cannot have
  // fired and every field stays editable. A sent card falls back to the
  // counts-based check the rest of the screen already relies on.
  const canEditTerms = isDraft || (!countsUnavailable && counts.submitted === 0);

  const due = a.dueDate ? fromIsoDate(a.dueDate) : null;

  function openEdit() {
    setEditTitle(a.title);
    setEditDescription(a.description || '');
    setEditObjective(a.objective);
    setEditCriterion(a.criterion);
    setEditDueDate(a.dueDate || '');
    setEditShowDatePicker(false);
    setIsEditing(true);
  }

  function closeEdit() {
    setIsEditing(false);
    setEditShowDatePicker(false);
  }

  async function handleUpdate() {
    if (!editTitle.trim()) {
      Alert.alert(t('common.error'), t('advisor.assignmentTitleRequired'));
      return;
    }
    // Send only what changed -- the server is still the authority on whether
    // objective/criterion may move, but there is no reason to resend fields
    // that were never touched.
    const patch: {
      title?: string; description?: string | null; dueDate?: string | null;
      objective?: string; criterion?: string;
    } = {};
    const nextTitle = editTitle.trim();
    if (nextTitle !== a.title) patch.title = nextTitle;
    const nextDescription = editDescription.trim();
    if (nextDescription !== (a.description || '')) patch.description = nextDescription || null;
    if (editDueDate !== (a.dueDate || '')) patch.dueDate = editDueDate || null;
    if (canEditTerms) {
      const nextObjective = editObjective.trim();
      const nextCriterion = editCriterion.trim();
      if (nextObjective !== a.objective) patch.objective = nextObjective;
      if (nextCriterion !== a.criterion) patch.criterion = nextCriterion;
    }

    if (Object.keys(patch).length === 0) {
      closeEdit();
      return;
    }

    setEditSaving(true);
    try {
      await assignmentService.updateAssignment(a.id, patch);
      Alert.alert(t('common.done'), t('advisor.assignmentUpdated'));
      closeEdit();
      onChanged();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setEditSaving(false);
    }
  }

  function confirmWithdraw() {
    Alert.alert(
      t('advisor.withdrawAssignment'),
      t('advisor.withdrawConfirm', { title: a.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('advisor.withdrawAssignment'), style: 'destructive', onPress: handleWithdraw },
      ],
    );
  }

  async function handleWithdraw() {
    // The delete itself is harmless twice -- the second affects zero rows --
    // but a zero-row delete is indistinguishable from a refusal here, so a
    // second tap would report "already has submissions" about a row the
    // first tap already withdrew.
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      const removed = await assignmentService.deleteAssignment(a.id);
      if (!removed) {
        Alert.alert(t('common.error'), t('advisor.assignmentHasSubmissions'));
        return;
      }
      Alert.alert(t('common.done'), t('advisor.assignmentWithdrawn'));
      if (isEditing) closeEdit();
      onChanged();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setWithdrawing(false);
    }
  }

  // Attaching is two calls, upload then write, in that order: a row pointing
  // at an object that failed to upload is a broken link, while an uploaded
  // object no row references is only wasted bytes.
  async function attachDocument() {
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        copyToCacheDirectory: true,
      });
    } catch {
      Alert.alert(t('common.error'), t('student.documentPickerError'));
      return;
    }
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];

    setAttaching(true);
    try {
      const { path, name } = await assignmentService.uploadAssignmentDocument(
        a.groupId,
        a.id,
        asset.uri,
        asset.name,
        asset.mimeType ?? 'application/octet-stream',
      );
      await assignmentService.setAssignmentDocument(a.id, path, name);
      onChanged();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setAttaching(false);
    }
  }

  // Detaches only -- the object itself is left in the bucket, same as the
  // student's evidence picker on remove/replace, and just as deliberate: an
  // orphaned object is cheaper than a broken reference.
  async function removeDocument() {
    setAttaching(true);
    try {
      await assignmentService.setAssignmentDocument(a.id, null, null);
      onChanged();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setAttaching(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardTitleFlex}>
          {!!a.competencyName && (
            <Text style={styles.competencyLine}>
              {a.competencyName}{a.level ? ` · L${a.level}` : ''}
            </Text>
          )}
          <Text style={styles.cardTitle}>{a.title}</Text>
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity
            onPress={() => (isEditing ? closeEdit() : openEdit())}
            activeOpacity={0.7}
            style={styles.iconBtn}
          >
            <Ionicons name={isEditing ? 'close' : 'pencil-outline'} size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={confirmWithdraw}
            disabled={withdrawing}
            activeOpacity={0.7}
            style={styles.iconBtn}
          >
            {withdrawing ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            )}
          </TouchableOpacity>
        </View>
      </View>
      {!!a.description && <Text style={styles.subtle}>{a.description}</Text>}
      {!!due && (
        <Text style={styles.subtle}>
          {t('advisor.assignmentDueDate')}: {due.toLocaleDateString(i18n.language)}
        </Text>
      )}
      {outOfScope && (
        <Text style={styles.warning}>{t('advisor.assignmentOutOfScope')}</Text>
      )}

      {isDraft ? (
        // A draft cannot have submissions -- the counts row below would only
        // ever read 0/0/0, which is indistinguishable from "loaded and
        // empty". This badge is what actually says "not yet sent".
        <Text style={styles.draftBadge}>{t('advisor.draftBadge')}</Text>
      ) : (
        // approved and "sent back" are subsets of submitted, not further
        // buckets alongside it -- the parenthesis is what says so.
        <Text style={styles.subtle}>
          {countsUnavailable ? (
            t('advisor.assignmentCountsUnavailable')
          ) : (
            <>
              {t('advisor.submittedCount', { count: counts.submitted })}
              {' ('}
              {t('advisor.approvedCount', { count: counts.approved })}
              {', '}
              {t('advisor.revisionCount', { count: counts.needsRevision })}
              {')'}
            </>
          )}
          {' / '}
          {t('advisor.memberCount', { count: memberCount })}
        </Text>
      )}

      {isEditing && (
        <View style={styles.editPanel}>
          <Text style={styles.editPanelTitle}>{t('advisor.editAssignment')}</Text>

          <Text style={styles.label}>{t('advisor.assignmentTitle')}</Text>
          <TextInput
            style={styles.input}
            value={editTitle}
            onChangeText={setEditTitle}
            placeholderTextColor={colors.textDisabled}
          />

          <Text style={styles.label}>{t('advisor.assignmentDescription')}</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            value={editDescription}
            onChangeText={setEditDescription}
            placeholderTextColor={colors.textDisabled}
            multiline
          />

          <Text style={styles.label}>{t('advisor.assignmentObjective')}</Text>
          <TextInput
            style={[
              styles.input,
              styles.multilineInput,
              !canEditTerms && styles.inputDisabled,
            ]}
            value={editObjective}
            onChangeText={setEditObjective}
            editable={canEditTerms}
            multiline
          />

          <Text style={styles.label}>{t('advisor.assignmentCriterion')}</Text>
          <TextInput
            style={[
              styles.input,
              styles.multilineInput,
              !canEditTerms && styles.inputDisabled,
            ]}
            value={editCriterion}
            onChangeText={setEditCriterion}
            editable={canEditTerms}
            multiline
          />

          {/* Two different reasons for one locked state, and they must not be
              confused: "students have already submitted" is a fact, and
              asserting it when the counts never loaded would be inventing
              one. A draft is never locked, so this only ever shows on a sent
              card. */}
          {!canEditTerms && (
            <Text style={styles.lockedHint}>
              {countsUnavailable
                ? t('advisor.assignmentTermsLockedUnknown')
                : t('advisor.assignmentTermsLocked')}
            </Text>
          )}

          <Text style={styles.label}>{t('advisor.assignmentDueDate')}</Text>
          <TouchableOpacity
            style={styles.dateField}
            onPress={() => setEditShowDatePicker(true)}
            activeOpacity={0.7}
          >
            <Text style={editDueDate ? styles.dateValue : styles.datePlaceholder}>
              {editDueDate
                ? fromIsoDate(editDueDate)?.toLocaleDateString(i18n.language)
                : t('student.selectDate', 'Select a date')}
            </Text>
            <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          {editShowDatePicker && (
            <View style={Platform.OS === 'ios' ? styles.iosPickerBox : undefined}>
              <DateTimePicker
                value={fromIsoDate(editDueDate) || new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event, selected) => {
                  if (Platform.OS === 'android') setEditShowDatePicker(false);
                  if (event.type === 'dismissed' || !selected) return;
                  setEditDueDate(toIsoDate(selected));
                }}
              />
              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  style={styles.iosPickerDone}
                  onPress={() => setEditShowDatePicker(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.iosPickerDoneText}>{t('common.done')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {isDraft && (
            <>
              <Text style={styles.label}>{t('advisor.assignmentDocument')}</Text>
              {a.documentName ? (
                <View style={styles.documentRow}>
                  <Ionicons name="document-outline" size={18} color={colors.primary} />
                  <Text style={styles.documentName} numberOfLines={1}>{a.documentName}</Text>
                  {attaching ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <TouchableOpacity onPress={attachDocument} hitSlop={8}>
                        <Text style={styles.linkText}>{t('advisor.replaceDocument')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={removeDocument} hitSlop={8}>
                        <Ionicons name="close-circle" size={20} color={colors.error} />
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.addBtn, attaching && styles.addBtnDisabled]}
                  onPress={attachDocument}
                  disabled={attaching}
                  activeOpacity={0.7}
                >
                  {attaching ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="attach" size={18} color={colors.primary} />
                      <Text style={styles.addBtnText}>{t('advisor.attachDocument')}</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </>
          )}

          <View style={styles.editActionsRow}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={closeEdit}
              disabled={editSaving}
              activeOpacity={0.7}
            >
              <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, styles.editSaveBtn]}
              onPress={handleUpdate}
              disabled={editSaving}
              activeOpacity={0.7}
            >
              {editSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
  competencyLine: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardTitleFlex: {
    flex: 1,
    marginRight: spacing.sm,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  iconBtn: {
    padding: spacing.xs,
  },
  subtle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  draftBadge: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: colors.status.draft,
    marginTop: spacing.xs,
  },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
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
    marginBottom: spacing.sm,
  },
  multilineInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    backgroundColor: colors.surface,
    color: colors.textDisabled,
  },
  warning: {
    fontSize: 13,
    color: colors.warning,
    marginTop: spacing.xs,
  },
  editPanel: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  editPanelTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  lockedHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
  editActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  primaryBtn: {
    backgroundColor: colors.info,
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
  editSaveBtn: {
    flex: 1,
    marginTop: 0,
  },

  // Due date
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    marginBottom: spacing.sm,
  },
  dateValue: {
    fontSize: 15,
    color: colors.text,
  },
  datePlaceholder: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  iosPickerBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
  },
  iosPickerDone: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.info,
    borderRadius: borderRadius.sm,
  },
  iosPickerDoneText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  // Document attach (draft cards only)
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    marginBottom: spacing.sm,
  },
  documentName: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
  },
  linkText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.primary + '40',
    borderStyle: 'dashed',
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    backgroundColor: colors.primary + '06',
    marginBottom: spacing.sm,
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
});
