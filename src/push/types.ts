import type { DevicePlatform, PushProvider } from '../api/client';

export type NotificationRouteKind =
  | 'post'
  | 'profile'
  | 'community'
  | 'moderation_tasks'
  | 'alerts';

export type NotificationRouteTarget = {
  kind: NotificationRouteKind;
  params: Record<string, unknown>;
};

export type PushOpenPayload = {
  eventType?: string;
  routeKind: NotificationRouteKind;
  routeParams: Record<string, unknown>;
  rawData: Record<string, unknown>;
};

export type PushRegistrationState = {
  deviceUuid: string;
  platform: DevicePlatform;
  pushProvider: PushProvider;
  pushToken: string;
  pushEnabled: boolean;
  permissionStatus: string;
};
