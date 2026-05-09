/**
 * LongPostDetailWebView — web-side dedicated reader for long posts.
 *
 * Mirrors the native `LongPostDetailScreenContainer` structurally, but
 * accepts data as props (HomeScreen already owns post / comment /
 * reaction state), so we don't duplicate fetches. Drops in beside
 * `<PostDetailModal>` in HomeScreen — the latter keeps rendering for
 * short posts; LP posts route through here instead.
 *
 * Why a separate web component instead of widening PostDetailModal:
 *   • PostDetailModal is built around the split-view media-on-left,
 *     text-on-right layout. Articles want the opposite — wide centred
 *     text column, full-bleed inline images, no media gallery sidebar.
 *   • Different chrome (header bar with back/share, compact author meta).
 *   • Same data hooks, so behaviour stays identical to PostDetailModal
 *     where it overlaps (reactions, comments, edit, delete, threading).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { openExternalLink } from '../utils/openExternalLink';
import { useInlineMentionRenderer } from '../utils/renderInlineMentions';
import MentionHashtagInput from './MentionHashtagInput';
import { MentionPopupOverlay } from './MentionPopupProvider';
import { useAuth } from '../context/AuthContext';
import ReactionPickerDrawer from './ReactionPickerDrawer';
import type { FeedPost, PostComment } from '../api/client';

type RenderBlock = {
  type: 'paragraph' | 'heading' | 'quote' | 'image' | 'embed';
  text: string;
  url: string;
  caption: string;
  level: number;
};

const TEXT_BLOCK_TYPES = new Set<RenderBlock['type']>(['heading', 'paragraph', 'quote']);

function parseLongPostBlocks(value: unknown): RenderBlock[] {
  const source =
    Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(value);
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })()
        : [];

  return source
    .filter((block: any): block is Record<string, unknown> => !!block && typeof block === 'object')
    .map((block: any) => {
      const t = typeof block.type === 'string' ? block.type.toLowerCase() : 'paragraph';
      const nextType: RenderBlock['type'] =
        t === 'heading' || t === 'quote' || t === 'image' || t === 'embed' ? (t as any) : 'paragraph';
      return {
        type: nextType,
        text: typeof block.text === 'string' ? block.text : '',
        url: typeof block.url === 'string' ? block.url : '',
        caption: typeof block.caption === 'string' ? block.caption : '',
        level: typeof block.level === 'number' ? block.level : 2,
      };
    })
    .filter((block: RenderBlock) => {
      if (block.type === 'image' || block.type === 'embed') return !!block.url;
      return !!block.text;
    });
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(day / 365)}y`;
}

type Bool = Record<number, boolean>;

export type LongPostDetailWebViewProps = {
  c: any;
  t: (key: string, options?: any) => string;
  visible: boolean;
  postRouteLoading: boolean;
  activePost: FeedPost | null;
  currentUsername?: string;
  // Comments / replies state (mirrors PostDetailModal's props)
  localComments: Record<number, PostComment[]>;
  commentRepliesById: Record<number, PostComment[]>;
  commentRepliesExpanded: Bool;
  commentRepliesLoadingById: Bool;
  editingCommentById: Bool;
  editingReplyById: Bool;
  commentMutationLoadingById: Bool;
  // Reactions
  reactionGroups: any[];
  reactionPickerLoading: boolean;
  reactionActionLoading: boolean;
  // Helpers (HomeScreen already has these)
  getPostReactionCount: (post: FeedPost) => number;
  getPostCommentsCount: (post: FeedPost) => number;
  // Handlers
  onClose: () => void;
  onEnsureReactionGroups: () => Promise<void> | void;
  onReactToPostWithEmoji: (post: FeedPost, emojiId: number) => Promise<void> | void;
  onReactToComment: (postId: number, commentId: number, emojiId?: number) => Promise<void> | void;
  onToggleCommentReplies: (postId: number, commentId: number) => void;
  onSubmitComment: (postId: number, text: string) => Promise<void> | void;
  onSubmitReply: (postId: number, commentId: number, text: string) => Promise<void> | void;
  onStartEditingComment: (commentId: number, currentText: string, isReply: boolean) => void;
  onCancelEditingComment: (commentId: number, isReply: boolean) => void;
  onSaveEditedComment: (postId: number, commentId: number, isReply: boolean, text: string, parentCommentId?: number) => Promise<void> | void;
  onDeleteComment: (postId: number, commentId: number, isReply: boolean, parentCommentId?: number) => Promise<void> | void;
  onSharePost: (post: FeedPost) => Promise<void> | void;
};

export default function LongPostDetailWebView(props: LongPostDetailWebViewProps) {
  const {
    c, t, visible, postRouteLoading, activePost, currentUsername,
    localComments, commentRepliesById, commentRepliesExpanded, commentRepliesLoadingById,
    editingCommentById, editingReplyById, commentMutationLoadingById,
    reactionGroups, reactionPickerLoading, reactionActionLoading,
    getPostReactionCount, getPostCommentsCount,
    onClose, onEnsureReactionGroups, onReactToPostWithEmoji, onReactToComment,
    onToggleCommentReplies, onSubmitComment, onSubmitReply,
    onStartEditingComment, onCancelEditingComment, onSaveEditedComment, onDeleteComment,
    onSharePost,
  } = props;

  const { height: screenHeight } = useWindowDimensions();
  const renderInline = useInlineMentionRenderer(c);
  const { token } = useAuth();

  // Composer modal (shared shape with the native LP screen).
  type ComposerTarget =
    | { kind: 'comment' }
    | { kind: 'reply'; commentId: number; username?: string };
  const [composerTarget, setComposerTarget] = useState<ComposerTarget | null>(null);
  const [composerDraft, setComposerDraft] = useState('');
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const composerOpen = composerTarget !== null;

  const openComposer = useCallback(() => {
    if (!activePost || (activePost as any).is_closed) return;
    setComposerTarget({ kind: 'comment' });
  }, [activePost]);
  const openReplyComposer = useCallback(
    (commentId: number, username?: string) => {
      if (!activePost || (activePost as any).is_closed) return;
      setComposerDraft('');
      setComposerTarget({ kind: 'reply', commentId, username });
    },
    [activePost],
  );
  const closeComposer = useCallback(() => {
    if (composerSubmitting) return;
    Keyboard.dismiss();
    setComposerTarget(null);
  }, [composerSubmitting]);
  const submitComposer = useCallback(async () => {
    if (!activePost || !composerTarget || !composerDraft.trim() || composerSubmitting) return;
    setComposerSubmitting(true);
    try {
      if (composerTarget.kind === 'reply') {
        await onSubmitReply((activePost as any).id, composerTarget.commentId, composerDraft);
      } else {
        await onSubmitComment((activePost as any).id, composerDraft);
      }
      setComposerDraft('');
      Keyboard.dismiss();
      setComposerTarget(null);
    } finally {
      setComposerSubmitting(false);
    }
  }, [activePost, composerTarget, composerDraft, composerSubmitting, onSubmitComment, onSubmitReply]);

  // Reaction picker — shared between post + comments. `target=null`
  // means picker closed; `kind: 'post'` post-level; `kind: 'comment'`
  // a specific comment / reply.
  const [reactionPickerTarget, setReactionPickerTarget] = useState<
    | { kind: 'post' }
    | { kind: 'comment'; commentId: number }
    | null
  >(null);
  const reactionPickerOpen = reactionPickerTarget !== null;
  const openReactionPicker = useCallback(() => {
    void onEnsureReactionGroups();
    setReactionPickerTarget({ kind: 'post' });
  }, [onEnsureReactionGroups]);
  const openCommentReactionPicker = useCallback((commentId: number) => {
    void onEnsureReactionGroups();
    setReactionPickerTarget({ kind: 'comment', commentId });
  }, [onEnsureReactionGroups]);
  const closeReactionPicker = useCallback(() => setReactionPickerTarget(null), []);
  const handlePickReaction = useCallback(
    (emojiId: number) => {
      if (!activePost || !reactionPickerTarget) return;
      const target = reactionPickerTarget;
      setReactionPickerTarget(null);
      if (target.kind === 'comment') {
        void onReactToComment((activePost as any).id, target.commentId, emojiId);
      } else {
        void onReactToPostWithEmoji(activePost, emojiId);
      }
    },
    [activePost, reactionPickerTarget, onReactToComment, onReactToPostWithEmoji],
  );

  // Edit drafts. Keyed by comment id; covers both top-level + replies.
  const [editDraftById, setEditDraftById] = useState<Record<number, string>>({});
  const startEditing = useCallback(
    (commentId: number, currentText: string, isReply: boolean) => {
      setEditDraftById((prev) => ({ ...prev, [commentId]: currentText }));
      onStartEditingComment(commentId, currentText, isReply);
    },
    [onStartEditingComment],
  );
  const cancelEditing = useCallback(
    (commentId: number, isReply: boolean) => {
      setEditDraftById((prev) => {
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
      onCancelEditingComment(commentId, isReply);
    },
    [onCancelEditingComment],
  );
  const saveEdit = useCallback(
    async (commentId: number, isReply: boolean, parentCommentId?: number) => {
      const postId = (activePost as any)?.id;
      if (postId == null) return;
      const text = (editDraftById[commentId] || '').trim();
      if (!text) return;
      await onSaveEditedComment(postId, commentId, isReply, text, parentCommentId);
      setEditDraftById((prev) => {
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
    },
    [activePost, editDraftById, onSaveEditedComment],
  );
  const confirmDelete = useCallback(
    (commentId: number, isReply: boolean, parentCommentId?: number) => {
      const postId = (activePost as any)?.id;
      if (postId == null) return;
      // Web: use confirm dialog instead of native Alert.
      const ok =
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(t('home.commentDeleteConfirmBody', { defaultValue: 'This cannot be undone. Delete comment?' }))
          : true;
      if (!ok) return;
      void onDeleteComment(postId, commentId, isReply, parentCommentId);
    },
    [activePost, onDeleteComment, t],
  );

  // Auto-load isn't needed here — HomeScreen calls loadCommentsForPost
  // on openPostDetail, so localComments is populated before we mount.

  if (!visible) return null;

  if (postRouteLoading && !activePost) {
    return (
      <Modal
        visible
        animationType="fade"
        transparent={Platform.OS !== 'web'}
        onRequestClose={onClose}
        statusBarTranslucent={Platform.OS === 'android'}
        navigationBarTranslucent={Platform.OS === 'android'}
      >
        <View style={[styles.fillCenter, { backgroundColor: c.background }]}>
          <ActivityIndicator color={c.primary} size="large" />
        </View>
      </Modal>
    );
  }
  if (!activePost) return null;

  const blocks = parseLongPostBlocks((activePost as any).long_text_blocks);
  const imageCount = blocks.filter((b) => b.type === 'image' && b.url).length;
  const readMinutes = (() => {
    const wordCount = blocks.reduce((sum, b) => {
      if (!TEXT_BLOCK_TYPES.has(b.type)) return sum;
      const text = (b.text || '').trim();
      return text ? sum + text.split(/\s+/).length : sum;
    }, 0);
    if (wordCount === 0) return 0;
    return Math.max(1, Math.round(wordCount / 225));
  })();

  const headerTitle = (() => {
    const heading = blocks.find((b) => b.type === 'heading' && b.text);
    return heading?.text || (activePost as any)?.text || t('home.longPostFallbackTitle', { defaultValue: 'Article' });
  })();

  const reactionsCount = getPostReactionCount(activePost);
  const postId = (activePost as any).id as number | undefined;
  const localCommentsList = postId != null ? (localComments[postId] || []) : [];
  const commentsCount = localCommentsList.length || getPostCommentsCount(activePost);

  const author = (activePost as any).creator;
  const authorName = author?.profile?.name || author?.username || t('home.unknownUser', { defaultValue: 'Unknown' });
  const authorHandle = author?.username || '';

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={Platform.OS !== 'web'}
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === 'android'}
      navigationBarTranslucent={Platform.OS === 'android'}
    >
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onClose}
          style={[styles.headerBtn, { backgroundColor: c.inputBackground, borderColor: c.border }]}
        >
          <MaterialCommunityIcons name="chevron-left" size={22} color={c.textPrimary} />
        </TouchableOpacity>
        <Text numberOfLines={1} style={[styles.headerTitle, { color: c.textPrimary }]}>
          {headerTitle}
        </Text>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => void onSharePost(activePost)}
          style={[styles.headerBtn, { backgroundColor: c.inputBackground, borderColor: c.border }]}
        >
          <MaterialCommunityIcons name="share-variant" size={18} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        <View style={styles.articleWrap}>
          <View style={styles.authorRow}>
            {author?.profile?.avatar ? (
              <Image source={{ uri: author.profile.avatar }} style={styles.authorAvatar} />
            ) : (
              <View style={[styles.authorAvatar, { backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={styles.authorAvatarLetter}>{(authorName || 'A').slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.authorName, { color: c.textPrimary }]} numberOfLines={1}>
                {authorName}
              </Text>
              <Text style={[styles.authorMeta, { color: c.textMuted }]} numberOfLines={1}>
                @{authorHandle}
                {(activePost as any)?.created ? ` · ${formatRelativeTime((activePost as any).created)}` : ''}
                {readMinutes > 0 ? ` · ${t('home.longPostReadMinutes', { count: readMinutes, defaultValue: '{{count}} min read' })}` : ''}
                {imageCount > 0 ? ` · ${t('home.longPostPhotosCount', { count: imageCount, defaultValue: '{{count}} photos' })}` : ''}
              </Text>
            </View>
          </View>

          <View style={styles.blockList}>
            {blocks.map((block, idx) => {
              if (block.type === 'heading') {
                return (
                  <Text
                    key={`lp-heading-${idx}`}
                    style={[
                      styles.heading,
                      block.level === 1 ? styles.headingH1 : block.level === 3 ? styles.headingH3 : styles.headingH2,
                      { color: c.textPrimary },
                    ]}
                  >
                    {renderInline(block.text)}
                  </Text>
                );
              }
              if (block.type === 'quote') {
                return (
                  <View key={`lp-quote-${idx}`} style={[styles.quote, { borderLeftColor: c.primary, backgroundColor: c.inputBackground }]}>
                    <Text style={[styles.quoteText, { color: c.textSecondary }]}>
                      {'"'}
                      {renderInline(block.text || '')}
                      {'"'}
                    </Text>
                  </View>
                );
              }
              if (block.type === 'image' && block.url) {
                return (
                  <View key={`lp-image-${idx}`} style={styles.imageWrap}>
                    <Image source={{ uri: block.url }} style={styles.image} resizeMode="contain" />
                    {block.caption ? (
                      <Text style={[styles.imageCaption, { color: c.textMuted }]}>{block.caption}</Text>
                    ) : null}
                  </View>
                );
              }
              if (block.type === 'embed' && block.url) {
                return (
                  <TouchableOpacity
                    key={`lp-embed-${idx}`}
                    style={[styles.embedChip, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    activeOpacity={0.85}
                    onPress={() => void openExternalLink(block.url)}
                  >
                    <MaterialCommunityIcons name="open-in-new" size={14} color={c.textLink} />
                    <Text numberOfLines={1} style={[styles.embedText, { color: c.textLink }]}>
                      {block.url}
                    </Text>
                  </TouchableOpacity>
                );
              }
              return (
                <Text key={`lp-paragraph-${idx}`} style={[styles.paragraph, { color: c.textPrimary }]}>
                  {renderInline(block.text)}
                </Text>
              );
            })}
          </View>

          <View style={[styles.statsRow, { borderTopColor: c.border, borderBottomColor: c.border }]}>
            <Text style={[styles.statsText, { color: c.textMuted }]}>
              {t('home.feedReactionsCount', { count: reactionsCount })}
            </Text>
            <Text style={[styles.statsText, { color: c.textMuted }]}>
              {t('home.feedCommentsCount', { count: commentsCount })}
            </Text>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={openReactionPicker}
            >
              <MaterialCommunityIcons name="emoticon-happy-outline" size={18} color={c.textSecondary} />
              <Text style={[styles.actionText, { color: c.textSecondary }]}>{t('home.reactAction', { defaultValue: 'React' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={openComposer}
            >
              <MaterialCommunityIcons name="comment-outline" size={18} color={c.textSecondary} />
              <Text style={[styles.actionText, { color: c.textSecondary }]}>{t('home.commentAction', { defaultValue: 'Comment' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={() => void onSharePost(activePost)}
            >
              <MaterialCommunityIcons name="share-variant" size={18} color={c.textSecondary} />
              <Text style={[styles.actionText, { color: c.textSecondary }]}>{t('home.shareAction', { defaultValue: 'Share' })}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.commentsSection}>
            <Text style={[styles.commentsHeader, { color: c.textPrimary }]}>
              {t('home.commentsHeading', { defaultValue: 'Comments' })}
              {commentsCount > 0 ? ` · ${commentsCount}` : ''}
            </Text>
            <TouchableOpacity
              style={[styles.composerLauncher, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={openComposer}
            >
              <Text style={[styles.composerLauncherText, { color: c.textMuted }]}>
                {t('home.commentPlaceholder', { defaultValue: 'Write a comment…' })}
              </Text>
              <MaterialCommunityIcons name="pencil-outline" size={16} color={c.textMuted} />
            </TouchableOpacity>

            {localCommentsList.length === 0 ? (
              <Text style={[styles.commentsEmpty, { color: c.textMuted }]}>
                {t('home.commentsEmpty', { defaultValue: 'Be the first to comment.' })}
              </Text>
            ) : (
              localCommentsList.map((comment) => {
                const replies = commentRepliesById[comment.id] || [];
                const repliesCount = Math.max(comment.replies_count || 0, replies.length);
                const repliesExpanded = !!commentRepliesExpanded[comment.id];
                const repliesLoading = !!commentRepliesLoadingById[comment.id];
                return (
                  <View key={comment.id} style={[styles.commentBlock, { borderTopColor: c.border }]}>
                    {renderCommentRow({
                      comment,
                      isReply: false,
                      c, t, currentUsername,
                      token: token || undefined,
                      isEditing: !!editingCommentById[comment.id],
                      editDraft: editDraftById[comment.id] ?? '',
                      mutationLoading: !!commentMutationLoadingById[comment.id],
                      setEditDraft: (v) => setEditDraftById((prev) => ({ ...prev, [comment.id]: v })),
                      onStartEditing: () => startEditing(comment.id, comment.text || '', false),
                      onCancelEditing: () => cancelEditing(comment.id, false),
                      onSaveEdit: () => void saveEdit(comment.id, false),
                      onDelete: () => confirmDelete(comment.id, false),
                      openReplyComposer,
                      openCommentReactionPicker,
                      postId,
                      repliesCount,
                      repliesExpanded,
                      repliesLoading,
                      toggleCommentReplies: onToggleCommentReplies,
                    })}

                    {repliesExpanded && replies.length > 0 ? (
                      <View style={[styles.repliesWrap, { borderLeftColor: c.border }]}>
                        {replies.map((reply) => (
                          <View key={reply.id} style={styles.replyItem}>
                            {renderCommentRow({
                              comment: reply,
                              isReply: true,
                              c, t, currentUsername,
                              isEditing: !!editingReplyById[reply.id],
                              editDraft: editDraftById[reply.id] ?? '',
                              mutationLoading: !!commentMutationLoadingById[reply.id],
                              setEditDraft: (v) => setEditDraftById((prev) => ({ ...prev, [reply.id]: v })),
                              onStartEditing: () => startEditing(reply.id, reply.text || '', true),
                              onCancelEditing: () => cancelEditing(reply.id, true),
                              onSaveEdit: () => void saveEdit(reply.id, true, comment.id),
                              onDelete: () => confirmDelete(reply.id, true, comment.id),
                              openReplyComposer: () =>
                                openReplyComposer(comment.id, reply.commenter?.username || comment.commenter?.username || undefined),
                              openCommentReactionPicker,
                              postId,
                              repliesCount: 0,
                              repliesExpanded: false,
                              repliesLoading: false,
                              toggleCommentReplies: onToggleCommentReplies,
                            })}
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>

      <ReactionPickerDrawer
        visible={reactionPickerOpen}
        groups={reactionGroups}
        loading={reactionPickerLoading}
        actionLoading={reactionActionLoading}
        onPick={handlePickReaction}
        onClose={closeReactionPicker}
        c={c}
        t={t}
        title={t('home.reactToPostTitle', { defaultValue: 'React to post' })}
      />

      <Modal
        visible={composerOpen}
        animationType="fade"
        transparent
        onRequestClose={closeComposer}
      >
        <View style={styles.composerOverlay} pointerEvents="box-none">
          <Pressable style={styles.composerBackdrop} onPress={closeComposer} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.composerKeyboardWrap}
          >
            <View
              style={[
                styles.composerSheet,
                Platform.OS === 'web' ? styles.composerSheetWeb : styles.composerSheetMobile,
                { borderColor: c.border, backgroundColor: c.surface, maxHeight: Math.min(screenHeight * 0.88, 760) },
              ]}
            >
              <View style={styles.composerHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.composerTitle, { color: c.textPrimary }]}>
                    {composerTarget?.kind === 'reply'
                      ? t('home.replyPostAction', { defaultValue: 'Reply' })
                      : t('home.commentPostAction', { defaultValue: 'Comment' })}
                  </Text>
                  <Text style={[styles.composerSubtitle, { color: c.textMuted }]} numberOfLines={1}>
                    {composerTarget?.kind === 'reply'
                      ? t('home.replyingToLabel', {
                          defaultValue: 'Replying to @{{username}}',
                          username: composerTarget.username || t('home.unknownUser', { defaultValue: 'unknown' }),
                        })
                      : t('home.commentingOnLabel', {
                          defaultValue: 'Commenting on @{{username}}',
                          username: authorHandle || 'post',
                        })}
                  </Text>
                </View>
                <Pressable
                  onPress={closeComposer}
                  disabled={composerSubmitting}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.composerCloseBtn,
                    { borderColor: c.border, backgroundColor: c.inputBackground },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </Pressable>
              </View>

              {composerTarget?.kind === 'reply' ? (() => {
                const parent = localCommentsList.find((co) => co.id === composerTarget.commentId)
                  || Object.values(commentRepliesById).flatMap((arr) => arr).find((co) => co.id === composerTarget.commentId);
                if (!parent) return null;
                return (
                  <View style={[styles.composerReplyPreview, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                    <Text style={[styles.composerPreviewLabel, { color: c.textMuted }]}>
                      {t('home.replyingToPreviewLabel', { defaultValue: 'Replying to' })}
                    </Text>
                    <Text style={[styles.composerPreviewAuthor, { color: c.textPrimary }]} numberOfLines={1}>
                      @{parent.commenter?.username || t('home.unknownUser', { defaultValue: 'unknown' })}
                    </Text>
                    {parent.text ? (
                      <Text numberOfLines={3} style={[styles.composerPreviewText, { color: c.textSecondary }]}>
                        {parent.text}
                      </Text>
                    ) : null}
                  </View>
                );
              })() : null}

              <MentionHashtagInput
                style={[
                  styles.composerInput,
                  { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary },
                ]}
                value={composerDraft}
                onChangeText={setComposerDraft}
                token={token || undefined}
                c={c}
                placeholder={t('home.commentPlaceholder', { defaultValue: 'Write a comment…' })}
                placeholderTextColor={c.placeholder}
                multiline
                autoFocus
                editable={!composerSubmitting}
              />
              <TouchableOpacity
                style={[
                  styles.composerSubmit,
                  { backgroundColor: composerDraft.trim() && !composerSubmitting ? c.primary : c.inputBackground, borderColor: c.border },
                ]}
                activeOpacity={0.85}
                disabled={!composerDraft.trim() || composerSubmitting}
                onPress={() => void submitComposer()}
              >
                {composerSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.composerSubmitText, { color: composerDraft.trim() ? '#fff' : c.textMuted }]}>
                    {composerTarget?.kind === 'reply'
                      ? t('home.replyPostAction', { defaultValue: 'Reply' })
                      : t('home.commentPostAction', { defaultValue: 'Comment' })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
    {/* Mount the popup overlay INSIDE the Modal so the @mention/#hashtag
        suggestion list is visible — RN's <Modal> paints in a separate
        native window and the app-root MentionPopupOverlay would otherwise
        sit behind it. Same trick PostComposerScreen / HomeScreen use. */}
    <MentionPopupOverlay />
    </Modal>
  );
}

// ── Comment / reply row renderer (module-level, shared between top-level and replies) ──

type RenderRowProps = {
  comment: PostComment;
  isReply: boolean;
  c: any;
  t: (key: string, options?: any) => string;
  currentUsername?: string;
  token?: string;
  isEditing: boolean;
  editDraft: string;
  mutationLoading: boolean;
  setEditDraft: (value: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  openReplyComposer: (commentId: number, username?: string) => void;
  openCommentReactionPicker: (commentId: number) => void;
  postId: number | undefined;
  repliesCount: number;
  repliesExpanded: boolean;
  repliesLoading: boolean;
  toggleCommentReplies: (postId: number, commentId: number) => void;
};

function renderCommentRow(p: RenderRowProps) {
  const {
    comment, isReply, c, t, currentUsername, token,
    isEditing, editDraft, mutationLoading, setEditDraft,
    onStartEditing, onCancelEditing, onSaveEdit, onDelete,
    openReplyComposer, openCommentReactionPicker, postId,
    repliesCount, repliesExpanded, repliesLoading, toggleCommentReplies,
  } = p;
  const isOwn = !!currentUsername && comment.commenter?.username === currentUsername;
  const avatarStyle = isReply ? styles.replyAvatar : styles.commentAvatar;
  const avatarLetterStyle = isReply ? styles.replyAvatarLetter : styles.commentAvatarLetter;

  const reactionEntries: Array<{ emoji?: any; count?: number }> = Array.isArray(
    (comment as any).reactions_emoji_counts,
  )
    ? (comment as any).reactions_emoji_counts.filter((entry: any) => (entry?.count || 0) > 0)
    : [];
  const ownReaction = (comment as any).reaction;
  const ownReactionEmojiId = ownReaction?.emoji?.id;

  return (
    <View style={styles.commentItem}>
      {comment.commenter?.profile?.avatar ? (
        <Image source={{ uri: comment.commenter.profile.avatar }} style={avatarStyle} />
      ) : (
        <View style={[avatarStyle, { backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={avatarLetterStyle}>
            {(comment.commenter?.username || 'U').slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={[styles.commentAuthor, { color: c.textPrimary }]}>
          @{comment.commenter?.username || t('home.unknownUser', { defaultValue: 'unknown' })}
          {comment.created ? (
            <Text style={[styles.commentMeta, { color: c.textMuted }]}>
              {' · '}{formatRelativeTime(comment.created)}
            </Text>
          ) : null}
        </Text>

        {isEditing ? (
          <View style={styles.editWrap}>
            <MentionHashtagInput
              style={[styles.editInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
              value={editDraft}
              onChangeText={setEditDraft}
              token={token}
              c={c}
              placeholder={t('home.commentPlaceholder', { defaultValue: 'Write a comment…' })}
              placeholderTextColor={c.placeholder}
              multiline
              autoFocus
              editable={!mutationLoading}
            />
            <View style={styles.editActionsRow}>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={mutationLoading || !editDraft.trim()}
                onPress={onSaveEdit}
                style={[
                  styles.editBtn,
                  { backgroundColor: editDraft.trim() && !mutationLoading ? c.primary : c.inputBackground, borderColor: c.border },
                ]}
              >
                {mutationLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.editBtnText, { color: editDraft.trim() ? '#fff' : c.textMuted }]}>
                    {t('home.saveAction', { defaultValue: 'Save' })}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={mutationLoading}
                onPress={onCancelEditing}
                style={[styles.editBtn, { backgroundColor: c.inputBackground, borderColor: c.border }]}
              >
                <Text style={[styles.editBtnText, { color: c.textSecondary }]}>
                  {t('home.cancelAction', { defaultValue: 'Cancel' })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {comment.text ? (
              <Text style={[styles.commentText, { color: c.textSecondary }]}>{comment.text}</Text>
            ) : null}

            {reactionEntries.length > 0 ? (
              <View style={styles.reactionRow}>
                {reactionEntries.map((entry: any, idx: number) => {
                  const isOwnEmoji = !!ownReaction && entry?.emoji?.id === ownReactionEmojiId;
                  return (
                    <TouchableOpacity
                      key={`r-${comment.id}-${entry?.emoji?.id ?? idx}`}
                      style={[
                        styles.reactionChip,
                        { borderColor: isOwnEmoji ? c.primary : c.border, backgroundColor: isOwnEmoji ? `${c.primary}22` : c.inputBackground },
                      ]}
                      activeOpacity={0.85}
                      onPress={() => openCommentReactionPicker(comment.id)}
                    >
                      {entry?.emoji?.image ? (
                        <Image source={{ uri: entry.emoji.image }} style={styles.reactionEmoji} />
                      ) : entry?.emoji?.keyword ? (
                        <Text style={styles.reactionEmojiText}>{entry.emoji.keyword}</Text>
                      ) : null}
                      <Text style={[styles.reactionCount, { color: c.textSecondary }]}>{entry?.count ?? 0}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.commentActionsRow}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => openReplyComposer(comment.id, comment.commenter?.username || undefined)}
              >
                <Text style={[styles.commentActionText, { color: c.textLink }]}>
                  {t('home.replyAction', { defaultValue: 'Reply' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.7} onPress={() => openCommentReactionPicker(comment.id)}>
                <Text style={[styles.commentActionText, { color: c.textLink }]}>
                  {ownReaction
                    ? t('home.changeReactionAction', { defaultValue: 'Change reaction' })
                    : t('home.reactAction', { defaultValue: 'React' })}
                </Text>
              </TouchableOpacity>
              {isOwn ? (
                <>
                  <TouchableOpacity activeOpacity={0.7} onPress={onStartEditing}>
                    <Text style={[styles.commentActionText, { color: c.textLink }]}>
                      {t('home.editAction', { defaultValue: 'Edit' })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.7} onPress={onDelete}>
                    <Text style={[styles.commentActionText, { color: (c as any).errorText ?? c.textLink }]}>
                      {t('home.deleteAction', { defaultValue: 'Delete' })}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : null}
              {!isReply && repliesCount > 0 && postId != null ? (
                <TouchableOpacity activeOpacity={0.7} onPress={() => toggleCommentReplies(postId, comment.id)}>
                  <Text style={[styles.commentActionText, { color: c.textLink }]}>
                    {repliesLoading
                      ? t('home.loadingReplies', { defaultValue: 'Loading…' })
                      : repliesExpanded
                        ? t('home.hideReplies', { defaultValue: 'Hide replies' })
                        : t('home.viewReplies', { count: repliesCount, defaultValue: 'View {{count}} replies' })}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fillCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 999, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  scrollContent: { paddingBottom: 80 },
  articleWrap: {
    paddingHorizontal: 18,
    paddingTop: 14,
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  authorAvatar: { width: 38, height: 38, borderRadius: 999, overflow: 'hidden' },
  authorAvatarLetter: { color: '#fff', fontWeight: '700', fontSize: 16 },
  authorName: { fontSize: 14, fontWeight: '700' },
  authorMeta: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  blockList: { gap: 12 },
  heading: { fontWeight: '800', letterSpacing: 0.2 },
  headingH1: { fontSize: 28, lineHeight: 34, marginTop: 4 },
  headingH2: { fontSize: 22, lineHeight: 28 },
  headingH3: { fontSize: 18, lineHeight: 24 },
  paragraph: { fontSize: 16, lineHeight: 26 },
  quote: { borderLeftWidth: 3, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  quoteText: { fontSize: 16, lineHeight: 24, fontStyle: 'italic' },
  imageWrap: { marginVertical: 4 },
  image: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.04)' },
  imageCaption: { fontSize: 12, marginTop: 6, fontStyle: 'italic', textAlign: 'center' },
  embedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
    alignSelf: 'flex-start', maxWidth: '100%',
  },
  embedText: { fontSize: 13, fontWeight: '600' },
  statsRow: {
    marginTop: 22, paddingVertical: 10,
    borderTopWidth: 1, borderBottomWidth: 1,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  statsText: { fontSize: 13, fontWeight: '500' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 10, paddingVertical: 10,
  },
  actionText: { fontSize: 13, fontWeight: '600' },
  commentsSection: { marginTop: 24, gap: 12 },
  commentsHeader: { fontSize: 16, fontWeight: '700' },
  composerLauncher: {
    borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  },
  composerLauncherText: { flex: 1, fontSize: 14 },
  commentsEmpty: { fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  commentBlock: {
    paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 8,
  },
  commentItem: { flexDirection: 'row', gap: 10 },
  commentAvatar: { width: 32, height: 32, borderRadius: 999, overflow: 'hidden' },
  commentAvatarLetter: { color: '#fff', fontWeight: '700', fontSize: 13 },
  commentAuthor: { fontSize: 13, fontWeight: '700' },
  commentMeta: { fontSize: 12, fontWeight: '500' },
  commentText: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  commentActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
  commentActionText: { fontSize: 12, fontWeight: '700' },
  repliesWrap: { marginLeft: 22, paddingLeft: 12, borderLeftWidth: 2, gap: 10 },
  replyItem: { paddingVertical: 4 },
  replyAvatar: { width: 26, height: 26, borderRadius: 999, overflow: 'hidden' },
  replyAvatarLetter: { color: '#fff', fontWeight: '700', fontSize: 11 },
  editWrap: { marginTop: 6, gap: 8 },
  editInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, minHeight: 60, textAlignVertical: 'top' as const,
  },
  editActionsRow: { flexDirection: 'row', gap: 8 },
  editBtn: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
    minWidth: 64, alignItems: 'center', justifyContent: 'center',
  },
  editBtnText: { fontSize: 13, fontWeight: '700' },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  reactionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
  },
  reactionEmoji: { width: 14, height: 14 },
  reactionEmojiText: { fontSize: 12 },
  reactionCount: { fontSize: 12, fontWeight: '700' },
  composerOverlay: {
    flex: 1,
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
  },
  composerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,14,19,0.7)' },
  composerKeyboardWrap: {
    width: '100%',
    alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
  },
  composerSheet: { borderWidth: 1, padding: 16, gap: 12 },
  composerSheetWeb: { width: '100%', maxWidth: 640, borderRadius: 18 },
  composerSheetMobile: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 28 },
  composerHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  composerTitle: { fontSize: 20, fontWeight: '800' },
  composerSubtitle: { fontSize: 13, marginTop: 2 },
  composerCloseBtn: {
    width: 36, height: 36, borderRadius: 999, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  composerReplyPreview: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
  composerPreviewLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  composerPreviewAuthor: { fontSize: 13, fontWeight: '700' },
  composerPreviewText: { fontSize: 13, lineHeight: 18 },
  composerInput: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, lineHeight: 20, minHeight: 120, textAlignVertical: 'top' as const,
  },
  composerSubmit: {
    borderWidth: 1, borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  composerSubmitText: { fontSize: 14, fontWeight: '700' },
});
