import { FeedScreen } from '@/components/screens/FeedScreen';
import { useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@/store/authStore';

export default function AdvisorFeedScreen() {
  const { groupId, entry } = useLocalSearchParams<{ groupId?: string; entry?: string }>();
  const userId = useAuthStore((s) => s.user?.id);
  const requested = typeof groupId === 'string' ? groupId : undefined;
  return <FeedScreen key={(userId ?? '') + ':' + (requested ?? '') + ':' + (entry ?? '')} role="advisor" initialGroupId={requested} />;
}
