import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, ActivityIndicator, Alert, Switch, TextInput, BackHandler } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { competencyContent } from '@/utils/competencyContent';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { competencyService } from '@/services/competency';
import { groupService } from '@/services/group';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';
import type { Competency, CompetencyKpi } from '@/types/competency';
import type { InternshipGroup } from '@/types/group';
import { groupCenterRoute } from '@/utils/advisorGroups';
import { sameTargets, toggleTarget, validTargets, type TargetSelection } from '@/utils/advisorTargets';
import { ui } from '@/components/common/workflowStyles';
import { groupStyles } from '@/components/advisor/GroupUI';
import { LoadFailedBanner } from '@/components/common';

const LEVELS = [1, 2, 3, 4];

export default function GroupCompetenciesScreen() {
  const { groupId, fromGroup } = useLocalSearchParams<{ groupId?: string; fromGroup?: string }>();
  const advisorId = useAuthStore((s) => s.user?.id);
  return advisorId ? <TargetsContent key={advisorId + ':' + (groupId ?? '')}
    advisorId={advisorId} groupId={groupId} fromGroup={fromGroup} /> : null;
}

function TargetsContent({ advisorId, groupId, fromGroup }: { advisorId: string; groupId?: string; fromGroup?: string }) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const back = groupId && fromGroup === '1' ? groupCenterRoute(groupId) :
    { pathname: '/(advisor)/groups' as const, params: { groupId: '' } };
  const [group, setGroup] = useState<InternshipGroup | null>(null);
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [kpis, setKpis] = useState<CompetencyKpi[]>([]);
  const [targets, setTargets] = useState<TargetSelection>({});
  const [baseline, setBaseline] = useState<TargetSelection>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [saved, setSaved] = useState(false);
  const sequence = useRef(0);
  const active = useRef(false);
  const lock = useRef(false);
  const dirtyRef = useRef(false);
  const baselineRef = useRef<TargetSelection>({});
  const dirty = !sameTargets(targets, baseline);
  dirtyRef.current = dirty;
  baselineRef.current = baseline;

  const load = useCallback(async () => {
    const request = ++sequence.current;
    setRefreshing(true);
    const current = () => request === sequence.current && active.current &&
      useAuthStore.getState().user?.id === advisorId;
    if (!groupId) { setUnavailable(true); setLoading(false); setRefreshing(false); return; }
    try {
      const groups = await groupService.listMyGroups(advisorId);
      if (!current()) return;
      const owned = groups.find((g) => g.id === groupId);
      if (!owned) { setUnavailable(true); setGroup(null); setFailed(false); return; }
      const [framework, existing] = await Promise.all([
        competencyService.listFramework(), competencyService.getGroupTargets(groupId),
      ]);
      if (!current()) return;
      const selection = Object.fromEntries(existing.map((target) => [target.competencyId, target.targetLevel]));
      setGroup(owned); setCompetencies(framework.competencies); setKpis(framework.kpis);
      setTargets(selection); setBaseline(selection); dirtyRef.current = false;
      setFailed(false); setUnavailable(false); setSaveFailed(false); setSaved(false);
    } catch {
      if (current()) setFailed(true);
    } finally { if (current()) { setLoading(false); setRefreshing(false); } }
  }, [advisorId, groupId]);

  function discardThen(action: () => void) {
    setTargets(baselineRef.current); dirtyRef.current = false; action();
  }
  function requestLeave() {
    if (lock.current) return;
    const leave = () => router.navigate(back);
    if (!dirtyRef.current) { leave(); return; }
    Alert.alert(t('targetUi.unsaved'), t('targetUi.leave'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('targetUi.discard'), style: 'destructive', onPress: () => discardThen(leave) },
    ]);
  }
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (lock.current) { event.preventDefault(); return; }
    if (!dirtyRef.current) return;
    event.preventDefault();
    Alert.alert(t('targetUi.unsaved'), t('targetUi.leave'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('targetUi.discard'), style: 'destructive',
        onPress: () => discardThen(() => navigation.dispatch(event.data.action)) },
    ]);
  }), [navigation, t]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    // Tab visits must not replace local edits with a fresh server response.
    if (!dirtyRef.current && !lock.current) void load();
    return () => { active.current = false; sequence.current += 1; };
  }, [load]));
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { requestLeave(); return true; });
    return () => subscription.remove();
  }, [groupId, fromGroup, t]));

  function refresh() {
    if (lock.current) return;
    const run = () => { setRefreshing(true); void load(); };
    if (!dirtyRef.current) { run(); return; }
    Alert.alert(t('targetUi.unsaved'), t('targetUi.refresh'), [
      { text: t('common.cancel'), style: 'cancel' }, { text: t('common.retry'), onPress: run },
    ]);
  }
  function edit(next: TargetSelection) {
    if (lock.current || failed || refreshing || loading || unavailable) return;
    setTargets(next); setSaved(false);
  }
  async function save() {
    if (!groupId || !group || failed || lock.current || refreshing || !dirty ||
        useAuthStore.getState().user?.id !== advisorId) return;
    if (!validTargets(targets)) {
      Alert.alert(t('common.error'), t('advisor.competencyScopeEmpty')); return;
    }
    const snapshot = { ...targets };
    lock.current = true; setSaving(true); setSaveFailed(false);
    try {
      await competencyService.setGroupTargets(groupId, Object.entries(snapshot).map(([competencyId, targetLevel]) => ({ competencyId, targetLevel })));
      if (useAuthStore.getState().user?.id !== advisorId) return;
      setBaseline(snapshot); dirtyRef.current = false; setSaved(true);
    } catch {
      if (useAuthStore.getState().user?.id === advisorId) {
        setSaveFailed(true);
        Alert.alert(t('common.error'), t('targetUi.saveFailed'));
      }
    } finally { lock.current = false; setSaving(false); }
  }

  const filtered = competencies.filter((c) => (!selectedOnly || c.id in targets) &&
    (competencyContent(c.name, i18n.language) + ' ' + c.name + ' ' + c.code).toLocaleLowerCase(i18n.language).includes(search.trim().toLocaleLowerCase(i18n.language)));
  const disabled = saving || loading || refreshing || failed || unavailable;
  const canSave = !disabled && dirty && validTargets(targets);
  return <SafeAreaView style={ui.safe} edges={['top', 'left', 'right', 'bottom']}>
    <FlatList data={loading || unavailable ? [] : filtered} keyExtractor={(item) => item.id}
      contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} enabled={!saving} onRefresh={refresh} colors={[colors.primaryDark]} />}
      ListHeaderComponent={<View style={{ gap: 16 }}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('common.back')}
          disabled={saving} style={styles.back} onPress={requestLeave}>
          <Ionicons name="arrow-back" size={24} color={colors.primaryDark} /><Text style={groupStyles.linkText}>{t('common.back')}</Text>
        </TouchableOpacity>
        {!!group && <Text style={ui.secondary}>{group.name}{group.term ? ' · ' + group.term : ''}</Text>}
        <Text style={ui.title} accessibilityRole="header">{t('advisor.competencyScope')}</Text>
        <Text style={ui.secondary}>{t('advisor.competencyScopeHint')}</Text>
        {group?.isArchived && <Text style={ui.secondary}>{t('advisorGroups.archived')}</Text>}
        {failed && <LoadFailedBanner onRetry={refresh} />}
        {unavailable && <Text style={ui.body}>{t('advisorGroups.unavailable')}</Text>}
        {!unavailable && !loading && <>
          <View style={ui.note}><Text style={ui.secondary}>{t('targetUi.scopeHint')}</Text></View>
          <TextInput style={ui.input} value={search} onChangeText={setSearch} autoCorrect={false}
            accessibilityLabel={t('targetUi.search')} placeholder={t('targetUi.search')} placeholderTextColor={colors.textSecondary} />
          <View style={styles.wrap}>
            {[false, true].map((value) => <TouchableOpacity key={String(value)} accessibilityRole="button"
              accessibilityState={{ selected: selectedOnly === value }} style={[styles.choice, value === selectedOnly && styles.selected]}
              onPress={() => setSelectedOnly(value)}><Text style={groupStyles.linkText}>{t(value ? 'targetUi.selectedOnly' : 'targetUi.all')}</Text></TouchableOpacity>)}
          </View>
          {saveFailed && <Text style={ui.body} accessibilityRole="alert">{t('targetUi.saveFailed')}</Text>}
        </>}
      </View>}
      ListEmptyComponent={loading ? <ActivityIndicator size="large" color={colors.primaryDark} /> :
        !failed && !unavailable ? <Text style={ui.body}>{t('advisorGroups.noMatches')}</Text> : null}
      renderItem={({ item }) => {
        const selected = item.id in targets;
        const level = targets[item.id];
        const statements = kpis.filter((k) => k.competencyId === item.id && k.level === level)
          .sort((a, b) => a.kpiIndex - b.kpiIndex);
        return <View style={[ui.card, selected && styles.selected]}>
          <View style={ui.header}>
            <Text style={[ui.cardTitle, { flex: 1 }]}>{competencyContent(item.name, i18n.language)}</Text>
            <Switch value={selected} disabled={disabled} accessibilityLabel={competencyContent(item.name, i18n.language)}
              onValueChange={() => edit(toggleTarget(targets, item.id))} trackColor={{ true: colors.primaryDark }} />
          </View>
          <Text style={ui.secondary}>{t(selected ? 'targetUi.included' : 'targetUi.excluded')}</Text>
          {selected && <>
            <Text style={ui.label}>{t('advisor.targetLevel')}</Text>
            <View style={styles.wrap} accessibilityRole="radiogroup">
              {LEVELS.map((value) => <TouchableOpacity key={value} accessibilityRole="radio"
                accessibilityLabel={t('advisor.targetLevelShort', { level: value })}
                accessibilityState={{ checked: level === value, disabled }} disabled={disabled}
                style={[styles.choice, level === value && styles.activeLevel]}
                onPress={() => edit({ ...targets, [item.id]: value })}>
                <Text style={[groupStyles.linkText, level === value && { color: '#fff' }]}>L{value}</Text>
              </TouchableOpacity>)}
            </View>
            <Text style={ui.label}>{t('targetUi.levelContent', { level })}</Text>
            {statements.length ? statements.map((kpi) => <Text key={kpi.id} style={ui.body}>• {kpi.statement}</Text>) :
              <Text style={ui.secondary}>{t('targetUi.noDescription')}</Text>}
          </>}
        </View>;
      }} />
    {!loading && !unavailable && !failed && <View style={styles.footer}>
      <Text style={ui.label} accessibilityLiveRegion="polite">{t('targetUi.count', { count: Object.keys(targets).length })}</Text>
      <Text style={ui.secondary} accessibilityLiveRegion="polite">{t(dirty ? 'targetUi.unsaved' : saved ? 'advisor.competencySaved' : 'targetUi.upToDate')}</Text>
      {!Object.keys(targets).length && <Text style={ui.secondary}>{t('advisor.competencyScopeEmpty')}</Text>}
      <TouchableOpacity accessibilityRole="button" style={[ui.primary, !canSave && { opacity: 0.5 }]}
        disabled={!canSave} accessibilityState={{ disabled: !canSave, busy: saving }} onPress={() => void save()}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={ui.primaryText}>{t('common.save')}</Text>}
      </TouchableOpacity>
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  back: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: { minWidth: 48, minHeight: 48, borderWidth: 1, borderColor: colors.divider, borderRadius: 6, padding: 12, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: colors.inkBg, borderColor: colors.ink },
  activeLevel: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  footer: { padding: 16, gap: 8, borderTopWidth: 1, borderTopColor: colors.divider, width: '100%', maxWidth: 720, alignSelf: 'center' },
});
