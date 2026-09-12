import { useAuthStore } from '@/store/authStore';
import { AccountProfile } from '@/components/common/AccountProfile';
import { ReviewHeader } from './ReviewUI';

export function MentorProfile() {
  const user = useAuthStore(s => s.user);
  return user ? <AccountProfile key={user.id} user={user} roleLabel="Mentor" header={<ReviewHeader brand />} /> : null;
}
