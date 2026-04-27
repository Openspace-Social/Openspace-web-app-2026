/**
 * useNativePostInteractions — builds a PostInteractionsValue for the native
 * navigator.
 *
 * Reactions are backed by useFeedData (they already work in the native
 * feed). Post navigation is backed by react-navigation. Everything else —
 * comments, share, repost, delete, edit, pin, report, long-post edit, etc.
 * — currently falls back to a "coming soon" toast so the PostCard UI
 * remains fully interactive visually, with handlers progressively swapped
 * in as those features migrate off HomeScreen.
 *
 * Callers supply the reaction-related pieces from useFeedData; everything
 * else is constructed here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Share } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { api, type FeedPost } from '../api/client';
import type { UseCommentsDataResult } from './useCommentsData';
import { useAppToast } from '../toast/AppToastContext';
import { useAuth } from '../context/AuthContext';
import type { PostInteractionsValue } from '../contexts/PostInteractionsContext';
import type { ReactionGroup } from '../components/PostCard';
import type { HomeStackParamList } from '../navigation/AppNavigator';

type Input = {
  reactionGroups: ReactionGroup[];
  reactionPickerLoading: boolean;
  reactionActionLoading: boolean;
  ensureReactionGroups: () => Promise<void>;
  reactToPost: (post: FeedPost, emojiId: number) => Promise<void>;
  /** Open a reaction picker modal for this post — owned by FeedScreenContainer. */
  openReactionPicker: (post: FeedPost) => void;
  /** Full comments state + handlers from useCommentsData. */
  comments: UseCommentsDataResult;
  /** Remove a post from the local feed after a successful delete. */
  removePost?: (postId: number) => void;
  /** Patch a single post in place after a server-side mutation
   *  (e.g. pin / unpin) so the feed reflects the change immediately. */
  patchPost?: (postId: number, mutate: (p: FeedPost) => FeedPost) => void;
};

export function useNativePostInteractions({
  reactionGroups,
  reactionPickerLoading,
  reactionActionLoading,
  ensureReactionGroups,
  reactToPost,
  openReactionPicker,
  comments,
  removePost,
  patchPost,
}: Input): PostInteractionsValue {
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const { token } = useAuth();

  // Fetch the lower-cased names of every community the current user can
  // manage (creator, admin, or moderator) so per-post menus can show admin
  // actions on any post belonging to one of those communities — not just
  // when the user is on that community's dedicated page.
  const [manageableCommunityNames, setManageableCommunityNames] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!token) {
      setManageableCommunityNames(new Set());
      return;
    }
    let active = true;
    (async () => {
      try {
        const [adminRes, modRes] = await Promise.allSettled([
          api.getAdministratedCommunities(token, 20, 0),
          api.getModeratedCommunities(token, 20, 0),
        ]);
        if (!active) return;
        const next = new Set<string>();
        const collect = (rows: any[]) => {
          for (const c of rows || []) {
            const name = (c?.name || '').trim().toLowerCase();
            if (name) next.add(name);
          }
        };
        if (adminRes.status === 'fulfilled') collect(adminRes.value as any[]);
        if (modRes.status === 'fulfilled') collect(modRes.value as any[]);
        setManageableCommunityNames(next);
      } catch {
        // non-fatal — keep prior set
      }
    })();
    return () => { active = false; };
  }, [token]);

  const canManageCommunity = useCallback(
    (communityName?: string | null) => {
      if (!communityName) return false;
      return manageableCommunityNames.has(communityName.trim().toLowerCase());
    },
    [manageableCommunityNames],
  );

  // Local expand/collapse state for "show more" on long posts. Not API
  // backed — just UI state like the legacy HomeScreen keeps.
  const [expandedPostIds, setExpandedPostIds] = useState<Record<number, boolean>>({});
  const onToggleExpand = useCallback((postId: number) => {
    setExpandedPostIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
  }, []);

  const stub = useCallback(
    (label: string) => {
      showToast(
        t('home.actionComingSoon', {
          defaultValue: `${label} will return in the new navigator.`,
          action: label,
        }),
      );
    },
    [showToast, t],
  );

  // Helpers — mirror HomeScreen's implementations for text/length/counts.
  const getPostText = useCallback((post: FeedPost) => {
    const raw = (post as any)?.text || (post as any)?.text_content || '';
    return typeof raw === 'string' ? raw : '';
  }, []);

  const getPostLengthType = useCallback(
    (post: FeedPost): 'long' | 'short' => {
      const type = (post as any)?.type || (post as any)?.post_type;
      if (type === 'long' || type === 'article') return 'long';
      return 'short';
    },
    [],
  );

  const getPostReactionCount = useCallback((post: FeedPost) => {
    const emojis = (post as any)?.emoji_counts || (post as any)?.reactions_emoji_counts || [];
    if (!Array.isArray(emojis)) return 0;
    return emojis.reduce((sum: number, e: any) => sum + (e?.count || 0), 0);
  }, []);

  const getPostCommentsCount = useCallback(
    (post: FeedPost) => ((post as any)?.comments_count || 0),
    [],
  );

  return useMemo<PostInteractionsValue>(
    () => ({
      // ── State ─────────────────────────────────────────────────────
      expandedPostIds,
      commentBoxPostIds: comments.commentBoxPostIds,
      localComments: comments.localComments,
      commentRepliesById: comments.commentRepliesById,
      commentRepliesExpanded: comments.commentRepliesExpanded,
      commentRepliesLoadingById: comments.commentRepliesLoadingById,
      editingCommentById: comments.editingCommentById,
      editingReplyById: comments.editingReplyById,
      commentMutationLoadingById: comments.commentMutationLoadingById,
      draftCommentMediaByPostId: comments.draftCommentMediaByPostId,
      draftReplyMediaByCommentId: comments.draftReplyMediaByCommentId,
      followStateByUsername: {},
      followActionLoadingByUsername: {},
      reactionGroups,
      reactionPickerLoading,
      reactionActionLoading,

      // ── Reactions (real — backed by useFeedData) ──────────────────
      onEnsureReactionGroups: ensureReactionGroups,
      onReactToPostWithEmoji: async (post, emojiId) => {
        if (emojiId == null) return;
        await reactToPost(post, emojiId);
      },
      onOpenReactionPicker: (post) => {
        void ensureReactionGroups();
        openReactionPicker(post);
      },
      onOpenReactionList: () => {
        stub('Reaction details');
      },
      onReactToComment: () => {
        stub('Comment reactions');
      },

      // ── Navigation (real) ─────────────────────────────────────────
      onOpenPostDetail: (post) => {
        const uuid = (post as any)?.uuid;
        if (uuid) navigation.navigate('Post', { postUuid: uuid });
      },
      onNavigateProfile: (username) => navigation.navigate('Profile', { username }),
      onNavigateCommunity: (name) => navigation.navigate('Community', { name }),
      onNavigateHashtag: (name) => navigation.navigate('Hashtag', { name }),

      // ── Expand + Comments (real — backed by useCommentsData) ────────
      onToggleExpand,
      onToggleCommentBox: comments.toggleCommentBox,
      onToggleCommentReplies: comments.toggleCommentReplies,
      onSubmitComment: comments.submitComment,
      onSubmitReply: comments.submitReply,
      onStartEditingComment: comments.startEditingComment,
      onCancelEditingComment: comments.cancelEditingComment,
      onSaveEditedComment: comments.saveEditedComment,
      onDeleteComment: comments.deleteComment,

      // ── Stubs (coming soon) ───────────────────────────────────────
      onToggleFollow: () => stub('Follow'),
      onSharePost: async (post) => {
        const uuid = (post as any)?.uuid;
        const url = uuid ? `https://openspacelive.com/posts/${uuid}` : '';
        if (!url) {
          stub('Share');
          return;
        }
        try {
          await Share.share({ url, message: url });
        } catch {
          // User cancelled or system-level failure — no-op.
        }
      },
      onRepostPost: (post) => {
        // PostComposer lives on the root stack; the home stack's parent is
        // the tab navigator and its parent is the root stack.
        const root = navigation.getParent()?.getParent() ?? navigation.getParent();
        (root as any)?.navigate('PostComposer', { sharedPost: post });
      },
      onOpenLink: (url) => {
        if (!url) return;
        // Use the in-app browser (SFSafariViewController on iOS / Custom
        // Tabs on Android) so users stay in-context instead of jumping out
        // to the system Safari.
        void WebBrowser.openBrowserAsync(url).catch(() => {
          stub('Open link');
        });
      },
      onPickDraftCommentImage: comments.pickDraftCommentImage,
      onPickDraftReplyImage: comments.pickDraftReplyImage,
      onSetDraftCommentGif: comments.setDraftCommentGif,
      onSetDraftReplyGif: comments.setDraftReplyGif,
      onClearDraftCommentMedia: comments.clearDraftCommentMedia,
      onClearDraftReplyMedia: comments.clearDraftReplyMedia,
      onOpenReportPostModal: () => stub('Report post'),
      onReportComment: () => stub('Report comment'),
      onEditPost: async (post, text) => {
        const uuid = (post as any)?.uuid as string | undefined;
        const id = (post as any)?.id as number | undefined;
        const next = (text || '').trim();
        if (!token || !uuid || !next) return;
        try {
          const updated = await api.updatePost(token, uuid, next);
          if (typeof id === 'number') {
            patchPost?.(id, (current) => ({
              ...current,
              text: typeof updated?.text === 'string' ? updated.text : next,
              long_text: typeof (updated as any)?.long_text === 'string'
                ? (updated as any).long_text
                : (current as any).long_text,
            } as FeedPost));
          }
          showToast(t('home.editPostSuccess', { defaultValue: 'Post updated.' }), { type: 'success' });
        } catch (e: any) {
          showToast(
            e?.message || t('home.editPostError', { defaultValue: 'Could not update post.' }),
            { type: 'error' },
          );
          throw e;
        }
      },
      onOpenLongPostEdit: () => stub('Edit long post'),
      onDeletePost: async (post) => {
        const uuid = (post as any)?.uuid as string | undefined;
        const id = (post as any)?.id as number | undefined;
        if (!token || !uuid) {
          stub('Delete post');
          return;
        }
        try {
          await api.deletePost(token, uuid);
          if (typeof id === 'number') removePost?.(id);
          showToast(t('home.deletePostSuccess', { defaultValue: 'Post deleted.' }), { type: 'success' });
        } catch (e: any) {
          showToast(
            e?.message || t('home.deletePostError', { defaultValue: 'Could not delete post.' }),
            { type: 'error' },
          );
          throw e;
        }
      },
      onMovePostCommunities: () => stub('Move post'),
      onTogglePinPost: async (post) => {
        const uuid = (post as any)?.uuid as string | undefined;
        const id = (post as any)?.id as number | undefined;
        if (!token || !uuid) return;
        const wasPinned = !!(post as any)?.is_pinned;
        try {
          const updated = wasPinned
            ? await api.unpinPost(token, uuid)
            : await api.pinPost(token, uuid);
          const nextPinned =
            typeof (updated as any)?.is_pinned === 'boolean'
              ? (updated as any).is_pinned
              : !wasPinned;
          const nextPinnedAt =
            typeof (updated as any)?.pinned_at === 'string'
              ? (updated as any).pinned_at
              : (nextPinned ? new Date().toISOString() : undefined);
          if (typeof id === 'number') {
            patchPost?.(id, (current) => ({
              ...current,
              is_pinned: nextPinned,
              pinned_at: nextPinnedAt,
            } as FeedPost));
          }
          showToast(
            nextPinned
              ? t('home.postPinnedSuccess', { defaultValue: 'Pinned to your profile.' })
              : t('home.postUnpinnedSuccess', { defaultValue: 'Removed from your pinned posts.' }),
            { type: 'success' },
          );
        } catch (e: any) {
          showToast(
            e?.message || t('home.postPinFailed', { defaultValue: 'Could not update pin.' }),
            { type: 'error' },
          );
        }
      },
      // Handlers are always supplied; PostCard uses canManageCommunity (set
      // below) to gate visibility per-post, so admin items appear on any
      // post belonging to a community this user manages — regardless of
      // which feed surfaces it.
      onToggleCommunityPinPost: async (post) => {
        const uuid = (post as any)?.uuid as string | undefined;
        const id = (post as any)?.id as number | undefined;
        const communityName = (post as any)?.community?.name as string | undefined;
        if (!token || !uuid || !communityName) return;
        const wasPinned = !!(post as any)?.is_community_pinned;
        try {
          const updated = wasPinned
            ? await api.unpinCommunityPost(token, communityName, uuid)
            : await api.pinCommunityPost(token, communityName, uuid);
          const nextPinned =
            typeof (updated as any)?.is_community_pinned === 'boolean'
              ? (updated as any).is_community_pinned
              : !wasPinned;
          if (typeof id === 'number') {
            patchPost?.(id, (current) => ({
              ...current,
              is_community_pinned: nextPinned,
            } as FeedPost));
          }
          showToast(
            nextPinned
              ? t('home.communityPinSuccess', { defaultValue: 'Pinned to community.' })
              : t('home.communityUnpinSuccess', { defaultValue: 'Removed from community pinned.' }),
            { type: 'success' },
          );
        } catch (e: any) {
          showToast(
            e?.message || t('home.communityPinFailed', { defaultValue: 'Could not update community pin.' }),
            { type: 'error' },
          );
        }
      },
      onToggleClosePost: () => stub('Close post'),
      onFilterCommunityPostsByUser: () => stub('Filter by user'),
      canManageCommunity,

      // ── Helpers ───────────────────────────────────────────────────
      getPostText,
      getPostLengthType,
      getPostReactionCount,
      getPostCommentsCount,
    }),
    [
      reactionGroups,
      reactionPickerLoading,
      reactionActionLoading,
      ensureReactionGroups,
      reactToPost,
      navigation,
      stub,
      openReactionPicker,
      expandedPostIds,
      onToggleExpand,
      comments,
      getPostText,
      getPostLengthType,
      getPostReactionCount,
      getPostCommentsCount,
      canManageCommunity,
      token,
      showToast,
      removePost,
      patchPost,
    ],
  );
}
