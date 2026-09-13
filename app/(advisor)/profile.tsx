import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { AccountProfile } from '@/components/common/AccountProfile';
import { AdvisorBell } from '@/components/advisor/GroupUI';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';

export default function AdvisorProfileScreen() {
  const { t } = useTranslation();
  const user = useAuthStore(s => s.user);
  if (!user || user.role !== 'advisor') return null;
  return <AccountProfile key={user.id} user={user} roleLabel={t('auth.advisor')}
    header={<View style={ui.header}>
      <Text style={[ui.title, { flex: 1, color: colors.primaryDark, fontSize: 22 }]}>EngineerTrack</Text>
      <AdvisorBell />
    </View>} />;
}
