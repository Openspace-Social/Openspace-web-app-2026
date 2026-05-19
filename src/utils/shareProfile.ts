/**
 * shareProfile — single entrypoint for the "Share profile" button on every
 * profile page. Picks the right share UX for the current platform:
 *
 *   - Web with Web Share API (mobile browsers, Safari): system share sheet.
 *   - Web without Web Share API (Chrome / Firefox desktop): copy the URL
 *     to the clipboard and return `kind: 'copied'` so the caller can show
 *     a toast.
 *   - Native: react-native `Share.share`.
 *
 * Returns a tag the caller can switch on to decide what (if any) notice to
 * surface. `cancelled` covers the share-sheet dismiss path and is always
 * silent.
 */

import { Platform, Share } from 'react-native';

export type ShareProfileResult =
  | { kind: 'shared' }
  | { kind: 'copied' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: Error };

/** Resolve the public URL for a profile, matching the web app's /u/<username>
 *  route. On web we prefer the current browser origin so dev and prod
 *  builds share the link the user is actually on. */
export function getProfileShareUrl(username: string): string {
  const safe = encodeURIComponent(username);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const origin = (window.location?.origin || 'https://openspace.social').replace(/\/+$/, '');
    return `${origin}/u/${safe}`;
  }
  const base = process.env.EXPO_PUBLIC_WEB_BASE_URL || 'https://openspace.social';
  return `${base.replace(/\/+$/, '')}/u/${safe}`;
}

export async function shareProfile({
  username,
  displayName,
}: {
  username: string;
  displayName?: string;
}): Promise<ShareProfileResult> {
  const url = getProfileShareUrl(username);
  const handle = `@${username}`;
  const title = displayName
    ? `${displayName} (${handle}) on Openspace.Social`
    : `${handle} on Openspace.Social`;
  const message = `${title} — ${url}`;

  // ── Web ────────────────────────────────────────────────────────────────
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    try {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (typeof nav.share === 'function') {
        await nav.share({ title, url });
        return { kind: 'shared' };
      }
      if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        await nav.clipboard.writeText(url);
        return { kind: 'copied' };
      }
      return { kind: 'failed', error: new Error('No share or clipboard API available') };
    } catch (err: any) {
      // The Web Share API rejects with AbortError when the user cancels —
      // surface that as `cancelled` so callers don't toast an error.
      if (err?.name === 'AbortError') return { kind: 'cancelled' };
      return { kind: 'failed', error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  // ── Native (iOS / Android) ─────────────────────────────────────────────
  try {
    const result = await Share.share(
      Platform.OS === 'ios' ? { url, message: title } : { message },
      { dialogTitle: title },
    );
    if (result.action === Share.dismissedAction) return { kind: 'cancelled' };
    return { kind: 'shared' };
  } catch (err: any) {
    return { kind: 'failed', error: err instanceof Error ? err : new Error(String(err)) };
  }
}
