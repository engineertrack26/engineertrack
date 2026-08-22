import { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, TextInput,
  TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { assignmentService } from '@/services/assignments';
import { competencyService } from '@/services/competency';
import { groupService } from '@/services/group';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store/authStore';
import { mapRpcError } from '@/utils/rpcErrors';
import { colors, spacing, borderRadius } from '@/theme';
import type { Competency, CompetencyKpi } from '@/types/competency';
import type { GroupAssignment, KpiTriplet } from '@/types/assignment';
import type { GroupMember } from '@/types/group';

const ADVISOR_COLOR = colors.info;
const LEVELS = [1, 2, 3, 4];

// The database column is DATE and the rest of the app passes these around as
// 'YYYY-MM-DD' strings, so that stays the stored shape. Only the display
// changes.
//
// Both helpers work in LOCAL time on purpose. toISOString() converts local
// midnight to UTC, which in any positive offset lands on the previous day, and
// new Date('2026-09-01') is parsed as UTC and then rendered locally, which does
// the same thing in reverse. Either one silently shifts the due date by a day.
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

type SubmissionCounts = Record<string, { submitted: number; approved: number }>;

export default function GroupAssignmentsScreen() {
  const { t, i18n } = useTranslation();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const user = useAuthStore((s) => s.user);

  const [assignments, setAssignments] = useState<GroupAssignment[]>([]);
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [kpis, setKpis] = useState<CompetencyKpi[]>([]);
  // The whole roster, not just its length: a later task notifies every member
  // when an assignment is created and needs each one's profile id, and
  // re-deriving that list on the hot path risks it disagreeing with this one.
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [submissionCounts, setSubmissionCounts] = useState<SubmissionCounts>({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [pickedCompetency, setPickedCompetency] = useState<string | null>(null);
  const [pickedLevel, setPickedLevel] = useState<number | null>(null);
  const [pickedTriplet, setPickedTriplet] = useState<KpiTriplet | null>(null);
  const [triplets, setTriplets] = useState<KpiTriplet[]>([]);
  // Discards a level fetch that a later tap has superseded -- readable
  // inside the async continuation without re-rendering or a stale closure.
  const levelRequest = useRef(0);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [objective, setObjective] = useState('');
  const [criterion, setCriterion] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const loadData = useCallback(async () => {
    if (!groupId) return;
    try {
      const [existing, framework, targets, groupMembers] = await Promise.all([
        assignmentService.listGroupAssignments(groupId),
        competencyService.listFramework(),
        competencyService.getGroupTargets(groupId),
        groupService.listMembers(groupId),
      ]);
      setAssignments(existing);
      const inScope = new Set(targets.map((tg) => tg.competencyId));
      setCompetencies(framework.competencies.filter((c) => inScope.has(c.id)));
      setKpis(framework.kpis);
      setMembers(groupMembers);

      // Building the query at all when there is nothing to filter by is
      // wasted work, and .in() with an empty array returns nothing anyway.
      if (existing.length > 0) {
        const { data, error } = await supabase
          .from('assignment_submissions')
          .select('assignment_id, status')
          .in('assignment_id', existing.map((a) => a.id));
        if (error) throw error;
        const counts: SubmissionCounts = {};
        for (const row of data || []) {
          const r = row as Record<string, unknown>;
          const id = r.assignment_id as string;
          const status = r.status as string;
          if (!counts[id]) counts[id] = { submitted: 0, approved: 0 };
          counts[id].submitted += 1;
          if (status === 'approved') counts[id].approved += 1;
        }
        setSubmissionCounts(counts);
      } else {
        setSubmissionCounts({});
      }
    } catch (err) {
      console.error('Load assignments error:', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  function chooseCompetency(id: string) {
    setPickedCompetency(id);
    setPickedLevel(null);
    setPickedTriplet(null);
    setTriplets([]);
  }

  async function chooseLevel(level: number) {
    const request = ++levelRequest.current;
    setPickedLevel(level);
    setPickedTriplet(null);
    setTriplets([]);
    const levelKpis = kpis.filter(
      (k) => k.competencyId === pickedCompetency && k.level === level,
    );
    const lists = await Promise.all(levelKpis.map((k) => assignmentService.listTriplets(k.id)));
    // A later tap already superseded this fetch. setPickedLevel is synchronous
    // and the fetch is not, so without this the last response to ARRIVE wins
    // rather than the last one requested, and the list can show one level's
    // triplets under another level's highlighted chip.
    if (request !== levelRequest.current) return;
    setTriplets(lists.flat());
  }

  function chooseTriplet(tr: KpiTriplet) {
    setPickedTriplet(tr);
    setTitle(tr.task);
    setObjective(tr.objective);
    setCriterion(tr.criterion);
  }

  function resetForm() {
    setPickedCompetency(null);
    setPickedLevel(null);
    setPickedTriplet(null);
    setTriplets([]);
    setTitle('');
    setDescription('');
    setObjective('');
    setCriterion('');
    setDueDate('');
  }

  async function handleAssign() {
    if (!groupId || !pickedTriplet || !user) return;
    if (!title.trim()) {
      Alert.alert(t('common.error'), t('advisor.assignmentTitleRequired'));
      return;
    }
    setSaving(true);
    try {
      await assignmentService.createAssignment({
        groupId,
        tripletId: pickedTriplet.id,
        title: title.trim(),
        description: description.trim() || undefined,
        objective: objective.trim(),
        criterion: criterion.trim(),
        dueDate: dueDate || undefined,
        createdBy: user.id,
      });
      Alert.alert(t('common.done'), t('advisor.assignmentCreated'));
      resetForm();
      await loadData();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setSaving(false);
    }
  }

  // A level has two KPIs and each holds ten triplets, so the picker shows
  // twenty. Grouping under the KPI's statement reads "for this behaviour,
  // these ten tasks" rather than a flat list of twenty.
  const tripletGroups = Array.from(new Set(triplets.map((tr) => tr.kpiId))).map((kpiId) => ({
    kpiId,
    statement: kpis.find((k) => k.id === kpiId)?.statement || '',
    items: triplets.filter((tr) => tr.kpiId === kpiId),
  }));

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loading}><ActivityIndicator size="large" color={ADVISOR_COLOR} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ADVISOR_COLOR]} />
        }
      >
        <Text style={styles.screenTitle}>{t('advisor.assignments')}</Text>

        {assignments.length === 0 && (
          <Text style={styles.hint}>{t('advisor.noAssignments')}</Text>
        )}

        {assignments.map((a) => {
          const counts = submissionCounts[a.id] || { submitted: 0, approved: 0 };
          const due = a.dueDate ? fromIsoDate(a.dueDate) : null;
          return (
            <View key={a.id} style={styles.card}>
              <Text style={styles.cardTitle}>{a.title}</Text>
              {!!a.description && <Text style={styles.subtle}>{a.description}</Text>}
              {!!due && (
                <Text style={styles.subtle}>
                  {t('advisor.assignmentDueDate')}: {due.toLocaleDateString(i18n.language)}
                </Text>
              )}
              {/* approved is a subset of submitted, not a fourth bucket
                  alongside it -- the parenthesis is what says so. */}
              <Text style={styles.subtle}>
                {t('advisor.submittedCount', { count: counts.submitted })}
                {' ('}{t('advisor.approvedCount', { count: counts.approved })}{')'} / {' '}
                {t('advisor.memberCount', { count: members.length })}
              </Text>
            </View>
          );
        })}

        <Text style={styles.label}>{t('advisor.pickCompetency')}</Text>
        {competencies.length === 0 && (
          <Text style={styles.hint}>{t('advisor.noCompetencies')}</Text>
        )}
        <View style={styles.chipRow}>
          {competencies.map((c) => {
            const active = pickedCompetency === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => chooseCompetency(c.id)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {pickedCompetency && (
          <>
            <Text style={styles.label}>{t('advisor.pickLevel')}</Text>
            <View style={styles.levelRow}>
              {LEVELS.map((level) => {
                const active = pickedLevel === level;
                return (
                  <TouchableOpacity
                    key={level}
                    style={[styles.levelChip, active && styles.levelChipActive]}
                    onPress={() => chooseLevel(level)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.levelText, active && styles.levelTextActive]}>
                      L{level}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {pickedLevel !== null && tripletGroups.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.label}>{t('advisor.pickTriplet')}</Text>
            {tripletGroups.map((group) => (
              <View key={group.kpiId} style={styles.kpiGroup}>
                <Text style={styles.kpiStatement}>{group.statement}</Text>
                {group.items.map((tr) => {
                  const active = pickedTriplet?.id === tr.id;
                  return (
                    <TouchableOpacity
                      key={tr.id}
                      style={[styles.tripletRow, active && styles.tripletRowActive]}
                      onPress={() => chooseTriplet(tr)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.tripletText, active && styles.tripletTextActive]}>
                        {tr.task}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {pickedTriplet && (
          <View style={styles.card}>
            <Text style={styles.label}>{t('advisor.assignmentTitle')}</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholderTextColor={colors.textDisabled}
            />

            <Text style={styles.label}>{t('advisor.assignmentDescription')}</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={description}
              onChangeText={setDescription}
              placeholderTextColor={colors.textDisabled}
              multiline
            />

            <Text style={styles.label}>{t('advisor.assignmentObjective')}</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={objective}
              onChangeText={setObjective}
              multiline
            />

            <Text style={styles.label}>{t('advisor.assignmentCriterion')}</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={criterion}
              onChangeText={setCriterion}
              multiline
            />

            <Text style={styles.label}>{t('advisor.assignmentDueDate')}</Text>
            <TouchableOpacity
              style={styles.dateField}
              onPress={() => setShowDatePicker(true)}
              activeOpacity={0.7}
            >
              <Text style={dueDate ? styles.dateValue : styles.datePlaceholder}>
                {dueDate
                  ? fromIsoDate(dueDate)?.toLocaleDateString(i18n.language)
                  : t('student.selectDate', 'Select a date')}
              </Text>
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            {showDatePicker && (
              <View style={Platform.OS === 'ios' ? styles.iosPickerBox : undefined}>
                <DateTimePicker
                  value={fromIsoDate(dueDate) || new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selected) => {
                    if (Platform.OS === 'android') setShowDatePicker(false);
                    if (event.type === 'dismissed' || !selected) return;
                    setDueDate(toIsoDate(selected));
                  }}
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    style={styles.iosPickerDone}
                    onPress={() => setShowDatePicker(false)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.iosPickerDoneText}>{t('common.done')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleAssign}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('advisor.assign')}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

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
    marginBottom: spacing.md,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
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
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  subtle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
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

  // Competency chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: ADVISOR_COLOR,
    borderColor: ADVISOR_COLOR,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: '#fff',
  },

  // Level picker
  levelRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  levelChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.background,
  },
  levelChipActive: {
    backgroundColor: ADVISOR_COLOR,
    borderColor: ADVISOR_COLOR,
  },
  levelText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  levelTextActive: {
    color: '#fff',
  },

  // Triplet picker
  kpiGroup: {
    marginBottom: spacing.md,
  },
  kpiStatement: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  tripletRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    marginBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  tripletRowActive: {
    backgroundColor: ADVISOR_COLOR,
    borderColor: ADVISOR_COLOR,
  },
  tripletText: {
    fontSize: 13,
    color: colors.text,
  },
  tripletTextActive: {
    color: '#fff',
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
    backgroundColor: ADVISOR_COLOR,
    borderRadius: borderRadius.sm,
  },
  iosPickerDoneText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  // Save button
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
});
