import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { competencyService } from '@/services/competency';
import { colors, spacing, borderRadius } from '@/theme';
import type { Competency } from '@/types/competency';

const ADVISOR_COLOR = colors.info;
const LEVELS = [1, 2, 3, 4];

export default function GroupCompetenciesScreen() {
  const { t } = useTranslation();
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();

  const [competencies, setCompetencies] = useState<Competency[]>([]);
  // competencyId -> target level, absent means not selected
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!groupId) return;
    try {
      const [{ competencies: cs }, ts] = await Promise.all([
        competencyService.listFramework(),
        competencyService.getGroupTargets(groupId),
      ]);
      setCompetencies(cs);
      const map: Record<string, number> = {};
      for (const target of ts) map[target.competencyId] = target.targetLevel;
      setTargets(map);
    } catch (err) {
      console.error('Group competencies load error:', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  async function handleSave() {
    if (!groupId) return;
    setSaving(true);
    try {
      await competencyService.setGroupTargets(
        groupId,
        Object.entries(targets).map(([competencyId, targetLevel]) => ({
          competencyId, targetLevel,
        })),
      );
      Alert.alert(t('common.done'), t('advisor.competencySaved'));
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('errors.unknown'));
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string) {
    setTargets((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = 2;
      return next;
    });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loading}><ActivityIndicator size="large" color={ADVISOR_COLOR} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[ADVISOR_COLOR]} />
        }
      >
        <Text style={styles.screenTitle}>{t('advisor.competencyScope')}</Text>
        <Text style={styles.hint}>{t('advisor.competencyScopeHint')}</Text>

        {competencies.map((competency) => {
          const selected = competency.id in targets;
          return (
            <View key={competency.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.name}>{competency.name}</Text>
                <Switch
                  value={selected}
                  onValueChange={() => toggle(competency.id)}
                  trackColor={{ true: ADVISOR_COLOR }}
                />
              </View>

              {selected && (
                <>
                  <Text style={styles.label}>{t('advisor.targetLevel')}</Text>
                  <View style={styles.levelRow}>
                    {LEVELS.map((level) => {
                      const active = targets[competency.id] === level;
                      return (
                        <TouchableOpacity
                          key={level}
                          style={[styles.levelChip, active && styles.levelChipActive]}
                          onPress={() => setTargets((p) => ({ ...p, [competency.id]: level }))}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.levelText, active && styles.levelTextActive]}>
                            L{level}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          );
        })}

        {Object.keys(targets).length === 0 && (
          <Text style={styles.hint}>{t('advisor.noCompetencies')}</Text>
        )}

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.7}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>{t('common.save')}</Text>
          )}
        </TouchableOpacity>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
    marginTop: spacing.sm,
  },

  // Level picker
  levelRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  levelChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.background,
  },
  levelChipActive: {
    backgroundColor: ADVISOR_COLOR,
    borderColor: ADVISOR_COLOR,
  },
  levelText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  levelTextActive: {
    color: '#fff',
  },

  // Save button
  primaryBtn: {
    backgroundColor: ADVISOR_COLOR,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
