/**
 * useFeedData — self-contained feed fetcher.
 *
 * Mirrors the legacy loadFeed / loadMoreFeed / handleRefreshFeed flow that
 * lives inside HomeScreen. Pulled into a hook so the navigator-side FeedScreen
 * can own its own fetch without depending on HomeScreen's massive state tree.
 *
 * Later, when full post interactions are extracted, we'll upgrade this to
 * share state (optimistic updates, new-posts banner, etc.) with the rest of
 * the app via PostInteractionsContext.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type FeedPost, type FeedType } from '../api/client';

const FEED_PAGE_SIZE = 10;

type ReactionGroup = any; // api type — keep loose until we own a proper ReactionGroup type
type EmojiSummary = { id?: number; keyword?: string; image?: string };

type UseFeedDataResult = {
  posts: FeedPost[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  hasMore: boolean;
  error: string;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Reactions — lazily loaded emoji groups, action handler with optimistic updates. */
  reactionGroups: ReactionGroup[];
  reactionGroupsLoading: boolean;
  reactionActionLoading: boolean;
  ensureReactionGroups: () => Promise<void>;
  reactToPost: (post: FeedPost, emojiId: number) => Promise<void>;
  /** Drop a post from the local feed list without a refetch — used after
   *  the user deletes one of their own posts. */
  removePost: (postId: number) => void;
  /** Patch a single post in place — used after server-side mutations
   *  (e.g. changing communities) so the local feed reflects them without
   *  a full refetch. */
  patchPost: (postId: number, mutate: (p: FeedPost) => FeedPost) => void;
};

export function useFeedData(token: string | null, feed: FeedType): UseFeedDataResult {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextMaxId, setNextMaxId] = useState<number | undefined>(undefined);
  const [error, setError] = useState('');
  // Guard against stale responses when the caller rapidly switches feeds.
  const activeFetchRef = useRef(0);

  const loadFirstPage = useCallback(
    async (silent = false) => {
      if (!token) return;
      const fetchId = activeFetchRef.current + 1;
      activeFetchRef.current = fetchId;
      if (!silent) {
        // Clear posts on a non-silent load (initial mount or feed switch)
        // so the empty-state spinner kicks in and the user sees the load
        // happen explicitly. Pull-to-refresh stays silent and keeps posts.
        setLoading(true);
        setPosts([]);
      }
      setError('');
      setNextMaxId(undefined);
      setHasMore(false);
      try {
        const next = await api.getFeed(token, feed, FEED_PAGE_SIZE);
        if (fetchId !== activeFetchRef.current) return;
        setPosts(next);
        if (next.length > 0) {
          const lastId = next[next.length - 1]?.id;
          setHasMore(true);
          setNextMaxId(typeof lastId === 'number' ? lastId : undefined);
        }
      } catch (e: any) {
        if (fetchId !== activeFetchRef.current) return;
        setPosts([]);
        setError(e?.message || 'Could not load the feed.');
      } finally {
        if (fetchId === activeFetchRef.current && !silent) setLoading(false);
      }
    },
    [token, feed],
  );

  // Reload whenever the feed type or token changes.
  useEffect(() => {
    void loadFirstPage(false);
  }, [loadFirstPage]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadFirstPage(true);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!token || loadingMore || !hasMore || nextMaxId === undefined) return;
    setLoadingMore(true);
    try {
      const more = await api.getFeed(token, feed, FEED_PAGE_SIZE, nextMaxId);
      if (more.length > 0) {
        setPosts((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...more.filter((p) => !seen.has(p.id))];
        });
        const lastId = more[more.length - 1]?.id;
        setNextMaxId(typeof lastId === 'number' ? lastId : undefined);
        setHasMore(true);
      } else {
        setHasMore(false);
        setNextMaxId(undefined);
      }
    } catch {
      // Silent — user can keep scrolling to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [token, feed, loadingMore, hasMore, nextMaxId]);

  // ── Reactions ───────────────────────────────────────────────────────────
  const [reactionGroups, setReactionGroups] = useState<ReactionGroup[]>([]);
  const [reactionGroupsLoading, setReactionGroupsLoading] = useState(false);
  const [reactionActionLoading, setReactionActionLoading] = useState(false);

  // In-place edit of a single post by id — used for optimistic reaction updates.
  const patchPost = useCallback((postId: number, mutate: (p: FeedPost) => FeedPost) => {
    setPosts((prev) => prev.map((p) => ((p as any).id === postId ? mutate(p) : p)));
  }, []);

  const removePost = useCallback((postId: number) => {
    setPosts((prev) => prev.filter((p) => (p as any).id !== postId));
  }, []);

  const ensureReactionGroups = useCallback(async () => {
    if (!token || reactionGroups.length > 0 || reactionGroupsLoading) return;
    setReactionGroupsLoading(true);
    try {
      const groups = await api.getPostReactionEmojiGroups(token);
      setReactionGroups(groups);
    } catch {
      // Keep UI resilient; caller can retry.
    } finally {
      setReactionGroupsLoading(false);
    }
  }, [token, reactionGroups.length, reactionGroupsLoading]);

  const reactToPost = useCallback(
    async (post: FeedPost, emojiId: number) => {
      const uuid = (post as any)?.uuid;
      const postId = (post as any)?.id;
      if (!token || !uuid || typeof postId !== 'number' || !emojiId || reactionActionLoading) return;

      const current: any = post;
      const isAlreadyMine = current?.reaction?.emoji?.id === emojiId;
      const prevId: number | undefined = current?.reaction?.emoji?.id;
      // Try the post's own counts first; if this is the first time anyone
      // reacts with this emoji, the post has no entry for it, so fall back
      // to the emoji library loaded by the reaction picker. Without this
      // fallback the optimistic update produces an empty reaction object
      // and the UI shows nothing until a full refetch.
      let emojiMeta: EmojiSummary | undefined = (current.reactions_emoji_counts || []).find(
        (e: any) => e.emoji?.id === emojiId,
      )?.emoji;
      if (!emojiMeta) {
        for (const group of reactionGroups) {
          const found = (group?.emojis || []).find((e: any) => e?.id === emojiId);
          if (found) {
            emojiMeta = found as EmojiSummary;
            break;
          }
        }
      }

      // Optimistic update
      if (isAlreadyMine) {
        patchPost(postId, (p: any) => ({
          ...p,
          reaction: null,
          reactions_emoji_counts: (p.reactions_emoji_counts || [])
            .map((e: any) => (e.emoji?.id === emojiId ? { ...e, count: Math.max(0, (e.count || 1) - 1) } : e))
            .filter((e: any) => (e.count || 0) > 0),
        }));
      } else {
        patchPost(postId, (p: any) => ({
          ...p,
          reaction: { emoji: emojiMeta },
          reactions_emoji_counts: (() => {
            const counts = (p.reactions_emoji_counts || []).map((e: any) => {
              if (e.emoji?.id === emojiId) return { ...e, count: (e.count || 0) + 1 };
              if (prevId && e.emoji?.id === prevId) return { ...e, count: Math.max(0, (e.count || 1) - 1) };
              return e;
            });
            // First-time reaction with this emoji — add an entry.
            if (!counts.some((e: any) => e.emoji?.id === emojiId) && emojiMeta) {
              counts.push({ emoji: emojiMeta, count: 1 });
            }
            return counts.filter((e: any) => (e.count || 0) > 0);
          })(),
        }));
      }

      setReactionActionLoading(true);
      try {
        if (isAlreadyMine) {
          await api.removeReactionFromPost(token, uuid);
        } else {
          await api.reactToPost(token, uuid, emojiId);
        }
      } catch {
        // Roll back to ground truth on failure — refetch this post's counts.
        try {
          const counts = await api.getPostReactionCounts(token, uuid);
          patchPost(postId, (p: any) => ({ ...p, reactions_emoji_counts: counts }));
        } catch {
          // Leave optimistic state if both calls fail.
        }
      } finally {
        setReactionActionLoading(false);
      }
    },
    [token, reactionActionLoading, patchPost, reactionGroups],
  );

  return {
    posts,
    loading,
    loadingMore,
    refreshing,
    hasMore,
    error,
    refresh,
    loadMore,
    reactionGroups,
    reactionGroupsLoading,
    reactionActionLoading,
    ensureReactionGroups,
    reactToPost,
    removePost,
    patchPost,
  };
}
