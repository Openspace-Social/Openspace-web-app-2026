import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Localization from 'expo-localization';
import * as Notifications from 'expo-notifications';
import { ApiRequestError, api, type DevicePlatform, type PushProvider, type DeviceRegistrationPayload } from '../api/client';
import { consumePendingPushOpenPayload, openPushRoute, setPendingPushOpenPayload } from './navigation';
import { getOrCreateLocalDeviceUuid, hasRequestedPushPermission, markPushPermissionRequested } from './localDevice';
import type { PushOpenPayload, PushRegistrationState } from './types';

let responseSubscription: Notifications.EventSubscription | null = null;
let receivedSubscription: Notifications.EventSubscription | null = null;

function isUnauthorizedApiError(error: unknown) {
  return error instanceof ApiRequestError && error.status === 401;
}

function resolveRouteKind(raw: unknown): PushOpenPayload['routeKind'] {
  if (raw === 'post' || raw === 'profile' || raw === 'community' || raw === 'moderation_tasks') return raw;
  return 'alerts';
}

function parseRouteParams(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // ignore malformed payloads
  }
  return {};
}

export function parsePushOpenPayload(rawData: Record<string, unknown>): PushOpenPayload | null {
  const routeKind = resolveRouteKind(rawData.route_kind);
  const routeParams = parseRouteParams(rawData.route_params);
  return {
    eventType: typeof rawData.event_type === 'string' ? rawData.event_type : undefined,
    routeKind,
    routeParams,
    rawData,
  };
}

export function attachPushNotificationListeners(onForegroundRefresh?: () => void) {
  if (responseSubscription || receivedSubscription) return;

  receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
    const badgeCount = notification.request.content.badge;
    if (typeof badgeCount === 'number') {
      void Notifications.setBadgeCountAsync(badgeCount);
    }
    onForegroundRefresh?.();
  });

  responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const rawData = (response.notification.request.content.data || {}) as Record<string, unknown>;
    const payload = parsePushOpenPayload(rawData);
    if (!payload) return;
    if (!openPushRoute(payload)) {
      setPendingPushOpenPayload(payload);
    }
  });
}

export async function consumeInitialNotificationOpen() {
  const response = await Notifications.getLastNotificationResponseAsync();
  if (!response) return;
  const rawData = (response.notification.request.content.data || {}) as Record<string, unknown>;
  const payload = parsePushOpenPayload(rawData);
  if (!payload) return;
  if (!openPushRoute(payload)) {
    setPendingPushOpenPayload(payload);
  }
}

export function flushPendingPushRoute() {
  const payload = consumePendingPushOpenPayload();
  if (!payload) return false;
  return openPushRoute(payload);
}

export async function configurePushChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('low', {
    name: 'Low priority',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    showBadge: true,
  });
  await Notifications.setNotificationChannelAsync('medium', {
    name: 'Medium priority',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    showBadge: true,
  });
  await Notifications.setNotificationChannelAsync('high', {
    name: 'High priority',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    showBadge: true,
  });
}

export function configurePushNotificationPresentation() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export async function ensurePushRegistration(token: string): Promise<PushRegistrationState | null> {
  if (Platform.OS === 'web') return null;
  if (Platform.OS === 'ios' && !Device.isDevice) return null;

  const existingPermissions = await Notifications.getPermissionsAsync();
  let finalStatus = existingPermissions.status;
  const prompted = await hasRequestedPushPermission();
  if (finalStatus !== 'granted' && !prompted) {
    await markPushPermissionRequested();
    const request = await Notifications.requestPermissionsAsync();
    finalStatus = request.status;
  }

  if (finalStatus !== 'granted') {
    const deviceUuid = await getOrCreateLocalDeviceUuid();
    try {
      await api.registerDeviceInstall(token, {
        uuid: deviceUuid,
        platform: Platform.OS as DevicePlatform,
        push_provider: Platform.OS === 'ios' ? 'apns' : 'fcm',
        push_token: '',
        push_enabled: false,
        permission_status: finalStatus,
        app_version: Constants.expoConfig?.version,
        build_number: resolveBuildNumber(),
        locale: Localization.getLocales?.()[0]?.languageTag || undefined,
        timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
        app_environment: resolveAppEnvironment(),
        name: Device.deviceName || undefined,
      });
    } catch (error) {
      if (isUnauthorizedApiError(error)) return null;
      throw error;
    }
    return null;
  }

  const devicePushToken = await Notifications.getDevicePushTokenAsync();
  const pushProvider: PushProvider = Platform.OS === 'ios' ? 'apns' : 'fcm';
  const deviceUuid = await getOrCreateLocalDeviceUuid();
  const registrationState: PushRegistrationState = {
    deviceUuid,
    platform: Platform.OS as DevicePlatform,
    pushProvider,
    pushToken: String(devicePushToken.data),
    pushEnabled: true,
    permissionStatus: finalStatus,
  };

  const payload: DeviceRegistrationPayload = {
    uuid: deviceUuid,
    name: Device.deviceName || undefined,
    platform: registrationState.platform,
    push_provider: registrationState.pushProvider,
    push_token: registrationState.pushToken,
    push_enabled: true,
    permission_status: finalStatus,
    app_version: Constants.expoConfig?.version,
    build_number: resolveBuildNumber(),
    locale: Localization.getLocales?.()[0]?.languageTag || undefined,
    timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
    app_environment: resolveAppEnvironment(),
  };

  try {
    await api.registerDeviceInstall(token, payload);
  } catch (error) {
    if (isUnauthorizedApiError(error)) return null;
    throw error;
  }
  return registrationState;
}

export async function deactivatePushRegistration(token: string | null) {
  if (!token) return;
  const deviceUuid = await getOrCreateLocalDeviceUuid();
  try {
    await api.deactivateDeviceInstall(token, deviceUuid);
  } catch {
    // best effort on logout
  }
}

function resolveAppEnvironment(): string {
  const profile = process.env.EAS_BUILD_PROFILE || process.env.EXPO_PUBLIC_APP_ENV || '';
  const normalized = profile.toLowerCase();
  if (normalized.includes('dev')) return 'development';
  if (normalized.includes('preview')) return 'preview';
  if (normalized.includes('testflight')) return 'testflight';
  if (normalized.includes('staging')) return 'staging';
  if (normalized.includes('prod')) return 'production';
  return __DEV__ ? 'development' : 'production';
}

function resolveBuildNumber(): string | undefined {
  const config = Constants.expoConfig;
  if (!config) return undefined;
  if (Platform.OS === 'ios') return config.ios?.buildNumber;
  if (Platform.OS === 'android') {
    const versionCode = config.android?.versionCode;
    return typeof versionCode === 'number' ? String(versionCode) : undefined;
  }
  return undefined;
}
