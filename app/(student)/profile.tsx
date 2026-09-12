import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';
import { AccountProfile } from '@/components/common/AccountProfile';
import { StudentHeader } from '@/components/student/StudentUI';
import { StudentProfileSections } from '@/components/student/StudentProfileSections';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const user = useAuthStore(s => s.user);
  return user ? <AccountProfile key={user.id} user={user} roleLabel={t('studentProfileView.student')}
    header={<StudentHeader title="EngineerTrack" />}>
    <StudentProfileSections key={user.id} userId={user.id} />
  </AccountProfile> : null;
}
