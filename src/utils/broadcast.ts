/** One message to several students, each in their own private conversation.
 *  The server (`broadcast_message`) is the authority; these mirror its guards
 *  so the send button can refuse without a round trip, and turn its per
 *  recipient result into one sentence for the sender. */

export const BROADCAST_MAX_RECIPIENTS = 30;
export const BROADCAST_MAX_BODY = 2000;

export interface BroadcastFailure { id: string; code: string }
export interface BroadcastResult { sent: number; failed: BroadcastFailure[] }

/** The locale key of the first thing wrong with this send, or null. */
export function broadcastFormError(recipients: string[], body: string): string | null {
  if (recipients.length === 0) return 'errors.recipientsEmpty';
  if (recipients.length > BROADCAST_MAX_RECIPIENTS) return 'errors.tooManyRecipients';
  const trimmed = body.trim();
  if (!trimmed) return 'errors.messageEmpty';
  if (trimmed.length > BROADCAST_MAX_BODY) return 'errors.messageTooLong';
  return null;
}

/** What the sender is told afterwards. A partial send is reported as one:
 *  saying only "3 sent" would hide the student who did not get it. */
export function broadcastSummary(result: BroadcastResult): { key: string; params: Record<string, number> } {
  const failed = result.failed?.length ?? 0;
  const sent = result.sent ?? 0;
  if (failed === 0) return { key: 'messages.broadcastSent', params: { count: sent } };
  if (sent === 0) return { key: 'messages.broadcastNoneSent', params: { count: failed } };
  return { key: 'messages.broadcastPartial', params: { count: sent, failed } };
}

/** Toggle one recipient in the selection, keeping the order they were picked. */
export function toggleRecipient(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}
