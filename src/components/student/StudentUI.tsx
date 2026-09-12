import { View, Text, Pressable } from 'react-native';
import { ui } from '@/components/common/workflowStyles';
export { ui } from '@/components/common/workflowStyles';
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
