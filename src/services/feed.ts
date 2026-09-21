import { supabase } from './supabase';
import { signEvidence, signFeedAttachment, uploadToBucket, FEED_ATTACHMENT_BUCKET } from './evidenceUrls';
import { RpcError } from './rpcError';
import type { FeedPost, FeedComment, FeedPostKind, FeedAttachment, FeedAttachmentKind } from '@/types/feed';
import type { PhotoEvidence, DocumentEvidence } from '@/types/assignment';

export const FEED_PAGE_SIZE = 20;

function toPost(raw: Record<string, unknown>): FeedPost {
  const task = raw.task as Record<string, unknown> | null;
  const poll = raw.poll as Record<string, unknown> | null;
  const assignment = raw.assignment as Record<string, unknown> | null;
  const attachments = Array.isArray(raw.attachments) ? (raw.attachments as Record<string, unknown>[]) : [];
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
    draft: !!raw.draft,
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
          options: ((poll.options as Record<string, unknown>[]) || []).map((o) => ({
            id: o.id as string,
            label: (o.label as string) || '',
            position: Number(o.position) || 0,
            votes: Number(o.votes) || 0,
          })),
          totalVotes: Number(poll.totalVotes) || 0,
          myOptionId: (poll.myOptionId as string) || undefined,
        }
      : undefined,
    assignment: assignment
      ? {
          id: assignment.id as string,
          title: (assignment.title as string) || '',
          competencyName: (assignment.competencyName as string) || undefined,
          level: typeof assignment.level === 'number' ? assignment.level : undefined,
          dueDate: (assignment.dueDate as string) || undefined,
        }
      : undefined,
    // photo/document targets are storage paths here; listPosts signs them.
    attachments: attachments.map((a) => ({
      id: a.id as string,
      kind: a.kind as FeedAttachmentKind,
      target: (a.target as string) || '',
      name: (a.name as string) || undefined,
      mime: (a.mime as string) || undefined,
      size: a.size === null || a.size === undefined ? undefined : Number(a.size),
    })),
  };
}

/** Anything outside [A-Za-z0-9._-] becomes '_' so the object key is plain
 *  ASCII whatever the device named the file. */
function safeFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Exchange stored evidence/attachment paths for signed URLs. Shared by
 *  listPosts and listPending so a draft's files open exactly as they will
 *  once published. */
async function signPost(raw: Record<string, unknown>): Promise<FeedPost> {
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
  if (post.attachments.length > 0) {
    // Sign photo/document targets; links pass through untouched. An
    // attachment whose signing failed is DROPPED rather than kept with
    // its bare path: a chip that opens nothing is worse than no chip,
    // and the row still stands for the next read.
    const signed = await Promise.all(post.attachments.map(async (a): Promise<FeedAttachment | undefined> => {
      if (a.kind === 'link') return a;
      const url = await signFeedAttachment(a.target);
      return url ? { ...a, target: url } : undefined;
    }));
    post.attachments = signed.filter((a): a is FeedAttachment => a !== undefined);
  }
  return post;
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
    const rows = (data || []) as Record<string, unknown>[];
    return Promise.all(rows.map(signPost));
  },

  /** The advisor's unpublished posts for a group, newest first (owner-only
   *  RPC). Same shape as listPosts with `draft: true` and zero counts. */
  async listPending(groupId: string): Promise<FeedPost[]> {
    const { data, error } = await supabase.rpc('list_feed_pending', { p_group_id: groupId });
    if (error) throw new RpcError(error.message);
    const rows = (data || []) as Record<string, unknown>[];
    return Promise.all(rows.map(signPost));
  },

  async createPost(
    groupId: string,
    kind: 'announcement' | 'poll',
    body: string,
    options?: string[],
    attachments?: { kind: FeedAttachmentKind; target: string; name?: string; mime?: string; size?: number }[],
    draft = false,
  ): Promise<string> {
    const { data, error } = await supabase.rpc('create_feed_post', {
      p_group_id: groupId,
      p_kind: kind,
      p_body: body,
      p_options: options ?? null,
      p_attachments: attachments ?? [],
      p_draft: draft,
    });
    if (error) throw new RpcError(error.message);
    return data as string;
  },

  /** Upload one announcement attachment; returns the storage PATH, which is
   *  what the feed_attachments row stores. It is not a URL: the bucket is
   *  private, so a URL only exists at read time (listPosts signs it). */
  async uploadFeedAttachment(groupId: string, uri: string, fileName: string, mime: string): Promise<string> {
    const path = `${groupId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}/${safeFileName(fileName)}`;
    await uploadToBucket(FEED_ATTACHMENT_BUCKET, path, uri, fileName, mime);
    return path;
  },

  /** Draft -> live. Owner-checked server-side; sets published_at and sends
   *  the member notifications create_feed_post would have sent. */
  async publishPost(postId: string): Promise<void> {
    const { error } = await supabase.rpc('publish_feed_post', { p_post_id: postId });
    if (error) throw new RpcError(error.message);
  },

  async vote(postId: string, optionId: string): Promise<void> {
    const { error } = await supabase.rpc('vote_feed_poll', { p_post_id: postId, p_option_id: optionId });
    if (error) throw new RpcError(error.message);
  },

  /** Direct table writes under RLS; user_id is the caller by policy. */
  async setLiked(postId: string, userId: string, liked: boolean): Promise<void> {
    if (liked) {
      // insert, not upsert: feed_likes has INSERT and DELETE policies but
      // no UPDATE policy, so upsert's ON CONFLICT DO UPDATE would be refused.
      // A duplicate (23505) means the like already stands, which is success.
      const { error } = await supabase.from('feed_likes').insert({ post_id: postId, user_id: userId });
      if (error && error.code !== '23505') throw error;
    } else {
      const { error } = await supabase.from('feed_likes').delete().eq('post_id', postId).eq('user_id', userId);
      if (error) throw error;
    }
  },

  async listComments(postId: string): Promise<FeedComment[]> {
    const { data, error } = await supabase
      .from('feed_comments')
      .select('id, post_id, author_id, body, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const rows = (data || []) as Record<string, unknown>[];

    // Names come from profiles_public, not an embed on profiles: the
    // profiles SELECT policy never lets a student read a classmate's or the
    // advisor's row, so the embed came back null and the name rendered
    // blank, silently. profiles_public's policy covers group-mates and the
    // student's own advisor (shares_group_with), which is exactly who can
    // comment here. One query for all distinct authors on the post.
    const authorIds = Array.from(new Set(rows.map((r) => r.author_id as string)));
    const names = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: people, error: peopleError } = await supabase
        .from('profiles_public')
        .select('id, first_name, last_name')
        .in('id', authorIds);
      if (peopleError) throw peopleError;
      for (const p of (people || []) as Record<string, unknown>[]) {
        names.set(p.id as string, `${(p.first_name as string) || ''} ${(p.last_name as string) || ''}`.trim());
      }
    }

    return rows.map((row) => ({
      id: row.id as string,
      postId: row.post_id as string,
      authorId: row.author_id as string,
      authorName: names.get(row.author_id as string) || '',
      body: row.body as string,
      createdAt: row.created_at as string,
    }));
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
   *  setSubmissionSharing(false), never here. The RPC also turns the
   *  student's sharing flag off for a task post, so the switch cannot read
   *  "on" for a post that is gone and quietly undo the removal. */
  async deletePost(postId: string): Promise<void> {
    const { error } = await supabase.rpc('remove_feed_post', { p_post_id: postId });
    if (error) throw new RpcError(error.message);
  },

  async setSubmissionSharing(submissionId: string, share: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_submission_sharing', { p_submission_id: submissionId, p_share: share });
    if (error) throw new RpcError(error.message);
  },
};
