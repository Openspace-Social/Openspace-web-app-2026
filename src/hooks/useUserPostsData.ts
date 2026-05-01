/**
 * useUserPostsData — fetches a single user's posts plus reactions.
 *
 * Parallel to useFeedData but scoped to one author. Owns the posts list,
 * reaction-groups state, and the reactToPost handler (with optimistic
 * updates) so PublicProfileScreenContainer can plug it into the same
 * PostInteractionsProvider pipeline the feed already uses.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, type FeedPost } from '../api/client';
import type { ReactionGroup } from '../components/PostCard';
import { usePostReactions } from './usePostReactions';

export type UseUserPostsDataResult = {
  posts: FeedPost[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  reactionGroups: ReactionGroup[];
  reactionGroupsLoading: boolean;
  reactionActionLoading: boolean;
  ensureReactionGroups: () => Promise<void>;
  reactToPost: (post: FeedPost, emojiId: number) => Promise<void>;
};

const PAGE_SIZE = 10;

export function useUserPostsData(
  token: string | null,
  username: string | undefined,
): UseUserPostsDataResult {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const [reactionGroups, setReactionGroups] = useState<ReactionGroup[]>([]);
  const [reactionGroupsLoading, setReactionGroupsLoading] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!token || !username) return;
      if (!silent) setLoading(true);
      setError('');
      try {
        const list = await api.getUserPosts(token, username, PAGE_SIZE);
        setPosts(Array.isArray(list) ? list : []);
        setHasMore(Array.isArray(list) && list.length === PAGE_SIZE);
      } catch (e: any) {
        setError(e?.message || 'Could not load posts.');
        setHasMore(false);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token, username],
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
    if (!token || !username || loadingMore || loading || !hasMore) return;
    const lastId = posts.length > 0 ? posts[posts.length - 1]?.id : undefined;
    if (typeof lastId !== 'number' || !Number.isFinite(lastId)) {
      setHasMore(false);
      return;
    }
    setLoadingMore(true);
    try {
      const more = await api.getUserPosts(token, username, PAGE_SIZE, lastId);
      const safeMore = Array.isArray(more) ? more : [];
      setPosts((prev) => {
        const seen = new Set(prev.map((p: any) => p?.id).filter((id): id is number => typeof id === 'number'));
        const uniqueMore = safeMore.filter((p: any) => {
          const id = p?.id;
          if (typeof id !== 'number' || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        return [...prev, ...uniqueMore];
      });
      setHasMore(safeMore.length === PAGE_SIZE);
    } catch {
      // keep existing content; caller can retry by scrolling again
    } finally {
      setLoadingMore(false);
    }
  }, [token, username, loadingMore, loading, hasMore, posts]);

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
    reactionGroups,
    reactionGroupsLoading,
    reactionActionLoading,
    ensureReactionGroups,
    reactToPost,
  };
}
