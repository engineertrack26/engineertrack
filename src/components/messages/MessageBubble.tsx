import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius } from '@/theme';
import type { Message } from '@/types/messages';

export function MessageBubble({ message, mine, locale }: { message: Message; mine: boolean; locale: string }) {
  const time = new Date(message.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
        <Text style={[styles.body, mine && styles.bodyMine]}>{message.body}</Text>
        <Text style={[styles.time, mine && styles.timeMine]}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.lg },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.divider },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  bodyMine: { color: '#fff' },
  time: { fontSize: 11, color: colors.textSecondary, marginTop: 2, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.8)' },
});
