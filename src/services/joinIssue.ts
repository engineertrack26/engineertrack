import { supabase } from './supabase';
import { RpcError } from './rpcError';

export type JoinIssueReason =
  | 'INVALID_CODE'
  | 'EMAIL_DOMAIN_BLOCKED'
  | 'CODE_SEGMENT_MISMATCH';

export const joinIssueService = {
  /**
   * `routedToAdmin` is false when the attempted code names no institution —
   * a wholly invalid code cannot be routed to anyone. The caller shows a
   * different message in that case.
   */
  async report(params: {
    attemptedCode: string;
    reason: JoinIssueReason;
    note?: string;
  }): Promise<{ routedToAdmin: boolean }> {
    const { data, error } = await supabase.rpc('report_join_issue', {
      p_code: params.attemptedCode,
      p_reason: params.reason,
      p_note: params.note || null,
    });
    if (error) throw new RpcError(error.message);
    return { routedToAdmin: data === true };
  },
};
