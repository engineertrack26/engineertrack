import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { closureService } from '@/services/closure';
import type { ClosureStatus } from '@/types/closure';

/** Loads `internship_closure_status` on focus for the student/group banners
 *  and disabled-action checks -- see the design's §6 "Student"/"Mentor" rows.
 *  `status` is null whenever either id is missing (no group yet, screen not
 *  ready) or the RPC fails; a failure never throws past this hook, it only
 *  leaves callers without a status to act on. */
export function useClosureStatus(studentId: string | null | undefined, groupId: string | null | undefined) {
  const [status, setStatus] = useState<ClosureStatus | null>(null);
  const generation = useRef(0);
  const reload = useCallback(() => {
    const request = ++generation.current;
    if (!studentId || !groupId) { setStatus(null); return; }
    void (async () => {
      try {
        const result = await closureService.status(studentId, groupId);
        if (request === generation.current) setStatus(result);
      } catch (error) {
        console.warn('Closure status load failed:', error instanceof Error ? error.message : error);
        if (request === generation.current) setStatus(null);
      }
    })();
  }, [studentId, groupId]);
  useFocusEffect(useCallback(() => {
    reload();
    return () => { generation.current++; };
  }, [reload]));
  return { status, reload };
}
