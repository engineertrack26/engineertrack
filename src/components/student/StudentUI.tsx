import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/store/notificationStore';
import { colors } from '@/theme';
import { taskState, taskStateKey, taskDueDate } from '@/utils/studentTasks';
import type { MyAssignment } from '@/types/assignment';

export function StudentHeader({ title }: { title: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const count = useNotificationStore(s => s.unreadCount);
  return <View style={ui.header}>
    <Text accessibilityRole="header" style={[ui.title, { flex: 1 }]}>{title}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('studentFlow.notifications', { count })}
      onPress={() => router.push('/(student)/notifications')} style={ui.iconButton}>
      <Ionicons name="notifications-outline" size={25} color={colors.text} />
      {count > 0 && <View style={ui.dot} />}
    </Pressable>
  </View>;
}

export function TaskStatus({ task }: { task: MyAssignment }) {
  const { t } = useTranslation();
  const state = taskState(task);
  const ink = state === 'revise' ? '#854600' : state === 'done' ? '#1b6b3a' : '#1557b0';
  const backgroundColor = state === 'revise' ? '#fff2d5' : state === 'done' ? '#e7f4eb' : '#eaf2fe';
  return <Text style={[ui.badge, { color: ink, backgroundColor }]}>{t(taskStateKey(state))}</Text>;
}

export function TaskCard({ task, prominent = false }: { task: MyAssignment; prominent?: boolean }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const due = taskDueDate(task.dueDate, i18n.language);
  const open = () => router.push({ pathname: '/(student)/task-detail', params: { id: task.id } });
  const spokenLabel = [task.title, t(taskStateKey(taskState(task))), task.competencyName,
    due && `${t('student.taskDueDate')}: ${due}`, prominent && task.submission?.mentorNote,
    t(prominent ? 'studentFlow.continueTask' : 'studentFlow.viewTask')].filter(Boolean).join('. ');
  return <Pressable accessibilityRole="button" accessibilityLabel={spokenLabel}
    onPress={open} style={({ pressed }) => [ui.card, prominent && ui.featured, pressed && { opacity: 0.8 }]}>
    <TaskStatus task={task} />
    <Text style={ui.cardTitle}>{task.title}</Text>
    {!!task.competencyName && <Text style={ui.secondary}>{task.competencyName}</Text>}
    {!!due && <Text style={ui.secondary}>{t('student.taskDueDate')}: {due}</Text>}
    {prominent && task.submission?.mentorNote && <View style={ui.note}>
      <Text style={ui.label}>{t('studentFlow.mentorNote')}</Text>
      <Text style={ui.body}>{task.submission.mentorNote}</Text>
    </View>}
    {prominent ? <View style={ui.primary}><Text style={ui.primaryText}>{t('studentFlow.continueTask')}</Text>
      <Ionicons name="arrow-forward" size={20} color="#fff" /></View> :
      <Text style={ui.link}>{t('studentFlow.viewTask')} →</Text>}
  </Pressable>;
}

export const ui = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 20, width: '100%', maxWidth: 720, alignSelf: 'center', paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  section: { fontSize: 20, fontWeight: '700', color: colors.text },
  cardTitle: { fontSize: 20, fontWeight: '700', color: colors.text, lineHeight: 28 },
  body: { fontSize: 16, lineHeight: 24, color: colors.text },
  secondary: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  card: { padding: 20, gap: 12, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: colors.divider },
  featured: { borderColor: '#cadcf7' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, fontSize: 13, fontWeight: '600' },
  note: { backgroundColor: '#fff7e8', borderRadius: 12, padding: 16, gap: 8 },
  primary: { backgroundColor: colors.primaryDark, borderRadius: 12, minHeight: 52, padding: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  link: { color: colors.primaryDark, fontSize: 16, fontWeight: '600', paddingVertical: 12 },
  iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 9, height: 9, borderRadius: 5, right: 10, top: 9, backgroundColor: colors.error },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#9aa0a6', borderRadius: 12, padding: 14, fontSize: 16, color: colors.text, minHeight: 52 },
});
