const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  process.env.REACT_APP_API_BASE_URL ||
  'http://localhost:80'
).replace(/\/+$/, '');
const MEDIA_BASE_URL = (
  process.env.EXPO_PUBLIC_MEDIA_BASE_URL ||
  process.env.REACT_APP_MEDIA_BASE_URL ||
  'https://openspace-app-bucket.s3.amazonaws.com/media'
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

function normalizeMediaUrl(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  const lowered = raw.toLowerCase();
  if (lowered === 'none' || lowered === 'null' || lowered === 'undefined') return undefined;

  const rewriteCommunityMediaPath = (pathValue: string) => {
    const normalizedPath = pathValue.replace(/^\/+/, '');
    if (normalizedPath.startsWith('communities/')) {
      return `${MEDIA_BASE_URL}/${normalizedPath}`;
    }
    return undefined;
  };

  const directCommunityPath = rewriteCommunityMediaPath(raw);
  if (directCommunityPath) return directCommunityPath;

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const parsed = new URL(raw);
      const normalizedPath = parsed.pathname.replace(/^\/+/, '');
      if (normalizedPath.startsWith('communities/')) {
        return `${MEDIA_BASE_URL}/${normalizedPath}`;
      }
    } catch {
      // keep original below
    }
    return raw;
  }
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(raw)) return `https://${raw}`;

  // If backend returns relative media paths without /media, patch into media bucket URL.
  const relativeCommunityPath = rewriteCommunityMediaPath(raw);
  if (relativeCommunityPath) return relativeCommunityPath;

  return raw.startsWith('/') ? `${API_BASE_URL}${raw}` : `${API_BASE_URL}/${raw}`;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const providedHeaders = options.headers || {};
  const isFormDataBody =
    typeof FormData !== 'undefined' && !!options.body && options.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: isFormDataBody
      ? {
          ...providedHeaders,
        }
      : {
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
  name?: string;
  location?: string;
  bio?: string;
  url?: string;
  followers_count_visible?: boolean;
  community_posts_visible?: boolean;
  visibility?: string;
};

export type UpdateAuthenticatedUserMediaPayload = {
  avatarFile?: Blob | null;
  coverFile?: Blob | null;
  removeAvatar?: boolean;
  removeCover?: boolean;
};

export type FeedType = 'home' | 'trending' | 'public' | 'explore';

export type CreatePostPayload = {
  text?: string;
  long_text?: string;
  long_text_blocks?: unknown[];
  long_text_rendered_html?: string;
  long_text_version?: number;
  image?: Blob | null;
  video?: Blob | null;
  circle_id?: number[];
  community_name?: string;
  community_names?: string[];
  is_draft?: boolean;
  draft_expiry_days?: number;
  type?: string;
};

export type UpdatePostPayload = {
  text?: string;
  long_text?: string;
  long_text_blocks?: unknown[];
  long_text_rendered_html?: string;
  long_text_version?: number;
  draft_expiry_days?: number;
  type?: string;
};

export type UpdatePostTargetsPayload = {
  circle_id?: number[];
  community_names?: string[];
};

export type AddPostMediaPayload = {
  file: Blob;
  order?: number;
};

export type FeedPost = {
  id: number;
  uuid?: string;
  text?: string;
  long_text?: string;
  long_text_blocks?: unknown[];
  long_text_rendered_html?: string;
  long_text_version?: number;
  type?: string;
  created?: string;
  draft_expires_at?: string;
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
  shared_communities_count?: number;
  shared_community_names?: string[];
  media_thumbnail?: string;
  media?: Array<{
    id?: number;
    type?: string;
    order?: number;
    image?: string;
    thumbnail?: string;
    file?: string;
    width?: number;
    height?: number;
    duration?: number;
  }>;
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

export type FollowingUserResult = {
  id: number;
  username?: string;
  profile?: {
    id?: number;
    avatar?: string;
    name?: string;
    badges?: Array<{ keyword?: string; keyword_description?: string }>;
  };
  is_following?: boolean;
  is_connected?: boolean;
};

export type SearchCommunityResult = {
  id: number;
  name?: string;
  title?: string;
  avatar?: string;
  cover?: string;
  members_count?: number;
  color?: string;
  memberships?: Array<{
    id?: number;
    user_id?: number;
    community_id?: number;
    is_administrator?: boolean;
    is_moderator?: boolean;
  }>;
};

export type CircleResult = {
  id: number;
  name?: string;
  color?: string;
  users_count?: number;
};

type UserCommunityMembershipResult = {
  community_id?: number;
  community_name?: string;
  community_title?: string;
  community_avatar?: string;
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
  if (typeof asObj.id === 'number') return normalizePostPayload(asObj as FeedPost);
  if (asObj.post && typeof asObj.post === 'object') return normalizePostPayload(asObj.post as FeedPost);
  return null;
}

function normalizeLongPostBlocks(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizePostPayload(post: FeedPost): FeedPost {
  const normalizedMedia = Array.isArray(post.media)
    ? post.media.map((item) => ({
        ...item,
        image: normalizeMediaUrl(item?.image),
        thumbnail: normalizeMediaUrl(item?.thumbnail),
        file: normalizeMediaUrl(item?.file),
      }))
    : undefined;

  return {
    ...post,
    long_text_blocks: normalizeLongPostBlocks(post.long_text_blocks),
    shared_communities_count:
      typeof post.shared_communities_count === 'number' ? post.shared_communities_count : undefined,
    shared_community_names: Array.isArray(post.shared_community_names)
      ? post.shared_community_names.filter((name): name is string => typeof name === 'string' && !!name.trim())
      : undefined,
    media_thumbnail: normalizeMediaUrl(post.media_thumbnail),
    media: normalizedMedia,
  };
}

function normalizeFeedResponse(feed: FeedType, payload: unknown): FeedPost[] {
  if (!Array.isArray(payload)) return [];

  if (feed === 'home') {
    return (payload as FeedPost[]).map((post) => normalizePostPayload(post));
  }

  return payload
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const wrapped = row as Record<string, unknown>;
      const post = wrapped.post;
      if (!post || typeof post !== 'object') return null;
      return normalizePostPayload(post as FeedPost);
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

  getUserByUsername: async (token: string, username: string) => {
    const encoded = encodeURIComponent(username);
    try {
      return await request(`/api/auth/users/${encoded}/`, {
        headers: { Authorization: `Token ${token}` },
      });
    } catch {
      const matches = await request<SearchUserResult[]>(`/api/auth/users/?query=${encoded}&count=20`, {
        headers: { Authorization: `Token ${token}` },
      });
      const exact = matches.find(
        (candidate) => (candidate.username || '').toLowerCase() === username.toLowerCase()
      );
      if (exact) return exact;
      throw new Error('User not found');
    }
  },

  updateAuthenticatedUser: (token: string, payload: UpdateAuthenticatedUserPayload) =>
    request('/api/auth/user/', {
      method: 'PATCH',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify(payload),
    }),

  updateAuthenticatedUserWithMedia: (
    token: string,
    payload: UpdateAuthenticatedUserPayload = {},
    media: UpdateAuthenticatedUserMediaPayload = {}
  ) => {
    const form = new FormData();

    Object.entries(payload).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (typeof value === 'boolean') {
        form.append(key, value ? 'true' : 'false');
        return;
      }
      form.append(key, String(value));
    });

    if (media.avatarFile) {
      const avatarFile = media.avatarFile as Blob & { name?: string };
      form.append('avatar', avatarFile, avatarFile.name || 'avatar.jpg');
    } else if (media.removeAvatar) {
      form.append('avatar', '');
    }

    if (media.coverFile) {
      const coverFile = media.coverFile as Blob & { name?: string };
      form.append('cover', coverFile, coverFile.name || 'cover.jpg');
    } else if (media.removeCover) {
      form.append('cover', '');
    }

    return request('/api/auth/user/', {
      method: 'PATCH',
      headers: { Authorization: `Token ${token}` },
      body: form,
    });
  },

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

  getFeed: (token: string, feed: FeedType, count = 20, maxId?: number) => {
    const maxIdParam = typeof maxId === 'number' ? `&max_id=${maxId}` : '';
    const path = feed === 'home'
      ? `/api/posts/?count=${count}${maxIdParam}`
      : feed === 'trending'
        ? `/api/posts/trending/new/?count=${count}${maxIdParam}`
        : feed === 'public'
          ? `/api/posts/top/?count=${count}${maxIdParam}`
          : `/api/posts/top/?count=${count}&exclude_joined_communities=true${maxIdParam}`;

    return request<unknown>(path, {
      headers: { Authorization: `Token ${token}` },
    }).then((payload) => normalizeFeedResponse(feed, payload));
  },

  createPost: (token: string, payload: CreatePostPayload) => {
    const form = new FormData();

    if (typeof payload.text === 'string') {
      form.append('text', payload.text);
    }

    if (typeof payload.long_text === 'string') {
      form.append('long_text', payload.long_text);
    }
    if (Array.isArray(payload.long_text_blocks)) {
      form.append('long_text_blocks', JSON.stringify(payload.long_text_blocks));
    }
    if (typeof payload.long_text_rendered_html === 'string') {
      form.append('long_text_rendered_html', payload.long_text_rendered_html);
    }
    if (typeof payload.long_text_version === 'number' && Number.isFinite(payload.long_text_version)) {
      form.append('long_text_version', String(payload.long_text_version));
    }

    if (typeof payload.type === 'string' && payload.type.trim()) {
      form.append('type', payload.type);
    }

    if (typeof payload.is_draft === 'boolean') {
      form.append('is_draft', payload.is_draft ? 'true' : 'false');
    }
    if (typeof payload.draft_expiry_days === 'number' && Number.isFinite(payload.draft_expiry_days)) {
      form.append('draft_expiry_days', String(payload.draft_expiry_days));
    }

    if (Array.isArray(payload.circle_id)) {
      payload.circle_id.forEach((id) => {
        form.append('circle_id', String(id));
      });
    }
    if (typeof payload.community_name === 'string' && payload.community_name.trim()) {
      form.append('community_name', payload.community_name.trim());
    }
    if (Array.isArray(payload.community_names)) {
      payload.community_names
        .map((name) => name?.trim())
        .filter((name): name is string => !!name)
        .forEach((name) => {
          form.append('community_names', name);
        });
    }

    if (payload.image) {
      const imageFile = payload.image as Blob & { name?: string };
      form.append('image', imageFile, imageFile.name || 'post-image.jpg');
    }

    if (payload.video) {
      const videoFile = payload.video as Blob & { name?: string };
      form.append('video', videoFile, videoFile.name || 'post-video.mp4');
    }

    return request<FeedPost>('/api/posts/', {
      method: 'PUT',
      headers: { Authorization: `Token ${token}` },
      body: form,
    }).then((post) => normalizePostPayload(post));
  },

  createCommunityPost: (
    token: string,
    communityName: string,
    payload: Omit<CreatePostPayload, 'circle_id' | 'community_name'>
  ) => {
    const form = new FormData();

    if (typeof payload.text === 'string') {
      form.append('text', payload.text);
    }

    if (typeof payload.long_text === 'string') {
      form.append('long_text', payload.long_text);
    }
    if (Array.isArray(payload.long_text_blocks)) {
      form.append('long_text_blocks', JSON.stringify(payload.long_text_blocks));
    }
    if (typeof payload.long_text_rendered_html === 'string') {
      form.append('long_text_rendered_html', payload.long_text_rendered_html);
    }
    if (typeof payload.long_text_version === 'number' && Number.isFinite(payload.long_text_version)) {
      form.append('long_text_version', String(payload.long_text_version));
    }

    if (typeof payload.type === 'string' && payload.type.trim()) {
      form.append('type', payload.type);
    }

    if (typeof payload.is_draft === 'boolean') {
      form.append('is_draft', payload.is_draft ? 'true' : 'false');
    }
    if (typeof payload.draft_expiry_days === 'number' && Number.isFinite(payload.draft_expiry_days)) {
      form.append('draft_expiry_days', String(payload.draft_expiry_days));
    }

    if (payload.image) {
      const imageFile = payload.image as Blob & { name?: string };
      form.append('image', imageFile, imageFile.name || 'post-image.jpg');
    }

    if (payload.video) {
      const videoFile = payload.video as Blob & { name?: string };
      form.append('video', videoFile, videoFile.name || 'post-video.mp4');
    }

    return request<FeedPost>(`/api/communities/${encodeURIComponent(communityName)}/posts/`, {
      method: 'PUT',
      headers: { Authorization: `Token ${token}` },
      body: form,
    }).then((post) => normalizePostPayload(post));
  },

  addPostMedia: (token: string, postUuid: string, payload: AddPostMediaPayload) => {
    const form = new FormData();
    const mediaFile = payload.file as Blob & { name?: string };
    form.append('file', mediaFile, mediaFile.name || 'post-media');
    if (typeof payload.order === 'number' && Number.isFinite(payload.order)) {
      form.append('order', String(payload.order));
    }

    return request<{ message?: string }>(`/api/posts/${postUuid}/media/`, {
      method: 'PUT',
      headers: { Authorization: `Token ${token}` },
      body: form,
    });
  },

  publishPost: (token: string, postUuid: string) =>
    request<FeedPost>(`/api/posts/${postUuid}/publish/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    }).then((post) => normalizePostPayload(post)),

  getDraftPosts: (token: string, count = 20, maxId?: number) => {
    const params = new URLSearchParams();
    params.set('count', String(Math.min(Math.max(count, 1), 20)));
    if (typeof maxId === 'number' && Number.isFinite(maxId)) {
      params.set('max_id', String(maxId));
    }
    return request<FeedPost[]>(`/api/posts/drafts/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    }).then((posts) => posts.map((post) => normalizePostPayload(post)));
  },

  getUserPosts: (token: string, username: string, count = 10) =>
    request<FeedPost[]>(`/api/posts/?username=${encodeURIComponent(username)}&count=${count}`, {
      headers: { Authorization: `Token ${token}` },
    }).then((posts) => posts.map((post) => normalizePostPayload(post))),

  getPinnedPosts: (token: string, username?: string, count = 10) => {
    const params = new URLSearchParams();
    params.set('count', String(count));
    if (username) params.set('username', username);
    return request<FeedPost[]>(`/api/posts/profile/pinned/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    }).then((posts) => posts.map((post) => normalizePostPayload(post)));
  },

  getCommunityPosts: (token: string, communityName: string, count = 20) =>
    request<FeedPost[]>(`/api/communities/${encodeURIComponent(communityName)}/posts/?count=${count}`, {
      headers: { Authorization: `Token ${token}` },
    }).then((posts) => posts.map((post) => normalizePostPayload(post))),

  getPostById: (token: string, postId: number) =>
    request<unknown>(`/api/posts/${postId}/`, {
      headers: { Authorization: `Token ${token}` },
    }).then((payload) => {
      const normalized = normalizeMaybeWrappedPost(payload);
      if (!normalized) throw new Error('Post not found');
      return normalizePostPayload(normalized);
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

  removeReactionFromPost: (token: string, postUuid: string) =>
    request<void>(`/api/posts/${postUuid}/reactions/`, {
      method: 'DELETE',
      headers: { Authorization: `Token ${token}` },
    }),

  pinPost: (token: string, postUuid: string) =>
    request<FeedPost>(`/api/posts/${postUuid}/pin/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    }).then((post) => normalizePostPayload(post)),

  unpinPost: (token: string, postUuid: string) =>
    request<FeedPost>(`/api/posts/${postUuid}/unpin/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    }).then((post) => normalizePostPayload(post)),

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
    }).then((post) => normalizePostPayload(post)),

  updatePostContent: (token: string, postUuid: string, payload: UpdatePostPayload) => {
    const form = new FormData();
    if (typeof payload.text === 'string') {
      form.append('text', payload.text);
    }
    if (typeof payload.long_text === 'string') {
      form.append('long_text', payload.long_text);
    }
    if (Array.isArray(payload.long_text_blocks)) {
      form.append('long_text_blocks', JSON.stringify(payload.long_text_blocks));
    }
    if (typeof payload.long_text_rendered_html === 'string') {
      form.append('long_text_rendered_html', payload.long_text_rendered_html);
    }
    if (typeof payload.long_text_version === 'number' && Number.isFinite(payload.long_text_version)) {
      form.append('long_text_version', String(payload.long_text_version));
    }
    if (typeof payload.draft_expiry_days === 'number' && Number.isFinite(payload.draft_expiry_days)) {
      form.append('draft_expiry_days', String(payload.draft_expiry_days));
    }
    if (typeof payload.type === 'string' && payload.type.trim()) {
      form.append('type', payload.type);
    }
    return request<FeedPost>(`/api/posts/${postUuid}/`, {
      method: 'PATCH',
      headers: { Authorization: `Token ${token}` },
      body: form,
    }).then((post) => normalizePostPayload(post));
  },

  updatePostTargets: (token: string, postUuid: string, payload: UpdatePostTargetsPayload) => {
    const body = {
      ...(Array.isArray(payload.circle_id) ? { circle_id: payload.circle_id } : {}),
      ...(Array.isArray(payload.community_names)
        ? {
          community_names: payload.community_names
            .map((name) => name?.trim())
            .filter((name): name is string => !!name),
        }
        : {}),
    };
    return request<FeedPost>(`/api/posts/${postUuid}/targets/`, {
      method: 'PATCH',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify(body),
    }).then((post) => normalizePostPayload(post));
  },

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

  getFollowings: (token: string, count = 20, maxId?: number, username?: string) => {
    const params = new URLSearchParams();
    params.set('count', String(Math.min(Math.max(count, 1), 20)));
    if (typeof maxId === 'number' && Number.isFinite(maxId)) {
      params.set('max_id', String(maxId));
    }
    const path = username
      ? `/api/auth/users/${encodeURIComponent(username)}/followings/?${params.toString()}`
      : `/api/auth/followings/?${params.toString()}`;
    return request<FollowingUserResult[]>(path, {
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

  getJoinedCommunities: (token: string, count = 20, offset = 0, username?: string) => {
    const params = new URLSearchParams();
    params.set('count', String(Math.min(Math.max(count, 1), 20)));
    params.set('offset', String(Math.max(offset, 0)));
    if (username) {
      params.set('username', username);
    }
    return request<SearchCommunityResult[]>(`/api/communities/joined/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
  },

  getCircles: (token: string) =>
    request<CircleResult[]>('/api/circles/', {
      headers: { Authorization: `Token ${token}` },
    }),

  getUserCommunities: (token: string, username: string) =>
    request<Array<UserCommunityMembershipResult | SearchCommunityResult>>(`/api/communities/user_communities/${encodeURIComponent(username)}/`, {
      headers: { Authorization: `Token ${token}` },
    }).then((rows) =>
      (Array.isArray(rows) ? rows : []).map((row) => {
        if (typeof (row as SearchCommunityResult)?.id === 'number' && (row as SearchCommunityResult)?.name !== undefined) {
          const normalized = row as SearchCommunityResult;
          return {
            ...normalized,
            avatar: normalizeMediaUrl(normalized.avatar),
          };
        }

        const legacy = row as UserCommunityMembershipResult;
        return {
          id: legacy.community_id || 0,
          name: legacy.community_name,
          title: legacy.community_title,
          avatar: normalizeMediaUrl(legacy.community_avatar),
        } as SearchCommunityResult;
      })
    ),

  searchHashtags: (token: string, query: string, count = 10) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('count', String(count));
    return request<SearchHashtagResult[]>(`/api/hashtags/search/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
  },
};
