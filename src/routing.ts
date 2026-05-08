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

export function parsePathToRoute(pathname: string): AppRoute {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);

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

  if (parts.length === 2 && parts[0] === 'search' && parts[1]) {
    return { screen: 'search', query: decodeURIComponent(parts[1]) };
  }

  if (parts.length === 2 && parts[0] === 'u' && parts[1]) {
    return { screen: 'profile', username: decodeURIComponent(parts[1]) };
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
      return `/posts/${route.postUuid}`;
    case 'profile':
      return `/u/${encodeURIComponent(route.username)}`;
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
