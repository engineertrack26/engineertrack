import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useNotificationStore } from '@/store/notificationStore';
import { useAdminStore } from '@/store/adminStore';

export default function AdminLayout() {
  const user = useAuthStore((s) => s.user);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const fetchUnreadCount = useNotificationStore((s) => s.fetchUnreadCount);
  const institution = useAdminStore((s) => s.institution);
  const fetchInstitution = useAdminStore((s) => s.fetchInstitution);

  const subscribeToNotifications = useNotificationStore((s) => s.subscribeToNotifications);
  const unsubscribe = useNotificationStore((s) => s.unsubscribe);

  useEffect(() => {
    if (user) {
      fetchUnreadCount(user.id);
      subscribeToNotifications(user.id);
    }
    return () => unsubscribe();
  }, [user, fetchUnreadCount, subscribeToNotifications, unsubscribe]);

  useEffect(() => {
    if (user) fetchInstitution(user.id);
  }, [user, fetchInstitution]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#e65100',
        tabBarInactiveTintColor: colors.textDisabled,
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="users"
        options={{
          title: 'Users',
          href: institution ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          href: institution ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          href: institution ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.error, fontSize: 11 },
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
