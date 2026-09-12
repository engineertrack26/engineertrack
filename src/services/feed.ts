import { supabase } from './supabase';
import { signEvidence } from './evidenceUrls';
import { RpcError } from './rpcError';
import type { FeedPost, FeedComment, FeedPostKind } from '@/types/feed';
import type { PhotoEvidence, DocumentEvidence } from '@/types/assignment';

export const FEED_PAGE_SIZE = 20;

function toPost(raw: Record<string, unknown>): FeedPost {
  const task = raw.task as Record<string, unknown> | null;
  const poll = raw.poll as Record<string, unknown> | null;
  return {
    id: raw.id as string,
    kind: raw.kind as FeedPostKind,
    groupId: raw.groupId as string,
    authorId: raw.authorId as string,
    authorName: (raw.authorName as string) || '',
    body: (raw.body as string) || undefined,
    createdAt: raw.createdAt as string,
    likeCount: Number(raw.likeCount) || 0,
    commentCount: Number(raw.commentCount) || 0,
    likedByMe: !!raw.likedByMe,
    task: task
      ? {
          submissionId: task.submissionId as string,
          title: (task.title as string) || '',
          competencyName: (task.competencyName as string) || undefined,
          level: typeof task.level === 'number' ? task.level : undefined,
          note: (task.note as string) || undefined,
          // Filled by listPosts after signing; the raw rows hold stored URLs
          // of a private bucket, which are dead links until exchanged.
          photos: [],
          documents: [],
        }
      : undefined,
    poll: poll
      ? {
          options: ((poll.options as Array<Record<string, unknown>>) || []).map((o) => ({
            id: o.id as string,
            label: (o.label as string) || '',
            position: Number(o.position) || 0,
            votes: Number(o.votes) || 0,
          })),
          totalVotes: Number(poll.totalVotes) || 0,
          myOptionId: (poll.myOptionId as string) || undefined,
        }
      : undefined,
  };
}

export const feedService = {
  /** One page, newest first. `before` is the oldest createdAt already on
   *  screen. Evidence URIs come back signed. */
  async listPosts(groupId: string, before?: string): Promise<FeedPost[]> {
    const { data, error } = await supabase.rpc('list_feed_posts', {
      p_group_id: groupId,
      p_before: before ?? null,
      p_limit: FEED_PAGE_SIZE,
    });
    if (error) throw new RpcError(error.message);
    const rows = (data || []) as Array<Record<string, unknown>>;
    return Promise.all(rows.map(async (raw) => {
      const post = toPost(raw);
      const task = raw.task as Record<string, unknown> | null;
      if (post.task && task) {
        const signed = await signEvidence(
          (task.photos as PhotoEvidence[] | undefined) || [],
          (task.documents as DocumentEvidence[] | undefined) || [],
        );
        post.task.photos = signed.photos;
        post.task.documents = signed.documents;
      }
      return post;
    }));
  },

  async createPost(groupId: string, kind: 'announcement' | 'poll', body: string, options?: string[]): Promise<string> {
    const { data, error } = await supabase.rpc('create_feed_post', {
      p_group_id: groupId,
      p_kind: kind,
      p_body: body,
      p_options: options ?? null,
    });
    if (error) throw new RpcError(error.message);
    return data as string;
  },

  async vote(postId: string, optionId: string): Promise<void> {
    const { error } = await supabase.rpc('vote_feed_poll', { p_post_id: postId, p_option_id: optionId });
    if (error) throw new RpcError(error.message);
  },

  /** Direct table writes under RLS; user_id is the caller by policy. */
  async setLiked(postId: string, userId: string, liked: boolean): Promise<void> {
    if (liked) {
      const { error } = await supabase.from('feed_likes').upsert({ post_id: postId, user_id: userId });
      if (error) throw error;
    } else {
      const { error } = await supabase.from('feed_likes').delete().eq('post_id', postId).eq('user_id', userId);
      if (error) throw error;
    }
  },

  async listComments(postId: string): Promise<FeedComment[]> {
    const { data, error } = await supabase
      .from('feed_comments')
      .select('id, post_id, author_id, body, created_at, profiles:author_id(first_name, last_name)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map((r) => {
      const row = r as Record<string, unknown>;
      const p = row.profiles as Record<string, unknown> | null;
      return {
        id: row.id as string,
        postId: row.post_id as string,
        authorId: row.author_id as string,
        authorName: `${(p?.first_name as string) || ''} ${(p?.last_name as string) || ''}`.trim(),
        body: row.body as string,
        createdAt: row.created_at as string,
      };
    });
  },

  async addComment(postId: string, userId: string, body: string): Promise<void> {
    const { error } = await supabase.from('feed_comments').insert({ post_id: postId, author_id: userId, body });
    if (error) throw error;
  },

  async deleteComment(commentId: string): Promise<void> {
    const { error } = await supabase.from('feed_comments').delete().eq('id', commentId);
    if (error) throw error;
  },

  /** Advisor moderation. A student's own task post is removed through
   *  setSubmissionSharing(false), never here. */
  async deletePost(postId: string): Promise<void> {
    const { error } = await supabase.from('feed_posts').delete().eq('id', postId);
    if (error) throw error;
  },

  async setSubmissionSharing(submissionId: string, share: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_submission_sharing', { p_submission_id: submissionId, p_share: share });
    if (error) throw new RpcError(error.message);
  },
};
