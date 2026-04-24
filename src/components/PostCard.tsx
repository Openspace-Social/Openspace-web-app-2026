import React from 'react';
import { ActivityIndicator, Image, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FeedPost, PostComment, UserProfile } from '../api/client';
import UserHoverCard from './UserHoverCard';
import MentionHashtagInput from './MentionHashtagInput';
import { getSafeExternalVideoEmbedUrl } from '../utils/externalVideoEmbeds';
import { extractFirstUrlFromText, fetchShortPostLinkPreviewCached, getUrlHostLabel, ShortPostLinkPreview } from '../utils/shortPostEmbeds';

type PostCardVariant = 'feed' | 'profile';
type LongPostRenderBlock = {
  type: 'heading' | 'paragraph' | 'quote' | 'image' | 'embed' | 'table';
  position?: number;
  text?: string;
  url?: string;
  caption?: string;
  level?: number;
  objectPosition?: string;
  imageFit?: 'cover' | 'contain';
  imageScale?: number;
  align?: 'left' | 'center' | 'right';
  width?: number;
  tableHtml?: string;
};

type MediaPreviewItem = {
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
        type === 'heading' || type === 'quote' || type === 'image' || type === 'embed' || type === 'table'
          ? type
          : 'paragraph';
      return {
        type: nextType,
        position:
          typeof block.position === 'number' && Number.isFinite(block.position)
            ? block.position
            : undefined,
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
        align:
          block.align === 'center' || block.align === 'right' || block.align === 'left'
            ? (block.align as 'left' | 'center' | 'right')
            : undefined,
        width:
          typeof block.width === 'number' && Number.isFinite(block.width) && block.width > 0
            ? block.width
            : undefined,
        tableHtml: typeof block.tableHtml === 'string' ? block.tableHtml : undefined,
      };
    })
    .filter((block) => {
      if (block.type === 'image' || block.type === 'embed') return !!block.url;
      if (block.type === 'table') return !!block.tableHtml;
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

  // ── DOM-based path (web) ────────────────────────────────────────────────
  // The browser's own parser traverses nodes in document order, so images
  // placed in the middle of a Lexical post render at their authored position.
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const blocks: LongPostRenderBlock[] = [];

    function imgRenderBlock(img: Element): LongPostRenderBlock | null {
      const src = img.getAttribute('src') || '';
      if (!src || (!src.startsWith('http') && !src.startsWith('/'))) return null;
      const caption = img.getAttribute('alt') || '';
      const dataAlign = (img.getAttribute('data-align') || '').toLowerCase();
      const widthAttr = Number(img.getAttribute('width'));
      const styleWidth = (() => {
        const s = (img as HTMLElement).style;
        return s ? Number.parseInt(s.width || '', 10) : NaN;
      })();
      const width = Number.isFinite(widthAttr) && widthAttr > 0
        ? Math.max(120, Math.min(1200, widthAttr))
        : (Number.isFinite(styleWidth) && styleWidth > 0
          ? Math.max(120, Math.min(1200, styleWidth))
          : undefined);
      let align: 'left' | 'center' | 'right' = 'left';
      if (dataAlign === 'center' || dataAlign === 'right' || dataAlign === 'left') {
        align = dataAlign as 'left' | 'center' | 'right';
      } else {
        const s = (img as HTMLElement).style;
        if (s) {
          if (s.marginLeft === 'auto' && s.marginRight === 'auto') align = 'center';
          else if (s.marginLeft === 'auto') align = 'right';
          else if (s.cssFloat === 'right') align = 'right';
        }
      }
      const objectPosition = img.getAttribute('data-object-position') || undefined;
      const fitRaw = img.getAttribute('data-image-fit') || '';
      const imageFit: 'cover' | 'contain' | undefined =
        fitRaw === 'cover' ? 'cover' : fitRaw === 'contain' ? 'contain' : undefined;
      const scaleVal = Number(img.getAttribute('data-image-scale') || '');
      const imageScale = Number.isFinite(scaleVal) && scaleVal > 0 ? scaleVal : undefined;
      return { type: 'image', url: src, caption, align, width, objectPosition, imageFit, imageScale };
    }

    function processEl(el: Element) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) blocks.push({ type: 'heading', text, level: tag === 'h1' ? 1 : tag === 'h3' ? 3 : 2 });
        return;
      }
      if (tag === 'blockquote') {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) blocks.push({ type: 'quote', text });
        return;
      }
      if (tag === 'img') {
        const b = imgRenderBlock(el); if (b) blocks.push(b);
        return;
      }
      if (tag === 'iframe') {
        const src = el.getAttribute('src') || '';
        if (src) blocks.push({ type: 'embed', url: src });
        return;
      }
      if (tag === 'figure') {
        const isLinkEmbed = (el.getAttribute('data-os-link-embed') || '').toLowerCase() === 'true';
        if (isLinkEmbed) {
          const dataUrl = (el.getAttribute('data-url') || '').trim();
          const anchorUrl = (el.querySelector('a')?.getAttribute('href') || '').trim();
          const url = dataUrl || anchorUrl;
          if (url) blocks.push({ type: 'embed', url });
          return;
        }
        const iframe = el.querySelector('iframe');
        if (iframe) {
          const url = iframe.getAttribute('src') || '';
          if (url) blocks.push({ type: 'embed', url });
          return;
        }
        const img = el.querySelector('img');
        if (img) { const b = imgRenderBlock(img); if (b) blocks.push(b); }
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        el.querySelectorAll('li').forEach((li) => {
          const text = (li.textContent || '').replace(/\s+/g, ' ').trim();
          if (text) blocks.push({ type: 'paragraph', text });
        });
        return;
      }
      if (tag === 'table') {
        blocks.push({ type: 'table', tableHtml: el.outerHTML });
        return;
      }
      if (tag === 'p') {
        // Walk child nodes in order so inline <img> tags emit image blocks
        // at their authored position, and surrounding text becomes paragraphs.
        let textRun = '';
        Array.from(el.childNodes).forEach((child) => {
          if (child.nodeType === 3 /* TEXT_NODE */) {
            textRun += child.textContent || '';
          } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
            const childEl = child as Element;
            if (childEl.tagName.toLowerCase() === 'img') {
              const trimmed = textRun.replace(/\s+/g, ' ').trim();
              if (trimmed) { blocks.push({ type: 'paragraph', text: trimmed }); textRun = ''; }
              const b = imgRenderBlock(childEl); if (b) blocks.push(b);
            } else if (childEl.tagName.toLowerCase() === 'iframe') {
              const trimmed = textRun.replace(/\s+/g, ' ').trim();
              if (trimmed) { blocks.push({ type: 'paragraph', text: trimmed }); textRun = ''; }
              const url = childEl.getAttribute('src') || '';
              if (url) blocks.push({ type: 'embed', url });
            } else {
              textRun += childEl.textContent || '';
            }
          }
        });
        const trimmed = textRun.replace(/\s+/g, ' ').trim();
        if (trimmed) blocks.push({ type: 'paragraph', text: trimmed });
        return;
      }
      // Generic container — collect any inner images first, then fallback to text
      const innerImgs = Array.from(el.querySelectorAll('img'));
      if (innerImgs.length > 0) {
        innerImgs.forEach((img) => { const b = imgRenderBlock(img); if (b) blocks.push(b); });
        return;
      }
      const innerIframes = Array.from(el.querySelectorAll('iframe'));
      if (innerIframes.length > 0) {
        innerIframes.forEach((iframe) => {
          const url = iframe.getAttribute('src') || '';
          if (url) blocks.push({ type: 'embed', url });
        });
        return;
      }
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) blocks.push({ type: 'paragraph', text });
    }

    Array.from(doc.body.children).forEach(processEl);
    return blocks;
  }

  // ── Regex fallback (non-web environments) ───────────────────────────────
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
    } else if (tag === 'blockquote') {
      const text = decodeHtmlEntities(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
      if (text) blocks.push({ type: 'quote', text });
    } else if (tag === 'p') {
      const text = decodeHtmlEntities(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
      if (text) blocks.push({ type: 'paragraph', text });
    } else if (tag === 'img') {
      const src = raw.match(/\ssrc=(?:"([^"]+)"|'([^']+)')/i);
      const url = decodeHtmlEntities((src?.[1] || src?.[2] || '').trim());
      const alt = raw.match(/\salt=(?:"([^"]+)"|'([^']+)')/i);
      const caption = decodeHtmlEntities((alt?.[1] || alt?.[2] || '').trim());
      const dataAlign = (raw.match(/\sdata-align=(?:"([^"]+)"|'([^']+)')/i)?.[1] || '').trim().toLowerCase();
      const wRaw = (raw.match(/\swidth=(?:"([^"]+)"|'([^']+)'|([0-9.]+))/i)?.[1] || raw.match(/\swidth=(?:"([^"]+)"|'([^']+)'|([0-9.]+))/i)?.[3] || '').trim();
      const w = Number(wRaw); const width = Number.isFinite(w) && w > 0 ? Math.max(120, Math.min(1200, w)) : undefined;
      const align: 'left' | 'center' | 'right' = dataAlign === 'center' ? 'center' : dataAlign === 'right' ? 'right' : 'left';
      if (url) blocks.push({ type: 'image', url, caption, align, width });
    } else if (tag === 'iframe') {
      const src = raw.match(/\ssrc=(?:"([^"]+)"|'([^']+)')/i);
      const url = decodeHtmlEntities((src?.[1] || src?.[2] || '').trim());
      if (url) blocks.push({ type: 'embed', url });
    } else if (tag === 'figure') {
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
      const iframeUrl = decodeHtmlEntities((iframe?.[1] || iframe?.[2] || '').trim());
      if (iframeUrl) {
        blocks.push({ type: 'embed', url: iframeUrl });
        continue;
      }
      const img = inner.match(/<img\b[^>]*\ssrc=(?:"([^"]+)"|'([^']+)')[^>]*\/?>/i);
      const imgUrl = decodeHtmlEntities((img?.[1] || img?.[2] || '').trim());
      if (imgUrl) {
        blocks.push({ type: 'image', url: imgUrl, caption: '' });
      }
    }
  }
  return blocks;
}

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
  draftCommentMediaByPostId: Record<number, CommentDraftMedia | null>;
  draftReplyMediaByCommentId: Record<number, CommentDraftMedia | null>;
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
  onReactToPostWithEmoji?: (post: FeedPost, emojiId?: number) => void | Promise<void>;
  onToggleFollow: (username: string, currentlyFollowing: boolean) => void;
  onOpenPostDetail: (post: FeedPost, options?: { resumeTimeSec?: number }) => void;
  onToggleExpand: (postId: number) => void;
  onOpenReactionList: (post: FeedPost, emoji?: { id?: number; keyword?: string; image?: string }) => void | Promise<void>;
  onOpenReactionPicker: (post: FeedPost) => void;
  onToggleCommentBox: (postId: number) => void;
  onToggleCommentReplies: (postId: number, commentId: number) => void;
  onSharePost: (post: FeedPost) => void;
  onRepostPost: (post: FeedPost) => void;
  onOpenLink: (url?: string) => void;
  onPickDraftCommentImage: (postId: number) => void;
  onPickDraftReplyImage: (commentId: number) => void;
  onSetDraftCommentGif: (postId: number) => void;
  onSetDraftReplyGif: (commentId: number) => void;
  onClearDraftCommentMedia: (postId: number) => void;
  onClearDraftReplyMedia: (commentId: number) => void;
  onStartEditingComment: (commentId: number, currentText: string, isReply: boolean) => void;
  onCancelEditingComment: (commentId: number, isReply: boolean) => void;
  onSaveEditedComment: (postId: number, commentId: number, isReply: boolean, text: string, parentCommentId?: number) => void | Promise<void>;
  onDeleteComment: (postId: number, commentId: number, isReply: boolean, parentCommentId?: number) => void | Promise<void>;
  onSubmitComment: (postId: number, text: string) => void | Promise<void>;
  onSubmitReply: (postId: number, commentId: number, text: string) => void | Promise<void>;
  onOpenReportPostModal: (post: FeedPost) => void;
  onReportComment?: (postUuid: string, commentId: number) => void;
  onEditPost: (post: FeedPost, text: string) => void | Promise<void>;
  onOpenLongPostEdit?: (post: FeedPost) => void;
  onDeletePost: (post: FeedPost) => void | Promise<void>;
  onMovePostCommunities?: (post: FeedPost) => void;
  onTogglePinPost: (post: FeedPost) => void | Promise<void>;
  pinnedPostsCount?: number;
  pinnedPostsLimit?: number;
  pinnedDisplayIndex?: number | null;
  pinnedDisplayLimit?: number;
  onToggleCommunityPinPost?: (post: FeedPost) => void | Promise<void>;
  onToggleClosePost?: (post: FeedPost) => void | Promise<void>;
  onNavigateProfile: (username: string) => void;
  onNavigateHashtag?: (tag: string) => void;
  onNavigateCommunity: (communityName: string) => void;
  onFilterCommunityPostsByUser?: (username: string, communityName: string) => void;
  getPostText: (post: FeedPost) => string;
  getPostLengthType: (post: FeedPost) => 'long' | 'short';
  getPostReactionCount: (post: FeedPost) => number;
  getPostCommentsCount: (post: FeedPost) => number;
  autoPlayMedia?: boolean;
  isPostDetailOpen?: boolean;
  allowExpandControl?: boolean;
  token?: string;
  translationLanguageCode?: string;
  onFetchUserProfile?: (token: string, username: string) => Promise<UserProfile>;
};

function PostCard({
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
  draftCommentMediaByPostId,
  draftReplyMediaByCommentId,
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
  onReactToPostWithEmoji,
  onToggleFollow,
  onOpenPostDetail,
  onToggleExpand,
  onOpenReactionList,
  onOpenReactionPicker,
  onToggleCommentBox,
  onToggleCommentReplies,
  onSharePost,
  onRepostPost,
  onOpenLink,
  onPickDraftCommentImage,
  onPickDraftReplyImage,
  onSetDraftCommentGif,
  onSetDraftReplyGif,
  onClearDraftCommentMedia,
  onClearDraftReplyMedia,
  onStartEditingComment,
  onCancelEditingComment,
  onSaveEditedComment,
  onDeleteComment,
  onSubmitComment,
  onSubmitReply,
  onOpenReportPostModal,
  onReportComment,
  onEditPost,
  onOpenLongPostEdit,
  onDeletePost,
  onMovePostCommunities,
  onTogglePinPost,
  pinnedPostsCount = 0,
  pinnedPostsLimit = 5,
  pinnedDisplayIndex = null,
  pinnedDisplayLimit = 5,
  onToggleCommunityPinPost,
  onToggleClosePost,
  onNavigateProfile,
  onNavigateHashtag,
  onNavigateCommunity,
  onFilterCommunityPostsByUser,
  getPostText,
  getPostLengthType,
  getPostReactionCount,
  getPostCommentsCount,
  autoPlayMedia = false,
  isPostDetailOpen = false,
  allowExpandControl = true,
  token,
  translationLanguageCode,
  onFetchUserProfile,
}: PostCardProps) {
  const [commentReactionPickerForId, setCommentReactionPickerForId] = React.useState<number | null>(null);
  const [translatedText, setTranslatedText] = React.useState<string | null>(null);
  const [isTranslating, setIsTranslating] = React.useState(false);
  const [translationError, setTranslationError] = React.useState(false);
  const [postMenuOpen, setPostMenuOpen] = React.useState(false);
  const [postDeleteConfirmOpen, setPostDeleteConfirmOpen] = React.useState(false);
  const [postEditing, setPostEditing] = React.useState(false);
  const [postEditDraft, setPostEditDraft] = React.useState(getPostText(post));
  const [postEditLoading, setPostEditLoading] = React.useState(false);
  const [postPinLoading, setPostPinLoading] = React.useState(false);
  const [postCloseLoading, setPostCloseLoading] = React.useState(false);
  // Local draft state — isolated so typing never re-renders other feed posts
  const [localCommentDraft, setLocalCommentDraft] = React.useState('');
  const [localReplyDrafts, setLocalReplyDrafts] = React.useState<Record<number, string>>({});
  const [localCommentEditDrafts, setLocalCommentEditDrafts] = React.useState<Record<number, string>>({});
  const [localReplyEditDrafts, setLocalReplyEditDrafts] = React.useState<Record<number, string>>({});
  const [showSharedCommunities, setShowSharedCommunities] = React.useState(false);
  const [inlineVideoEnded, setInlineVideoEnded] = React.useState(false);
  const [inlineManualPlaybackStarted, setInlineManualPlaybackStarted] = React.useState(false);
  const [longEmbedPreviewByUrl, setLongEmbedPreviewByUrl] = React.useState<Record<string, ShortPostLinkPreview>>({});
  const commentReactionHostRefs = React.useRef<Record<number, any>>({});
  const postActionMenuHostRef = React.useRef<any>(null);
  const inlineVideoRef = React.useRef<any>(null);
  const inlineVideoContainerRef = React.useRef<any>(null);
  const creatorAvatar = post.creator?.avatar || post.creator?.profile?.avatar;
  const hasReacted = !!post.reaction?.id || !!post.reaction?.emoji?.id;
  const mediaPreviewItems = React.useMemo(() => {
    const items: MediaPreviewItem[] = [];
    const seen = new Set<string>();
    if (Array.isArray(post.media)) {
      post.media
        .slice()
        .sort((a, b) => (a?.order || 0) - (b?.order || 0))
        .forEach((item) => {
          const fileUri = item?.file || '';
          const thumbnailUri = item?.thumbnail || item?.image || '';
          const isVideo = looksLikeVideoType(item?.type) || looksLikeVideoUrl(fileUri);
          const previewUri = (isVideo ? thumbnailUri || post.media_thumbnail || fileUri : item?.image || thumbnailUri || fileUri) || '';
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
    if (!items.length && post.media_thumbnail) {
      items.push({ key: `thumb-${post.id}`, previewUri: post.media_thumbnail, isVideo: false });
    }
    return items;
  }, [post.media, post.media_thumbnail]);
  const galleryPreviewItems = mediaPreviewItems.slice(0, 5);
  const hasInlineMedia = galleryPreviewItems.length > 0;
  const postText = getPostText(post);
  const postType = (post.type || '').toUpperCase();
  const longPostBlocks = React.useMemo(() => {
    const parsedBlocks = parseLongPostBlocks(post.long_text_blocks);
    if (parsedBlocks.length > 0) {
      const withPosition = parsedBlocks.filter((block) => typeof block.position === 'number');
      if (withPosition.length > 0) {
        return parsedBlocks.slice().sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
      }
      return parsedBlocks;
    }
    const fromHtml = parseLongPostHtml(post.long_text_rendered_html || post.long_text);
    if (fromHtml.length > 0) return fromHtml;
    return [];
  }, [post.long_text, post.long_text_blocks, post.long_text_rendered_html]);
  React.useEffect(() => {
    if (postType !== 'LP' || longPostBlocks.length === 0) return;
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
      const nextEntries = await Promise.all(
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
        nextEntries.forEach(([url, preview]) => {
          next[url] = preview;
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [longPostBlocks, postType]);
  const sharedCommunityNames = Array.isArray(post.shared_community_names)
    ? post.shared_community_names.filter((name): name is string => typeof name === 'string' && !!name.trim())
    : [];
  const circleNames = Array.isArray(post.circles)
    ? post.circles
        .map((circle) => (typeof circle?.name === 'string' ? circle.name.trim() : ''))
        .filter((name): name is string => !!name)
    : [];
  const primaryCircleName = circleNames[0] || '';
  const extraCircleCount = Math.max(0, circleNames.length - 1);
  const extraCirclesLabel = extraCircleCount > 0
    ? t('home.postMultiCircleSuffix', {
        count: extraCircleCount,
        defaultValue: `+${extraCircleCount} ${extraCircleCount === 1 ? 'circle' : 'circles'}`,
      })
    : '';
  const primaryCommunityName = post.community?.name || sharedCommunityNames[0] || '';
  const communityAccentColor = post.community?.color || c.textLink || c.primary;
  const secondaryCommunityNames = sharedCommunityNames.filter((name) => name !== primaryCommunityName);
  const sharedCommunitiesCount = typeof post.shared_communities_count === 'number'
    ? post.shared_communities_count
    : (sharedCommunityNames.length > 0 ? sharedCommunityNames.length : (primaryCommunityName ? 1 : 0));
  const extraCommunitiesCount = Math.max(0, sharedCommunitiesCount - 1);
  const extraCommunitiesLabel = extraCommunitiesCount > 0
    ? t('home.postMultiCommunitySuffix', {
        count: extraCommunitiesCount,
        defaultValue: `+${extraCommunitiesCount} ${extraCommunitiesCount === 1 ? 'community' : 'communities'}`,
      })
    : '';
  const visibleLongPostBlocks = expandedPostIds[post.id] ? longPostBlocks : longPostBlocks.slice(0, 3);
  const hasHiddenLongBlocks = longPostBlocks.length > visibleLongPostBlocks.length;
  // LP posts that contain inline image blocks own those images — suppress the
  // detached media gallery so images stay in their authored body position.
  const hasLongPostInlineImages = postType === 'LP' && longPostBlocks.some((b) => b.type === 'image' && !!b.url);
  const hasLongPostTableBlocks = postType === 'LP' && longPostBlocks.some((b) => b.type === 'table' && !!b.tableHtml);
  const suppressStandaloneMediaForLongPost = hasLongPostInlineImages || hasLongPostTableBlocks;
  const shortPostLinkPreview = React.useMemo(() => {
    if (postType === 'LP') return null;
    const firstLink = Array.isArray(post.links) && post.links.length > 0 ? post.links[0] : null;
    const fromApiUrl = (firstLink?.url || '').trim();
    const fromTextUrl = extractFirstUrlFromText(post.text || '') || '';
    const url = fromApiUrl || fromTextUrl;
    if (!url) return null;
    const title = (firstLink?.title || '').trim() || getUrlHostLabel(url) || url;
    const description = ((firstLink as any)?.description || '').trim() || undefined;
    const imageUrl = (firstLink?.image || '').trim() || undefined;
    const siteName = ((firstLink as any)?.site_name || '').trim() || getUrlHostLabel(url);
    const embedUrl = getSafeExternalVideoEmbedUrl(url) || undefined;
    return { url, title, description, imageUrl, siteName, embedUrl, isVideo: !!embedUrl };
  }, [post.links, post.text, postType]);
  const [resolvedShortLinkPreview, setResolvedShortLinkPreview] = React.useState<{
    url: string;
    title: string;
    description?: string;
    imageUrl?: string;
    siteName?: string;
    embedUrl?: string;
    isVideo: boolean;
  } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    if (!shortPostLinkPreview || shortPostLinkPreview.isVideo) {
      setResolvedShortLinkPreview(shortPostLinkPreview as any);
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
      setResolvedShortLinkPreview(shortPostLinkPreview as any);
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
        if (!cancelled) setResolvedShortLinkPreview(shortPostLinkPreview as any);
      });
    return () => {
      cancelled = true;
    };
  }, [shortPostLinkPreview]);
  const showShortPostLinkPreview = postType !== 'LP' && !!shortPostLinkPreview && galleryPreviewItems.length === 0;
  // For the comment-button inline-box heuristic, treat LP posts with block
  // content the same as media posts (open comment box inline rather than
  // navigating to post detail).
  const effectiveHasInlineMedia = hasInlineMedia || (postType === 'LP' && longPostBlocks.length > 0);

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
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    const isInlineAutoplayVideo =
      autoPlayMedia &&
      galleryPreviewItems.length === 1 &&
      galleryPreviewItems[0]?.isVideo &&
      !!galleryPreviewItems[0]?.videoUri;
    if (!isInlineAutoplayVideo) return;

    const host = inlineVideoContainerRef.current as HTMLElement | null;
    const video = inlineVideoRef.current as HTMLVideoElement | null;
    if (!host || !video) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (isPostDetailOpen) {
          video.pause();
          return;
        }
        if (inlineVideoEnded) {
          video.pause();
          return;
        }
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          void video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      {
        threshold: [0, 0.25, 0.6, 1],
      }
    );

    observer.observe(host);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, [autoPlayMedia, galleryPreviewItems, inlineVideoEnded, isPostDetailOpen, post.id]);

  React.useEffect(() => {
    if (!isPostDetailOpen) return;
    const video = inlineVideoRef.current as HTMLVideoElement | null;
    if (video) {
      video.pause();
    }
    if (inlineManualPlaybackStarted) {
      setInlineManualPlaybackStarted(false);
    }
  }, [inlineManualPlaybackStarted, isPostDetailOpen]);

  React.useEffect(() => {
    setInlineVideoEnded(false);
    setInlineManualPlaybackStarted(false);
  }, [post.id]);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (autoPlayMedia) return;
    if (!inlineManualPlaybackStarted) return;
    const video = inlineVideoRef.current as HTMLVideoElement | null;
    if (!video) return;
    video.muted = false;
    void video.play().catch(() => {});
  }, [autoPlayMedia, inlineManualPlaybackStarted]);

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
    type Segment =
      | { text: string; isLink: false; isMention: false; isHashtag: false }
      | { text: string; isLink: true; url: string; isMention: false; isHashtag: false }
      | { text: string; isLink: false; isMention: true; username: string; isHashtag: false }
      | { text: string; isLink: false; isMention: false; isHashtag: true; tag: string };

    const segments: Segment[] = [];
    // Combined regex: URLs, @mentions, #hashtags
    const tokenRegex = /(https?:\/\/[^\s]+)|(@[A-Za-z0-9_]+)|(#[A-Za-z]\w*)/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while ((match = tokenRegex.exec(text)) !== null) {
      const start = match.index;

      if (start > lastIndex) {
        segments.push({ text: text.slice(lastIndex, start), isLink: false, isMention: false, isHashtag: false });
      }

      if (match[1]) {
        // URL
        const rawUrl = match[1];
        const trimmedUrl = rawUrl.replace(/[),.;!?]+$/g, '');
        const trailing = rawUrl.slice(trimmedUrl.length);
        segments.push({ text: trimmedUrl, isLink: true, url: trimmedUrl, isMention: false, isHashtag: false });
        if (trailing) {
          segments.push({ text: trailing, isLink: false, isMention: false, isHashtag: false });
        }
      } else if (match[2]) {
        // @mention
        const username = match[2].slice(1); // strip @
        segments.push({ text: match[2], isLink: false, isMention: true, username, isHashtag: false });
      } else if (match[3]) {
        // #hashtag
        const tag = match[3].slice(1); // strip #
        segments.push({ text: match[3], isLink: false, isMention: false, isHashtag: true, tag });
      }

      lastIndex = start + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex), isLink: false, isMention: false, isHashtag: false });
    }

    return segments.length ? segments : [{ text, isLink: false, isMention: false, isHashtag: false } as Segment];
  }

  const creatorUsername = post.creator?.username || '';
  const isPostOwner = !!currentUsername && creatorUsername === currentUsername;
  const canShowFollow =
    !!showFollowButton &&
    !!creatorUsername &&
    creatorUsername !== currentUsername &&
    !(followStateByUsername[creatorUsername] ?? !!post.creator?.is_following);

  React.useEffect(() => {
    setPostEditDraft(postText);
  }, [post.id, postText]);

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

  function handleDeletePost() {
    if (postEditLoading) return;
    setPostMenuOpen(false);
    setPostDeleteConfirmOpen(true);
  }

  async function confirmDeletePost() {
    setPostEditLoading(true);
    try {
      await onDeletePost(post);
      setPostDeleteConfirmOpen(false);
    } catch {
      // errors are surfaced by parent
    } finally {
      setPostEditLoading(false);
    }
  }

  function openPostEditMenuAction() {
    setPostMenuOpen(false);
    if (postType === 'LP' && onOpenLongPostEdit) {
      onOpenLongPostEdit(post);
    } else {
      setPostEditing(true);
    }
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

  async function handleToggleCommunityPinPost() {
    if (postPinLoading || !onToggleCommunityPinPost) return;
    setPostPinLoading(true);
    try {
      await onToggleCommunityPinPost(post);
      setPostMenuOpen(false);
    } catch {
      // errors are surfaced by parent
    } finally {
      setPostPinLoading(false);
    }
  }

  async function handleToggleClosePost() {
    if (postCloseLoading || !onToggleClosePost) return;
    setPostCloseLoading(true);
    try {
      await onToggleClosePost(post);
      setPostMenuOpen(false);
    } catch {
      // errors are surfaced by parent
    } finally {
      setPostCloseLoading(false);
    }
  }

  async function handleTranslate() {
    if (!token || !post.uuid || isTranslating) return;
    setIsTranslating(true);
    setTranslationError(false);
    try {
      const { api } = await import('../api/client');
      const result = await api.translatePost(token, post.uuid);
      setTranslatedText(result.translated_text);
    } catch {
      setTranslationError(true);
    } finally {
      setIsTranslating(false);
    }
  }

  function handleShowOriginal() {
    setTranslatedText(null);
    setTranslationError(false);
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
  function openPostDetailWithPause() {
    const video = inlineVideoRef.current as HTMLVideoElement | null;
    const resumeTimeSec =
      video && Number.isFinite(video.currentTime) && video.currentTime > 0
        ? Number(video.currentTime)
        : undefined;
    if (video) {
      video.pause();
    }
    setInlineManualPlaybackStarted(false);
    onOpenPostDetail(post, { resumeTimeSec });
  }

  function replayInlineVideo() {
    const video = inlineVideoRef.current as HTMLVideoElement | null;
    if (!video) return;
    try {
      video.currentTime = 0;
    } catch {
      // Ignore browser edge-case errors on seek.
    }
    setInlineVideoEnded(false);
    void video.play().catch(() => {});
  }

  function startInlineVideoPlayback() {
    setInlineVideoEnded(false);
    setInlineManualPlaybackStarted(true);
    const video = inlineVideoRef.current as HTMLVideoElement | null;
    if (!video) return;
    try {
      video.currentTime = 0;
    } catch {
      // Ignore browser edge-case errors on seek.
    }
    video.muted = false;
    void video.play().catch(() => {});
  }

  function handleSingleMediaPress() {
    const single = galleryPreviewItems[0];
    const canInlineVideo =
      !!single?.isVideo &&
      Platform.OS === 'web' &&
      !!single?.videoUri &&
      !autoPlayMedia;
    if (canInlineVideo && !inlineManualPlaybackStarted) {
      startInlineVideoPlayback();
      return;
    }
    openPostDetailWithPause();
  }
  type PostMenuAction = {
    key: string;
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    label: string;
    disabled: boolean;
    onPress: () => void;
  };
  const canFilterByPosterInCommunity =
    typeof onFilterCommunityPostsByUser === 'function' &&
    typeof creatorUsername === 'string' &&
    creatorUsername.trim().length > 0 &&
    typeof post.community?.name === 'string' &&
    post.community.name.trim().length > 0;

  const filterByPosterAction: PostMenuAction | null = canFilterByPosterInCommunity
    ? {
        key: 'view-user-community-posts',
        icon: 'account-search-outline' as const,
        label: t('home.viewCommunityPostsByUserAction', {
          username: creatorUsername,
          community: post.community?.name,
          defaultValue: `View all posts in c/${post.community?.name} by @${creatorUsername}`,
        }),
        disabled: false,
        onPress: () => {
          setPostMenuOpen(false);
          onFilterCommunityPostsByUser?.(creatorUsername, post.community?.name || '');
        },
      }
    : null;

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
        ...(onMovePostCommunities ? [{
          key: 'move-communities',
          icon: 'arrow-right-bold-box-outline' as const,
          label: t('home.movePostCommunitiesAction', { defaultValue: 'Change communities' }),
          disabled: false,
          onPress: () => { setPostMenuOpen(false); onMovePostCommunities(post); },
        }] : []),
        ...(onToggleClosePost ? [{
          key: 'close-post',
          icon: (post.is_closed ? 'lock-open-outline' : 'lock-outline') as const,
          label: postCloseLoading
            ? '...'
            : (post.is_closed
              ? t('home.openPostAction', { defaultValue: 'Unlock post' })
              : t('home.closePostAction', { defaultValue: 'Lock post' })),
          disabled: postCloseLoading,
          onPress: () => void handleToggleClosePost(),
        }] : []),
        ...(filterByPosterAction ? [filterByPosterAction] : []),
      ]
    : [
        {
          key: 'report',
          icon: 'alert-circle-outline' as const,
          label: t('home.reportPostAction'),
          disabled: false,
          onPress: openPostReportMenuAction,
        },
        ...(onToggleCommunityPinPost ? [{
          key: 'community-pin',
          icon: (post.is_community_pinned ? 'pin-off-outline' : 'pin-outline') as const,
          label: postPinLoading
            ? '...'
            : (post.is_community_pinned
              ? t('home.communityUnpinAction', { defaultValue: 'Unpin from community' })
              : t('home.communityPinAction', { defaultValue: 'Pin to community' })),
          disabled: postPinLoading,
          onPress: () => void handleToggleCommunityPinPost(),
        }] : []),
        ...(onToggleClosePost ? [{
          key: 'close-post',
          icon: (post.is_closed ? 'lock-open-outline' : 'lock-outline') as const,
          label: postCloseLoading
            ? '...'
            : (post.is_closed
              ? t('home.openPostAction', { defaultValue: 'Unlock post' })
              : t('home.closePostAction', { defaultValue: 'Lock post' })),
          disabled: postCloseLoading,
          onPress: () => void handleToggleClosePost(),
        }] : []),
        ...(filterByPosterAction ? [filterByPosterAction] : []),
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
          <UserHoverCard
            username={creatorUsername}
            token={token || ''}
            c={c}
            isFollowing={!!(creatorUsername && followStateByUsername[creatorUsername])}
            followLoading={!!(creatorUsername && followActionLoadingByUsername[creatorUsername])}
            onToggleFollow={onToggleFollow}
            onOpenProfile={onNavigateProfile}
            fetchProfile={onFetchUserProfile || (() => Promise.reject())}
          >
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => creatorUsername && onNavigateProfile(creatorUsername)}
            >
              <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}>
                {creatorAvatar ? (
                  <Image source={{ uri: creatorAvatar }} style={styles.feedAvatarImage} resizeMode="cover" />
                ) : (
                  <Text style={styles.feedAvatarLetter}>{(creatorUsername?.[0] || 'O').toUpperCase()}</Text>
                )}
              </View>
            </TouchableOpacity>
          </UserHoverCard>
          <View style={styles.feedHeaderMeta}>
            {primaryCommunityName ? (
              <View style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => onNavigateCommunity(primaryCommunityName)}
                  >
                    <Text style={[styles.feedCommunityHeaderLink, { color: communityAccentColor }]}>
                      {`c/${primaryCommunityName}`}
                    </Text>
                  </TouchableOpacity>

                  {extraCommunitiesLabel ? (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => setShowSharedCommunities((prev) => !prev)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    >
                      <Text style={[styles.feedCommunityHeaderLink, { color: c.textSecondary }]}>
                        {extraCommunitiesLabel}
                      </Text>
                      <MaterialCommunityIcons
                        name={showSharedCommunities ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={c.textSecondary}
                      />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {showSharedCommunities && secondaryCommunityNames.length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {secondaryCommunityNames.map((communityName) => (
                      <TouchableOpacity
                        key={`shared-community-${post.id}-${communityName}`}
                        activeOpacity={0.8}
                        onPress={() => onNavigateCommunity(communityName)}
                      >
                        <Text style={[styles.feedCommunityHeaderLink, { color: c.textSecondary }]}>
                          {`c/${communityName}`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
            {primaryCircleName ? (
              <View style={{ marginTop: primaryCommunityName ? 4 : 0, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <MaterialCommunityIcons name="account-group-outline" size={14} color={c.textSecondary} />
                <Text style={[styles.feedDate, { color: c.textSecondary, fontWeight: '700' }]}>
                  {t('home.postCircleLabel', {
                    name: primaryCircleName,
                    defaultValue: `Circle: ${primaryCircleName}`,
                  })}
                </Text>
                {extraCirclesLabel ? (
                  <Text style={[styles.feedDate, { color: c.textMuted }]}>{extraCirclesLabel}</Text>
                ) : null}
              </View>
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
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
        {post.is_community_pinned ? (
          <View style={[styles.postPinnedBadge, { borderColor: c.border, backgroundColor: c.surface }]}>
            <MaterialCommunityIcons name="pin" size={12} color={c.primary} />
            <Text style={[styles.postPinnedBadgeText, { color: c.primary }]}>
              {t('home.communityPinnedBadge', { defaultValue: 'Pinned' })}
            </Text>
          </View>
        ) : null}
        {post.is_closed ? (
          <View style={[styles.postPinnedBadge, { borderColor: c.border, backgroundColor: c.surface }]}>
            <MaterialCommunityIcons name="lock" size={12} color={c.textMuted} />
            <Text style={[styles.postPinnedBadgeText, { color: c.textMuted }]}>
              {t('home.postLockedBadge', { defaultValue: 'Locked' })}
            </Text>
          </View>
        ) : null}
      </View>

      {postType === 'LP' && longPostBlocks.length > 0 ? (
        <View style={styles.feedTextWrap}>
          <View style={styles.longPostBlockList}>
            {visibleLongPostBlocks.map((block, idx) => {
              if (block.type === 'heading') {
                return (
                  <Text
                    key={`${post.id}-lp-heading-${idx}`}
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
                    key={`${post.id}-lp-quote-${idx}`}
                    style={[styles.longPostQuoteWrap, { borderLeftColor: c.primary, backgroundColor: c.surface }]}
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
                const align = block.align === 'center' || block.align === 'right' ? block.align : 'left';
                const widthPx = typeof block.width === 'number' && Number.isFinite(block.width)
                  ? Math.max(120, Math.min(1200, block.width))
                  : undefined;
                return (
                  <View
                    key={`${post.id}-lp-image-${idx}`}
                    style={[
                      styles.longPostImageWrap,
                      {
                        alignSelf: align === 'center' ? 'center' : (align === 'right' ? 'flex-end' : 'flex-start'),
                        width: widthPx ? Math.min(widthPx, 640) : undefined,
                        maxWidth: '100%',
                      },
                    ]}
                  >
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
                    <View
                      key={`${post.id}-lp-embed-${idx}`}
                      style={{ width: '100%', marginVertical: 8 } as any}
                    >
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
                      key={`${post.id}-lp-embed-${idx}`}
                      style={[styles.shortPostLinkPreviewCard, { borderColor: c.border, backgroundColor: c.surface }]}
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
                    key={`${post.id}-lp-embed-${idx}`}
                    activeOpacity={0.85}
                    onPress={() => onOpenLink(block.url)}
                    style={[styles.longPostEmbedChip, { borderColor: c.border, backgroundColor: c.surface }]}
                  >
                    <MaterialCommunityIcons name="open-in-new" size={14} color={c.textLink} />
                    <Text numberOfLines={1} style={[styles.longPostEmbedText, { color: c.textLink }]}>
                      {block.url}
                    </Text>
                  </TouchableOpacity>
                );
              }
              if (block.type === 'table' && (block as any).tableHtml && Platform.OS === 'web') {
                const rawTableHtml = (block as any).tableHtml as string;
                const tableStyle = `
                  <style>
                    .lp-table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 14px; border: 0 !important; }
                    .lp-table.oslx-table-bordered { border: 0 !important; }
                    .lp-table tr { border: 0 !important; }
                    .lp-table td, .lp-table th {
                      padding: 7px 10px;
                      vertical-align: top;
                      word-break: break-word;
                      min-width: 50px;
                      border: 1px solid transparent !important;
                    }
                    .lp-table td { color: ${c.textSecondary}; }
                    .lp-table th { background: ${c.inputBackground}; color: ${c.textPrimary}; font-weight: 700; }
                  </style>
                `;
                const tableHtmlWithClass = rawTableHtml
                  .replace(/\sborder=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                  .replace(/\scellpadding=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                  .replace(/\scellspacing=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                  .replace('<table', '<table class="lp-table"');
                const divProps: any = {
                  dangerouslySetInnerHTML: { __html: tableStyle + tableHtmlWithClass },
                  style: { width: '100%', overflowX: 'auto' },
                };
                return (
                  <View
                    key={`${post.id}-lp-table-${idx}`}
                    style={{ width: '100%', marginVertical: 8 } as any}
                  >
                    {React.createElement('div', divProps)}
                  </View>
                );
              }

              return (
                <Text key={`${post.id}-lp-paragraph-${idx}`} style={[styles.feedText, styles.longPostParagraph, { color: c.textSecondary }]}>
                  {extractTextSegmentsWithLinks(block.text || '').map((seg, segIdx) => {
                    if (seg.isLink) return (
                      <Text key={segIdx} onPress={() => onOpenLink(seg.url)} style={{ color: c.textLink, textDecorationLine: 'underline' } as any}>{seg.text}</Text>
                    );
                    if (seg.isMention) return (
                      <Text key={segIdx} onPress={() => onNavigateProfile(seg.username)} style={{ color: c.primary ?? c.textLink, fontWeight: '700' }}>{seg.text}</Text>
                    );
                    if (seg.isHashtag) return (
                      <Text key={segIdx} onPress={onNavigateHashtag ? () => onNavigateHashtag!(seg.tag) : undefined} style={onNavigateHashtag ? { color: c.primary ?? c.textLink, fontWeight: '700' } : undefined}>{seg.text}</Text>
                    );
                    return <Text key={segIdx}>{seg.text}</Text>;
                  })}
                </Text>
              );
            })}
          </View>
          {allowExpandControl && hasHiddenLongBlocks ? (
            <TouchableOpacity onPress={() => onToggleExpand(post.id)} activeOpacity={0.85}>
              <Text style={[styles.seeMoreText, { color: c.textLink }]}>
                {expandedPostIds[post.id] ? t('home.seeLess') : t('home.seeMore')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : postText ? (
        <View style={styles.feedTextWrap}>
          <Text style={[styles.feedText, { color: c.textSecondary }]}> 
            {extractTextSegmentsWithLinks(
              expandedPostIds[post.id]
                ? postText
                : `${postText.slice(0, 240)}${postText.length > 240 ? '...' : ''}`
            ).map((segment, idx) => {
              if (segment.isLink) {
                return (
                  <Text
                    key={`${variant}-${post.id}-text-segment-${idx}`}
                    onPress={() => onOpenLink(segment.url)}
                    style={{ color: c.textLink, textDecorationLine: 'underline' } as any}
                  >
                    {segment.text}
                  </Text>
                );
              }
              if (segment.isMention) {
                return (
                  <Text
                    key={`${variant}-${post.id}-text-segment-${idx}`}
                    onPress={() => onNavigateProfile(segment.username)}
                    style={{ color: c.primary ?? c.textLink, fontWeight: '700' }}
                  >
                    {segment.text}
                  </Text>
                );
              }
              if (segment.isHashtag) {
                return (
                  <Text
                    key={`${variant}-${post.id}-text-segment-${idx}`}
                    onPress={onNavigateHashtag ? () => onNavigateHashtag!(segment.tag) : undefined}
                    style={onNavigateHashtag ? { color: c.primary ?? c.textLink, fontWeight: '700' } : undefined}
                  >
                    {segment.text}
                  </Text>
                );
              }
              return (
                <Text key={`${variant}-${post.id}-text-segment-${idx}`}>
                  {segment.text}
                </Text>
              );
            })}
          </Text>
          {allowExpandControl && postText.length > 240 ? (
            <TouchableOpacity onPress={() => onToggleExpand(post.id)} activeOpacity={0.85}>
              <Text style={[styles.seeMoreText, { color: c.textLink }]}>
                {expandedPostIds[post.id] ? t('home.seeLess') : t('home.seeMore')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Translation — shown when post language differs from the user's translation language */}
      {(() => {
        const postLang = post.language?.code;
        const hasText = !!(post.text || post.long_text);
        const canTranslate = hasText && !!token && !!translationLanguageCode &&
          !!postLang && postLang !== translationLanguageCode;
        if (!canTranslate && !translatedText) return null;
        return (
          <View style={[styles.feedTextWrap, { marginTop: 4 }]}>
            {translatedText ? (
              <>
                <Text style={[styles.feedText, { color: c.textSecondary, fontStyle: 'italic' }]}>
                  {translatedText}
                </Text>
                <TouchableOpacity onPress={handleShowOriginal} activeOpacity={0.85} style={{ marginTop: 4 }}>
                  <Text style={[styles.seeMoreText, { color: c.textLink }]}>
                    {t('home.showOriginal', { defaultValue: 'Show original' })}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                onPress={() => void handleTranslate()}
                activeOpacity={0.85}
                disabled={isTranslating}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                {isTranslating ? (
                  <ActivityIndicator size="small" color={c.textLink} />
                ) : translationError ? (
                  <Text style={[styles.seeMoreText, { color: (c as any).errorText ?? c.textMuted }]}>
                    {t('home.translationError', { defaultValue: 'Translation failed — tap to retry' })}
                  </Text>
                ) : (
                  <Text style={[styles.seeMoreText, { color: c.textLink }]}>
                    {t('home.seeTranslation', { defaultValue: 'See translation' })}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        );
      })()}

      {showShortPostLinkPreview && resolvedShortLinkPreview ? (
        <View style={styles.feedTextWrap}>
          {Platform.OS === 'web' && resolvedShortLinkPreview.isVideo && resolvedShortLinkPreview.embedUrl ? (
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
          ) : (
            <TouchableOpacity
              style={[styles.shortPostLinkPreviewCard, { borderColor: c.border, backgroundColor: c.surface }]}
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
          )}
        </View>
      ) : null}

      {!suppressStandaloneMediaForLongPost && galleryPreviewItems.length > 1 ? (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={openPostDetailWithPause}
          accessibilityLabel={t('home.openPostDetailAction')}
          style={styles.feedMediaGrid}
        >
          {galleryPreviewItems.slice(0, 4).map((mediaItem, idx) => {
            const hiddenCount = galleryPreviewItems.length - 4;
            const showOverlay = idx === 3 && hiddenCount > 0;
            return (
              <View key={`post-media-grid-${post.id}-${mediaItem.key}`} style={styles.feedMediaGridItem}>
                <Image
                  source={{ uri: mediaItem.previewUri }}
                  style={[styles.feedMediaGridImage, { backgroundColor: c.surface }]}
                  resizeMode="cover"
                />
                {mediaItem.isVideo ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: [{ translateX: -22 }, { translateY: -22 }],
                      backgroundColor: 'rgba(0,0,0,0.65)',
                      borderRadius: 999,
                      width: 44,
                      height: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons name="play" size={24} color="#fff" />
                  </View>
                ) : null}
                {showOverlay ? (
                  <View style={styles.feedMediaGridMoreOverlay}>
                    <Text style={styles.feedMediaGridMoreText}>+{hiddenCount}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </TouchableOpacity>
      ) : !suppressStandaloneMediaForLongPost && galleryPreviewItems.length === 1 ? (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={handleSingleMediaPress}
          accessibilityLabel={t('home.openPostDetailAction')}
        >
          <View>
            {galleryPreviewItems[0].isVideo &&
            Platform.OS === 'web' &&
            galleryPreviewItems[0].videoUri &&
            (autoPlayMedia || inlineManualPlaybackStarted) ? (
              <View
                ref={(node) => {
                  inlineVideoContainerRef.current = node;
                }}
                style={[styles.feedMedia, { backgroundColor: '#000', overflow: 'hidden' }]}
              >
                {React.createElement('video', {
                  key: `${post.id}-video-preview`,
                  src: galleryPreviewItems[0].videoUri,
                  poster: galleryPreviewItems[0].previewUri,
                  ref: (node: HTMLVideoElement | null) => {
                    inlineVideoRef.current = node;
                  },
                  style: { width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' },
                  playsInline: true,
                  controls: true,
                  autoPlay: autoPlayMedia || inlineManualPlaybackStarted,
                  defaultMuted: autoPlayMedia,
                  loop: false,
                  preload: 'metadata',
                  onEnded: () => {
                    setInlineVideoEnded(true);
                    if (!autoPlayMedia) {
                      setInlineManualPlaybackStarted(false);
                    }
                  },
                  onPlay: () => {
                    setInlineVideoEnded(false);
                  },
                })}
              </View>
            ) : (
              <Image source={{ uri: galleryPreviewItems[0].previewUri }} style={[styles.feedMedia, { backgroundColor: c.surface }]} resizeMode="contain" />
            )}
            {galleryPreviewItems[0].isVideo &&
            Platform.OS === 'web' &&
            galleryPreviewItems[0].videoUri &&
            inlineManualPlaybackStarted &&
            !autoPlayMedia ? (
              <View style={{ position: 'absolute', top: 10, right: 10 }}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={(event: any) => {
                    event?.stopPropagation?.();
                    openPostDetailWithPause();
                  }}
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.68)',
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <MaterialCommunityIcons name="open-in-new" size={14} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                    {t('home.openAction', { defaultValue: 'Open' })}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {galleryPreviewItems[0].isVideo && Platform.OS === 'web' && autoPlayMedia && inlineVideoEnded ? (
              <View
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: [{ translateX: -42 }, { translateY: -20 }],
                }}
              >
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={replayInlineVideo}
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.72)',
                    borderRadius: 999,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <MaterialCommunityIcons name="replay" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                    {t('home.replayAction', { defaultValue: 'Replay' })}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {galleryPreviewItems[0].isVideo &&
            !(Platform.OS === 'web' && galleryPreviewItems[0].videoUri && (autoPlayMedia || inlineManualPlaybackStarted)) ? (
              <View
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: [{ translateX: -28 }, { translateY: -28 }],
                  backgroundColor: 'rgba(0,0,0,0.65)',
                  borderRadius: 999,
                  width: 56,
                  height: 56,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialCommunityIcons name="play" size={30} color="#fff" />
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      ) : null}

      {/* ── Shared (reposted) post inset ─────────────────────────────────── */}
      {post.shared_post ? (() => {
        const sp = post.shared_post;
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
            onPress={() => onOpenPostDetail(sp as FeedPost)}
            style={{
              marginHorizontal: 12,
              marginBottom: 10,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 12,
              backgroundColor: c.inputBackground,
              overflow: 'hidden',
            }}
          >
            {/* community tag */}
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
            {/* creator row */}
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
            {/* text */}
            {spText ? (
              <Text
                style={{ paddingHorizontal: 12, paddingBottom: 8, fontSize: 14, lineHeight: 20, color: c.textPrimary }}
                numberOfLines={4}
              >
                {spText}
              </Text>
            ) : null}
            {/* first image preview */}
            {spFirstImage ? (
              <Image
                source={{ uri: spFirstImage }}
                style={{ width: '100%', height: 160 }}
                resizeMode="cover"
              />
            ) : null}
            {/* bottom padding if no image */}
            {!spFirstImage && !spText ? (
              <View style={{ height: 8 }} />
            ) : null}
          </TouchableOpacity>
        );
      })() : null}

      <View style={[styles.feedStatsRow, { borderTopColor: c.border, borderBottomColor: c.border }]}>
        <Text style={[styles.feedStatText, { color: c.textMuted }]}>{t('home.feedReactionsCount', { count: getPostReactionCount(post) })}</Text>
        <Text style={[styles.feedStatText, { color: c.textMuted }]}>{t('home.feedCommentsCount', { count: getPostCommentsCount(post) })}</Text>
      </View>

      {(post.reactions_emoji_counts || []).length > 0 ? (
        <View style={styles.reactionSummaryWrap}>
          {(post.reactions_emoji_counts || [])
            .filter((entry) => (entry?.count || 0) > 0)
            .map((entry, idx) => {
              const isMyReaction = !!entry.emoji?.id && post.reaction?.emoji?.id === entry.emoji.id;
              return (
                <TouchableOpacity
                  key={`${variant}-${post.id}-reaction-summary-${entry.emoji?.id || idx}`}
                  style={[
                    styles.reactionSummaryChip,
                    isMyReaction
                      ? { borderColor: c.primary, backgroundColor: c.surface }
                      : { borderColor: c.border, backgroundColor: c.surface },
                  ]}
                  onPress={() => onReactToPostWithEmoji ? void onReactToPostWithEmoji(post, entry.emoji?.id) : onOpenReactionList(post)}
                  disabled={reactionActionLoading}
                  activeOpacity={0.75}
                >
                  {entry.emoji?.image ? (
                    <Image source={{ uri: entry.emoji.image }} style={styles.reactionSummaryEmojiImage} resizeMode="contain" />
                  ) : (
                    <MaterialCommunityIcons name="emoticon-outline" size={14} color={isMyReaction ? c.primary : c.textSecondary} />
                  )}
                  <Text style={[styles.reactionSummaryCount, { color: isMyReaction ? c.primary : c.textSecondary }]}>
                    {entry.count || 0}
                  </Text>
                </TouchableOpacity>
              );
            })}
          <TouchableOpacity
            style={[styles.reactionSummaryChip, { borderColor: c.border, backgroundColor: c.surface }]}
            onPress={() => onOpenReactionList(post)}
            activeOpacity={0.75}
          >
            <MaterialCommunityIcons name="account-multiple-outline" size={14} color={c.textMuted} />
          </TouchableOpacity>
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
          onPress={() => {
            if (hasReacted && onReactToPostWithEmoji && post.reaction?.emoji?.id) {
              void onReactToPostWithEmoji(post, post.reaction.emoji.id);
            } else {
              onOpenReactionPicker(post);
            }
          }}
          disabled={reactionActionLoading}
          activeOpacity={0.85}
          accessibilityLabel={t('home.reactAction')}
        >
          <MaterialCommunityIcons
            name={hasReacted ? 'emoticon' : 'emoticon-outline'}
            size={22}
            color={hasReacted ? c.primary : c.textSecondary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          onPress={() => {
            if (effectiveHasInlineMedia) {
              onToggleCommentBox(post.id);
            } else {
              onOpenPostDetail(post);
            }
          }}
          activeOpacity={0.85}
          accessibilityLabel={t('home.commentAction')}
        >
          <MaterialCommunityIcons name="comment-outline" size={22} color={c.textSecondary} />
        </TouchableOpacity>

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
          accessibilityLabel={t('home.repostAction', { defaultValue: 'Repost' })}
        >
          <MaterialCommunityIcons
            name="repeat-variant"
            size={22}
            color={post.user_has_reposted ? c.primary : c.textSecondary}
          />
          {post.reposts_count && post.reposts_count > 0 ? (
            <Text style={[styles.feedActionText, { color: post.user_has_reposted ? c.primary : c.textSecondary }]}>
              {post.reposts_count}
            </Text>
          ) : null}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          onPress={() => onSharePost(post)}
          activeOpacity={0.85}
          accessibilityLabel={t('home.shareAction')}
        >
          <MaterialCommunityIcons name="share-variant-outline" size={22} color={c.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground, paddingHorizontal: 10 }]}
          onPress={() => onOpenPostDetail(post)}
          activeOpacity={0.85}
          accessibilityLabel={t('home.expandPostAction', { defaultValue: 'Expand post' })}
        >
          <MaterialCommunityIcons name="arrow-expand" size={22} color={c.textMuted} />
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
                      <MentionHashtagInput
                        style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                        value={localCommentEditDrafts[comment.id] ?? (comment.text || '')}
                        onChangeText={(value) => setLocalCommentEditDrafts((prev) => ({ ...prev, [comment.id]: value }))}
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
                          onPress={() => {
                            void onSaveEditedComment(post.id, comment.id, false, localCommentEditDrafts[comment.id] ?? (comment.text || ''));
                            setLocalCommentEditDrafts((prev) => { const n = { ...prev }; delete n[comment.id]; return n; });
                          }}
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
                      <Text style={[styles.detailCommentText, { color: c.textSecondary }]}>
                        {extractTextSegmentsWithLinks(comment.text || '').map((seg, idx) => {
                          if (seg.isLink) return <Text key={idx} onPress={() => onOpenLink(seg.url)} style={{ color: c.textLink, textDecorationLine: 'underline' } as any}>{seg.text}</Text>;
                          if (seg.isMention) return <Text key={idx} onPress={() => onNavigateProfile(seg.username)} style={{ color: c.primary ?? c.textLink, fontWeight: '700' }}>{seg.text}</Text>;
                          if (seg.isHashtag) return <Text key={idx} onPress={onNavigateHashtag ? () => onNavigateHashtag!(seg.tag) : undefined} style={{ color: c.primary ?? c.textLink, fontWeight: '700' }}>{seg.text}</Text>;
                          return <Text key={idx}>{seg.text}</Text>;
                        })}
                      </Text>
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
                                key={`comment-reaction-${comment.id}-${entry.emoji?.id || idx}`}
                                style={[
                                  styles.commentReactionChip,
                                  { borderColor: isMyReaction ? c.primary : c.border, backgroundColor: isMyReaction ? c.surface : c.inputBackground },
                                ]}
                                activeOpacity={0.75}
                                disabled={reactionActionLoading}
                                onPress={() => { void onReactToComment(post.id, comment.id, entry.emoji?.id); }}
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
                                    onPress={() => {
                                      void onReactToComment(post.id, comment.id, emoji.id);
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
                ) : (!isOwnComment && !!token && !!onReportComment && !!post.uuid) ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => onReportComment(post.uuid!, comment.id)}
                  >
                    <Text style={[styles.detailCommentMetaAction, { color: c.textMuted }]}>
                      {t('home.reportCommentAction', { defaultValue: 'Report' })}
                    </Text>
                  </TouchableOpacity>
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
                              <MentionHashtagInput
                                style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.surface, color: c.textPrimary }]}
                                value={localReplyEditDrafts[reply.id] ?? (reply.text || '')}
                                onChangeText={(value) => setLocalReplyEditDrafts((prev) => ({ ...prev, [reply.id]: value }))}
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
                                  onPress={() => {
                                    void onSaveEditedComment(post.id, reply.id, true, localReplyEditDrafts[reply.id] ?? (reply.text || ''), comment.id);
                                    setLocalReplyEditDrafts((prev) => { const n = { ...prev }; delete n[reply.id]; return n; });
                                  }}
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
                              <Text style={[styles.detailCommentText, { color: c.textSecondary }]}>
                                {extractTextSegmentsWithLinks(reply.text || '').map((seg, idx) => {
                                  if (seg.isLink) return <Text key={idx} onPress={() => onOpenLink(seg.url)} style={{ color: c.textLink, textDecorationLine: 'underline' } as any}>{seg.text}</Text>;
                                  if (seg.isMention) return <Text key={idx} onPress={() => onNavigateProfile(seg.username)} style={{ color: c.primary ?? c.textLink, fontWeight: '700' }}>{seg.text}</Text>;
                                  if (seg.isHashtag) return <Text key={idx} onPress={onNavigateHashtag ? () => onNavigateHashtag!(seg.tag) : undefined} style={{ color: c.primary ?? c.textLink, fontWeight: '700' }}>{seg.text}</Text>;
                                  return <Text key={idx}>{seg.text}</Text>;
                                })}
                              </Text>
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
                            onPress={() => onDeleteComment(post.id, reply.id, true, comment.id)}
                          >
                            <Text style={[styles.detailCommentMetaAction, { color: c.textLink }]}>
                              {commentMutationLoadingById[reply.id] ? '...' : t('home.deleteAction')}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : (!isOwnReply && !!token && !!onReportComment && !!post.uuid) ? (
                        <View style={[styles.detailCommentMetaRow, { marginTop: 4, marginLeft: 44 }]}>
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => onReportComment(post.uuid!, reply.id)}
                          >
                            <Text style={[styles.detailCommentMetaAction, { color: c.textMuted }]}>
                              {t('home.reportCommentAction', { defaultValue: 'Report' })}
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
                      style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.surface, color: c.textPrimary }]}
                      value={localReplyDrafts[comment.id] || ''}
                      onChangeText={(value) => setLocalReplyDrafts((prev) => ({ ...prev, [comment.id]: value }))}
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
                        onPress={() => {
                          void onSubmitReply(post.id, comment.id, localReplyDrafts[comment.id] || '');
                          setLocalReplyDrafts((prev) => ({ ...prev, [comment.id]: '' }));
                        }}
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
          })}

          <View style={styles.commentComposer}>
            {renderDraftMediaPreview(
              draftCommentMediaByPostId[post.id],
              () => onClearDraftCommentMedia(post.id)
            )}
            <MentionHashtagInput
              style={[styles.commentInput, { borderColor: c.inputBorder, backgroundColor: c.surface, color: c.textPrimary }]}
              value={localCommentDraft}
              onChangeText={setLocalCommentDraft}
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
                  onPress={() => onPickDraftCommentImage(post.id)}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="image-outline" size={14} color={c.textSecondary} />
                  <Text style={[styles.commentSendText, { color: c.textSecondary }]}>
                    {t('home.photoAction', { defaultValue: 'Photo' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.commentReplySendButton, { backgroundColor: c.inputBackground, borderColor: c.border, borderWidth: 1 }]}
                  onPress={() => onSetDraftCommentGif(post.id)}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="file-gif-box" size={14} color={c.textSecondary} />
                  <Text style={[styles.commentSendText, { color: c.textSecondary }]}>GIF</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.commentSendButton, { backgroundColor: c.primary }]}
                onPress={() => { void onSubmitComment(post.id, localCommentDraft); setLocalCommentDraft(''); }}
                activeOpacity={0.85}
              >
                <Text style={styles.commentSendText}>{t('home.commentPostAction')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      <Modal
        visible={postEditing}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setPostEditing(false);
          setPostEditDraft(postText);
        }}
      >
        <TouchableOpacity
          style={styles.postEditModalBackdrop}
          activeOpacity={1}
          onPress={() => {
            setPostEditing(false);
            setPostEditDraft(postText);
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
                    setPostEditDraft(postText);
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
                    setPostEditDraft(postText);
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

      <Modal
        visible={postDeleteConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPostDeleteConfirmOpen(false)}
      >
        <TouchableOpacity
          style={styles.postEditModalBackdrop}
          activeOpacity={1}
          onPress={() => setPostDeleteConfirmOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={{ borderWidth: 1, borderRadius: 12, padding: 14, gap: 10, width: 360, maxWidth: '92%', borderColor: c.border, backgroundColor: c.surface }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: c.textPrimary }}>{t('home.deleteAction')}</Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={() => setPostDeleteConfirmOpen(false)}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="close" size={16} color={c.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 13, lineHeight: 18, color: c.textSecondary }}>
                {t('home.postDeleteConfirm')}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 2 }}>
                <TouchableOpacity
                  style={[styles.commentReplySendButton, { backgroundColor: c.inputBackground, borderColor: c.border, borderWidth: 1 }]}
                  activeOpacity={0.85}
                  disabled={postEditLoading}
                  onPress={() => setPostDeleteConfirmOpen(false)}
                >
                  <Text style={[styles.commentSendText, { color: c.textSecondary }]}>{t('home.cancelAction')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.commentReplySendButton, { backgroundColor: c.errorText ?? '#ef4444' }]}
                  activeOpacity={0.85}
                  disabled={postEditLoading}
                  onPress={() => void confirmDeletePost()}
                >
                  {postEditLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.commentSendText}>{t('home.deleteAction')}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// PostCard receives 60+ props and sits inside feed .map loops. Most re-renders
// of HomeScreen recreate function refs but don't change *data* — so we memoize
// and skip comparison of function props (their identity shifts but behavior
// doesn't). Any data-prop change still triggers a re-render via Object.is.
function arePostCardPropsEqual(prev: PostCardProps, next: PostCardProps): boolean {
  const keys = Object.keys(next) as Array<keyof PostCardProps>;
  for (const key of keys) {
    const nv = next[key];
    if (typeof nv === 'function') continue;
    if (!Object.is(nv, prev[key])) return false;
  }
  // Also catch removed props (prev has a key next doesn't)
  for (const key of Object.keys(prev) as Array<keyof PostCardProps>) {
    if (!(key in next) && typeof prev[key] !== 'function') return false;
  }
  return true;
}

export default React.memo(PostCard, arePostCardPropsEqual);
