import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { taskContent } from '@/utils/taskContent';
import { Ionicons } from '@expo/vector-icons';
import { taskDueDate } from '@/utils/studentTasks';
import { colors, spacing, fonts } from '@/theme';
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
        <Ionicons name="calendar-outline" size={16} color={colors.inkSoft} />
        <Text style={styles.title}>{t('studentFlow.upcoming')}</Text>
      </View>
      {tasks.map((task) => {
        const due = taskDueDate(task.dueDate, i18n.language);
        return (
          <TouchableOpacity key={task.id} style={styles.row} onPress={() => onOpen(task)} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskTitle} numberOfLines={1}>{taskContent(task.title, i18n.language)}</Text>
              {!!due && <Text style={styles.due}>{t('student.taskDueDate')}: {due}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.ink} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginBottom: spacing.md, gap: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingBottom: spacing.xs, borderBottomWidth: 1, borderColor: colors.ruleStrong },
  title: { fontSize: 14, fontWeight: '600', fontFamily: fonts.semibold, color: colors.inkSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.divider },
  taskTitle: { fontSize: 15, fontFamily: fonts.regular, color: colors.text },
  due: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 2 },
});
