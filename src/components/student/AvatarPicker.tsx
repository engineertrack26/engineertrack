import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { STUDENT_AVATAR_IDS, type StudentAvatarId } from '@/utils/studentAvatar';
import { StudentAvatar } from './StudentAvatar';
import { colors } from '@/theme';
import { ui } from '@/components/common/workflowStyles';

export function AvatarPicker({ value, onChange, level = 1, disabled = false }: {
  value: StudentAvatarId | null; onChange: (id: StudentAvatarId) => void; level?: number; disabled?: boolean;
}) {
  const { t } = useTranslation();
  return <View style={{ gap: 16 }}>
    <Text style={ui.secondary}>{t('avatarUi.hint')}</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel={t('avatarUi.choose')}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {STUDENT_AVATAR_IDS.map(id => <Pressable key={id} accessibilityRole="radio"
        accessibilityLabel={t('avatarUi.character', { id })}
        accessibilityState={{ checked: value === id, disabled }} disabled={disabled} onPress={() => onChange(id)}
        style={{ flexGrow: 1, flexBasis: '28%', minWidth: 76, maxWidth: '48%', padding: 6, gap: 6,
          borderRadius: 18, borderWidth: 2, borderColor: value === id ? colors.primaryDark : colors.divider }}>
        <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <StudentAvatar avatarId={id} level={level} size={140} markers={false} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
          <Ionicons name={value === id ? 'radio-button-on' : 'radio-button-off'} size={20} color={colors.primaryDark} />
          <Text style={ui.label}>{id}</Text>
        </View>
      </Pressable>)}
    </View>
    {value && <>
      <Text style={ui.label}>{t('avatarUi.preview')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {[1, 5, 10].map(stage => <View key={stage} style={{ flex: 1, minWidth: 76, gap: 6 }}>
          <StudentAvatar avatarId={value} level={stage} size={150} markers={false} />
          <Text style={ui.secondary}>{t('avatarUi.stage', { level: stage })}</Text>
        </View>)}
      </View>
    </>}
    <Text style={ui.secondary}>{t('avatarUi.rules')}</Text>
  </View>;
}
