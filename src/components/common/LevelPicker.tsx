import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '@/theme';
import { levelLabel, SUPERVISION_LEVELS, type SupervisionLevel } from '@/utils/selfAssessment';

interface LevelPickerProps {
  value: SupervisionLevel | null;
  onChange: (value: SupervisionLevel) => void;
  disabled?: boolean;
  label?: string;
}

/** The four-step supervision scale as a row of radio chips -- the same
 *  "pick one of four levels" shape as the advisor's target-level chips in
 *  app/(advisor)/group-competencies.tsx, reused here for the student's and
 *  mentor's per-task rating (self-assessment design, decision 1/2). */
export function LevelPicker({ value, onChange, disabled, label }: LevelPickerProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.row} accessibilityRole="radiogroup">
        {SUPERVISION_LEVELS.map((level) => {
          const selected = value === level;
          return (
            <Pressable
              key={level}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: !!disabled }}
              disabled={disabled}
              onPress={() => onChange(level)}
              style={[
                styles.chip,
                selected && styles.chipSelected,
                disabled && styles.chipDisabled,
              ]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {levelLabel(level, t)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.primaryDark },
  chipTextSelected: { color: colors.textOnPrimary },
});
