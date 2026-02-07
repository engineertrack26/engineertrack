import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme';

export default function Index() {
  const { isAuthenticated, isLoading, user } = useAuthStore();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

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

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
