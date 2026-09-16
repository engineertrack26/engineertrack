import { supabase } from './supabase';
import { RpcError } from './rpcError';
import type { ClosureStatus } from '@/types/closure';

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new RpcError(error.message);
  return data as T;
}

/** Wraps the four client-facing closure RPCs (docs/internship-closure-migration.sql).
 *  Their JSONB results are already camelCase, matching ClosureStatus and the
 *  close() result field-for-field -- no remapping needed. */
export const closureService = {
  status: (studentId: string, groupId: string) =>
    rpc<ClosureStatus>('internship_closure_status', { p_student_id: studentId, p_group_id: groupId }),
  close: (studentId: string, groupId: string) =>
    rpc<{ closureId: string; reportVersion: number }>('close_internship', { p_student_id: studentId, p_group_id: groupId }),
  reopen: (studentId: string, groupId: string, reason: string) =>
    rpc<void>('reopen_internship', { p_student_id: studentId, p_group_id: groupId, p_reason: reason }),
  report: (studentId: string, groupId: string) =>
    rpc<string>('get_internship_report', { p_student_id: studentId, p_group_id: groupId }),
};
