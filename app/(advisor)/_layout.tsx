import { useEffect } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useNotificationStore } from '@/store/notificationStore';
import { useMessageStore } from '@/store/messageStore';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

export default function AdvisorLayout() {
  const router = useRouter();
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

  const unreadMessages = useMessageStore((s) => s.unreadCount);
  const refreshUnread = useMessageStore((s) => s.refreshUnread);
  useEffect(() => { if (user) refreshUnread(); }, [user, refreshUnread]);
  useRealtimeSubscription({ table: 'messages', event: 'INSERT', enabled: !!user, onPayload: () => refreshUnread() });

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: colors.textSecondary,
        headerShown: false,
      }}
    >
      <Tabs.Screen name="internship-days" options={{ href: null }} />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('advisorGroups.overview'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: t('advisorGroups.groups'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="student-monitor" options={{ href: null }} />
      <Tabs.Screen name="group-competencies" options={{ href: null }} />
      <Tabs.Screen name="group-assignments" options={{ href: null }} />
      <Tabs.Screen name="reports" options={{ href: null }} />
      <Tabs.Screen
        name="feed"
        listeners={({ navigation }) => ({ tabPress: (event) => {
          const state = navigation.getState();
          const active = state.routes[state.index];
          if (active?.name === 'feed') return;
          const params = active?.params as { groupId?: string; activeGroupId?: string } | undefined;
          const groupId = params?.activeGroupId ?? params?.groupId;
          if (groupId) {
            event.preventDefault();
            router.navigate({ pathname: '/(advisor)/feed', params: { groupId, entry: String(Date.now()) } });
          }
        } })}
        options={{
          title: t('tabs.feed'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="newspaper-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('tabs.messages', 'Messages'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles-outline" size={size} color={color} />
          ),
          tabBarBadge: unreadMessages > 0 ? (unreadMessages > 99 ? '99+' : unreadMessages) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primaryDark },
        }}
      />
      <Tabs.Screen
        name="conversation"
        options={{ href: null, tabBarStyle: { display: 'none' } }}
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
    </Tabs>
  );
}
