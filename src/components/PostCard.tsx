import React from 'react';
import { ActivityIndicator, Image, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FeedPost, PostComment } from '../api/client';

type PostCardVariant = 'feed' | 'profile';

type ReactionGroup = {
  id: number;
  keyword?: string;
  emojis?: Array<{ id?: number; image?: string }>;
};

type PostCardProps = {
  post: FeedPost;
  variant: PostCardVariant;
  styles: any;
  c: any;
  t: (key: string, options?: any) => string;
  currentUsername?: string;
  expandedPostIds: Record<number, boolean>;
  commentBoxPostIds: Record<number, boolean>;
  localComments: Record<number, PostComment[]>;
  commentRepliesById: Record<number, PostComment[]>;
  commentRepliesExpanded: Record<number, boolean>;
  commentRepliesLoadingById: Record<number, boolean>;
  draftComments: Record<number, string>;
  draftReplies: Record<number, string>;
  commentEditDrafts: Record<number, string>;
  replyEditDrafts: Record<number, string>;
  editingCommentById: Record<number, boolean>;
  editingReplyById: Record<number, boolean>;
  commentMutationLoadingById: Record<number, boolean>;
  followStateByUsername: Record<string, boolean>;
  followActionLoadingByUsername: Record<string, boolean>;
  reactionGroups: ReactionGroup[];
  reactionPickerLoading: boolean;
  reactionActionLoading: boolean;
  showFollowButton?: boolean;
  onEnsureReactionGroups: () => Promise<void>;
  onReactToComment: (postId: number, commentId: number, emojiId?: number) => void | Promise<void>;
  onToggleFollow: (username: string, currentlyFollowing: boolean) => void;
  onOpenPostDetail: (post: FeedPost) => void;
  onToggleExpand: (postId: number) => void;
  onOpenReactionList: (post: FeedPost, emoji?: { id?: number; keyword?: string; image?: string }) => void | Promise<void>;
  onOpenReactionPicker: (post: FeedPost) => void;
  onToggleCommentBox: (postId: number) => void;
  onToggleCommentReplies: (postId: number, commentId: number) => void;
  onSharePost: (post: FeedPost) => void;
  onOpenLink: (url?: string) => void;
  onUpdateDraftComment: (postId: number, value: string) => void;
  onUpdateDraftReply: (commentId: number, value: string) => void;
  onStartEditingComment: (commentId: number, currentText: string, isReply: boolean) => void;
  onCancelEditingComment: (commentId: number, isReply: boolean) => void;
  onUpdateEditCommentDraft: (commentId: number, value: string, isReply: boolean) => void;
  onSaveEditedComment: (postId: number, commentId: number, isReply: boolean, parentCommentId?: number) => void | Promise<void>;
  onDeleteComment: (postId: number, commentId: number, isReply: boolean, parentCommentId?: number) => void | Promise<void>;
  onSubmitComment: (postId: number) => void | Promise<void>;
  onSubmitReply: (postId: number, commentId: number) => void | Promise<void>;
  onOpenReportPostModal: (post: FeedPost) => void;
  onEditPost: (post: FeedPost, text: string) => void | Promise<void>;
  onDeletePost: (post: FeedPost) => void | Promise<void>;
  onTogglePinPost: (post: FeedPost) => void | Promise<void>;
  pinnedPostsCount?: number;
  pinnedPostsLimit?: number;
  pinnedDisplayIndex?: number | null;
  pinnedDisplayLimit?: number;
  onNavigateProfile: (username: string) => void;
  onNavigateCommunity: (communityName: string) => void;
  getPostText: (post: FeedPost) => string;
  getPostLengthType: (post: FeedPost) => 'long' | 'short';
  getPostReactionCount: (post: FeedPost) => number;
  getPostCommentsCount: (post: FeedPost) => number;
};

export default function PostCard({
  post,
  variant,
  styles,
  c,
  t,
  currentUsername,
  expandedPostIds,
  commentBoxPostIds,
  localComments,
  commentRepliesById,
  commentRepliesExpanded,
  commentRepliesLoadingById,
  draftComments,
  draftReplies,
  commentEditDrafts,
  replyEditDrafts,
  editingCommentById,
  editingReplyById,
  commentMutationLoadingById,
  followStateByUsername,
  followActionLoadingByUsername,
  reactionGroups,
  reactionPickerLoading,
  reactionActionLoading,
  showFollowButton = false,
  onEnsureReactionGroups,
  onReactToComment,
  onToggleFollow,
  onOpenPostDetail,
  onToggleExpand,
  onOpenReactionList,
  onOpenReactionPicker,
  onToggleCommentBox,
  onToggleCommentReplies,
  onSharePost,
  onOpenLink,
  onUpdateDraftComment,
  onUpdateDraftReply,
  onStartEditingComment,
  onCancelEditingComment,
  onUpdateEditCommentDraft,
  onSaveEditedComment,
  onDeleteComment,
  onSubmitComment,
  onSubmitReply,
  onOpenReportPostModal,
  onEditPost,
  onDeletePost,
  onTogglePinPost,
  pinnedPostsCount = 0,
  pinnedPostsLimit = 5,
  pinnedDisplayIndex = null,
  pinnedDisplayLimit = 5,
  onNavigateProfile,
  onNavigateCommunity,
  getPostText,
  getPostLengthType,
  getPostReactionCount,
  getPostCommentsCount,
}: PostCardProps) {
  const [commentReactionPickerForId, setCommentReactionPickerForId] = React.useState<number | null>(null);
  const [postMenuOpen, setPostMenuOpen] = React.useState(false);
  const [postEditing, setPostEditing] = React.useState(false);
  const [postEditDraft, setPostEditDraft] = React.useState(post.text || '');
  const [postEditLoading, setPostEditLoading] = React.useState(false);
  const [postPinLoading, setPostPinLoading] = React.useState(false);
  const commentReactionHostRefs = React.useRef<Record<number, any>>({});
  const postActionMenuHostRef = React.useRef<any>(null);
  const creatorAvatar = post.creator?.avatar || post.creator?.profile?.avatar;
  const hasReacted = !!post.reaction?.id || !!post.reaction?.emoji?.id;

  function formatRelativeTime(value?: string) {
    if (!value) return t('home.justNow');
    const now = Date.now();
    const then = new Date(value).getTime();
    if (!Number.isFinite(then)) return t('home.justNow');
    const diffSeconds = Math.max(0, Math.floor((now - then) / 1000));
    if (diffSeconds < 60) return t('home.relativeSecondsAgo', { count: diffSeconds });
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return t('home.relativeMinutesAgo', { count: diffMinutes });
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return t('home.relativeHoursAgo', { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    return t('home.relativeDaysAgo', { count: diffDays });
  }

  React.useEffect(() => {
    if (commentReactionPickerForId === null) return;
    if (typeof document === 'undefined') return;

    function handleDocumentPointerDown(event: MouseEvent) {
      const currentId = commentReactionPickerForId;
      if (currentId === null) return;
      const host = commentReactionHostRefs.current[currentId];
      const target = event.target as Node | null;
      if (host && target && host.contains?.(target)) return;
      setCommentReactionPickerForId(null);
    }

    document.addEventListener('mousedown', handleDocumentPointerDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown);
    };
  }, [commentReactionPickerForId]);

  React.useEffect(() => {
    if (!postMenuOpen) return;
    if (typeof document === 'undefined') return;

    function handleDocumentPointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      const host = postActionMenuHostRef.current;
      if (host && target && host.contains?.(target)) return;
      setPostMenuOpen(false);
    }

    document.addEventListener('mousedown', handleDocumentPointerDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown);
    };
  }, [postMenuOpen]);

  async function toggleCommentReactionPicker(commentId: number) {
    if (commentReactionPickerForId === commentId) {
      setCommentReactionPickerForId(null);
      return;
    }
    setCommentReactionPickerForId(commentId);
    await onEnsureReactionGroups();
  }

  function extractTextSegmentsWithLinks(text: string) {
    const segments: Array<{ text: string; isLink: boolean; url?: string }> = [];
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while ((match = urlRegex.exec(text)) !== null) {
      const rawUrl = match[0];
      const start = match.index;
      const end = start + rawUrl.length;
      const trimmedUrl = rawUrl.replace(/[),.;!?]+$/g, '');
      const trailing = rawUrl.slice(trimmedUrl.length);

      if (start > lastIndex) {
        segments.push({ text: text.slice(lastIndex, start), isLink: false });
      }

      segments.push({ text: trimmedUrl, isLink: true, url: trimmedUrl });

      if (trailing) {
        segments.push({ text: trailing, isLink: false });
      }

      lastIndex = end;
    }

    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex), isLink: false });
    }

    return segments.length ? segments : [{ text, isLink: false }];
  }

  const creatorUsername = post.creator?.username || '';
  const isPostOwner = !!currentUsername && creatorUsername === currentUsername;
  const canShowFollow =
    !!showFollowButton &&
    !!creatorUsername &&
    creatorUsername !== currentUsername &&
    !(followStateByUsername[creatorUsername] ?? !!post.creator?.is_following);

  React.useEffect(() => {
    setPostEditDraft(post.text || '');
  }, [post.id, post.text]);

  async function submitPostEdit() {
    if (postEditLoading) return;
    const next = postEditDraft.trim();
    if (!next.length) return;
    setPostEditLoading(true);
    try {
      await onEditPost(post, next);
      setPostEditing(false);
      setPostMenuOpen(false);
    } catch {
      // errors are surfaced by parent; keep modal open for correction
    } finally {
      setPostEditLoading(false);
    }
  }

  async function handleDeletePost() {
    if (postEditLoading) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const approved = window.confirm(t('home.postDeleteConfirm'));
      if (!approved) return;
    }
    setPostEditLoading(true);
    try {
      await onDeletePost(post);
      setPostMenuOpen(false);
    } catch {
      // errors are surfaced by parent
    } finally {
      setPostEditLoading(false);
    }
  }

  function openPostEditMenuAction() {
    setPostEditing(true);
    setPostMenuOpen(false);
  }

  async function handleTogglePinPost() {
    if (postPinLoading) return;
    setPostPinLoading(true);
    try {
      await onTogglePinPost(post);
      setPostMenuOpen(false);
    } catch {
      // errors are surfaced by parent
    } finally {
      setPostPinLoading(false);
    }
  }

  function openPostReportMenuAction() {
    setPostMenuOpen(false);
    onOpenReportPostModal(post);
  }

  function toOpaqueColor(color: string | undefined, fallback: string) {
    if (!color) return fallback;
    const value = color.trim();
    // If theme gives us a CSS variable token, force a concrete solid fallback.
    if (value.includes('var(')) return fallback;
    if (value.toLowerCase() === 'transparent') return fallback;

    const rgbFn = value.match(/^rgba?\(([^)]+)\)$/i);
    if (rgbFn) {
      const body = rgbFn[1].trim();
      const beforeAlpha = body.includes('/') ? body.split('/')[0].trim() : body;
      const commaParts = beforeAlpha.split(',').map((part) => part.trim()).filter(Boolean);
      if (commaParts.length >= 3) {
        return `rgb(${commaParts[0]}, ${commaParts[1]}, ${commaParts[2]})`;
      }
      // Supports modern syntax like: rgb(240 242 245 / 0.8)
      return `rgb(${beforeAlpha})`;
    }

    const hslFn = value.match(/^hsla?\(([^)]+)\)$/i);
    if (hslFn) {
      const body = hslFn[1].trim();
      const beforeAlpha = body.includes('/') ? body.split('/')[0].trim() : body;
      const commaParts = beforeAlpha.split(',').map((part) => part.trim()).filter(Boolean);
      if (commaParts.length >= 3) {
        return `hsl(${commaParts[0]}, ${commaParts[1]}, ${commaParts[2]})`;
      }
      return `hsl(${beforeAlpha})`;
    }

    const hex8 = value.match(/^#([0-9a-f]{8})$/i);
    if (hex8) return `#${hex8[1].slice(0, 6)}`;
    const hex4 = value.match(/^#([0-9a-f]{4})$/i);
    if (hex4) return `#${hex4[1].slice(0, 3)}`;
    return value;
  }

  const menuCardBg = '#ffffff';
  const menuTileBg = '#f3f6fb';
  type PostMenuAction = {
    key: string;
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    label: string;
    disabled: boolean;
    onPress: () => void;
  };
  const postMenuActions: PostMenuAction[] = isPostOwner
    ? [
        {
          key: 'pin',
          icon: post.is_pinned ? ('pin-off-outline' as const) : ('pin-outline' as const),
          label: postPinLoading
            ? '...'
            : (post.is_pinned
              ? t('home.unpinAction')
              : (pinnedPostsCount >= pinnedPostsLimit
                ? `${t('home.pinAction')} (${pinnedPostsCount}/${pinnedPostsLimit})`
                : t('home.pinAction'))),
          disabled: postPinLoading || postEditLoading || (!post.is_pinned && pinnedPostsCount >= pinnedPostsLimit),
          onPress: () => void handleTogglePinPost(),
        },
        {
          key: 'edit',
          icon: 'pencil-outline' as const,
          label: t('home.editAction'),
          disabled: false,
          onPress: openPostEditMenuAction,
        },
        {
          key: 'delete',
          icon: 'delete-outline' as const,
          label: postEditLoading ? '...' : t('home.deleteAction'),
          disabled: postEditLoading,
          onPress: () => void handleDeletePost(),
        },
      ]
    : [
        {
          key: 'report',
          icon: 'alert-circle-outline' as const,
          label: t('home.reportPostAction'),
          disabled: false,
          onPress: openPostReportMenuAction,
        },
      ];
  const postCardBg = toOpaqueColor(
    variant === 'feed' ? c.inputBackground : c.surface,
    variant === 'feed' ? '#eef2f7' : '#f7f9fc'
  );

  return (
    <View
      style={[
        styles.feedPostCard,
        {
          borderColor: c.border,
          backgroundColor: postCardBg,
          position: 'relative',
          overflow: 'visible',
          zIndex: postMenuOpen ? 1200 : 1,
          elevation: postMenuOpen ? 1200 : 1,
        },
      ]}
    >
      <View style={styles.feedPostHeader}>
        <View style={styles.feedHeaderLeft}>
          <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}> 
            {creatorAvatar ? (
              <Image source={{ uri: creatorAvatar }} style={styles.feedAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={styles.feedAvatarLetter}>{(creatorUsername?.[0] || 'O').toUpperCase()}</Text>
            )}
          </View>
          <View style={styles.feedHeaderMeta}>
            {post.community?.name ? (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => onNavigateCommunity(post.community?.name || '')}
              >
                <Text style={[styles.feedCommunityHeaderLink, { color: c.textLink }]}>c/{post.community.name}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                if (!creatorUsername) return;
                onNavigateProfile(creatorUsername);
              }}
            >
              <Text style={[styles.feedAuthor, { color: c.textPrimary }]}>@{creatorUsername || t('home.unknownUser')}</Text>
            </TouchableOpacity>
            <Text style={[styles.feedDate, { color: c.textMuted }]}>
              {post.created ? new Date(post.created).toLocaleString() : ''}
            </Text>
          </View>
        </View>
        <View style={styles.feedHeaderActions}>
          {canShowFollow ? (
            <TouchableOpacity
              style={[styles.followButton, { borderColor: c.border, backgroundColor: c.surface }]}
              activeOpacity={0.85}
              disabled={!!followActionLoadingByUsername[creatorUsername]}
              onPress={() => onToggleFollow(creatorUsername, followStateByUsername[creatorUsername] ?? !!post.creator?.is_following)}
            >
              <Text style={[styles.followButtonText, { color: c.textLink }]}>
                {followActionLoadingByUsername[creatorUsername] ? '...' : t('home.followAction')}
              </Text>
            </TouchableOpacity>
          ) : null}
          <View
            style={styles.postActionMenuWrap}
            ref={(node) => {
              postActionMenuHostRef.current = node;
            }}
          >
            <TouchableOpacity
              style={[styles.reportButton, { borderColor: c.border, backgroundColor: c.surface }]}
              activeOpacity={0.85}
              onPress={() => setPostMenuOpen((prev) => !prev)}
              accessibilityLabel={t('home.postMenuAction')}
            >
              <MaterialCommunityIcons name="dots-horizontal" size={16} color={c.textSecondary} />
            </TouchableOpacity>
            {postMenuOpen ? (
              <View style={[styles.postActionMenuCard, { borderColor: c.border, backgroundColor: menuCardBg, opacity: 1 }]}>
                <View style={styles.postActionMenuTiles}>
                  {postMenuActions.map((action) => (
                    <TouchableOpacity
                      key={`post-menu-action-${action.key}`}
                      style={[
                        styles.postActionMenuItem,
                        { borderColor: c.border, backgroundColor: menuTileBg, opacity: action.disabled ? 0.45 : 1 },
                      ]}
                      activeOpacity={0.9}
                      onPress={action.onPress}
                      disabled={action.disabled}
                    >
                      <MaterialCommunityIcons name={action.icon} size={18} color={c.textSecondary} />
                      <Text style={[styles.postActionMenuItemText, { color: c.textSecondary }]}>
                        {action.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.postMetaRow}>
        <View style={[styles.postLengthBadge, { borderColor: c.border, backgroundColor: c.surface }]}> 
          <Text style={[styles.postLengthBadgeText, { color: c.textMuted }]}>
            {getPostLengthType(post) === 'long' ? t('home.postTypeLong') : t('home.postTypeShort')}
          </Text>
        </View>
        {post.is_pinned ? (
          <View style={[styles.postPinnedBadge, { borderColor: c.border, backgroundColor: c.surface }]}>
            <MaterialCommunityIcons name="pin" size={12} color={c.textLink} />
            <Text style={[styles.postPinnedBadgeText, { color: c.textLink }]}>
              {pinnedDisplayIndex !== null ? `${pinnedDisplayIndex}/${pinnedDisplayLimit}` : t('home.profilePinnedPostsTitle')}
            </Text>
          </View>
        ) : null}
      </View>

      {getPostText(post) ? (
        <View style={styles.feedTextWrap}>
          <Text style={[styles.feedText, { color: c.textSecondary }]}> 
            {extractTextSegmentsWithLinks(
              expandedPostIds[post.id]
                ? getPostText(post)
                : `${getPostText(post).slice(0, 240)}${getPostText(post).length > 240 ? '...' : ''}`
            ).map((segment, idx) => (
              <Text
                key={`${variant}-${post.id}-text-segment-${idx}`}
                onPress={segment.isLink ? () => onOpenLink(segment.url) : undefined}
                style={segment.isLink ? [{ color: c.textLink, textDecorationLine: 'underline' } as any] : undefined}
              >
                {segment.text}
              </Text>
            ))}
          </Text>
          {getPostText(post).length > 240 ? (
            <TouchableOpacity onPress={() => onToggleExpand(post.id)} activeOpacity={0.85}>
              <Text style={[styles.seeMoreText, { color: c.textLink }]}>
                {expandedPostIds[post.id] ? t('home.seeLess') : t('home.seeMore')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {post.media_thumbnail ? (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => onOpenPostDetail(post)}
          accessibilityLabel={t('home.openPostDetailAction')}
        >
          <Image source={{ uri: post.media_thumbnail }} style={[styles.feedMedia, { backgroundColor: c.surface }]} resizeMode="contain" />
        </TouchableOpacity>
      ) : null}

      <View style={[styles.feedStatsRow, { borderTopColor: c.border, borderBottomColor: c.border }]}> 
        <Text style={[styles.feedStatText, { color: c.textMuted }]}>{t('home.feedReactionsCount', { count: getPostReactionCount(post) })}</Text>
        <Text style={[styles.feedStatText, { color: c.textMuted }]}>{t('home.feedCommentsCount', { count: getPostCommentsCount(post) })}</Text>
      </View>

      {(post.reactions_emoji_counts || []).length > 0 ? (
        <View style={styles.reactionSummaryWrap}>
          {(post.reactions_emoji_counts || [])
            .filter((entry) => (entry?.count || 0) > 0)
            .map((entry, idx) => (
              <TouchableOpacity
                key={`${variant}-${post.id}-reaction-summary-${entry.emoji?.id || idx}`}
                style={[styles.reactionSummaryChip, { borderColor: c.border, backgroundColor: c.surface }]}
                onPress={() => onOpenReactionList(post)}
                activeOpacity={0.85}
              >
                {entry.emoji?.image ? (
                  <Image source={{ uri: entry.emoji.image }} style={styles.reactionSummaryEmojiImage} resizeMode="contain" />
                ) : (
                  <MaterialCommunityIcons name="emoticon-outline" size={14} color={c.textSecondary} />
                )}
                <Text style={[styles.reactionSummaryCount, { color: c.textSecondary }]}>{entry.count || 0}</Text>
              </TouchableOpacity>
            ))}
        </View>
      ) : null}

      <View style={styles.feedActionsRow}>
        <TouchableOpacity
          style={[
            styles.feedActionButton,
            {
              borderColor: hasReacted ? c.primary : c.border,
              backgroundColor: hasReacted ? c.surface : c.inputBackground,
            },
          ]}
          onPress={() => onOpenReactionPicker(post)}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons
            name={hasReacted ? 'emoticon' : 'emoticon-outline'}
            size={16}
            color={hasReacted ? c.primary : c.textSecondary}
          />
          <Text style={[styles.feedActionText, { color: hasReacted ? c.primary : c.textSecondary }]}>
            {t('home.reactAction')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          onPress={() => {
            if (post.media_thumbnail) {
              onToggleCommentBox(post.id);
            } else {
              onOpenPostDetail(post);
            }
          }}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons name="comment-outline" size={16} color={c.textSecondary} />
          <Text style={[styles.feedActionText, { color: c.textSecondary }]}>{t('home.commentAction')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          onPress={() => onSharePost(post)}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons name="share-variant-outline" size={16} color={c.textSecondary} />
          <Text style={[styles.feedActionText, { color: c.textSecondary }]}>{t('home.shareAction')}</Text>
        </TouchableOpacity>
      </View>

      {commentBoxPostIds[post.id] ? (
        <View style={[styles.commentsBox, { borderTopColor: c.border }]}> 
          {(localComments[post.id] || []).map((comment, index) => {
            const isOwnComment = !!currentUsername && comment.commenter?.username === currentUsername;
            const isEditingComment = !!editingCommentById[comment.id];
            const repliesCount = Math.max(comment.replies_count || 0, (commentRepliesById[comment.id] || []).length);

            return (
            <View key={`${variant}-${post.id}-comment-${comment.id || index}`} style={styles.commentThreadItem}>
              <View style={styles.detailCommentRow}>
                <View style={[styles.detailCommentAvatar, { backgroundColor: c.primary }]}> 
                  {comment.commenter?.profile?.avatar ? (
                    <Image source={{ uri: comment.commenter.profile.avatar }} style={styles.detailCommentAvatarImage} resizeMode="cover" />
                  ) : (
                    <Text style={styles.detailCommentAvatarLetter}>{(comment.commenter?.username?.[0] || 'U').toUpperCase()}</Text>
                  )}
                </View>
                <View style={[styles.detailCommentBubble, { backgroundColor: c.surface, borderColor: c.border }]}> 
                  <View style={styles.commentAuthorRow}>
                    <Text style={[styles.detailCommentAuthor, { color: c.textPrimary }]}>@{comment.commenter?.username || t('home.unknownUser')}</Text>
                    <Text style={[styles.commentTimeInline, { color: c.textMuted }]}>
                      {formatRelativeTime(comment.created)}
                    </Text>
                  </View>
                  {isEditingComment ? (
                    <View>
                      <TextInput
                        style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                        value={commentEditDrafts[comment.id] ?? (comment.text || '')}
                        onChangeText={(value) => onUpdateEditCommentDraft(comment.id, value, false)}
                        placeholder={t('home.commentPlaceholder')}
                        placeholderTextColor={c.placeholder}
                      />
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                        <TouchableOpacity
                          style={[styles.commentReplySendButton, { backgroundColor: c.primary }]}
                          disabled={!!commentMutationLoadingById[comment.id]}
                          activeOpacity={0.85}
                          onPress={() => onSaveEditedComment(post.id, comment.id, false)}
                        >
                          <Text style={styles.commentSendText}>
                            {commentMutationLoadingById[comment.id] ? '...' : t('home.saveAction')}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.commentReplySendButton, { backgroundColor: c.inputBackground, borderColor: c.border, borderWidth: 1 }]}
                          disabled={!!commentMutationLoadingById[comment.id]}
                          activeOpacity={0.85}
                          onPress={() => onCancelEditingComment(comment.id, false)}
                        >
                          <Text style={[styles.commentSendText, { color: c.textSecondary }]}>
                            {t('home.cancelAction')}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <Text style={[styles.detailCommentText, { color: c.textSecondary }]}>{comment.text || ''}</Text>
                  )}
                </View>
              </View>
              <View style={styles.detailCommentMetaRow}>
                <View
                  style={styles.commentReactionActionWrap}
                  ref={(node) => {
                    if (!node) return;
                    commentReactionHostRefs.current[comment.id] = node as any;
                  }}
                >
                  {commentReactionPickerForId === comment.id ? (
                    <View style={[styles.commentReactionPickerPopover, { borderColor: c.border, backgroundColor: c.surface }]}>
                      {reactionPickerLoading ? (
                        <ActivityIndicator color={c.primary} size="small" />
                      ) : (
                        <ScrollView style={styles.commentReactionPickerScroll} contentContainerStyle={styles.commentReactionPickerScrollContent}>
                          {reactionGroups.map((group) => (
                            <View key={`comment-reaction-group-${comment.id}-${group.id}`} style={styles.commentReactionPickerGroup}>
                              <Text style={[styles.commentReactionPickerGroupLabel, { color: c.textMuted }]}>
                                {group.keyword || t('home.reactAction')}
                              </Text>
                              <View style={styles.commentReactionPickerEmojiRow}>
                                {(group.emojis || []).map((emoji, emojiIdx) => (
                                  <TouchableOpacity
                                    key={`comment-reaction-picker-${comment.id}-${group.id}-${emoji.id || emojiIdx}`}
                                    style={[styles.commentReactionPickerEmojiButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                                    activeOpacity={0.85}
                                    disabled={reactionActionLoading}
                                    onPress={async () => {
                                      await onReactToComment(post.id, comment.id, emoji.id);
                                      setCommentReactionPickerForId(null);
                                    }}
                                  >
                                    {emoji.image ? (
                                      <Image source={{ uri: emoji.image }} style={styles.commentReactionPickerEmojiImage} resizeMode="contain" />
                                    ) : (
                                      <MaterialCommunityIcons name="emoticon-outline" size={15} color={c.textSecondary} />
                                    )}
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </View>
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  ) : null}
                  <TouchableOpacity activeOpacity={0.85} onPress={() => toggleCommentReactionPicker(comment.id)}>
                    <Text style={[styles.detailCommentMetaAction, { color: c.textLink }]}>{t('home.reactAction')}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity activeOpacity={0.85} onPress={() => onToggleCommentReplies(post.id, comment.id)}>
                  <Text style={[styles.detailCommentMetaAction, { color: c.textLink }]}>{t('home.commentReplyAction')}</Text>
                </TouchableOpacity>
                {isOwnComment && !isEditingComment ? (
                  <>
                    <TouchableOpacity activeOpacity={0.85} onPress={() => onStartEditingComment(comment.id, comment.text || '', false)}>
                      <Text style={[styles.detailCommentMetaAction, { color: c.textLink }]}>{t('home.editAction')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      disabled={!!commentMutationLoadingById[comment.id]}
                      onPress={() => onDeleteComment(post.id, comment.id, false)}
                    >
                      <Text style={[styles.detailCommentMetaAction, { color: c.textLink }]}>
                        {commentMutationLoadingById[comment.id] ? '...' : t('home.deleteAction')}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : null}
                {repliesCount > 0 ? (
                  <TouchableOpacity activeOpacity={0.85} onPress={() => onToggleCommentReplies(post.id, comment.id)}>
                    <Text style={[styles.detailCommentMetaAction, { color: c.textLink }]}>
                      {commentRepliesExpanded[comment.id]
                        ? t('home.hideRepliesAction')
                        : t('home.viewRepliesAction', {
                            count: repliesCount,
                          })}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <View style={styles.commentReplyLoadingSlot}>
                  {commentRepliesLoadingById[comment.id] ? <ActivityIndicator color={c.primary} size="small" /> : null}
                </View>
              </View>

              {commentRepliesExpanded[comment.id] ? (
                <View style={styles.commentRepliesWrap}>
                  {(commentRepliesById[comment.id] || []).map((reply, replyIndex) => {
                    const isOwnReply = !!currentUsername && reply.commenter?.username === currentUsername;
                    const isEditingReply = !!editingReplyById[reply.id];

                    return (
                    <View key={`reply-${comment.id}-${reply.id || replyIndex}`} style={styles.commentReplyRow}>
                      <View style={styles.commentReplyMainRow}>
                        <View style={[styles.commentReplyAvatar, { backgroundColor: c.primary }]}> 
                          {reply.commenter?.profile?.avatar ? (
                            <Image source={{ uri: reply.commenter.profile.avatar }} style={styles.detailCommentAvatarImage} resizeMode="cover" />
                          ) : (
                            <Text style={styles.detailCommentAvatarLetter}>{(reply.commenter?.username?.[0] || 'U').toUpperCase()}</Text>
                          )}
                        </View>
                        <View style={[styles.commentReplyBubble, { backgroundColor: c.inputBackground, borderColor: c.border }]}> 
                          <View style={styles.commentAuthorRow}>
                            <Text style={[styles.detailCommentAuthor, { color: c.textPrimary }]}>
                              @{reply.commenter?.username || t('home.unknownUser')}
                            </Text>
                            <Text style={[styles.commentTimeInline, { color: c.textMuted }]}>
                              {formatRelativeTime(reply.created)}
                            </Text>
                          </View>
                          {isEditingReply ? (
                            <View>
                              <TextInput
                                style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.surface, color: c.textPrimary }]}
                                value={replyEditDrafts[reply.id] ?? (reply.text || '')}
                                onChangeText={(value) => onUpdateEditCommentDraft(reply.id, value, true)}
                                placeholder={t('home.replyPlaceholder')}
                                placeholderTextColor={c.placeholder}
                              />
                              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                                <TouchableOpacity
                                  style={[styles.commentReplySendButton, { backgroundColor: c.primary }]}
                                  disabled={!!commentMutationLoadingById[reply.id]}
                                  activeOpacity={0.85}
                                  onPress={() => onSaveEditedComment(post.id, reply.id, true, comment.id)}
                                >
                                  <Text style={styles.commentSendText}>
                                    {commentMutationLoadingById[reply.id] ? '...' : t('home.saveAction')}
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.commentReplySendButton, { backgroundColor: c.inputBackground, borderColor: c.border, borderWidth: 1 }]}
                                  disabled={!!commentMutationLoadingById[reply.id]}
                                  activeOpacity={0.85}
                                  onPress={() => onCancelEditingComment(reply.id, true)}
                                >
                                  <Text style={[styles.commentSendText, { color: c.textSecondary }]}>
                                    {t('home.cancelAction')}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ) : (
                            <Text style={[styles.detailCommentText, { color: c.textSecondary }]}>{reply.text || ''}</Text>
                          )}
                        </View>
                      </View>
                      {isOwnReply && !isEditingReply ? (
                        <View style={[styles.detailCommentMetaRow, { marginTop: 4, marginLeft: 44 }]}>
                          <TouchableOpacity activeOpacity={0.85} onPress={() => onStartEditingComment(reply.id, reply.text || '', true)}>
                            <Text style={[styles.detailCommentMetaAction, { color: c.textLink }]}>{t('home.editAction')}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            activeOpacity={0.85}
                            disabled={!!commentMutationLoadingById[reply.id]}
                            onPress={() => onDeleteComment(post.id, reply.id, true, comment.id)}
                          >
                            <Text style={[styles.detailCommentMetaAction, { color: c.textLink }]}>
                              {commentMutationLoadingById[reply.id] ? '...' : t('home.deleteAction')}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                  <View style={styles.commentReplyComposer}>
                    <TextInput
                      style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.surface, color: c.textPrimary }]}
                      value={draftReplies[comment.id] || ''}
                      onChangeText={(value) => onUpdateDraftReply(comment.id, value)}
                      placeholder={t('home.replyPlaceholder')}
                      placeholderTextColor={c.placeholder}
                    />
                    <TouchableOpacity
                      style={[styles.commentReplySendButton, { backgroundColor: c.primary }]}
                      onPress={() => onSubmitReply(post.id, comment.id)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.commentSendText}>{t('home.replyPostAction')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>
            );
          })}

          <View style={styles.commentComposer}>
            <TextInput
              style={[styles.commentInput, { borderColor: c.inputBorder, backgroundColor: c.surface, color: c.textPrimary }]}
              value={draftComments[post.id] || ''}
              onChangeText={(value) => onUpdateDraftComment(post.id, value)}
              placeholder={t('home.commentPlaceholder')}
              placeholderTextColor={c.placeholder}
            />
            <TouchableOpacity
              style={[styles.commentSendButton, { backgroundColor: c.primary }]}
              onPress={() => onSubmitComment(post.id)}
              activeOpacity={0.85}
            >
              <Text style={styles.commentSendText}>{t('home.commentPostAction')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <Modal
        visible={postEditing}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setPostEditing(false);
          setPostEditDraft(post.text || '');
        }}
      >
        <TouchableOpacity
          style={styles.postEditModalBackdrop}
          activeOpacity={1}
          onPress={() => {
            setPostEditing(false);
            setPostEditDraft(post.text || '');
          }}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.postEditModalCard, { borderColor: c.border, backgroundColor: c.surface }]}>
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>{t('home.editAction')}</Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={() => {
                    setPostEditing(false);
                    setPostEditDraft(post.text || '');
                  }}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.postInlineEditInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                value={postEditDraft}
                onChangeText={setPostEditDraft}
                multiline
                placeholder={t('home.postEditPlaceholder')}
                placeholderTextColor={c.placeholder}
              />
              <View style={styles.postInlineEditActions}>
                <TouchableOpacity
                  style={[styles.commentReplySendButton, { backgroundColor: c.inputBackground, borderColor: c.border, borderWidth: 1 }]}
                  activeOpacity={0.85}
                  disabled={postEditLoading}
                  onPress={() => {
                    setPostEditing(false);
                    setPostEditDraft(post.text || '');
                  }}
                >
                  <Text style={[styles.commentSendText, { color: c.textSecondary }]}>{t('home.cancelAction')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.commentReplySendButton, { backgroundColor: c.primary }]}
                  activeOpacity={0.85}
                  disabled={postEditLoading || !postEditDraft.trim().length}
                  onPress={() => void submitPostEdit()}
                >
                  <Text style={styles.commentSendText}>{postEditLoading ? '...' : t('home.saveAction')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
