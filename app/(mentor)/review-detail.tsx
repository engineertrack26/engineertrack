import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Linking, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { useMentorReviewStore } from '@/store/mentorReviewStore';
import { mentorReviewService } from '@/services/mentorReviews';
import { signAssignmentDocument } from '@/services/evidenceUrls';
import { PendingReview, reviewNoteError, reviewVersion } from '@/utils/mentorReviews';
import { taskDueDate } from '@/utils/studentTasks';
import { mapRpcError } from '@/utils/rpcErrors';
import { LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { ReviewBack, ReviewIdentity, ReviewStatus } from '@/components/mentor/ReviewUI';
import { ReviewNoteSheet } from '@/components/mentor/ReviewNoteSheet';
import { ReviewEvidence } from '@/components/mentor/ReviewEvidence';
import { colors } from '@/theme';

export default function ReviewDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const userId = useAuthStore(s => s.user?.id);
  return <ReviewDetail key={(userId || '') + '/' + (id || '')} id={id} userId={userId} />;
}

function ReviewDetail({ id, userId }: { id?: string; userId?: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const [item, setItem] = useState<PendingReview | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [changed, setChanged] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [approvalNote, setApprovalNote] = useState('');
  const [reason, setReason] = useState('');
  const [sheet, setSheet] = useState<'revision' | 'note' | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'approve' | 'revise' | null>(null);
  const [openingBrief, setOpeningBrief] = useState(false);
  const generation = useRef(0);
  const initialVersion = useRef<string | null>(null);
  const busy = useRef(false);
  const finished = useRef(false);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const result = id && userId ? await mentorReviewService.get(id) : { item: null, name: '' };
      if (request !== generation.current) return;
      if (result.item && initialVersion.current && initialVersion.current !== reviewVersion(result.item)) {
        setChanged(true);
        return; // do not apply an old draft note to a new submission silently
      }
      // Keep the old version when a pending row disappears. If the same
      // submission is later resubmitted, old notes still require confirmation.
      if (result.item) initialVersion.current = reviewVersion(result.item);
      setItem(result.item);
      setName(result.name);
      setChanged(false);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [id, userId]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { generation.current++; };
  }, [load]));

  const goBack = useCallback(() => {
    if (busy.current) return;
    const leave = () => router.replace('/(mentor)/pending-reviews');
    if (!finished.current && (approvalNote.trim() || reason.trim())) {
      Alert.alert(t('mentorFlow.unsentNote'), t('mentorFlow.leaveNote'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.back'), onPress: leave },
      ]);
    } else leave();
  }, [approvalNote, reason, router, t]);
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

  async function decide(approved: boolean) {
    if (!item || !userId || busy.current || finished.current || changed || failed || loading) return;
    const note = approved ? approvalNote : reason;
    const validation = reviewNoteError(approved, note);
    if (validation) { setNoteError(validation); setSheet(approved ? 'note' : 'revision'); return; }
    busy.current = true;
    setSubmitting(approved ? 'approve' : 'revise');
    const request = generation.current;
    try {
      const user = useAuthStore.getState().user;
      if (user?.id !== userId) return;
      const mentorName = [user.firstName, user.lastName].filter(Boolean).join(' ');
      await mentorReviewService.submit(item, approved, note, {
        title: t(approved ? 'notifications.taskApprovedTitle' : 'notifications.taskRevisionTitle'),
        body: t(approved ? 'notifications.taskApprovedBody' : 'notifications.taskRevisionBody', {
          mentorName, title: item.assignment.title,
        }),
      });
      finished.current = true;
      useMentorReviewStore.getState().invalidate(userId);
      if (request !== generation.current) return;
      setSheet(null);
      setApprovalNote('');
      setReason('');
      Alert.alert(t('common.done'), t(approved ? 'mentor.taskApproved' : 'mentor.taskRevisionRequested'));
      router.replace('/(mentor)/pending-reviews');
    } catch (error) {
      if (request !== generation.current) return;
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
      if (message === 'mentorFlow.reviewChanged') {
        setChanged(true);
        setSheet(null);
      } else {
        const key = message.startsWith('mentorFlow.') ? message : mapRpcError(message).key;
        if (sheet) setNoteError(key);
        else Alert.alert(t('common.error'), t(key));
      }
    } finally {
      busy.current = false;
      if (request === generation.current) setSubmitting(null);
    }
  }

  function openSheet(mode: 'revision' | 'note') {
    setNoteError(null);
    setSheet(mode);
  }
  function refreshChanged() {
    // Explicit acknowledgement before replacing a draft attached to an old version.
    Alert.alert(t('mentorFlow.reviewChanged'), t('mentorFlow.replaceDraft'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.retry'), onPress: () => {
        initialVersion.current = null;
        setApprovalNote('');
        setReason('');
        setChanged(false);
        void load();
      } },
    ]);
  }

  const due = taskDueDate(item?.assignment.dueDate, i18n.language);
  const canReview = !!item && !loading && !failed && !changed;
  return <SafeAreaView style={ui.safe}>
    <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <ReviewBack label={t('mentorFlow.title')} onPress={goBack} disabled={!!submitting} />
      {loading ? <ActivityIndicator size="large" color={colors.primary} /> : failed ? <LoadFailedBanner onRetry={load} /> :
        !item ? <View style={ui.card}><Text style={ui.body}>{t('mentorFlow.unavailable')}</Text></View> : <>
          <ReviewIdentity name={name} submittedAt={item.submittedAt} />
          <Text accessibilityRole="header" style={ui.title}>{item.assignment.title}</Text>
          <ReviewStatus />
          {!!item.assignment.competencyName && <Text style={ui.secondary}>{item.assignment.competencyName}{item.assignment.level ? ' · L' + item.assignment.level : ''}</Text>}
          {!!due && <Text style={ui.secondary}>{t('mentor.taskDueDate')}: {due}</Text>}
          {changed && <View style={ui.note}>
            <Text accessibilityRole="alert" style={ui.body}>{t('mentorFlow.reviewChanged')}</Text>
            <Pressable accessibilityRole="button" onPress={refreshChanged}><Text style={ui.link}>{t('common.retry')}</Text></Pressable>
          </View>}
          <View style={[ui.card, { backgroundColor: '#eaf2fe', borderColor: '#cadcf7' }]}>
            <Text style={ui.label}>{t('mentorFlow.criterion')}</Text>
            <Text style={ui.body}>{item.assignment.criterion}</Text>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: instructions }} onPress={() => setInstructions(!instructions)}>
              <Text style={ui.link}>{t('studentFlow.instructions')} {instructions ? '⌃' : '⌄'}</Text>
            </Pressable>
            {instructions && <>
              <Text style={ui.label}>{t('mentor.taskObjective')}</Text>
              <Text style={ui.body}>{item.assignment.objective}</Text>
              {!!item.assignment.description && <Text style={ui.body}>{item.assignment.description}</Text>}
              {!!(item.assignment.documentPath || item.assignment.documentName) && <>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: openingBrief, busy: openingBrief }} disabled={openingBrief} onPress={openBrief}>
                  <Text style={ui.link}>{item.assignment.documentName || t('mentor.taskDocument')} ↗</Text>
                </Pressable>
                {!item.assignment.documentUrl && <Text style={ui.secondary}>{t('mentor.taskDocumentUnavailable')}</Text>}
              </>}
            </>}
          </View>
          <View style={ui.card}>
            <Text style={ui.label}>{t('mentorFlow.whatDid')}</Text>
            <Text style={ui.body}>{item.studentNote || t('mentorFlow.notProvided')}</Text>
            <Text style={ui.label}>{t('mentorFlow.whatLearned')}</Text>
            <Text style={ui.body}>{item.reflection || t('mentorFlow.notProvided')}</Text>
          </View>
          <ReviewEvidence photos={item.photos} documents={item.documents} onRetry={load} />
          {!!item.mentorNote && <View style={ui.note}>
            <Text style={ui.label}>{t('mentorFlow.previousNote')}</Text>
            <Text style={ui.body}>{item.mentorNote}</Text>
          </View>}
          {canReview && <Pressable accessibilityRole="button" disabled={!!submitting} onPress={() => openSheet('note')}>
            <Text style={ui.link}>{t('mentorFlow.optionalNote')}</Text>
            {!!approvalNote && <Text style={ui.body}>{approvalNote}</Text>}
          </Pressable>}
        </>}
    </ScrollView>
    {canReview && <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderColor: colors.divider }}>
      <View style={[ui.content, { paddingVertical: 12, gap: 8 }]}>
        <View style={{ flexDirection: width < 360 || fontScale > 1.3 ? 'column' : 'row', gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!submitting }} disabled={!!submitting}
            onPress={() => openSheet('revision')} style={[ui.primary, { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#854600' }, !!submitting && { opacity: 0.6 }]}>
            <Text style={[ui.primaryText, { color: '#854600' }]}>{t('mentorFlow.requestRevision')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!submitting, busy: submitting === 'approve' }} disabled={!!submitting}
            onPress={() => decide(true)} style={[ui.primary, { flex: 1 }, !!submitting && { opacity: 0.6 }]}>
            {submitting === 'approve' && <ActivityIndicator color="#fff" />}
            <Text style={ui.primaryText}>{t('mentor.approveTask')}</Text>
          </Pressable>
        </View>
        <Text style={[ui.secondary, { textAlign: 'center' }]}>{t('mentorFlow.decisionHint')}</Text>
      </View>
    </View>}
    <ReviewNoteSheet mode={sheet} context={name + ' · ' + (item?.assignment.title || '')}
      value={sheet === 'revision' ? reason : approvalNote} error={noteError} busy={!!submitting}
      onChange={value => { setNoteError(null); if (sheet === 'revision') setReason(value); else setApprovalNote(value); }}
      onClose={() => { if (!busy.current) { setSheet(null); setNoteError(null); } }}
      onConfirm={() => { if (sheet === 'revision') void decide(false); else setSheet(null); }} />
  </SafeAreaView>;
}
