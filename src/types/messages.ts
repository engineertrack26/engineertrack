export type ConversationKind = 'member' | 'mentor';

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  groupId: string;
  groupName: string;
  otherId: string;
  otherName: string;
  otherRole: 'student' | 'mentor' | 'advisor' | string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  unreadCount: number;
  blockedByMe: boolean;
  /** The other side has blocked me: I can read, I cannot send. */
  blockedMe: boolean;
}

export interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface MessageContact {
  id: string;
  name: string;
  role: string;
}
