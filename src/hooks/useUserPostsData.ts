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
  error: string;
  refresh: () => Promise<void>;
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
      } catch (e: any) {
        setError(e?.message || 'Could not load posts.');
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
    error,
    refresh,
    reactionGroups,
    reactionGroupsLoading,
    reactionActionLoading,
    ensureReactionGroups,
    reactToPost,
  };
}
