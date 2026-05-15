/**
 * postUpdates — a tiny module-level pub/sub for post reaction state.
 *
 * Every screen that lists posts (feed, hashtag, profile, community, …) and
 * the post-detail screen each hold their OWN copy of a post in local state —
 * there is no shared post store. So reacting to a post on one screen left
 * every other screen's copy stale (most visibly: open a post-detail from a
 * notification, react, go back — the feed card still showed no reaction).
 *
 * `usePostReactions` broadcasts a post's new reaction state here on every
 * optimistic / canonical / rollback patch, and — also via `usePostReactions`
 * — every mounted screen applies inbound updates to its own copy. State is
 * broadcast as ABSOLUTE values, so re-applying it (including on the screen
 * that originated the reaction) is idempotent.
 */

export type PostReactionPatch = {
  reaction?: any;
  reactions_emoji_counts?: any;
};

type Listener = (postId: number, patch: PostReactionPatch) => void;

const listeners = new Set<Listener>();

export function emitPostReactionUpdate(postId: number, patch: PostReactionPatch): void {
  for (const listener of listeners) {
    try {
      listener(postId, patch);
    } catch {
      // A misbehaving subscriber must not break the others or the emitter.
    }
  }
}

export function subscribePostReactionUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
