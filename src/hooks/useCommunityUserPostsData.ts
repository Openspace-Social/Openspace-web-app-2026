/**
 * useCommunityUserPostsData — one user's posts within a single community.
 *
 * Backs the "View all posts in c/<name> by @<user>" screen. Pages through
 * the author's global post feed (api.getUserPosts is the only paginated
 * by-author endpoint) and keeps only the rows that belong to the target
 * community. The pagination cursor tracks the last *raw* post id so the
 * community filter never causes pages to be skipped.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type FeedPost } from '../api/client';
import type { ReactionGroup } from '../components/PostCard';
import { usePostReactions } from './usePostReactions';

export type UseCommunityUserPostsDataResult = {
  posts: FeedPost[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  removePost: (postId: number) => void;
  patchPost: (postId: number, mutate: (p: FeedPost) => FeedPost) => void;
  reactionGroups: ReactionGroup[];
  reactionGroupsLoading: boolean;
  reactionActionLoading: boolean;
  ensureReactionGroups: () => Promise<void>;
  reactToPost: (post: FeedPost, emojiId: number) => Promise<void>;
};

const PAGE_SIZE = 20;

function belongsToCommunity(post: FeedPost, communityName: string) {
  const name = post.community?.name;
  return typeof name === 'string' && name.trim().toLowerCase() === communityName;
}

export function useCommunityUserPostsData(
  token: string | null,
  username: string | undefined,
  communityName: string | undefined,
): UseCommunityUserPostsDataResult {
  const normalizedCommunity = (communityName || '').trim().toLowerCase();

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const [reactionGroups, setReactionGroups] = useState<ReactionGroup[]>([]);
  const [reactionGroupsLoading, setReactionGroupsLoading] = useState(false);

  // Cursor into the *raw* (unfiltered) author feed — the id of the last raw
  // post seen, passed as max_id on the next page. Tracked in a ref so the
  // community filter on `posts` can't corrupt the pagination position.
  const rawCursorRef = useRef<number | undefined>(undefined);

  const load = useCallback(
    async (silent = false) => {
      if (!token || !username || !normalizedCommunity) return;
      if (!silent) setLoading(true);
      setError('');
      try {
        const raw = await api.getUserPosts(token, username, PAGE_SIZE);
        const safeRaw = Array.isArray(raw) ? raw : [];
        const lastRaw = safeRaw[safeRaw.length - 1];
        rawCursorRef.current = typeof lastRaw?.id === 'number' ? lastRaw.id : undefined;
        setPosts(safeRaw.filter((p) => belongsToCommunity(p, normalizedCommunity)));
        setHasMore(safeRaw.length === PAGE_SIZE);
      } catch (e: any) {
        setError(e?.message || 'Could not load posts.');
        setHasMore(false);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token, username, normalizedCommunity],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, load]);

  const loadMore = useCallback(async () => {
    if (!token || !username || !normalizedCommunity) return;
    if (loadingMore || loading || !hasMore) return;
    const cursor = rawCursorRef.current;
    if (typeof cursor !== 'number' || !Number.isFinite(cursor)) {
      setHasMore(false);
      return;
    }
    setLoadingMore(true);
    try {
      const raw = await api.getUserPosts(token, username, PAGE_SIZE, cursor);
      const safeRaw = Array.isArray(raw) ? raw : [];
      const lastRaw = safeRaw[safeRaw.length - 1];
      rawCursorRef.current = typeof lastRaw?.id === 'number' ? lastRaw.id : undefined;
      const matches = safeRaw.filter((p) => belongsToCommunity(p, normalizedCommunity));
      setPosts((prev) => {
        const seen = new Set(prev.map((p: any) => p?.id).filter((id): id is number => typeof id === 'number'));
        return [...prev, ...matches.filter((p: any) => typeof p?.id === 'number' && !seen.has(p.id))];
      });
      setHasMore(safeRaw.length === PAGE_SIZE);
    } catch {
      // keep existing content; the user can retry by scrolling again
    } finally {
      setLoadingMore(false);
    }
  }, [token, username, normalizedCommunity, loadingMore, loading, hasMore]);

  const ensureReactionGroups = useCallback(async () => {
    if (!token || reactionGroups.length > 0 || reactionGroupsLoading) return;
    setReactionGroupsLoading(true);
    try {
      const groups = await api.getPostReactionEmojiGroups(token);
      setReactionGroups(groups);
    } catch {
      // silent
    } finally {
      setReactionGroupsLoading(false);
    }
  }, [token, reactionGroups.length, reactionGroupsLoading]);

  const removePost = useCallback((postId: number) => {
    setPosts((prev) => prev.filter((p) => (p as any).id !== postId));
  }, []);

  const patchPost = useCallback((postId: number, mutate: (p: FeedPost) => FeedPost) => {
    setPosts((prev) => prev.map((p) => ((p as any).id === postId ? mutate(p) : p)));
  }, []);

  // Shared optimistic-update hook — see usePostReactions for the full
  // logic (toggle, swap, add, rollback on failure).
  const { reactionActionLoading, reactToPost } = usePostReactions({
    token,
    reactionGroups,
    patchPost,
  });

  return {
    posts,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
    removePost,
    patchPost,
    reactionGroups,
    reactionGroupsLoading,
    reactionActionLoading,
    ensureReactionGroups,
    reactToPost,
  };
}
