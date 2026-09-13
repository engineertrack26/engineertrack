import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '@/theme';
import type { TFunction } from 'i18next';
import type { ConversationSummary } from '@/types/messages';

function roleLabel(role: string, t: TFunction): string {
  if (role === 'advisor') return t('messages.roleAdvisor', 'Advisor');
  if (role === 'mentor') return t('messages.roleMentor', 'Mentor');
  return t('messages.roleStudent', 'Student');
}

export function ConversationRow({ item, onPress, locale }: { item: ConversationSummary; onPress: () => void; locale: string }) {
  const { t } = useTranslation();
  const when = item.lastMessageAt ? new Date(item.lastMessageAt).toLocaleDateString(locale) : '';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{item.otherName.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}</Text></View>
      <View style={{ flex: 1 }}>
        <View style={styles.top}>
          <Text style={[styles.name, item.unreadCount > 0 && styles.nameUnread]} numberOfLines={1}>{item.otherName}</Text>
          <Text style={styles.when}>{when}</Text>
        </View>
        <Text style={styles.meta}>{roleLabel(item.otherRole, t)} · {item.groupName}</Text>
        {!!item.lastMessagePreview && <Text style={[styles.preview, item.unreadCount > 0 && styles.previewUnread]} numberOfLines={1}>{item.lastMessagePreview}</Text>}
      </View>
      {item.unreadCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text></View>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + '20', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, fontSize: 15, color: colors.text },
  nameUnread: { fontWeight: '700' },
  when: { fontSize: 11, color: colors.textSecondary },
  meta: { fontSize: 12, color: colors.textSecondary },
  preview: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  previewUnread: { color: colors.text, fontWeight: '500' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  empty: { alignItems: 'center', marginTop: 60, gap: spacing.sm },
  emptyText: { fontSize: 14, color: colors.textSecondary },
  note: { fontSize: 12, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.sm, marginBottom: spacing.sm },
});
export const conversationListStyles = styles;
