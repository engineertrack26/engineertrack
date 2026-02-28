import { useEffect, useRef } from 'react';
import { supabase } from '@/services/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

type PostgresEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

interface UseRealtimeOptions {
  table: string;
  filter?: string;
  event?: PostgresEvent;
  schema?: string;
  enabled?: boolean;
  onPayload: (payload: Record<string, unknown>) => void;
}

export function useRealtimeSubscription({
  table,
  filter,
  event = '*',
  schema = 'public',
  enabled = true,
  onPayload,
}: UseRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const channelName = `realtime-${table}-${filter || 'all'}-${Date.now()}`;

    const channelConfig: Record<string, unknown> = {
      event,
      schema,
      table,
    };
    if (filter) {
      channelConfig.filter = filter;
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes' as never,
        channelConfig as never,
        (payload: Record<string, unknown>) => {
          onPayload(payload);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [table, filter, event, schema, enabled]);
}
