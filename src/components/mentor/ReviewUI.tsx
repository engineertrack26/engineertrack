import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { ui } from '@/components/common/workflowStyles';
import { Stamp } from '@/components/common/Stamp';
import { useNotificationStore } from '@/store/notificationStore';
import { reviewInitials, reviewSubmittedAt } from '@/utils/mentorReviews';
import { colors, fonts } from '@/theme';

export function ReviewBack({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={[ui.header, { minHeight: 48, alignSelf: 'flex-start', opacity: disabled ? 0.5 : 1 }]}>
    <Ionicons name="arrow-back" size={22} color={colors.primaryDark} />
    <Text style={[ui.link, { flexShrink: 1 }]}>{label}</Text>
  </Pressable>;
}

export function ReviewHeader({ brand = false, title }: { brand?: boolean; title?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const count = useNotificationStore(s => s.unreadCount);
  return <View style={ui.header}>
    <Text accessibilityRole="header" style={[ui.title, { flex: 1 }, brand && { color: colors.primaryDark, fontSize: 22 }]}>{title ?? (brand ? 'EngineerTrack' : t('mentorFlow.title'))}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('studentFlow.notifications', { count })}
      onPress={() => router.push('/(mentor)/notifications')} style={ui.iconButton}>
      <Ionicons name="notifications-outline" size={25} color={colors.text} />
      {count > 0 && (brand ? <View accessible={false} style={{ position: 'absolute', right: 0, top: 0, minWidth: 20, paddingHorizontal: 4, borderRadius: 12, backgroundColor: colors.error, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600', fontFamily: fonts.semibold }}>{count > 99 ? '99+' : count}</Text>
      </View> : <View style={ui.dot} />)}
    </Pressable>
  </View>;
}

export function ReviewIdentity({ name, submittedAt }: { name: string; submittedAt: string }) {
  const { t, i18n } = useTranslation();
  return <View style={ui.header}>
    <View accessible={false} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.inkBg, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ fontSize: 16, color: colors.primaryDark, fontWeight: '600', fontFamily: fonts.semibold }}>{reviewInitials(name)}</Text>
    </View>
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={ui.label}>{name || t('mentorFlow.unknownStudent')}</Text>
      <Text style={ui.secondary}>{reviewSubmittedAt(submittedAt, i18n.language)}</Text>
    </View>
  </View>;
}

export function ReviewStatus() {
  return <Stamp kind="pending" />;
}
