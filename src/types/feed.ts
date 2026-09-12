import type { PhotoEvidence, DocumentEvidence } from '@/types/assignment';

export type FeedPostKind = 'task' | 'announcement' | 'poll';

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
  task?: FeedTask;
  poll?: FeedPoll;
}

export interface FeedComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}
