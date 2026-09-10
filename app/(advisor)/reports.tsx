import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Share,
  Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { advisorService } from '@/services/advisor';
import { groupService } from '@/services/group';
import { StatCard, ProgressBar } from '@/components/common';
import { colors, spacing, borderRadius } from '@/theme';
import type { InternshipGroup } from '@/types/group';
import type { GroupReportData } from '@/types/report';

const ADVISOR_COLOR = colors.info;

/** Quote a CSV field rather than stripping its commas: the group and student
 *  names are what an advisor reads to tell two exports apart, so mangling them
 *  defeats the point of naming the group at all. */
function csvCell(value: string | number): string {
  let s = String(value ?? '');
  // Excel and Sheets read a cell opening with =, +, - or @ as a formula, so a
  // student named "-Ali" or a group named "=2026" executes on open. A leading
  // apostrophe is the standard neutraliser and the sheet does not display it.
  // Numbers are exempt: every number here is our own arithmetic, and quoting a
  // negative one would only stop it parsing as a number.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(',');
}

/** The report payload carries one display name per student, not first/last, so
 *  initials come off the ends of it. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${parts[0][0]}${last}`.toUpperCase();
}

function completionColor(percent: number): string {
  if (percent >= 80) return colors.success;
  if (percent >= 50) return colors.warning;
  return colors.error;
}

export default function ReportsScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [groups, setGroups] = useState<InternshipGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [data, setData] = useState<GroupReportData | null>(null);

  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);

  // The selection is mirrored in a ref because loadGroups reads it, and
  // loadGroups must not be rebuilt when the selection changes: useFocusEffect
  // re-runs its callback whenever that callback's identity changes, so a state
  // dependency here would refetch the whole group list on every chip tap.
  const selectedRef = useRef<string | null>(null);
  // Discards a report fetch that a later chip tap or pull-to-refresh has
  // superseded -- the slower of two in-flight groups must not win the screen.
  const reportRequest = useRef(0);

  const selectGroup = useCallback((groupId: string | null) => {
    selectedRef.current = groupId;
    setSelectedGroupId(groupId);
  }, []);

  const loadReport = useCallback(async (groupId: string | null) => {
    if (!groupId) {
      setData(null);
      setLoadingReport(false);
      return;
    }
    const request = ++reportRequest.current;
    setLoadingReport(true);
    setFailed(false);
    try {
      const result = await advisorService.getReportsData(groupId);
      if (reportRequest.current === request) setData(result);
    } catch (err) {
      console.error('Reports load error:', err);
      if (reportRequest.current === request) {
        setData(null);
        setFailed(true);
      }
    } finally {
      if (reportRequest.current === request) setLoadingReport(false);
    }
  }, []);

  const loadGroups = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    try {
      const list = await groupService.listMyGroups(user.id);
      setGroups(list);
      // A previous failure has been superseded by this success. Without this,
      // an advisor who genuinely has no groups keeps seeing the failure card
      // for the rest of the session, and the retry it advises can never clear
      // it: the no-groups path calls loadReport(null), which returns before
      // reaching its own setFailed(false).
      setFailed(false);
      // Stay on the group the advisor was reading if it still exists.
      // Otherwise take the first ACTIVE one: listMyGroups orders by created_at
      // DESC, so list[0] is whatever was made last, and archiving a short or
      // mistaken term would silently park the screen on an empty group --
      // "Students 0, Avg. Completion 0%", the exact misreading the no-groups
      // empty state exists to avoid. Only when every group is archived does
      // list[0] win, because then there is nothing better to show.
      const current = selectedRef.current;
      const fallback = list.find((g) => !g.isArchived) ?? list[0];
      const next =
        current && list.some((g) => g.id === current) ? current : fallback?.id ?? null;
      selectGroup(next);
      return next;
    } catch (err) {
      // Leave `groups` as it was. An empty list renders as "you have no
      // groups", which a failed fetch must never be allowed to claim.
      console.error('Groups load error:', err);
      setFailed(true);
      return selectedRef.current;
    } finally {
      setLoadingGroups(false);
    }
  }, [user, selectGroup]);

  useFocusEffect(
    useCallback(() => {
      void loadGroups().then(loadReport);
    }, [loadGroups, loadReport]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const groupId = await loadGroups();
    await loadReport(groupId);
    setRefreshing(false);
  }, [loadGroups, loadReport]);

  const handleSelectGroup = useCallback(
    (groupId: string) => {
      if (groupId === selectedRef.current) return;
      selectGroup(groupId);
      void loadReport(groupId);
    },
    [selectGroup, loadReport],
  );

  const handleExportCSV = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const lines: string[] = [];

      // The group name leads the file. Two exports from two groups are
      // otherwise indistinguishable once they sit next to each other in a
      // downloads folder.
      lines.push(csvRow([t('advisor.csvGroupHeader'), data.groupName]));
      lines.push('');

      lines.push(t('advisor.csvSummaryHeader'));
      lines.push(
        csvRow([
          t('advisor.csvColStudents'),
          t('advisor.csvColAvgCompletion'),
          t('advisor.csvColSubmitted'),
          t('advisor.csvColApproved'),
          t('advisor.csvColNeedsRevision'),
        ]),
      );
      lines.push(
        csvRow([
          data.studentCount,
          data.averageCompletion,
          data.submitted,
          data.approved,
          data.needsRevision,
        ]),
      );
      // Approved and sent back are subsets of submitted. A reader who summed
      // the last three columns would otherwise double-count. This note names
      // both, unlike the on-screen one, because "Sent Back" is a real column
      // here and is not shown on screen at all.
      lines.push(csvRow([t('advisor.csvSubsetNote')]));
      lines.push('');

      lines.push(t('advisor.csvCompetencyHeader'));
      lines.push(
        csvRow([
          t('advisor.csvColCompetency'),
          t('advisor.csvColTargetLevel'),
          t('advisor.csvColStudentsAtTarget'),
          t('advisor.csvColStudents'),
        ]),
      );
      data.competencyBreakdown.forEach((c) => {
        lines.push(
          csvRow([c.competencyName, c.targetLevel, c.studentsAtTarget, data.studentCount]),
        );
      });
      lines.push('');

      lines.push(t('advisor.csvStudentHeader'));
      lines.push(
        csvRow([
          t('advisor.csvColName'),
          t('advisor.csvColCompletion'),
          t('advisor.csvColSubmitted'),
          t('advisor.csvColApproved'),
        ]),
      );
      data.studentProgress.forEach((s) => {
        lines.push(csvRow([s.name, s.completionPercent, s.submitted, s.approved]));
      });

      await Share.share({
        message: lines.join('\n'),
        title: t('advisor.exportTitle', { group: data.groupName }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('advisor.exportFailed');
      Alert.alert(t('advisor.exportErrorTitle'), msg);
    } finally {
      setExporting(false);
    }
  };

  if (loadingGroups) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const hasGroups = groups.length > 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      >
        <View style={styles.titleRow}>
          <Text style={styles.screenTitle}>{t('advisor.reportsTitle')}</Text>
          {/* No groups means no figures, so there is nothing to export -- an
              export button here would hand the advisor an empty CSV. */}
          {/* loadingReport is part of the condition because `data` still holds
              the PREVIOUS group's report while the newly-tapped one loads.
              Exporting then would hand the advisor group A's file under group
              B's highlighted chip. */}
          {hasGroups && (
            <TouchableOpacity
              style={[
                styles.exportBtn,
                (exporting || loadingReport || !data) && { opacity: 0.6 },
              ]}
              onPress={handleExportCSV}
              disabled={exporting || loadingReport || !data}
              activeOpacity={0.7}
            >
              {exporting ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="share-outline" size={18} color={colors.primary} />
                  <Text style={styles.exportBtnText}>{t('advisor.export')}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {!hasGroups ? (
          // A report of zeros would read as "your students have done nothing".
          // Say there are no groups instead, and render no report at all.
          <View style={styles.emptyCard}>
            <Ionicons
              name={failed ? 'alert-circle-outline' : 'folder-open-outline'}
              size={40}
              color={colors.textDisabled}
            />
            <Text style={styles.emptyText}>
              {failed ? t('advisor.reportLoadFailed') : t('advisor.noGroupsForReports')}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.label}>{t('advisor.reportGroupLabel')}</Text>
            <View style={styles.chipRow}>
              {groups.map((g) => {
                const active = g.id === selectedGroupId;
                return (
                  // An archived term is still worth reporting on, so it keeps
                  // its chip -- but it says so, in the same dimmed-plus-badge
                  // language groups.tsx already uses for archived groups.
                  <TouchableOpacity
                    key={g.id}
                    style={[
                      styles.chip,
                      active && styles.chipActive,
                      g.isArchived && { opacity: 0.6 },
                    ]}
                    onPress={() => handleSelectGroup(g.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {g.name}
                    </Text>
                    {g.isArchived && (
                      <Text style={styles.chipBadge}>{t('advisor.archived')}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {loadingReport && !refreshing ? (
              <View style={styles.inlineLoading}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : !data ? (
              <View style={styles.emptyCard}>
                <Ionicons name="alert-circle-outline" size={40} color={colors.textDisabled} />
                <Text style={styles.emptyText}>{t('advisor.reportLoadFailed')}</Text>
              </View>
            ) : (
              <>
                {/* Summary */}
                <View style={styles.statsGrid}>
                  <View style={styles.statsRow}>
                    <StatCard
                      title={t('advisor.statStudents')}
                      value={data.studentCount}
                      icon="people"
                      color={colors.primary}
                    />
                    <View style={{ width: spacing.sm }} />
                    <StatCard
                      title={t('advisor.statAvgCompletion')}
                      value={`${data.averageCompletion}%`}
                      icon="trending-up"
                      color={ADVISOR_COLOR}
                    />
                  </View>
                  <View style={styles.statsRow}>
                    <StatCard
                      title={t('advisor.statSubmitted')}
                      value={data.submitted}
                      icon="cloud-upload"
                      color={colors.warning}
                    />
                    <View style={{ width: spacing.sm }} />
                    <StatCard
                      title={t('advisor.statApproved')}
                      value={data.approved}
                      icon="checkmark-done"
                      color={colors.success}
                    />
                  </View>
                </View>
                {/* Approved sits inside submitted, not beside it. Two stat
                    cards side by side read as buckets, so this line says
                    otherwise in words. It speaks only of approved: sent back
                    is a CSV column, and naming it here would explain a number
                    the advisor cannot see. */}
                <Text style={styles.subsetNote}>{t('advisor.submissionSubsetNote')}</Text>

                {/* Competency completion */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{t('advisor.competencyCompletion')}</Text>
                  {data.competencyBreakdown.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Ionicons name="school-outline" size={40} color={colors.textDisabled} />
                      <Text style={styles.emptyText}>{t('advisor.noCompetencyData')}</Text>
                    </View>
                  ) : (
                    <View style={styles.breakdownCard}>
                      {data.competencyBreakdown.map((c) => (
                        <View key={c.competencyId} style={styles.competencyRow}>
                          <View style={styles.competencyTop}>
                            <View style={styles.competencyInfo}>
                              <Text style={styles.competencyName} numberOfLines={2}>
                                {c.competencyName}
                              </Text>
                              <Text style={styles.competencyMeta}>
                                {t('advisor.targetLevelShort', { level: c.targetLevel })}
                              </Text>
                            </View>
                            <Text style={styles.competencyValue}>
                              {t('advisor.studentsAtTarget', {
                                atTarget: c.studentsAtTarget,
                                total: data.studentCount,
                              })}
                            </Text>
                          </View>
                          <ProgressBar
                            progress={
                              data.studentCount > 0 ? c.studentsAtTarget / data.studentCount : 0
                            }
                            color={ADVISOR_COLOR}
                            height={6}
                          />
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Student completion */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{t('advisor.studentCompletion')}</Text>
                  {data.studentProgress.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Ionicons name="people-outline" size={40} color={colors.textDisabled} />
                      <Text style={styles.emptyText}>{t('advisor.noStudentsYet')}</Text>
                    </View>
                  ) : (
                    data.studentProgress.map((student) => (
                      <View key={student.id} style={styles.studentCard}>
                        <View style={styles.studentTop}>
                          <View style={styles.studentAvatar}>
                            <Text style={styles.studentInitials}>{initialsOf(student.name)}</Text>
                          </View>
                          <View style={styles.studentInfo}>
                            <Text style={styles.studentName} numberOfLines={1}>
                              {student.name}
                            </Text>
                            {/* approved is a subset of submitted, not a
                                further bucket -- the parenthesis is what says
                                so, same as AssignmentCard. */}
                            <Text style={styles.studentStat} numberOfLines={1}>
                              {t('advisor.submittedCount', { count: student.submitted })}
                              {' ('}
                              {t('advisor.approvedCount', { count: student.approved })}
                              {')'}
                            </Text>
                          </View>
                          <Text style={styles.completionPct}>{student.completionPercent}%</Text>
                        </View>
                        <ProgressBar
                          progress={student.completionPercent / 100}
                          color={completionColor(student.completionPercent)}
                          height={6}
                        />
                      </View>
                    ))
                  )}
                </View>
              </>
            )}
          </>
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
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineLoading: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.sm,
  },
  exportBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },

  // Group selector
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  chipBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    backgroundColor: colors.divider,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: borderRadius.full,
  },

  // Stats
  statsGrid: {
    gap: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
  },
  subsetNote: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },

  // Sections
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },

  // Competency breakdown
  breakdownCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  competencyRow: {
    paddingVertical: spacing.xs + 2,
  },
  competencyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  competencyInfo: {
    flex: 1,
  },
  competencyName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  competencyMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  competencyValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },

  // Student cards
  studentCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  studentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  studentAvatar: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  studentInitials: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  studentInfo: {
    flex: 1,
  },
  studentName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  studentStat: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  completionPct: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
    marginLeft: spacing.sm,
  },

  // Empty
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
