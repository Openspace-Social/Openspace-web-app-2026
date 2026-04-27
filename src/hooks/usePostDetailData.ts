/**
 * usePostDetailData — fetch + manage a single post for the PostDetail
 * screen.
 *
 * Parallel to useFeedData but scoped to one post. Owns the post object,
 * reaction groups, and the reactToPost handler with optimistic updates
 * (same shape as useFeedData's, so the existing reaction picker + native
 * interactions wiring works unchanged).
 *
 * Refactor note: reaction logic is duplicated from useFeedData. Both hooks
 * should eventually share a `usePostReactions(getPost, patchPost, token)`
 * helper — deferred until a third consumer (Profile / Community) needs it.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, type FeedPost } from '../api/client';
import type { ReactionGroup } from '../components/PostCard';

type EmojiSummary = { id?: number; keyword?: string; image?: string };

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
  const [reactionActionLoading, setReactionActionLoading] = useState(false);

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

  const reactToPost = useCallback(
    async (target: FeedPost, emojiId: number) => {
      const uuid = (target as any)?.uuid;
      if (!token || !uuid || !emojiId || reactionActionLoading) return;
      if (!post || (post as any)?.id !== (target as any)?.id) return;

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

      // Optimistic update
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
      setPost((prev) => (prev ? (patch(prev) as FeedPost) : prev));

      setReactionActionLoading(true);
      try {
        if (isAlreadyMine) {
          await api.removeReactionFromPost(token, uuid);
        } else {
          await api.reactToPost(token, uuid, emojiId);
        }
      } catch {
        // Roll back to server ground truth.
        try {
          const counts = await api.getPostReactionCounts(token, uuid);
          setPost((prev) => (prev ? ({ ...prev, reactions_emoji_counts: counts } as any) : prev));
        } catch {
          // give up — leave optimistic state
        }
      } finally {
        setReactionActionLoading(false);
      }
    },
    [token, post, reactionActionLoading, reactionGroups],
  );

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
