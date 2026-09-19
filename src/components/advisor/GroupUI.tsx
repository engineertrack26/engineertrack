import type { PropsWithChildren, ReactNode } from 'react';
import { View, Text, TouchableOpacity, Modal, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/store/notificationStore';
import { useGroupStore } from '@/store/groupStore';
import { useAuthStore } from '@/store/authStore';
import { colors, fonts } from '@/theme';
import { ui } from '@/components/common/workflowStyles';

export function AdvisorBell() {
  const { t } = useTranslation();
  const unread = useNotificationStore((s) => s.unreadCount);
  return <TouchableOpacity style={ui.iconButton} accessibilityRole="button"
    accessibilityLabel={t('common.notifications') + (unread ? ', ' + t('notificationUi.unreadCount', { count: unread }) : '')}
    onPress={() => router.push('/(advisor)/notifications')}>
    <Ionicons name="notifications-outline" size={26} color={colors.primaryDark} />
    {unread > 0 && <View style={ui.dot} />}
  </TouchableOpacity>;
}

/** Show only a group name resolved from the advisor's loaded records, never a URL label. */
export function GroupContextLabel({ groupId }: { groupId?: string }) {
  const advisorId = useAuthStore((s) => s.user?.id);
  const group = useGroupStore((s) => s.groups.find((g) => g.id === groupId && g.advisorId === advisorId));
  if (!group) return null;
  return <Text style={ui.secondary}>{group.name}{group.term ? ' · ' + group.term : ''}</Text>;
}

export function GroupRow({ title, detail, icon, onPress }: {
  title: string; detail?: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void;
}) {
  return <TouchableOpacity accessibilityRole="button" onPress={onPress} style={[ui.card, groupStyles.row]}>
    <Ionicons name={icon} size={24} color={colors.primaryDark} />
    <View style={groupStyles.grow}><Text style={ui.label}>{title}</Text>{!!detail && <Text style={ui.secondary}>{detail}</Text>}</View>
    <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
  </TouchableOpacity>;
}

export function GroupModal({ title, onClose, busy = false, children, footer }: PropsWithChildren<{
  title: string; onClose: () => void; busy?: boolean; footer?: ReactNode;
}>) {
  const { t } = useTranslation();
  return <Modal visible animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <SafeAreaView style={ui.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
          <View style={groupStyles.row}>
            <Text style={[ui.section, groupStyles.grow]} accessibilityRole="header">{title}</Text>
            <TouchableOpacity style={ui.iconButton} onPress={onClose} disabled={busy}
              accessibilityRole="button" accessibilityLabel={t('advisorGroups.close')} accessibilityState={{ disabled: busy }}>
              <Ionicons name="close" size={26} color={colors.text} />
            </TouchableOpacity>
          </View>
          {children}
        </ScrollView>
        {!!footer && <View style={{ padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: colors.divider,
          width: '100%', maxWidth: 720, alignSelf: 'center' }}>{footer}</View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

export const groupStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, gap: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  outline: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.ink, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontSize: 16, fontWeight: '600', fontFamily: fonts.semibold, color: colors.ink, flexShrink: 1 },
  pill: { minHeight: 48, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 6, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.paper, justifyContent: 'center' },
  selected: { backgroundColor: colors.inkBg, borderColor: colors.ink },
});
