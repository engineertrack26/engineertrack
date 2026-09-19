import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { getStudentAvatar, type StudentAvatarState } from '@/services/studentAvatar';
import { colors } from '@/theme';
import { StudentAvatar } from './StudentAvatar';

/** Refresh on return from the profile, including character and level changes. */
export function StudentHeaderAvatar() {
  const userId = useAuthStore(s => s.user?.id);
  const [result, setResult] = useState<{ userId: string; avatar: StudentAvatarState } | null>(null);
  const [loading, setLoading] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    if (!userId) return;
    setLoading(true);
    void getStudentAvatar().then(avatar => {
      if (active && useAuthStore.getState().user?.id === userId) setResult({ userId, avatar });
    }).catch(() => {
      if (active) setResult(null);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [userId]));

  const avatar = result?.userId === userId ? result?.avatar : null;
  return <View style={{ width: 56, height: 56, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
    {avatar?.avatarId ? <StudentAvatar avatarId={avatar.avatarId} level={avatar.level} size={56} markers={false} />
      : <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {loading ? <ActivityIndicator color={colors.primaryDark} /> : <Ionicons name="person-circle-outline" size={48} color={colors.textSecondary} />}
      </View>}
  </View>;
}
