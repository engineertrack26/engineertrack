import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useNotificationStore } from '@/store/notificationStore';

export default function StudentLayout() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const fetchUnreadCount = useNotificationStore((s) => s.fetchUnreadCount);

  const subscribeToNotifications = useNotificationStore((s) => s.subscribeToNotifications);
  const unsubscribe = useNotificationStore((s) => s.unsubscribe);

  useEffect(() => {
    if (user) {
      fetchUnreadCount(user.id);
      subscribeToNotifications(user.id);
    }
    return () => unsubscribe();
  }, [user, fetchUnreadCount, subscribeToNotifications, unsubscribe]);

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('studentFlow.home'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-tasks"
        options={{
          title: t('tabs.tasks'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkbox-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="log-history"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="achievements"
        options={{
          title: t('studentFlow.growth'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          href: null,
          title: t('tabs.ranking'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="podium-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="polls"
        options={{
          href: null,
          title: t('tabs.polls'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          href: null,
          title: t('tabs.alerts'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="task-detail"
        options={{ href: null, tabBarStyle: { display: 'none' } }}
      />
      <Tabs.Screen
        name="internship-form"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
