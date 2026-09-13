import { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { useAuthStore } from '@/store/authStore';
import { useGroupStore } from '@/store/groupStore';
import { advisorGroupViewService } from '@/services/advisorGroupView';
import { groupService } from '@/services/group';
import { messageService } from '@/services/messages';
import { BackButton, LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';
import type { InternshipGroup } from '@/types/group';
import { groupWorkspaceRoute } from '@/utils/advisorGroups';
import { AdvisorBell, GroupModal, GroupRow, groupStyles as styles } from './GroupUI';

type GroupView = NonNullable<Awaited<ReturnType<typeof advisorGroupViewService.load>>>;

export function GroupCenter({ advisorId, groupId }: { advisorId: string; groupId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<GroupView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const result = await advisorGroupViewService.load(advisorId, groupId);
      if (request !== sequence.current || useAuthStore.getState().user?.id !== advisorId) return;
      if (result) useGroupStore.setState({ groups: result.groups });
      setData(result); setFailed(false);
    } catch {
      if (request === sequence.current) setFailed(true);
    } finally {
      if (request === sequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [advisorId, groupId]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { sequence.current += 1; };
  }, [load]));
  const open = (screen: 'student-monitor' | 'group-assignments' | 'group-competencies' | 'reports' | 'feed') => {
    const route = groupWorkspaceRoute(screen, groupId);
    // A repeated visit must honor this group even if the destination's local selector changed.
    router.push({ ...route, params: { ...route.params, entry: String(Date.now()) } });
  };
  const group = data?.group;
  const members = data?.members.status === 'fulfilled' ? data.members.value.length : null;
  const assignments = data?.assignments.status === 'fulfilled' ? data.assignments.value : null;
  const drafts = assignments?.filter((a) => !a.publishedAt).length ?? null;
  const targets = data?.targets.status === 'fulfilled' ? data.targets.value.length : null;
  const partial = !!data && (members === null || assignments === null || targets === null);
  return <ScrollView contentContainerStyle={ui.content}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} colors={[colors.primaryDark]} />}>
    <View style={styles.row}>
      <View style={styles.grow}><BackButton href={{ pathname: '/(advisor)/groups', params: { groupId: '' } }} /></View>
      <AdvisorBell />
    </View>
    {loading ? <ActivityIndicator size="large" color={colors.primaryDark} /> : <>
      {(failed || partial) && <LoadFailedBanner onRetry={() => void load()} />}
      {!group ? !failed && <Text style={ui.body}>{t('advisorGroups.unavailable')}</Text> : <>
        <Text style={ui.title} accessibilityRole="header">{group.name}</Text>
        {!!group.term && <Text style={ui.secondary}>{group.term}</Text>}
        <Text style={ui.secondary}>{members !== null ? t('advisorGroups.memberCount', { count: members }) : t('advisorGroups.countUnavailable')}</Text>
        <TouchableOpacity style={styles.outline} accessibilityRole="button" onPress={() => setShowInfo(true)}>
          <Text style={styles.linkText}>{t('advisorGroups.groupInfo')}</Text>
        </TouchableOpacity>
        {group.isArchived ? <View style={ui.note}>
          <Text style={ui.label}>{t('advisorGroups.archived')}</Text>
          <Text style={ui.secondary}>{t('advisorGroups.archivedHint')}</Text>
        </View> : <View style={[ui.card, styles.selected]}>
          <Text style={ui.section}>{t('advisorGroups.nextStep')}</Text>
          <Text style={ui.body}>{t(targets === 0 ? 'advisorGroups.targetsNext' : members === 0 ? 'advisorGroups.inviteNext' :
            drafts && drafts > 0 ? 'advisorGroups.draftsNext' : 'advisorGroups.tasksNext', { count: drafts ?? 0 })}</Text>
          <TouchableOpacity style={ui.primary} accessibilityRole="button"
            onPress={() => targets === 0 ? open('group-competencies') : members === 0 ? setShowInfo(true) : open('group-assignments')}>
            <Text style={ui.primaryText}>{t(targets === 0 ? 'advisorGroups.competencies' : members === 0 ? 'advisorGroups.groupInfo' :
              drafts && drafts > 0 ? 'advisorGroups.reviewDrafts' : 'advisorGroups.assignments')}</Text>
          </TouchableOpacity>
        </View>}
        <GroupRow title={t('advisorGroups.viewStudents')} detail={t('advisorGroups.membersHint')} icon="people-outline" onPress={() => open('student-monitor')} />
        <GroupRow title={t('advisorGroups.assignments')} detail={drafts !== null ? t('advisorGroups.taskCounts', { draft: drafts, published: (assignments?.length ?? 0) - drafts }) : undefined}
          icon="clipboard-outline" onPress={() => open('group-assignments')} />
        <GroupRow title={t('advisorGroups.competencies')} detail={t('advisorGroups.targetsHint')} icon="flag-outline" onPress={() => open('group-competencies')} />
        <GroupRow title={t('advisorGroups.reportsTitle')} icon="bar-chart-outline" onPress={() => open('reports')} />
        <TouchableOpacity style={styles.outline} accessibilityRole="button" onPress={() => open('feed')}>
          <Text style={styles.linkText}>{t('advisorGroups.openStream')}</Text>
        </TouchableOpacity>
        {showInfo && <GroupInfo group={group} onClose={() => setShowInfo(false)} onArchived={(isArchived) => {
          setData((prev) => prev ? { ...prev, group: { ...prev.group, isArchived } } : prev);
          void load();
        }} />}
      </>}
    </>}
  </ScrollView>;
}

function GroupInfo({ group, onClose, onArchived }: {
  group: InternshipGroup; onClose: () => void; onArchived: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const lock = useRef(false);
  const copy = async () => {
    try { await Clipboard.setStringAsync(group.joinCode); setCopied(true); }
    catch { Alert.alert(t('common.error'), t('advisorGroups.copyFailed')); }
  };
  const archive = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      await groupService.setArchived(group.id, !group.isArchived);
      if (useAuthStore.getState().user?.id === group.advisorId) onArchived(!group.isArchived);
    } catch { Alert.alert(t('common.error'), t('advisorGroups.archiveFailed')); }
    finally { lock.current = false; setBusy(false); }
  };
  const confirmArchive = async () => {
    if (lock.current) return;
    if (group.isArchived) { void archive(); return; }
    const n = await messageService.countDeletable(group.id).catch(() => 0);
    const body = t('advisorGroups.archiveConfirm', { name: group.name })
      + (n > 0 ? '\n\n' + t('messages.deleteWarning', { count: n, defaultValue_one: '{{count}} conversation and its messages will be permanently deleted.', defaultValue_other: '{{count}} conversations and their messages will be permanently deleted.' }) : '');
    Alert.alert(t('advisorGroups.archive'), body, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('advisorGroups.archive'), style: 'destructive', onPress: () => void archive() },
    ]);
  };
  return <GroupModal title={t('advisorGroups.groupInfo')} onClose={onClose} busy={busy}>
    <Text style={ui.title}>{group.name}</Text>
    {!!group.term && <Text style={ui.secondary}>{group.term}</Text>}
    <View style={ui.card}>
      <Text style={ui.label}>{t('advisorGroups.joinCode')}</Text>
      <Text selectable style={ui.cardTitle}>{group.joinCode}</Text>
      <Text style={ui.secondary}>{t(group.isArchived ? 'advisorGroups.archivedHint' : 'advisorGroups.joinCodeHint')}</Text>
      <TouchableOpacity style={styles.outline} accessibilityRole="button" disabled={!group.joinCode} onPress={() => void copy()}>
        <Text style={styles.linkText}>{t('advisorGroups.copyCode')}</Text>
      </TouchableOpacity>
      {copied && <Text style={ui.secondary} accessibilityLiveRegion="polite">{t('advisorGroups.joinCodeCopied')}</Text>}
    </View>
    <View style={ui.card}>
      <Text style={ui.label}>{t('advisorGroups.management')}</Text>
      <Text style={ui.secondary}>{t('advisorGroups.archiveHint')}</Text>
      <TouchableOpacity style={styles.outline} accessibilityRole="button" disabled={busy}
        accessibilityState={{ disabled: busy, busy }} onPress={confirmArchive}>
        {busy ? <ActivityIndicator color={colors.primaryDark} /> :
          <Text style={styles.linkText}>{t(group.isArchived ? 'advisorGroups.unarchive' : 'advisorGroups.archive')}</Text>}
      </TouchableOpacity>
    </View>
  </GroupModal>;
}
