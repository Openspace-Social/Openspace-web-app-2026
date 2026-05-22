/**
 * mediaValidation — single source of truth for upload constraints,
 * mirroring the Django POST_MEDIA_MAX_SIZE setting (currently 75 MB).
 *
 * Two responsibilities:
 *
 *   1. `validatePickedMedia` — runs at pick-time, checks the file's
 *      size (and video duration) against our limits and returns a
 *      human-readable rejection reason if it doesn't fit. Caller
 *      surfaces the reason via toast / inline error.
 *
 *   2. `verifyUriExists` — runs at submit-time on native, confirms a
 *      previously-picked URI is still readable. iOS PHPhotoPicker URIs
 *      can go stale between pick and submit; without this guard the
 *      upload silently lands as a text-only post (the FormData skips
 *      missing-file parts, the server creates the post, no error
 *      surfaces). On web, File / Blob objects keep their data in
 *      memory so the check is a no-op.
 */

import { Platform } from 'react-native';
import { File } from 'expo-file-system';

// Mirror of openbook/settings.py:POST_MEDIA_MAX_SIZE (75 MB / 78 643 200 B).
// Kept conservative so the server-side limit is never the first thing
// the user hits — we want our message, not Django's.
export const POST_MEDIA_MAX_BYTES = 75 * 1024 * 1024;

// 5-minute soft cap on video duration. The server doesn't enforce this
// today, but anything longer almost certainly trips the file-size
// limit before it finishes uploading anyway — fail fast at pick-time.
export const POST_VIDEO_MAX_DURATION_MS = 5 * 60 * 1000;

function formatMb(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

function formatSeconds(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export type PickedMediaInfo = {
  /** Size in bytes (from the picker — `expo-image-picker` exposes it
   *  via `asset.fileSize`; on web it's `File.size`). May be undefined
   *  for pickers that don't surface it (rare on modern platforms). */
  size?: number;
  /** Video duration in ms (videos only). undefined for images. */
  durationMs?: number;
  /** 'image' | 'video' — used to tailor the error wording. */
  kind: 'image' | 'video';
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validatePickedMedia(info: PickedMediaInfo): ValidationResult {
  if (typeof info.size === 'number' && info.size > POST_MEDIA_MAX_BYTES) {
    const label = info.kind === 'video' ? 'Video' : 'Image';
    return {
      ok: false,
      reason: `${label} is too large (${formatMb(info.size)}). Max is ${formatMb(POST_MEDIA_MAX_BYTES)}.`,
    };
  }
  if (info.kind === 'video' && typeof info.durationMs === 'number' && info.durationMs > POST_VIDEO_MAX_DURATION_MS) {
    return {
      ok: false,
      reason: `Video is too long (${formatSeconds(info.durationMs)}). Max is ${formatSeconds(POST_VIDEO_MAX_DURATION_MS)}.`,
    };
  }
  return { ok: true };
}

/**
 * Native-only: confirm a URI returned earlier by expo-image-picker
 * (or rotated through expo-image-manipulator) is still readable. iOS
 * PHPhotoPicker URIs can be invalidated by the OS between pick and
 * submit. Returns null on success, a human-readable error otherwise.
 *
 * On web this always succeeds — File / Blob objects keep their data
 * in memory so there's nothing to verify.
 */
export async function verifyUriExists(uri: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    // expo-file-system v19 replaced the deprecated `getInfoAsync` with
    // a sync `File` class — `size` returns 0 when the file doesn't
    // exist or can't be read (per the v19 contract), so that doubles
    // as our existence check.
    const file = new File(uri);
    const size = file.size;
    if (size === 0) {
      return 'The selected file is no longer available or empty. Please pick it again.';
    }
    if (size > POST_MEDIA_MAX_BYTES) {
      return `File is too large (${formatMb(size)}). Max is ${formatMb(POST_MEDIA_MAX_BYTES)}.`;
    }
    return null;
  } catch {
    // `new File(uri)` validates the path on construction and throws for
    // schemes we can't probe (`ph://`, `assets-library://`, anything
    // non-`file://`). In that case we can't verify, so let the upload
    // proceed and let the server reject if needed — better than blocking
    // a legitimate Photos-library URI.
    return null;
  }
}
