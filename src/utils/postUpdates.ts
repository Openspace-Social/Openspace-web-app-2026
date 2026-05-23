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

// ── Post-content updates ────────────────────────────────────────────────
// Parallel emitter for non-reaction post mutations — currently used by the
// dedicated EditPost screen so an edit applied on one screen propagates to
// every other mounted copy of that post (feed cards, profile lists,
// post-detail). Kept absolute-state and idempotent for the same reason
// reaction patches are.
export type PostContentPatch = {
  text?: string;
  long_text?: any;
  long_text_blocks?: any;
  long_text_rendered_html?: string;
};

type ContentListener = (postId: number, patch: PostContentPatch) => void;

const contentListeners = new Set<ContentListener>();

export function emitPostContentUpdate(postId: number, patch: PostContentPatch): void {
  for (const listener of contentListeners) {
    try {
      listener(postId, patch);
    } catch {
      // A misbehaving subscriber must not break the others or the emitter.
    }
  }
}

export function subscribePostContentUpdate(listener: ContentListener): () => void {
  contentListeners.add(listener);
  return () => {
    contentListeners.delete(listener);
  };
}

// ── Post comment-count updates ──────────────────────────────────────────
// Comment add/delete from the post-detail screen needs to propagate the
// comments_count back to every other mounted copy of the post (feed
// cards, profile lists, etc.) — same problem reactions solve, different
// state. Web only needs this because of a single shared post store
// (HomeScreen calls applyPostPatch directly); native screens hold
// independent copies, so we route through the pub/sub.
//
// Delta-based rather than absolute, because the emitter (useCommentsData)
// doesn't know each subscriber's current comments_count value. Subscribers
// clamp the resulting value to ≥0 so a stale subscriber doesn't end up
// with a negative count if events arrive out of order.
//
// Top-level comments only. Replies don't affect post.comments_count —
// they affect comment.replies_count, which only appears inside the
// post-detail view where local state already updates it.
export type PostCommentCountPatch = {
  delta: number;
};

type CommentCountListener = (postId: number, patch: PostCommentCountPatch) => void;

const commentCountListeners = new Set<CommentCountListener>();

export function emitPostCommentCountUpdate(postId: number, patch: PostCommentCountPatch): void {
  for (const listener of commentCountListeners) {
    try {
      listener(postId, patch);
    } catch {
      // A misbehaving subscriber must not break the others or the emitter.
    }
  }
}

export function subscribePostCommentCountUpdate(listener: CommentCountListener): () => void {
  commentCountListeners.add(listener);
  return () => {
    commentCountListeners.delete(listener);
  };
}
