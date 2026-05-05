/**
 * useHashtagPostsData — paginated feed of posts using a given hashtag.
 *
 * Mirrors the shape of useFeedData so HashtagScreenContainer can reuse the
 * same wiring (PostInteractionsProvider, ReactionPickerDrawer, etc.) with
 * minimal divergence. The only meaningful differences from useFeedData are
 * (a) the fetch call, and (b) the dependency on `name` instead of feedType.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type FeedPost, type HashtagInfo } from '../api/client';
import { usePostReactions } from './usePostReactions';

const HASHTAG_PAGE_SIZE = 10;

type ReactionGroup = any;

type UseHashtagPostsDataResult = {
  hashtag: HashtagInfo | null;
  hashtagLoading: boolean;
  posts: FeedPost[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  hasMore: boolean;
  error: string;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  reactionGroups: ReactionGroup[];
  reactionGroupsLoading: boolean;
  reactionActionLoading: boolean;
  ensureReactionGroups: () => Promise<void>;
  reactToPost: (post: FeedPost, emojiId: number) => Promise<void>;
  removePost: (postId: number) => void;
  patchPost: (postId: number, mutate: (p: FeedPost) => FeedPost) => void;
};

export function useHashtagPostsData(
  token: string | null,
  name: string | undefined,
): UseHashtagPostsDataResult {
  const [hashtag, setHashtag] = useState<HashtagInfo | null>(null);
  const [hashtagLoading, setHashtagLoading] = useState(false);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextMaxId, setNextMaxId] = useState<number | undefined>(undefined);
  const [error, setError] = useState('');
  const activeFetchRef = useRef(0);

  const loadFirstPage = useCallback(
    async (silent = false) => {
      if (!token || !name) return;
      const fetchId = activeFetchRef.current + 1;
      activeFetchRef.current = fetchId;
      if (!silent) {
        setLoading(true);
        setPosts([]);
      }
      setError('');
      setNextMaxId(undefined);
      setHasMore(false);
      try {
        const next = await api.getHashtagPosts(token, name, HASHTAG_PAGE_SIZE);
        if (fetchId !== activeFetchRef.current) return;
        setPosts(Array.isArray(next) ? next : []);
        if (Array.isArray(next) && next.length > 0) {
          const lastId = next[next.length - 1]?.id;
          setHasMore(true);
          setNextMaxId(typeof lastId === 'number' ? lastId : undefined);
        }
      } catch (e: any) {
        if (fetchId !== activeFetchRef.current) return;
        setPosts([]);
        setError(e?.message || 'Could not load posts.');
      } finally {
        if (fetchId === activeFetchRef.current && !silent) setLoading(false);
      }
    },
    [token, name],
  );

  // Hashtag info (color, post count) is fetched once per name change. Kept
  // separate from the posts fetch so a transient header failure doesn't
  // also blank the feed.
  useEffect(() => {
    if (!token || !name) {
      setHashtag(null);
      return;
    }
    let active = true;
    setHashtagLoading(true);
    (async () => {
      try {
        const info = await api.getHashtag(token, name);
        if (active) setHashtag(info);
      } catch {
        if (active) setHashtag(null);
      } finally {
        if (active) setHashtagLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, name]);

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
    if (!token || !name || loadingMore || !hasMore || nextMaxId === undefined) return;
    setLoadingMore(true);
    try {
      const more = await api.getHashtagPosts(token, name, HASHTAG_PAGE_SIZE, nextMaxId);
      if (Array.isArray(more) && more.length > 0) {
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
      // Silent — user can scroll again to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [token, name, loadingMore, hasMore, nextMaxId]);

  const [reactionGroups, setReactionGroups] = useState<ReactionGroup[]>([]);
  const [reactionGroupsLoading, setReactionGroupsLoading] = useState(false);

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
      // resilient
    } finally {
      setReactionGroupsLoading(false);
    }
  }, [token, reactionGroups.length, reactionGroupsLoading]);

  const { reactionActionLoading, reactToPost } = usePostReactions({
    token,
    reactionGroups,
    patchPost,
  });

  return {
    hashtag,
    hashtagLoading,
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
