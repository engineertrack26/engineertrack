import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';
export function InternshipDaysLink({ role }: { role: 'student' | 'mentor' | 'advisor' }) {
  const { t } = useTranslation();
  return <Pressable style={[ui.card,ui.header]} accessibilityRole="button" onPress={()=>router.push(
    role==='student'?'/(student)/internship-days':role==='mentor'?'/(mentor)/internship-days':'/(advisor)/internship-days')}>
    <Ionicons name="calendar-outline" size={28} color={colors.primaryDark} />
    <View style={{flex:1,gap:6}}><Text style={ui.label}>{t(role==='student'?'days.title':'days.staffTitle')}</Text>
      <Text style={ui.secondary}>{t('days.linkHint')}</Text></View>
    <Ionicons name="chevron-forward" size={22} color={colors.primaryDark} />
  </Pressable>;
}
