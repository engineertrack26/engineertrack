import { View } from 'react-native';
import { colors } from '@/theme';

interface LevelRailProps {
  current: number;
  target: number;
  max?: number;
  label?: string;
  tone?: 'ink' | 'stamp';
}

export function LevelRail({ current, target, max = 4, label, tone = 'ink' }: LevelRailProps) {
  const rungColor = tone === 'stamp' ? colors.stamp : colors.ink;
  const rungs = Array.from({ length: max }, (_, i) => i);

  return <View
    accessible
    accessibilityRole="progressbar"
    accessibilityLabel={label}
    accessibilityValue={{ min: 0, max, now: current }}
    style={{ flexDirection: 'row', gap: 4 }}>
    {rungs.map((i) => {
      const filled = i < current;
      const isTarget = !filled && i >= current && i < target;
      return <View key={i} style={{
        width: 22,
        height: 9,
        borderRadius: 2,
        borderWidth: 1,
        borderColor: rungColor,
        borderStyle: isTarget ? 'dashed' : 'solid',
        backgroundColor: filled ? rungColor : 'transparent',
      }} />;
    })}
  </View>;
}
