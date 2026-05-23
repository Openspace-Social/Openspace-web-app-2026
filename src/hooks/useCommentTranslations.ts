/**
 * useCommentTranslations — per-comment/per-reply translation state.
 *
 * Mirrors PostCard's local translation state (translatedText / isTranslating
 * / translationError) but keyed by comment id so the same hook handles every
 * comment + reply rendered in PostDetailModal. Replies share the same id
 * namespace as comments on the API side (both are PostComment rows with
 * numeric ids), so a single keyed map covers both.
 */

import { useCallback, useState } from 'react';
import { api } from '../api/client';

type ByIdMap<T> = Record<number, T>;

export type UseCommentTranslationsResult = {
  translatedById: ByIdMap<string>;
  loadingById: ByIdMap<boolean>;
  // Per-comment failure message. `null` means no error. We carry the
  // string (status + server message) rather than a bare boolean so the
  // UI can surface why the translation failed.
  errorById: ByIdMap<string | null>;
  translate: (commentId: number) => Promise<void>;
  showOriginal: (commentId: number) => void;
};

export function useCommentTranslations(
  token: string | null,
  postUuid: string | undefined,
): UseCommentTranslationsResult {
  const [translatedById, setTranslatedById] = useState<ByIdMap<string>>({});
  const [loadingById, setLoadingById] = useState<ByIdMap<boolean>>({});
  const [errorById, setErrorById] = useState<ByIdMap<string | null>>({});

  const translate = useCallback(
    async (commentId: number) => {
      if (!token || !postUuid || !commentId) return;
      // Guard against double-tap while in flight. Reading from the latest
      // setter callback would be ideal but the React state read in a
      // closure is acceptable here — a single redundant request is
      // cheaper than the bookkeeping for a perfect lock.
      if (loadingById[commentId]) return;
      setLoadingById((prev) => ({ ...prev, [commentId]: true }));
      setErrorById((prev) => ({ ...prev, [commentId]: null }));
      try {
        const result = await api.translatePostComment(token, postUuid, commentId);
        setTranslatedById((prev) => ({ ...prev, [commentId]: result.translated_text }));
      } catch (err: any) {
        // Surface the real reason. ApiRequestError carries {status, data,
        // message}; DRF ValidationErrors land as either {detail} or
        // {non_field_errors: [...]} in `data`. Anything else falls back
        // to err.message or a generic string.
        const status = err?.status;
        const body = err?.data;
        const message =
          (typeof body === 'object' && body && (body.detail || body.message || body.error)) ||
          (Array.isArray(body?.non_field_errors) && body.non_field_errors[0]) ||
          err?.message ||
          'Unknown error';
        const reason = status ? `${status}: ${message}` : String(message);
        // eslint-disable-next-line no-console
        console.error('[translatePostComment] failed', { commentId, status, body, err });
        setErrorById((prev) => ({ ...prev, [commentId]: reason }));
      } finally {
        setLoadingById((prev) => ({ ...prev, [commentId]: false }));
      }
    },
    [token, postUuid, loadingById],
  );

  const showOriginal = useCallback((commentId: number) => {
    setTranslatedById((prev) => {
      if (!(commentId in prev)) return prev;
      const next = { ...prev };
      delete next[commentId];
      return next;
    });
    setErrorById((prev) => {
      if (!(commentId in prev)) return prev;
      const next = { ...prev };
      delete next[commentId];
      return next;
    });
  }, []);

  return { translatedById, loadingById, errorById, translate, showOriginal };
}
