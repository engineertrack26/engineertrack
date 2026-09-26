import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { taskContent } from '@/utils/taskContent';
import { competencyContent } from '@/utils/competencyContent';
import { useAuthStore } from '@/store/authStore';
import { assignmentService } from '@/services/assignments';
import { signAssignmentDocument } from '@/services/evidenceUrls';
import { PendingReview } from '@/utils/mentorReviews';
import { submissionStampKind } from '@/utils/mentorSubmissions';
import { taskDueDate } from '@/utils/studentTasks';
import { levelLabel } from '@/utils/selfAssessment';
import { LoadFailedBanner, Stamp } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { ReviewBack, ReviewIdentity } from '@/components/mentor/ReviewUI';
import { ReviewEvidence } from '@/components/mentor/ReviewEvidence';
import { colors } from '@/theme';

// Read-only for the mentor: through the student list they read the
// submission, its evidence and the advisor's decision, but they cannot
// approve or request a revision (2026-09-24-advisor-review-design.md,
// Decision 2). This screen is the same page review-detail.tsx renders for
// the advisor, minus the decision controls -- the outcome, the level given
// and the note are shown as facts, not editable state.
export default function SubmissionDetailScreen() {
  const { id, studentId, name } = useLocalSearchParams<{ id?: string; studentId?: string; name?: string }>();
  const userId = useAuthStore(s => s.user?.id);
  return <SubmissionDetail key={(userId || '') + '/' + (id || '')} id={id} studentId={studentId} name={name} userId={userId} />;
}

function SubmissionDetail({ id, studentId, name, userId }: { id?: string; studentId?: string; name?: string; userId?: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [item, setItem] = useState<PendingReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [openingBrief, setOpeningBrief] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const items = id && studentId && userId
        ? await assignmentService.listStudentSubmissions(studentId, { submissionId: id })
        : [];
      if (request !== generation.current) return;
      setItem(items[0] || null);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [id, studentId, userId]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { generation.current++; };
  }, [load]));

  const goBack = useCallback(() => {
    router.replace({ pathname: '/(mentor)/student-list', params: { studentId: studentId || '' } });
  }, [router, studentId]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { goBack(); return true; });
    return () => subscription.remove();
  }, [goBack]));

  async function openBrief() {
    if (!item || openingBrief) return;
    setOpeningBrief(true);
    try {
      const uri = await signAssignmentDocument(item.assignment.documentPath);
      if (!uri) throw new Error('Brief unavailable');
      await Linking.openURL(uri);
    } catch { Alert.alert(t('common.error'), t('mentor.taskDocumentUnavailable')); }
    finally { setOpeningBrief(false); }
  }

  const due = taskDueDate(item?.assignment.dueDate, i18n.language);
  const facts = item ? [
    item.assignment.competencyName && { label: t('dash.competency', 'Competency'),
      value: `${competencyContent(item.assignment.competencyName, i18n.language)}${item.assignment.level ? ' · L' + item.assignment.level : ''}` },
    due && { label: t('mentor.taskDueDate'), value: due },
  ].filter((f): f is { label: string; value: string } => !!f) : [];

  return <SafeAreaView style={ui.safe}>
    <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <ReviewBack label={t('mentorStudents.detail')} onPress={goBack} />
      {loading ? <ActivityIndicator size="large" color={colors.primary} /> : failed ? <LoadFailedBanner onRetry={load} /> :
        !item ? <View style={ui.card}><Text style={ui.body}>{t('mentorFlow.unavailable')}</Text></View> : <>
          <ReviewIdentity name={name || ''} submittedAt={item.submittedAt} />
          <View style={{ gap: 10 }}>
            <Text accessibilityRole="header" style={ui.title}>{taskContent(item.assignment.title, i18n.language)}</Text>
            <Stamp kind={submissionStampKind(item.status)} />
          </View>
          {facts.length > 0 && <View style={{ gap: 6, paddingBottom: 12, borderBottomWidth: 1, borderColor: colors.rule }}>
            {facts.map((f) => <View key={f.label} style={{ flexDirection: 'row', gap: 12 }}>
              <Text style={[ui.secondary, { width: 96 }]}>{f.label}</Text>
              <Text style={[ui.body, { flex: 1, fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] }]}>{f.value}</Text>
            </View>)}
          </View>}
          <View style={{ gap: 8 }}>
            <Text style={ui.section}>{t('mentorFlow.criterion')}</Text>
            <Text style={ui.body}>{taskContent(item.assignment.criterion, i18n.language, 'criterion')}</Text>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: instructions }} onPress={() => setInstructions(!instructions)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 }}>
              <Text style={[ui.link, { paddingVertical: 0 }]}>{t('studentFlow.instructions')}</Text>
              <Ionicons name={instructions ? 'chevron-up' : 'chevron-down'} size={18} color={colors.ink} />
            </Pressable>
            {instructions && <View style={{ gap: 8, paddingLeft: 12, borderLeftWidth: 2, borderColor: colors.rule }}>
              <Text style={ui.label}>{t('mentor.taskObjective')}</Text>
              <Text style={ui.body}>{taskContent(item.assignment.objective, i18n.language, 'objective')}</Text>
              {!!item.assignment.description && <Text style={ui.body}>{item.assignment.description}</Text>}
              {!!(item.assignment.documentPath || item.assignment.documentName) && <>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: openingBrief, busy: openingBrief }} disabled={openingBrief} onPress={openBrief}>
                  <Text style={ui.link}>{item.assignment.documentName || t('mentor.taskDocument')} ↗</Text>
                </Pressable>
                {!item.assignment.documentUrl && <Text style={ui.secondary}>{t('mentor.taskDocumentUnavailable')}</Text>}
              </>}
            </View>}
          </View>
          <View style={[ui.card, { gap: 14 }]}>
            <View style={{ gap: 4 }}>
              <Text style={ui.section}>{t('mentorFlow.whatDid')}</Text>
              <Text selectable style={ui.body}>{item.studentNote || t('mentorFlow.notProvided')}</Text>
            </View>
            <View style={{ borderTopWidth: 1, borderColor: colors.rule }} />
            <View style={{ gap: 4 }}>
              <Text style={ui.section}>{t('mentorFlow.whatLearned')}</Text>
              <Text selectable style={ui.body}>{item.reflection || t('mentorFlow.notProvided')}</Text>
            </View>
          </View>
          <ReviewEvidence photos={item.photos} documents={item.documents} onRetry={load} />
          <View style={[ui.card, ui.featured]}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Text style={[ui.secondary, { width: 96 }]}>{t('assessment.studentSaid', "Student's own rating")}</Text>
              <Text style={[ui.body, { flex: 1, fontSize: 15, lineHeight: 21 }]}>{typeof item.selfLevel === 'number' ? levelLabel(item.selfLevel, t) : t('assessment.notRated', 'Not rated')}</Text>
            </View>
            {typeof item.mentorLevel === 'number' && <>
              <View style={{ borderTopWidth: 1, borderColor: colors.rule }} />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Text style={[ui.secondary, { width: 96 }]}>{t('assessment.mentor', 'Advisor')}</Text>
                <Text style={[ui.body, { flex: 1, fontSize: 15, lineHeight: 21 }]}>{levelLabel(item.mentorLevel, t)}</Text>
              </View>
            </>}
          </View>
          {!!item.mentorNote && <View style={ui.note}>
            <Text style={ui.label}>{t('mentorStudents.advisorNote')}</Text>
            <Text style={ui.body}>{item.mentorNote}</Text>
          </View>}
        </>}
    </ScrollView>
  </SafeAreaView>;
}
