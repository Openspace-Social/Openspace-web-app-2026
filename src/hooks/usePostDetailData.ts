/**
 * usePostDetailData — fetch + manage a single post for the PostDetail
 * screen.
 *
 * Parallel to useFeedData but scoped to one post. Owns the post object,
 * reaction groups, and (via usePostReactions) the reactToPost handler
 * with optimistic updates.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, type FeedPost } from '../api/client';
import type { ReactionGroup } from '../components/PostCard';
import { usePostReactions } from './usePostReactions';

export type UsePostDetailDataResult = {
  post: FeedPost | null;
  loading: boolean;
  error: string;
  reactionGroups: ReactionGroup[];
  reactionGroupsLoading: boolean;
  reactionActionLoading: boolean;
  ensureReactionGroups: () => Promise<void>;
  reactToPost: (post: FeedPost, emojiId: number) => Promise<void>;
  refresh: () => Promise<void>;
};

export function usePostDetailData(
  token: string | null,
  postUuid: string | undefined,
): UsePostDetailDataResult {
  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reactionGroups, setReactionGroups] = useState<ReactionGroup[]>([]);
  const [reactionGroupsLoading, setReactionGroupsLoading] = useState(false);

  // The optimistic-update + API + rollback dance is shared with the
  // feed and HomeScreen flows. patchPost adapts the single-post state
  // shape (we only ever target one id) so the hook's contract works
  // unchanged.
  const patchPost = useCallback(
    (targetId: number, fn: (p: FeedPost) => FeedPost) => {
      setPost((prev) => (prev && (prev as any).id === targetId ? (fn(prev) as FeedPost) : prev));
    },
    [],
  );
  const { reactionActionLoading, reactToPost } = usePostReactions({
    token,
    reactionGroups,
    patchPost,
  });

  useEffect(() => {
    if (!postUuid) return;
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const p = await api.getPostByUuid(token, postUuid);
        if (active) setPost(p as FeedPost);
      } catch (e: any) {
        if (active) setError(e?.message || 'Could not load this post.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, postUuid]);

  const refresh = useCallback(async () => {
    if (!postUuid) return;
    try {
      const p = await api.getPostByUuid(token, postUuid);
      setPost(p as FeedPost);
    } catch {
      // leave previous state intact
    }
  }, [token, postUuid]);

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

  return {
    post,
    loading,
    error,
    reactionGroups,
    reactionGroupsLoading,
    reactionActionLoading,
    ensureReactionGroups,
    reactToPost,
    refresh,
  };
}
