import type { PushOpenPayload } from './types';
import { isNavigationReady, navigationRef } from '../navigation/navigationRef';

let pendingPayload: PushOpenPayload | null = null;

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function setPendingPushOpenPayload(payload: PushOpenPayload | null) {
  pendingPayload = payload;
}

export function getPendingPushOpenPayload() {
  return pendingPayload;
}

export function consumePendingPushOpenPayload(): PushOpenPayload | null {
  const next = pendingPayload;
  pendingPayload = null;
  return next;
}

export function openPushRoute(payload: PushOpenPayload): boolean {
  if (!isNavigationReady()) {
    setPendingPushOpenPayload(payload);
    return false;
  }

  const params = payload.routeParams || {};

  switch (payload.routeKind) {
    case 'post': {
      const postUuid = typeof params.postUuid === 'string' ? params.postUuid : '';
      if (!postUuid) return false;
      // RootStack -> Main -> HomeTab -> Post
      (navigationRef as any).navigate('Main', {
        screen: 'HomeTab',
        params: {
          screen: 'Post',
          params: {
            postUuid,
            focusCommentId: coerceNumber(params.focusCommentId),
            focusParentCommentId: coerceNumber(params.focusParentCommentId),
          },
        },
      });
      return true;
    }
    case 'profile': {
      const username = typeof params.username === 'string' ? params.username : '';
      if (!username) return false;
      (navigationRef as any).navigate('Main', {
        screen: 'ProfileTab',
        params: {
          screen: 'Profile',
          params: { username },
        },
      });
      return true;
    }
    case 'community': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!name) return false;
      (navigationRef as any).navigate('Main', {
        screen: 'CommunitiesTab',
        params: {
          screen: 'Community',
          params: { name },
        },
      });
      return true;
    }
    case 'moderation_tasks': {
      (navigationRef as any).navigate('Main', {
        screen: 'ProfileTab',
        params: {
          screen: 'ModerationTasks',
        },
      });
      return true;
    }
    case 'alerts':
    default:
      (navigationRef as any).navigate('Main', {
        screen: 'AlertsTab',
      });
      return true;
  }
}
