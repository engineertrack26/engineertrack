import { mapRpcError, type RpcErrorInfo } from '@/utils/rpcErrors';

/**
 * Wraps a Supabase RPC failure so screens can translate it instead of
 * showing a raw Postgres message.
 */
export class RpcError extends Error {
  info: RpcErrorInfo;

  constructor(message?: string) {
    super(message || 'UNKNOWN');
    this.name = 'RpcError';
    this.info = mapRpcError(message);
  }
}

export function throwRpcError(error: { message?: string } | null): never {
  throw new RpcError(error?.message);
}
