import { View, Text, Pressable } from 'react-native';
import { ui } from '@/components/common/workflowStyles';
import { Stamp } from '@/components/common/Stamp';
export { ui } from '@/components/common/workflowStyles';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/store/notificationStore';
import { colors } from '@/theme';
import { taskState, taskStateKey, taskDueDate } from '@/utils/studentTasks';
import type { MyAssignment } from '@/types/assignment';
import { taskContent } from '@/utils/taskContent';
import { competencyContent } from '@/utils/competencyContent';

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

/** The dashboard's "next task" card only -- TaskCard (below) keeps its plain
 *  look everywhere else (my-tasks, upcoming). Laid out like a logbook's job
 *  card: a header line naming what it is (with the revision stamp when the
 *  task came back), the title, a two-column fact table with aligned labels,
 *  a rule, then the one action. The mentor's note is shown only when the
 *  task was sent back -- that is the one time it changes what the student
 *  does next. */
export function JobCard({ task }: { task: MyAssignment }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const due = taskDueDate(task.dueDate, i18n.language);
  const open = () => router.push({ pathname: '/(student)/task-detail', params: { id: task.id } });
  const sentBack = task.submission?.status === 'needs_revision';
  const competency = task.competencyName ? `${competencyContent(task.competencyName, i18n.language)}${task.level ? ' · L' + task.level : ''}` : undefined;
  const facts = [
    competency && { label: t('dash.competency', 'Competency'), value: competency },
    due && { label: t('student.taskDueDate'), value: due },
  ].filter((f): f is { label: string; value: string } => !!f);
  const spokenLabel = [t('studentFlow.nextTask'), sentBack && t('stamp.revision', 'Revision'), taskContent(task.title, i18n.language),
    ...facts.map((f) => `${f.label}: ${f.value}`), sentBack && task.submission?.mentorNote,
    t('studentFlow.continueTask')].filter(Boolean).join('. ');
  return <Pressable accessibilityRole="button" accessibilityLabel={spokenLabel}
    onPress={open} style={[ui.card, ui.featured]}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 24 }}>
      <Text style={ui.section}>{t('studentFlow.nextTask')}</Text>
      {sentBack && <Stamp kind="revision" />}
    </View>
    <Text style={ui.cardTitle}>{taskContent(task.title, i18n.language)}</Text>
    {facts.length > 0 && <View style={{ gap: 6 }}>
      {facts.map((f) => <View key={f.label} style={{ flexDirection: 'row', gap: 12 }}>
        <Text style={[ui.secondary, { width: 96 }]}>{f.label}</Text>
        <Text style={[ui.body, { flex: 1, fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] }]}>{f.value}</Text>
      </View>)}
    </View>}
    {sentBack && !!task.submission?.mentorNote && <View style={ui.note}>
      <Text style={ui.label}>{t('studentFlow.mentorNote')}</Text>
      <Text style={ui.body}>{task.submission.mentorNote}</Text>
    </View>}
    <View style={{ borderTopWidth: 1, borderColor: colors.rule }} />
    <View style={ui.primary}>
      <Text style={ui.primaryText}>{t('studentFlow.continueTask')}</Text>
      <Ionicons name="arrow-forward" size={20} color="#fff" />
    </View>
  </Pressable>;
}

export function TaskCard({ task, prominent = false }: { task: MyAssignment; prominent?: boolean }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const due = taskDueDate(task.dueDate, i18n.language);
  const open = () => router.push({ pathname: '/(student)/task-detail', params: { id: task.id } });
  const spokenLabel = [taskContent(task.title, i18n.language), t(taskStateKey(taskState(task))), competencyContent(task.competencyName, i18n.language),
    due && `${t('student.taskDueDate')}: ${due}`, prominent && task.submission?.mentorNote,
    t(prominent ? 'studentFlow.continueTask' : 'studentFlow.viewTask')].filter(Boolean).join('. ');
  return <Pressable accessibilityRole="button" accessibilityLabel={spokenLabel}
    onPress={open} style={[ui.card, prominent && ui.featured]}>
    <TaskStatus task={task} />
    <Text style={ui.cardTitle}>{taskContent(task.title, i18n.language)}</Text>
    {!!task.competencyName && <Text style={ui.secondary}>{competencyContent(task.competencyName, i18n.language)}</Text>}
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
