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

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { normalizeImageForUpload } from '../utils/normalizeImage';
import { api, type FeedPost, type PostComment } from '../api/client';
import { useGifPicker } from '../components/GifPickerProvider';
import { extractCommenterFromUser, hydrateCommenter } from '../utils/hydrateCommenter';
import {
  fetchAndCacheCurrentUser,
  getCachedCurrentUser,
} from '../utils/currentUserCache';
import { emitPostCommentCountUpdate } from '../utils/postUpdates';

type CurrentCommenter = NonNullable<PostComment['commenter']>;

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
  // Pagination — per-post cursor tracking for "load more" comments.
  // - HasMore is set on the initial load if the first page came back
  //   full (>= page size). Subsequent loadMore calls also re-set it.
  // - LoadingMore is true while a paginated fetch is in flight (separate
  //   from the initial-load flag so the UI can show a footer spinner).
  commentsHasMoreByPost: Bool;
  commentsLoadingMoreByPost: Bool;
  commentRepliesById: CommentsMap;
  commentRepliesExpanded: Bool;
  commentRepliesLoadingById: Bool;
  // Same pagination triple, per-comment, for replies.
  repliesHasMoreByComment: Bool;
  repliesLoadingMoreByComment: Bool;
  editingCommentById: Bool;
  editingReplyById: Bool;
  commentMutationLoadingById: Bool;
  draftCommentMediaByPostId: DraftMediaMap;
  draftReplyMediaByCommentId: DraftMediaMap;

  // Handlers
  loadComments: (postId: number) => Promise<void>;
  loadMoreComments: (postId: number) => Promise<void>;
  toggleCommentBox: (postId: number) => void;
  submitComment: (postId: number, text: string) => Promise<void>;
  toggleCommentReplies: (postId: number, commentId: number) => void;
  loadMoreReplies: (postId: number, commentId: number) => Promise<void>;
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
  /** Toggle a reaction on a comment OR a reply. Caller doesn't need to
   *  pre-classify which kind it is — the hook locates the target by id
   *  across both `localComments` and `commentRepliesById`. If the user's
   *  current reaction matches `emojiId` the reaction is removed,
   *  otherwise the new emoji is set. Optimistic UI with rollback on
   *  failure. */
  reactToComment: (postId: number, commentId: number, emojiId?: number) => Promise<void>;
  pickDraftCommentImage: (postId: number) => Promise<void>;
  pickDraftReplyImage: (commentId: number) => Promise<void>;
  /** Read an image off the system clipboard and attach it as the draft.
   *  No-op (with a notice) when the clipboard has no image. */
  pasteDraftCommentImage: (postId: number) => Promise<void>;
  pasteDraftReplyImage: (commentId: number) => Promise<void>;
  setDraftCommentGif: (postId: number) => void;
  setDraftReplyGif: (commentId: number) => void;
  clearDraftCommentMedia: (postId: number) => void;
  clearDraftReplyMedia: (commentId: number) => void;
};

export function useCommentsData(token: string | null, posts: FeedPost[]): UseCommentsDataResult {
  const [localComments, setLocalComments] = useState<CommentsMap>({});
  const [commentBoxPostIds, setCommentBoxPostIds] = useState<Bool>({});
  const [commentsLoadingByPost, setCommentsLoadingByPost] = useState<Bool>({});
  // Pagination state for top-level comments. min_id cursor (server returns
  // a full page sorted ASC by id; we track the max id we've seen and pass
  // it back as min_id for the next page).
  const [commentsHasMoreByPost, setCommentsHasMoreByPost] = useState<Bool>({});
  const [commentsLoadingMoreByPost, setCommentsLoadingMoreByPost] = useState<Bool>({});
  const [commentsMaxIdByPost, setCommentsMaxIdByPost] = useState<Record<number, number>>({});
  const [commentRepliesById, setCommentRepliesById] = useState<CommentsMap>({});
  const [commentRepliesExpanded, setCommentRepliesExpanded] = useState<Bool>({});
  const [commentRepliesLoadingById, setCommentRepliesLoadingById] = useState<Bool>({});
  // Pagination state for replies (same cursor pattern as comments, but
  // scoped per parent commentId).
  const [repliesHasMoreByComment, setRepliesHasMoreByComment] = useState<Bool>({});
  const [repliesLoadingMoreByComment, setRepliesLoadingMoreByComment] = useState<Bool>({});
  const [repliesMaxIdByComment, setRepliesMaxIdByComment] = useState<Record<number, number>>({});
  const [editingCommentById, setEditingCommentById] = useState<Bool>({});
  const [editingReplyById, setEditingReplyById] = useState<Bool>({});
  const [commentMutationLoadingById, setCommentMutationLoadingById] = useState<Bool>({});
  const [draftCommentMediaByPostId, setDraftCommentMediaByPostId] = useState<DraftMediaMap>({});
  const [draftReplyMediaByCommentId, setDraftReplyMediaByCommentId] = useState<DraftMediaMap>({});

  // The POST /comments endpoint can return a comment without its embedded
  // `commenter` (the GET endpoint always expands it). Cache the current user
  // so we can fill in the missing author on optimistic inserts — otherwise
  // the freshly-posted comment renders as "@unknown" until reload.
  //
  // Seed the ref from the shared module-level cache so subsequent hook
  // mounts in the same session start with the right value (eliminates the
  // "post a comment immediately on opening a post" race that previously
  // produced "@unknown" until refresh). The effect still refreshes from
  // the server in the background so a profile change picked up elsewhere
  // eventually propagates.
  const currentCommenterRef = useRef<CurrentCommenter | null>(
    extractCommenterFromUser(getCachedCurrentUser()),
  );
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const me = await fetchAndCacheCurrentUser(token);
      if (cancelled || !me) return;
      currentCommenterRef.current = extractCommenterFromUser(me);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const resolveUuid = useCallback(
    (postId: number): string | undefined => {
      const match = posts.find((p) => (p as any).id === postId);
      return (match as any)?.uuid;
    },
    [posts],
  );

  // Comment/reply page size — matches the API's hard cap (count_max in
  // api.getPostComments / getPostCommentReplies). The server returns at
  // most this many per request regardless of what we ask for.
  const COMMENTS_PAGE_SIZE = 20;

  const loadComments = useCallback(
    async (postId: number) => {
      const postUuid = resolveUuid(postId);
      if (!token || !postUuid) return;
      setCommentsLoadingByPost((prev) => ({ ...prev, [postId]: true }));
      try {
        const comments = await api.getPostComments(token, postUuid);
        setLocalComments((prev) => ({ ...prev, [postId]: comments }));
        // Cursor + hasMore: if we got a full page back, assume there's
        // more (we can't know for sure without an extra round-trip).
        // maxId is the largest id in this batch — passed as min_id to
        // the next fetch (ASC sort means "give me ids strictly > X").
        const maxId = comments.length > 0
          ? Math.max(...comments.map((cmt) => (cmt as any).id || 0))
          : 0;
        setCommentsMaxIdByPost((prev) => ({ ...prev, [postId]: maxId }));
        setCommentsHasMoreByPost((prev) => ({
          ...prev,
          [postId]: comments.length >= COMMENTS_PAGE_SIZE,
        }));
      } catch {
        // Surface via caller — silent failure keeps the UI usable.
      } finally {
        setCommentsLoadingByPost((prev) => ({ ...prev, [postId]: false }));
      }
    },
    [token, resolveUuid],
  );

  const loadMoreComments = useCallback(
    async (postId: number) => {
      const postUuid = resolveUuid(postId);
      if (!token || !postUuid) return;
      // Guard against double-firing if the user mashes the button.
      if (commentsLoadingMoreByPost[postId]) return;
      const minId = commentsMaxIdByPost[postId];
      if (!minId) return; // shouldn't happen — initial load sets it
      setCommentsLoadingMoreByPost((prev) => ({ ...prev, [postId]: true }));
      try {
        const more = await api.getPostComments(token, postUuid, COMMENTS_PAGE_SIZE, minId);
        if (more.length > 0) {
          setLocalComments((prev) => ({
            ...prev,
            [postId]: [...(prev[postId] || []), ...more],
          }));
          const newMax = Math.max(minId, ...more.map((cmt) => (cmt as any).id || 0));
          setCommentsMaxIdByPost((prev) => ({ ...prev, [postId]: newMax }));
        }
        setCommentsHasMoreByPost((prev) => ({
          ...prev,
          [postId]: more.length >= COMMENTS_PAGE_SIZE,
        }));
      } catch {
        // silent — keep existing comments, hasMore unchanged so user can retry
      } finally {
        setCommentsLoadingMoreByPost((prev) => ({ ...prev, [postId]: false }));
      }
    },
    [token, resolveUuid, commentsLoadingMoreByPost, commentsMaxIdByPost],
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
        const hydrated = hydrateCommenter(newComment, currentCommenterRef.current);
        setLocalComments((prev) => ({
          ...prev,
          [postId]: [...(prev[postId] || []), hydrated],
        }));
        // Clear draft media now that it's attached to a real comment.
        setDraftCommentMediaByPostId((prev) => ({ ...prev, [postId]: null }));
        // Broadcast the count bump so every mounted copy of this post —
        // feed cards, profile lists, etc. — keeps its comments_count in
        // sync. Without this, going back to the feed after commenting
        // shows the stale pre-comment count until the next refresh.
        emitPostCommentCountUpdate(postId, { delta: 1 });
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
        // Same pagination bookkeeping as loadComments — track cursor
        // and "is there more" so the UI can show "Load more replies".
        const maxId = replies.length > 0
          ? Math.max(...replies.map((rp) => (rp as any).id || 0))
          : 0;
        setRepliesMaxIdByComment((prev) => ({ ...prev, [commentId]: maxId }));
        setRepliesHasMoreByComment((prev) => ({
          ...prev,
          [commentId]: replies.length >= COMMENTS_PAGE_SIZE,
        }));
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

  const loadMoreReplies = useCallback(
    async (postId: number, commentId: number) => {
      const postUuid = resolveUuid(postId);
      if (!token || !postUuid) return;
      if (repliesLoadingMoreByComment[commentId]) return;
      const minId = repliesMaxIdByComment[commentId];
      if (!minId) return;
      setRepliesLoadingMoreByComment((prev) => ({ ...prev, [commentId]: true }));
      try {
        const more = await api.getPostCommentReplies(
          token,
          postUuid,
          commentId,
          COMMENTS_PAGE_SIZE,
          minId,
        );
        if (more.length > 0) {
          setCommentRepliesById((prev) => ({
            ...prev,
            [commentId]: [...(prev[commentId] || []), ...more],
          }));
          const newMax = Math.max(minId, ...more.map((rp) => (rp as any).id || 0));
          setRepliesMaxIdByComment((prev) => ({ ...prev, [commentId]: newMax }));
        }
        setRepliesHasMoreByComment((prev) => ({
          ...prev,
          [commentId]: more.length >= COMMENTS_PAGE_SIZE,
        }));
      } catch {
        // silent — preserve existing replies and hasMore so user can retry
      } finally {
        setRepliesLoadingMoreByComment((prev) => ({ ...prev, [commentId]: false }));
      }
    },
    [token, resolveUuid, repliesLoadingMoreByComment, repliesMaxIdByComment],
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
        const hydrated = hydrateCommenter(newReply, currentCommenterRef.current);
        setCommentRepliesById((prev) => ({
          ...prev,
          [commentId]: [...(prev[commentId] || []), hydrated],
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
          // Replies don't contribute to post.comments_count (that's
          // top-level comments only), so no broadcast here.
        } else {
          setLocalComments((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).filter((c) => (c as any).id !== commentId),
          }));
          // Decrement broadcast — every other mounted copy of this post
          // updates its comments_count accordingly. Subscriber clamps to ≥0.
          emitPostCommentCountUpdate(postId, { delta: -1 });
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
      // Normalize HEIC/HEIF (iOS Photos default) → JPEG before we hand
      // the URI to FormData. Backend Pillow can't decode HEIF without
      // `pillow-heif`, and pre-converting also makes the upload smaller.
      const normalizedUri = await normalizeImageForUpload(asset.uri);
      return { kind: 'image', uri: normalizedUri, type: 'image/jpeg', name: 'comment-image.jpg' };
    } catch (e) {
      // Surface the failure rather than silently swallowing it.
      Alert.alert('Photo picker', (e as any)?.message || 'Could not open the photo library.');
      return null;
    }
  }, []);

  // Pull an image off the OS clipboard (iOS UIPasteboard / Android
  // ClipboardManager) and normalize it through the same JPEG/cap pipeline
  // we use for picked images, so backends never see HEIC or 20-MP payloads.
  const pasteImageFromClipboard = useCallback(async (): Promise<DraftMedia | null> => {
    try {
      const hasImage = await Clipboard.hasImageAsync();
      if (!hasImage) {
        Alert.alert(
          'Paste image',
          'No image found in clipboard. Copy an image first.',
        );
        return null;
      }
      const result = await Clipboard.getImageAsync({ format: 'jpeg' });
      if (!result?.data) return null;
      // Expo Clipboard returns `data` already prefixed as a data URL,
      // which expo-image-manipulator accepts as an input URI.
      const normalizedUri = await normalizeImageForUpload(result.data);
      return { kind: 'image', uri: normalizedUri, type: 'image/jpeg', name: 'pasted-image.jpg' };
    } catch (e) {
      Alert.alert('Paste image', (e as any)?.message || 'Could not read image from clipboard.');
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

  const pasteDraftCommentImage = useCallback(async (postId: number) => {
    const media = await pasteImageFromClipboard();
    if (media) setDraftCommentMediaByPostId((prev) => ({ ...prev, [postId]: media }));
  }, [pasteImageFromClipboard]);

  const pasteDraftReplyImage = useCallback(async (commentId: number) => {
    const media = await pasteImageFromClipboard();
    if (media) setDraftReplyMediaByCommentId((prev) => ({ ...prev, [commentId]: media }));
  }, [pasteImageFromClipboard]);

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

  // ── reactToComment ────────────────────────────────────────────────────
  // Single handler that works for both top-level comments AND replies.
  // The caller (PostInteractionsValue.onReactToComment) only knows the
  // comment id, so we have to discover whether it lives in localComments
  // (top-level) or in commentRepliesById (a reply nested under a parent).
  // Once located, the optimistic update mutates whichever state slice
  // owns the comment, the API call uses `api.reactToPostComment` /
  // `removeReactionFromPostComment` (both work for any comment id —
  // backend treats top-level and replies as the same model), and on
  // failure we restore the original comment object.
  const reactToComment = useCallback(
    async (postId: number, commentId: number, emojiId?: number): Promise<void> => {
      if (!token || !emojiId) return;
      const postUuid = resolveUuid(postId);
      if (!postUuid) return;

      // Find the comment — could be a top-level comment OR a reply under
      // any parent. Capture the original so we can roll back on failure.
      let kind: 'top' | 'reply' | null = null;
      let parentId: number | null = null;
      let original: PostComment | null = null;

      const topLevelHit = (localComments[postId] || []).find((c) => c.id === commentId);
      if (topLevelHit) {
        kind = 'top';
        original = topLevelHit;
      } else {
        for (const [pid, replies] of Object.entries(commentRepliesById)) {
          const replyHit = (replies || []).find((r) => r.id === commentId);
          if (replyHit) {
            kind = 'reply';
            parentId = Number(pid);
            original = replyHit;
            break;
          }
        }
      }

      if (!kind || !original) return;

      const isAlreadyMyReaction = original.reaction?.emoji?.id === emojiId;

      // Build the optimistic next-state for ONE comment object. Same
      // shape regardless of whether it's a top-level or reply, because
      // PostComment is a single model on the backend.
      const optimisticPatch = (c: PostComment): PostComment => {
        if (c.id !== commentId) return c;
        if (isAlreadyMyReaction) {
          return {
            ...c,
            reaction: undefined,
            reactions_emoji_counts: (c.reactions_emoji_counts || [])
              .map((e) => (e.emoji?.id === emojiId ? { ...e, count: Math.max(0, (e.count || 1) - 1) } : e))
              .filter((e) => (e.count || 0) > 0),
          };
        }
        const prevEmojiId = c.reaction?.emoji?.id;
        const emojiMeta = (c.reactions_emoji_counts || []).find((e) => e.emoji?.id === emojiId)?.emoji;
        const counts = c.reactions_emoji_counts || [];
        const hasEmoji = counts.some((e) => e.emoji?.id === emojiId);
        const nextCounts = hasEmoji
          ? counts.map((e) => {
              if (e.emoji?.id === emojiId) return { ...e, count: (e.count || 0) + 1 };
              if (prevEmojiId && e.emoji?.id === prevEmojiId) return { ...e, count: Math.max(0, (e.count || 1) - 1) };
              return e;
            })
          : [...counts.map((e) => (prevEmojiId && e.emoji?.id === prevEmojiId ? { ...e, count: Math.max(0, (e.count || 1) - 1) } : e)), { count: 1, emoji: emojiMeta }];
        return {
          ...c,
          reaction: emojiMeta ? ({ emoji: emojiMeta } as any) : c.reaction,
          reactions_emoji_counts: nextCounts.filter((e) => (e.count || 0) > 0),
        };
      };

      if (kind === 'top') {
        setLocalComments((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).map(optimisticPatch),
        }));
      } else if (kind === 'reply' && parentId != null) {
        setCommentRepliesById((prev) => ({
          ...prev,
          [parentId]: (prev[parentId] || []).map(optimisticPatch),
        }));
      }

      try {
        if (isAlreadyMyReaction) {
          await api.removeReactionFromPostComment(token, postUuid, commentId);
        } else {
          // Reconcile with the server's canonical reaction object + count
          // so the emoji metadata (image, keyword) is always correct.
          const reaction = await api.reactToPostComment(token, postUuid, commentId, emojiId);
          const counts = await api.getPostCommentReactionCounts(token, postUuid, commentId);
          const reconcilePatch = (c: PostComment): PostComment =>
            c.id === commentId ? { ...c, reaction: reaction as any, reactions_emoji_counts: counts as any } : c;
          if (kind === 'top') {
            setLocalComments((prev) => ({
              ...prev,
              [postId]: (prev[postId] || []).map(reconcilePatch),
            }));
          } else if (kind === 'reply' && parentId != null) {
            setCommentRepliesById((prev) => ({
              ...prev,
              [parentId]: (prev[parentId] || []).map(reconcilePatch),
            }));
          }
        }
      } catch {
        // Roll back to the captured original on any API failure.
        const rollbackPatch = (c: PostComment): PostComment => (c.id === commentId && original ? original : c);
        if (kind === 'top') {
          setLocalComments((prev) => ({
            ...prev,
            [postId]: (prev[postId] || []).map(rollbackPatch),
          }));
        } else if (kind === 'reply' && parentId != null) {
          setCommentRepliesById((prev) => ({
            ...prev,
            [parentId]: (prev[parentId] || []).map(rollbackPatch),
          }));
        }
      }
    },
    [token, resolveUuid, localComments, commentRepliesById],
  );

  return {
    localComments,
    commentBoxPostIds,
    commentsLoadingByPost,
    commentsHasMoreByPost,
    commentsLoadingMoreByPost,
    commentRepliesById,
    commentRepliesExpanded,
    commentRepliesLoadingById,
    repliesHasMoreByComment,
    repliesLoadingMoreByComment,
    editingCommentById,
    editingReplyById,
    commentMutationLoadingById,
    loadComments,
    loadMoreComments,
    toggleCommentBox,
    submitComment,
    toggleCommentReplies,
    loadMoreReplies,
    submitReply,
    startEditingComment,
    cancelEditingComment,
    saveEditedComment,
    deleteComment,
    reactToComment,
    draftCommentMediaByPostId,
    draftReplyMediaByCommentId,
    pickDraftCommentImage,
    pickDraftReplyImage,
    pasteDraftCommentImage,
    pasteDraftReplyImage,
    setDraftCommentGif,
    setDraftReplyGif,
    clearDraftCommentMedia,
    clearDraftReplyMedia,
  };
}
