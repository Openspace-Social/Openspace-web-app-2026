/**
 * PostDetailScreenContainer — full-screen post detail.
 *
 * Wraps the existing <PostDetailModal /> so the native detail view matches
 * mobile-web pixel-for-pixel (media gallery at top, React/Repost/Share/
 * Report action row, Comments/Reactions tabs, sticky reply input).
 *
 * PostDetailModal is rendered inside a Modal internally, so we turn the
 * stack header off for this screen and wire its onClose to
 * navigation.goBack() to pop back to the feed.
 *
 * Stubs remain for features that haven't migrated (repost, report, reaction
 * list, comment reactions, image/GIF drafts) — same policy as the feed.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { usePostDetailData } from '../../hooks/usePostDetailData';
import { useCommentsData } from '../../hooks/useCommentsData';
import { useAutoPlayMedia } from '../../hooks/useAutoPlayMedia';
import { useAppToast } from '../../toast/AppToastContext';
import PostDetailModal from '../../components/PostDetailModal';
import { postCardStyles } from '../../styles/postCardStyles';
import { api, type FeedPost } from '../../api/client';
import type { HomeStackParamList } from '../AppNavigator';

function postHasMedia(post?: FeedPost | null) {
  if (!post) return false;
  if ((post as any).media_thumbnail) return true;
  const media = (post as any).media;
  if (!Array.isArray(media) || media.length === 0) return false;
  return media.some((m: any) => !!m?.thumbnail || !!m?.image || !!m?.file);
}

function getPostText(post: FeedPost): string {
  const raw = (post as any)?.text || (post as any)?.text_content || '';
  return typeof raw === 'string' ? raw : '';
}

function getPostReactionCount(post: FeedPost): number {
  const counts = (post as any)?.reactions_emoji_counts || [];
  if (!Array.isArray(counts)) return 0;
  return counts.reduce((sum: number, e: any) => sum + (e?.count || 0), 0);
}

const EMPTY_BOOL: Record<number, boolean> = {};
const EMPTY_MEDIA: Record<number, null> = {};

export default function PostDetailScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const route = useRoute<RouteProp<HomeStackParamList, 'Post'>>();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const postUuid = route.params?.postUuid;
  const focusComment = !!route.params?.focusComment;
  const autoPlayMedia = useAutoPlayMedia();
  const initialMediaTimeSec = route.params?.resumeTimeSec ?? null;
  const initialViewIntent = route.params?.initialView ?? null;
  // Tracked locally so we can clear them on first apply (one-shot focus).
  const [focusCommentId, setFocusCommentId] = React.useState<number | null>(
    route.params?.focusCommentId ?? null,
  );
  const [focusParentCommentId, setFocusParentCommentId] = React.useState<number | null>(
    route.params?.focusParentCommentId ?? null,
  );

  const {
    post, loading,
    reactionGroups, reactionGroupsLoading, reactionActionLoading,
    ensureReactionGroups, reactToPost,
  } = usePostDetailData(token, postUuid);

  // useCommentsData needs an array so it can resolve uuid by id. Treat this
  // screen as a single-post feed.
  const postsArray = React.useMemo<FeedPost[]>(() => (post ? [post] : []), [post]);
  const comments = useCommentsData(token, postsArray);

  // Auto-load comments once the post arrives. Web shows the comments list
  // immediately on the post detail page; on native we trigger the same
  // fetch so users don't have to tap to reveal them.
  const postId = (post as any)?.id as number | undefined;
  const commentsLoadComments = comments.loadComments;
  const alreadyLoaded = postId != null && !!comments.localComments[postId];
  useEffect(() => {
    if (postId != null && !alreadyLoaded) {
      void commentsLoadComments(postId);
    }
  }, [postId, alreadyLoaded, commentsLoadComments]);

  // Pre-warm the reaction emoji groups as soon as the post loads. The
  // post.reaction payload only carries the emoji id; without the groups
  // loaded the reaction button has no image/keyword to display, so the
  // selected emoji isn't visibly highlighted.
  useEffect(() => {
    if (post) void ensureReactionGroups();
  }, [post, ensureReactionGroups]);

  // ── Reaction-list state ────────────────────────────────────────────────
  // The PostDetail "Reactions" tab shows who reacted with each emoji. The
  // chips along the top are filters (tap an emoji → fetch reactors filtered
  // to that emoji; tap nothing → fetch all reactors). Mirrors HomeScreen's
  // implementation on web via the same `api.getPostReactions` endpoint.
  type ReactionListEmoji = { id?: number; keyword?: string; image?: string };
  type ReactionListUser = {
    id?: number;
    created?: string;
    emoji?: ReactionListEmoji;
    reactor?: { id?: number; username?: string; profile?: { avatar?: string } };
  };
  const [reactionListLoading, setReactionListLoading] = useState(false);
  const [reactionListEmoji, setReactionListEmoji] = useState<ReactionListEmoji | null>(null);
  const [reactionListUsers, setReactionListUsers] = useState<ReactionListUser[]>([]);
  // Bumped on each call so a slow-returning earlier request can't stomp the
  // user list of a later (different-emoji) tap.
  const reactionListRequestRef = React.useRef(0);

  const loadReactionList = useCallback(
    async (targetPost: FeedPost, emoji?: ReactionListEmoji) => {
      if (!token) return;
      const targetUuid = (targetPost as any)?.uuid as string | undefined;
      if (!targetUuid) return;

      const requestId = ++reactionListRequestRef.current;
      setReactionListEmoji(emoji ?? null);
      setReactionListLoading(true);
      setReactionListUsers([]);
      try {
        const users = await api.getPostReactions(token, targetUuid, emoji?.id);
        // Drop the response if a newer request fired in the meantime.
        if (requestId !== reactionListRequestRef.current) return;
        setReactionListUsers(Array.isArray(users) ? users : []);
      } catch (e: any) {
        if (requestId !== reactionListRequestRef.current) return;
        showToast(
          e?.message || t('home.reactionListFailed', { defaultValue: 'Could not load reactions.' }),
          { type: 'error' },
        );
        setReactionListUsers([]);
      } finally {
        if (requestId === reactionListRequestRef.current) {
          setReactionListLoading(false);
        }
      }
    },
    [token, showToast, t],
  );

  const closeReactionList = useCallback(() => {
    reactionListRequestRef.current += 1;
    setReactionListEmoji(null);
    setReactionListUsers([]);
    setReactionListLoading(false);
  }, []);

  // Fetch current user for PostCard owner-only gating.
  const [currentUsername, setCurrentUsername] = useState<string | undefined>(undefined);
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try {
        const u: any = await api.getAuthenticatedUser(token);
        if (!active) return;
        setCurrentUsername(u?.username);
        setCurrentUserAvatar(u?.profile?.avatar);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

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

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleSharePost = useCallback(
    async (target: FeedPost) => {
      const uuid = (target as any)?.uuid;
      if (!uuid) return;
      const url = `https://openspacelive.com/posts/${uuid}`;
      try {
        const { Share } = await import('react-native');
        await Share.share({ url, message: url });
      } catch {
        // cancelled
      }
    },
    [],
  );

  const handleOpenLink = useCallback((url?: string) => {
    if (!url) return;
    // In-app browser (SFSafariViewController / Chrome Custom Tabs) — keeps
    // users from being kicked out to the system browser when they tap a
    // link inside a post.
    void WebBrowser.openBrowserAsync(url).catch(() => {
      stub('Open link');
    });
  }, [stub]);

  const handleNavigateProfile = useCallback(
    (username: string) => {
      navigation.navigate('Profile', { username });
    },
    [navigation],
  );

  const handleNavigateHashtag = useCallback(
    (name: string) => {
      navigation.navigate('Hashtag', { name });
    },
    [navigation],
  );

  // Getters PostDetailModal expects — uses useCommentsData's localComments
  // so counts reflect the currently loaded thread.
  const getPostCommentsCount = useCallback(
    (p: FeedPost) => {
      const id = (p as any)?.id;
      const loaded = (id != null && comments.localComments[id]) ? comments.localComments[id].length : 0;
      const raw = (p as any)?.comments_count || 0;
      return Math.max(raw, loaded);
    },
    [comments.localComments],
  );

  const c = theme.colors;

  return (
    <View style={{ flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' }}>
      {/* Behind-modal spinner — visible during the stack push transition
       *  and the modal's fade-in, so users don't see a black void while
       *  waiting for content to load. */}
      {loading && !post ? <ActivityIndicator color={c.primary} size="large" /> : null}
      <PostDetailModal
      styles={postCardStyles}
      c={c}
      t={t}
      visible
      postRouteLoading={loading && !post}
      activePost={post}
      hasActivePostMedia={postHasMedia(post)}
      currentUsername={currentUsername}
      currentUserAvatar={currentUserAvatar}
      localComments={comments.localComments}
      commentsHasMoreByPost={EMPTY_BOOL}
      commentsLoadingMoreByPost={EMPTY_BOOL}
      onLoadMoreComments={() => {}}
      commentRepliesById={comments.commentRepliesById}
      repliesHasMoreByComment={EMPTY_BOOL}
      repliesLoadingMoreByComment={EMPTY_BOOL}
      onLoadMoreReplies={() => {}}
      commentRepliesExpanded={comments.commentRepliesExpanded}
      commentRepliesLoadingById={comments.commentRepliesLoadingById}
      draftCommentMediaByPostId={comments.draftCommentMediaByPostId}
      draftReplyMediaByCommentId={comments.draftReplyMediaByCommentId}
      editingCommentById={comments.editingCommentById}
      editingReplyById={comments.editingReplyById}
      commentMutationLoadingById={comments.commentMutationLoadingById}
      reactionGroups={reactionGroups}
      reactionPickerLoading={reactionGroupsLoading}
      reactionActionLoading={reactionActionLoading}
      getPostText={getPostText}
      getPostReactionCount={getPostReactionCount}
      getPostCommentsCount={getPostCommentsCount}
      initialMediaTimeSec={initialMediaTimeSec}
      onConsumeInitialMediaTime={() => {}}
      initialFocusCommentId={focusCommentId}
      initialFocusParentCommentId={focusParentCommentId}
      onConsumeInitialFocusComment={() => {
        setFocusCommentId(null);
        setFocusParentCommentId(null);
      }}
      initialView={initialViewIntent}
      onClose={handleClose}
      onLoadReactionList={loadReactionList}
      onEnsureReactionGroups={ensureReactionGroups}
      onReactToPostWithEmoji={async (p, emojiId) => {
        if (emojiId != null) await reactToPost(p, emojiId);
      }}
      onReactToComment={() => stub('Comment reactions')}
      onToggleCommentReplies={comments.toggleCommentReplies}
      onSharePost={handleSharePost}
      onRepostPost={(p) => {
        // PostComposer lives on the root stack — same hop as feed.
        const root = navigation.getParent()?.getParent() ?? navigation.getParent();
        (root as any)?.navigate('PostComposer', { sharedPost: p });
      }}
      onReportPost={() => stub('Report post')}
      onReportComment={() => stub('Report comment')}
      onOpenLink={handleOpenLink}
      onPickDraftCommentImage={comments.pickDraftCommentImage}
      onPickDraftReplyImage={comments.pickDraftReplyImage}
      onSetDraftCommentGif={comments.setDraftCommentGif}
      onSetDraftReplyGif={comments.setDraftReplyGif}
      onClearDraftCommentMedia={comments.clearDraftCommentMedia}
      onClearDraftReplyMedia={comments.clearDraftReplyMedia}
      onStartEditingComment={comments.startEditingComment}
      onCancelEditingComment={comments.cancelEditingComment}
      onSaveEditedComment={comments.saveEditedComment}
      onDeleteComment={comments.deleteComment}
      onSubmitComment={comments.submitComment}
      onSubmitReply={comments.submitReply}
      onNavigateProfile={handleNavigateProfile}
      onNavigateHashtag={handleNavigateHashtag}
      token={token ?? undefined}
      reactionListOpen={reactionListUsers.length > 0 || reactionListLoading}
      reactionListLoading={reactionListLoading}
      reactionListEmoji={reactionListEmoji}
      reactionListUsers={reactionListUsers}
      onCloseReactionList={closeReactionList}
      autoFocusComposer={focusComment}
      autoPlayMedia={autoPlayMedia}
      />
    </View>
  );
}
