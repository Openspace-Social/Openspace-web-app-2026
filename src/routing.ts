import { FeedType } from './api/client';

export type AppRoute =
  | { screen: 'landing' }
  | { screen: 'about' }
  | { screen: 'privacy' }
  | { screen: 'terms' }
  | { screen: 'guidelines' }
  | { screen: 'feed'; feed: FeedType }
  | { screen: 'search'; query: string }
  | { screen: 'post'; postUuid: string; feed?: FeedType; focusCommentId?: number; focusParentCommentId?: number }
  | { screen: 'profile'; username: string }
  | { screen: 'remote-profile'; remoteActorId: number }
  | { screen: 'remote-thread'; inboundObjectId: number }
  | { screen: 'remote-community'; remoteCommunityId: number }
  | { screen: 'community'; name: string }
  | { screen: 'hashtag'; name: string }
  | { screen: 'me' }
  | { screen: 'communities' }
  | { screen: 'circles' }
  | { screen: 'lists' }
  | { screen: 'followers' }
  | { screen: 'following' }
  | { screen: 'blocked' }
  | { screen: 'manage-communities' }
  | { screen: 'muted-communities' }
  | { screen: 'settings' };

export type LegalDrawerScreen = 'about' | 'privacy' | 'terms' | 'guidelines';

export function isLegalDrawerRoute(route: AppRoute): route is { screen: LegalDrawerScreen } {
  return route.screen === 'about' || route.screen === 'privacy' || route.screen === 'terms' || route.screen === 'guidelines';
}

export function defaultAuthedRoute(): AppRoute {
  return { screen: 'feed', feed: 'home' };
}

// Hostnames the app treats as its own. Anything not in this list is treated
// as an external link and opened in the in-app/system browser.
const INTERNAL_OPENSPACE_HOSTS = new Set([
  'openspace.social',
  'www.openspace.social',
  'staging.openspace.social',
  'localhost',
  '127.0.0.1',
]);

/**
 * If `url` points at one of our own hosts AND resolves to a known route,
 * returns the parsed AppRoute so the caller can navigate internally
 * instead of opening the in-app/system browser. Returns null for anything
 * external (or for internal hosts whose path falls back to the landing
 * route — in that case the in-app browser is still the better UX since
 * the user clearly wanted *that* page, not just "go home").
 */
export function parseInternalOpenspaceUrl(url: string | null | undefined): AppRoute | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = (parsed.hostname || '').toLowerCase();
  const matchesHost =
    INTERNAL_OPENSPACE_HOSTS.has(host) || host.endsWith('.openspace.social');
  if (!matchesHost) return null;
  const route = parsePathToRoute(parsed.pathname || '/');
  // Bare /  or unknown paths resolve to `landing` — don't intercept those
  // since the user explicitly clicked the marketing root and we'd rather
  // surface that in the browser than dump them on the feed root.
  if (route.screen === 'landing') return null;
  return route;
}

export function parsePathToRoute(pathname: string): AppRoute {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  const reservedTopLevelRoutes = new Set([
    'home', 'trending', 'public', 'explore', 'mastodon',
    'me', 'communities', 'circles', 'lists', 'followers', 'following', 'blocked',
    'manage-communities', 'muted-communities', 'settings',
    'about', 'privacy', 'terms', 'guidelines',
    'posts', 'p', 'search', 'u', 'fediverse', 'c', 'h',
    'api', 'health', 'nodeinfo', '.well-known', 'users',
  ]);

  if (path === '/') return { screen: 'landing' };

  if (parts.length === 1) {
    const [first] = parts;
    if (first === 'home' || first === 'trending' || first === 'public' || first === 'explore' || first === 'mastodon') {
      return { screen: 'feed', feed: first };
    }
    if (first === 'me') return { screen: 'me' };
    if (first === 'communities') return { screen: 'communities' };
    if (first === 'circles') return { screen: 'circles' };
    if (first === 'lists') return { screen: 'lists' };
    if (first === 'followers') return { screen: 'followers' };
    if (first === 'following') return { screen: 'following' };
    if (first === 'blocked') return { screen: 'blocked' };
    if (first === 'manage-communities') return { screen: 'manage-communities' };
    if (first === 'muted-communities') return { screen: 'muted-communities' };
    if (first === 'settings') return { screen: 'settings' };
    if (first === 'about') return { screen: 'about' };
    if (first === 'privacy') return { screen: 'privacy' };
    if (first === 'terms') return { screen: 'terms' };
    if (first === 'guidelines') return { screen: 'guidelines' };
  }

  if (parts.length === 2 && parts[0] === 'posts' && parts[1]) {
    return { screen: 'post', postUuid: parts[1] };
  }

  if (parts.length === 2 && parts[0] === 'p' && parts[1]) {
    return { screen: 'post', postUuid: parts[1] };
  }

  if (parts.length === 2 && parts[0] === 'search' && parts[1]) {
    return { screen: 'search', query: decodeURIComponent(parts[1]) };
  }

  if (parts.length === 2 && parts[0] === 'u' && parts[1]) {
    return { screen: 'profile', username: decodeURIComponent(parts[1]) };
  }

  if (parts.length === 1 && parts[0] && !reservedTopLevelRoutes.has(parts[0])) {
    return { screen: 'profile', username: decodeURIComponent(parts[0]) };
  }

  if (parts.length === 3 && parts[0] === 'fediverse' && parts[1] === 'profiles' && parts[2]) {
    const remoteActorId = Number(parts[2]);
    if (!Number.isNaN(remoteActorId)) return { screen: 'remote-profile', remoteActorId };
  }

  if (parts.length === 3 && parts[0] === 'fediverse' && parts[1] === 'threads' && parts[2]) {
    const inboundObjectId = Number(parts[2]);
    if (!Number.isNaN(inboundObjectId)) return { screen: 'remote-thread', inboundObjectId };
  }

  if (parts.length === 3 && parts[0] === 'fediverse' && parts[1] === 'communities' && parts[2]) {
    const remoteCommunityId = Number(parts[2]);
    if (!Number.isNaN(remoteCommunityId)) return { screen: 'remote-community', remoteCommunityId };
  }

  if (parts.length === 2 && parts[0] === 'c' && parts[1]) {
    return { screen: 'community', name: decodeURIComponent(parts[1]) };
  }

  if (parts.length === 2 && parts[0] === 'h' && parts[1]) {
    return { screen: 'hashtag', name: decodeURIComponent(parts[1]) };
  }

  return { screen: 'landing' };
}

export function routeToPath(route: AppRoute): string {
  switch (route.screen) {
    case 'landing':
      return '/';
    case 'feed':
      return `/${route.feed}`;
    case 'search':
      return `/search/${encodeURIComponent(route.query)}`;
    case 'post':
      return `/p/${route.postUuid}`;
    case 'profile':
      return `/u/${encodeURIComponent(route.username)}`;
    case 'remote-profile':
      return `/fediverse/profiles/${route.remoteActorId}`;
    case 'remote-thread':
      return `/fediverse/threads/${route.inboundObjectId}`;
    case 'remote-community':
      return `/fediverse/communities/${route.remoteCommunityId}`;
    case 'community':
      return `/c/${encodeURIComponent(route.name)}`;
    case 'hashtag':
      return `/h/${encodeURIComponent(route.name)}`;
    case 'me':
      return '/me';
    case 'communities':
      return '/communities';
    case 'circles':
      return '/circles';
    case 'lists':
      return '/lists';
    case 'followers':
      return '/followers';
    case 'following':
      return '/following';
    case 'blocked':
      return '/blocked';
    case 'manage-communities':
      return '/manage-communities';
    case 'muted-communities':
      return '/muted-communities';
    case 'settings':
      return '/settings';
    case 'about':
      return '/about';
    case 'privacy':
      return '/privacy';
    case 'terms':
      return '/terms';
    case 'guidelines':
      return '/guidelines';
    default:
      return '/';
  }
}
