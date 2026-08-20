import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { competencyService } from '@/services/competency';
import { colors, spacing } from '@/theme';
import type { WorkingKpi } from '@/types/competency';

interface Props {
  studentId: string;
  logId: string | null;
  observerId: string;
  title: string;
  hint: string;
  onChange: (kpiIds: string[]) => void;
}

export function KpiChecklist({ studentId, logId, observerId, title, hint, onChange }: Props) {
  const { t } = useTranslation();
  const [kpis, setKpis] = useState<WorkingKpi[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // Set the moment the user ticks/unticks anything. Once true, a reload
  // (e.g. logId flipping from null to a real id after a draft save) must
  // not overwrite what's on screen with a DB pre-fill — a ref rather than
  // state because this must not itself trigger a re-render or re-run load.
  const touchedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const working = await competencyService.getWorkingKpis(studentId);
      setKpis(working);
      if (logId && !touchedRef.current) {
        const already = await competencyService.getObservedKpiIds(studentId, logId, observerId);
        setSelected(new Set(already));
        onChange(already);
      }
    } catch (err) {
      console.error('KPI checklist load error:', err);
    } finally {
      setLoading(false);
    }
    // onChange is intentionally omitted: parents pass an inline arrow, and
    // including it would reload the list on every parent render.
  }, [studentId, logId, observerId]);

  useEffect(() => { load(); }, [load]);

  function toggle(kpiId: string) {
    touchedRef.current = true;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kpiId)) next.delete(kpiId);
      else next.add(kpiId);
      onChange(Array.from(next));
      return next;
    });
  }

  if (loading) return <ActivityIndicator size="small" color={colors.primary} />;

  if (kpis.length === 0) {
    return <Text style={styles.empty}>{t('mentor.noWorkingKpis')}</Text>;
  }

  // Grouped by competency so the mentor reads "Technical Documentation: these
  // two behaviours", not a flat list of twelve sentences.
  const byCompetency = kpis.reduce<Record<string, WorkingKpi[]>>((acc, kpi) => {
    (acc[kpi.competencyName] = acc[kpi.competencyName] || []).push(kpi);
    return acc;
  }, {});

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.hint}>{hint}</Text>

      {Object.entries(byCompetency).map(([name, items]) => (
        <View key={name} style={styles.group}>
          <Text style={styles.groupName}>
            {name} · L{items[0].level}
          </Text>
          {items.map((kpi) => {
            const on = selected.has(kpi.kpiId);
            return (
              <TouchableOpacity
                key={kpi.kpiId}
                style={styles.row}
                onPress={() => toggle(kpi.kpiId)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={on ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={on ? colors.primary : colors.textDisabled}
                />
                <Text style={styles.statement}>{kpi.statement}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.xs,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  hint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  group: {
    marginBottom: spacing.md,
  },
  groupName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  statement: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  empty: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },
});
