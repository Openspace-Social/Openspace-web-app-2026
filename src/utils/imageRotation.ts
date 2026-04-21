/**
 * Rotates an image Blob by the given degrees using the Canvas API.
 * Returns a new Blob with the same MIME type (or image/jpeg as fallback).
 * Only works in environments with the Canvas API (web).
 */
export async function rotateImageBlob(
  blob: Blob,
  degrees: 90 | 180 | 270,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new window.Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      const w = img.naturalWidth;
      const h = img.naturalHeight;

      const canvas = document.createElement('canvas');
      // 90 / 270 degree rotations swap width ↔ height
      if (degrees === 90 || degrees === 270) {
        canvas.width = h;
        canvas.height = w;
      } else {
        canvas.width = w;
        canvas.height = h;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context not available'));
        return;
      }

      const rad = (degrees * Math.PI) / 180;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -w / 2, -h / 2);

      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error('canvas.toBlob() returned null'));
          }
        },
        blob.type || 'image/jpeg',
        0.92,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image for rotation'));
    };

    img.src = url;
  });
}
