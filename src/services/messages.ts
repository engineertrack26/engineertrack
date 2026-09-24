import { rpc } from './rpc';
import type { BroadcastFailure, BroadcastResult } from '@/utils/broadcast';
import type { ConversationSummary, Message, MessageContact, Participant } from '@/types/messages';

export const MESSAGES_PAGE_SIZE = 50;

function toSummary(r: Record<string, unknown>): ConversationSummary {
  return {
    id: r.id as string,
    kind: r.kind as ConversationSummary['kind'],
    groupId: r.groupId as string,
    groupName: (r.groupName as string) || '',
    subjectId: (r.subjectId as string) || null,
    title: (r.title as string) || (r.otherName as string) || '',
    participants: Array.isArray(r.participants) ? (r.participants as Participant[]) : [],
    otherId: (r.otherId as string) || null,
    otherName: (r.otherName as string) || null,
    otherRole: (r.otherRole as string) || null,
    lastMessageAt: (r.lastMessageAt as string) || undefined,
    lastMessagePreview: (r.lastMessagePreview as string) || undefined,
    unreadCount: Number(r.unreadCount) || 0,
    blockedByMe: !!r.blockedByMe,
    blockedMe: !!r.blockedMe,
  };
}

function toMessage(r: Record<string, unknown>): Message {
  return { id: r.id as string, senderId: r.senderId as string, body: (r.body as string) || '', createdAt: r.createdAt as string };
}

export const messageService = {
  listConversations: async (groupId?: string) =>
    ((await rpc<Record<string, unknown>[]>('list_conversations', { p_group_id: groupId ?? undefined })) || []).map(toSummary),
  /** Newest first from the server; returned oldest first for rendering. */
  listMessages: async (conversationId: string, before?: string) =>
    ((await rpc<Record<string, unknown>[]>('list_messages', { p_conversation_id: conversationId, p_before: before ?? undefined, p_limit: MESSAGES_PAGE_SIZE })) || []).map(toMessage).reverse(),
  listContacts: async (groupId: string): Promise<MessageContact[]> =>
    ((await rpc<Record<string, unknown>[]>('list_message_contacts', { p_group_id: groupId })) || []).map((r) => ({ id: r.id as string, name: (r.name as string) || '', role: (r.role as string) || '' })),
  /** A mentor's students, each with the group a conversation would be opened
   *  in -- a mentor's students may sit in different groups. Backed by a
   *  SECURITY DEFINER RPC because a mentor cannot read group_memberships
   *  directly (see docs/direct-messages-rpcs.sql). */
  listMentorContacts: async (): Promise<(MessageContact & { groupId: string; groupName: string })[]> =>
    ((await rpc<Record<string, unknown>[]>('list_mentor_message_contacts', {})) || []).map((r) => ({ id: r.id as string, name: (r.name as string) || '', role: (r.role as string) || 'student', groupId: r.groupId as string, groupName: (r.groupName as string) || '' })),
  openConversation: (groupId: string, otherId: string) => rpc<string>('open_conversation', { p_group_id: groupId, p_other_id: otherId }),
  openCase: (groupId: string, studentId: string) => rpc<string>('open_case', { p_group_id: groupId, p_student_id: studentId }),
  listCaseCandidates: async (groupId: string): Promise<MessageContact[]> =>
    ((await rpc<Record<string, unknown>[]>('list_case_candidates', { p_group_id: groupId })) || []).map((r) => ({ id: r.id as string, name: (r.name as string) || '', role: (r.role as string) || '', hasCase: !!r.hasCase })),
  sendMessage: (conversationId: string, body: string) => rpc<string>('send_message', { p_conversation_id: conversationId, p_body: body }),
  /** One message to several students at once, each in their own private
   *  conversation -- advisor and mentor only, enforced server-side. The
   *  result counts what went out and names what did not. */
  broadcast: async (recipients: string[], body: string): Promise<BroadcastResult> => {
    const data = await rpc<{ sent?: number; failed?: BroadcastFailure[] }>('broadcast_message',
      { p_recipients: recipients, p_body: body });
    return { sent: Number(data?.sent) || 0, failed: data?.failed ?? [] };
  },
  markRead: (conversationId: string) => rpc<void>('mark_conversation_read', { p_conversation_id: conversationId }),
  setBlocked: (conversationId: string, block: boolean) => rpc<void>('block_conversation', { p_conversation_id: conversationId, p_block: block }),
  unreadCount: async () => Number(await rpc<number>('unread_message_count', {})) || 0,
  countDeletable: (groupId: string, studentId?: string) => rpc<number>('count_deletable_conversations', { p_group_id: groupId, p_student_id: studentId ?? undefined }),
};
