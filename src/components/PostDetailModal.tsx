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

type LongPostRenderBlock = {
  type: 'heading' | 'paragraph' | 'quote' | 'image' | 'embed';
  text?: string;
  url?: string;
  caption?: string;
  level?: number;
};

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function parseLongPostBlocks(value: unknown): LongPostRenderBlock[] {
  const source =
    Array.isArray(value) ? value : (typeof value === 'string' ? (() => {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })() : []);

  return source
    .filter((block): block is Record<string, unknown> => !!block && typeof block === 'object')
    .map((block) => {
      const type = typeof block.type === 'string' ? block.type.toLowerCase() : 'paragraph';
      const nextType: LongPostRenderBlock['type'] =
        type === 'heading' || type === 'quote' || type === 'image' || type === 'embed'
          ? type
          : 'paragraph';
      return {
        type: nextType,
        text: typeof block.text === 'string' ? block.text : '',
        url: typeof block.url === 'string' ? block.url : '',
        caption: typeof block.caption === 'string' ? block.caption : '',
        level: typeof block.level === 'number' ? block.level : 2,
      };
    })
    .filter((block) => {
      if (block.type === 'image' || block.type === 'embed') return !!block.url;
      return !!block.text;
    });
}

function parseLongPostHtml(html?: string): LongPostRenderBlock[] {
  if (!html || !html.trim()) return [];
  const blocks: LongPostRenderBlock[] = [];
  const pattern = /<(h[1-3]|p|blockquote|img|iframe)\b[^>]*>([\s\S]*?)<\/\1>|<(img)\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(html)) !== null) {
    const tag = (match[1] || match[3] || '').toLowerCase();
    const raw = match[0] || '';
    const inner = match[2] || '';
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const text = decodeHtmlEntities(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
      if (text) blocks.push({ type: 'heading', text, level: tag === 'h1' ? 1 : tag === 'h3' ? 3 : 2 });
      continue;
    }
    if (tag === 'blockquote') {
      const text = decodeHtmlEntities(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
      if (text) blocks.push({ type: 'quote', text });
      continue;
    }
    if (tag === 'p') {
      const text = decodeHtmlEntities(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
      if (text) blocks.push({ type: 'paragraph', text });
      continue;
    }
    if (tag === 'img') {
      const src = raw.match(/\ssrc=(?:"([^"]+)"|'([^']+)')/i);
      const alt = raw.match(/\salt=(?:"([^"]+)"|'([^']+)')/i);
      const url = (src?.[1] || src?.[2] || '').trim();
      const caption = decodeHtmlEntities((alt?.[1] || alt?.[2] || '').trim());
      if (url) blocks.push({ type: 'image', url, caption });
      continue;
    }
    if (tag === 'iframe') {
      const src = raw.match(/\ssrc=(?:"([^"]+)"|'([^']+)')/i);
      const url = (src?.[1] || src?.[2] || '').trim();
      if (url) blocks.push({ type: 'embed', url });
    }
  }
  return blocks;
}

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
  const mediaGalleryUris = React.useMemo(() => {
    if (!activePost) return [];
    const urls: string[] = [];
    if (Array.isArray(activePost.media)) {
      activePost.media
        .slice()
        .sort((a, b) => (a?.order || 0) - (b?.order || 0))
        .forEach((item) => {
          const uri = item?.thumbnail || item?.image || item?.file;
          if (uri && !urls.includes(uri)) urls.push(uri);
        });
    }
    if (!urls.length && activePost.media_thumbnail) {
      urls.push(activePost.media_thumbnail);
    }
    return urls;
  }, [activePost]);
  const longPostBlocks = React.useMemo(() => {
    if (!activePost) return [];
    const parsedBlocks = parseLongPostBlocks(activePost.long_text_blocks);
    if (parsedBlocks.length > 0) return parsedBlocks;
    const fromHtml = parseLongPostHtml(activePost.long_text_rendered_html || activePost.long_text);
    if (fromHtml.length > 0) return fromHtml;
    return [];
  }, [activePost]);
  const isLongPost = (activePost?.type || '').toUpperCase() === 'LP';
  const [activeMediaIndex, setActiveMediaIndex] = React.useState(0);
  const activeMediaUri = mediaGalleryUris[activeMediaIndex] || activePost?.media_thumbnail;

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

  React.useEffect(() => {
    setActiveMediaIndex(0);
  }, [activePost?.id, visible]);

  React.useEffect(() => {
    if (activeMediaIndex < mediaGalleryUris.length) return;
    setActiveMediaIndex(0);
  }, [activeMediaIndex, mediaGalleryUris.length]);

  React.useEffect(() => {
    if (!visible || mediaGalleryUris.length <= 1) return;
    if (typeof document === 'undefined') return;

    function isTypingTarget(target: EventTarget | null) {
      if (!target || !(target instanceof HTMLElement)) return false;
      const tag = target.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (target.isContentEditable) return true;
      return false;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveMediaIndex((prev) => (prev <= 0 ? mediaGalleryUris.length - 1 : prev - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveMediaIndex((prev) => (prev >= mediaGalleryUris.length - 1 ? 0 : prev + 1));
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, mediaGalleryUris.length]);

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

  function renderLinkedText(text: string, keyPrefix: string, textStyle?: any) {
    return (
      <Text style={textStyle}>
        {extractTextSegmentsWithLinks(text).map((segment, idx) => (
          <Text
            key={`${keyPrefix}-${idx}`}
            onPress={segment.isLink ? () => onOpenLink(segment.url) : undefined}
            style={segment.isLink ? [{ color: c.textLink, textDecorationLine: 'underline' } as any] : undefined}
          >
            {segment.text}
          </Text>
        ))}
      </Text>
    );
  }

  function renderLongPostBlocks(postId: number) {
    return (
      <View style={styles.longPostBlockList}>
        {longPostBlocks.map((block, idx) => {
          if (block.type === 'heading') {
            return (
              <Text
                key={`${postId}-lp-detail-heading-${idx}`}
                style={[
                  styles.longPostHeading,
                  block.level === 1
                    ? styles.longPostHeadingH1
                    : block.level === 3
                      ? styles.longPostHeadingH3
                      : styles.longPostHeadingH2,
                  { color: c.textPrimary },
                ]}
              >
                {block.text}
              </Text>
            );
          }
          if (block.type === 'quote') {
            return (
              <View
                key={`${postId}-lp-detail-quote-${idx}`}
                style={[styles.longPostQuoteWrap, { borderLeftColor: c.primary, backgroundColor: c.inputBackground }]}
              >
                <Text style={[styles.longPostQuoteText, { color: c.textSecondary }]}>{`"${block.text || ''}"`}</Text>
              </View>
            );
          }
          if (block.type === 'image' && block.url) {
            return (
              <View key={`${postId}-lp-detail-image-${idx}`} style={styles.longPostImageWrap}>
                <Image source={{ uri: block.url }} style={styles.longPostImage} resizeMode="cover" />
                {block.caption ? (
                  <Text style={[styles.longPostCaption, { color: c.textMuted }]}>{block.caption}</Text>
                ) : null}
              </View>
            );
          }
          if (block.type === 'embed' && block.url) {
            return (
              <TouchableOpacity
                key={`${postId}-lp-detail-embed-${idx}`}
                activeOpacity={0.85}
                onPress={() => onOpenLink(block.url)}
                style={[styles.longPostEmbedChip, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              >
                <MaterialCommunityIcons name="open-in-new" size={14} color={c.textLink} />
                <Text numberOfLines={1} style={[styles.longPostEmbedText, { color: c.textLink }]}>
                  {block.url}
                </Text>
              </TouchableOpacity>
            );
          }
          return renderLinkedText(
            block.text || '',
            `${postId}-lp-detail-paragraph-${idx}`,
            [styles.feedText, styles.longPostParagraph, { color: c.textSecondary }]
          );
        })}
      </View>
    );
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
                {activeMediaUri ? (
                  <Image source={{ uri: activeMediaUri }} style={styles.postDetailMedia} resizeMode="contain" />
                ) : (
                  <View style={styles.postDetailMediaFallback}>
                    <Text style={styles.postDetailMediaFallbackText}>{t('home.postMediaUnavailable')}</Text>
                  </View>
                )}
                {mediaGalleryUris.length > 1 ? (
                  <>
                    <TouchableOpacity
                      style={[styles.postDetailMediaNavButton, styles.postDetailMediaNavButtonLeft]}
                      activeOpacity={0.85}
                      onPress={() =>
                        setActiveMediaIndex((prev) =>
                          prev <= 0 ? mediaGalleryUris.length - 1 : prev - 1
                        )
                      }
                    >
                      <MaterialCommunityIcons name="chevron-left" size={24} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.postDetailMediaNavButton, styles.postDetailMediaNavButtonRight]}
                      activeOpacity={0.85}
                      onPress={() =>
                        setActiveMediaIndex((prev) =>
                          prev >= mediaGalleryUris.length - 1 ? 0 : prev + 1
                        )
                      }
                    >
                      <MaterialCommunityIcons name="chevron-right" size={24} color="#fff" />
                    </TouchableOpacity>
                    <View style={styles.postDetailMediaCounter}>
                      <Text style={styles.postDetailMediaCounterText}>
                        {activeMediaIndex + 1}/{mediaGalleryUris.length}
                      </Text>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.postDetailMediaThumbStrip}
                    >
                      {mediaGalleryUris.map((uri, idx) => (
                        <TouchableOpacity
                          key={`post-detail-media-thumb-${activePost.id}-${idx}`}
                          style={[
                            styles.postDetailMediaThumbButton,
                            idx === activeMediaIndex ? styles.postDetailMediaThumbButtonActive : null,
                          ]}
                          activeOpacity={0.85}
                          onPress={() => setActiveMediaIndex(idx)}
                        >
                          <Image source={{ uri }} style={styles.postDetailMediaThumbImage} resizeMode="cover" />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                ) : null}
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
                {isLongPost && longPostBlocks.length > 0
                  ? renderLongPostBlocks(activePost.id)
                  : (!!getPostText(activePost)
                    ? renderLinkedText(
                      getPostText(activePost),
                      `${activePost.id}-detail-text-segment`,
                      [styles.postDetailText, { color: c.textSecondary }]
                    )
                    : null)}

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
                {isLongPost && longPostBlocks.length > 0
                  ? renderLongPostBlocks(activePost.id)
                  : (!!getPostText(activePost)
                    ? renderLinkedText(
                      getPostText(activePost),
                      `${activePost.id}-detail-textonly-segment`,
                      [styles.postDetailText, { color: c.textSecondary }]
                    )
                    : null)}

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
