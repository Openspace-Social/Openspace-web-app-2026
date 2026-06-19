/**
 * uploadMediaDirect — drives the new presigned direct-to-S3 upload flow.
 *
 *   1. POST /api/media/upload-init/   → receive presigned URLs (single PUT or
 *                                       N multipart parts) + an upload_token.
 *   2. PUT each chunk straight to S3  → bytes never touch Cloudflare/API,
 *                                       so the 524 timeout class disappears.
 *   3. POST /api/media/upload-complete/ → S3 multipart finalisation, server
 *                                       returns the same token as media_token.
 *
 * Returned media_token gets passed into CreatePostPayload.media_tokens by the
 * composer. See OpenSpace-API/openbook_posts/views/media_uploads/views.py for
 * the server-side contract this conforms to.
 *
 * Quality: bytes are uploaded verbatim — no transcoding, no compression, no
 * resize. The original file's MIME type and dimensions are preserved through
 * the upload. Server-side post-processing (PostImage's ProcessedImageField
 * still resizes images to 1024 px and re-encodes to JPEG q=80) is unchanged
 * from the legacy multipart path; that's a separate cleanup tracked outside
 * this PR.
 */

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  process.env.REACT_APP_API_BASE_URL ||
  'http://localhost:80'
).replace(/\/+$/, '');

type UploadInitResponse = {
  upload_token: string;
  key: string;
  part_size: number;
  parts: { number: number; url: string }[];
  expires_in: number;
  multipart: boolean;
};

type UploadCompleteResponse = {
  media_token: string;
  content_type: string;
  size: number;
};

export type UploadProgress = {
  /** 0..1 — fraction of total bytes acknowledged by S3 so far */
  fraction: number;
  /** bytes ACKed by S3 across all completed + in-flight parts */
  loaded: number;
  /** declared total size */
  total: number;
};

export type UploadMediaParams = {
  token: string;
  /** Local file URI (file://) on native, blob: URL on web, or any URL fetch() can resolve. */
  uri: string;
  /** User-facing filename used to derive the S3 key extension. */
  name: string;
  /** Required — the server validates this against its mimetype whitelist before signing URLs. */
  contentType: string;
  /** Optional pre-known size; if omitted we read the file to derive it. Saves a fetch when callers already know. */
  size?: number;
  /** Called with monotonically increasing fraction as parts ack. */
  onProgress?: (progress: UploadProgress) => void;
  /** Per-part retry attempts before giving up. Default 3. */
  partRetries?: number;
  /** AbortSignal for caller-driven cancellation; we'll call upload-abort/ on the way out. */
  signal?: AbortSignal;
};

/** Per-chunk PUT with progress + retry. Returns the ETag S3 hands back, which
 *  we feed into upload-complete/. Uses XMLHttpRequest (not fetch) because RN's
 *  fetch doesn't expose upload progress events. */
function putChunk(
  url: string,
  blob: Blob,
  contentType: string,
  onByteDelta: (delta: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastLoaded = 0;
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      try { xhr.abort(); } catch { /* ignore */ }
      reject(new Error('Upload cancelled.'));
    };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.loaded > lastLoaded) {
        const delta = e.loaded - lastLoaded;
        lastLoaded = e.loaded;
        onByteDelta(delta);
      }
    };
    xhr.onload = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        // S3 returns the ETag in the response header. RN's XHR lowercases
        // header names on some platforms — check both.
        const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag') || '';
        if (!etag) {
          // No ETag → multipart-complete will fail later with a confusing
          // error. Surface the cause here so callers can retry the part.
          reject(new Error('S3 did not return an ETag for this part.'));
          return;
        }
        resolve(etag);
      } else {
        reject(new Error(`S3 part PUT failed (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!aborted) reject(new Error('Network error during chunk upload.'));
    };
    xhr.open('PUT', url);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);
    xhr.send(blob);
  });
}

async function putChunkWithRetry(
  url: string,
  blob: Blob,
  contentType: string,
  onByteDelta: (delta: number) => void,
  attempts: number,
  signal?: AbortSignal,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // Each retry restarts the byte counter for this part — the caller's
    // progress callback discounts the previous partial-attempt bytes.
    let progressedThisAttempt = 0;
    try {
      return await putChunk(url, blob, contentType, (delta) => {
        progressedThisAttempt += delta;
        onByteDelta(delta);
      }, signal);
    } catch (err) {
      lastErr = err;
      // Roll back the partial-attempt progress so the next attempt's
      // onByteDelta calls cleanly add back up to the part size on success.
      if (progressedThisAttempt > 0) onByteDelta(-progressedThisAttempt);
      if (signal?.aborted) throw err;
      // Exponential backoff with a jitter so concurrent uploaders don't
      // all retry in lockstep when S3 throttles them.
      const delayMs = (500 * 2 ** attempt) + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Chunk upload failed.');
}

async function postJson<T>(path: string, token: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  const data = res.headers.get('content-type')?.includes('application/json')
    ? await res.json()
    : await res.text();
  if (!res.ok) {
    const message = typeof data === 'string'
      ? data
      : (data?.detail || data?.message || JSON.stringify(data));
    const err = new Error(message || `Request failed (HTTP ${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

/** Best-effort cleanup — fire-and-forget; never let abort failures mask the
 *  original upload error. */
function abortUpload(token: string, uploadToken: string): void {
  fetch(`${API_BASE_URL}/api/media/upload-abort/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify({ upload_token: uploadToken }),
  }).catch(() => { /* ignore */ });
}

/**
 * Main entry point. Returns the media_token to pass into CreatePostPayload.media_tokens.
 */
export async function uploadMediaDirect(params: UploadMediaParams): Promise<string> {
  const {
    token, uri, name, contentType,
    onProgress, partRetries = 3, signal,
  } = params;

  // Materialise the bytes once. fetch() on a file:// URI works on both
  // Expo/RN (iOS + Android) and the React Native Web build. Doing it
  // upfront lets us derive size/type even when the caller didn't pass
  // them, and gives us a sliceable Blob for multipart chunks.
  const fileResponse = await fetch(uri);
  const fileBlob = await fileResponse.blob();
  const size = params.size ?? fileBlob.size;
  if (!size) {
    throw new Error('Could not determine file size for upload.');
  }

  const init = await postJson<UploadInitResponse>(
    '/api/media/upload-init/',
    token,
    { filename: name, content_type: contentType, size },
    signal,
  );

  if (signal?.aborted) {
    abortUpload(token, init.upload_token);
    throw new Error('Upload cancelled.');
  }

  // Single-PUT and multipart use the same parts[] shape, so the loop
  // handles both. For single-PUT, parts.length === 1 and part_size ===
  // size, so we slice the whole blob.
  const partsAck: { number: number; etag: string }[] = [];
  let loaded = 0;
  const emitProgress = () => {
    onProgress?.({ fraction: Math.min(1, loaded / size), loaded, total: size });
  };

  try {
    for (const part of init.parts) {
      const start = (part.number - 1) * init.part_size;
      const end = Math.min(start + init.part_size, size);
      const chunkBlob = fileBlob.slice(start, end);
      const etag = await putChunkWithRetry(
        part.url, chunkBlob, contentType,
        (delta) => { loaded += delta; emitProgress(); },
        partRetries, signal,
      );
      partsAck.push({ number: part.number, etag });
    }

    const complete = await postJson<UploadCompleteResponse>(
      '/api/media/upload-complete/',
      token,
      // The server ignores `parts` on single-PUT sessions; we send it
      // anyway for symmetry and it's tiny.
      { upload_token: init.upload_token, parts: partsAck },
      signal,
    );
    // Cover the cap when the last delta plus the rounding tipped us over.
    loaded = size;
    emitProgress();
    return complete.media_token;
  } catch (err) {
    // Best-effort abort so we don't leave a half-finished multipart upload
    // sitting in S3 — the bucket lifecycle rule reaps these after 24h but
    // explicit abort frees the slot immediately and unblocks any
    // multipart-upload-count quota the user might hit.
    abortUpload(token, init.upload_token);
    throw err;
  }
}
