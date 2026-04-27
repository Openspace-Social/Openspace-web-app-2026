/**
 * ConnectedPostCard — thin adapter that reads PostInteractionsContext and
 * renders the real <PostCard /> with its handler + state surface filled in.
 *
 * Callers only need to supply per-render data: which post, which variant,
 * pinned placement, and the handful of presentational flags. Everything
 * else comes from the context provider (HomeScreen on web,
 * FeedScreenContainer on native).
 */

import React from 'react';
import PostCard, { type PostCardProps } from './PostCard';
import { usePostInteractions } from '../contexts/PostInteractionsContext';

type PerRenderProps = Pick<
  PostCardProps,
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
  | 'pinnedDisplayLimit'
>;

export default function ConnectedPostCard(props: PerRenderProps) {
  const interactions = usePostInteractions();
  return <PostCard {...interactions} {...props} />;
}
