/**
 * normalizeImageForUpload — runs an image URI through expo-image-manipulator
 * with `format: SaveFormat.JPEG` so any input format (HEIC/HEIF from iOS
 * Photos, WebP, anything else the picker hands back) is re-encoded to a
 * universally-decodable JPEG before it's uploaded.
 *
 * iOS's PHPicker often returns HEIC/HEIF originals when the source asset
 * was captured on an iPhone (≥ iOS 11 default). Backend Pillow can't
 * decode those without `pillow-heif`, and even with it we'd rather ship
 * a smaller normalized JPEG than a bigger HEIC. Web browsers also can't
 * render HEIC inline.
 *
 * Falls back to the original URI on any manipulator failure so a bad
 * normalize never blocks the upload outright — the backend can still try
 * to handle the original (and the server-side HEIF opener will catch it
 * if pillow-heif is installed).
 */

import * as ImageManipulator from 'expo-image-manipulator';

export async function normalizeImageForUpload(
  uri: string,
  options: { rotate?: 0 | 90 | 180 | 270; compress?: number } = {},
): Promise<string> {
  const { rotate, compress = 0.9 } = options;
  const actions: ImageManipulator.Action[] = [];
  if (rotate) actions.push({ rotate });
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
