import type { ConversationKind, Message, Participant } from '@/types/messages';

/** One-line preview for the conversation list. Counts code points, not
 *  UTF-16 units, so an emoji is never split. */
export function previewText(body: string, max: number): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return chars.slice(0, Math.max(0, max - 1)).join('') + '…';
}

export interface DayGroup { key: string; label: string; messages: Message[] }

/** Messages (any order in) → groups by LOCAL calendar day, oldest first,
 *  each labelled with the locale's date. */
export function dayGroups(messages: Message[], locale: string): DayGroup[] {
  const sorted = [...messages].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const out: DayGroup[] = [];
  for (const msg of sorted) {
    const d = new Date(msg.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.messages.push(msg);
    else out.push({ key, label: d.toLocaleDateString(locale), messages: [msg] });
  }
  return out;
}

/** A message bubble's sender name, falling back to `fallback` for a
 *  participant who has since left the conversation (their row is gone but
 *  their old messages remain). */
export function senderName(participants: Participant[], senderId: string, fallback: string): string {
  return participants.find((p) => p.id === senderId)?.name || fallback;
}

/** Case: the other participants' names. 1:1: the other's role label. */
export function conversationSubtitle(kind: ConversationKind, participants: Participant[], me: string, roleLabel: (role: string) => string): string {
  const others = participants.filter((p) => p.id !== me);
  if (kind === 'case') return others.map((p) => p.name).join(', ');
  return others[0] ? roleLabel(others[0].role) : '';
}
