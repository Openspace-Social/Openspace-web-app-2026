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

  const rewriteMediaPath = (pathValue: string) => {
    const normalizedPath = pathValue.replace(/^\/+/, '');
    if (normalizedPath.startsWith('communities/') || normalizedPath.startsWith('users/')) {
      return `${MEDIA_BASE_URL}/${normalizedPath}`;
    }
    return undefined;
  };

  const directMediaPath = rewriteMediaPath(raw);
  if (directMediaPath) return directMediaPath;

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
  const relativeMediaPath = rewriteMediaPath(raw);
  if (relativeMediaPath) return relativeMediaPath;

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

export type PostMediaItem = {
  id?: number;
  type?: string;
  order?: number;
  content_object?: {
    image?: string;
    thumbnail?: string;
    file?: string;
    width?: number;
    height?: number;
    duration?: number;
    format_set?: Array<{
      id?: number;
      file?: string;
      format?: string;
      width?: number;
      height?: number;
      duration?: number;
      progress?: number;
    }>;
  };
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
  links?: Array<{ url?: string; title?: string; image?: string; description?: string; site_name?: string }>;
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

export type DirectInviteEmailResponse = {
  status?: 'sent' | 'already_registered';
  message?: string;
  invite?: {
    id?: number;
    email?: string;
    code?: string;
    created?: string;
  };
};

export type UserProfile = {
  id: number;
  username?: string;
  profile?: {
    name?: string;
    avatar?: string;
    cover?: string;
    bio?: string;
    location?: string;
    url?: string;
    badges?: Array<{ keyword?: string; keyword_description?: string }>;
  };
  followers_count?: number | null; // null = private
  following_count?: number;
  posts_count?: number;
  is_following?: boolean;
  is_followed?: boolean;
  date_joined?: string;
  visibility?: string;
};

export type CommunityOwner = {
  community_id?: number;
  community_name?: string;
  community_title?: string;
  creator_id?: number;
  username?: string;
  user_name?: string;
  user_avatar?: string;
};

export type CommunityMember = {
  id?: number;
  username?: string;
  is_following?: boolean;
  profile?: {
    avatar?: string;
    name?: string;
    badges?: Array<{ keyword?: string; keyword_description?: string }>;
  };
};

// ─── Notification types ───────────────────────────────────────────────────────

export type NotificationType =
  | 'PR'   // post reaction
  | 'PC'   // post comment
  | 'PCR'  // post comment reply
  | 'PCRA' // post comment reaction
  | 'CR'   // connection request
  | 'CC'   // connection confirmed
  | 'F'    // follow
  | 'FR'   // follow request
  | 'FRA'  // follow request approved
  | 'CI'   // community invite
  | 'PUM'  // post user mention
  | 'PCUM' // post comment user mention
  | 'CNP'  // community new post
  | 'UNP'; // user new post

type NotifUser = {
  id?: number;
  username?: string;
  profile?: { name?: string; avatar?: string };
};

type NotifPost = {
  id?: number;
  uuid?: string;
  text?: string;
  creator?: NotifUser;
  created?: string;
  media_thumbnail?: string;
  community?: { id?: number; name?: string; avatar?: string; color?: string };
};

type NotifComment = {
  id?: number;
  text?: string;
  commenter?: NotifUser;
  created?: string;
  post?: NotifPost;
};

type NotifEmoji = { id?: number; keyword?: string; image?: string };

export type NotificationContentObject =
  // F
  | { follower?: NotifUser }
  // FR
  | { follow_request?: { id?: number; creator?: NotifUser } }
  // FRA
  | { follow?: { id?: number; user?: NotifUser } }
  // PR
  | { post_reaction?: { id?: number; reactor?: NotifUser; emoji?: NotifEmoji; post?: NotifPost } }
  // PC
  | { post_comment?: NotifComment }
  // PCR
  | { post_comment?: NotifComment; parent_comment?: NotifComment }
  // PCRA
  | { post_comment_reaction?: { id?: number; reactor?: NotifUser; emoji?: NotifEmoji; post_comment?: NotifComment } }
  // CR
  | { connection_requester?: NotifUser }
  // CC
  | { connection_confirmator?: NotifUser }
  // PUM / PCUM
  | { post_user_mention?: { id?: number; post?: NotifPost; user?: NotifUser } }
  | { post_comment_user_mention?: { id?: number; post_comment?: NotifComment; user?: NotifUser } }
  // CI
  | { community_invite?: { id?: number; creator?: NotifUser; community?: { id?: number; name?: string; avatar?: string; color?: string } } }
  // CNP / UNP
  | { post?: NotifPost };

export type AppNotification = {
  id: number;
  notification_type: NotificationType;
  read: boolean;
  created?: string;
  content_object?: NotificationContentObject;
};

// ─────────────────────────────────────────────────────────────────────────────

export type SearchCommunityResult = {
  id: number;
  name?: string;
  title?: string;
  avatar?: string;
  cover?: string;
  members_count?: number;
  posts_count?: number;
  color?: string;
  description?: string;
  rules?: string;
  type?: string; // 'P' = public, 'T' = private
  is_creator?: boolean;
  user_adjective?: string;
  users_adjective?: string;
  categories?: Array<{ id?: number; name?: string; title?: string; color?: string }>;
  administrators?: CommunityMember[];
  moderators?: CommunityMember[];
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

export type CircleDetailResult = {
  id: number;
  name?: string;
  color?: string;
  users_count?: number;
  users?: Array<{
    id?: number;
    username?: string;
    profile?: { avatar?: string; name?: string };
  }>;
};

export type ConnectionResult = {
  id: number;
  circles?: CircleResult[];
  target_user?: {
    id?: number;
    username?: string;
    profile?: { name?: string; avatar?: string };
    is_fully_connected?: boolean;
    connected_circles?: CircleResult[];
  };
};

export type ListResult = {
  id: number;
  name: string;
  emoji?: { id: number; keyword: string; image?: string };
  follows_count: number;
};

export type ListDetailResult = ListResult & {
  users: Array<{
    id: number;
    username?: string;
    profile?: { name?: string; avatar?: string };
  }>;
};

export type EmojiGroup = {
  id: number;
  keyword: string;
  color?: string;
  emojis: { id: number; keyword: string; image?: string }[];
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

function normalizeFollowingUserPayload(user: FollowingUserResult): FollowingUserResult {
  return {
    ...user,
    profile: user.profile
      ? {
        ...user.profile,
        avatar: normalizeMediaUrl(user.profile.avatar),
      }
      : user.profile,
  };
}

function normalizeFollowingUserList(payload: FollowingUserResult[]): FollowingUserResult[] {
  return (Array.isArray(payload) ? payload : []).map((user) => normalizeFollowingUserPayload(user));
}

type RemoveFollowerStrategy = 'probe' | 'post' | 'delete' | 'put' | 'fallback';
// Temporary: staging currently responds 405 for remove-follower endpoint.
// Avoid noisy method-probe errors there by going directly to the working fallback path.
let removeFollowerStrategy: RemoveFollowerStrategy = API_BASE_URL.includes('staging.openspace.social')
  ? 'fallback'
  : 'probe';

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

  getUserProfile: (token: string, username: string) =>
    request<UserProfile>(`/api/auth/users/${encodeURIComponent(username)}/`, {
      headers: { Authorization: `Token ${token}` },
    }).then((u) => ({
      ...u,
      profile: u.profile
        ? { ...u.profile, avatar: normalizeMediaUrl(u.profile.avatar) }
        : u.profile,
    })),

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
    const originalName = (mediaFile.name || 'post-media').trim();
    const lastDot = originalName.lastIndexOf('.');
    const ext = lastDot > 0 ? originalName.slice(lastDot) : '';
    const stem = (lastDot > 0 ? originalName.slice(0, lastDot) : originalName).replace(/[^\w.-]+/g, '_');
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const uploadName = `${stem || 'post-media'}-${uniqueSuffix}${ext}`;
    form.append('file', mediaFile, uploadName);
    if (typeof payload.order === 'number' && Number.isFinite(payload.order)) {
      form.append('order', String(payload.order));
    }

    return request<{ message?: string }>(`/api/posts/${postUuid}/media/`, {
      method: 'PUT',
      headers: { Authorization: `Token ${token}` },
      body: form,
    });
  },

  getPostMedia: (token: string, postUuid: string) =>
    request<PostMediaItem[]>(`/api/posts/${postUuid}/media/`, {
      headers: { Authorization: `Token ${token}` },
    }).then((items) =>
      (Array.isArray(items) ? items : []).map((item) => ({
        ...item,
        content_object: item?.content_object
          ? {
              ...item.content_object,
              image: normalizeMediaUrl(item.content_object.image),
              thumbnail: normalizeMediaUrl(item.content_object.thumbnail),
              file: normalizeMediaUrl(item.content_object.file),
              format_set: Array.isArray(item.content_object.format_set)
                ? item.content_object.format_set.map((format) => ({
                    ...format,
                    file: normalizeMediaUrl(format.file),
                  }))
                : item.content_object.format_set,
            }
          : item?.content_object,
      }))
    ),

  deletePostMedia: (token: string, postUuid: string, postMediaId: number) =>
    request<{ message?: string }>(`/api/posts/${postUuid}/media/${postMediaId}/`, {
      method: 'DELETE',
      headers: { Authorization: `Token ${token}` },
    }),

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

  getCommunity: (token: string, communityName: string) =>
    request<SearchCommunityResult>(`/api/communities/${encodeURIComponent(communityName)}/`, {
      headers: { Authorization: `Token ${token}` },
    }),

  joinCommunity: (token: string, communityName: string) =>
    request<void>(`/api/communities/${encodeURIComponent(communityName)}/members/join/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    }),

  leaveCommunity: (token: string, communityName: string) =>
    request<void>(`/api/communities/${encodeURIComponent(communityName)}/members/leave/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    }),

  getCommunityOwner: (token: string, communityName: string) =>
    request<CommunityOwner>(`/api/communities/community_owner/${encodeURIComponent(communityName)}/`, {
      headers: { Authorization: `Token ${token}` },
    }).then((owner) => ({
      ...owner,
      user_avatar: normalizeMediaUrl(owner.user_avatar),
    })),

  getCommunityMembers: (token: string, communityName: string, count = 9, maxId?: number) => {
    const params = new URLSearchParams({ count: String(count) });
    if (maxId != null) params.set('max_id', String(maxId));
    return request<CommunityMember[]>(
      `/api/communities/${encodeURIComponent(communityName)}/members/?${params.toString()}`,
      { headers: { Authorization: `Token ${token}` } }
    ).then((members) =>
      members.map((m) => ({
        ...m,
        profile: m.profile
          ? { ...m.profile, avatar: normalizeMediaUrl(m.profile.avatar) }
          : m.profile,
      }))
    );
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

  removeReactionFromPostComment: (token: string, postUuid: string, postCommentId: number) =>
    request<void>(`/api/posts/${postUuid}/comments/${postCommentId}/reactions/`, {
      method: 'DELETE',
      headers: { Authorization: `Token ${token}` },
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

  sendDirectInviteEmail: (token: string, email: string) =>
    request<DirectInviteEmailResponse>('/api/invites/send-email/', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ email }),
    }),

  removeFollower: async (token: string, username: string) => {
    const payload = JSON.stringify({ username });
    const authHeader = { Authorization: `Token ${token}` };
    const removePath = '/api/follows/remove-follower/';
    const runFallback = async () => {
      // Compatibility fallback for environments where remove-follower isn't deployed:
      // block+unblock severs follower relationship without leaving the user blocked.
      await request<void>(`/api/auth/users/${encodeURIComponent(username)}/block/`, {
        method: 'POST',
        headers: authHeader,
      });
      await request<void>(`/api/auth/users/${encodeURIComponent(username)}/unblock/`, {
        method: 'POST',
        headers: authHeader,
      });
    };
    const tryMethod = async (method: 'POST' | 'DELETE' | 'PUT') => {
      await request<void>(removePath, {
        method,
        headers: authHeader,
        body: payload,
      });
    };

    if (removeFollowerStrategy === 'post') {
      await tryMethod('POST');
      return;
    }
    if (removeFollowerStrategy === 'delete') {
      await tryMethod('DELETE');
      return;
    }
    if (removeFollowerStrategy === 'put') {
      await tryMethod('PUT');
      return;
    }
    if (removeFollowerStrategy === 'fallback') {
      await runFallback();
      return;
    }

    // Probe once per app session; then cache the strategy to avoid repeated 405s in logs.
    const candidates: Array<{ method: 'POST' | 'DELETE' | 'PUT'; strategy: RemoveFollowerStrategy }> = [
      { method: 'POST', strategy: 'post' },
      { method: 'DELETE', strategy: 'delete' },
      { method: 'PUT', strategy: 'put' },
    ];
    for (const candidate of candidates) {
      try {
        await tryMethod(candidate.method);
        removeFollowerStrategy = candidate.strategy;
        return;
      } catch (error) {
        if (!(error instanceof ApiRequestError) || (error.status !== 405 && error.status !== 404)) {
          throw error;
        }
      }
    }

    removeFollowerStrategy = 'fallback';
    await runFallback();
  },

  getFollowers: (token: string, count = 20, maxId?: number) => {
    const params = new URLSearchParams();
    params.set('count', String(Math.min(count, 20)));
    if (typeof maxId === 'number') params.set('max_id', String(maxId));
    return request<FollowingUserResult[]>(`/api/auth/followers/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    }).then((users) => normalizeFollowingUserList(users));
  },

  searchFollowers: (token: string, query: string, count = 20) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('count', String(Math.min(count, 20)));
    return request<FollowingUserResult[]>(`/api/auth/followers/search/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    }).then((users) => normalizeFollowingUserList(users));
  },

  searchFollowings: (token: string, query: string, count = 20) => {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('count', String(Math.min(count, 20)));
    return request<FollowingUserResult[]>(`/api/auth/followings/search/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    }).then((users) => normalizeFollowingUserList(users));
  },

  searchUsers: (token: string, query: string, count = 10 /* max 10 per API */) => {
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
    }).then((users) => normalizeFollowingUserList(users));
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

  // ─── Notifications ──────────────────────────────────────────────────────────

  getNotifications: async (
    token: string,
    maxId?: number,
    pageSize = 15,
    types?: NotificationType[],
  ): Promise<{ notifications: AppNotification[]; hasMore: boolean; nextMaxId: number | undefined }> => {
    const params = new URLSearchParams({ count: String(pageSize) });
    if (maxId != null) params.set('max_id', String(maxId));
    if (types?.length) params.set('types', types.join(','));
    const items = await request<AppNotification[]>(`/api/notifications/?${params.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
    const notifications = Array.isArray(items) ? items : [];
    const hasMore = notifications.length >= pageSize;
    const nextMaxId = hasMore ? notifications[notifications.length - 1]?.id - 1 : undefined;
    return { notifications, hasMore, nextMaxId };
  },

  getUnreadNotificationsCount: async (token: string): Promise<number> => {
    const data = await request<{ count: number }>('/api/notifications/unread/count/', {
      headers: { Authorization: `Token ${token}` },
    });
    return typeof data?.count === 'number' ? data.count : 0;
  },

  markNotificationsRead: (token: string, maxId?: number) => {
    // Backend uses request.data.dict() which requires form-encoded, not JSON
    const body = new URLSearchParams();
    if (maxId != null) body.set('max_id', String(maxId));
    return request<void>('/api/notifications/read/', {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
  },

  markNotificationRead: (token: string, notificationId: number) =>
    request<void>(`/api/notifications/${notificationId}/read/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    }),

  deleteNotification: (token: string, notificationId: number) =>
    request<void>(`/api/notifications/${notificationId}/`, {
      method: 'DELETE',
      headers: { Authorization: `Token ${token}` },
    }),

  deleteAllNotifications: (token: string) =>
    request<void>('/api/notifications/', {
      method: 'DELETE',
      headers: { Authorization: `Token ${token}` },
    }),

  // ─── Lists ───────────────────────────────────────────────────────────────────

  getLists: (token: string) =>
    request<ListResult[]>('/api/lists/', {
      headers: { Authorization: `Token ${token}` },
    }),

  getListDetail: (token: string, listId: number) =>
    request<ListDetailResult>(`/api/lists/${listId}/`, {
      headers: { Authorization: `Token ${token}` },
    }),

  getEmojiGroups: (token: string) =>
    request<EmojiGroup[]>('/api/emojis/groups/', {
      headers: { Authorization: `Token ${token}` },
    }),

  createList: (token: string, name: string, emojiId: number) =>
    request<ListResult>('/api/lists/', {
      method: 'PUT',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ name, emoji_id: emojiId }),
    }),

  updateList: (token: string, listId: number, payload: { name?: string; emoji_id?: number; usernames?: string[] }) =>
    request<ListResult>(`/api/lists/${listId}/`, {
      method: 'PATCH',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify(payload),
    }),

  deleteList: (token: string, listId: number) =>
    request<void>(`/api/lists/${listId}/`, {
      method: 'DELETE',
      headers: { Authorization: `Token ${token}` },
    }),

  // ─── Connections ─────────────────────────────────────────────────────────────

  getConnections: (token: string) =>
    request<ConnectionResult[]>('/api/connections/', {
      headers: { Authorization: `Token ${token}` },
    }),

  connectWithUser: (token: string, username: string, circlesIds: number[]) =>
    request<void>('/api/connections/connect/', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ username, circles_ids: circlesIds }),
    }),

  confirmConnection: (token: string, username: string, circlesIds?: number[]) =>
    request<void>('/api/connections/confirm/', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ username, ...(circlesIds ? { circles_ids: circlesIds } : {}) }),
    }),

  disconnectFromUser: (token: string, username: string) =>
    request<void>('/api/connections/disconnect/', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ username }),
    }),

  updateConnection: (token: string, username: string, circlesIds: number[]) =>
    request<void>('/api/connections/update/', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ username, circles_ids: circlesIds }),
    }),

  // ─── Circles ─────────────────────────────────────────────────────────────────

  createCircle: (token: string, name: string, color: string) =>
    request<CircleResult>('/api/circles/', {
      method: 'PUT',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ name, color }),
    }),

  getCircleDetail: (token: string, circleId: number) =>
    request<CircleDetailResult>(`/api/circles/${circleId}/`, {
      headers: { Authorization: `Token ${token}` },
    }),

  updateCircle: (token: string, circleId: number, updates: { name?: string; color?: string; usernames?: string[] }) =>
    request<CircleResult>(`/api/circles/${circleId}/`, {
      method: 'PATCH',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ circle_id: circleId, ...updates }),
    }),

  deleteCircle: (token: string, circleId: number) =>
    request<void>(`/api/circles/${circleId}/`, {
      method: 'DELETE',
      headers: { Authorization: `Token ${token}` },
    }),

  checkCircleName: (token: string, name: string) =>
    request<void>('/api/circles/name-check/', {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ name }),
    }),

  // ─── Blocks ──────────────────────────────────────────────────────────────────

  blockUser: (token: string, username: string) =>
    request<void>(`/api/auth/users/${encodeURIComponent(username)}/block/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    }),

  unblockUser: (token: string, username: string) =>
    request<void>(`/api/auth/users/${encodeURIComponent(username)}/unblock/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
    }),

  // ─── User reports ────────────────────────────────────────────────────────────

  reportUser: (token: string, username: string, categoryId: number, description?: string) =>
    request<void>(`/api/auth/users/${encodeURIComponent(username)}/report/`, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: JSON.stringify({ category_id: categoryId, ...(description?.trim() ? { description: description.trim() } : {}) }),
    }),
};
