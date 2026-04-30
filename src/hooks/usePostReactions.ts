/**
 * usePostReactions — single source of truth for the post reaction
 * optimistic-update flow.
 *
 * Why this exists:
 *   The same react/swap/remove logic was duplicated three times
 *   (useFeedData, usePostDetailData, HomeScreen). All three cared about
 *   the same shape: detect toggle/swap/add, find emoji metadata, apply
 *   an optimistic patch, fire the API call, reconcile on success or
 *   roll back on failure. Extracted here so adding a fourth consumer
 *   (or fixing a bug) is one edit, not three.
 *
 * Caller contract:
 *   - `patchPost(postId, fn)` mutates whatever container holds the post
 *     (a feed array, a single post-detail state, etc.).
 *   - `reactionGroups` is the picker's emoji library, used as a fallback
 *     when a post has zero existing reactions for the picked emoji
 *     (otherwise the optimistic count would have no emoji metadata to
 *     render with until the next refetch).
 */

import { useCallback, useState } from 'react';
import { api, type FeedPost } from '../api/client';
import type { ReactionGroup } from '../components/PostCard';

type EmojiSummary = { id?: number; keyword?: string; image?: string };

export type UsePostReactionsOptions = {
  token: string | null;
  reactionGroups: ReactionGroup[];
  /**
   * Patches the post wherever it lives (single state, feed array, etc.).
   * Called for the optimistic update, the post-success canonical reaction
   * patch, and the on-failure count rollback.
   */
  patchPost: (postId: number, fn: (post: FeedPost) => FeedPost) => void;
  /**
   * Optional — called once after a successful react/un-react with whether
   * the action was an add (true) or a removal (false). Useful for hosts
   * that want to do extra reconciliation (e.g. canonical-count refetch
   * for display-order preservation) or close a picker.
   */
  onAfterReact?: (post: FeedPost, wasAdd: boolean) => void | Promise<void>;
  /**
   * Optional — called when the react/un-react API call fails *after* the
   * hook has already attempted to roll back the optimistic state. Hosts
   * can use this to surface a user-visible error (e.g. a toast).
   */
  onError?: (error: unknown) => void;
};

export type UsePostReactionsResult = {
  reactionActionLoading: boolean;
  /**
   * Toggle the user's reaction to `post` with `emojiId`:
   *   - If the user already reacted with that exact emoji → removes it.
   *   - Otherwise → adds (or swaps from a previous emoji to this one).
   * Optimistic update is applied before the API call; on failure the
   * counts are refetched from the server to reconcile.
   */
  reactToPost: (post: FeedPost, emojiId: number) => Promise<void>;
};

export function usePostReactions(
  opts: UsePostReactionsOptions,
): UsePostReactionsResult {
  const { token, reactionGroups, patchPost, onAfterReact, onError } = opts;
  const [reactionActionLoading, setReactionActionLoading] = useState(false);

  const reactToPost = useCallback(
    async (post: FeedPost, emojiId: number) => {
      const uuid = (post as any)?.uuid as string | undefined;
      const postId = (post as any)?.id as number | undefined;
      if (!token || !uuid || typeof postId !== 'number' || !emojiId || reactionActionLoading) return;

      const current: any = post;
      const isAlreadyMine = current?.reaction?.emoji?.id === emojiId;
      const prevId: number | undefined = current?.reaction?.emoji?.id;

      // Try the post's own counts first; if this is the first time anyone
      // reacts with this emoji, the post has no entry for it, so fall back
      // to the picker's emoji library. Without this fallback the optimistic
      // update produces an empty reaction object and the UI shows nothing
      // until the next refetch.
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

      // Optimistic update.
      if (isAlreadyMine) {
        patchPost(postId, (p: any) => ({
          ...p,
          reaction: null,
          reactions_emoji_counts: (p.reactions_emoji_counts || [])
            .map((e: any) =>
              e.emoji?.id === emojiId ? { ...e, count: Math.max(0, (e.count || 1) - 1) } : e,
            )
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
            // First-time reaction with this emoji on this post — push a
            // fresh entry so the chip renders immediately.
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
          // Reconcile reaction with the canonical one from the server (so
          // it has the proper id, created timestamp, etc. for any caller
          // that compares on those). Counts stay optimistic.
          const reaction = await api.reactToPost(token, uuid, emojiId);
          patchPost(postId, (p: any) => ({ ...p, reaction }));
        }
        try {
          await onAfterReact?.(post, !isAlreadyMine);
        } catch {
          // Caller-supplied callback misbehaved — don't let it taint the
          // hook's success path.
        }
      } catch (e) {
        // Roll back the optimistic count change on failure by refetching
        // the canonical counts from the server. If that also fails, leave
        // the optimistic state — it's the best we have.
        try {
          const counts = await api.getPostReactionCounts(token, uuid);
          patchPost(postId, (p: any) => ({ ...p, reactions_emoji_counts: counts }));
        } catch {
          // give up
        }
        onError?.(e);
      } finally {
        setReactionActionLoading(false);
      }
    },
    [token, reactionActionLoading, patchPost, reactionGroups, onAfterReact, onError],
  );

  return { reactionActionLoading, reactToPost };
}
