import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { taskContent } from '@/utils/taskContent';
import { competencyContent } from '@/utils/competencyContent';
import { getCalendars } from 'expo-localization';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@/store/authStore';
import { internshipDayService as service } from '@/services/internshipDays';
import { groupService } from '@/services/group';
import { useClosureStatus } from '@/hooks/useClosureStatus';
import type { Attendance, DayEvent, DayLogForm, DayTask, InternshipDay, InternshipPerson } from '@/types/internshipDay';
import { dayError, dayLogForm, daySummary, dayWeek, logFormError, needsAttendanceReview, shiftDay, visibleDayDates } from '@/utils/internshipDays';
import { internshipDateString, parseInternshipDate } from '@/utils/internshipForm';
import { AuthButton } from '@/components/common/AuthForm';
import { BackButton } from '@/components/common/BackButton';
import { ClosureBanner } from '@/components/common/ClosureBanner';
import { ProfileSheet } from '@/components/mentor/ProfileSheet';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';

type Role = 'student' | 'mentor' | 'advisor';
type Sheet = { kind: 'create'; date: string } | { kind: 'detail'; day: InternshipDay } | { kind: 'review'; days: InternshipDay[] } | null;
export function InternshipDaysScreen({ role }: { role: Role }) {
  const user = useAuthStore(s => s.user);
  return user?.role === role ? <DayWorkspace key={user.id} ownerId={user.id} role={role} /> : null;
}
function DayWorkspace({ ownerId, role }: { ownerId: string; role: Role }) {
  const { t, i18n } = useTranslation();
  const today = internshipDateString(new Date());
  const [from, setFrom] = useState(dayWeek(today)[0]);
  const [people, setPeople] = useState<InternshipPerson[]>([]);
  const [studentId, setStudentId] = useState(role === 'student' ? ownerId : '');
  const [search, setSearch] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [differentStatus, setDifferentStatus] = useState(false);
  const [queue, setQueue] = useState<Record<string, number>>({});
  const [days, setDays] = useState<InternshipDay[]>([]);
  const [totals, setTotals] = useState<ReturnType<typeof daySummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [form, setForm] = useState<DayLogForm>({ experience: '', learning: '', nextStep: '', support: null, reason: '', taskId: null, attachment: null });
  const [tasks, setTasks] = useState<DayTask[]>([]);
  const [taskError, setTaskError] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<Exclude<Attendance,'pending'>>('present');
  const [events, setEvents] = useState<DayEvent[] | null>(null);
  const [eventError, setEventError] = useState('');
  const [sheetError, setSheetError] = useState('');
  const [success, setSuccess] = useState(false);
  const [studentGroupId, setStudentGroupId] = useState<string | null>(null);
  useEffect(() => {
    if (role !== 'student') { setStudentGroupId(null); return; }
    let current = true;
    groupService.getMyGroup(ownerId).then(g => { if (current) setStudentGroupId(g?.id ?? null); })
      .catch(failure => console.warn('Group load for closure banner failed:', failure instanceof Error ? failure.message : failure));
    return () => { current = false; };
  }, [role, ownerId]);
  const { status: closure } = useClosureStatus(role === 'student' ? ownerId : null, studentGroupId);
  const closed = role === 'student' && !!closure?.closed;
  const lock = useRef(false), active = useRef(false), sequence = useRef(0), eventSequence = useRef(0);
  const currentAccount = () => useAuthStore.getState().user?.id === ownerId;
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setError(''); setSelected([]);
    try {
      const nextPeople = await service.people();
      const id = studentId || (role === 'advisor' ? nextPeople[0]?.id : '') || '';
      const nextQueue: Record<string, number> = {};
      if (role === 'mentor' && !id) {
        // Limit concurrent requests; no new database RPC or schema changes.
        for (let offset = 0; offset < nextPeople.length; offset += 4) {
          if (!active.current || request !== sequence.current || !currentAccount()) return;
          await Promise.all(nextPeople.slice(offset, offset + 4).map(async p => {
            const records = await service.week(p.id, from);
            nextQueue[p.id] = records.filter(needsAttendanceReview).length;
          }));
        }
      }
      const [nextDays,nextTotals] = id && nextPeople.some(p => p.id === id)
        ? await Promise.all([service.week(id, from),service.totals(id)]) : [[],null];
      if (!active.current || request !== sequence.current || !currentAccount()) return;
      setPeople(nextPeople); setDays(nextDays);setTotals(nextTotals); setQueue(nextQueue);
      if (!studentId && id) setStudentId(id);
    } catch (failure) {
      if (active.current && request === sequence.current && currentAccount()) { setDays([]); setError(dayError(failure)); }
    } finally { if (active.current && request === sequence.current) setLoading(false); }
  }, [ownerId, studentId, from, role]);
  useFocusEffect(useCallback(() => {
    active.current = true; void load();
    return () => { active.current = false; sequence.current++; eventSequence.current++; };
  }, [load]));
  const person = people.find(p => p.id === studentId);
  const summary = daySummary(days);
  const dates = dayWeek(from);
  const dateLabel = (value: string) => parseInternshipDate(value)?.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }) || value;
  const timestamp = (value: string, timeZone?: string) => new Date(value).toLocaleString(i18n.language, { timeZone });
  const run = async (work: () => Promise<unknown>) => {
    if (lock.current || !currentAccount()) return;
    lock.current = true; setBusy(true); setSheetError(''); setSuccess(false);
    try {
      await work();
      if (!active.current || !currentAccount()) return;
      setSheet(null); eventSequence.current++; setSuccess(true); await load();
    } catch (failure) { if (active.current && currentAccount()) setSheetError(dayError(failure)); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  };
  const close = () => {
    if (lock.current) return;
    const leave = () => { setSheet(null); eventSequence.current++; };
    const original = sheet?.kind === 'detail' ? dayLogForm(sheet.day) : null;
    const dirty = !!note || (role === 'student' && original && JSON.stringify(original) !== JSON.stringify(form));
    if (dirty) Alert.alert(t('mentorProfile.discardTitle'), t('mentorProfile.discardHint'), [
      { text: t('common.cancel'), style: 'cancel' }, { text: t('mentorProfile.discard'), onPress: leave },
    ]); else leave();
  };
  const readEvents = async (dayId: string) => {
    const request = ++eventSequence.current; setEvents(null); setEventError('');
    try {
      const result = await service.events(dayId);
      if (request === eventSequence.current && active.current && currentAccount()) setEvents(result);
    } catch (failure) { if (request === eventSequence.current && active.current) setEventError(dayError(failure)); }
  };
  const openDetail = (day: InternshipDay) => {
    setShowOptional(false); setShowEvents(role === 'advisor');
    setForm(dayLogForm(day)); setNote(''); setSheetError(''); setSheet({ kind: 'detail', day }); void readEvents(day.id);
    setTasks([]); setTaskError('');
    if (role==='student') {
      const request = eventSequence.current;
      void service.tasks(day.id).then(result=>{
        if(request===eventSequence.current && active.current && currentAccount()) setTasks(result);
      }).catch(failure=>{if(request===eventSequence.current && active.current) setTaskError(dayError(failure));});
    }
  };
  const attach = async (day: InternshipDay) => {
    if(lock.current) return;
    lock.current=true;setBusy(true);setSheetError('');
    const request=eventSequence.current;
    try {
      const result=await DocumentPicker.getDocumentAsync({type:['image/jpeg','image/png','image/webp','application/pdf'],copyToCacheDirectory:true,multiple:false});
      if(result.canceled || !result.assets[0] || !currentAccount()) return;
      const attachment=await service.upload(day,result.assets[0]);
      if(active.current && request===eventSequence.current && currentAccount()) setForm(old=>({...old,attachment}));
    } catch(failure) {if(active.current) setSheetError(dayError(failure));}
    finally {lock.current=false;if(active.current)setBusy(false);}
  };
  const openFile = async (path: string) => {
    try { const url=await service.fileUrl(path); if(active.current && currentAccount()) await Linking.openURL(url); }
    catch(failure) {if(active.current)setSheetError(dayError(failure));}
  };
  const field = (label: string, value: string, change: (value: string) => void, limit = 2000) => <View style={{ gap: 8 }}>
    <Text style={ui.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={change} editable={!busy} multiline maxLength={limit}
      style={[ui.input, { minHeight: 96, textAlignVertical: 'top' }]} />
  </View>;
  const choice = (label: string, checked: boolean, onPress: () => void) => <Pressable key={label} accessibilityRole="radio"
    accessibilityState={{ checked, disabled: busy }} disabled={busy} onPress={onPress}
    style={[ui.card, { padding: 12, minHeight: 48 }, checked && { backgroundColor: colors.inkBg, borderColor: colors.ink }]}>
    <Text style={ui.body}>{checked ? '● ' : '○ '}{label}</Text>
  </Pressable>;
  const saveLog = (day: InternshipDay, submit: boolean) => {
    const validation = logFormError(form, submit, day.log_status === 'submitted');
    if (validation) { setSheetError(validation); return; }
    void run(() => service.saveLog(day, form, submit));
  };
  const openReview = (records: InternshipDay[], other = false) => {
    setNote(''); setStatus(records.length === 1 && records[0].attendance !== 'pending' ? records[0].attendance : 'present'); setDifferentStatus(other); setSheetError('');
    setSheet({ kind: 'review', days: records }); eventSequence.current++;
  };
  const visibleDates = visibleDayDates(role, showHistory, today, from, days);
  return <SafeAreaView style={ui.safe} edges={['top','left','right']}>
    <ScrollView ref={scrollRef} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { if (!busy) void load(); }} />}>
      <BackButton disabled={busy} href={role === 'student' ? '/(student)/dashboard' : role === 'mentor' ? '/(mentor)/dashboard' : '/(advisor)/dashboard'} />
      <Text style={ui.title} accessibilityRole="header">{t(role === 'student' ? 'days.title' : role === 'mentor' ? 'days.pendingTitle' : 'days.staffTitle')}</Text>
      <Text style={ui.secondary}>{t(role === 'student' ? 'days.studentIntro' : role === 'mentor' ? 'days.mentorIntro' : 'days.intro')}</Text>
      {role === 'student' && <ClosureBanner status={closure} onReport={() => router.push({ pathname: '/(student)/internship-report', params: { studentId: ownerId, groupId: studentGroupId! } })} />}
      {success && <Text style={ui.body} accessibilityLiveRegion="polite">{t('mentorProfile.saved')}</Text>}
      {!sheet && !!sheetError && <Text style={[ui.body, { color: colors.error }]} accessibilityRole="alert">{t(sheetError)}</Text>}
      {loading && <ActivityIndicator color={colors.primaryDark} />}
      {!!error && <View style={ui.card}><Text style={ui.body} accessibilityRole="alert">{t(error)}</Text><AuthButton title={t('common.retry')} onPress={() => void load()} /></View>}
      {role === 'mentor' && !!studentId && <AuthButton title={t('days.backStudents')} variant="ghost" disabled={busy || loading}
        onPress={() => { setStudentId(''); setShowHistory(false); setSelected([]); setSuccess(false); }} />}
      {(role === 'advisor' || (role === 'mentor' && !studentId)) && !loading && !error && people.length > 0 && <View style={ui.card}>
        <Text style={ui.label}>{t('days.student')}</Text>
        <TextInput style={ui.input} accessibilityLabel={t('common.search')} placeholder={t('common.search')} value={search} onChangeText={setSearch} />
        <ScrollView style={role === 'advisor' ? { maxHeight: 200 } : undefined} nestedScrollEnabled={role === 'advisor'} scrollEnabled={role === 'advisor'}>
          {people.filter(p => p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b) => (queue[b.id] || 0) - (queue[a.id] || 0)).map(p =>
            <Pressable key={p.id} accessibilityRole={role === 'mentor' ? 'button' : 'radio'} accessibilityState={role === 'advisor' ? { checked: studentId === p.id } : { disabled: busy || loading }} disabled={busy || loading}
              onPress={() => { setStudentId(p.id); setSelected([]); setShowHistory(false); setSuccess(false); }} style={role === 'mentor' ? [ui.card, { marginVertical: 6 }] : { paddingVertical: 14 }}>
              <Text style={ui.label}>{role === 'advisor' ? (studentId === p.id ? '● ' : '○ ') : ''}{p.name}</Text>
              {role === 'mentor' && <Text style={ui.secondary}>{t('days.waitingCount', { count: queue[p.id] || 0 })}</Text>}
            </Pressable>)}
        </ScrollView>
      </View>}
      {role === 'student' && <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 4, gap: 4, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
        {[false, true].map(history => <Pressable key={String(history)} accessibilityRole="tab"
          accessibilityState={{ selected: showHistory === history, disabled: busy || loading }} disabled={busy || loading}
          onPress={() => { setShowHistory(history); setShowSummary(false); setFrom(dayWeek(today)[0]); setSuccess(false); scrollRef.current?.scrollTo({ y: 0, animated: true }); }}
          style={{ flex: 1, minHeight: 48, padding: 12, borderRadius: 10, justifyContent: 'center', backgroundColor: showHistory === history ? colors.primaryDark : colors.surface }}>
          <Text style={[ui.label, { textAlign: 'center', color: showHistory === history ? colors.textOnPrimary : colors.primaryDark }]}>{t(history ? 'days.historyTab' : 'days.today')}</Text>
        </Pressable>)}
      </View>}
      {role === 'student' && showHistory && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('days.previousWeek')} disabled={loading || busy} accessibilityState={{ disabled: loading || busy }}
          onPress={() => { setFrom(shiftDay(from,-7)); setShowSummary(false); setSuccess(false); }} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[ui.link, { fontSize: 28 }]}>‹</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('days.thisWeek')} disabled={loading || busy}
          onPress={() => { setFrom(dayWeek(today)[0]); setShowSummary(false); }} style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}>
          <Text style={[ui.label, { textAlign: 'center' }]}>{dateLabel(from)} – {dateLabel(dates[6])}</Text>
          {from !== dayWeek(today)[0] && <Text style={[ui.link, { textAlign: 'center' }]}>{t('days.thisWeek')}</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('days.nextWeek')} disabled={loading || busy || from >= dayWeek(today)[0]}
          accessibilityState={{ disabled: loading || busy || from >= dayWeek(today)[0] }}
          onPress={() => { setFrom(shiftDay(from,7)); setShowSummary(false); setSuccess(false); }}
          style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: from >= dayWeek(today)[0] ? 0.4 : 1 }}>
          <Text style={[ui.link, { fontSize: 28 }]}>›</Text>
        </Pressable>
      </View>}
      {role !== 'student' && <><View style={ui.header}>
        <AuthButton title="‹" disabled={loading || busy} onPress={() => { setFrom(shiftDay(from,-7)); setSuccess(false); }} />
        <Text style={[ui.label, { flex: 1, textAlign: 'center' }]}>{dateLabel(from)} – {dateLabel(dates[6])}</Text>
        <AuthButton title="›" disabled={loading || busy || from >= dayWeek(today)[0]} onPress={() => { setFrom(shiftDay(from,7)); setSuccess(false); }} />
      </View>
      <AuthButton title={t('days.thisWeek')} variant="ghost" disabled={loading || busy} onPress={() => setFrom(dayWeek(today)[0])} /></>}
      {!loading && !error && people.length === 0 && <Text style={ui.body}>{t('days.noStudents')}</Text>}
      {!!person && !loading && !error && <>
        {!(role === 'student' && showHistory) && <Text style={ui.label}>{role === 'student' ? person.company : `${person.name} · ${person.company}`}</Text>}
        {(role === 'advisor' || (role === 'mentor' && showHistory)) && <Text style={ui.secondary}>{person.startDate} — {person.endDate}</Text>}
        {!person.mentorId && <Text style={ui.body}>{t('days.setup')}</Text>}
        {(role === 'advisor' || (role === 'mentor' && showHistory)) && <View style={ui.card}>
          <Text style={ui.label}>{t('days.weekSummary')}</Text>
          <Text style={ui.body}>{t('days.summary', summary)}</Text>
          {totals && <><Text style={ui.label}>{t('days.totalSummary')}</Text><Text style={ui.body}>{t('days.summary',totals)}</Text></>}
          <Text style={ui.secondary}>{t('days.missingHint')}</Text>
        </View>}
        {role === 'mentor' && <>
          <AuthButton title={t(showHistory ? 'days.pendingTitle' : 'days.allDays')} variant="ghost" disabled={busy}
            onPress={() => { setShowHistory(!showHistory); setSelected([]); }} />
          {visibleDates.length === 0 && <Text style={ui.body}>{t('days.noPending')}</Text>}
        </>}
        {visibleDates.map(date => {
          const day = days.find(d => d.day_date === date);
          const eligible = date >= person.startDate && date <= person.endDate && date <= today;
          return <View key={date} style={ui.card}>
            {role === 'student' && !showHistory && <Text style={ui.label}>{t('days.today')}</Text>}
            <Text style={ui.section}>{dateLabel(date)}</Text>
            {day ? <>
              <Text style={ui.body}>{t('days.attendance')}: {t('days.' + day.attendance)}</Text>
              <Text style={ui.body}>{t('days.log')}: {t('days.' + day.log_status)}</Text>
              {day.correction_requested && <Text style={[ui.label, { color: colors.error }]}>{t('days.correctionOpen')}</Text>}
              {role === 'mentor' && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(day.id) }} disabled={busy}
                onPress={() => setSelected(old => old.includes(day.id) ? old.filter(id => id !== day.id) : [...old, day.id])} style={{ minHeight: 48, justifyContent: 'center' }}>
                <Text style={ui.link}>{selected.includes(day.id) ? '☑ ' : '☐ '}{t('days.select')}</Text>
              </Pressable>}
              {(role !== 'mentor' || day.log_status === 'submitted' || showHistory || day.correction_requested) &&
                <AuthButton title={t(role === 'student' ? (day.log_status === 'draft' ? 'days.writeLog' : 'days.openLog') : role === 'mentor' && day.log_status === 'submitted' ? 'days.readLog' : 'days.details')}
                  variant={role === 'student' ? 'primary' : 'ghost'} onPress={() => openDetail(day)} disabled={busy} />}
            </> : <>
              <Text style={ui.secondary}>{t(eligible ? 'days.noRecord' : 'days.outside')}</Text>
              {eligible && role === 'student' && date === today && <Text style={ui.secondary}>{t('days.pending')}</Text>}
              {eligible && role !== 'advisor' && <AuthButton title={t(date === today && role === 'student' ? 'days.checkIn' : 'days.addDay')} disabled={busy || !person.mentorId || closed}
                onPress={() => {
                  if (role === 'student' && date === today) {
                    void run(() => service.open(studentId,date,getCalendars()[0]?.timeZone || 'UTC',''));
                  } else { setNote(''); setSheetError(''); setSheet({ kind: 'create', date }); }
                }} />}
            </>}
          </View>;
        })}
        {role === 'student' && showHistory && <View style={ui.card}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showSummary }} onPress={() => setShowSummary(!showSummary)}
            style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={ui.link}>{t('days.attendanceSummary')} {showSummary ? '−' : '+'}</Text>
          </Pressable>
          {showSummary && <>
            <Text style={ui.label}>{person.company}</Text>
            <Text style={ui.secondary}>{person.startDate} — {person.endDate}</Text>
            <Text style={ui.label}>{t('days.weekSummary')}</Text>
            <Text style={ui.body}>{t('days.summary', summary)}</Text>
            {totals && <><Text style={ui.label}>{t('days.totalSummary')}</Text><Text style={ui.body}>{t('days.summary', totals)}</Text></>}
            <Text style={ui.secondary}>{t('days.missingHint')}</Text>
          </>}
        </View>}
      </>}
    </ScrollView>
    {role === 'mentor' && selected.length > 0 && !loading && !error && <View style={{ padding: 16, gap: 4, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border }}>
      <AuthButton title={t('days.approveCount', { count: selected.length })} disabled={busy}
        onPress={() => openReview(days.filter(d => selected.includes(d.id)))} />
      <AuthButton title={t('days.otherStatus')} variant="ghost" disabled={busy}
        onPress={() => openReview(days.filter(d => selected.includes(d.id)), true)} />
    </View>}
    {sheet && <ProfileSheet title={t(sheet.kind === 'create' ? 'days.addDay' : sheet.kind === 'review' ? 'days.review' : 'days.details')} busy={busy} onClose={close}>
      {!!sheetError && <Text style={[ui.body, { color: colors.error }]} accessibilityRole="alert">{t(sheetError)}</Text>}
      {sheet.kind === 'create' && <>
        <Text style={ui.section}>{dateLabel(sheet.date)}</Text>
        <Text style={ui.body}>{t('days.declaration')}</Text>
        {(sheet.date < today || role === 'mentor') && field(t('days.reason'), note, setNote)}
        <AuthButton title={t(sheet.date === today && role === 'student' ? 'days.checkIn' : 'common.save')} loading={busy} onPress={() => {
          if ((sheet.date < today || role === 'mentor') && !note.trim()) { setSheetError('days.reasonRequired'); return; }
          void run(() => service.open(studentId,sheet.date,getCalendars()[0]?.timeZone || 'UTC',note));
        }} />
      </>}
      {sheet.kind === 'review' && <>
        <Text style={ui.body}>{sheet.days.map(d => dateLabel(d.day_date)).join(' · ')}</Text>
        <Text style={ui.secondary}>{t('days.reviewHint')}</Text>
        {differentStatus ? <View accessibilityRole="radiogroup">{(['present','partial','excused','absent'] as const).map(s => choice(t('days.' + s),status===s,()=>setStatus(s)))}</View>
          : <><Text style={ui.section}>{t('days.present')}</Text><AuthButton title={t('days.otherStatus')} variant="ghost" onPress={() => setDifferentStatus(true)} disabled={busy} /></>}
        {(differentStatus || sheet.days.some(d => d.attendance !== 'pending' || d.correction_requested)) && field(t('days.reason'),note,setNote)}
        <AuthButton title={t('days.confirmReview')} loading={busy} onPress={() => {
          if ((status !== 'present' || sheet.days.some(d => d.attendance !== 'pending' || d.correction_requested)) && !note.trim()) { setSheetError('days.reasonRequired'); return; }
          void run(()=>service.review(sheet.days,status,note));
        }} />
      </>}
      {sheet.kind === 'detail' && <>
        <Text style={ui.section}>{dateLabel(sheet.day.day_date)}</Text>
        <Text style={ui.body}>{t('days.attendance')}: {t('days.'+sheet.day.attendance)}</Text>
        {role === 'advisor' && <>
          <Text style={ui.secondary}>{t('days.recorded')}: {timestamp(sheet.day.reported_at,sheet.day.timezone)} · {sheet.day.timezone}</Text>
          <Text style={ui.secondary}>{t(sheet.day.check_in_at ? 'days.liveDeclaration' : 'days.lateDeclaration')}</Text>
          {!!sheet.day.report_reason && <Text style={ui.body}>{sheet.day.report_reason}</Text>}
        </>}
        {!!sheet.day.attendance_note && <Text style={ui.body}>{t('days.reason')}: {sheet.day.attendance_note}</Text>}
        {role === 'student' ? <>
          <Text style={ui.secondary}>{t('days.privateHint')}</Text>
          {field(t('days.experience'),form.experience,value=>setForm({...form,experience:value}),4000)}
          {field(t('days.learning'),form.learning,value=>setForm({...form,learning:value}),4000)}
          <Text style={ui.label}>{t('days.selfAssessment')}</Text>
          <View accessibilityRole="radiogroup">{[0,1,2,3].map(n=>choice(t('days.support'+n),form.support===n,()=>setForm({...form,support:n})))}</View>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showOptional }} disabled={busy}
            onPress={() => setShowOptional(!showOptional)} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={ui.link}>{t('days.optionalDetails')} {showOptional ? '−' : '+'}</Text>
          </Pressable>
          {showOptional && <>{field(t('days.nextStep'),form.nextStep,value=>setForm({...form,nextStep:value}))}
          <Text style={ui.label}>{t('days.taskOptional')}</Text>
          {!!taskError && <Text style={ui.secondary}>{t(taskError)}</Text>}
          {!!sheet.day.task_title && <Text style={ui.secondary}>{sheet.day.task_title}</Text>}
          <ScrollView style={{maxHeight:180}} nestedScrollEnabled>
            {choice(t('days.noTask'),form.taskId===null,()=>setForm({...form,taskId:null}))}
            {tasks.map(task=>choice(taskContent(task.title,i18n.language)+' · '+competencyContent(task.competency,i18n.language),form.taskId===task.id,()=>setForm({...form,taskId:task.id})))}
          </ScrollView>
          <Text style={ui.secondary}>{t('days.fileHint')}</Text>
          {form.attachment && <>
            <AuthButton title={form.attachment.name} variant="ghost" disabled={busy} onPress={()=>void openFile(form.attachment!.path)} />
            <AuthButton title={t('days.removeFile')} variant="ghost" disabled={busy} onPress={()=>setForm({...form,attachment:null})} />
          </>}
          <AuthButton title={t('days.attach')} variant="ghost" disabled={busy} onPress={()=>void attach(sheet.day)} /></>}
          {sheet.day.log_status==='submitted' && field(t('days.reason'),form.reason,value=>setForm({...form,reason:value}))}
          <AuthButton title={t(sheet.day.log_status === 'draft' ? 'days.sendMentor' : 'common.save')} loading={busy} disabled={closed} onPress={()=>saveLog(sheet.day,true)} />
          {sheet.day.log_status==='draft' && <AuthButton title={t('days.saveDraft')} variant="ghost" disabled={busy || closed} onPress={()=>saveLog(sheet.day,false)} />}
        </> : <>
          {sheet.day.log_status==='submitted' ? <>
            <Text style={ui.label}>{t('days.experience')}</Text><Text style={ui.body}>{sheet.day.experience}</Text>
            <Text style={ui.label}>{t('days.learning')}</Text><Text style={ui.body}>{sheet.day.learning}</Text>
            <Text style={ui.label}>{t('days.selfAssessment')}</Text><Text style={ui.body}>{t('days.support'+sheet.day.support_level)}</Text>
            {!!sheet.day.next_step && <><Text style={ui.label}>{t('days.nextStep')}</Text><Text style={ui.body}>{sheet.day.next_step}</Text></>}
            {!!sheet.day.task_title && <Text style={ui.body}>{taskContent(sheet.day.task_title,i18n.language)} · {competencyContent(sheet.day.competency_name,i18n.language)}</Text>}
            {sheet.day.attachment && <AuthButton title={sheet.day.attachment.name} variant="ghost" disabled={busy} onPress={()=>void openFile(sheet.day.attachment!.path)} />}
          </> : <Text style={ui.secondary}>{t('days.draftPrivate')}</Text>}
          {field(t('days.feedback'),note,setNote)}
          <AuthButton title={t('days.sendFeedback')} loading={busy} onPress={()=>{
            if(!note.trim()){setSheetError('days.required');return;} void run(()=>service.note(sheet.day,note,false));
          }} />
          {role==='advisor' && <AuthButton title={t('days.requestCorrection')} variant="ghost" disabled={busy} onPress={()=>{
            if(!note.trim()){setSheetError('days.reasonRequired');return;} void run(()=>service.note(sheet.day,note,true));
          }} />}
          {role==='mentor' && <AuthButton title={t('days.review')} disabled={busy} variant="ghost" onPress={()=>{
            openReview([sheet.day], sheet.day.attendance !== 'pending');
          }} />}
        </>}
        {role !== 'advisor' && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showEvents }} disabled={busy}
          onPress={() => setShowEvents(!showEvents)} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={ui.link}>{t('days.history')} {showEvents ? '−' : '+'}</Text>
        </Pressable>}
        {showEvents && <><Text style={ui.section}>{t('days.history')}</Text>
        {role !== 'advisor' && <>
          <Text style={ui.secondary}>{t('days.recorded')}: {timestamp(sheet.day.reported_at,sheet.day.timezone)} · {sheet.day.timezone}</Text>
          <Text style={ui.secondary}>{t(sheet.day.check_in_at ? 'days.liveDeclaration' : 'days.lateDeclaration')}</Text>
          {!!sheet.day.report_reason && <Text style={ui.body}>{sheet.day.report_reason}</Text>}
        </>}
        {events===null && !eventError && <ActivityIndicator color={colors.primaryDark} />}
        {!!eventError && <><Text style={ui.body}>{t(eventError)}</Text><AuthButton title={t('common.retry')} onPress={()=>void readEvents(sheet.day.id)} /></>}
        {events?.map(event=><View key={event.id} style={ui.card}>
          <Text style={ui.label}>{t('days.event_'+event.event_type)}</Text>
          <Text style={ui.secondary}>{event.actor_name} · {timestamp(event.created_at,sheet.day.timezone)}</Text>
          {!!event.note && <Text style={ui.body}>{event.note}</Text>}
          {event.event_type==='attendance' && <Text style={ui.body}>{t('days.'+event.previous_value?.attendance)} → {t('days.'+event.next_value?.attendance)}</Text>}
        </View>)}</>}
      </>}
    </ProfileSheet>}
  </SafeAreaView>;
}
