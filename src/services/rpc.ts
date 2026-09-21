import { supabase } from './supabase';
import { RpcError } from './rpcError';
import type { Database } from '@/types/database';

type Functions = Database['public']['Functions'];
export type RpcName = keyof Functions;
export type RpcArgs<N extends RpcName> = Functions[N]['Args'];

/**
 * A typed `supabase.rpc`: the function name and its argument names/types are
 * checked against `src/types/database.ts` (generated from the live schema
 * with `supabase gen types`), so a renamed parameter fails `tsc` rather than
 * PostgREST at run time. Refusals become `RpcError` carrying the stable code
 * for `mapRpcError`. The return is cast by the caller, whose domain type is
 * narrower than the generated `Json`.
 */
export async function rpc<T, N extends RpcName = RpcName>(name: N, args: RpcArgs<N>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new RpcError(error.message);
  return data as T;
}
