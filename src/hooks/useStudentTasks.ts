import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { assignmentService } from '@/services/assignments';
import { groupService } from '@/services/group';
import { useAuthStore } from '@/store/authStore';
import type { MyAssignment } from '@/types/assignment';

export function useStudentTasks() {
  const userId = useAuthStore(s => s.user?.id);
  const [items, setItems] = useState<MyAssignment[]>([]);
  const [hasGroup, setHasGroup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setRefreshing(true);
    setFailed(false);
    try {
      const group = userId ? await groupService.getMyGroup(userId) : null;
      const tasks = group && userId ? await assignmentService.listMyAssignments(group.id, userId) : [];
      if (request !== generation.current) return;
      setHasGroup(!!group);
      setItems(tasks);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) { setLoading(false); setRefreshing(false); }
    }
  }, [userId]);
  useFocusEffect(useCallback(() => {
    void reload();
    return () => { generation.current++; };
  }, [reload]));
  return { items, hasGroup, loading, refreshing, failed, reload };
}
