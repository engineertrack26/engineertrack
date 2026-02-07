import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store/authStore';

export default function Index() {
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  switch (user?.role) {
    case 'student':
      return <Redirect href="/(student)/dashboard" />;
    case 'mentor':
      return <Redirect href="/(mentor)/dashboard" />;
    case 'advisor':
      return <Redirect href="/(advisor)/dashboard" />;
    default:
      return <Redirect href="/(auth)/login" />;
  }
}
