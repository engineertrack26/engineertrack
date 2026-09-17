import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity, Share, Alert, TextInput, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { advisorService } from '@/services/advisor';
import { groupService } from '@/services/group';
import { BackButton, LoadFailedBanner } from '@/components/common';
import { AdvisorBell, GroupModal, groupStyles } from '@/components/advisor/GroupUI';
import { ui } from '@/components/common/workflowStyles';
import { selectAdvisorGroup, groupCenterRoute } from '@/utils/advisorGroups';
import { attendanceDayRows, attendanceSummaryRows, csvRow, filterReportStudents } from '@/utils/advisorReportView';
import { gapTag, selfVsMentorCsvRows, weightedAverage } from '@/utils/selfAssessment';
import { colors } from '@/theme';
import type { InternshipGroup } from '@/types/group';
import type { AttendanceDayRow, GroupReportData } from '@/types/report';

export default function ReportsScreen() {
  const { groupId, entry } = useLocalSearchParams<{ groupId?: string; entry?: string }>();
  const userId = useAuthStore((s) => s.user?.id);
  const requested = typeof groupId === 'string' ? groupId : undefined;
  return userId ? <ReportsContent key={userId + ':' + (requested ?? '') + ':' + (entry ?? '')}
    advisorId={userId} initialGroupId={requested} /> : null;
}

function ReportsContent({ advisorId, initialGroupId }: { advisorId: string; initialGroupId?: string }) {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 370 || fontScale > 1.25;
  const [groups, setGroups] = useState<InternshipGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [data, setData] = useState<GroupReportData | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [groupsFailed, setGroupsFailed] = useState(false);
  const [reportFailed, setReportFailed] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [tab, setTab] = useState<'summary' | 'competencies' | 'students' | 'attendance'>('summary');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'progress'>('name');
  const selectedRef = useRef<string | null>(null);
  const reportRequest = useRef(0);
  const groupRequest = useRef(0);
  const exportLock = useRef(false);
  const active = useRef(false);

  const selectGroup = useCallback((id: string | null) => {
    selectedRef.current = id; setSelectedGroupId(id); setSearch(''); setSort('name');
    navigation.setParams({ activeGroupId: id ?? '' } as never);
  }, [navigation]);
  const loadReport = useCallback(async (id: string | null) => {
    const request = ++reportRequest.current;
    setData(null); setReportFailed(false);
    if (!id) { setLoadingReport(false); return; }
    setLoadingReport(true);
    const current = () => request === reportRequest.current && active.current &&
      useAuthStore.getState().user?.id === advisorId;
    try {
      const result = await advisorService.getReportsData(id);
      if (current()) {
        if (result.groupId !== id) throw new Error('Mismatched report group');
        setData(result);
      }
    } catch {
      if (current()) setReportFailed(true);
    } finally { if (current()) setLoadingReport(false); }
  }, [advisorId]);

  const loadGroups = useCallback(async () => {
    const request = ++groupRequest.current;
    reportRequest.current += 1;
    setLoadingGroups(true); setData(null);
    const current = () => request === groupRequest.current && active.current &&
      useAuthStore.getState().user?.id === advisorId;
    try {
      const list = await groupService.listMyGroups(advisorId);
      if (!current()) return;
      setGroups(list); setGroupsFailed(false);
      const id = selectAdvisorGroup(list, selectedRef.current, initialGroupId);
      selectGroup(id);
      await loadReport(id);
    } catch {
      if (current()) { setGroupsFailed(true); setLoadingReport(false); }
    } finally {
      if (current()) { setLoadingGroups(false); setRefreshing(false); }
    }
  }, [advisorId, initialGroupId, selectGroup, loadReport]);
  useFocusEffect(useCallback(() => {
    active.current = true; void loadGroups();
    return () => { active.current = false; reportRequest.current += 1; groupRequest.current += 1; };
  }, [loadGroups]));

  function chooseGroup(id: string) {
    if (loadingGroups || exporting) return;
    setChoosing(false);
    if (id === selectedRef.current) return;
    selectGroup(id); void loadReport(id);
  }
  const canExport = !!data && data.groupId === selectedGroupId && !loadingReport && !loadingGroups && !groupsFailed && !reportFailed;
  async function handleExportCSV() {
    if (!data || !canExport || exportLock.current || useAuthStore.getState().user?.id !== advisorId) return;
    exportLock.current = true; setExporting(true);
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
          t('assessment.csvColSelf'),
          t('assessment.csvColMentor'),
          t('assessment.csvColGap'),
        ]),
      );
      data.studentProgress.forEach((s) => {
        lines.push(csvRow([
          s.name, s.completionPercent, s.submitted, s.approved,
          weightedAverage(s.selfVsMentor, 'avgSelf') ?? '',
          weightedAverage(s.selfVsMentor, 'avgMentor') ?? '',
          s.selfVsMentorGap ?? '',
        ]));
      });

      // One row per student x competency -- students with no rated
      // submissions simply contribute none, same as their blank cells in the
      // Student table above.
      lines.push('');
      lines.push(t('assessment.csvHeader'));
      lines.push(
        csvRow([
          t('advisor.csvColName'),
          t('advisor.csvColCompetency'),
          t('assessment.csvColTasks'),
          t('assessment.csvColSelf'),
          t('assessment.csvColMentor'),
          t('assessment.csvColGap'),
        ]),
      );
      data.studentProgress.forEach((s) => {
        selfVsMentorCsvRows(s.selfVsMentor).forEach((row) => lines.push(csvRow([s.name, ...row])));
      });

      // Attendance: the section a university asks for as proof. Totals per
      // student, then every internship day with the mentor's decision -- the
      // day rows are the record, the totals are the summary of it. Absent
      // entirely when the module is not installed, rather than an empty table
      // that reads as "nobody attended".
      if (data.attendance) {
        const att = data.attendance;
        lines.push('');
        lines.push(t('advisorReports.csvAttendanceHeader', 'Attendance'));
        lines.push(csvRow([
          t('advisor.csvColName'), t('advisorReports.csvColCompany', 'Workplace'), t('advisorReports.csvColMentor', 'Mentor'),
          t('advisorReports.csvColExpectedSoFar', 'Working days so far'), t('advisorReports.csvColExpectedTotal', 'Working days in internship'),
          t('advisorReports.csvColUnrecorded', 'Days without a record'),
          attendanceLabel('present'), attendanceLabel('partial'), attendanceLabel('excused'), attendanceLabel('absent'), attendanceLabel('pending'),
          t('advisorReports.csvColCorrections', 'Corrections requested'), t('advisorReports.csvColSubmittedLogs', 'Journals submitted'),
        ]));
        attendanceSummaryRows(att.students, i18n.language).forEach((row) => lines.push(csvRow(row)));
        lines.push(csvRow([t('advisorReports.csvAttendanceNote', 'Working days are Monday to Friday between the internship dates; public holidays are not excluded. A day without a record is unknown, not absent.')]));
        lines.push('');
        lines.push(t('advisorReports.csvAttendanceDaysHeader', 'Attendance days'));
        lines.push(csvRow([
          t('advisor.csvColName'), t('advisorReports.csvColDate', 'Date'), t('advisorReports.csvColAttendance', 'Attendance'),
          t('advisorReports.csvColCheckedIn', 'Checked in on the day'), t('advisorReports.csvColCheckInAt', 'Check-in time'),
          t('advisorReports.csvColDecidedBy', 'Decided by'), t('advisorReports.csvColDecidedAt', 'Decided at'),
          t('advisorReports.csvColCorrection', 'Correction requested'), t('advisorReports.csvColLog', 'Journal'),
        ]));
        attendanceDayRows(att.days, i18n.language, {
          yes: t('common.yes', 'Yes'), no: t('common.no', 'No'), attendance: attendanceLabel,
          logStatus: (value) => t('advisorReports.log_' + value, value === 'submitted' ? 'Submitted' : 'Not submitted'),
        }).forEach((row) => lines.push(csvRow(row)));
      }

      await Share.share({
        message: lines.join('\n'),
        title: t('advisor.exportTitle', { group: data.groupName }),
      });

    } catch {
      Alert.alert(t('advisor.exportErrorTitle'), t('advisor.exportFailed'));
    } finally { exportLock.current = false; setExporting(false); }
  }

  function attendanceLabel(value: AttendanceDayRow['attendance']): string {
    const defaults = { present: 'Present', partial: 'Partial', excused: 'Excused', absent: 'Absent', pending: 'Awaiting decision' };
    return t('advisorReports.attendance_' + value, defaults[value]);
  }
  const attendanceStudents = data?.attendance
    ? [...data.attendance.students].sort((a, b) => a.name.localeCompare(b.name, i18n.language) || a.id.localeCompare(b.id)) : [];

  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const matchingGroups = groups.filter((group) => (group.name + ' ' + (group.term ?? ''))
    .toLocaleLowerCase(i18n.language).includes(groupSearch.trim().toLocaleLowerCase(i18n.language)));
  const students = data ? filterReportStudents(data.studentProgress, search, sort, i18n.language) : [];

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} colors={[colors.primaryDark]}
        onRefresh={() => { setRefreshing(true); void loadGroups(); }} />}>
      <View style={ui.header}><View style={{ flex: 1 }}><BackButton href={selectedGroupId
        ? groupCenterRoute(selectedGroupId) : { pathname: '/(advisor)/groups', params: { groupId: '' } }} /></View><AdvisorBell /></View>
      <Text style={ui.title} accessibilityRole="header">{t('advisor.reportsTitle')}</Text>
      <Text style={ui.secondary}>{t('advisorReports.intro')}</Text>
      <TouchableOpacity style={[ui.card, ui.header]} accessibilityRole="button"
        accessibilityLabel={t('advisor.reportGroupLabel')} accessibilityState={{ disabled: loadingGroups || exporting }}
        disabled={loadingGroups || exporting} onPress={() => { setGroupSearch(''); setChoosing(true); }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={ui.secondary}>{t('advisor.reportGroupLabel')}</Text>
          <Text style={ui.cardTitle}>{selectedGroup?.name || t('advisorReports.selectGroup')}</Text>
          {!!selectedGroup?.term && <Text style={ui.secondary}>{selectedGroup.term}</Text>}
          {selectedGroup?.isArchived && <Text style={ui.secondary}>{t('advisorGroups.archived')}</Text>}
        </View>
        <Ionicons name="chevron-down" size={24} color={colors.primaryDark} />
      </TouchableOpacity>
      {(groupsFailed || reportFailed) && <LoadFailedBanner onRetry={() => void loadGroups()} />}
      {loadingGroups || loadingReport ? <ActivityIndicator size="large" color={colors.primaryDark} /> :
        !data ? !groupsFailed && !reportFailed && <View style={ui.card}>
          <Text style={ui.body}>{t(groups.length === 0 ? 'advisor.noGroupsForReports' : 'advisorGroups.unavailable')}</Text>
        </View> : <>
          <View style={styles.tabs} accessibilityRole="tablist">
            {(['summary', 'competencies', 'students', 'attendance'] as const).map((value) => <TouchableOpacity
              key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }}
              style={[styles.tab, tab === value && styles.selected]} onPress={() => setTab(value)}>
              <Text style={groupStyles.linkText}>{value === 'attendance' ? t('advisorReports.attendance', 'Attendance') : t('advisorReports.' + value)}</Text>
            </TouchableOpacity>)}
          </View>
          {tab === 'summary' && <>
            <View style={[styles.metrics, stacked && { flexDirection: 'column' }]}>
              <Metric title={t('advisor.statStudents')} value={data.studentCount} />
              <Metric title={t('advisorMonitor.progress')} value={data.studentCount ? data.averageCompletion + '%' : '—'} />
            </View>
            <Text style={ui.secondary}>{t('advisorHome.progressHint')}</Text>
            <View style={ui.card}>
              <Text style={ui.section}>{t('advisorReports.submissions')}</Text>
              {[
                [t('advisor.statSubmitted'), data.submitted],
                [t('advisor.statApproved'), data.approved],
                [t('advisor.csvColNeedsRevision'), data.needsRevision],
              ].map(([label, value]) => <View style={ui.header} key={label}>
                <Text style={[ui.body, { flex: 1 }]}>{label}</Text><Text style={ui.label}>{value}</Text>
              </View>)}
              <Text style={ui.secondary}>{t('advisor.csvSubsetNote')}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" style={groupStyles.outline} onPress={() => setTab('competencies')}>
              <Text style={groupStyles.linkText}>{t('advisor.competencyCompletion')}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={groupStyles.outline} onPress={() => setTab('students')}>
              <Text style={groupStyles.linkText}>{t('advisor.studentCompletion')}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={groupStyles.outline} onPress={() => setTab('attendance')}>
              <Text style={groupStyles.linkText}>{t('advisorReports.attendance', 'Attendance')}</Text>
            </TouchableOpacity>
          </>}
          {tab === 'competencies' && <>
            <Text style={ui.section} accessibilityRole="header">{t('advisor.competencyCompletion')}</Text>
            {!data.competencyBreakdown.length ? <Text style={ui.body}>{t(data.studentCount === 0
              ? 'advisor.noCompetencyDataNoStudents' : 'advisor.noCompetencyData')}</Text> :
              data.competencyBreakdown.map((competency) => <View key={competency.competencyId} style={ui.card}>
                <Text style={ui.cardTitle}>{competency.competencyName}</Text>
                <Text style={ui.secondary}>{t('advisor.targetLevelShort', { level: competency.targetLevel })}</Text>
                <Text style={ui.label}>{t('advisor.studentsAtTarget', { atTarget: competency.studentsAtTarget, total: data.studentCount })}</Text>
                <ReportProgress label={competency.competencyName} percent={data.studentCount
                  ? competency.studentsAtTarget / data.studentCount * 100 : 0} />
              </View>)}
          </>}
          {tab === 'students' && <>
            <Text style={ui.section} accessibilityRole="header">{t('advisor.studentCompletion')}</Text>
            <TextInput value={search} onChangeText={setSearch} style={ui.input} autoCorrect={false}
              accessibilityLabel={t('advisorReports.search')} placeholder={t('advisorReports.search')} placeholderTextColor={colors.textSecondary} />
            <View style={styles.tabs}>
              {(['name', 'progress'] as const).map((value) => <TouchableOpacity key={value} accessibilityRole="button"
                accessibilityState={{ selected: sort === value }} style={[styles.tab, sort === value && styles.selected]}
                onPress={() => setSort(value)}><Text style={groupStyles.linkText}>{t('advisorReports.sort_' + value)}</Text></TouchableOpacity>)}
            </View>
            <Text style={ui.secondary} accessibilityLiveRegion="polite">{t('advisorMonitor.results', { shown: students.length, total: data.studentProgress.length })}</Text>
            {!students.length && <Text style={ui.body}>{t(search.trim() ? 'advisorGroups.noMatches' : 'advisor.noStudentsYet')}</Text>}
            {students.map((student) => <View key={student.id} style={ui.card}>
              <View style={groupStyles.row}>
                <Text style={[ui.cardTitle, { flex: 1 }]}>{student.name}</Text>
                {data.closedStudentIds.includes(student.id) &&
                  <Text style={[ui.badge, { color: colors.primaryDark, backgroundColor: '#eaf2fe' }]}>{t('closure.badge', 'Closed')}</Text>}
              </View>
              <Text style={ui.label}>{t('advisorMonitor.progress')} · {student.completionPercent}%</Text>
              <ReportProgress label={student.name + ': ' + t('advisorMonitor.progress')} percent={student.completionPercent} />
              <Text style={ui.secondary}>{t('advisor.submittedCount', { count: student.submitted })}
                {' ('}{t('advisor.approvedCount', { count: student.approved })}{')'}</Text>
              <Text style={ui.secondary}>{t('assessment.selfVsMentor', 'Self vs mentor')}
                {': '}{student.selfVsMentorGap == null ? '—'
                  : (student.selfVsMentorGap >= 0 ? '+' : '') + student.selfVsMentorGap.toFixed(1)}</Text>
              {student.selfVsMentorGap != null && gapTag(student.selfVsMentorGap) && <Text style={[ui.label, { color: colors.warning }]}>
                {t(gapTag(student.selfVsMentorGap) === 'high' ? 'assessment.ratesHigh' : 'assessment.ratesLow',
                  gapTag(student.selfVsMentorGap) === 'high' ? 'Rates self high' : 'Rates self low')}
              </Text>}
            </View>)}
          </>}
          {tab === 'attendance' && <>
            <Text style={ui.section} accessibilityRole="header">{t('advisorReports.attendance', 'Attendance')}</Text>
            {!data.attendance ? <Text style={ui.body}>{t('advisorReports.attendanceNotInstalled', 'The internship-days module is not installed on this database.')}</Text> :
              !attendanceStudents.length ? <Text style={ui.body}>{t('advisorReports.noAttendance', 'No internship days have been recorded in this group yet.')}</Text> : <>
              <Text style={ui.secondary}>{t('advisorReports.attendanceHint', 'Days the students recorded in the app and what their mentors decided. Working days are Monday to Friday between the internship dates, public holidays included; a day without a record is unknown, not absent.')}</Text>
              {attendanceStudents.map((s) => <View key={s.id} style={ui.card}>
                <Text style={ui.cardTitle}>{s.name}</Text>
                {!!(s.company || s.mentor) && <Text style={ui.secondary}>{[s.company, s.mentor].filter(Boolean).join(' \u00b7 ')}</Text>}
                <Text style={ui.label}>{t('advisorReports.expectedSoFar', '{{recorded}} of {{expected}} working days recorded so far', { recorded: s.recorded, expected: s.expectedSoFar })}
                  {' \u00b7 '}{t('advisorReports.expectedTotal', '{{count}} in the whole internship', { count: s.expectedDays })}</Text>
                {s.unrecorded > 0 && <Text style={[ui.label, { color: colors.warning }]}>{t('advisorReports.unrecordedCount', '{{count}} working days without a record', { count: s.unrecorded })}</Text>}
                <View style={styles.counts}>
                  {([['present', s.present], ['partial', s.partial], ['excused', s.excused], ['absent', s.absent]] as const).map(([key, value]) =>
                    <View key={key} style={styles.count}><Text style={styles.countValue}>{value}</Text><Text style={ui.secondary}>{attendanceLabel(key)}</Text></View>)}
                </View>
                {(s.pending > 0 || s.corrections > 0) && <Text style={[ui.label, { color: colors.warning }]}>
                  {[s.pending > 0 ? t('advisorReports.pendingCount', '{{count}} awaiting the mentor', { count: s.pending }) : '',
                    s.corrections > 0 ? t('advisorReports.correctionCount', '{{count}} correction requested', { count: s.corrections }) : ''].filter(Boolean).join(' \u00b7 ')}
                </Text>}
                <Text style={ui.secondary}>{t('advisorReports.submittedLogs', '{{count}} journals submitted', { count: s.submittedLogs })}</Text>
              </View>)}
            </>}
          </>}
          <View style={ui.card}>
            <Text style={ui.secondary}>{t('advisorReports.exportHint')}</Text>
            <TouchableOpacity accessibilityRole="button" style={[ui.primary, (!canExport || exporting) && { opacity: 0.5 }]}
              accessibilityState={{ disabled: !canExport || exporting, busy: exporting }} disabled={!canExport || exporting} onPress={() => void handleExportCSV()}>
              {exporting ? <ActivityIndicator color="#fff" /> : <>
                <Ionicons name="share-outline" size={22} color="#fff" />
                <Text style={ui.primaryText}>{t('advisorReports.export')}</Text>
              </>}
            </TouchableOpacity>
          </View>
        </>}
    </ScrollView>
    {choosing && <GroupModal title={t('advisor.reportGroupLabel')} onClose={() => setChoosing(false)}>
      <TextInput style={ui.input} value={groupSearch} onChangeText={setGroupSearch} autoCorrect={false}
        accessibilityLabel={t('advisorGroups.search')} placeholder={t('advisorGroups.search')} />
      {matchingGroups.map((group) => <TouchableOpacity key={group.id} accessibilityRole="button"
        accessibilityState={{ selected: selectedGroupId === group.id, disabled: loadingGroups || exporting }}
        disabled={loadingGroups || exporting} style={[ui.card, group.id === selectedGroupId && styles.selected]}
        onPress={() => chooseGroup(group.id)}>
        <Text style={ui.label}>{group.name}</Text>
        {!!group.term && <Text style={ui.secondary}>{group.term}</Text>}
        {group.isArchived && <Text style={ui.secondary}>{t('advisorGroups.archived')}</Text>}
      </TouchableOpacity>)}
      {!matchingGroups.length && <Text style={ui.body}>{t('advisorGroups.noMatches')}</Text>}
    </GroupModal>}
  </SafeAreaView>;
}

function Metric({ title, value }: { title: string; value: string | number }) {
  return <View style={[ui.card, { flex: 1 }]}><Text style={styles.value}>{value}</Text><Text style={ui.secondary}>{title}</Text></View>;
}
function ReportProgress({ label, percent }: { label: string; percent: number }) {
  const value = Math.max(0, Math.min(100, percent));
  return <View style={styles.track} accessible accessibilityRole="progressbar" accessibilityLabel={label}
    accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }}>
    <View style={[styles.fill, { width: `${value}%` }]} />
  </View>;
}
const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.divider, justifyContent: 'center' },
  selected: { backgroundColor: '#eaf1fb', borderColor: colors.primaryDark },
  metrics: { flexDirection: 'row', gap: 12 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  count: { minWidth: 64, alignItems: 'center' },
  countValue: { fontSize: 22, color: colors.text, fontWeight: '700' },
  value: { fontSize: 30, color: colors.text, fontWeight: '700' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.divider },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.primaryDark },
});
