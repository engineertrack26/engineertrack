import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ui } from '@/components/common/workflowStyles';
import { LoadFailedBanner, Stamp } from '@/components/common';
import { ReviewBack } from './ReviewUI';
import { StudentDates, StudentIdentity } from './StudentIdentity';
import { mentorStudentService } from '@/services/mentorStudents';
import { MentorStudent } from '@/utils/mentorStudents';
import { useAuthStore } from '@/store/authStore';
import { useClosureStatus } from '@/hooks/useClosureStatus';
import { colors } from '@/theme';

export function StudentDetail({ userId, studentId, onBack }: { userId: string; studentId: string; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const [student, setStudent] = useState<MentorStudent | null>(null);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof mentorStudentService.summary>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [countsFailed, setCountsFailed] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    const current = () => request === generation.current && useAuthStore.getState().user?.id === userId;
    setLoading(true); setFailed(false); setCountsFailed(false); setSummary(null);
    try {
      const students = await mentorStudentService.students(userId);
      if (!current()) return;
      const found = students.find(item => item.id === studentId) || null;
      setStudent(found);
      if (found) {
        try {
          const result = await mentorStudentService.summary(studentId);
          if (current()) setSummary(result);
        } catch { if (current()) setCountsFailed(true); }
        try {
          const group = await mentorStudentService.studentGroup(studentId);
          if (current()) setGroupId(group?.id ?? null);
        } catch (error) {
          if (current()) console.warn('Student group load for closure badge failed:', error instanceof Error ? error.message : error);
        }
      }
    } catch { if (current()) { setFailed(true); setStudent(null); } }
    finally { if (current()) setLoading(false); }
  }, [studentId, userId]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; }; }, [load]));
  const { status: closure } = useClosureStatus(studentId, groupId);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => subscription.remove();
  }, [onBack]));
  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <ReviewBack label={t('mentorHome.students')} onPress={onBack} />
      <Text accessibilityRole="header" style={ui.title}>{t('mentorStudents.detail')}</Text>
      {loading ? <ActivityIndicator color={colors.primaryDark} /> : failed ? <LoadFailedBanner onRetry={load} /> : !student ?
        <Text style={ui.body}>{t('mentorStudents.unavailable')}</Text> : <>
          <View style={ui.card}>
            <StudentIdentity student={student} />
            <Text style={ui.label}>{t('mentorStudents.calendar')}</Text>
            <StudentDates student={student} />
          </View>
          {!!closure?.closed && <View style={[ui.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <View style={{ flex: 1 }}>
              <Stamp kind="closed" date={closure.closedAt ? new Date(closure.closedAt).toLocaleDateString(i18n.language) : undefined} />
            </View>
            <Pressable accessibilityRole="button"
              onPress={() => router.push({ pathname: '/(mentor)/internship-report', params: { studentId, groupId: groupId! } })}>
              <Text style={ui.link}>{t('closure.viewReport', 'View report')}</Text>
            </Pressable>
          </View>}
          <Text accessibilityRole="header" style={ui.section}>{t('mentorStudents.summary')}</Text>
          {countsFailed && <LoadFailedBanner onRetry={load} />}
          <View style={{ flexDirection: width < 360 || fontScale > 1.3 ? 'column' : 'row', gap: 12 }}>
            {[{ label: t('mentorStudents.pendingLabel'), value: summary?.pending }, { label: t('mentorStudents.approved'), value: summary?.approved }].map(metric =>
              <View key={metric.label} style={[ui.card, { flex: 1, padding: 16 }]}>
                <Text style={ui.title}>{metric.value ?? '—'}</Text><Text style={ui.secondary}>{metric.label}</Text>
              </View>)}
          </View>
          {/* Review moved to the advisor (2026-09-24-advisor-review): there is no
              mentor screen left to open a pending submission on, so this stays
              a read-only count — already shown in the metric above — rather
              than a link to a route that no longer exists for this role. */}
          {!closure?.closed && summary?.pending === 0 && <Text style={ui.secondary}>{t('mentorStudents.noPending')}</Text>}
          <Text accessibilityRole="header" style={ui.section}>{t('mentorStudents.other')}</Text>
          <View style={ui.card}>
            {[{ label: t('mentorStudents.total'), value: summary?.total ?? '—' },
              { label: t('mentorStudents.xp'), value: student.xp == null ? '—' : student.xp + ' XP' },
              { label: t('mentorStudents.level'), value: student.level ?? '—' },
              { label: t('mentorStudents.streak'), value: student.streak == null ? '—' : t('mentorStudents.days', { count: student.streak }) }].map(row =>
                <View key={row.label} style={[ui.header, { minHeight: 48, flexWrap: 'wrap', justifyContent: 'space-between' }]}>
                  <Text style={ui.secondary}>{row.label}</Text><Text style={ui.label}>{row.value}</Text>
                </View>)}
          </View>
          <View style={ui.note}><Text style={ui.body}>{t('mentorStudents.reviewHint')}</Text></View>
        </>}
    </ScrollView>
  </SafeAreaView>;
}
