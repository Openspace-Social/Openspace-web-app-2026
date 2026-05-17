/**
 * normalizeImageForUpload — runs an image URI through expo-image-manipulator
 * to (1) re-encode to JPEG and (2) cap the longest side at `maxDimension`
 * before the file is uploaded.
 *
 * Format normalization: iOS's PHPicker often returns HEIC/HEIF originals
 * (≥ iOS 11 default). Backend Pillow can't decode those without
 * `pillow-heif`, and even with it we'd rather ship a smaller normalized
 * JPEG than a bigger HEIC. Web browsers also can't render HEIC inline.
 *
 * Dimension cap: modern phone cameras shoot 12–48 MP (4000–8000 px on the
 * long side), producing multi-megabyte payloads that broke posting —
 * upload timeouts and Django request-size limits. Capping at ~2048 px
 * keeps perceptual quality far higher than anything the feed renders
 * while bringing the typical photo down to ~1 MB. Callers that need a
 * smaller cap (e.g. avatars) can pass `maxDimension` explicitly.
 *
 * Falls back to the original URI on any manipulator failure so a bad
 * normalize never blocks the upload outright — the backend can still try
 * to handle the original.
 */

import { Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';

const DEFAULT_MAX_DIMENSION = 2048;

function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

export async function normalizeImageForUpload(
  uri: string,
  options: {
    rotate?: 0 | 90 | 180 | 270;
    compress?: number;
    /** Long-side pixel cap. Pass 0 to skip resizing. Defaults to 2048. */
    maxDimension?: number;
  } = {},
): Promise<string> {
  const { rotate, compress = 0.9, maxDimension = DEFAULT_MAX_DIMENSION } = options;
  const actions: ImageManipulator.Action[] = [];
  if (rotate) actions.push({ rotate });

  // Cap the longest side. expo-image-manipulator's `resize` preserves
  // aspect ratio when only one dimension is supplied — pick width vs.
  // height based on which is larger so the cap applies to whichever is
  // bigger. If we can't read dimensions for some reason (exotic URI
  // scheme, race with the asset being deleted, …), skip resizing rather
  // than aborting the whole upload.
  if (maxDimension > 0) {
    try {
      const dims = await getImageDimensions(uri);
      const longSide = Math.max(dims.width, dims.height);
      if (longSide > maxDimension) {
        actions.push({
          resize: dims.width >= dims.height
            ? { width: maxDimension }
            : { height: maxDimension },
        });
      }
    } catch {
      // ignore — fall through and just re-encode at native resolution
    }
  }

  try {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      actions,
      { compress, format: ImageManipulator.SaveFormat.JPEG },
    );
    return out.uri || uri;
  } catch {
    return uri;
  }
}
