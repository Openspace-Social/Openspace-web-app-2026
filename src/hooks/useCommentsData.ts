/**
 * useCommentsData — comments + replies state and CRUD for the native feed.
 *
 * Mirrors the pattern of useFeedData: the hook owns its slice of state and
 * exposes handlers that PostCard expects. Called from FeedScreenContainer
 * and threaded into useNativePostInteractions so ConnectedPostCard sees
 * real handlers instead of stubs.
 *
 * Scope of this first pass:
 *   - Load comments on-demand when the comment box opens.
 *   - Create / edit / delete top-level comments (text only).
 *   - Load replies for a comment on demand.
 *   - Create / edit / delete replies (text only).
 *   - Track per-comment mutation loading + editing states so the UI reflects in-flight work.
 *
 * Out of scope for this pass (stubs remain):
 *   - Image / GIF drafts on comments and replies.
 *   - Reactions on comments.
 */

import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, type FeedPost, type PostComment } from '../api/client';
import { useGifPicker } from '../components/GifPickerProvider';

type Bool = Record<number, boolean>;
type CommentsMap = Record<number, PostComment[]>;

// Stored draft media on a comment / reply. PostCard's `CommentDraftMedia`
// only declares `kind` + `uri` for previews; we keep additional native
// upload metadata (type, name) so FormData can attach the file on submit.
type DraftMedia = {
  kind: 'image' | 'gif';
  uri: string;
  type?: string;
  name?: string;
};
type DraftMediaMap = Record<number, DraftMedia | null>;

export type UseCommentsDataResult = {
  // State
  localComments: CommentsMap;
  commentBoxPostIds: Bool;
  commentsLoadingByPost: Bool;
  commentRepliesById: CommentsMap;
  commentRepliesExpanded: Bool;
  commentRepliesLoadingById: Bool;
  editingCommentById: Bool;
  editingReplyById: Bool;
  commentMutationLoadingById: Bool;
  draftCommentMediaByPostId: DraftMediaMap;
  draftReplyMediaByCommentId: DraftMediaMap;

  // Handlers
  loadComments: (postId: number) => Promise<void>;
  toggleCommentBox: (postId: number) => void;
  submitComment: (postId: number, text: string) => Promise<void>;
  toggleCommentReplies: (postId: number, commentId: number) => void;
  submitReply: (postId: number, commentId: number, text: string) => Promise<void>;
  startEditingComment: (commentId: number, currentText: string, isReply: boolean) => void;
  cancelEditingComment: (commentId: number, isReply: boolean) => void;
  saveEditedComment: (
    postId: number,
    commentId: number,
    isReply: boolean,
    text: string,
    parentCommentId?: number,
  ) => Promise<void>;
  deleteComment: (
    postId: number,
    commentId: number,
    isReply: boolean,
    parentCommentId?: number,
  ) => Promise<void>;
  pickDraftCommentImage: (postId: number) => Promise<void>;
  pickDraftReplyImage: (commentId: number) => Promise<void>;
  setDraftCommentGif: (postId: number) => void;
  setDraftReplyGif: (commentId: number) => void;
  clearDraftCommentMedia: (postId: number) => void;
  clearDraftReplyMedia: (commentId: number) => void;
};

export function useCommentsData(token: string | null, posts: FeedPost[]): UseCommentsDataResult {
  const [localComments, setLocalComments] = useState<CommentsMap>({});
  const [commentBoxPostIds, setCommentBoxPostIds] = useState<Bool>({});
  const [commentsLoadingByPost, setCommentsLoadingByPost] = useState<Bool>({});
  const [commentRepliesById, setCommentRepliesById] = useState<CommentsMap>({});
  const [commentRepliesExpanded, setCommentRepliesExpanded] = useState<Bool>({});
  const [commentRepliesLoadingById, setCommentRepliesLoadingById] = useState<Bool>({});
  const [editingCommentById, setEditingCommentById] = useState<Bool>({});
  const [editingReplyById, setEditingReplyById] = useState<Bool>({});
  const [commentMutationLoadingById, setCommentMutationLoadingById] = useState<Bool>({});
  const [draftCommentMediaByPostId, setDraftCommentMediaByPostId] = useState<DraftMediaMap>({});
  const [draftReplyMediaByCommentId, setDraftReplyMediaByCommentId] = useState<DraftMediaMap>({});

  const resolveUuid = useCallback(
    (postId: number): string | undefined => {
      const match = posts.find((p) => (p as any).id === postId);
      return (match as any)?.uuid;
    },
    [posts],
  );

  const loadComments = useCallback(
    async (postId: number) => {
      const postUuid = resolveUuid(postId);
      if (!token || !postUuid) return;
      setCommentsLoadingByPost((prev) => ({ ...prev, [postId]: true }));
      try {
        const comments = await api.getPostComments(token, postUuid);
        setLocalComments((prev) => ({ ...prev, [postId]: comments }));
      } catch {
        // Surface via caller — silent failure keeps the UI usable.
      } finally {
        setCommentsLoadingByPost((prev) => ({ ...prev, [postId]: false }));
      }
    },
    [token, resolveUuid],
  );

  const toggleCommentBox = useCallback(
    (postId: number) => {
      setCommentBoxPostIds((prev) => {
        const wasOpen = !!prev[postId];
        if (!wasOpen && !localComments[postId]) {
          void loadComments(postId);
        }
        return { ...prev, [postId]: !wasOpen };
      });
    },
    [localComments, loadComments],
  );

  const submitComment = useCallback(
    async (postId: number, text: string) => {
      const postUuid = resolveUuid(postId);
      const trimmed = text.trim();
      const media = draftCommentMediaByPostId[postId] || null;
      // Posts without text are still valid as long as they carry media.
      if (!token || !postUuid || (!trimmed && !media)) return;
      try {
        const newComment = await api.createPostComment(token, postUuid, {
          text: trimmed,
          image: media?.kind === 'image'
            ? ({ uri: media.uri, type: media.type || 'image/jpeg', name: media.name || 'comment-image.jpg' } as any)
            : null,
          gif_url: media?.kind === 'gif' ? media.uri : undefined,
        });
        setLocalComments((prev) => ({
          ...prev,
          [postId]: [...(prev[postId] || []), newComment],
        }));
        // Clear draft media now that it's attached to a real comment.
        setDraftCommentMediaByPostId((prev) => ({ ...prev, [postId]: null }));
      } catch {
        // no-op; parent UI surfaces via toast if needed later
      }
    },
    [token, resolveUuid, draftCommentMediaByPostId],
  );

  const loadReplies = useCallback(
    async (postId: number, commentId: number) => {
      const postUuid = resolveUuid(postId);
      if (!token || !postUuid) return;
      setCommentRepliesLoadingById((prev) => ({ ...prev, [commentId]: true }));
      try {
        const replies = await api.getPostCommentReplies(token, postUuid, commentId);
        setCommentRepliesById((prev) => ({ ...prev, [commentId]: replies }));
      } catch {
        // silent
      } finally {
        setCommentRepliesLoadingById((prev) => ({ ...prev, [commentId]: false }));
      }
    },
    [token, resolveUuid],
  );

  const toggleCommentReplies = useCallback(
    (postId: number, commentId: number) => {
      setCommentRepliesExpanded((prev) => {
        const wasOpen = !!prev[commentId];
        if (!wasOpen && !commentRepliesById[commentId]) {
          void loadReplies(postId, commentId);
        }
        return { ...prev, [commentId]: !wasOpen };
      });
    },
    [commentRepliesById, loadReplies],
  );

  const submitReply = useCallback(
    async (postId: number, commentId: number, text: string) => {
      const postUuid = resolveUuid(postId);
      const trimmed = text.trim();
      const media = draftReplyMediaByCommentId[commentId] || null;
      if (!token || !postUuid || (!trimmed && !media)) return;
      try {
        const newReply = await api.createPostCommentReply(token, postUuid, commentId, {
          text: trimmed,
          image: media?.kind === 'image'
            ? ({ uri: media.uri, type: media.type || 'image/jpeg', name: media.name || 'reply-image.jpg' } as any)
            : null,
          gif_url: media?.kind === 'gif' ? media.uri : undefined,
        });
        setCommentRepliesById((prev) => ({
          ...prev,
          [commentId]: [...(prev[commentId] || []), newReply],
        }));
        // Auto-expand so the new reply is visible.
        setCommentRepliesExpanded((prev) => ({ ...prev, [commentId]: true }));
        setDraftReplyMediaByCommentId((prev) => ({ ...prev, [commentId]: null }));
      } catch {
        // no-op
      }
    },
    [token, resolveUuid, draftReplyMediaByCommentId],
  );

  const startEditingComment = useCallback(
    (commentId: number, _currentText: string, isReply: boolean) => {
      if (isReply) {
        setEditingReplyById((prev) => ({ ...prev, [commentId]: true }));
      } else {
        setEditingCommentById((prev) => ({ ...prev, [commentId]: true }));
      }
    },
    [],
  );

  const cancelEditingComment = useCallback(
    (commentId: number, isReply: boolean) => {
      if (isReply) {
        setEditingReplyById((prev) => ({ ...prev, [commentId]: false }));
      } else {
        setEditingCommentById((prev) => ({ ...prev, [commentId]: false }));
      }
    },
    [],
  );

  const saveEditedComment = useCallback(
    async (
      postId: number,
      commentId: number,
      isReply: boolean,
      text: string,
      parentCommentId?: number,
    ) => {
      const postUuid = resolveUuid(postId);
      const trimmed = text.trim();
      if (!token || !postUuid || !trimmed) return;
      setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: true }));
      try {
        const updated = await api.updatePostComment(token, postUuid, commentId, trimmed);
        if (isReply && parentCommentId) {
          setCommentRepliesById((prev) => ({
            ...prev,
            [parentCommentId]: (prev[parentCommentId] || []).map((r) =>
              (r as any).id === commentId ? updated : r,
            ),
          }));
          setEditingReplyById((prev) => ({ ...prev, [commentId]: false }));
        } else {
          setLocalComments((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).map((c) => ((c as any).id === commentId ? updated : c)),
          }));
          setEditingCommentById((prev) => ({ ...prev, [commentId]: false }));
        }
      } catch {
        // Leave editing state on failure so user can retry.
      } finally {
        setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: false }));
      }
    },
    [token, resolveUuid],
  );

  const deleteComment = useCallback(
    async (
      postId: number,
      commentId: number,
      isReply: boolean,
      parentCommentId?: number,
    ) => {
      const postUuid = resolveUuid(postId);
      if (!token || !postUuid) return;
      setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: true }));
      try {
        await api.deletePostComment(token, postUuid, commentId);
        if (isReply && parentCommentId) {
          setCommentRepliesById((prev) => ({
            ...prev,
            [parentCommentId]: (prev[parentCommentId] || []).filter(
              (r) => (r as any).id !== commentId,
            ),
          }));
        } else {
          setLocalComments((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).filter((c) => (c as any).id !== commentId),
          }));
        }
      } catch {
        // silent
      } finally {
        setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: false }));
      }
    },
    [token, resolveUuid],
  );

  // ── Draft media handlers (image picker + GIF URL prompt) ──────────────
  // Mirrors the web composer: an image goes through the system picker so
  // we capture a real file (uri/type/name) for FormData; a GIF is just a
  // remote URL the backend will fetch.

  const pickImage = useCallback(async (): Promise<DraftMedia | null> => {
    try {
      // iOS 14+ uses PHPickerViewController under the hood, which doesn't
      // require photo-library permission. Skipping the upfront request
      // avoids a silent denial path that made nothing happen on first tap.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        allowsEditing: false,
      });
      if (result.canceled) return null;
      const asset = result.assets?.[0];
      if (!asset?.uri) return null;
      const name = (asset as any).fileName || asset.uri.split('/').pop() || 'comment-image.jpg';
      const type = (asset as any).mimeType || 'image/jpeg';
      return { kind: 'image', uri: asset.uri, type, name };
    } catch (e) {
      // Surface the failure rather than silently swallowing it.
      Alert.alert('Photo picker', (e as any)?.message || 'Could not open the photo library.');
      return null;
    }
  }, []);

  // Giphy search modal — exposed via the app-level GifPickerProvider so it
  // works the same in comment composers, reply composers, and any future
  // caller (the post composer would slot in trivially).
  const gifPicker = useGifPicker();
  const promptGifUrl = useCallback(async (): Promise<string | null> => {
    return await gifPicker.open();
  }, [gifPicker]);

  const isLikelyUrl = (s: string) => /^https?:\/\//i.test(s);

  const pickDraftCommentImage = useCallback(async (postId: number) => {
    const media = await pickImage();
    if (media) setDraftCommentMediaByPostId((prev) => ({ ...prev, [postId]: media }));
  }, [pickImage]);

  const pickDraftReplyImage = useCallback(async (commentId: number) => {
    const media = await pickImage();
    if (media) setDraftReplyMediaByCommentId((prev) => ({ ...prev, [commentId]: media }));
  }, [pickImage]);

  const setDraftCommentGif = useCallback(async (postId: number) => {
    const url = await promptGifUrl();
    if (!url || !isLikelyUrl(url)) return;
    setDraftCommentMediaByPostId((prev) => ({ ...prev, [postId]: { kind: 'gif', uri: url } }));
  }, [promptGifUrl]);

  const setDraftReplyGif = useCallback(async (commentId: number) => {
    const url = await promptGifUrl();
    if (!url || !isLikelyUrl(url)) return;
    setDraftReplyMediaByCommentId((prev) => ({ ...prev, [commentId]: { kind: 'gif', uri: url } }));
  }, [promptGifUrl]);

  const clearDraftCommentMedia = useCallback((postId: number) => {
    setDraftCommentMediaByPostId((prev) => ({ ...prev, [postId]: null }));
  }, []);

  const clearDraftReplyMedia = useCallback((commentId: number) => {
    setDraftReplyMediaByCommentId((prev) => ({ ...prev, [commentId]: null }));
  }, []);

  return {
    localComments,
    commentBoxPostIds,
    commentsLoadingByPost,
    commentRepliesById,
    commentRepliesExpanded,
    commentRepliesLoadingById,
    editingCommentById,
    editingReplyById,
    commentMutationLoadingById,
    loadComments,
    toggleCommentBox,
    submitComment,
    toggleCommentReplies,
    submitReply,
    startEditingComment,
    cancelEditingComment,
    saveEditedComment,
    deleteComment,
    draftCommentMediaByPostId,
    draftReplyMediaByCommentId,
    pickDraftCommentImage,
    pickDraftReplyImage,
    setDraftCommentGif,
    setDraftReplyGif,
    clearDraftCommentMedia,
    clearDraftReplyMedia,
  };
}
