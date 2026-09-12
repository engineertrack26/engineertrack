import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ui } from '@/components/common/workflowStyles';
import { LoadFailedBanner } from '@/components/common';
import { ReviewBack } from './ReviewUI';
import { StudentDates, StudentIdentity } from './StudentIdentity';
import { mentorStudentService } from '@/services/mentorStudents';
import { MentorStudent } from '@/utils/mentorStudents';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';

export function StudentDetail({ userId, studentId, onBack }: { userId: string; studentId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const [student, setStudent] = useState<MentorStudent | null>(null);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof mentorStudentService.summary>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [countsFailed, setCountsFailed] = useState(false);
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
      }
    } catch { if (current()) { setFailed(true); setStudent(null); } }
    finally { if (current()) setLoading(false); }
  }, [studentId, userId]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current++; }; }, [load]));
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
          <Text accessibilityRole="header" style={ui.section}>{t('mentorStudents.summary')}</Text>
          {countsFailed && <LoadFailedBanner onRetry={load} />}
          <View style={{ flexDirection: width < 360 || fontScale > 1.3 ? 'column' : 'row', gap: 12 }}>
            {[{ label: t('mentorStudents.pendingLabel'), value: summary?.pending }, { label: t('mentorStudents.approved'), value: summary?.approved }].map(metric =>
              <View key={metric.label} style={[ui.card, { flex: 1, padding: 16 }]}>
                <Text style={ui.title}>{metric.value ?? '—'}</Text><Text style={ui.secondary}>{metric.label}</Text>
              </View>)}
          </View>
          {!!summary?.pending && <Pressable accessibilityRole="button" style={ui.primary}
            onPress={() => router.push({ pathname: '/(mentor)/pending-reviews', params: { studentId, assignmentId: '' } })}>
            <Text style={ui.primaryText}>{t('mentorStudents.openPending', { count: summary.pending })}</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </Pressable>}
          {summary?.pending === 0 && <Text style={ui.secondary}>{t('mentorStudents.noPending')}</Text>}
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
          <View style={[ui.card, { backgroundColor: '#eaf2fe' }]}><Text style={ui.body}>{t('mentorStudents.reviewHint')}</Text></View>
        </>}
    </ScrollView>
  </SafeAreaView>;
}
