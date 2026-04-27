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

type EmojiSummary = { id?: number; keyword?: string; image?: string };

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
  const [reactionActionLoading, setReactionActionLoading] = useState(false);

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

  const reactToPost = useCallback(
    async (post: FeedPost, emojiId: number) => {
      const uuid = (post as any)?.uuid;
      const postId = (post as any)?.id;
      if (!token || !uuid || typeof postId !== 'number' || !emojiId || reactionActionLoading) return;

      const current: any = post;
      const isAlreadyMine = current?.reaction?.emoji?.id === emojiId;
      const prevId: number | undefined = current?.reaction?.emoji?.id;
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

      const patch = (p: any): any => {
        if (isAlreadyMine) {
          return {
            ...p,
            reaction: null,
            reactions_emoji_counts: (p.reactions_emoji_counts || [])
              .map((e: any) =>
                e.emoji?.id === emojiId ? { ...e, count: Math.max(0, (e.count || 1) - 1) } : e,
              )
              .filter((e: any) => (e.count || 0) > 0),
          };
        }
        const counts = (p.reactions_emoji_counts || []).map((e: any) => {
          if (e.emoji?.id === emojiId) return { ...e, count: (e.count || 0) + 1 };
          if (prevId && e.emoji?.id === prevId) return { ...e, count: Math.max(0, (e.count || 1) - 1) };
          return e;
        });
        if (!counts.some((e: any) => e.emoji?.id === emojiId) && emojiMeta) {
          counts.push({ emoji: emojiMeta, count: 1 });
        }
        return {
          ...p,
          reaction: { emoji: emojiMeta },
          reactions_emoji_counts: counts.filter((e: any) => (e.count || 0) > 0),
        };
      };
      patchPost(postId, patch as (p: FeedPost) => FeedPost);

      setReactionActionLoading(true);
      try {
        if (isAlreadyMine) {
          await api.removeReactionFromPost(token, uuid);
        } else {
          await api.reactToPost(token, uuid, emojiId);
        }
      } catch {
        try {
          const counts = await api.getPostReactionCounts(token, uuid);
          patchPost(postId, ((p: any) => ({ ...p, reactions_emoji_counts: counts })) as (p: FeedPost) => FeedPost);
        } catch {
          // give up
        }
      } finally {
        setReactionActionLoading(false);
      }
    },
    [token, reactionActionLoading, reactionGroups, patchPost],
  );

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
