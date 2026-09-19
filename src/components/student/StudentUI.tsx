import { View, Text, Pressable } from 'react-native';
import { ui } from '@/components/common/workflowStyles';
import { Stamp } from '@/components/common/Stamp';
export { ui } from '@/components/common/workflowStyles';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/store/notificationStore';
import { colors, fonts } from '@/theme';
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

/** The logbook's stamp for anything a mentor has touched; a quiet badge
 *  for a task nobody has acted on yet. */
export function TaskStatus({ task }: { task: MyAssignment }) {
  const { t, i18n } = useTranslation();
  const state = taskState(task);
  if (state === 'done') {
    const reviewed = task.submission?.reviewedAt;
    return <Stamp kind="approved" date={reviewed ? new Date(reviewed).toLocaleDateString(i18n.language) : undefined} />;
  }
  if (state === 'revise') return <Stamp kind="revision" />;
  if (state === 'waiting') return <Stamp kind="pending" />;
  return <Text style={[ui.badge, { color: colors.inkSoft, backgroundColor: colors.inkBg }]}>{t(taskStateKey(state))}</Text>;
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

/** One line of the task ledger: title, the facts, the stamp. The whole row
 *  opens the task -- no "view" link to find. */
export function TaskRow({ task }: { task: MyAssignment }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const due = taskDueDate(task.dueDate, i18n.language);
  const open = () => router.push({ pathname: '/(student)/task-detail', params: { id: task.id } });
  const facts = [
    task.competencyName && `${competencyContent(task.competencyName, i18n.language)}${task.level ? ' · L' + task.level : ''}`,
    due && `${t('student.taskDueDate')} ${due}`,
  ].filter(Boolean).join(' · ');
  const spokenLabel = [taskContent(task.title, i18n.language), t(taskStateKey(taskState(task))), facts,
    t('studentFlow.viewTask')].filter(Boolean).join('. ');
  return <Pressable accessibilityRole="button" accessibilityLabel={spokenLabel} onPress={open}
    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.divider }}>
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={{ fontSize: 15, lineHeight: 21, fontFamily: fonts.medium, color: colors.text }}>{taskContent(task.title, i18n.language)}</Text>
      {!!facts && <Text style={{ fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.textSecondary, fontVariant: ['tabular-nums'] }}>{facts}</Text>}
    </View>
    <TaskStatus task={task} />
    <Ionicons name="chevron-forward" size={18} color={colors.ink} />
  </Pressable>;
}
