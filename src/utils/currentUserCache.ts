/**
 * currentUserCache — module-level + persistent cache for the authenticated
 * user payload.
 *
 * Why this exists
 * ---------------
 * Multiple screens / hooks (PostDetailScreenContainer, useCommentsData,
 * etc.) independently call `api.getAuthenticatedUser` on mount. Each fetch
 * is async, so there's a window between mount and resolve where the
 * caller's local state is undefined. In that window:
 *
 *   * A user who posts a comment FAST (before the fetch resolves) sees
 *     their own freshly-posted comment render as "@unknown" / "U" avatar
 *     because the hydration helper has no current-user reference to graft
 *     onto the server's bare response.
 *   * Switching between PostDetail screens remounts the hook → fetch
 *     re-runs from scratch → race window re-opens every time.
 *
 * The cache stores the last-known user object at module level (survives
 * hook remounts within a session) AND persists to AsyncStorage so a fresh
 * app launch hydrates the in-memory cache synchronously-ish on init.
 * Consumers get a useful value INSTANTLY on every mount after the first
 * successful fetch — the race is eliminated for the 99% case.
 *
 * Cache invalidation
 * ------------------
 * The cache is updated on every successful fetch. The avatar / username
 * are stable for a given account; staleness is a non-issue for the
 * "render my own freshly-posted comment correctly" use case.
 *
 * Token changes (logout + login) automatically refresh the cache via the
 * effect that calls `fetchAndCacheCurrentUser`. There's no per-token
 * partition — the cache holds whichever user was last successfully
 * fetched. On logout, callers should explicitly `clearCurrentUserCache()`
 * to avoid showing the previous user's identity on a freshly-logged-in
 * account before the new fetch resolves.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '../api/client';

const STORAGE_KEY = '@openspace/cached_current_user';

type CachedUser = any; // we accept the raw authenticated-user shape

let inMemoryUser: CachedUser | null = null;
let inFlightFetch: Promise<CachedUser | null> | null = null;
let asyncStorageHydrationStarted = false;

/**
 * Returns the cached user synchronously. May be null on the very first
 * call of a fresh app launch (before AsyncStorage hydration completes).
 * Subsequent mounts in the same session get the value cached in memory
 * after the first fetch.
 */
export function getCachedCurrentUser(): CachedUser | null {
  // Fire-and-forget AsyncStorage hydration on first read. The current
 // call returns null (cache empty), but future synchronous reads will
  // hit the hydrated value. The user-facing impact: the FIRST mount of
  // the FIRST hook on a fresh launch may still race; every subsequent
  // mount sees the cached value instantly.
  if (!asyncStorageHydrationStarted) {
    asyncStorageHydrationStarted = true;
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw || inMemoryUser) return;
      try {
        inMemoryUser = JSON.parse(raw);
      } catch {
        // corrupted — wipe the bad value so we don't retry-load-it forever
        AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      }
    }).catch(() => {});
  }
  return inMemoryUser;
}

/**
 * Fetches the authenticated user from the API, caches it in memory AND
 * AsyncStorage, returns the result. Concurrent calls share one in-flight
 * request — multiple hooks mounting simultaneously generate one network
 * roundtrip, not N.
 */
export function fetchAndCacheCurrentUser(token: string | null): Promise<CachedUser | null> {
  if (!token) {
    return Promise.resolve(null);
  }
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const u = await api.getAuthenticatedUser(token);
      inMemoryUser = u;
      // Best-effort persist; failure here only affects the next launch's
      // initial render speed, not correctness.
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(u)).catch(() => {});
      return u;
    } catch {
      return inMemoryUser; // keep returning whatever we last had
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

/**
 * Wipe the cache. Call on logout to prevent the previous user's identity
 * from briefly rendering on a freshly-logged-in account.
 */
export function clearCurrentUserCache(): void {
  inMemoryUser = null;
  asyncStorageHydrationStarted = true; // skip re-hydration after explicit clear
  AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
