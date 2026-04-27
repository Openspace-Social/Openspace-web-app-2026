/**
 * PostInteractionsContext — shared state + handler surface that PostCard
 * consumes.
 *
 * Rather than prop-drilling 76 state values and handlers through every feed
 * / profile / community screen, the screen provides a context value and
 * <ConnectedPostCard /> pulls it in. Two callers provide different
 * implementations:
 *
 *   1. HomeScreen (legacy / web) — wraps its JSX with a provider and passes
 *      its existing useState + handler functions. Zero refactor of its
 *      internals; the provider just exposes what was previously on props.
 *
 *   2. FeedScreenContainer (native) — provides a simpler implementation
 *      backed by useFeedData. Features that haven't migrated yet (comments,
 *      share, repost, etc.) fall back to "coming soon" toasts. Over time
 *      those stubs are swapped for real handlers.
 *
 * The value type is derived from PostCardProps minus the per-render data so
 * the two stay in sync automatically when PostCard's props evolve.
 */

import React, { createContext, useContext } from 'react';
import type { PostCardProps } from '../components/PostCard';

// Per-render props — supplied by the caller each time a PostCard is
// rendered (post, variant, pinned placement). Everything else comes from
// the context.
type PerRenderKeys =
  | 'post'
  | 'variant'
  | 'styles'
  | 'c'
  | 't'
  | 'currentUsername'
  | 'token'
  | 'translationLanguageCode'
  | 'autoPlayMedia'
  | 'isPostDetailOpen'
  | 'allowExpandControl'
  | 'showFollowButton'
  | 'pinnedPostsCount'
  | 'pinnedPostsLimit'
  | 'pinnedDisplayIndex'
  | 'pinnedDisplayLimit';

export type PostInteractionsValue = Omit<PostCardProps, PerRenderKeys>;

const PostInteractionsContext = createContext<PostInteractionsValue | null>(null);

export function PostInteractionsProvider({
  value,
  children,
}: {
  value: PostInteractionsValue;
  children: React.ReactNode;
}) {
  return (
    <PostInteractionsContext.Provider value={value}>
      {children}
    </PostInteractionsContext.Provider>
  );
}

export function usePostInteractions(): PostInteractionsValue {
  const ctx = useContext(PostInteractionsContext);
  if (!ctx) {
    throw new Error(
      'usePostInteractions must be used inside a PostInteractionsProvider. ' +
        'Wrap the rendering screen (HomeScreen on web, FeedScreenContainer on native) in <PostInteractionsProvider value={...}>.',
    );
  }
  return ctx;
}
