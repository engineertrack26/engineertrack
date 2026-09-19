import { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { groupService } from '@/services/group';
import { useAuthStore } from '@/store/authStore';
import { LoadFailedBanner } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';
import { filterAdvisorGroups, groupCenterRoute } from '@/utils/advisorGroups';
import type { InternshipGroup } from '@/types/group';
import { AdvisorBell, GroupModal, groupStyles as styles } from './GroupUI';

export function GroupList({ advisorId, active }: { advisorId: string; active: boolean }) {
  const { t, i18n } = useTranslation();
  const [groups, setGroups] = useState<InternshipGroup[]>([]);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const [list, members] = await Promise.allSettled([
        groupService.listMyGroups(advisorId), groupService.countMembersByGroup(),
      ]);
      if (request !== sequence.current || useAuthStore.getState().user?.id !== advisorId) return;
      if (list.status === 'fulfilled') setGroups(list.value);
      setCounts(members.status === 'fulfilled' ? members.value : null);
      setFailed(list.status === 'rejected' || members.status === 'rejected');
    } finally {
      if (request === sequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [advisorId]);
  useFocusEffect(useCallback(() => {
    if (active) void load();
    return () => { sequence.current += 1; };
  }, [active, load]));
  const filtered = filterAdvisorGroups(groups, archived, search, i18n.language);
  return <>
    <FlatList
      data={filtered} keyExtractor={(g) => g.id}
      contentContainerStyle={[ui.content, { flexGrow: 1, gap: 0 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} colors={[colors.primaryDark]} />}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <View style={styles.row}>
          <Text style={[ui.title, styles.grow]} accessibilityRole="header">{t('advisorGroups.myGroups')}</Text>
          <AdvisorBell />
        </View>
        <Text style={ui.secondary}>{t('advisorGroups.subtitle')}</Text>
        <TextInput style={ui.input} value={search} onChangeText={setSearch}
          accessibilityLabel={t('advisorGroups.search')} placeholder={t('advisorGroups.search')}
          placeholderTextColor={colors.textSecondary} autoCorrect={false} />
        <View style={styles.wrap}>
          {[false, true].map((value) => <TouchableOpacity key={String(value)}
            accessibilityRole="button" accessibilityState={{ selected: archived === value }}
            style={[styles.pill, archived === value && styles.selected]} onPress={() => setArchived(value)}>
            <Text style={styles.linkText}>{t(value ? 'advisorGroups.archiveTab' : 'advisorGroups.active')}</Text>
          </TouchableOpacity>)}
          <TouchableOpacity accessibilityRole="button" style={styles.outline} onPress={() => setShowCreate(true)}>
            <Text style={styles.linkText}>+ {t('advisorGroups.newGroup')}</Text>
          </TouchableOpacity>
        </View>
        {failed && <LoadFailedBanner onRetry={() => void load()} />}
        <View style={styles.ledger} />
      </View>}
      renderItem={({ item: g }) => <TouchableOpacity style={[styles.row, styles.ledgerRow]} accessibilityRole="button"
        accessibilityLabel={[g.name, g.term, t('advisorGroups.openGroup')].filter(Boolean).join(', ')}
        onPress={() => router.push(groupCenterRoute(g.id))}>
        <View style={styles.grow}>
          <Text style={ui.label}>{g.name}</Text>
          <Text style={ui.secondary}>{[g.term, counts !== null ? t('advisorGroups.memberCount', { count: counts[g.id] ?? 0 }) : t('advisorGroups.countUnavailable'),
            g.isArchived && t('advisorGroups.archived')].filter(Boolean).join(' · ')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.ink} />
      </TouchableOpacity>}
      ListEmptyComponent={loading ? <ActivityIndicator size="large" color={colors.primaryDark} /> :
        failed ? null : <View style={[ui.card, { marginTop: 16 }]}>
          <Text style={ui.section}>{t(search.trim() ? 'advisorGroups.noMatches' : archived ? 'advisorGroups.noArchive' : 'advisorGroups.noActive')}</Text>
          <Text style={ui.secondary}>{t(search.trim() ? 'advisorGroups.searchHint' : archived ? 'advisorGroups.archiveHint' : 'advisorGroups.createHint')}</Text>
        </View>}
    />
    {showCreate && <CreateGroup advisorId={advisorId} onClose={() => setShowCreate(false)}
      onCreated={(group) => { setShowCreate(false); setArchived(false); setSearch(''); setGroups((prev) => [group, ...prev]); router.push(groupCenterRoute(group.id)); }} />}
  </>;
}

function CreateGroup({ advisorId, onClose, onCreated }: {
  advisorId: string; onClose: () => void; onCreated: (group: InternshipGroup) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [term, setTerm] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const close = () => {
    if (lock.current) return;
    if (!name.trim() && !term.trim()) { onClose(); return; }
    Alert.alert(t('advisorGroups.discardTitle'), t('advisorGroups.discardBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('advisorGroups.discard'), style: 'destructive', onPress: onClose },
    ]);
  };
  const create = async () => {
    if (lock.current || !name.trim()) return;
    lock.current = true; setSaving(true);
    try {
      const group = await groupService.createGroup(advisorId, { name: name.trim(), term: term.trim() || undefined });
      if (useAuthStore.getState().user?.id === advisorId) onCreated(group);
    } catch {
      if (useAuthStore.getState().user?.id === advisorId) Alert.alert(t('common.error'), t('advisorGroups.createFailed'));
    } finally { lock.current = false; setSaving(false); }
  };
  return <GroupModal title={t('advisorGroups.newGroup')} onClose={close} busy={saving}>
    <Text style={ui.secondary}>{t('advisorGroups.createHint')}</Text>
    <Text style={ui.label}>{t('advisorGroups.groupName')}</Text>
    <TextInput style={ui.input} value={name} onChangeText={setName} editable={!saving}
      accessibilityLabel={t('advisorGroups.groupName')} placeholder={t('advisorGroups.groupNamePlaceholder')} placeholderTextColor={colors.textSecondary} />
    <Text style={ui.label}>{t('advisorGroups.groupTerm')}</Text>
    <TextInput style={ui.input} value={term} onChangeText={setTerm} editable={!saving}
      accessibilityLabel={t('advisorGroups.groupTerm')} placeholder={t('advisorGroups.groupTermPlaceholder')} placeholderTextColor={colors.textSecondary} />
    <TouchableOpacity style={[ui.primary, (!name.trim() || saving) && { opacity: 0.5 }]}
      accessibilityRole="button" accessibilityState={{ disabled: !name.trim() || saving, busy: saving }}
      disabled={!name.trim() || saving} onPress={() => void create()}>
      {saving && <ActivityIndicator color="#fff" />}
      <Text style={ui.primaryText}>{t('advisorGroups.createGroup')}</Text>
    </TouchableOpacity>
  </GroupModal>;
}
