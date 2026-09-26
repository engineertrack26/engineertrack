import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton, LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { getMyInternshipBook, type StudentInternshipBook } from '@/services/studentInternshipBook';
import { saveStudentInternshipBook } from '@/services/saveStudentInternshipBook';
import { useAuthStore } from '@/store/authStore';
import { studentInternshipBookHtml } from '@/utils/studentInternshipBookHtml';
import { colors } from '@/theme';

export default function InternshipBookScreen() {
  const studentId = useAuthStore(s => s.user?.id);
  return studentId ? <BookContent key={studentId} studentId={studentId} /> : null;
}

function BookContent({ studentId }: { studentId: string }) {
  const { t, i18n } = useTranslation();
  const [book, setBook] = useState<StudentInternshipBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const request = useRef(0);
  const saveLock = useRef(false);
  const active = useRef(false);
  const current = () => active.current && useAuthStore.getState().user?.id === studentId;

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setFailed(false); setBook(null);
    try {
      const result = await getMyInternshipBook(studentId);
      if (id === request.current && current()) setBook(result);
    } catch {
      if (id === request.current && current()) setFailed(true);
    } finally {
      if (id === request.current && current()) setLoading(false);
    }
  }, [studentId]);
  useFocusEffect(useCallback(() => {
    active.current = true; void load();
    return () => { active.current = false; request.current += 1; };
  }, [load]));

  const download = async () => {
    if (!book || saveLock.current || !current() || !(book.days.length || book.tasks.length)) return;
    saveLock.current = true; setSaving(true);
    try {
      const html = studentInternshipBookHtml(book, i18n.language, key => t(key));
      if (!current()) return;
      const saved = await saveStudentInternshipBook(html, book.student.name, studentId);
      if (saved && current()) Alert.alert(t('common.done'), t('studentBook.saved'));
    } catch {
      if (current()) Alert.alert(t('studentBook.errorTitle'), t('studentBook.error'));
    } finally {
      saveLock.current = false; if (current()) setSaving(false);
    }
  };
  const recent = book ? [...book.days].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5) : [];
  const available = !!book && (book.days.length > 0 || book.tasks.length > 0);
  const groupCount = book ? new Set(book.groups.map(group => group.id)).size : 0;

  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={ui.content}>
      <BackButton href="/(student)/profile" />
      <Text style={ui.title} accessibilityRole="header">{t('studentBook.title')}</Text>
      <Text style={ui.secondary}>{t('studentBook.intro')}</Text>
      <View style={ui.note}><Text style={ui.body}>{t('studentBook.disclaimer')}</Text></View>
      {failed && <LoadFailedBanner onRetry={() => void load()} />}
      {loading && <ActivityIndicator size="large" color={colors.primaryDark} />}
      {!loading && !failed && book && <>
        <View style={ui.card}>
          <Text style={ui.cardTitle}>{book.student.name}</Text>
          <Text style={ui.secondary}>{book.student.university} · {book.student.department}</Text>
          <Text style={ui.secondary}>{t('studentBook.groups')}: {groupCount} · {t('studentBook.placements')}: {book.placements.length}</Text>
          <Text style={ui.secondary}>{t('studentBook.recordedDays')}: {book.days.length} · {t('studentBook.submittedJournals')}: {book.days.filter(d => d.logStatus === 'submitted').length}</Text>
          <Text style={ui.secondary}>{t('studentBook.tasks')}: {book.tasks.length} · {t('studentBook.approvedTasks')}: {book.tasks.filter(a => a.status === 'approved').length}</Text>
        </View>
        {recent.length > 0 && <View style={ui.card}>
          <Text style={ui.section}>{t('studentBook.recentDays')}</Text>
          {recent.map(day => <View key={day.id} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
            <Text style={ui.label}>{day.date} · {day.company}</Text>
            <Text style={ui.secondary}>{t(`studentBook.attendance_${day.attendance}`)} · {t(day.logStatus === 'submitted' ? 'studentBook.journalSubmitted' : 'studentBook.journalNotSubmitted')}</Text>
          </View>)}
          <Text style={ui.secondary}>{t('studentBook.fullPdfHint')}</Text>
        </View>}
        {!available && <Text style={ui.body}>{t('studentBook.noRecords')}</Text>}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !available || saving, busy: saving }}
          disabled={!available || saving} onPress={() => void download()}
          style={[ui.primary, (!available || saving) && { opacity: 0.5 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="download-outline" size={22} color="#fff" />}
          <Text style={ui.primaryText}>{t('studentBook.download')}</Text>
        </Pressable>
      </>}
    </ScrollView>
  </SafeAreaView>;
}
