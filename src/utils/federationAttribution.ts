import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { api } from '../api/client';

export type FederationPreferredAuthMode = 'signup' | 'mastodon';

export type FederationVisitorAttributionContext = {
  visitorToken: string;
  sourceKind: 'profile' | 'post';
  routePath?: string;
  targetUsername?: string;
  targetPostUuid?: string;
  preferredAuthMode?: FederationPreferredAuthMode | null;
  trackedAt: string;
};

const STORAGE_KEY = '@openspace/federation_visitor_attribution';

function sanitizePath(path?: string | null) {
  if (!path) return undefined;
  return path.trim() || undefined;
}

function getDocumentReferrer() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
  const value = (document.referrer || '').trim();
  return value || undefined;
}

export async function loadFederationVisitorAttribution() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FederationVisitorAttributionContext;
  } catch {
    return null;
  }
}

async function saveFederationVisitorAttribution(context: FederationVisitorAttributionContext) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

export async function clearFederationVisitorAttribution() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function setFederationVisitorPreferredAuthMode(mode: FederationPreferredAuthMode) {
  const existing = await loadFederationVisitorAttribution();
  if (!existing) return;
  await saveFederationVisitorAttribution({
    ...existing,
    preferredAuthMode: mode,
  });
}

async function trackFederationVisitorVisit(payload: {
  sourceKind: 'profile' | 'post';
  routePath?: string;
  targetUsername?: string;
  targetPostUuid?: string;
}) {
  const existing = await loadFederationVisitorAttribution();
  const result = await api.trackFederationVisitorAttribution({
    visitor_token: existing?.visitorToken,
    source_kind: payload.sourceKind,
    route_path: sanitizePath(payload.routePath),
    target_username: payload.targetUsername,
    target_post_uuid: payload.targetPostUuid,
    referrer_url: getDocumentReferrer(),
  });

  const nextContext: FederationVisitorAttributionContext = {
    visitorToken: result.visitor_token,
    sourceKind: payload.sourceKind,
    routePath: sanitizePath(payload.routePath),
    targetUsername: payload.targetUsername,
    targetPostUuid: payload.targetPostUuid,
    preferredAuthMode: existing?.preferredAuthMode ?? null,
    trackedAt: new Date().toISOString(),
  };
  await saveFederationVisitorAttribution(nextContext);
  return nextContext;
}

export async function trackFederationVisitorProfileVisit(username: string, routePath?: string) {
  return trackFederationVisitorVisit({
    sourceKind: 'profile',
    routePath,
    targetUsername: username,
  });
}

export async function trackFederationVisitorPostVisit(postUuid: string, routePath?: string) {
  return trackFederationVisitorVisit({
    sourceKind: 'post',
    routePath,
    targetPostUuid: postUuid,
  });
}
