import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './AppNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let navigationReady = false;

export function markNavigationReady() {
  navigationReady = true;
}

export function isNavigationReady() {
  return navigationReady && navigationRef.isReady();
}
