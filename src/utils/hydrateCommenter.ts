/**
 * hydrateCommenter — fill in the author info on an optimistically-inserted
 * comment when the server's create-comment response omits it.
 *
 * Background: the Django `POST /api/posts/:uuid/comments/` endpoint can
 * return a comment with no embedded `commenter` (or one missing
 * `username` / `profile.avatar`), while `GET /comments` always expands it
 * fully. Without hydration the freshly-posted comment renders as
 * "@unknown" with the default avatar until the page reloads.
 *
 * The just-created comment is — by definition — authored by the current
 * user, so substituting the cached current-user fields is correct. Server
 * fields always win when present; we only fill in what's missing.
 */

import type { PostComment } from '../api/client';

type Commenter = NonNullable<PostComment['commenter']>;

export function hydrateCommenter(
  comment: PostComment,
  currentUser: Commenter | null | undefined,
): PostComment {
  if (!currentUser) return comment;
  const c = comment.commenter;

  // Server omitted the author embed (or returned it without a username) —
  // replace it wholesale with the current user.
  if (!c || !c.username) {
    return { ...comment, commenter: currentUser };
  }

  // Server returned an author but with no avatar — fill that in.
  if (!c.profile?.avatar && currentUser.profile?.avatar) {
    return {
      ...comment,
      commenter: {
        ...c,
        profile: { ...(c.profile || {}), avatar: currentUser.profile.avatar },
      },
    };
  }

  return comment;
}

/**
 * Reduce an authenticated-user object to the `commenter` shape used by
 * comment renders. Returns null when the user isn't loaded / signed in.
 */
export function extractCommenterFromUser(user: any): Commenter | null {
  if (!user?.username) return null;
  return {
    id: typeof user.id === 'number' ? user.id : undefined,
    username: user.username,
    profile: {
      avatar: user?.profile?.avatar,
      name: user?.profile?.name,
    },
  };
}
