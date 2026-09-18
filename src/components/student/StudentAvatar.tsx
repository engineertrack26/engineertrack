import { Image, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { STUDENT_AVATAR_IMAGES } from '@/constants/studentAvatars';
import { avatarStage, type StudentAvatarId } from '@/utils/studentAvatar';
import { colors } from '@/theme';

/** Render only a server-provided level (or explicitly labelled preview level). */
export function StudentAvatar({ avatarId, level, size = 160, markers = true }: {
  avatarId: StudentAvatarId; level: number; size?: number; markers?: boolean;
}) {
  const { t } = useTranslation();
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.min(10, Math.floor(level))) : 1;
  return <View accessible accessibilityLabel={`${t('avatarUi.character', { id: avatarId })}, ${t('avatarUi.stage', { level: safeLevel })}`}
    style={{ width: size, maxWidth: '100%', gap: 6 }}>
    <View style={styles.frame}>
      <Image source={STUDENT_AVATAR_IMAGES[avatarId][avatarStage(safeLevel)]}
        style={styles.image} resizeMode="contain" />
    </View>
    {markers && <View style={styles.markers}>
      {Array.from({ length: 10 }, (_, index) => <View key={index} style={[styles.marker,
        { backgroundColor: index < safeLevel ? colors.primaryDark : colors.divider }]} />)}
      <Text style={styles.level}>{safeLevel}</Text>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  // Keep native image dimensions out of the flex layout. The frame alone
  // determines the square's size, including inside narrow picker columns.
  frame: { width: '100%', aspectRatio: 1, overflow: 'hidden', borderRadius: 16,
    borderWidth: 2, borderColor: colors.primaryDark },
  image: { position: 'absolute', width: '100%', height: '100%', top: 0, left: 0 },
  markers: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  marker: { flex: 1, height: 4, borderRadius: 2 },
  level: { color: colors.primaryDark, fontSize: 12, marginLeft: 3 },
});
