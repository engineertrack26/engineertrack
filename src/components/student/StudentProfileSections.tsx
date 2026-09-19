import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { ui } from '@/components/common/workflowStyles';
import { LoadFailedBanner } from '@/components/common';
import { ProfileSheet } from '@/components/mentor/ProfileSheet';
import { studentProfileViewService } from '@/services/studentProfileView';
import { studentCodeService } from '@/services/studentCode';
import { groupService } from '@/services/group';
import { messageService } from '@/services/messages';
import { useAuthStore } from '@/store/authStore';
import { mapRpcError } from '@/utils/rpcErrors';
import { normalizeCode } from '@/utils/codes';
import { INTERNSHIP_FIELDS, internshipInfoComplete, profileField } from '@/utils/studentProfile';
import { colors } from '@/theme';

type Snapshot = Awaited<ReturnType<typeof studentProfileViewService.load>>;

function Section({ title, loading, failed, onRetry, children }: {
  title: string; loading: boolean; failed: boolean; onRetry: () => void; children: ReactNode;
}) {
  return <View style={ui.card}>
    <Text accessibilityRole="header" style={ui.section}>{title}</Text>
    {loading ? <ActivityIndicator color={colors.primaryDark} /> : failed ? <LoadFailedBanner onRetry={onRetry} /> : children}
  </View>;
}

export function StudentProfileSections({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState<'join' | 'generate' | 'copy' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<'join' | 'generate' | 'copy' | null>(null);
  const [success, setSuccess] = useState<{ key: string; name?: string } | null>(null);
  const [deletable, setDeletable] = useState<number | null>(null);
  const generation = useRef(0);
  const active = useRef(true);
  const lock = useRef(false);
  const current = () => active.current && useAuthStore.getState().user?.id === userId;
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setLoadFailed(false);
    try {
      const result = await studentProfileViewService.load(userId);
      if (request === generation.current && useAuthStore.getState().user?.id === userId) setSnapshot(result);
    } catch {
      if (request === generation.current) setLoadFailed(true);
    } finally { if (request === generation.current) setLoading(false); }
  }, [userId]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    if (!lock.current) setBusy(null);
    void load();
    return () => { active.current = false; generation.current++; setJoining(false); setCodeInput(''); };
  }, [load]));

  const internship = snapshot?.internship.status === 'fulfilled' ? snapshot.internship.value : null;
  const group = snapshot?.group.status === 'fulfilled' ? snapshot.group.value : null;
  const code = snapshot?.code.status === 'fulfilled' ? snapshot.code.value : null;
  const linked = snapshot?.linked.status === 'fulfilled' ? snapshot.linked.value : null;
  const failed = (key: keyof Snapshot) => loadFailed || snapshot?.[key].status === 'rejected';
  useEffect(() => {
    if (!joining || !group) { setDeletable(null); return; }
    let cancelled = false;
    void messageService.countDeletable(group.id, userId).catch(() => null).then((n) => { if (!cancelled) setDeletable(n); });
    return () => { cancelled = true; };
  }, [joining, group?.id, userId]);
  const mutate = async (kind: 'join' | 'generate' | 'copy', work: () => Promise<{ key: string; name?: string }>) => {
    if (lock.current || !current()) return;
    lock.current = true; setBusy(kind); setFeedbackKind(kind); setError(null); setSuccess(null);
    try {
      const message = await work();
      if (!current()) return;
      setSuccess(message);
      if (kind === 'join') { setJoining(false); setCodeInput(''); }
      if (kind !== 'copy') await load();
    } catch (err) {
      if (current()) setError(mapRpcError(err instanceof Error ? err.message : '').key);
    } finally { lock.current = false; if (current()) setBusy(null); }
  };
  const editInternship = () => router.push({ pathname: '/(student)/internship-form', params: { return: 'profile' } });
  const button = (label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void, primary = false, working = false) =>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!busy, busy: working }} disabled={!!busy} onPress={onPress}
      style={[ui.primary, !primary && { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.ink }, !!busy && { opacity: 0.6 }]}>
      {working ? <ActivityIndicator color={primary ? '#fff' : colors.primaryDark} /> : <Ionicons name={icon} size={22} color={primary ? '#fff' : colors.primaryDark} />}
      <Text style={[ui.primaryText, !primary && { color: colors.primaryDark }]}>{label}</Text>
    </Pressable>;

  return <>
    <Section title={t('studentProfileView.internship')} loading={loading} failed={failed('internship')} onRetry={load}>
      {!internshipInfoComplete(internship) && <View style={ui.note}>
        <Text style={ui.body}>{t('studentProfileView.incomplete')}</Text>
      </View>}
      <View style={{ gap: 4 }}>
        <Text style={ui.secondary}>{t('student.universityName')}</Text>
        <Text style={ui.label}>{profileField(internship?.university, false, i18n.language)}</Text>
        <Text style={ui.secondary}>{profileField(internship?.department, false, i18n.language)}</Text>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={ui.secondary}>{t('student.companyName')}</Text>
        <Text style={ui.label}>{profileField(internship?.company_name, false, i18n.language)}</Text>
        <Text style={ui.secondary}>{profileField(internship?.internship_start_date, true, i18n.language)} – {profileField(internship?.internship_end_date, true, i18n.language)}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={[ui.header, { minHeight: 48 }]}>
        <Text style={[ui.link, { flex: 1 }]}>{t(expanded ? 'studentProfileView.hideDetails' : 'studentProfileView.showDetails')}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.primaryDark} />
      </Pressable>
      {expanded && <View style={{ gap: 16, borderTopWidth: 1, borderColor: colors.divider, paddingTop: 16 }}>
        {INTERNSHIP_FIELDS.map(([key, label]) => <View key={key} style={{ gap: 4 }}>
          <Text style={ui.secondary}>{t(label)}</Text><Text selectable style={ui.body}>{profileField(internship?.[key], key.endsWith('_date'), i18n.language)}</Text>
        </View>)}
      </View>}
      {button(t('studentProfileView.editInternship'), 'pencil-outline', editInternship)}
    </Section>

    <Section title={t('studentProfileView.group')} loading={loading} failed={failed('group')} onRetry={load}>
      {!!success && feedbackKind === 'join' && <Text accessibilityLiveRegion="polite" style={ui.body}>{t(success.key, { name: success.name })}</Text>}
      {group ? <View style={{ gap: 6 }}>
        <Text style={ui.section}>{group.name}</Text>
        {!!group.term && <Text style={ui.secondary}>{group.term}</Text>}
        {!!group.advisorName && <Text style={ui.body}>{t('studentProfileView.advisor')}: {group.advisorName}</Text>}
      </View> : <Text style={ui.body}>{t('student.noGroupYet')}</Text>}
      {button(t('student.joinGroup'), 'people-outline', () => { setCodeInput(''); setError(null); setSuccess(null); setJoining(true); })}
    </Section>

    <Section title={t('student.myStudentCode')} loading={loading} failed={failed('code')} onRetry={load}>
      <Text style={ui.body}>{t('student.studentCodeHint')}</Text>
      {!!success && feedbackKind !== 'join' && <Text accessibilityLiveRegion="polite" style={ui.body}>{t(success.key)}</Text>}
      {!!error && feedbackKind !== 'join' && <Text accessibilityRole="alert" style={[ui.body, { color: colors.error }]}>{t(error)}</Text>}
      {code?.code ? <>
        <View style={{ padding: 16, backgroundColor: colors.inkBg, borderRadius: 6, alignItems: 'center' }}>
          <Text selectable style={[ui.title, { color: colors.primaryDark, letterSpacing: 3 }]}>{code.code}</Text>
        </View>
        {button(t('studentProfileView.copyCode'), 'copy-outline', () => { void mutate('copy', async () => {
          await Clipboard.setStringAsync(code.code); return { key: 'student.studentCodeCopied' };
        }); }, false, busy === 'copy')}
      </> : <>
        <Text style={ui.secondary}>{t('studentProfileView.noCode')}</Text>
        {button(t('studentProfileView.generateCode'), 'key-outline', () => { void mutate('generate', async () => {
          await studentCodeService.generateCode(userId); return { key: 'studentProfileView.codeCreated' };
        }); }, true, busy === 'generate')}
      </>}
    </Section>

    <Section title={t('studentProfileView.linked')} loading={loading} failed={failed('linked')} onRetry={load}>
      {(['mentor', 'advisor'] as const).map(role => <View key={role} style={{ gap: 4, minHeight: 48 }}>
        <Text style={ui.secondary}>{t('studentProfileView.' + role)}</Text>
        <Text style={ui.label}>{linked?.[role] ? [linked[role]!.firstName, linked[role]!.lastName].filter(Boolean).join(' ') || '—' : t('studentProfileView.notLinked')}</Text>
      </View>)}
    </Section>

    {joining && <ProfileSheet title={t('student.joinGroup')} busy={!!busy} onClose={() => { if (!lock.current) { setJoining(false); setCodeInput(''); setError(null); } }}>
      <Text style={ui.body}>{t('student.joinGroupHint')}</Text>
      {deletable !== null && deletable > 0 && <Text style={[ui.body, { color: colors.error }]}>{t('messages.leaveWarning', { count: deletable, defaultValue_one: 'Joining another group deletes your {{count}} conversation in the current group permanently. Re-entering your current group\'s code changes nothing.', defaultValue_other: 'Joining another group deletes your {{count}} conversations in the current group permanently. Re-entering your current group\'s code changes nothing.' })}</Text>}
      <Text style={ui.label}>{t('studentProfileView.groupCode')}</Text>
      <TextInput autoFocus autoCapitalize="characters" autoCorrect={false} value={codeInput} editable={!busy}
        onChangeText={value => { setCodeInput(normalizeCode(value).slice(0, 6)); setError(null); }} accessibilityLabel={t('studentProfileView.groupCode')}
        placeholder={t('student.groupCodePlaceholder')} placeholderTextColor={colors.textSecondary} style={ui.input} />
      {!!error && <Text accessibilityRole="alert" style={[ui.body, { color: colors.error }]}>{t(error)}</Text>}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!busy || codeInput.length !== 6, busy: busy === 'join' }}
        disabled={!!busy || codeInput.length !== 6} style={[ui.primary, (!!busy || codeInput.length !== 6) && { opacity: 0.5 }]}
        onPress={() => { void mutate('join', async () => {
          const result = await groupService.joinByCode(codeInput);
          return { key: 'student.joinedGroup', name: result.name };
        }); }}>
        {busy === 'join' && <ActivityIndicator color="#fff" />}<Text style={ui.primaryText}>{t('student.join')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => { setJoining(false); setCodeInput(''); setError(null); }} style={{ minHeight: 48 }}>
        <Text style={[ui.link, { textAlign: 'center' }]}>{t('common.cancel')}</Text>
      </Pressable>
    </ProfileSheet>}
  </>;
}
