export type ConversationKind = 'member' | 'mentor' | 'staff' | 'case';

export interface Participant {
  id: string;
  name: string;
  role: string;
}

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  groupId: string;
  groupName: string;
  /** The student a case is about; null for 1:1. */
  subjectId: string | null;
  /** Case: the student's name. 1:1: the other participant's name. */
  title: string;
  participants: Participant[];
  otherId: string | null;
  otherName: string | null;
  otherRole: string | null;
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
  hasCase?: boolean;
}
