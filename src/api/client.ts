const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  process.env.REACT_APP_API_BASE_URL ||
  'http://localhost:80'
).replace(/\/+$/, '');

export class ApiRequestError extends Error {
  status: number;
  data: unknown;
  code?: string;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.data = data;
    if (data && typeof data === 'object') {
      const maybeCode = (data as Record<string, unknown>).code;
      if (typeof maybeCode === 'string' && maybeCode.trim()) {
        this.code = maybeCode;
      }
    }
  }
}

function extractErrorMessage(data: unknown): string {
  if (!data) return 'Request failed';
  if (typeof data === 'string') return data;

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const direct = obj.detail || obj.message;
    if (typeof direct === 'string' && direct.trim()) return direct;

    for (const value of Object.values(obj)) {
      if (typeof value === 'string' && value.trim()) return value;
      if (Array.isArray(value)) {
        const first = value.find((item) => typeof item === 'string' && item.trim());
        if (typeof first === 'string') return first;
      }
    }
  }

  return 'Request failed';
}

function extractSuccessMessage(data: unknown): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.detail === 'string') return obj.detail;
  }
  return '';
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const providedHeaders = options.headers || {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...providedHeaders,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new ApiRequestError(extractErrorMessage(data), response.status, data);
  }

  return data as T;
}

export type AuthToken = { token: string };
export type SocialProvider = 'google' | 'apple';
export type SocialIdentity = {
  provider: SocialProvider;
  email: string | null;
  created: string;
  updated: string;
};
export type RegisterPayload = {
  email: string;
  password: string;
  username: string;
  name?: string;
  token?: string;
  is_of_legal_age?: boolean;
  are_guidelines_accepted?: boolean;
};

export type UpdateAuthenticatedUserPayload = {
  username?: string;
};

export type FeedType = 'home' | 'trending' | 'public' | 'explore';

export type FeedPost = {
  id: number;
  uuid?: string;
  text?: string;
  created?: string;
  is_pinned?: boolean;
  pinned_at?: string;
  comments_count?: number;
  reactions_emoji_counts?: Array<{
    count?: number;
    emoji?: {
      id?: number;
      keyword?: string;
      image?: string;
    };
  }>;
  reaction?: {
    id?: number;
    emoji?: {
      id?: number;
      keyword?: string;
      image?: string;
    };
  };
  creator?: {
    username?: string;
    name?: string;
    avatar?: string;
    profile?: {
      avatar?: string;
    };
    is_following?: boolean;
  };
  community?: {
    name?: string;
    title?: string;
  };
  media_thumbnail?: string;
  links?: Array<{ url?: string; title?: string; image?: string }>;
};

export type PostComment = {
  id: number;
  text?: string;
  created?: string;
  commenter?: {
    id?: number;
    username?: string;
    profile?: {
      avatar?: string;
      name?: string;
    };
  };
  replies_count?: number;
  reaction?: {
    id?: number;
    emoji?: {
      id?: number;
      keyword?: string;
      image?: string;
    };
  };
  reactions_emoji_counts?: Array<{
    count?: number;
    emoji?: {
      id?: number;
      keyword?: string;
      image?: string;
    };
  }>;
  parent_comment?: {
    id?: number;
    language?: {
      code?: string;
    };
  };
};

export type ModerationCategory = {
  id: number;
  name: string;
  title: string;
  severity?: string;
  description?: string;
};

export type SearchUserResult = {
  id: number;
  username?: string;
  profile?: {
    id?: number;
    avatar?: string;
    name?: string;
  };
  is_following?: boolean;
  is_connected?: boolean;
  visibility?: string;
};

export type SearchCommunityResult = {
  id: number;
  name?: string;
  title?: string;
  avatar?: string;
  cover?: string;
  members_count?: number;
  color?: string;
};

export type SearchHashtagResult = {
  id: number;
  name?: string;
  image?: string;
  posts_count?: number;
  emoji?: {
    id?: number;
    keyword?: string;
    image?: string;
  };
};

function normalizeMaybeWrappedPost(payload: unknown): FeedPost | null {
  if (!payload || typeof payload !== 'object') return null;
  const asObj = payload as Record<string, unknown>;
  if (typeof asObj.id === 'number') return asObj as FeedPost;
  if (asObj.post && typeof asObj.post === 'object') return asObj.post as FeedPost;
  return null;
}

function normalizeFeedResponse(feed: FeedType, payload: unknown): FeedPost[] {
  if (!Array.isArray(payload)) return [];

  if (feed === 'home') {
    return payload as FeedPost[];
  }

  return payload
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const wrapped = row as Record<string, unknown>;
      const post = wrapped.post;
      if (!post || typeof post !== 'object') return null;
      return post as FeedPost;
    })
    .filter((post): post is FeedPost => !!post);
}

export const api = {
  register: (payload: RegisterPayload) =>
    request<AuthToken & { username: string }>('/api/auth/register/', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (username: string, password: string) =>
    request<AuthToken>('/api/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getAuthenticatedUser: (token: string) =>
    request('/api/auth/user/', {
      headers: { Authorization: `Token ${token}` },
    }),

  updateAuthenticatedUser: (token: string, payload: UpdateAuthenticatedUserPayload) =>
    request('/api/auth/user/', {
      method: 'PATCH',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify(payload),
    }),

  requestEmailVerificationToken: (token: string) =>
    request<string>('/api/auth/user/email/request/token/', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    }),

  verifyEmailVerificationToken: (token: string, codeOrToken: string) =>
    request<string>('/api/auth/user/email/verify/token/', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ token: codeOrToken }),
    }),

  requestPasswordReset: (email: string) =>
    request<unknown>('/api/auth/password/reset/', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }).then(extractSuccessMessage),

  requestAccountRecovery: (identifier: string) =>
    request<unknown>('/api/auth/account/recovery/', {
      method: 'POST',
      body: JSON.stringify({ identifier }),
    }).then(extractSuccessMessage),

  verifyPasswordReset: (token: string, newPassword: string) =>
    request<unknown>('/api/auth/password/verify/', {
      method: 'POST',
      body: JSON.stringify({ token, new_password: newPassword }),
    }).then(extractSuccessMessage),

  socialAuthGoogle: (idToken: string) =>
    request<AuthToken & { username: string; is_new_user: boolean }>('/api/auth/social/google/', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
    }),

  socialAuthApple: (idToken: string, allowCreate = false) =>
    request<AuthToken & { username: string; is_new_user: boolean }>('/api/auth/social/apple/', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken, allow_create: allowCreate }),
    }),

  requestAppleSocialLinkCode: (idToken: string, username: string) =>
    request<unknown>('/api/auth/social/apple/link/request/', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken, username }),
    }).then(extractSuccessMessage),

  confirmAppleSocialLink: (idToken: string, username: string, code: string) =>
    request<AuthToken & { username: string; is_new_user: boolean }>('/api/auth/social/apple/link/confirm/', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken, username, code }),
    }),

  getLinkedSocialIdentities: (token: string) =>
    request<SocialIdentity[]>('/api/auth/user/social-identities/', {
      headers: { Authorization: `Token ${token}` },
    }),

  linkSocialIdentity: (token: string, provider: SocialProvider, idToken: string) =>
    request<unknown>('/api/auth/user/social-identities/', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ provider, id_token: idToken }),
    }).then(extractSuccessMessage),

  unlinkSocialIdentity: (token: string, provider: SocialProvider) =>
    request<unknown>('/api/auth/user/social-identities/', {
      method: 'DELETE',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ provider }),
    }).then(extractSuccessMessage),

  getFeed: (token: string, feed: FeedType, count = 20) => {
    const path = feed === 'home'
      ? `/api/posts/?count=${count}`
      : feed === 'trending'
        ? `/api/posts/trending/new/?count=${count}`
        : feed === 'public'
          ? `/api/posts/top/?count=${count}`
          : `/api/posts/top/?count=${count}&exclude_joined_communities=true`;

    return request<unknown>(path, {
      headers: { Authorization: `Token ${token}` },
    }).then((payload) => normalizeFeedResponse(feed, payload));
  },

  getUserPosts: (token: string, username: string, count = 10) =>
    request<FeedPost[]>(`/api/posts/?username=${encodeURIComponent(username)}&count=${count}`, {
      headers: { Authorization: `Token ${token}` },
    }),

  getPinnedPosts: (token: string, username?: string, count = 10) => {
    const params = new URLSearchParams();
    params.set('count', String(count));
    if (username) params.set('username', username);
    return request<FeedPost[]>(`/api/posts/profile/pinned/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
  },

  getPostById: (token: string, postId: number) =>
    request<unknown>(`/api/posts/${postId}/`, {
      headers: { Authorization: `Token ${token}` },
    }).then((payload) => {
      const normalized = normalizeMaybeWrappedPost(payload);
      if (!normalized) throw new Error('Post not found');
      return normalized;
    }),

  getPostComments: (token: string, postUuid: string, countMax = 20) => {
    const params = new URLSearchParams();
    params.set('count_max', String(countMax));
    params.set('sort', 'DESC');
    return request<PostComment[]>(`/api/posts/${postUuid}/comments/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
  },

  createPostComment: (token: string, postUuid: string, text: string) =>
    request<PostComment>(`/api/posts/${postUuid}/comments/`, {
      method: 'PUT',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ text }),
    }),

  updatePostComment: (token: string, postUuid: string, postCommentId: number, text: string) =>
    request<PostComment>(`/api/posts/${postUuid}/comments/${postCommentId}/`, {
      method: 'PATCH',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ text }),
    }),

  deletePostComment: (token: string, postUuid: string, postCommentId: number) =>
    request<{ message?: string }>(`/api/posts/${postUuid}/comments/${postCommentId}/`, {
      method: 'DELETE',
      headers: { Authorization: `Token ${token}` },
    }),

  getPostCommentReactionCounts: (token: string, postUuid: string, postCommentId: number) =>
    request<Array<{
      count?: number;
      emoji?: { id?: number; keyword?: string; image?: string };
    }>>(`/api/posts/${postUuid}/comments/${postCommentId}/reactions/emoji-count/`, {
      headers: { Authorization: `Token ${token}` },
    }),

  reactToPostComment: (token: string, postUuid: string, postCommentId: number, emojiId: number) =>
    request<{
      id?: number;
      created?: string;
      emoji?: { id?: number; keyword?: string; image?: string };
      reactor?: { id?: number; username?: string; profile?: { avatar?: string } };
    }>(`/api/posts/${postUuid}/comments/${postCommentId}/reactions/`, {
      method: 'PUT',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ emoji_id: emojiId }),
    }),

  getPostCommentReplies: (token: string, postUuid: string, postCommentId: number, countMax = 20) => {
    const params = new URLSearchParams();
    params.set('count_max', String(countMax));
    params.set('sort', 'DESC');
    return request<PostComment[]>(`/api/posts/${postUuid}/comments/${postCommentId}/replies/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
  },

  createPostCommentReply: (token: string, postUuid: string, postCommentId: number, text: string) =>
    request<PostComment>(`/api/posts/${postUuid}/comments/${postCommentId}/replies/`, {
      method: 'PUT',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ text }),
    }),

  getPostReactionEmojiGroups: (token: string) =>
    request<Array<{
      id: number;
      keyword?: string;
      color?: string;
      order?: number;
      emojis?: Array<{ id: number; keyword?: string; image?: string }>;
    }>>('/api/posts/emojis/groups/', {
      headers: { Authorization: `Token ${token}` },
    }),

  getPostReactionCounts: (token: string, postUuid: string) =>
    request<Array<{
      count?: number;
      emoji?: { id?: number; keyword?: string; image?: string };
    }>>(`/api/posts/${postUuid}/reactions/emoji-count/`, {
      headers: { Authorization: `Token ${token}` },
    }),

  getPostReactions: (token: string, postUuid: string, emojiId?: number, count = 20) => {
    const query = new URLSearchParams();
    query.set('count', String(count));
    if (typeof emojiId === 'number') query.set('emoji_id', String(emojiId));
    return request<Array<{
      id?: number;
      created?: string;
      emoji?: { id?: number; keyword?: string; image?: string };
      reactor?: { id?: number; username?: string; profile?: { avatar?: string } };
    }>>(`/api/posts/${postUuid}/reactions/?${query.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
  },

  reactToPost: (token: string, postUuid: string, emojiId: number) =>
    request<{
      id?: number;
      created?: string;
      emoji?: { id?: number; keyword?: string; image?: string };
      reactor?: { id?: number; username?: string; profile?: { avatar?: string } };
    }>(`/api/posts/${postUuid}/reactions/`, {
      method: 'PUT',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ emoji_id: emojiId }),
    }),

  pinPost: (token: string, postUuid: string) =>
    request<FeedPost>(`/api/posts/${postUuid}/pin/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    }),

  unpinPost: (token: string, postUuid: string) =>
    request<FeedPost>(`/api/posts/${postUuid}/unpin/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    }),

  getModerationCategories: (token: string) =>
    request<ModerationCategory[]>('/api/moderation/categories/', {
      headers: { Authorization: `Token ${token}` },
    }),

  reportPost: (token: string, postUuid: string, categoryId: number, description?: string) =>
    request<unknown>(`/api/posts/${postUuid}/report/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({
        category_id: categoryId,
        ...(description ? { description } : {}),
      }),
    }).then(extractSuccessMessage),

  updatePost: (token: string, postUuid: string, text: string) =>
    request<FeedPost>(`/api/posts/${postUuid}/`, {
      method: 'PATCH',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ text }).toString(),
    }),

  deletePost: (token: string, postUuid: string) =>
    request<unknown>(`/api/posts/${postUuid}/`, {
      method: 'DELETE',
      headers: { Authorization: `Token ${token}` },
    }),

  followUser: (token: string, username: string) =>
    request<unknown>('/api/follows/follow/', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ username }),
    }),

  unfollowUser: (token: string, username: string) =>
    request<unknown>('/api/follows/unfollow/', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ username }),
    }),

  searchUsers: (token: string, query: string, count = 10) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('count', String(count));
    return request<SearchUserResult[]>(`/api/auth/users/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
  },

  searchCommunities: (token: string, query: string, count = 10) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('count', String(count));
    return request<SearchCommunityResult[]>(`/api/communities/search/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
  },

  searchHashtags: (token: string, query: string, count = 10) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('count', String(count));
    return request<SearchHashtagResult[]>(`/api/hashtags/search/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
  },
};
