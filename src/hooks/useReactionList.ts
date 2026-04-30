/**
 * useReactionList — owns the "who reacted" drawer state for a feed
 * surface. Mirrors what PostDetailScreenContainer already does inline,
 * but exposed as a hook so each native feed container (Feed, Community,
 * PublicProfile) can wire it with one call.
 *
 * Returns:
 *   - state for ReactionListDrawer (`post`, `emoji`, `users`, `loading`)
 *   - `open(post)` — kicks off the load and reveals the drawer
 *   - `selectEmoji(emoji)` — re-loads filtered to that emoji (or null = all)
 *   - `close()` — dismisses the drawer
 *
 * The `requestId` ref guards against stale responses when the user
 * filters quickly across emojis.
 */

import { useCallback, useRef, useState } from 'react';
import { api, type FeedPost } from '../api/client';

type ReactionEmoji = { id?: number; keyword?: string; image?: string };
type Reactor = {
  id?: number;
  emoji?: ReactionEmoji;
  reactor?: {
    id?: number;
    username?: string;
    profile?: { avatar?: string };
  };
};

export type UseReactionListResult = {
  /** The post the drawer is currently scoped to (null when closed). */
  post: FeedPost | null;
  /** Currently-active emoji filter (null = all reactors). */
  emoji: ReactionEmoji | null;
  users: Reactor[];
  loading: boolean;
  /** Open the drawer for a post and load all reactors. */
  open: (post: FeedPost) => void;
  /** Re-load the list filtered to a specific emoji (or null = all). */
  selectEmoji: (emoji: ReactionEmoji | null) => void;
  /** Close the drawer and reset state. */
  close: () => void;
};

export function useReactionList(token: string | null): UseReactionListResult {
  const [post, setPost] = useState<FeedPost | null>(null);
  const [emoji, setEmoji] = useState<ReactionEmoji | null>(null);
  const [users, setUsers] = useState<Reactor[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (target: FeedPost, filterEmoji: ReactionEmoji | null) => {
      const uuid = (target as any)?.uuid as string | undefined;
      if (!token || !uuid) return;
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setUsers([]);
      try {
        const result = await api.getPostReactions(token, uuid, filterEmoji?.id);
        if (requestId !== requestIdRef.current) return;
        setUsers(Array.isArray(result) ? (result as Reactor[]) : []);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setUsers([]);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [token],
  );

  const open = useCallback(
    (target: FeedPost) => {
      setPost(target);
      setEmoji(null);
      void load(target, null);
    },
    [load],
  );

  const selectEmoji = useCallback(
    (next: ReactionEmoji | null) => {
      setEmoji(next);
      if (post) void load(post, next);
    },
    [post, load],
  );

  const close = useCallback(() => {
    requestIdRef.current += 1; // invalidate any in-flight load
    setPost(null);
    setEmoji(null);
    setUsers([]);
    setLoading(false);
  }, []);

  return { post, emoji, users, loading, open, selectEmoji, close };
}
