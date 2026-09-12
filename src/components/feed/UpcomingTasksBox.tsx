import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { taskDueDate } from '@/utils/studentTasks';
import { colors, spacing, borderRadius } from '@/theme';
import type { UpcomingCandidate } from '@/utils/feedUpcoming';

interface Props {
  tasks: UpcomingCandidate[];
  onOpen: (task: UpcomingCandidate) => void;
}

/** Up to three tasks due soon, above the stream. Renders nothing when empty
 *  -- an empty "upcoming" box would only say "nothing is due", which the
 *  absence of the box already says. */
export function UpcomingTasksBox({ tasks, onOpen }: Props) {
  const { t, i18n } = useTranslation();
  if (tasks.length === 0) return null;
  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
        <Text style={styles.title}>{t('studentFlow.upcoming')}</Text>
      </View>
      {tasks.map((task) => {
        const due = taskDueDate(task.dueDate, i18n.language);
        return (
          <TouchableOpacity key={task.id} style={styles.row} onPress={() => onOpen(task)} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
              {!!due && <Text style={styles.due}>{t('student.taskDueDate')}: {due}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md, gap: spacing.xs, borderWidth: 1, borderColor: colors.primary + '30' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  title: { fontSize: 14, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  taskTitle: { fontSize: 14, color: colors.text },
  due: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
