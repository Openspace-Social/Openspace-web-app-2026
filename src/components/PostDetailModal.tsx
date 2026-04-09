import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FeedPost, PostComment } from '../api/client';

type ReactionEmoji = {
  id?: number;
  keyword?: string;
  image?: string;
};

type PostReaction = {
  id?: number;
  created?: string;
  emoji?: {
    id?: number;
    keyword?: string;
    image?: string;
  };
  reactor?: {
    id?: number;
    username?: string;
    profile?: {
      avatar?: string;
    };
  };
};

type ReactionGroup = {
  id: number;
  keyword?: string;
  emojis?: Array<{ id?: number; image?: string }>;
};

type Props = {
  styles: any;
  c: any;
  t: (key: string, options?: any) => string;
  visible: boolean;
  postRouteLoading: boolean;
  activePost: FeedPost | null;
  hasActivePostMedia: boolean;
  currentUsername?: string;
  currentUserAvatar?: string;
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
  reactionGroups: ReactionGroup[];
  reactionPickerLoading: boolean;
  reactionActionLoading: boolean;
  getPostText: (post: FeedPost) => string;
  getPostReactionCount: (post: FeedPost) => number;
  getPostCommentsCount: (post: FeedPost) => number;
  onClose: () => void;
  onLoadReactionList: (post: FeedPost, emoji?: ReactionEmoji) => void | Promise<void>;
  onEnsureReactionGroups: () => Promise<void>;
  onReactToPostWithEmoji: (post: FeedPost, emojiId?: number) => void | Promise<void>;
  onReactToComment: (postId: number, commentId: number, emojiId?: number) => void | Promise<void>;
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
  onNavigateProfile: (username: string) => void;
  reactionListOpen: boolean;
  reactionListLoading: boolean;
  reactionListEmoji: ReactionEmoji | null;
  reactionListUsers: PostReaction[];
  onCloseReactionList: () => void;
};

export default function PostDetailModal({
  styles,
  c,
  t,
  visible,
  postRouteLoading,
  activePost,
  hasActivePostMedia,
  currentUsername,
  currentUserAvatar,
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
  reactionGroups,
  reactionPickerLoading,
  reactionActionLoading,
  getPostText,
  getPostReactionCount,
  getPostCommentsCount,
  onClose,
  onLoadReactionList,
  onEnsureReactionGroups,
  onReactToPostWithEmoji,
  onReactToComment,
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
  onNavigateProfile,
  reactionListOpen,
  reactionListLoading,
  reactionListEmoji,
  reactionListUsers,
  onCloseReactionList,
}: Props) {
  const [commentReactionPickerForId, setCommentReactionPickerForId] = React.useState<number | null>(null);
  const [postReactionPickerOpen, setPostReactionPickerOpen] = React.useState(false);
  const [detailPanel, setDetailPanel] = React.useState<'comments' | 'reactions'>('comments');
  const commentReactionHostRefs = React.useRef<Record<number, any>>({});
  const postReactionHostRef = React.useRef<any>(null);
  const creatorAvatar = activePost?.creator?.avatar || activePost?.creator?.profile?.avatar;
  const hasReacted = !!activePost?.reaction?.id || !!activePost?.reaction?.emoji?.id;

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
    if (!postReactionPickerOpen) return;
    if (typeof document === 'undefined') return;

    function handleDocumentPointerDown(event: MouseEvent) {
      const host = postReactionHostRef.current;
      const target = event.target as Node | null;
      if (host && target && host.contains?.(target)) return;
      setPostReactionPickerOpen(false);
    }

    document.addEventListener('mousedown', handleDocumentPointerDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown);
    };
  }, [postReactionPickerOpen]);

  React.useEffect(() => {
    if (!visible) {
      setDetailPanel('comments');
      return;
    }
    if (reactionListOpen) setDetailPanel('reactions');
  }, [visible, reactionListOpen]);

  async function togglePostReactionPicker() {
    if (postReactionPickerOpen) {
      setPostReactionPickerOpen(false);
      return;
    }
    setPostReactionPickerOpen(true);
    await onEnsureReactionGroups();
  }

  async function openReactionsPanel(post: FeedPost, emoji?: ReactionEmoji) {
    setDetailPanel('reactions');
    await onLoadReactionList(post, emoji);
  }

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

  function renderCommentThread(postId: number) {
    const comments = localComments[postId] || [];
    if (comments.length === 0) return null;

    return comments.map((comment, index) => {
      const isOwnComment = !!currentUsername && comment.commenter?.username === currentUsername;
      const isEditingComment = !!editingCommentById[comment.id];
      const repliesCount = Math.max(comment.replies_count || 0, (commentRepliesById[comment.id] || []).length);

      return (
      <View key={`${postId}-detail-comment-${comment.id || index}`} style={styles.detailCommentItem}>
        <View style={styles.detailCommentRow}>
          <View style={[styles.detailCommentAvatar, { backgroundColor: c.primary }]}> 
            {comment.commenter?.profile?.avatar ? (
              <Image source={{ uri: comment.commenter.profile.avatar }} style={styles.detailCommentAvatarImage} resizeMode="cover" />
            ) : currentUserAvatar ? (
              <Image source={{ uri: currentUserAvatar }} style={styles.detailCommentAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={styles.detailCommentAvatarLetter}>
                {(comment.commenter?.username?.[0] || currentUsername?.[0] || 'U').toUpperCase()}
              </Text>
            )}
          </View>
          <View style={[styles.detailCommentBubble, { backgroundColor: c.inputBackground, borderColor: c.border }]}> 
            <View style={styles.commentAuthorRow}>
              <Text style={[styles.detailCommentAuthor, { color: c.textPrimary }]}>@{comment.commenter?.username || currentUsername || t('home.unknownUser')}</Text>
              <Text style={[styles.commentTimeInline, { color: c.textMuted }]}>
                {formatRelativeTime(comment.created)}
              </Text>
            </View>
            {isEditingComment ? (
              <View>
                <TextInput
                  style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.surface, color: c.textPrimary }]}
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
                    onPress={() => onSaveEditedComment(postId, comment.id, false)}
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
                      <View key={`modal-comment-reaction-group-${comment.id}-${group.id}`} style={styles.commentReactionPickerGroup}>
                        <Text style={[styles.commentReactionPickerGroupLabel, { color: c.textMuted }]}>
                          {group.keyword || t('home.reactAction')}
                        </Text>
                        <View style={styles.commentReactionPickerEmojiRow}>
                          {(group.emojis || []).map((emoji, emojiIdx) => (
                            <TouchableOpacity
                              key={`modal-comment-reaction-${comment.id}-${group.id}-${emoji.id || emojiIdx}`}
                              style={[styles.commentReactionPickerEmojiButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                              activeOpacity={0.85}
                              disabled={reactionActionLoading}
                              onPress={async () => {
                                await onReactToComment(postId, comment.id, emoji.id);
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

          <TouchableOpacity activeOpacity={0.85} onPress={() => onToggleCommentReplies(postId, comment.id)}>
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
                onPress={() => onDeleteComment(postId, comment.id, false)}
              >
                <Text style={[styles.detailCommentMetaAction, { color: c.textLink }]}>
                  {commentMutationLoadingById[comment.id] ? '...' : t('home.deleteAction')}
                </Text>
              </TouchableOpacity>
            </>
          ) : null}
          {repliesCount > 0 ? (
            <TouchableOpacity activeOpacity={0.85} onPress={() => onToggleCommentReplies(postId, comment.id)}>
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
                  <View style={[styles.commentReplyBubble, { backgroundColor: c.surface, borderColor: c.border }]}> 
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
                          style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
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
                            onPress={() => onSaveEditedComment(postId, reply.id, true, comment.id)}
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
                      onPress={() => onDeleteComment(postId, reply.id, true, comment.id)}
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
                style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                value={draftReplies[comment.id] || ''}
                onChangeText={(value) => onUpdateDraftReply(comment.id, value)}
                placeholder={t('home.replyPlaceholder')}
                placeholderTextColor={c.placeholder}
              />
              <TouchableOpacity
                style={[styles.commentReplySendButton, { backgroundColor: c.primary }]}
                onPress={() => onSubmitReply(postId, comment.id)}
                activeOpacity={0.85}
              >
                <Text style={styles.commentSendText}>{t('home.replyPostAction')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
      );
    });
  }

  function renderPostActions(post: FeedPost) {
    return (
      <View style={styles.feedActionsRow}>
        <View
          style={styles.postReactionActionWrap}
          ref={(node) => {
            if (!node) return;
            postReactionHostRef.current = node as any;
          }}
        >
          {postReactionPickerOpen ? (
            <View style={[styles.postReactionPickerPopover, { borderColor: c.border, backgroundColor: c.surface }]}>
              {reactionPickerLoading ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : (
                <ScrollView style={styles.commentReactionPickerScroll} contentContainerStyle={styles.commentReactionPickerScrollContent}>
                  {reactionGroups.map((group) => (
                    <View key={`post-reaction-group-${post.id}-${group.id}`} style={styles.commentReactionPickerGroup}>
                      <Text style={[styles.commentReactionPickerGroupLabel, { color: c.textMuted }]}>
                        {group.keyword || t('home.reactAction')}
                      </Text>
                      <View style={styles.commentReactionPickerEmojiRow}>
                        {(group.emojis || []).map((emoji, emojiIdx) => (
                          <TouchableOpacity
                            key={`post-reaction-picker-${post.id}-${group.id}-${emoji.id || emojiIdx}`}
                            style={[styles.commentReactionPickerEmojiButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                            activeOpacity={0.85}
                            disabled={reactionActionLoading}
                            onPress={async () => {
                              await onReactToPostWithEmoji(post, emoji.id);
                              setPostReactionPickerOpen(false);
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

          <TouchableOpacity
            style={[
              styles.feedActionButton,
              {
                borderColor: hasReacted ? c.primary : c.border,
                backgroundColor: hasReacted ? c.surface : c.inputBackground,
              },
            ]}
            onPress={togglePostReactionPicker}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name={hasReacted ? 'emoticon' : 'emoticon-outline'} size={16} color={hasReacted ? c.primary : c.textSecondary} />
            <Text style={[styles.feedActionText, { color: hasReacted ? c.primary : c.textSecondary }]}>{t('home.reactAction')}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          onPress={() => onSharePost(post)}
          activeOpacity={0.85}
        >
          <MaterialCommunityIcons name="share-variant-outline" size={16} color={c.textSecondary} />
          <Text style={[styles.feedActionText, { color: c.textSecondary }]}>{t('home.shareAction')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderReactionSummary(post: FeedPost) {
    if (!(post.reactions_emoji_counts || []).length) return null;

    return (
      <View style={styles.reactionSummaryWrap}>
        {(post.reactions_emoji_counts || [])
          .filter((entry) => (entry?.count || 0) > 0)
          .map((entry, idx) => (
            <TouchableOpacity
              key={`detail-reaction-summary-${post.id}-${entry.emoji?.id || idx}`}
              style={[styles.reactionSummaryChip, { borderColor: c.border, backgroundColor: c.surface }]}
              onPress={() => void openReactionsPanel(post, entry.emoji)}
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
    );
  }

  function renderDetailPanelTabs(post: FeedPost) {
    const commentsCount = getPostCommentsCount(post);
    const reactionsCount = getPostReactionCount(post);
    return (
      <View style={[styles.detailPanelTabsRow, { borderTopColor: c.border, borderBottomColor: c.border }]}>
        <TouchableOpacity
          style={[
            styles.detailPanelTabButton,
            { borderColor: c.border, backgroundColor: detailPanel === 'comments' ? c.surface : c.inputBackground },
          ]}
          activeOpacity={0.85}
          onPress={() => {
            setDetailPanel('comments');
            onCloseReactionList();
          }}
        >
          <Text style={[styles.detailPanelTabText, { color: detailPanel === 'comments' ? c.textPrimary : c.textSecondary }]}>
            Comments ({commentsCount})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.detailPanelTabButton,
            { borderColor: c.border, backgroundColor: detailPanel === 'reactions' ? c.surface : c.inputBackground },
          ]}
          activeOpacity={0.85}
          onPress={() => void openReactionsPanel(post)}
        >
          <Text style={[styles.detailPanelTabText, { color: detailPanel === 'reactions' ? c.textPrimary : c.textSecondary }]}>
            Reactions ({reactionsCount})
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderReactionsPanel(post: FeedPost) {
    return (
      <View style={[styles.commentsBox, { borderTopColor: c.border }]}>
        <View style={styles.reactionSummaryWrap}>
          {(post.reactions_emoji_counts || [])
            .filter((entry) => (entry?.count || 0) > 0)
            .map((entry, idx) => (
              <TouchableOpacity
                key={`detail-reaction-panel-chip-${post.id}-${entry.emoji?.id || idx}`}
                style={[
                  styles.reactionSummaryChip,
                  {
                    borderColor: c.border,
                    backgroundColor: reactionListEmoji?.id === entry.emoji?.id ? c.surface : c.inputBackground,
                  },
                ]}
                onPress={() => void openReactionsPanel(post, entry.emoji)}
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

        {reactionListLoading ? (
          <ActivityIndicator color={c.primary} size="small" />
        ) : reactionListUsers.length === 0 ? (
          <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>{t('home.reactionReactorsEmpty')}</Text>
        ) : (
          <View style={styles.reactionListContent}>
            <ScrollView style={styles.reactionListScroll} contentContainerStyle={styles.reactionListScrollContent}>
              {reactionListUsers.map((item, idx) => (
                <TouchableOpacity
                  key={`reaction-user-inline-${item.id || idx}`}
                  style={[styles.reactionUserRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  activeOpacity={0.85}
                  onPress={() => {
                    const username = item.reactor?.username;
                    if (!username) return;
                    onNavigateProfile(username);
                  }}
                >
                  <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                    {item.reactor?.profile?.avatar ? (
                      <Image source={{ uri: item.reactor.profile.avatar }} style={styles.searchAvatarImage} resizeMode="cover" />
                    ) : (
                      <Text style={styles.searchAvatarLetter}>
                        {(item.reactor?.username?.[0] || t('home.unknownUser')[0] || 'U').toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <View style={styles.searchResultMeta}>
                    <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>
                      @{item.reactor?.username || t('home.unknownUser')}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    );
  }

  if (!activePost && !postRouteLoading) return null;

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
      {activePost ? (
        hasActivePostMedia ? (
          <View style={[styles.postDetailRoot, { backgroundColor: '#0B0E13' }]}> 
            <View style={styles.postDetailLeft}>
              <TouchableOpacity
                style={[styles.postDetailClose, { backgroundColor: 'rgba(255,255,255,0.16)' }]}
                onPress={onClose}
                activeOpacity={0.85}
                accessibilityLabel={t('home.closeNoticeAction')}
              >
                <MaterialCommunityIcons name="close" size={22} color="#fff" />
              </TouchableOpacity>

              <View style={styles.postDetailMediaWrap}>
                <Image source={{ uri: activePost.media_thumbnail }} style={styles.postDetailMedia} resizeMode="contain" />
              </View>
            </View>

            <View style={[styles.postDetailRight, { backgroundColor: c.surface, borderLeftColor: c.border }]}> 
              <View style={[styles.postDetailHeader, { borderBottomColor: c.border }]}> 
                <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}> 
                  {creatorAvatar ? (
                    <Image source={{ uri: creatorAvatar }} style={styles.feedAvatarImage} resizeMode="cover" />
                  ) : (
                    <Text style={styles.feedAvatarLetter}>{(activePost.creator?.username?.[0] || 'O').toUpperCase()}</Text>
                  )}
                </View>
                <View style={styles.feedHeaderMeta}>
                  <Text style={[styles.feedAuthor, { color: c.textPrimary }]}>@{activePost.creator?.username || t('home.unknownUser')}</Text>
                  <Text style={[styles.feedDate, { color: c.textMuted }]}>{activePost.created ? new Date(activePost.created).toLocaleString() : ''}</Text>
                </View>
              </View>

              <ScrollView style={styles.postDetailBody} contentContainerStyle={styles.postDetailBodyContent}>
                {!!getPostText(activePost) ? (
                  <Text style={[styles.postDetailText, { color: c.textSecondary }]}>
                    {extractTextSegmentsWithLinks(getPostText(activePost)).map((segment, idx) => (
                      <Text
                        key={`${activePost.id}-detail-text-segment-${idx}`}
                        onPress={segment.isLink ? () => onOpenLink(segment.url) : undefined}
                        style={segment.isLink ? [{ color: c.textLink, textDecorationLine: 'underline' } as any] : undefined}
                      >
                        {segment.text}
                      </Text>
                    ))}
                  </Text>
                ) : null}

                <View style={[styles.feedStatsRow, { borderTopColor: c.border, borderBottomColor: c.border }]}> 
                  <Text style={[styles.feedStatText, { color: c.textMuted }]}>{t('home.feedReactionsCount', { count: getPostReactionCount(activePost) })}</Text>
                  <Text style={[styles.feedStatText, { color: c.textMuted }]}>{t('home.feedCommentsCount', { count: getPostCommentsCount(activePost) })}</Text>
                </View>

                {detailPanel === 'comments' ? renderReactionSummary(activePost) : null}

                {renderPostActions(activePost)}
                {renderDetailPanelTabs(activePost)}

                {detailPanel === 'comments' ? (
                  <View style={[styles.commentsBox, { borderTopColor: c.border }]}> 
                    {renderCommentThread(activePost.id)}
                    <View style={styles.commentComposer}>
                      <TextInput
                        style={[styles.commentInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                        value={draftComments[activePost.id] || ''}
                        onChangeText={(value) => onUpdateDraftComment(activePost.id, value)}
                        placeholder={t('home.commentPlaceholder')}
                        placeholderTextColor={c.placeholder}
                      />
                      <TouchableOpacity
                        style={[styles.commentSendButton, { backgroundColor: c.primary }]}
                        onPress={() => onSubmitComment(activePost.id)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.commentSendText}>{t('home.commentPostAction')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  renderReactionsPanel(activePost)
                )}
              </ScrollView>
            </View>
          </View>
        ) : (
          <View style={[styles.postDetailTextOnlyRoot, { backgroundColor: '#0B0E13' }]}> 
            <View style={[styles.postDetailTextOnlyCard, { backgroundColor: c.surface, borderColor: c.border }]}> 
              <View style={[styles.postDetailTextOnlyHeader, { borderBottomColor: c.border }]}> 
                <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}> 
                  {creatorAvatar ? (
                    <Image source={{ uri: creatorAvatar }} style={styles.feedAvatarImage} resizeMode="cover" />
                  ) : (
                    <Text style={styles.feedAvatarLetter}>{(activePost.creator?.username?.[0] || 'O').toUpperCase()}</Text>
                  )}
                </View>
                <View style={styles.feedHeaderMeta}>
                  <Text style={[styles.feedAuthor, { color: c.textPrimary }]}>@{activePost.creator?.username || t('home.unknownUser')}</Text>
                  <Text style={[styles.feedDate, { color: c.textMuted }]}>{activePost.created ? new Date(activePost.created).toLocaleString() : ''}</Text>
                </View>
                <TouchableOpacity style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]} onPress={onClose} activeOpacity={0.85}>
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.postDetailBody} contentContainerStyle={styles.postDetailBodyContent}>
                {!!getPostText(activePost) ? (
                  <Text style={[styles.postDetailText, { color: c.textSecondary }]}>
                    {extractTextSegmentsWithLinks(getPostText(activePost)).map((segment, idx) => (
                      <Text
                        key={`${activePost.id}-detail-textonly-segment-${idx}`}
                        onPress={segment.isLink ? () => onOpenLink(segment.url) : undefined}
                        style={segment.isLink ? [{ color: c.textLink, textDecorationLine: 'underline' } as any] : undefined}
                      >
                        {segment.text}
                      </Text>
                    ))}
                  </Text>
                ) : null}

                <View style={[styles.feedStatsRow, { borderTopColor: c.border, borderBottomColor: c.border }]}> 
                  <Text style={[styles.feedStatText, { color: c.textMuted }]}>{t('home.feedReactionsCount', { count: getPostReactionCount(activePost) })}</Text>
                  <Text style={[styles.feedStatText, { color: c.textMuted }]}>{t('home.feedCommentsCount', { count: getPostCommentsCount(activePost) })}</Text>
                </View>

                {detailPanel === 'comments' ? renderReactionSummary(activePost) : null}

                {renderPostActions(activePost)}
                {renderDetailPanelTabs(activePost)}

                {detailPanel === 'comments' ? (
                  <View style={[styles.commentsBox, { borderTopColor: c.border }]}> 
                    {renderCommentThread(activePost.id)}
                  </View>
                ) : (
                  renderReactionsPanel(activePost)
                )}
              </ScrollView>

              {detailPanel === 'comments' ? (
                <View style={[styles.postDetailTextOnlyComposerWrap, { borderTopColor: c.border }]}> 
                  <View style={styles.commentComposer}>
                    <TextInput
                      style={[styles.commentInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                      value={draftComments[activePost.id] || ''}
                      onChangeText={(value) => onUpdateDraftComment(activePost.id, value)}
                      placeholder={t('home.commentPlaceholder')}
                      placeholderTextColor={c.placeholder}
                    />
                    <TouchableOpacity
                      style={[styles.commentSendButton, { backgroundColor: c.primary }]}
                      onPress={() => onSubmitComment(activePost.id)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.commentSendText}>{t('home.commentPostAction')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        )
      ) : (
        <View style={[styles.postDetailRoot, { backgroundColor: '#0B0E13', alignItems: 'center', justifyContent: 'center' }]}> 
          <ActivityIndicator color="#fff" size="large" />
        </View>
      )}
      </View>
    </Modal>
  );
}
