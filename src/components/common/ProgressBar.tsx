import { View, Text, StyleSheet } from 'react-native';
import { colors, borderRadius, spacing } from '@/theme';

interface ProgressBarProps {
  progress: number; // 0 to 1
  color?: string;
  height?: number;
  label?: string;
}

export function ProgressBar({
  progress,
  color = colors.gamification.xp,
  height = 10,
  label,
}: ProgressBarProps) {
  const clampedProgress = Math.min(Math.max(progress, 0), 1);

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.track, { height }]}>
        <View
          style={[
            styles.fill,
            {
              width: `${clampedProgress * 100}%`,
              backgroundColor: color,
              height,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    fontWeight: '500',
  },
  track: {
    width: '100%',
    backgroundColor: colors.divider,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: borderRadius.full,
  },
});
