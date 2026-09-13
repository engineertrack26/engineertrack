import type { PhotoEvidence, DocumentEvidence } from '@/types/assignment';

export type FeedPostKind = 'task' | 'announcement' | 'poll' | 'assignment';

export interface FeedTask {
  submissionId: string;
  title: string;
  competencyName?: string;
  level?: number;
  note?: string;
  /** Signed at read time by feedService; a stored public URL of a private
   *  bucket is a dead link. */
  photos: PhotoEvidence[];
  documents: DocumentEvidence[];
}

export interface FeedAssignment {
  id: string;
  title: string;
  competencyName?: string;
  level?: number;
  /** ISO date (YYYY-MM-DD) or undefined. */
  dueDate?: string;
}

export interface FeedPollOption {
  id: string;
  label: string;
  position: number;
  votes: number;
}

export interface FeedPoll {
  options: FeedPollOption[];
  totalVotes: number;
  myOptionId?: string;
}

export type FeedAttachmentKind = 'photo' | 'document' | 'link';

export interface FeedAttachment {
  id: string;
  kind: FeedAttachmentKind;
  /** photo/document: a SIGNED url once through feedService (the row holds
   *  a storage path); link: the URL as entered. */
  target: string;
  name?: string;
  mime?: string;
  size?: number;
}

export interface FeedPost {
  id: string;
  kind: FeedPostKind;
  groupId: string;
  authorId: string;
  authorName: string;
  body?: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  /** Unpublished (published_at IS NULL): visible only to the advisor via
   *  list_feed_pending; no likes/comments/votes exist for it yet. */
  draft: boolean;
  task?: FeedTask;
  poll?: FeedPoll;
  assignment?: FeedAssignment;
  /** Always an array; empty for every kind but an announcement with files. */
  attachments: FeedAttachment[];
}

export interface FeedComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}
