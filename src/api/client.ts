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
  comments_count?: number;
  reactions_emoji_counts?: Array<{ count?: number }>;
  creator?: {
    username?: string;
    name?: string;
    avatar?: string;
  };
  community?: {
    name?: string;
    title?: string;
  };
  media_thumbnail?: string;
  links?: Array<{ url?: string; title?: string; image?: string }>;
};

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
};
