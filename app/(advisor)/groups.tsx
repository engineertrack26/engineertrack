import { useCallback } from 'react';
import { BackHandler, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect, router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { ui } from '@/components/common/workflowStyles';
import { GroupList } from '@/components/advisor/GroupList';
import { GroupCenter } from '@/components/advisor/GroupCenter';

export default function AdvisorGroupsScreen() {
  const userId = useAuthStore((s) => s.user?.id);
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  useFocusEffect(useCallback(() => {
    if (!groupId) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      router.setParams({ groupId: '' });
      return true;
    });
    return () => listener.remove();
  }, [groupId]));
  if (!userId) return null;
  return <SafeAreaView style={ui.safe} key={userId}>
    {/* Keep the list mounted so search, archive filter and scroll survive a group visit. */}
    <View style={{ flex: 1, display: groupId ? 'none' : 'flex' }}>
      <GroupList advisorId={userId} active={!groupId} />
    </View>
    {!!groupId && <GroupCenter key={groupId} advisorId={userId} groupId={groupId} />}
  </SafeAreaView>;
}
