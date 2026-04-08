import { FeedType } from './api/client';

export type AppRoute =
  | { screen: 'landing' }
  | { screen: 'feed'; feed: FeedType }
  | { screen: 'search'; query: string }
  | { screen: 'post'; postId: number; feed?: FeedType }
  | { screen: 'profile'; username: string }
  | { screen: 'community'; name: string }
  | { screen: 'hashtag'; name: string }
  | { screen: 'me' };

export function defaultAuthedRoute(): AppRoute {
  return { screen: 'feed', feed: 'home' };
}

export function parsePathToRoute(pathname: string): AppRoute {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);

  if (path === '/') return { screen: 'landing' };

  if (parts.length === 1) {
    const [first] = parts;
    if (first === 'home' || first === 'trending' || first === 'public' || first === 'explore') {
      return { screen: 'feed', feed: first };
    }
    if (first === 'me') return { screen: 'me' };
  }

  if (parts.length === 2 && parts[0] === 'posts') {
    const postId = Number(parts[1]);
    if (Number.isFinite(postId) && postId > 0) return { screen: 'post', postId };
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
      return `/posts/${route.postId}`;
    case 'profile':
      return `/u/${encodeURIComponent(route.username)}`;
    case 'community':
      return `/c/${encodeURIComponent(route.name)}`;
    case 'hashtag':
      return `/h/${encodeURIComponent(route.name)}`;
    case 'me':
      return '/me';
    default:
      return '/';
  }
}
