import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export async function syncAppIconBadgeCount(count: number) {
  if (Platform.OS === 'web') return;
  const normalizedCount = Math.max(0, Math.floor(count || 0));
  try {
    await Notifications.setBadgeCountAsync(normalizedCount);
  } catch {
    // Badge sync is best effort and should never break notification flows.
  }
}
