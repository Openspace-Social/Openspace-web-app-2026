import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const DEVICE_UUID_KEY = '@openspace/push/device-uuid';
const PERMISSION_PROMPTED_KEY = '@openspace/push/permission-prompted';

export async function getOrCreateLocalDeviceUuid(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_UUID_KEY);
  if (existing) return existing;
  const next = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_UUID_KEY, next);
  return next;
}

export async function hasRequestedPushPermission(): Promise<boolean> {
  return (await AsyncStorage.getItem(PERMISSION_PROMPTED_KEY)) === 'true';
}

export async function markPushPermissionRequested(): Promise<void> {
  await AsyncStorage.setItem(PERMISSION_PROMPTED_KEY, 'true');
}
