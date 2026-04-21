import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FeedPost, PostComment } from '../api/client';
import { getSafeExternalVideoEmbedUrl } from '../utils/externalVideoEmbeds';
import { extractFirstUrlFromText, fetchShortPostLinkPreviewCached, getUrlHostLabel, ShortPostLinkPreview } from '../utils/shortPostEmbeds';
import MentionHashtagInput from './MentionHashtagInput';

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
  objectPosition?: string;
  imageFit?: 'cover' | 'contain';
  imageScale?: number;
};

type MediaGalleryItem = {
  key: string;
  previewUri: string;
  videoUri?: string;
  isVideo: boolean;
};

type CommentDraftMedia = {
  kind: 'image' | 'gif';
  uri: string;
};

function looksLikeVideoUrl(value?: string) {
  if (!value) return false;
  const clean = value.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.webm') || clean.endsWith('.m4v');
}

function looksLikeVideoType(value?: string) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'video' || normalized === 'v' || normalized.includes('video');
}

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
        objectPosition: typeof block.objectPosition === 'string' ? block.objectPosition : undefined,
        imageFit:
          block.imageFit === 'contain' || block.imageFit === 'cover'
            ? (block.imageFit as 'cover' | 'contain')
            : undefined,
        imageScale:
          typeof block.imageScale === 'number' && Number.isFinite(block.imageScale)
            ? block.imageScale
            : undefined,
      };
    })
    .filter((block) => {
      if (block.type === 'image' || block.type === 'embed') return !!block.url;
      return !!block.text;
    });
}

function getFocalOffset(position?: string) {
  const map: Record<string, { x: number; y: number }> = {
    'left top': { x: -1, y: -1 },
    'center top': { x: 0, y: -1 },
    'right top': { x: 1, y: -1 },
    'left center': { x: -1, y: 0 },
    'center center': { x: 0, y: 0 },
    'right center': { x: 1, y: 0 },
    'left bottom': { x: -1, y: 1 },
    'center bottom': { x: 0, y: 1 },
    'right bottom': { x: 1, y: 1 },
  };
  return map[position || 'center center'] || { x: 0, y: 0 };
}

function parseLongPostHtml(html?: string): LongPostRenderBlock[] {
  if (!html || !html.trim()) return [];
  const blocks: LongPostRenderBlock[] = [];
  const pattern = /<(h[1-3]|p|blockquote|img|iframe|figure)\b[^>]*>([\s\S]*?)<\/\1>|<(img)\b[^>]*\/?>/gi;
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
    if (tag === 'figure') {
      const isLinkEmbed = /\sdata-os-link-embed=(?:"true"|'true')/i.test(raw);
      if (isLinkEmbed) {
        const dataUrl =
          raw.match(/\sdata-url=(?:"([^"]+)"|'([^']+)')/i)?.[1]
          || raw.match(/\sdata-url=(?:"([^"]+)"|'([^']+)')/i)?.[2]
          || '';
        const anchorUrl =
          inner.match(/<a\b[^>]*\shref=(?:"([^"]+)"|'([^']+)')[^>]*>/i)?.[1]
          || inner.match(/<a\b[^>]*\shref=(?:"([^"]+)"|'([^']+)')[^>]*>/i)?.[2]
          || '';
        const url = decodeHtmlEntities((dataUrl || anchorUrl).trim());
        if (url) {
          blocks.push({ type: 'embed', url });
          continue;
        }
      }
      const iframe = inner.match(/<iframe\b[^>]*\ssrc=(?:"([^"]+)"|'([^']+)')[^>]*>/i);
      const iframeUrl = (iframe?.[1] || iframe?.[2] || '').trim();
      if (iframeUrl) {
        blocks.push({ type: 'embed', url: iframeUrl });
        continue;
      }
      const img = inner.match(/<img\b[^>]*\ssrc=(?:"([^"]+)"|'([^']+)')[^>]*\/?>/i);
      const imgUrl = (img?.[1] || img?.[2] || '').trim();
      if (imgUrl) {
        blocks.push({ type: 'image', url: imgUrl, caption: '' });
      }
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
  draftCommentMediaByPostId: Record<number, CommentDraftMedia | null>;
  draftReplyMediaByCommentId: Record<number, CommentDraftMedia | null>;
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
  initialMediaTimeSec?: number | null;
  onConsumeInitialMediaTime?: () => void;
  onClose: () => void;
  onLoadReactionList: (post: FeedPost, emoji?: ReactionEmoji) => void | Promise<void>;
  onEnsureReactionGroups: () => Promise<void>;
  onReactToPostWithEmoji: (post: FeedPost, emojiId?: number) => void | Promise<void>;
  onReactToComment: (postId: number, commentId: number, emojiId?: number) => void | Promise<void>;
  onToggleCommentReplies: (postId: number, commentId: number) => void;
  onSharePost: (post: FeedPost) => void;
  onRepostPost?: (post: FeedPost) => void;
  onOpenSharedPost?: (post: FeedPost) => void;
  onOpenLink: (url?: string) => void;
  onUpdateDraftComment: (postId: number, value: string) => void;
  onUpdateDraftReply: (commentId: number, value: string) => void;
  onPickDraftCommentImage: (postId: number) => void;
  onPickDraftReplyImage: (commentId: number) => void;
  onSetDraftCommentGif: (postId: number) => void;
  onSetDraftReplyGif: (commentId: number) => void;
  onClearDraftCommentMedia: (postId: number) => void;
  onClearDraftReplyMedia: (commentId: number) => void;
  onStartEditingComment: (commentId: number, currentText: string, isReply: boolean) => void;
  onCancelEditingComment: (commentId: number, isReply: boolean) => void;
  onUpdateEditCommentDraft: (commentId: number, value: string, isReply: boolean) => void;
  onSaveEditedComment: (postId: number, commentId: number, isReply: boolean, parentCommentId?: number) => void | Promise<void>;
  onDeleteComment: (postId: number, commentId: number, isReply: boolean, parentCommentId?: number) => void | Promise<void>;
  onSubmitComment: (postId: number) => void | Promise<void>;
  onSubmitReply: (postId: number, commentId: number) => void | Promise<void>;
  onNavigateProfile: (username: string) => void;
  onNavigateHashtag?: (tag: string) => void;
  token?: string;
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
  draftCommentMediaByPostId,
  draftReplyMediaByCommentId,
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
  initialMediaTimeSec,
  onConsumeInitialMediaTime,
  onClose,
  onLoadReactionList,
  onEnsureReactionGroups,
  onReactToPostWithEmoji,
  onReactToComment,
  onToggleCommentReplies,
  onSharePost,
  onRepostPost,
  onOpenSharedPost,
  onOpenLink,
  onUpdateDraftComment,
  onUpdateDraftReply,
  onPickDraftCommentImage,
  onPickDraftReplyImage,
  onSetDraftCommentGif,
  onSetDraftReplyGif,
  onClearDraftCommentMedia,
  onClearDraftReplyMedia,
  onStartEditingComment,
  onCancelEditingComment,
  onUpdateEditCommentDraft,
  onSaveEditedComment,
  onDeleteComment,
  onSubmitComment,
  onSubmitReply,
  onNavigateProfile,
  onNavigateHashtag,
  token,
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
  const detailVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const creatorAvatar = activePost?.creator?.avatar || activePost?.creator?.profile?.avatar;
  const hasReacted = !!activePost?.reaction?.id || !!activePost?.reaction?.emoji?.id;
  const mediaGalleryItems = React.useMemo(() => {
    if (!activePost) return [];
    const items: MediaGalleryItem[] = [];
    const seen = new Set<string>();
    if (Array.isArray(activePost.media)) {
      activePost.media
        .slice()
        .sort((a, b) => (a?.order || 0) - (b?.order || 0))
        .forEach((item) => {
          const fileUri = item?.file || '';
          const thumbnailUri = item?.thumbnail || item?.image || '';
          const isVideo = looksLikeVideoType(item?.type) || looksLikeVideoUrl(fileUri);
          const previewUri = (isVideo ? thumbnailUri || fileUri : item?.image || thumbnailUri || fileUri) || '';
          if (!previewUri) return;
          const key = `${item?.id || item?.order || previewUri}`;
          if (seen.has(key)) return;
          seen.add(key);
          items.push({
            key,
            previewUri,
            videoUri: isVideo ? fileUri || undefined : undefined,
            isVideo,
          });
        });
    }
    if (!items.length && activePost.media_thumbnail) {
      items.push({
        key: `thumb-${activePost.id}`,
        previewUri: activePost.media_thumbnail,
        isVideo: false,
      });
    }
    return items;
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
  const [longEmbedPreviewByUrl, setLongEmbedPreviewByUrl] = React.useState<Record<string, ShortPostLinkPreview>>({});
  React.useEffect(() => {
    if (!isLongPost || longPostBlocks.length === 0) return;
    const urls = Array.from(
      new Set(
        longPostBlocks
          .filter((b) => b.type === 'embed' && !!b.url)
          .map((b) => (b.url || '').trim())
          .filter(Boolean)
      )
    );
    const nonVideoUrls = urls.filter((url) => !getSafeExternalVideoEmbedUrl(url));
    if (nonVideoUrls.length === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        nonVideoUrls.map(async (url) => {
          try {
            const preview = await fetchShortPostLinkPreviewCached(url);
            return [url, preview] as const;
          } catch {
            return [url, { url, title: getUrlHostLabel(url) || url, siteName: getUrlHostLabel(url) }] as const;
          }
        })
      );
      if (cancelled) return;
      setLongEmbedPreviewByUrl((prev) => {
        const next = { ...prev };
        entries.forEach(([url, preview]) => {
          next[url] = preview;
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [isLongPost, longPostBlocks]);
  const shortPostLinkPreview = React.useMemo(() => {
    if (!activePost || isLongPost) return null;
    const firstLink = Array.isArray(activePost.links) && activePost.links.length > 0 ? activePost.links[0] : null;
    const fromApiUrl = (firstLink?.url || '').trim();
    const fromTextUrl = extractFirstUrlFromText(activePost.text || '') || '';
    const url = fromApiUrl || fromTextUrl;
    if (!url) return null;
    const title = (firstLink?.title || '').trim() || getUrlHostLabel(url) || url;
    const description = ((firstLink as any)?.description || '').trim() || undefined;
    const imageUrl = (firstLink?.image || '').trim() || undefined;
    const siteName = ((firstLink as any)?.site_name || '').trim() || getUrlHostLabel(url);
    const embedUrl = getSafeExternalVideoEmbedUrl(url) || undefined;
    return { url, title, description, imageUrl, siteName, embedUrl, isVideo: !!embedUrl };
  }, [activePost, isLongPost]);
  const [resolvedShortLinkPreview, setResolvedShortLinkPreview] = React.useState<any>(null);
  React.useEffect(() => {
    let cancelled = false;
    if (!shortPostLinkPreview || shortPostLinkPreview.isVideo) {
      setResolvedShortLinkPreview(shortPostLinkPreview);
      return () => {
        cancelled = true;
      };
    }
    const needsEnrichment =
      !shortPostLinkPreview.imageUrl ||
      !shortPostLinkPreview.description ||
      !shortPostLinkPreview.title ||
      shortPostLinkPreview.title.toLowerCase() === (shortPostLinkPreview.siteName || '').toLowerCase();
    if (!needsEnrichment) {
      setResolvedShortLinkPreview(shortPostLinkPreview);
      return () => {
        cancelled = true;
      };
    }
    void fetchShortPostLinkPreviewCached(shortPostLinkPreview.url)
      .then((enriched) => {
        if (cancelled) return;
        setResolvedShortLinkPreview({
          ...shortPostLinkPreview,
          title: enriched.title || shortPostLinkPreview.title,
          description: enriched.description || shortPostLinkPreview.description,
          imageUrl: enriched.imageUrl || shortPostLinkPreview.imageUrl,
          siteName: enriched.siteName || shortPostLinkPreview.siteName,
        });
      })
      .catch(() => {
        if (!cancelled) setResolvedShortLinkPreview(shortPostLinkPreview);
      });
    return () => {
      cancelled = true;
    };
  }, [shortPostLinkPreview]);
  const [activeMediaIndex, setActiveMediaIndex] = React.useState(0);
  const activeMedia = mediaGalleryItems[activeMediaIndex];
  const activeMediaUri = activeMedia?.previewUri || activePost?.media_thumbnail;

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

  function renderCommentMedia(items?: PostComment['media']) {
    const first = Array.isArray(items) ? items[0] : undefined;
    if (!first?.url) return null;
    const isGif = (first.type || '').toUpperCase() === 'G';
    return (
      <View style={{ marginTop: 8 }}>
        <Image
          source={{ uri: first.url }}
          style={{ width: 180, height: 180, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground }}
          resizeMode="cover"
        />
        {isGif ? (
          <View style={{ position: 'absolute', right: 8, bottom: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: c.primary }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.4 }}>GIF</Text>
          </View>
        ) : null}
      </View>
    );
  }

  function renderDraftMediaPreview(
    media: CommentDraftMedia | null | undefined,
    onClear: () => void
  ) {
    if (!media?.uri) return null;
    return (
      <View style={{ marginTop: 8, marginBottom: 8 }}>
        <View style={{ width: 120, height: 120, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground }}>
          <Image source={{ uri: media.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          {media.kind === 'gif' ? (
            <View style={{ position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: c.primary }}>
              <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>GIF</Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onClear}
          style={{ marginTop: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground }}
        >
          <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '700' }}>
            {t('home.removeAction', { defaultValue: 'Remove' })}
          </Text>
        </TouchableOpacity>
      </View>
    );
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
    if (activeMediaIndex < mediaGalleryItems.length) return;
    setActiveMediaIndex(0);
  }, [activeMediaIndex, mediaGalleryItems.length]);

  React.useEffect(() => {
    if (!visible || mediaGalleryItems.length <= 1) return;
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
        setActiveMediaIndex((prev) => (prev <= 0 ? mediaGalleryItems.length - 1 : prev - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveMediaIndex((prev) => (prev >= mediaGalleryItems.length - 1 ? 0 : prev + 1));
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, mediaGalleryItems.length]);

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
    type Segment =
      | { text: string; isLink: false; isMention: false; isHashtag: false }
      | { text: string; isLink: true; url: string; isMention: false; isHashtag: false }
      | { text: string; isLink: false; isMention: true; username: string; isHashtag: false }
      | { text: string; isLink: false; isMention: false; isHashtag: true; tag: string };

    const segments: Segment[] = [];
    const tokenRegex = /(https?:\/\/[^\s]+)|(@[A-Za-z0-9_]+)|(#[A-Za-z]\w*)/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while ((match = tokenRegex.exec(text)) !== null) {
      const start = match.index;

      if (start > lastIndex) {
        segments.push({ text: text.slice(lastIndex, start), isLink: false, isMention: false, isHashtag: false });
      }

      if (match[1]) {
        const rawUrl = match[1];
        const trimmedUrl = rawUrl.replace(/[),.;!?]+$/g, '');
        const trailing = rawUrl.slice(trimmedUrl.length);
        segments.push({ text: trimmedUrl, isLink: true, url: trimmedUrl, isMention: false, isHashtag: false });
        if (trailing) segments.push({ text: trailing, isLink: false, isMention: false, isHashtag: false });
      } else if (match[2]) {
        segments.push({ text: match[2], isLink: false, isMention: true, username: match[2].slice(1), isHashtag: false });
      } else if (match[3]) {
        segments.push({ text: match[3], isLink: false, isMention: false, isHashtag: true, tag: match[3].slice(1) });
      }

      lastIndex = start + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex), isLink: false, isMention: false, isHashtag: false });
    }

    return segments.length ? segments : [{ text, isLink: false, isMention: false, isHashtag: false } as Segment];
  }

  function renderLinkedText(text: string, keyPrefix: string, textStyle?: any) {
    return (
      <Text style={textStyle}>
        {extractTextSegmentsWithLinks(text).map((segment, idx) => {
          if (segment.isLink) return (
            <Text key={`${keyPrefix}-${idx}`} onPress={() => onOpenLink(segment.url)} style={{ color: c.textLink, textDecorationLine: 'underline' } as any}>
              {segment.text}
            </Text>
          );
          if (segment.isMention) return (
            <Text key={`${keyPrefix}-${idx}`} onPress={() => onNavigateProfile(segment.username)} style={{ color: c.primary ?? c.textLink, fontWeight: '700' }}>
              {segment.text}
            </Text>
          );
          if (segment.isHashtag) return (
            <Text key={`${keyPrefix}-${idx}`} onPress={onNavigateHashtag ? () => onNavigateHashtag!(segment.tag) : undefined} style={onNavigateHashtag ? { color: c.primary ?? c.textLink, fontWeight: '700' } : undefined}>
              {segment.text}
            </Text>
          );
          return <Text key={`${keyPrefix}-${idx}`}>{segment.text}</Text>;
        })}
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
            const imageFit = block.imageFit === 'cover' ? 'cover' : 'contain';
            const imageScale = typeof block.imageScale === 'number' && Number.isFinite(block.imageScale)
              ? Math.max(0.8, Math.min(1.6, block.imageScale))
              : 1;
            const focal = getFocalOffset(block.objectPosition);
            return (
              <View key={`${postId}-lp-detail-image-${idx}`} style={styles.longPostImageWrap}>
                <Image
                  source={{ uri: block.url }}
                  style={[
                    styles.longPostImage,
                    {
                      transform: [
                        { scale: imageScale },
                        { translateX: imageFit === 'cover' ? focal.x * 18 : 0 },
                        { translateY: imageFit === 'cover' ? focal.y * 18 : 0 },
                      ],
                    },
                    Platform.OS === 'web' && block.objectPosition
                      ? ({ objectFit: imageFit, objectPosition: block.objectPosition } as any)
                      : null,
                  ]}
                  resizeMode={imageFit}
                />
                {block.caption ? (
                  <Text style={[styles.longPostCaption, { color: c.textMuted }]}>{block.caption}</Text>
                ) : null}
              </View>
            );
          }
          if (block.type === 'embed' && block.url) {
            const embedUrl = getSafeExternalVideoEmbedUrl(block.url);
            if (Platform.OS === 'web' && embedUrl) {
              const iframeProps: any = {
                src: embedUrl,
                title: 'Embedded video',
                loading: 'lazy',
                allow:
                  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
                allowFullScreen: true,
                style: {
                  width: '100%',
                  height: '100%',
                  border: '0',
                  borderRadius: 10,
                },
              };
              return (
                <View key={`${postId}-lp-detail-embed-${idx}`} style={{ width: '100%', marginVertical: 8 } as any}>
                  <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' } as any}>
                    {React.createElement('iframe', iframeProps)}
                  </View>
                </View>
              );
            }
            const preview = longEmbedPreviewByUrl[(block.url || '').trim()];
            if (preview) {
              return (
                <TouchableOpacity
                  key={`${postId}-lp-detail-embed-${idx}`}
                  style={[styles.shortPostLinkPreviewCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  activeOpacity={0.88}
                  onPress={() => onOpenLink(preview.url)}
                >
                  {preview.imageUrl ? (
                    <Image source={{ uri: preview.imageUrl }} style={styles.shortPostLinkPreviewImage} resizeMode="cover" />
                  ) : null}
                  <View style={styles.shortPostLinkPreviewMeta}>
                    {preview.siteName ? (
                      <Text numberOfLines={1} style={[styles.shortPostLinkPreviewSite, { color: c.textMuted }]}>
                        {preview.siteName}
                      </Text>
                    ) : null}
                    <Text numberOfLines={2} style={[styles.shortPostLinkPreviewTitle, { color: c.textPrimary }]}>
                      {preview.title}
                    </Text>
                    {preview.description ? (
                      <Text numberOfLines={2} style={[styles.shortPostLinkPreviewDescription, { color: c.textSecondary }]}>
                        {preview.description}
                      </Text>
                    ) : null}
                    <Text numberOfLines={1} style={[styles.shortPostLinkPreviewUrl, { color: c.textLink }]}>
                      {preview.url}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }
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

  function renderShortPostLinkPreview() {
    if (!resolvedShortLinkPreview) return null;
    if (Platform.OS === 'web' && resolvedShortLinkPreview.isVideo && resolvedShortLinkPreview.embedUrl) {
      return (
        <View style={[styles.shortPostVideoEmbedWrap, { backgroundColor: '#000' }] as any}>
          {React.createElement('iframe', {
            src: resolvedShortLinkPreview.embedUrl,
            title: resolvedShortLinkPreview.title || 'Embedded video',
            loading: 'lazy',
            allow:
              'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
            allowFullScreen: true,
            style: {
              width: '100%',
              height: '100%',
              border: '0',
            },
          } as any)}
        </View>
      );
    }
    return (
      <TouchableOpacity
        style={[styles.shortPostLinkPreviewCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}
        activeOpacity={0.88}
        onPress={() => onOpenLink(resolvedShortLinkPreview.url)}
      >
        {resolvedShortLinkPreview.imageUrl ? (
          <Image source={{ uri: resolvedShortLinkPreview.imageUrl }} style={styles.shortPostLinkPreviewImage} resizeMode="cover" />
        ) : null}
        <View style={styles.shortPostLinkPreviewMeta}>
          {resolvedShortLinkPreview.siteName ? (
            <Text numberOfLines={1} style={[styles.shortPostLinkPreviewSite, { color: c.textMuted }]}>
              {resolvedShortLinkPreview.siteName}
            </Text>
          ) : null}
          <Text numberOfLines={2} style={[styles.shortPostLinkPreviewTitle, { color: c.textPrimary }]}>
            {resolvedShortLinkPreview.title}
          </Text>
          {resolvedShortLinkPreview.description ? (
            <Text numberOfLines={2} style={[styles.shortPostLinkPreviewDescription, { color: c.textSecondary }]}>
              {resolvedShortLinkPreview.description}
            </Text>
          ) : null}
          <Text numberOfLines={1} style={[styles.shortPostLinkPreviewUrl, { color: c.textLink }]}>
            {resolvedShortLinkPreview.url}
          </Text>
        </View>
      </TouchableOpacity>
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
                <MentionHashtagInput
                  style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.surface, color: c.textPrimary }]}
                  value={commentEditDrafts[comment.id] ?? (comment.text || '')}
                  onChangeText={(value) => onUpdateEditCommentDraft(comment.id, value, false)}
                  placeholder={t('home.commentPlaceholder')}
                  placeholderTextColor={c.placeholder}
                  token={token}
                  c={c}
                  multiline
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
              <>
                {renderLinkedText(comment.text || '', `comment-${comment.id}`, [styles.detailCommentText, { color: c.textSecondary }])}
                {renderCommentMedia(comment.media)}
              </>
            )}
            {(() => {
              const activeEntries = (comment.reactions_emoji_counts || []).filter((e) => (e?.count || 0) > 0);
              if (activeEntries.length === 0) return null;
              const total = activeEntries.reduce((sum, e) => sum + (e.count || 0), 0);
              return (
                <View style={styles.commentReactionBubbleRow}>
                  <View style={styles.commentReactionChipGroup}>
                    {activeEntries.map((entry, idx) => {
                      const isMyReaction = !!entry.emoji?.id && comment.reaction?.emoji?.id === entry.emoji.id;
                      return (
                        <TouchableOpacity
                          key={`detail-comment-reaction-${comment.id}-${entry.emoji?.id || idx}`}
                          style={[
                            styles.commentReactionChip,
                            { borderColor: isMyReaction ? c.primary : c.border, backgroundColor: isMyReaction ? c.surface : c.inputBackground },
                          ]}
                          activeOpacity={0.75}
                          disabled={reactionActionLoading}
                          onPress={() => { void onReactToComment(postId, comment.id, entry.emoji?.id); }}
                        >
                          {entry.emoji?.image ? (
                            <Image source={{ uri: entry.emoji.image }} style={styles.commentReactionEmojiImage} resizeMode="contain" />
                          ) : (
                            <MaterialCommunityIcons name="emoticon-outline" size={12} color={isMyReaction ? c.primary : c.textSecondary} />
                          )}
                          <Text style={[styles.commentReactionCount, { color: isMyReaction ? c.primary : c.textSecondary }]}>
                            {entry.count || 0}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={[styles.commentReactionTotal, { color: c.textMuted }]}>{total}</Text>
                </View>
              );
            })()}
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
                              onPress={() => {
                                void onReactToComment(postId, comment.id, emoji.id);
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
                        <MentionHashtagInput
                          style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                          value={replyEditDrafts[reply.id] ?? (reply.text || '')}
                          onChangeText={(value) => onUpdateEditCommentDraft(reply.id, value, true)}
                          placeholder={t('home.replyPlaceholder')}
                          placeholderTextColor={c.placeholder}
                          token={token}
                          c={c}
                          multiline
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
                      <>
                        {renderLinkedText(reply.text || '', `reply-${reply.id}`, [styles.detailCommentText, { color: c.textSecondary }])}
                        {renderCommentMedia(reply.media)}
                      </>
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
              {renderDraftMediaPreview(
                draftReplyMediaByCommentId[comment.id],
                () => onClearDraftReplyMedia(comment.id)
              )}
              <MentionHashtagInput
                style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                value={draftReplies[comment.id] || ''}
                onChangeText={(value) => onUpdateDraftReply(comment.id, value)}
                placeholder={t('home.replyPlaceholder')}
                placeholderTextColor={c.placeholder}
                token={token}
                c={c}
                multiline
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity
                    style={[styles.commentReplySendButton, { backgroundColor: c.inputBackground, borderColor: c.border, borderWidth: 1 }]}
                    onPress={() => onPickDraftReplyImage(comment.id)}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="image-outline" size={14} color={c.textSecondary} />
                    <Text style={[styles.commentSendText, { color: c.textSecondary }]}>
                      {t('home.photoAction', { defaultValue: 'Photo' })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.commentReplySendButton, { backgroundColor: c.inputBackground, borderColor: c.border, borderWidth: 1 }]}
                    onPress={() => onSetDraftReplyGif(comment.id)}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="file-gif-box" size={14} color={c.textSecondary} />
                    <Text style={[styles.commentSendText, { color: c.textSecondary }]}>GIF</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[styles.commentReplySendButton, { backgroundColor: c.primary }]}
                  onPress={() => onSubmitReply(postId, comment.id)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.commentSendText}>{t('home.replyPostAction')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
      </View>
      );
    });
  }

  function renderSharedPostInset(post: FeedPost) {
    const sp = post.shared_post;
    if (!sp) return null;

    const spAvatar = sp.creator?.avatar || sp.creator?.profile?.avatar;
    const spText = sp.text || '';
    const spTitle = sp.community?.title || sp.community?.name || '';
    const spFirstImage = Array.isArray(sp.media) && sp.media.length > 0
      ? (sp.media.sort((a, b) => (a?.order || 0) - (b?.order || 0))[0]?.image ||
         sp.media.sort((a, b) => (a?.order || 0) - (b?.order || 0))[0]?.thumbnail)
      : sp.media_thumbnail;

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => onOpenSharedPost?.(sp as FeedPost)}
        style={{
          marginHorizontal: 0,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 12,
          backgroundColor: c.inputBackground,
          overflow: 'hidden',
        }}
      >
        {spTitle ? (
          <View style={{ paddingHorizontal: 12, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {sp.community?.avatar ? (
              <Image source={{ uri: sp.community.avatar }} style={{ width: 14, height: 14, borderRadius: 7 }} resizeMode="cover" />
            ) : null}
            <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted }}>
              c/{sp.community?.name || spTitle}
            </Text>
          </View>
        ) : null}
        <View style={{ paddingHorizontal: 12, paddingTop: spTitle ? 5 : 10, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.primary, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            {spAvatar ? (
              <Image source={{ uri: spAvatar }} style={{ width: 24, height: 24 }} resizeMode="cover" />
            ) : (
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
                {(sp.creator?.username?.[0] || 'U').toUpperCase()}
              </Text>
            )}
          </View>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textPrimary }}>
            @{sp.creator?.username || t('home.unknownUser', { defaultValue: 'Unknown' })}
          </Text>
          <MaterialCommunityIcons
            name="arrow-top-right"
            size={13}
            color={c.textMuted}
            style={{ marginLeft: 'auto' as any }}
          />
        </View>
        {spText ? (
          <Text
            style={{ paddingHorizontal: 12, paddingBottom: 8, fontSize: 14, lineHeight: 20, color: c.textPrimary }}
            numberOfLines={6}
          >
            {spText}
          </Text>
        ) : null}
        {spFirstImage ? (
          <Image
            source={{ uri: spFirstImage }}
            style={{ width: '100%', height: 200 }}
            resizeMode="cover"
          />
        ) : null}
        {!spFirstImage && !spText ? <View style={{ height: 8 }} /> : null}
      </TouchableOpacity>
    );
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

        {onRepostPost ? (
          <TouchableOpacity
            style={[
              styles.feedActionButton,
              {
                borderColor: post.user_has_reposted ? c.primary : c.border,
                backgroundColor: post.user_has_reposted ? c.surface : c.inputBackground,
              },
            ]}
            onPress={() => onRepostPost(post)}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons
              name="repeat-variant"
              size={16}
              color={post.user_has_reposted ? c.primary : c.textSecondary}
            />
            <Text style={[styles.feedActionText, { color: post.user_has_reposted ? c.primary : c.textSecondary }]}>
              {post.reposts_count && post.reposts_count > 0
                ? `${post.reposts_count}`
                : t('home.repostAction', { defaultValue: 'Repost' })}
            </Text>
          </TouchableOpacity>
        ) : null}

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
                {activeMedia?.isVideo && activeMedia.videoUri ? (
                  Platform.OS === 'web' ? (
                    <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                      {React.createElement('video', {
                        src: activeMedia.videoUri,
                        poster: activeMediaUri,
                        ref: (node: HTMLVideoElement | null) => {
                          detailVideoRef.current = node;
                        },
                        onLoadedMetadata: (event: any) => {
                          const videoEl = (event?.currentTarget || detailVideoRef.current) as HTMLVideoElement | null;
                          if (!videoEl) return;
                          if (!Number.isFinite(initialMediaTimeSec || NaN) || (initialMediaTimeSec || 0) <= 0) return;
                          const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
                          const target = duration > 0
                            ? Math.max(0, Math.min((initialMediaTimeSec as number), Math.max(0, duration - 0.25)))
                            : Math.max(0, initialMediaTimeSec as number);
                          try {
                            videoEl.currentTime = target;
                          } catch {
                            // Ignore seek errors from browser timing edge cases.
                          }
                          onConsumeInitialMediaTime?.();
                        },
                        controls: true,
                        playsInline: true,
                        style: {
                          width: '100%',
                          height: '100%',
                          maxHeight: '72vh',
                          backgroundColor: '#000',
                        },
                      })}
                    </View>
                  ) : (
                    <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                      {activeMediaUri ? (
                        <Image source={{ uri: activeMediaUri }} style={styles.postDetailMedia} resizeMode="contain" />
                      ) : null}
                      <View style={{ position: 'absolute' }}>
                        <MaterialCommunityIcons name="play-circle-outline" size={44} color="#fff" />
                      </View>
                    </View>
                  )
                ) : activeMediaUri ? (
                  <Image source={{ uri: activeMediaUri }} style={styles.postDetailMedia} resizeMode="contain" />
                ) : (
                  <View style={styles.postDetailMediaFallback}>
                    <Text style={styles.postDetailMediaFallbackText}>{t('home.postMediaUnavailable')}</Text>
                  </View>
                )}
                {mediaGalleryItems.length > 1 ? (
                  <>
                    <TouchableOpacity
                      style={[styles.postDetailMediaNavButton, styles.postDetailMediaNavButtonLeft]}
                      activeOpacity={0.85}
                      onPress={() =>
                        setActiveMediaIndex((prev) =>
                          prev <= 0 ? mediaGalleryItems.length - 1 : prev - 1
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
                          prev >= mediaGalleryItems.length - 1 ? 0 : prev + 1
                        )
                      }
                    >
                      <MaterialCommunityIcons name="chevron-right" size={24} color="#fff" />
                    </TouchableOpacity>
                    <View style={styles.postDetailMediaCounter}>
                      <Text style={styles.postDetailMediaCounterText}>
                        {activeMediaIndex + 1}/{mediaGalleryItems.length}
                      </Text>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.postDetailMediaThumbStrip}
                    >
                      {mediaGalleryItems.map((mediaItem, idx) => (
                        <TouchableOpacity
                          key={`post-detail-media-thumb-${activePost.id}-${mediaItem.key}`}
                          style={[
                            styles.postDetailMediaThumbButton,
                            idx === activeMediaIndex ? styles.postDetailMediaThumbButtonActive : null,
                          ]}
                          activeOpacity={0.85}
                          onPress={() => setActiveMediaIndex(idx)}
                        >
                          <Image source={{ uri: mediaItem.previewUri }} style={styles.postDetailMediaThumbImage} resizeMode="cover" />
                          {mediaItem.isVideo ? (
                            <View
                              style={{
                                position: 'absolute',
                                right: 4,
                                bottom: 4,
                                backgroundColor: 'rgba(0,0,0,0.65)',
                                borderRadius: 10,
                                paddingHorizontal: 4,
                                paddingVertical: 2,
                              }}
                            >
                              <MaterialCommunityIcons name="play" size={10} color="#fff" />
                            </View>
                          ) : null}
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
                {!isLongPost ? renderShortPostLinkPreview() : null}
                {renderSharedPostInset(activePost)}

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
                      {renderDraftMediaPreview(
                        draftCommentMediaByPostId[activePost.id],
                        () => onClearDraftCommentMedia(activePost.id)
                      )}
                      <MentionHashtagInput
                        style={[styles.commentInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                        value={draftComments[activePost.id] || ''}
                        onChangeText={(value) => onUpdateDraftComment(activePost.id, value)}
                        placeholder={t('home.commentPlaceholder')}
                        placeholderTextColor={c.placeholder}
                        token={token}
                        c={c}
                        multiline
                      />
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <TouchableOpacity
                            style={[styles.commentReplySendButton, { backgroundColor: c.inputBackground, borderColor: c.border, borderWidth: 1 }]}
                            onPress={() => onPickDraftCommentImage(activePost.id)}
                            activeOpacity={0.85}
                          >
                            <MaterialCommunityIcons name="image-outline" size={14} color={c.textSecondary} />
                            <Text style={[styles.commentSendText, { color: c.textSecondary }]}>
                              {t('home.photoAction', { defaultValue: 'Photo' })}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.commentReplySendButton, { backgroundColor: c.inputBackground, borderColor: c.border, borderWidth: 1 }]}
                            onPress={() => onSetDraftCommentGif(activePost.id)}
                            activeOpacity={0.85}
                          >
                            <MaterialCommunityIcons name="file-gif-box" size={14} color={c.textSecondary} />
                            <Text style={[styles.commentSendText, { color: c.textSecondary }]}>GIF</Text>
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity
                          style={[styles.commentSendButton, { backgroundColor: c.primary }]}
                          onPress={() => onSubmitComment(activePost.id)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.commentSendText}>{t('home.commentPostAction')}</Text>
                        </TouchableOpacity>
                      </View>
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
                {!isLongPost ? renderShortPostLinkPreview() : null}
                {renderSharedPostInset(activePost)}

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
                    {renderDraftMediaPreview(
                      draftCommentMediaByPostId[activePost.id],
                      () => onClearDraftCommentMedia(activePost.id)
                    )}
                    <MentionHashtagInput
                      style={[styles.commentInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                      value={draftComments[activePost.id] || ''}
                      onChangeText={(value) => onUpdateDraftComment(activePost.id, value)}
                      placeholder={t('home.commentPlaceholder')}
                      placeholderTextColor={c.placeholder}
                      token={token}
                      c={c}
                      multiline
                    />
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TouchableOpacity
                          style={[styles.commentReplySendButton, { backgroundColor: c.inputBackground, borderColor: c.border, borderWidth: 1 }]}
                          onPress={() => onPickDraftCommentImage(activePost.id)}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons name="image-outline" size={14} color={c.textSecondary} />
                          <Text style={[styles.commentSendText, { color: c.textSecondary }]}>
                            {t('home.photoAction', { defaultValue: 'Photo' })}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.commentReplySendButton, { backgroundColor: c.inputBackground, borderColor: c.border, borderWidth: 1 }]}
                          onPress={() => onSetDraftCommentGif(activePost.id)}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons name="file-gif-box" size={14} color={c.textSecondary} />
                          <Text style={[styles.commentSendText, { color: c.textSecondary }]}>GIF</Text>
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        style={[styles.commentSendButton, { backgroundColor: c.primary }]}
                        onPress={() => onSubmitComment(activePost.id)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.commentSendText}>{t('home.commentPostAction')}</Text>
                      </TouchableOpacity>
                    </View>
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
