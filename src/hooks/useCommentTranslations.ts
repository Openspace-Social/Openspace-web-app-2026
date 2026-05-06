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
  errorById: ByIdMap<boolean>;
  translate: (commentId: number) => Promise<void>;
  showOriginal: (commentId: number) => void;
};

export function useCommentTranslations(
  token: string | null,
  postUuid: string | undefined,
): UseCommentTranslationsResult {
  const [translatedById, setTranslatedById] = useState<ByIdMap<string>>({});
  const [loadingById, setLoadingById] = useState<ByIdMap<boolean>>({});
  const [errorById, setErrorById] = useState<ByIdMap<boolean>>({});

  const translate = useCallback(
    async (commentId: number) => {
      if (!token || !postUuid || !commentId) return;
      // Guard against double-tap while in flight. Reading from the latest
      // setter callback would be ideal but the React state read in a
      // closure is acceptable here — a single redundant request is
      // cheaper than the bookkeeping for a perfect lock.
      if (loadingById[commentId]) return;
      setLoadingById((prev) => ({ ...prev, [commentId]: true }));
      setErrorById((prev) => ({ ...prev, [commentId]: false }));
      try {
        const result = await api.translatePostComment(token, postUuid, commentId);
        setTranslatedById((prev) => ({ ...prev, [commentId]: result.translated_text }));
      } catch {
        setErrorById((prev) => ({ ...prev, [commentId]: true }));
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
