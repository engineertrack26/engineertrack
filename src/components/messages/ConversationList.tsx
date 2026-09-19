import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fonts } from '@/theme';
import type { TFunction } from 'i18next';
import type { ConversationSummary } from '@/types/messages';
import { conversationSubtitle } from '@/utils/messageHelpers';

function roleLabel(role: string, t: TFunction): string {
  if (role === 'advisor') return t('messages.roleAdvisor', 'Advisor');
  if (role === 'mentor') return t('messages.roleMentor', 'Mentor');
  return t('messages.roleStudent', 'Student');
}

export function ConversationRow({ item, me, onPress, locale }: { item: ConversationSummary; me: string; onPress: () => void; locale: string }) {
  const { t } = useTranslation();
  const when = item.lastMessageAt ? new Date(item.lastMessageAt).toLocaleDateString(locale) : '';
  const isCase = item.kind === 'case';
  const nameLine = isCase ? `${t('messages.caseLabel', 'Case')} · ${item.title}` : item.title;
  const otherLabel = item.kind === 'staff' ? t('messages.roleStaff', 'Advisor · Mentor') : roleLabel(item.otherRole ?? '', t);
  const meta = isCase ? conversationSubtitle('case', item.participants, me, (r) => roleLabel(r, t)) : `${otherLabel} · ${item.groupName}`;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}>
        {isCase
          ? <Ionicons name="people" size={20} color={colors.primary} />
          : <Text style={styles.avatarText}>{(item.title || '').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.top}>
          <Text style={[styles.name, item.unreadCount > 0 && styles.nameUnread]} numberOfLines={1}>{nameLine}</Text>
          <Text style={styles.when}>{when}</Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
        {!!item.lastMessagePreview && <Text style={[styles.preview, item.unreadCount > 0 && styles.previewUnread]} numberOfLines={1}>{item.lastMessagePreview}</Text>}
      </View>
      {item.unreadCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text></View>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.inkBg, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '600', fontFamily: fonts.semibold, color: colors.ink },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.text },
  nameUnread: { fontWeight: '600', fontFamily: fonts.semibold, color: colors.ink },
  when: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  meta: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary },
  preview: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 2 },
  previewUnread: { color: colors.text, fontWeight: '500', fontFamily: fonts.medium },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: colors.textOnPrimary, fontSize: 12, fontWeight: '600', fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
  empty: { alignItems: 'center', marginTop: 60, gap: spacing.sm },
  emptyText: { fontSize: 14, fontFamily: fonts.regular, color: colors.textSecondary },
  note: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary, paddingVertical: spacing.sm, marginBottom: spacing.xs },
});
export const conversationListStyles = styles;
