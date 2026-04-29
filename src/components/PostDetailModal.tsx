import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

type DetailViewMode = 'split' | 'commentsFull' | 'mediaFull';

// Drag thresholds for the media↔comments swipe gestures. dy is in pixels.
// Tighter than RN's defaults so the snap feels responsive without an
// accidental tap-during-scroll triggering a state change.
const SWIPE_TRIGGER_DY = 60;
const SWIPE_DOMINANT_RATIO = 1.4;
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FeedPost, PostComment } from '../api/client';
import { getSafeExternalVideoEmbedUrl } from '../utils/externalVideoEmbeds';
import { extractFirstUrlFromText, fetchShortPostLinkPreviewCached, getUrlHostLabel, ShortPostLinkPreview } from '../utils/shortPostEmbeds';
import MentionHashtagInput from './MentionHashtagInput';
import { GifPickerOverlay } from './GifPickerProvider';
import { MentionPopupOverlay } from './MentionPopupProvider';
import ReactionPickerDrawer from './ReactionPickerDrawer';

// Native video player. Lazy-required only on native so the web bundle
// doesn't pull in any of expo-video's iOS/Android-only modules.
const ExpoVideo: any =
  Platform.OS !== 'web'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('expo-video')
    : null;

/**
 * NativePostDetailVideo — small inline wrapper around expo-video's
 * VideoView + useVideoPlayer hook. Mirrors the web `<video controls>`
 * behaviour: shows native playback controls, plays on tap, and seeks to
 * `initialTimeSec` once the player reports `readyToPlay` (matches the
 * `loadedmetadata`-driven currentTime seek the web branch above does).
 */
function NativePostDetailVideo({
  uri,
  autoPlay,
  initialTimeSec,
  onConsumeInitialTime,
}: {
  uri: string;
  autoPlay: boolean;
  initialTimeSec: number;
  onConsumeInitialTime?: () => void;
}) {
  const useVideoPlayer = ExpoVideo?.useVideoPlayer;
  const VideoView = ExpoVideo?.VideoView;
  const player = useVideoPlayer
    ? useVideoPlayer(uri, (p: any) => {
        // Keep the setup minimal — calling p.play() here fires before the
        // source has loaded, which AVPlayer (iOS) silently drops. The
        // useEffect below waits for status === 'readyToPlay' and plays
        // then, which actually starts playback.
        p.loop = false;
      })
    : null;

  React.useEffect(() => {
    if (!player) return;

    let seekConsumed = false;
    let autoPlayFired = false;

    const tryApplySeek = () => {
      if (seekConsumed) return;
      if (!Number.isFinite(initialTimeSec) || initialTimeSec <= 0) {
        seekConsumed = true;
        return;
      }
      const dur = Number.isFinite(player.duration) ? player.duration : 0;
      const target = dur > 0
        ? Math.max(0, Math.min(initialTimeSec, Math.max(0, dur - 0.25)))
        : Math.max(0, initialTimeSec);
      try {
        player.currentTime = target;
      } catch {
        // Ignore seek errors from player edge cases.
      }
      seekConsumed = true;
      onConsumeInitialTime?.();
    };

    const tryAutoPlay = () => {
      if (autoPlayFired) return;
      if (!autoPlay) {
        autoPlayFired = true;
        return;
      }
      try {
        player.play();
      } catch {
        // Player rejects play() in some transient states; the next
        // status-change tick will retry until autoPlayFired flips.
        return;
      }
      autoPlayFired = true;
    };

    const handleReady = () => {
      tryApplySeek();
      tryAutoPlay();
    };

    const sub = player.addListener?.('statusChange', (event: any) => {
      if (event?.status === 'readyToPlay') handleReady();
    });
    // If status is already ready by the time the effect runs (cached
    // playback / hot reload), apply immediately.
    if (player.status === 'readyToPlay') handleReady();
    return () => {
      sub?.remove?.();
    };
  }, [player, initialTimeSec, onConsumeInitialTime, autoPlay]);

  // Custom mute toggle. expo-video 3.0.x's native iOS controls flip the
  // speaker-icon UI but don't reliably update `player.muted` — the video
  // looks muted while audio still plays. We override that with our own
  // mute button rendered on top, which sets `player.muted` directly.
  const [muted, setMuted] = React.useState<boolean>(() => {
    try {
      return !!player?.muted;
    } catch {
      return false;
    }
  });
  const toggleMute = React.useCallback(() => {
    if (!player) return;
    const next = !muted;
    try {
      player.muted = next;
    } catch {
      // ignore — keep state consistent with attempt
    }
    setMuted(next);
  }, [player, muted]);

  if (!VideoView || !player) return null;

  return (
    <View style={{ width: '100%', height: '100%' }}>
      <VideoView
        style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
        player={player}
        allowsFullscreen
        allowsPictureInPicture
        contentFit="contain"
        nativeControls
      />
      <TouchableOpacity
        accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        onPress={toggleMute}
        activeOpacity={0.85}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          width: 40,
          height: 40,
          borderRadius: 999,
          backgroundColor: 'rgba(0,0,0,0.6)',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.25)',
        }}
      >
        <MaterialCommunityIcons
          name={muted ? 'volume-off' : 'volume-high'}
          size={20}
          color="#fff"
        />
      </TouchableOpacity>
    </View>
  );
}

// Native WebView for YouTube/Vimeo embeds. Lazy-required on native only so
// web bundles don't pull in the native-only module. Same treatment as
// PostCard.
const NativeWebView: any =
  Platform.OS !== 'web'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('react-native-webview').WebView
    : null;

const EMBED_BASE_URL = 'https://openspacelive.com';

function buildEmbedHtml(embedUrl: string) {
  let finalUrl = embedUrl;
  try {
    const u = new URL(embedUrl);
    u.searchParams.set('playsinline', '1');
    u.searchParams.set('rel', '0');
    u.searchParams.set('modestbranding', '1');
    if (u.host.includes('youtube')) {
      u.searchParams.set('origin', EMBED_BASE_URL);
    }
    finalUrl = u.toString();
  } catch {
    finalUrl = embedUrl.includes('?') ? `${embedUrl}&playsinline=1` : `${embedUrl}?playsinline=1`;
  }
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <style>
      html, body { margin: 0; padding: 0; background: #000; height: 100%; }
      .frame { position: fixed; inset: 0; }
      iframe { width: 100%; height: 100%; border: 0; }
    </style>
  </head>
  <body>
    <div class="frame">
      <iframe
        src="${finalUrl}"
        title="Embedded video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe>
    </div>
  </body>
</html>`;
}

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
  commentsHasMoreByPost: Record<number, boolean>;
  commentsLoadingMoreByPost: Record<number, boolean>;
  onLoadMoreComments: (post: FeedPost) => void;
  commentRepliesById: Record<number, PostComment[]>;
  repliesHasMoreByComment: Record<number, boolean>;
  repliesLoadingMoreByComment: Record<number, boolean>;
  onLoadMoreReplies: (postUuid: string, commentId: number) => void;
  commentRepliesExpanded: Record<number, boolean>;
  commentRepliesLoadingById: Record<number, boolean>;
  draftCommentMediaByPostId: Record<number, CommentDraftMedia | null>;
  draftReplyMediaByCommentId: Record<number, CommentDraftMedia | null>;
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
  onReportPost?: (post: FeedPost) => void;
  onReportComment?: (postUuid: string, commentId: number) => void;
  overlayModal?: React.ReactNode;
  onOpenSharedPost?: (post: FeedPost) => void;
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
  onNavigateProfile: (username: string) => void;
  onNavigateHashtag?: (tag: string) => void;
  token?: string;
  reactionListOpen: boolean;
  reactionListLoading: boolean;
  reactionListEmoji: ReactionEmoji | null;
  reactionListUsers: PostReaction[];
  onCloseReactionList: () => void;
  /** When true, focuses the post-level comment composer on mount so the
   *  keyboard pops up immediately. Used when the user navigates here by
   *  tapping the comment icon on a feed post. */
  autoFocusComposer?: boolean;
  /** Reflects the user's "Auto-play media" setting. Used by the native
   *  video player to start playback automatically when the post detail
   *  opens; on web this is handled by the `<video>` element's `autoplay`
   *  attribute (which the web branch already wires up). */
  autoPlayMedia?: boolean;
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
  commentsHasMoreByPost,
  commentsLoadingMoreByPost,
  onLoadMoreComments,
  commentRepliesById,
  repliesHasMoreByComment,
  repliesLoadingMoreByComment,
  onLoadMoreReplies,
  commentRepliesExpanded,
  commentRepliesLoadingById,
  draftCommentMediaByPostId,
  draftReplyMediaByCommentId,
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
  onReportPost,
  onReportComment,
  overlayModal,
  onOpenSharedPost,
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
  onNavigateProfile,
  onNavigateHashtag,
  token,
  reactionListOpen,
  reactionListLoading,
  reactionListEmoji,
  reactionListUsers,
  onCloseReactionList,
  autoFocusComposer,
  autoPlayMedia = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const [commentReactionPickerForId, setCommentReactionPickerForId] = React.useState<number | null>(null);
  const [postReactionPickerOpen, setPostReactionPickerOpen] = React.useState(false);
  const [detailPanel, setDetailPanel] = React.useState<'comments' | 'reactions'>('comments');
  // Narrow-viewport detection: below this, stack media above comments
  // (instead of side-by-side) so comments aren't squeezed to 42% of width.
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isNarrow = viewportWidth < 720;

  // Drives the comments-column height animation on narrow viewports. We
  // animate an explicit pixel height (rather than letting flex resize)
  // because iOS's LayoutAnimation interpolates child frames from incorrect
  // starting positions when the parent's flex factor + maxHeight both
  // change at once — that's what made the drag handle appear to "fall from
  // the top" during mediaFull → split.
  const HEIGHT_MEDIA_FULL = 64;
  const usableHeight = Math.max(viewportHeight - insets.top - insets.bottom, 320);
  const heightForMode = React.useCallback(
    (mode: DetailViewMode) => {
      if (mode === 'mediaFull') return HEIGHT_MEDIA_FULL;
      if (mode === 'commentsFull') return usableHeight;
      // 'split' — half of the usable area for the comments column.
      return Math.round(usableHeight * 0.5);
    },
    [usableHeight],
  );
  const commentsHeightAnim = React.useRef(new Animated.Value(heightForMode('split'))).current;

  // Local draft state — isolated so typing never causes the parent tree to re-render
  const [localCommentDraft, setLocalCommentDraft] = React.useState('');
  const [localReplyDrafts, setLocalReplyDrafts] = React.useState<Record<number, string>>({});
  const [localCommentEditDrafts, setLocalCommentEditDrafts] = React.useState<Record<number, string>>({});
  const [localReplyEditDrafts, setLocalReplyEditDrafts] = React.useState<Record<number, string>>({});
  // Mobile: three-way split between media and comments.
  //   'split'         — equal halves (default for posts with media)
  //   'commentsFull'  — media collapsed, comments fill the screen
  //   'mediaFull'     — media fills the screen, comments collapsed to a tap-bar
  // Driven by both swipe gestures (vertical pan on the media or the drag
  // handle above comments) and the toggle button in the comments header.
  const [viewMode, setViewMode] = React.useState<DetailViewMode>('split');
  const mediaHidden = viewMode === 'commentsFull';

  // Animate the comments-column height whenever the view mode changes.
  // `Animated.spring` with these params (low tension, balanced friction)
  // gives a natural sheet-pull feel — momentum carries the panel past its
  // target by a hair before settling. Feels much less rigid than a fixed-
  // duration timing curve, which always lands the same crisp way.
  // useNativeDriver:false is required since `height` is a layout property.
  React.useEffect(() => {
    if (!isNarrow) return;
    Animated.spring(commentsHeightAnim, {
      toValue: heightForMode(viewMode),
      tension: 38,
      friction: 11,
      // Don't let it overshoot or oscillate — `restSpeedThreshold` and
      // `restDisplacementThreshold` keep the spring from "ringing" once
      // it's basically settled (which would feel jittery on a layout
      // height value).
      restSpeedThreshold: 1,
      restDisplacementThreshold: 0.5,
      useNativeDriver: false,
    }).start();
  }, [viewMode, isNarrow, heightForMode, commentsHeightAnim]);

  function transitionViewMode(next: DetailViewMode) {
    setViewMode(next);
  }

  // Pull-down on a viewport area expands media (commentsFull → split → mediaFull).
  // Pull-up does the opposite. Returns true if the gesture moved state, false
  // otherwise so callers can decide what to do (e.g. ignore short scrolls).
  function applySwipe(dy: number): boolean {
    if (dy <= -SWIPE_TRIGGER_DY) {
      // Pull up — toward comments.
      if (viewMode === 'mediaFull') transitionViewMode('split');
      else if (viewMode === 'split') transitionViewMode('commentsFull');
      else return false;
      return true;
    }
    if (dy >= SWIPE_TRIGGER_DY) {
      // Pull down — toward media.
      if (viewMode === 'commentsFull') transitionViewMode('split');
      else if (viewMode === 'split') transitionViewMode('mediaFull');
      else return false;
      return true;
    }
    return false;
  }

  // View-level responder handlers for the drag handle. Using RN's lower
  // level responder API directly (rather than `PanResponder.create`) is
  // more reliable inside an iOS Modal — PanResponder's `onMoveShould*`
  // callbacks sometimes never fire when the Modal's outer hierarchy
  // hasn't claimed the touch. With `onStartShouldSetResponder` returning
  // true, the View grabs every touch that lands on it directly, and we
  // measure pageY at start vs release to determine direction.
  const swipeStartYRef = React.useRef<number | null>(null);
  const dragHandleResponderProps = React.useMemo(
    () => ({
      onStartShouldSetResponder: () => true,
      onMoveShouldSetResponder: () => true,
      onResponderGrant: (e: any) => {
        swipeStartYRef.current = e?.nativeEvent?.pageY ?? null;
      },
      onResponderRelease: (e: any) => {
        const startY = swipeStartYRef.current;
        const endY = e?.nativeEvent?.pageY ?? startY;
        swipeStartYRef.current = null;
        if (startY == null || endY == null) return;
        applySwipe(endY - startY);
      },
      onResponderTerminate: () => {
        swipeStartYRef.current = null;
      },
      onResponderTerminationRequest: () => false,
    }),
    [viewMode],
  );

  // Same handlers, lighter — for the media area itself. Touches on the
  // image happily delegate to this parent View since plain Image doesn't
  // claim the responder.
  const mediaSwipeResponderProps = dragHandleResponderProps;

  // Detect whether the post's primary media is a video so we can pick the
  // right initial viewMode. Video posts open in `mediaFull` (Instagram /
  // TikTok-style immersive — swipe up reveals comments); image-only posts
  // open in `split`.
  const activePostHasVideo = React.useMemo(() => {
    if (!activePost) return false;
    const media = (activePost as any)?.media;
    if (!Array.isArray(media) || media.length === 0) return false;
    return media.some((m: any) => {
      const fileUri = m?.file || m?.url || '';
      return looksLikeVideoType(m?.type) || looksLikeVideoUrl(fileUri);
    });
  }, [activePost]);

  // Reset draft + pick the right initial viewMode each time the user
  // navigates to a different post.
  const prevPostIdRef = React.useRef<number | null>(null);
  if (activePost && activePost.id !== prevPostIdRef.current) {
    prevPostIdRef.current = activePost.id;
    if (localCommentDraft !== '') setLocalCommentDraft('');
    const targetMode: DetailViewMode = activePostHasVideo ? 'mediaFull' : 'split';
    if (viewMode !== targetMode) setViewMode(targetMode);
  }
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
            if (Platform.OS !== 'web' && embedUrl && NativeWebView) {
              return (
                <View key={`${postId}-lp-detail-embed-${idx}`} style={{ width: '100%', marginVertical: 8 } as any}>
                  <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' } as any}>
                    <NativeWebView
                      source={{ html: buildEmbedHtml(embedUrl), baseUrl: EMBED_BASE_URL }}
                      originWhitelist={['*']}
                      allowsFullscreenVideo
                      allowsInlineMediaPlayback
                      mediaPlaybackRequiresUserAction={false}
                      javaScriptEnabled
                      domStorageEnabled
                      style={{ flex: 1, backgroundColor: '#000' }}
                    />
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
    if (
      Platform.OS !== 'web' &&
      resolvedShortLinkPreview.isVideo &&
      resolvedShortLinkPreview.embedUrl &&
      NativeWebView
    ) {
      return (
        <View style={[styles.shortPostVideoEmbedWrap, { backgroundColor: '#000' }] as any}>
          <NativeWebView
            source={{
              html: buildEmbedHtml(resolvedShortLinkPreview.embedUrl),
              baseUrl: EMBED_BASE_URL,
            }}
            originWhitelist={['*']}
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            style={{ flex: 1, backgroundColor: '#000' }}
          />
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
    const hasMore = !!commentsHasMoreByPost[postId];
    const loadingMore = !!commentsLoadingMoreByPost[postId];

    return (
      <>
        {comments.map((comment, index) => {
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
                      void onSaveEditedComment(postId, comment.id, false, localCommentEditDrafts[comment.id] ?? (comment.text || ''));
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
          ) : (!isOwnComment && !!onReportComment && !!activePost?.uuid) ? (
            <TouchableOpacity activeOpacity={0.85} onPress={() => onReportComment(activePost.uuid!, comment.id)}>
              <Text style={[styles.detailCommentMetaAction, { color: c.textMuted }]}>
                {t('home.reportCommentAction', { defaultValue: 'Report' })}
              </Text>
            </TouchableOpacity>
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
                              void onSaveEditedComment(postId, reply.id, true, localReplyEditDrafts[reply.id] ?? (reply.text || ''), comment.id);
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
                ) : (!isOwnReply && !!onReportComment && !!activePost?.uuid) ? (
                  <View style={[styles.detailCommentMetaRow, { marginTop: 4, marginLeft: 44 }]}>
                    <TouchableOpacity activeOpacity={0.85} onPress={() => onReportComment(activePost.uuid!, reply.id)}>
                      <Text style={[styles.detailCommentMetaAction, { color: c.textMuted }]}>
                        {t('home.reportCommentAction', { defaultValue: 'Report' })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
              );
            })}
            {repliesHasMoreByComment[comment.id] ? (
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={!!repliesLoadingMoreByComment[comment.id]}
                onPress={() => activePost?.uuid && onLoadMoreReplies(activePost.uuid, comment.id)}
                style={{ paddingVertical: 8, paddingHorizontal: 4, alignSelf: 'flex-start' }}
              >
                {repliesLoadingMoreByComment[comment.id] ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : (
                  <Text style={{ fontSize: 13, color: c.textLink, fontWeight: '600' }}>
                    {t('home.loadMoreReplies', { defaultValue: 'Load more replies…' })}
                  </Text>
                )}
              </TouchableOpacity>
            ) : null}
            <View style={styles.commentReplyComposer}>
              {renderDraftMediaPreview(
                draftReplyMediaByCommentId[comment.id],
                () => onClearDraftReplyMedia(comment.id)
              )}
              <MentionHashtagInput
                style={[styles.commentReplyInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
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
                    void onSubmitReply(postId, comment.id, localReplyDrafts[comment.id] || '');
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
        {hasMore ? (
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={loadingMore}
            onPress={() => activePost && onLoadMoreComments(activePost)}
            style={{ paddingVertical: 12, paddingHorizontal: 16, alignSelf: 'flex-start' }}
          >
            {loadingMore ? (
              <ActivityIndicator size="small" color={c.primary} />
            ) : (
              <Text style={{ fontSize: 13, color: c.textLink, fontWeight: '600' }}>
                {t('home.loadMoreComments', { defaultValue: 'Load more comments…' })}
              </Text>
            )}
          </TouchableOpacity>
        ) : null}
      </>
    );
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

        {onReportPost && currentUsername && post.creator?.username !== currentUsername ? (
          <TouchableOpacity
            style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            onPress={() => onReportPost(post)}
            activeOpacity={0.85}
          >
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color={c.textSecondary} />
            <Text style={[styles.feedActionText, { color: c.textSecondary }]}>{t('home.reportPostAction', { defaultValue: 'Report' })}</Text>
          </TouchableOpacity>
        ) : null}
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
    <Modal
      visible={visible}
      // On native we make the Modal transparent + skip the fade so the
      // underlying Stack screen (which already paints #0B0E13 + spinner) is
      // immediately visible during navigation. Web keeps the original
      // opaque fade-in to match the desktop/mobile-web UX.
      transparent={Platform.OS !== 'web'}
      animationType={Platform.OS === 'web' ? 'fade' : 'none'}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <View style={{ flex: 1, backgroundColor: activePost ? '#0B0E13' : c.background }}>
      {activePost ? (
        hasActivePostMedia ? (
          <View
            style={[
              styles.postDetailRoot,
              isNarrow && { flexDirection: 'column' },
              { backgroundColor: '#0B0E13' },
              // Modals render outside the app-level SafeAreaView, so push content
              // below the device status bar / notch ourselves.
              isNarrow && (Platform.OS === 'web'
                ? ({ paddingTop: 'env(safe-area-inset-top, 0px)' } as any)
                : Platform.OS === 'ios'
                  ? { paddingTop: 44 }
                  : null),
            ]}
          >
            <View
              style={[
                styles.postDetailLeft,
                isNarrow && viewMode === 'commentsFull' && { display: 'none' as const },
                // mediaFull on narrow viewports: media takes the entire
                // screen except for the small collapsed comments bar at
                // the bottom of postDetailRight.
                isNarrow && viewMode === 'mediaFull' && { flex: 1 },
              ]}
              {...(isNarrow ? mediaSwipeResponderProps : {})}
            >
              <TouchableOpacity
                style={[styles.postDetailClose, { backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }]}
                onPress={onClose}
                activeOpacity={0.85}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel={t('home.closeNoticeAction')}
              >
                <MaterialCommunityIcons name="close" size={26} color="#fff" />
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
                    <NativePostDetailVideo
                      uri={activeMedia.videoUri}
                      autoPlay={autoPlayMedia}
                      initialTimeSec={Number(initialMediaTimeSec || 0)}
                      onConsumeInitialTime={onConsumeInitialMediaTime}
                    />
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

            <Animated.View
              style={[
                styles.postDetailRight,
                isNarrow && {
                  width: '100%',
                  maxWidth: '100%',
                  // Drop flex; we drive the height directly via the
                  // Animated.Value so iOS interpolates from a known frame.
                  flex: undefined,
                  height: commentsHeightAnim,
                  borderLeftWidth: 0,
                  borderTopWidth: 1,
                  borderTopColor: c.border,
                  // Clip the body content while we're collapsed in mediaFull
                  // so the (still-mounted) header + ScrollView don't bleed
                  // outside the animated bounds.
                  overflow: 'hidden',
                },
                { backgroundColor: c.surface, borderLeftColor: c.border },
              ]}
            >
              {/* Drag handle / iOS-style grab bar — pull down here to
                *  expand media, pull up to expand comments. Visible on
                *  narrow only. The `mediaFull → split` tap-affordance lives
                *  on the dedicated tap-bar below; this handle is purely
                *  for swipe gestures.
                *
                *  Generous vertical padding so the touch zone is ~28pt
                *  tall — gives the user a comfortable target without
                *  visually expanding the divider. */}
              {isNarrow ? (
                <View
                  style={{
                    paddingTop: 14,
                    paddingBottom: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  {...dragHandleResponderProps}
                >
                  <View
                    style={{
                      width: 48,
                      height: 5,
                      borderRadius: 2.5,
                      backgroundColor: c.border,
                      opacity: 0.85,
                    }}
                  />
                </View>
              ) : null}

              {/* mediaFull: render a compact "Show comments" tap-bar in
                *  place of the full header + body. Tapping or pulling up
                *  restores the split view. */}
              {isNarrow && viewMode === 'mediaFull' ? (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => transitionViewMode('split')}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 14,
                  }}
                >
                  <Text style={{ color: c.textMuted, fontSize: 13, fontWeight: '600' }}>
                    {t('home.showCommentsAction', {
                      defaultValue: 'Show comments and reactions',
                    })}
                  </Text>
                </TouchableOpacity>
              ) : (
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
                {isNarrow ? (
                  <TouchableOpacity
                    onPress={() =>
                      transitionViewMode(viewMode === 'commentsFull' ? 'split' : 'commentsFull')
                    }
                    activeOpacity={0.75}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: c.inputBackground,
                      borderWidth: 1,
                      borderColor: c.border,
                    }}
                    accessibilityLabel={
                      mediaHidden
                        ? t('home.showMediaAction', { defaultValue: 'Show media' })
                        : t('home.hideMediaAction', { defaultValue: 'Hide media' })
                    }
                  >
                    <MaterialCommunityIcons
                      name={mediaHidden ? 'image-outline' : 'image-off-outline'}
                      size={18}
                      color={c.textSecondary}
                    />
                  </TouchableOpacity>
                ) : null}
              </View>
              )}

              <ScrollView
                style={[
                  styles.postDetailBody,
                  // mediaFull on narrow: collapse the body out of the
                  // layout entirely so the 64pt strip just shows the drag
                  // handle + the "Show comments" tap-bar. display:none
                  // preserves all mounted state (scroll position, draft,
                  // focus) so pulling back to split restores it as-is.
                  isNarrow && viewMode === 'mediaFull' && { display: 'none' as const },
                ]}
                contentContainerStyle={styles.postDetailBodyContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                automaticallyAdjustKeyboardInsets
              >
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
                    {activePost.is_closed ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, opacity: 0.6 }}>
                        <MaterialCommunityIcons name="lock" size={14} color={c.textMuted} />
                        <Text style={{ fontSize: 13, color: c.textMuted }}>
                          {t('home.postLockedCommentNotice', { defaultValue: 'This post is locked. No new comments can be added.' })}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.commentComposer}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
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
                            onPress={() => { void onSubmitComment(activePost.id, localCommentDraft); setLocalCommentDraft(''); }}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.commentSendText}>{t('home.commentPostAction')}</Text>
                          </TouchableOpacity>
                        </View>
                        {renderDraftMediaPreview(
                          draftCommentMediaByPostId[activePost.id],
                          () => onClearDraftCommentMedia(activePost.id)
                        )}
                        <MentionHashtagInput
                          style={[styles.commentInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                          value={localCommentDraft}
                          onChangeText={setLocalCommentDraft}
                          placeholder={t('home.commentPlaceholder')}
                          placeholderTextColor={c.placeholder}
                          token={token}
                          c={c}
                          multiline
                          autoFocus={autoFocusComposer}
                        />
                      </View>
                    )}
                  </View>
                ) : (
                  renderReactionsPanel(activePost)
                )}
              </ScrollView>
            </Animated.View>
          </View>
        ) : (
          <View
            style={[
              styles.postDetailTextOnlyRoot,
              { backgroundColor: '#0B0E13' },
              // Narrow viewports: strip the desktop-style centering +
              // padding so the card fills the full viewport edge-to-edge
              // (matches the media branch's full-bleed layout).
              isNarrow && { padding: 0, alignItems: 'stretch', justifyContent: 'flex-start' },
              isNarrow && (Platform.OS === 'web'
                ? ({ paddingTop: 'env(safe-area-inset-top, 0px)' } as any)
                : Platform.OS === 'ios'
                  ? { paddingTop: 44 }
                  : null),
            ]}
          >
            <View style={[
              styles.postDetailTextOnlyCard,
              { backgroundColor: c.surface, borderColor: c.border },
              // Drop max-width, rounded corners, and fixed height on
              // narrow so the card becomes a full-screen sheet instead of
              // a floating desktop-style modal.
              isNarrow && { maxWidth: undefined, height: '100%', borderRadius: 0, borderWidth: 0 },
            ]}>
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

              <ScrollView
                style={styles.postDetailBody}
                contentContainerStyle={styles.postDetailBodyContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                automaticallyAdjustKeyboardInsets
              >
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
                activePost.is_closed ? (
                  <View style={[styles.postDetailTextOnlyComposerWrap, { borderTopColor: c.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, opacity: 0.6 }}>
                      <MaterialCommunityIcons name="lock" size={14} color={c.textMuted} />
                      <Text style={{ fontSize: 13, color: c.textMuted }}>
                        {t('home.postLockedCommentNotice', { defaultValue: 'This post is locked. No new comments can be added.' })}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.postDetailTextOnlyComposerWrap,
                      { borderTopColor: c.border, paddingBottom: insets.bottom + 12 },
                    ]}
                  >
                    <View style={styles.commentComposer}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
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
                          onPress={() => { void onSubmitComment(activePost.id, localCommentDraft); setLocalCommentDraft(''); }}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.commentSendText}>{t('home.commentPostAction')}</Text>
                        </TouchableOpacity>
                      </View>
                      {renderDraftMediaPreview(
                        draftCommentMediaByPostId[activePost.id],
                        () => onClearDraftCommentMedia(activePost.id)
                      )}
                      <MentionHashtagInput
                        style={[styles.commentInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                        value={localCommentDraft}
                        onChangeText={setLocalCommentDraft}
                        placeholder={t('home.commentPlaceholder')}
                        placeholderTextColor={c.placeholder}
                        token={token}
                        c={c}
                        multiline
                        autoFocus={autoFocusComposer}
                      />
                    </View>
                  </View>
                )
              ) : null}
            </View>
          </View>
        )
      ) : (
        <View style={[styles.postDetailRoot, { backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator color={c.primary} size="large" />
        </View>
      )}
      </View>
      </KeyboardAvoidingView>
      {overlayModal}
      {/* Reaction picker drawer — renders for either post-level or
       *  comment-level reaction picking. Slides in from the right so the
       *  picker has its own full-height column instead of being clipped
       *  behind the post media. Routes the chosen emoji to the right
       *  callback based on which state is active. */}
      <ReactionPickerDrawer
        visible={!!activePost && (postReactionPickerOpen || commentReactionPickerForId !== null)}
        groups={reactionGroups}
        loading={reactionPickerLoading}
        actionLoading={reactionActionLoading}
        c={c}
        t={t}
        title={
          commentReactionPickerForId !== null
            ? t('home.reactToCommentTitle', { defaultValue: 'React to comment' })
            : t('home.reactToPostTitle', { defaultValue: 'React to post' })
        }
        onClose={() => {
          if (commentReactionPickerForId !== null) {
            setCommentReactionPickerForId(null);
          }
          if (postReactionPickerOpen) {
            setPostReactionPickerOpen(false);
          }
        }}
        onPick={(emojiId) => {
          if (!activePost) return;
          if (commentReactionPickerForId !== null) {
            void onReactToComment(activePost.id, commentReactionPickerForId, emojiId);
            setCommentReactionPickerForId(null);
          } else if (postReactionPickerOpen) {
            void onReactToPostWithEmoji(activePost, emojiId);
            setPostReactionPickerOpen(false);
          }
        }}
      />
      {/* GIF picker overlay — mounted inside this iOS Modal so the picker's
       *  absolute view paints on top of the post detail content. The
       *  app-root <GifPickerOverlay /> sits behind this Modal and stays
       *  invisible while it's open; both subscribe to the same provider
       *  state so closing here closes everywhere. */}
      <GifPickerOverlay />
      {/* Same reasoning as GifPickerOverlay above — mount the @mention /
       *  #hashtag suggestion overlay inside this iOS Modal so the absolute
       *  popup paints on top of the post detail content. */}
      <MentionPopupOverlay />
    </Modal>
  );
}
