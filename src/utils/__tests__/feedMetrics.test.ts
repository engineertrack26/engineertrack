import { pollPercentages, withLike } from '@/utils/feedMetrics';
import type { FeedPost } from '@/types/feed';

describe('pollPercentages', () => {
  it('returns all zeros with no votes', () => {
    expect(pollPercentages([{ votes: 0 }, { votes: 0 }])).toEqual([0, 0]);
  });

  it('sums to exactly 100 even when thirds would not', () => {
    const p = pollPercentages([{ votes: 1 }, { votes: 1 }, { votes: 1 }]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
    expect(p).toEqual([34, 33, 33]);
  });

  it('gives the whole hundred to a single option', () => {
    expect(pollPercentages([{ votes: 5 }, { votes: 0 }])).toEqual([100, 0]);
  });

  it('gives the leftover point to the larger fraction, not the first option', () => {
    // 2/3 = 66.67, 1/3 = 33.33, 0: floors 66/33/0 leave one point, and it
    // belongs to the .67, not to whichever option comes first.
    expect(pollPercentages([{ votes: 2 }, { votes: 1 }, { votes: 0 }])).toEqual([67, 33, 0]);
    // Same fractions, reversed order: the point still follows the .67.
    expect(pollPercentages([{ votes: 0 }, { votes: 1 }, { votes: 2 }])).toEqual([0, 33, 67]);
  });
});

describe('withLike', () => {
  const post = { id: 'p', likeCount: 2, likedByMe: false } as FeedPost;

  it('adds one when liking', () => {
    expect(withLike(post, true)).toMatchObject({ likeCount: 3, likedByMe: true });
  });

  it('removes one when unliking and never goes below zero', () => {
    expect(withLike({ ...post, likeCount: 1, likedByMe: true }, false)).toMatchObject({ likeCount: 0, likedByMe: false });
    expect(withLike({ ...post, likeCount: 0, likedByMe: true }, false).likeCount).toBe(0);
  });

  it('is a no-op when the state already matches', () => {
    expect(withLike({ ...post, likedByMe: true, likeCount: 3 }, true).likeCount).toBe(3);
  });
});
