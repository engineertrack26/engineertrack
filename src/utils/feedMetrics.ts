import type { FeedPost } from '@/types/feed';

/** Largest-remainder rounding so the bars always add up to 100 (or all
 *  zero when nobody has voted). Plain rounding shows 33/33/33 = 99. */
export function pollPercentages(options: Array<{ votes: number }>): number[] {
  const total = options.reduce((sum, o) => sum + o.votes, 0);
  if (total === 0) return options.map(() => 0);
  const exact = options.map((o) => (o.votes * 100) / total);
  const floors = exact.map(Math.floor);
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

/** The optimistic like toggle, in one place so the card and the list agree. */
export function withLike(post: FeedPost, liked: boolean): FeedPost {
  if (post.likedByMe === liked) return post;
  return {
    ...post,
    likedByMe: liked,
    likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)),
  };
}
