import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Platform,
  ScrollView,
  RefreshControl,
  TextInput,
  Image,
  Linking,
  Modal,
  Animated,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  api,
  ApiRequestError,
  AppNotification,
  CircleResult,
  CommunityMember,
  CommunityOwner,
  FeedPost,
  FeedType,
  FollowingUserResult,
  GlobalModeratedObject,
  ListResult,
  ModerationCategory,
  ModerationPenalty,
  ModeratedObjectReport,
  PostComment,
  ProfileCommentActivity,
  SearchCommunityResult,
  SearchHashtagResult,
  SearchUserResult,
  SocialIdentity,
  SocialProvider,
  UpdateAuthenticatedUserMediaPayload,
  UpdateAuthenticatedUserPayload,
} from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import { AppRoute } from '../routing';
import SearchResultsScreen from './SearchResultsScreen';
import MyProfileScreen from './MyProfileScreen';
import PublicProfileScreen from './PublicProfileScreen';
import CommunityProfileScreen from './CommunityProfileScreen';
import PostCard from '../components/PostCard';
import FeedScreen from './FeedScreen';
import PostDetailModal from '../components/PostDetailModal';
import RouteSummaryCard from '../components/RouteSummaryCard';
import LongPostDrawer, { LongPostBlock, LongPostEditorMode } from '../components/LongPostDrawer';
import NotificationDrawer from '../components/NotificationDrawer';
import BottomTabBar, { BottomTab } from '../components/BottomTabBar';
import CirclesScreen from './CirclesScreen';
import ListsScreen from './ListsScreen';
import FollowPeopleScreen from './FollowPeopleScreen';
import CommunitiesScreen from './CommunitiesScreen';
import ManageCommunitiesScreen from './ManageCommunitiesScreen';
import MutedCommunitiesScreen from './MutedCommunitiesScreen';
import SettingsScreen from './SettingsScreen';
import InviteDrawer from '../components/InviteDrawer';
import CommunityManagementDrawer from '../components/CommunityManagementDrawer';
import EditProfileDrawer from '../components/EditProfileDrawer';
import MentionHashtagInput from '../components/MentionHashtagInput';
import { useAppToast } from '../toast/AppToastContext';
import {
  ShortPostLinkPreview,
  extractFirstUrlFromText,
  fetchShortPostLinkPreviewCached,
} from '../utils/shortPostEmbeds';
import { parseExternalVideoUrl } from '../utils/externalVideoEmbeds';
import { useGifPicker } from '../components/GifPickerProvider';

interface HomeScreenProps {
  token: string;
  onLogout: () => void;
  onTokenRefresh?: (token: string) => void | Promise<void>;
  route: AppRoute;
  onNavigate: (route: AppRoute, replace?: boolean) => void;
}

const WELCOME_NOTICE_KEY_PREFIX = '@openspace/welcome_notice_last_shown';
const WELCOME_NOTICE_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours
const SEARCH_RESULTS_STATE_KEY_PREFIX = '@openspace/search_results_state';
const AUTO_PLAY_MEDIA_SETTING_KEY = '@openspace/auto_play_media';
const PROFILE_COMMUNITIES_PAGE_SIZE = 20;
const PROFILE_FOLLOWINGS_PAGE_SIZE = 20;
const SHORT_POST_MAX_LENGTH = 5000;
const LONG_POST_MAX_IMAGES = 5;
const EMAIL_CHANGE_PENDING_KEY = '@openspace/settings/email-change-pending-v1';

type CommentDraftMedia = {
  kind: 'image' | 'gif';
  file?: Blob;
  uri: string;
  name?: string;
};

function extractPlainTextFromBlocks(blocks: LongPostBlock[]) {
  return blocks
    .map((block) => `${block.text || ''} ${block.caption || ''}`.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractPlainTextFromHtml(html?: string) {
  if (!html) return '';
  const withoutTags = html
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
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

// DOM-based HTML → LongPostBlock[] parser. Runs in any browser context where
// DOMParser is available. Traverses nodes in document order so the author's
// placement of images relative to text is always preserved.
function parseLongPostHtmlWithDom(html: string): LongPostBlock[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const blocks: LongPostBlock[] = [];
  let pos = 0;

  function nextId() {
    return `dom-${Date.now()}-${pos}-${Math.random().toString(36).slice(2, 7)}`;
  }
  function push(base: Omit<LongPostBlock, 'id' | 'position'>) {
    blocks.push({ id: nextId(), position: pos++, ...base } as LongPostBlock);
  }

  function imgBlock(img: Element): Omit<LongPostBlock, 'id' | 'position'> | null {
    const src = img.getAttribute('src') || '';
    if (!src || (!src.startsWith('http') && !src.startsWith('/'))) return null;
    const alt = img.getAttribute('alt') || '';
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
    // Align: prefer data-align, then infer from style margins
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
    return { type: 'image', url: src, caption: alt, align, width, objectPosition, imageFit, imageScale };
  }

  function processEl(el: Element) {
    const tag = el.tagName.toLowerCase();

    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) push({ type: 'heading', text, level: tag === 'h1' ? 1 : tag === 'h3' ? 3 : 2 });
      return;
    }
    if (tag === 'blockquote') {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) push({ type: 'quote', text });
      return;
    }
    if (tag === 'img') {
      const b = imgBlock(el); if (b) push(b);
      return;
    }
    if (tag === 'iframe') {
      const src = el.getAttribute('src') || '';
      if (src) push({ type: 'embed', url: src });
      return;
    }
    if (tag === 'figure') {
      // Figure can wrap images, embeds, or tables.
      const isLinkEmbed = (el.getAttribute('data-os-link-embed') || '').toLowerCase() === 'true';
      if (isLinkEmbed) {
        const dataUrl = (el.getAttribute('data-url') || '').trim();
        const anchorUrl = (el.querySelector('a')?.getAttribute('href') || '').trim();
        const url = dataUrl || anchorUrl;
        if (url) push({ type: 'embed', url });
        return;
      }
      const table = el.querySelector('table');
      if (table) {
        push({ type: 'table' as any, url: '', tableHtml: table.outerHTML } as any);
        return;
      }
      const iframe = el.querySelector('iframe');
      if (iframe) {
        const src = iframe.getAttribute('src') || '';
        if (src) push({ type: 'embed', url: src });
        return;
      }
      // <figure> wrapping an <img> — treat as image block
      const img = el.querySelector('img');
      if (img) { const b = imgBlock(img); if (b) push(b); }
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      el.querySelectorAll('li').forEach((li) => {
        const text = (li.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) push({ type: 'paragraph', text });
      });
      return;
    }
    if (tag === 'table') {
      // Emit table HTML as a raw embed block so PostCard can render it
      // with the same invisible-grid / bordered-grid styling.
      push({ type: 'table' as any, url: '', tableHtml: el.outerHTML } as any);
      return;
    }
    if (tag === 'p') {
      // A <p> might contain an inline <img> (Lexical sometimes does this).
      // Walk child nodes in order: emit a text block for runs of text, emit
      // an image block each time we hit an <img>, so ordering is preserved.
      let textRun = '';
      let hasImg = false;
      Array.from(el.childNodes).forEach((child) => {
        if (child.nodeType === 3 /* TEXT_NODE */) {
          textRun += child.textContent || '';
        } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
          const childEl = child as Element;
          if (childEl.tagName.toLowerCase() === 'img') {
            hasImg = true;
            const trimmed = textRun.replace(/\s+/g, ' ').trim();
            if (trimmed) { push({ type: 'paragraph', text: trimmed }); textRun = ''; }
            const b = imgBlock(childEl); if (b) push(b);
          } else if (childEl.tagName.toLowerCase() === 'iframe') {
            hasImg = true;
            const trimmed = textRun.replace(/\s+/g, ' ').trim();
            if (trimmed) { push({ type: 'paragraph', text: trimmed }); textRun = ''; }
            const src = childEl.getAttribute('src') || '';
            if (src) push({ type: 'embed', url: src });
          } else {
            textRun += childEl.textContent || '';
          }
        }
      });
      const trimmed = textRun.replace(/\s+/g, ' ').trim();
      if (trimmed) push({ type: 'paragraph', text: trimmed });
      if (!hasImg && !trimmed) {
        // Fallback: the whole textContent as paragraph
        const full = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (full) push({ type: 'paragraph', text: full });
      }
      return;
    }
    // Generic container (span, div, section…) — look for tables/images first, then text
    const innerTables = Array.from(el.querySelectorAll('table'));
    if (innerTables.length > 0) {
      innerTables.forEach((table) => {
        push({ type: 'table' as any, url: '', tableHtml: table.outerHTML } as any);
      });
      return;
    }
    const innerImgs = Array.from(el.querySelectorAll('img'));
    if (innerImgs.length > 0) {
      innerImgs.forEach((img) => { const b = imgBlock(img); if (b) push(b); });
      return;
    }
    const innerIframes = Array.from(el.querySelectorAll('iframe'));
    if (innerIframes.length > 0) {
      innerIframes.forEach((iframe) => {
        const src = iframe.getAttribute('src') || '';
        if (src) push({ type: 'embed', url: src });
      });
      return;
    }
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) push({ type: 'paragraph', text });
  }

  Array.from(doc.body.children).forEach(processEl);
  return blocks;
}

function parseLongPostHtmlBlocksForPreview(html?: string): LongPostBlock[] {
  if (!html || !html.trim()) return [];
  // Prefer DOM-based parsing — it traverses nodes in document order and
  // handles all the Lexical HTML structures (bare <img>, <figure><img>,
  // <p><img>, decorator <span><img>, etc.) without regex ambiguity.
  if (typeof DOMParser !== 'undefined') {
    return parseLongPostHtmlWithDom(html);
  }
  // Regex fallback for non-web environments (should rarely be reached in practice).
  const blocks: LongPostBlock[] = [];
  const pattern = /<(h[1-3]|p|blockquote|img|iframe|table|figure)\b[^>]*>([\s\S]*?)<\/\1>|<(img)\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null = null;
  let position = 0;
  function nextId() { return `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
  function pushBlock(block: Omit<LongPostBlock, 'id'>) { blocks.push({ id: nextId(), position: position++, ...block } as LongPostBlock); }
  while ((match = pattern.exec(html)) !== null) {
    const tag = (match[1] || match[3] || '').toLowerCase();
    const raw = match[0] || '';
    const inner = match[2] || '';
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const text = decodeHtmlEntities(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
      if (text) pushBlock({ type: 'heading', text, level: tag === 'h1' ? 1 : tag === 'h3' ? 3 : 2 });
    } else if (tag === 'blockquote') {
      const text = decodeHtmlEntities(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
      if (text) pushBlock({ type: 'quote', text });
    } else if (tag === 'p') {
      const text = decodeHtmlEntities(inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
      if (text) pushBlock({ type: 'paragraph', text });
    } else if (tag === 'img') {
      const src = raw.match(/\ssrc=(?:"([^"]+)"|'([^']+)')/i);
      const url = decodeHtmlEntities((src?.[1] || src?.[2] || '').trim());
      const alt = raw.match(/\salt=(?:"([^"]+)"|'([^']+)')/i);
      const caption = decodeHtmlEntities((alt?.[1] || alt?.[2] || '').trim());
      const dataAlign = (raw.match(/\sdata-align=(?:"([^"]+)"|'([^']+)')/i)?.[1] || '').trim().toLowerCase();
      const wRaw = (raw.match(/\swidth=(?:"([^"]+)"|'([^']+)'|([0-9.]+))/i)?.[1] || raw.match(/\swidth=(?:"([^"]+)"|'([^']+)'|([0-9.]+))/i)?.[3] || '').trim();
      const w = Number(wRaw); const width = Number.isFinite(w) && w > 0 ? Math.max(120, Math.min(1200, w)) : undefined;
      const align: 'left' | 'center' | 'right' = dataAlign === 'center' ? 'center' : dataAlign === 'right' ? 'right' : 'left';
      if (url) pushBlock({ type: 'image', url, caption, align, width });
    } else if (tag === 'iframe') {
      const src = raw.match(/\ssrc=(?:"([^"]+)"|'([^']+)')/i);
      const url = decodeHtmlEntities((src?.[1] || src?.[2] || '').trim());
      if (url) pushBlock({ type: 'embed', url });
    } else if (tag === 'table') {
      pushBlock({ type: 'table' as any, url: '', tableHtml: raw } as any);
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
        if (url) pushBlock({ type: 'embed', url });
      }
    }
  }
  return blocks;
}

function ensureLongPostBlocks(blocks: LongPostBlock[]) {
  return blocks.length > 0 ? blocks : createInitialLongPostBlocks();
}

function extractImageUrlsFromLongPostHtml(html?: string) {
  if (!html || !html.trim()) return [] as string[];
  const urls: string[] = [];
  const pattern = /<img\b[^>]*\ssrc=(?:"([^"]+)"|'([^']+)')[^>]*\/?>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(html)) !== null) {
    const raw = (match[1] || match[2] || '').trim();
    const url = decodeHtmlEntities(raw);
    if (url) urls.push(url);
  }
  return Array.from(new Set(urls));
}

function canonicalizeMediaUrl(value?: string) {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withoutQuery = trimmed.split('?')[0].split('#')[0];
  return withoutQuery.replace(/\/+$/, '').toLowerCase();
}

function buildLongPostHtmlFromBlocks(blocks: LongPostBlock[]) {
  return blocks
    .map((block) => {
      if (block.type === 'heading') {
        const level = block.level || 2;
        return `<h${level}>${escapeHtml(block.text || '')}</h${level}>`;
      }
      if (block.type === 'quote') {
        return `<blockquote><p>${escapeHtml(block.text || '')}</p></blockquote>`;
      }
      if (block.type === 'image') {
        if (!block.url) return '';
        const imgAttrs: string[] = [
          `src="${escapeHtml(block.url)}"`,
          `alt="${escapeHtml(block.caption || '')}"`,
          `data-align="${block.align || 'left'}"`,
        ];
        if (block.width) imgAttrs.push(`width="${block.width}"`);
        if (block.objectPosition) imgAttrs.push(`data-object-position="${escapeHtml(block.objectPosition)}"`);
        if (block.imageFit) imgAttrs.push(`data-image-fit="${block.imageFit}"`);
        if (block.imageScale != null && Number.isFinite(block.imageScale)) imgAttrs.push(`data-image-scale="${block.imageScale}"`);
        const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : '';
        return `<figure><img ${imgAttrs.join(' ')} />${caption}</figure>`;
      }
      if (block.type === 'embed') {
        if (!block.url) return '';
        // Round-trip embeds back into markup the Lexical editor's
        // importDOM accepts (iframe for video providers, figure with
        // data-os-link-embed for article cards) so reopened drafts
        // restore embed nodes instead of bare blue links.
        const video = parseExternalVideoUrl(block.url);
        if (video) {
          return `<iframe src=\"${escapeHtml(video.embedUrl)}\" data-source-url=\"${escapeHtml(video.sourceUrl)}\" frameborder=\"0\" allowfullscreen=\"true\"></iframe>`;
        }
        return `<figure data-os-link-embed=\"true\" data-url=\"${escapeHtml(block.url)}\"><a href=\"${escapeHtml(block.url)}\" target=\"_blank\" rel=\"noopener noreferrer\">${escapeHtml(block.url)}</a></figure>`;
      }
      if (block.type === 'table') {
        const rawTable = (block.tableHtml || '').trim();
        if (!rawTable) return '';
        return rawTable;
      }
      return `<p>${escapeHtml(block.text || '')}</p>`;
    })
    .filter(Boolean)
    .join('');
}

function createInitialLongPostBlocks(): LongPostBlock[] {
  return [{ id: 'initial-heading', type: 'heading', level: 2, text: '' }];
}

function splitLongPostTitleFromBlocks(blocks: LongPostBlock[]) {
  const first = blocks[0];
  if (first?.type === 'heading' && (first.level || 2) === 1 && (first.text || '').trim()) {
    const rest = blocks.slice(1);
    return {
      title: (first.text || '').trim(),
      blocks: rest.length > 0 ? rest : createInitialLongPostBlocks(),
    };
  }
  return {
    title: '',
    blocks: blocks.length > 0 ? blocks : createInitialLongPostBlocks(),
  };
}

function composeLongPostBlocksWithTitle(title: string, blocks: LongPostBlock[]): LongPostBlock[] {
  const normalizedBlocks = blocks.length > 0 ? blocks : createInitialLongPostBlocks();
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return normalizedBlocks;
  const titleBlock: LongPostBlock = {
    id: `title-${Date.now()}`,
    type: 'heading',
    level: 1,
    text: trimmedTitle,
  };
  return [
    titleBlock,
    ...normalizedBlocks,
  ];
}

function composeLongPostHtmlWithTitle(title: string, rawHtml: string) {
  const trimmedTitle = title.trim();
  const trimmedBody = rawHtml.trim();
  const titleHtml = trimmedTitle ? `<h1>${escapeHtml(trimmedTitle)}</h1>` : '';
  if (!trimmedBody) return titleHtml;
  return `${titleHtml}${trimmedBody}`;
}

function splitTitleFromLongPostHtml(html?: string) {
  const raw = (html || '').trim();
  if (!raw) {
    return { title: '', bodyHtml: '' };
  }
  const match = raw.match(/^<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) {
    return { title: '', bodyHtml: raw };
  }
  const titleInner = match[1] || '';
  const title = extractPlainTextFromHtml(titleInner);
  const bodyHtml = raw.slice(match[0].length).trim();
  return { title, bodyHtml };
}

type ReactionEmoji = {
  id?: number;
  keyword?: string;
  image?: string;
};

type ReactionGroup = {
  id: number;
  keyword?: string;
  color?: string;
  order?: number;
  emojis?: ReactionEmoji[];
};

type PostReaction = {
  id?: number;
  created?: string;
  emoji?: ReactionEmoji;
  reactor?: {
    id?: number;
    username?: string;
    avatar?: string;
    profile?: { avatar?: string };
  };
};

type ProfileTabKey = 'all' | 'about' | 'followers' | 'photos' | 'reels' | 'more';
type ComposerMediaType = 'image' | 'video';
type ComposerImageSelection = {
  file: Blob & { name?: string; type?: string };
  previewUri?: string;
  /** Clockwise rotation in degrees applied before upload (0 = no rotation). */
  rotation?: 0 | 90 | 180 | 270;
};
type ComposerVideoSelection = ComposerImageSelection;

const REPORTABLE_POST_CATEGORY_NAMES = ['spam', 'copyright', 'abuse', 'pornography'] as const;
type ReportablePostCategoryName = typeof REPORTABLE_POST_CATEGORY_NAMES[number];

function getSearchResultsStateKey(username?: string) {
  if (!username) return null;
  return `${SEARCH_RESULTS_STATE_KEY_PREFIX}:${username}`;
}

function normalizeModerationLabel(value?: string) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchesReportCategory(category: ModerationCategory, categoryName: ReportablePostCategoryName) {
  const normalizedName = normalizeModerationLabel(category.name);
  const normalizedTitle = normalizeModerationLabel(category.title);
  switch (categoryName) {
    case 'spam':
      return normalizedName.includes('spam') || normalizedTitle.includes('spam');
    case 'copyright':
      return (
        normalizedName.includes('copyright') ||
        normalizedName.includes('trademark') ||
        normalizedTitle.includes('copyright') ||
        normalizedTitle.includes('trademark')
      );
    case 'abuse':
      return normalizedName.includes('abuse') || normalizedTitle.includes('abuse');
    case 'pornography':
      return (
        normalizedName.includes('porn') ||
        normalizedName.includes('nudity') ||
        normalizedTitle.includes('porn') ||
        normalizedTitle.includes('nudity')
      );
    default:
      return false;
  }
}

export default function HomeScreen({ token, onLogout, onTokenRefresh, route, onNavigate }: HomeScreenProps) {
  const { theme, isDark, toggleTheme } = useTheme();
  const { showToast } = useAppToast();
  const { t } = useTranslation();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const gifPicker = useGifPicker();
  const c = theme.colors;
  const sideDrawerWidth = Math.min(420, viewportWidth * 0.88);

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [linkedIdentities, setLinkedIdentities] = useState<SocialIdentity[]>([]);
  const [passwordInitializedOverride, setPasswordInitializedOverride] = useState(false);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
  const [providerLoading, setProviderLoading] = useState<SocialProvider | null>(null);
  const [activeFeed, setActiveFeed] = useState<FeedType>('home');
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([]);
  const [feedPostsFeed, setFeedPostsFeed] = useState<FeedType | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState('');
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedNextMaxId, setFeedNextMaxId] = useState<number | undefined>(undefined);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [newPostsAvailable, setNewPostsAvailable] = useState(false);
  // Ref to the newest (highest) post ID currently rendered — used by the new-posts poller
  const feedNewestIdRef = useRef<number | undefined>(undefined);
  // Ref so the interval callback always sees the current feed type
  const activeFeedRef = useRef<FeedType>('home');
  const [communityRoutePosts, setCommunityRoutePosts] = useState<FeedPost[]>([]);
  const [communityRouteLoading, setCommunityRouteLoading] = useState(false);
  const [communityRouteError, setCommunityRouteError] = useState('');
  const [communityRoutePosterFilterUsername, setCommunityRoutePosterFilterUsername] = useState<string | null>(null);
  const [communityInfo, setCommunityInfo] = useState<SearchCommunityResult | null>(null);
  const [communityPinnedPosts, setCommunityPinnedPosts] = useState<FeedPost[]>([]);
  const [communityPinnedPostsLoading, setCommunityPinnedPostsLoading] = useState(false);
  const [communityInfoLoading, setCommunityInfoLoading] = useState(false);
  const [communityJoinLoading, setCommunityJoinLoading] = useState(false);
  const [communityPendingJoinRequest, setCommunityPendingJoinRequest] = useState(false);
  const [communityTimelineMuted, setCommunityTimelineMuted] = useState(false);
  const [communityMuteLoading, setCommunityMuteLoading] = useState(false);
  const [communityLeaveConfirmOpen, setCommunityLeaveConfirmOpen] = useState(false);
  const [communityNotifEnabled, setCommunityNotifEnabled] = useState<boolean | null>(null);
  const [communityNotifLoading, setCommunityNotifLoading] = useState(false);
  const [communityOwner, setCommunityOwner] = useState<CommunityOwner | null>(null);
  const [communityMembers, setCommunityMembers] = useState<CommunityMember[]>([]);
  const [communityMembersLoading, setCommunityMembersLoading] = useState(false);
  const [communityMembersLoadingMore, setCommunityMembersLoadingMore] = useState(false);
  const [communityMembersHasMore, setCommunityMembersHasMore] = useState(false);
  const [communityMembersNextMaxId, setCommunityMembersNextMaxId] = useState<number | undefined>(undefined);
  const [communityManageDrawerOpen, setCommunityManageDrawerOpen] = useState(false);
  const [communityManageTarget, setCommunityManageTarget] = useState<SearchCommunityResult | null>(null);

  // ── Edit profile drawer ───────────────────────────────────────────────────
  const [editProfileDrawerOpen, setEditProfileDrawerOpen] = useState(false);
  const [editProfileSaving, setEditProfileSaving] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editFollowersCountVisible, setEditFollowersCountVisible] = useState(true);
  const [editCommunityPostsVisible, setEditCommunityPostsVisible] = useState(true);
  const [editProfileVisibility, setEditProfileVisibility] = useState<'P' | 'O' | 'T'>('P');

  const [communityRouteRefreshKey, setCommunityRouteRefreshKey] = useState(0);
  const [manageCommunitiesRefreshKey, setManageCommunitiesRefreshKey] = useState(0);
  const [myProfilePosts, setMyProfilePosts] = useState<FeedPost[]>([]);
  const [myProfilePostsLoading, setMyProfilePostsLoading] = useState(false);
  const [myProfileComments, setMyProfileComments] = useState<ProfileCommentActivity[]>([]);
  const [myProfileCommentsLoading, setMyProfileCommentsLoading] = useState(false);
  const [myPinnedPosts, setMyPinnedPosts] = useState<FeedPost[]>([]);
  const [myPinnedPostsLoading, setMyPinnedPostsLoading] = useState(false);
  const [myJoinedCommunities, setMyJoinedCommunities] = useState<SearchCommunityResult[]>([]);
  const [myJoinedCommunitiesLoading, setMyJoinedCommunitiesLoading] = useState(false);
  const [myJoinedCommunitiesLoadingMore, setMyJoinedCommunitiesLoadingMore] = useState(false);
  const [myJoinedCommunitiesOffset, setMyJoinedCommunitiesOffset] = useState(0);
  const [myJoinedCommunitiesHasMore, setMyJoinedCommunitiesHasMore] = useState(true);
  const [myFollowings, setMyFollowings] = useState<FollowingUserResult[]>([]);
  const [myFollowingsLoading, setMyFollowingsLoading] = useState(false);
  const [myFollowingsLoadingMore, setMyFollowingsLoadingMore] = useState(false);
  const [myFollowingsMaxId, setMyFollowingsMaxId] = useState<number | undefined>(undefined);
  const [myFollowingsHasMore, setMyFollowingsHasMore] = useState(true);
  const [profileUser, setProfileUser] = useState<any>(null);
  const [profileUserLoading, setProfileUserLoading] = useState(false);
  const [profilePosts, setProfilePosts] = useState<FeedPost[]>([]);
  const [profilePostsLoading, setProfilePostsLoading] = useState(false);
  const [profileComments, setProfileComments] = useState<ProfileCommentActivity[]>([]);
  const [profileCommentsLoading, setProfileCommentsLoading] = useState(false);
  const [profilePinnedPosts, setProfilePinnedPosts] = useState<FeedPost[]>([]);
  const [profilePinnedPostsLoading, setProfilePinnedPostsLoading] = useState(false);
  const [profileJoinedCommunities, setProfileJoinedCommunities] = useState<SearchCommunityResult[]>([]);
  const [profileJoinedCommunitiesLoading, setProfileJoinedCommunitiesLoading] = useState(false);
  const [profileJoinedCommunitiesLoadingMore, setProfileJoinedCommunitiesLoadingMore] = useState(false);
  const [profileJoinedCommunitiesOffset, setProfileJoinedCommunitiesOffset] = useState(0);
  const [profileJoinedCommunitiesHasMore, setProfileJoinedCommunitiesHasMore] = useState(true);
  const [profileFollowings, setProfileFollowings] = useState<FollowingUserResult[]>([]);
  const [profileFollowingsLoading, setProfileFollowingsLoading] = useState(false);
  const [profileFollowingsLoadingMore, setProfileFollowingsLoadingMore] = useState(false);
  const [profileFollowingsMaxId, setProfileFollowingsMaxId] = useState<number | undefined>(undefined);
  const [profileFollowingsHasMore, setProfileFollowingsHasMore] = useState(true);
  const [followStateByUsername, setFollowStateByUsername] = useState<Record<string, boolean>>({});
  const [followActionLoadingByUsername, setFollowActionLoadingByUsername] = useState<Record<string, boolean>>({});
  const [userPostSubByUsername, setUserPostSubByUsername] = useState<Record<string, boolean | null>>({});
  const [userPostSubLoadingByUsername, setUserPostSubLoadingByUsername] = useState<Record<string, boolean>>({});
  // Profile actions menu
  const [userCircles, setUserCircles] = useState<CircleResult[]>([]);
  const [userLists, setUserLists] = useState<ListResult[]>([]);
  const [profileActionsLoading, setProfileActionsLoading] = useState(false);
  const [postRouteLoading, setPostRouteLoading] = useState(false);
  const [activePost, setActivePost] = useState<FeedPost | null>(null);
  const [postDetailInitialMediaTimeSec, setPostDetailInitialMediaTimeSec] = useState<number | null>(null);
  const [expandedPostIds, setExpandedPostIds] = useState<Record<number, boolean>>({});
  const [commentBoxPostIds, setCommentBoxPostIds] = useState<Record<number, boolean>>({});
  const [draftCommentMediaByPostId, setDraftCommentMediaByPostId] = useState<Record<number, CommentDraftMedia | null>>({});
  const [draftReplyMediaByCommentId, setDraftReplyMediaByCommentId] = useState<Record<number, CommentDraftMedia | null>>({});
  const [editingCommentById, setEditingCommentById] = useState<Record<number, boolean>>({});
  const [editingReplyById, setEditingReplyById] = useState<Record<number, boolean>>({});
  const [commentMutationLoadingById, setCommentMutationLoadingById] = useState<Record<number, boolean>>({});
  const [localComments, setLocalComments] = useState<Record<number, PostComment[]>>({});
  const [commentsHasMoreByPost, setCommentsHasMoreByPost] = useState<Record<number, boolean>>({});
  const [commentsMaxIdByPost, setCommentsMaxIdByPost] = useState<Record<number, number>>({});
  const [commentsLoadingMoreByPost, setCommentsLoadingMoreByPost] = useState<Record<number, boolean>>({});
  const [commentRepliesById, setCommentRepliesById] = useState<Record<number, PostComment[]>>({});
  const [commentRepliesExpanded, setCommentRepliesExpanded] = useState<Record<number, boolean>>({});
  const [commentRepliesLoadingById, setCommentRepliesLoadingById] = useState<Record<number, boolean>>({});
  const [repliesHasMoreByComment, setRepliesHasMoreByComment] = useState<Record<number, boolean>>({});
  const [repliesMaxIdByComment, setRepliesMaxIdByComment] = useState<Record<number, number>>({});
  const [repliesLoadingMoreByComment, setRepliesLoadingMoreByComment] = useState<Record<number, boolean>>({});
  const [reactionGroups, setReactionGroups] = useState<ReactionGroup[]>([]);
  const [reactionPickerPostId, setReactionPickerPostId] = useState<number | null>(null);
  const [reactionPickerLoading, setReactionPickerLoading] = useState(false);
  const [reactionActionLoading, setReactionActionLoading] = useState(false);
  const [reactionListOpen, setReactionListOpen] = useState(false);
  const [reactionListPost, setReactionListPost] = useState<FeedPost | null>(null);
  const [reactionListLoading, setReactionListLoading] = useState(false);
  const [reactionListEmoji, setReactionListEmoji] = useState<ReactionEmoji | null>(null);
  const [reactionListUsers, setReactionListUsers] = useState<PostReaction[]>([]);
  const [moderationCategories, setModerationCategories] = useState<ModerationCategory[]>([]);
  const [reportPostTarget, setReportPostTarget] = useState<FeedPost | null>(null);
  const [reportingPost, setReportingPost] = useState(false);
  type ReportTarget =
    | { kind: 'comment'; postUuid: string; commentId: number }
    | { kind: 'community'; communityName: string; displayName?: string };
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [reportingItem, setReportingItem] = useState(false);
  const [suspensionExpiry, setSuspensionExpiry] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const composerTextRef = useRef('');
  const [composerTextLength, setComposerTextLength] = useState(0);
  const composerTextLengthDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [composerLinkPreview, setComposerLinkPreview] = useState<ShortPostLinkPreview | null>(null);
  const [composerLinkPreviewLoading, setComposerLinkPreviewLoading] = useState(false);
  const [composerInputKey, setComposerInputKey] = useState(0);
  const [composerImages, setComposerImages] = useState<ComposerImageSelection[]>([]);
  const [composerVideo, setComposerVideo] = useState<ComposerVideoSelection | null>(null);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [composerStep, setComposerStep] = useState<'compose' | 'destination'>('compose');
  const [composerPostType, setComposerPostType] = useState<'P' | 'LP'>('P');
  const [composerLongPostEditorMode, setComposerLongPostEditorMode] = useState<LongPostEditorMode>('lexical');
  const [composerModalMounted, setComposerModalMounted] = useState(false);
  const [composerLongPostTitle, setComposerLongPostTitle] = useState('');
  const [composerLongPostBlocks, setComposerLongPostBlocks] = useState<LongPostBlock[]>(createInitialLongPostBlocks());
  const [composerLongPostLexicalHtml, setComposerLongPostLexicalHtml] = useState('');
  const [composerLongPostLexicalResetKey, setComposerLongPostLexicalResetKey] = useState(0);
  const [composerDraftUuid, setComposerDraftUuid] = useState<string | null>(null);
  const [composerLongPostMediaCount, setComposerLongPostMediaCount] = useState(0);
  const [composerDraftSaving, setComposerDraftSaving] = useState(false);
  const [composerDraftSavedAt, setComposerDraftSavedAt] = useState<string | null>(null);
  const [composerDraftExpiryDays, setComposerDraftExpiryDays] = useState(14);
  const [composerDraftsOpen, setComposerDraftsOpen] = useState(false);
  const [composerDraftsLoading, setComposerDraftsLoading] = useState(false);
  const [composerDrafts, setComposerDrafts] = useState<FeedPost[]>([]);
  const [composerDraftDeleteUuid, setComposerDraftDeleteUuid] = useState<string | null>(null);
  const [composerDraftDeleteConfirmUuid, setComposerDraftDeleteConfirmUuid] = useState<string | null>(null);
  const [composerSharedPost, setComposerSharedPost] = useState<FeedPost | null>(null);
  const [longPostDrawerOpen, setLongPostDrawerOpen] = useState(false);
  const [longPostDrawerExpanded, setLongPostDrawerExpanded] = useState(false);
  const [longPostEditDrawerOpen, setLongPostEditDrawerOpen] = useState(false);
  const [longPostEditDrawerExpanded, setLongPostEditDrawerExpanded] = useState(false);
  const [longPostEditTitle, setLongPostEditTitle] = useState('');
  const [longPostEditBlocks, setLongPostEditBlocks] = useState<LongPostBlock[]>([]);
  const [editingLongPost, setEditingLongPost] = useState<FeedPost | null>(null);
  const [longPostEditError, setLongPostEditError] = useState('');
  const [longPostPreviewOpen, setLongPostPreviewOpen] = useState(false);
  const [longPostPreviewPost, setLongPostPreviewPost] = useState<FeedPost | null>(null);
  const [composerSelectedCircleId, setComposerSelectedCircleId] = useState<number | null>(null);
  const [composerSelectedCommunityNames, setComposerSelectedCommunityNames] = useState<string[]>([]);
  const [composerCircles, setComposerCircles] = useState<CircleResult[]>([]);
  const [composerJoinedCommunities, setComposerJoinedCommunities] = useState<SearchCommunityResult[]>([]);
  const [composerCommunitySearch, setComposerCommunitySearch] = useState('');
  const [composerDestinationsLoading, setComposerDestinationsLoading] = useState(false);
  const [sidebarCommunities, setSidebarCommunities] = useState<SearchCommunityResult[]>([]);
  const [sidebarCircles, setSidebarCircles] = useState<CircleResult[]>([]);
  const [sidebarHashtags, setSidebarHashtags] = useState<SearchHashtagResult[]>([]);
  const [sidebarDataLoaded, setSidebarDataLoaded] = useState(false);
  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [moveCommunitiesPost, setMoveCommunitiesPost] = useState<FeedPost | null>(null);
  const [moveCommunitiesSelectedNames, setMoveCommunitiesSelectedNames] = useState<string[]>([]);
  const [moveCommunitiesJoined, setMoveCommunitiesJoined] = useState<SearchCommunityResult[]>([]);
  const [moveCommunitiesSearch, setMoveCommunitiesSearch] = useState('');
  const [moveCommunitiesLoading, setMoveCommunitiesLoading] = useState(false);
  const [moveCommunitiesSubmitting, setMoveCommunitiesSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchCurrentTextRef = useRef('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<any>(null);
  const [searchExternalResetKey, setSearchExternalResetKey] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchUsers, setSearchUsers] = useState<SearchUserResult[]>([]);
  const [searchCommunities, setSearchCommunities] = useState<SearchCommunityResult[]>([]);
  const [searchHashtags, setSearchHashtags] = useState<SearchHashtagResult[]>([]);
  const [searchResultsActive, setSearchResultsActive] = useState(false);
  const [searchResultsLoading, setSearchResultsLoading] = useState(false);
  const [searchResultsQuery, setSearchResultsQuery] = useState('');
  const [profileActiveTab, setProfileActiveTab] = useState<ProfileTabKey>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuDrawerMounted, setMenuDrawerMounted] = useState(false);
  const [autoPlayMedia, setAutoPlayMedia] = useState(false);
  const [linkedAccountsOpen, setLinkedAccountsOpen] = useState(false);
  const [blockedUsersDrawerOpen, setBlockedUsersDrawerOpen] = useState(false);
  const [linkedAccountsDrawerMounted, setLinkedAccountsDrawerMounted] = useState(false);
  const [blockedUsersDrawerMounted, setBlockedUsersDrawerMounted] = useState(false);
  const [moderationTasksOpen, setModerationTasksOpen] = useState(false);
  const [moderationTasksDrawerMounted, setModerationTasksDrawerMounted] = useState(false);
  const [moderationTasksStatus, setModerationTasksStatus] = useState<'P' | 'A' | 'R'>('P');
  const [moderationTasksItems, setModerationTasksItems] = useState<GlobalModeratedObject[]>([]);
  const [moderationTasksLoading, setModerationTasksLoading] = useState(false);
  const [moderationTasksActionLoading, setModerationTasksActionLoading] = useState<number | null>(null);
  const [moderationTasksDetailItem, setModerationTasksDetailItem] = useState<GlobalModeratedObject | null>(null);
  const [moderationTasksDetailReports, setModerationTasksDetailReports] = useState<ModeratedObjectReport[]>([]);
  const [moderationTasksDetailReportsLoading, setModerationTasksDetailReportsLoading] = useState(false);
  const [moderationPenaltiesOpen, setModerationPenaltiesOpen] = useState(false);
  const [moderationPenaltiesDrawerMounted, setModerationPenaltiesDrawerMounted] = useState(false);
  const [userPenalties, setUserPenalties] = useState<ModerationPenalty[]>([]);
  const [userPenaltiesLoading, setUserPenaltiesLoading] = useState(false);
  const [inviteDrawerOpen, setInviteDrawerOpen] = useState(false);
  const [externalLinkModalOpen, setExternalLinkModalOpen] = useState(false);
  const [pendingExternalLink, setPendingExternalLink] = useState<string | null>(null);
  const [tooltipTab, setTooltipTab] = useState<FeedType | null>(null);
  const [showWelcomeNotice, setShowWelcomeNotice] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const externalLinkResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inviteDrawerOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestSeqRef = useRef(0);
  const committedSearchRequestSeqRef = useRef(0);
  const composerLinkPreviewSeqRef = useRef(0);
  const composerLinkPreviewUrlRef = useRef<string | null>(null);
  const lastNonPostRouteRef = useRef<AppRoute>(
    route.screen === 'post' ? { screen: 'feed', feed: route.feed || 'home' } : route
  );
  const welcomeTranslateX = useRef(new Animated.Value(-380)).current;
  const composerTranslateX = useRef(new Animated.Value(0)).current;
  const composerClosingRef = useRef(false);
  const longPostAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPostInlineMediaOrderRef = useRef(1000);
  const longPostMediaSyncInFlightRef = useRef(false);
  const longPostHydratedIdsRef = useRef<Set<number>>(new Set());
  const longPostHydrationInFlightRef = useRef<Set<number>>(new Set());
  const fullPostHydratedIdsRef = useRef<Set<number>>(new Set());
  const fullPostHydrationInFlightRef = useRef<Set<number>>(new Set());
  const authFailureHandledRef = useRef(false);
  const profileUserCacheRef = useRef<Map<string, { data: any; ts: number }>>(new Map());
  const processedChangeEmailTokenRef = useRef<string | null>(null);
  const linkedAccountsDrawerTranslateX = useRef(new Animated.Value(0)).current;
  const linkedAccountsDrawerBackdropOpacity = useRef(new Animated.Value(0)).current;
  const blockedUsersDrawerTranslateX = useRef(new Animated.Value(0)).current;
  const blockedUsersDrawerBackdropOpacity = useRef(new Animated.Value(0)).current;
  const menuDrawerTranslateX = useRef(new Animated.Value(0)).current;
  const menuDrawerBackdropOpacity = useRef(new Animated.Value(0)).current;
  const moderationTasksDrawerTranslateX = useRef(new Animated.Value(0)).current;
  const moderationTasksDrawerBackdropOpacity = useRef(new Animated.Value(0)).current;
  const moderationPenaltiesDrawerTranslateX = useRef(new Animated.Value(0)).current;
  const moderationPenaltiesDrawerBackdropOpacity = useRef(new Animated.Value(0)).current;
  const moderationTasksDetailTranslateX = useRef(new Animated.Value(0)).current;
  // Whether the user has a password set at all — drives "Set password" vs "Change password" title.
  const resolvedHasUsablePassword = React.useMemo(() => {
    const usableRaw = user?.has_usable_password;
    if (typeof usableRaw === 'boolean') return usableRaw;
    if (typeof usableRaw === 'number') return usableRaw !== 0;
    if (typeof usableRaw === 'string') {
      const normalized = usableRaw.trim().toLowerCase();
      if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    }
    // Safe fallback: prefer set-password flow if unknown.
    return false;
  }, [user?.has_usable_password]);

  // Whether the change-password form must ask for the current password.
  // Social auth users don't need to supply it even if they have one set,
  // because the API deliberately omits this requirement for them.
  const effectiveRequiresCurrentPassword = React.useMemo(() => {
    const requiresRaw = user?.requires_current_password;
    if (typeof requiresRaw === 'boolean') return requiresRaw;
    if (typeof requiresRaw === 'number') return requiresRaw !== 0;
    if (typeof requiresRaw === 'string') {
      const normalized = requiresRaw.trim().toLowerCase();
      if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    }
    // passwordInitializedOverride: set when the user sets a password in this session.
    if (passwordInitializedOverride) return true;
    // Fallback: if no API signal, require it whenever they have a password and no social identity.
    return resolvedHasUsablePassword && linkedIdentities.length === 0;
  }, [user?.requires_current_password, passwordInitializedOverride, resolvedHasUsablePassword, linkedIdentities.length]);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setPasswordInitializedOverride(false);
      return;
    }
    let active = true;
    const storageKey = `@openspace/password-initialized/${userId}`;
    AsyncStorage.getItem(storageKey)
      .then((value) => {
        if (!active) return;
        setPasswordInitializedOverride(value === '1');
      })
      .catch(() => {
        if (!active) return;
        setPasswordInitializedOverride(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (token && user?.id && !sidebarDataLoaded) {
      void loadSidebarData();
    }
  }, [token, user?.id]);

  useEffect(() => {
    if (!notice) return;
    showToast(notice, { type: 'success' });
    setNotice('');
  }, [notice, showToast]);

  useEffect(() => {
    if (!error) return;
    showToast(error, { type: 'error' });
    setError('');
  }, [error, showToast]);

  useEffect(() => {
    if (!longPostEditError) return;
    showToast(longPostEditError, { type: 'error' });
    setLongPostEditError('');
  }, [longPostEditError, showToast]);

  useEffect(() => {
    authFailureHandledRef.current = false;
  }, [token]);

  function handleUnauthorized(errorValue: unknown) {
    if (!(errorValue instanceof ApiRequestError) || errorValue.status !== 401) return false;
    if (authFailureHandledRef.current) return true;
    authFailureHandledRef.current = true;
    onLogout();
    return true;
  }

  const longPostPreviewExpandState = React.useMemo(() => {
    if (!longPostPreviewPost) {
      return { canExpand: false, isExpanded: false };
    }

    const postType = (longPostPreviewPost.type || '').toUpperCase();
    const blocksFromPayload = Array.isArray(longPostPreviewPost.long_text_blocks)
      ? (longPostPreviewPost.long_text_blocks as LongPostBlock[])
      : [];
    const blocks = blocksFromPayload.length > 0
      ? blocksFromPayload
      : parseLongPostHtmlBlocksForPreview(longPostPreviewPost.long_text_rendered_html);
    const htmlLength = (longPostPreviewPost.long_text_rendered_html || '').length;
    const hasAnyLongPostContent = blocks.length > 0 || htmlLength > 0 || !!longPostPreviewPost.long_text;
    const canExpand =
      postType === 'LP'
        ? hasAnyLongPostContent
        : getPostText(longPostPreviewPost).length > 240;

    return {
      canExpand,
      isExpanded: !!expandedPostIds[longPostPreviewPost.id],
    };
  }, [expandedPostIds, getPostText, longPostPreviewPost]);

  function handleOpenInviteDrawerFromMenu() {
    setMenuOpen(false);
    if (inviteDrawerOpenTimerRef.current) {
      clearTimeout(inviteDrawerOpenTimerRef.current);
      inviteDrawerOpenTimerRef.current = null;
    }
    inviteDrawerOpenTimerRef.current = setTimeout(() => {
      setInviteDrawerOpen(true);
      inviteDrawerOpenTimerRef.current = null;
    }, 180);
  }

  async function refreshComposerLinkPreview(nextText: string) {
    const url = extractFirstUrlFromText(nextText);
    if (url && composerLinkPreviewUrlRef.current === url && (composerLinkPreview || composerLinkPreviewLoading)) {
      return;
    }
    const seq = composerLinkPreviewSeqRef.current + 1;
    composerLinkPreviewSeqRef.current = seq;
    if (!url) {
      composerLinkPreviewUrlRef.current = null;
      setComposerLinkPreview(null);
      setComposerLinkPreviewLoading(false);
      return;
    }
    composerLinkPreviewUrlRef.current = url;
    setComposerLinkPreviewLoading(true);
    try {
      const preview = await fetchShortPostLinkPreviewCached(url);
      if (composerLinkPreviewSeqRef.current !== seq) return;
      setComposerLinkPreview(preview);
    } catch {
      if (composerLinkPreviewSeqRef.current !== seq) return;
      setComposerLinkPreview({
        url,
        title: url,
      });
    } finally {
      if (composerLinkPreviewSeqRef.current === seq) {
        setComposerLinkPreviewLoading(false);
      }
    }
  }

  function handleOpenSettingsFromMenu() {
    setMenuOpen(false);
    onNavigate({ screen: 'settings' });
  }

  async function handleToggleAutoPlayMedia() {
    const next = !autoPlayMedia;
    setAutoPlayMedia(next);
    try {
      await AsyncStorage.setItem(AUTO_PLAY_MEDIA_SETTING_KEY, next ? '1' : '0');
    } catch {
      // Keep in-memory preference if persistence fails.
    }
  }

  async function handleChangePassword(currentPassword: string | null, newPassword: string) {
    const payload: { current_password?: string; new_password: string } = {
      new_password: newPassword,
    };
    if (currentPassword && currentPassword.trim()) {
      payload.current_password = currentPassword;
    }
    const response: any = await api.updateAuthenticatedUserSettings(token, payload);
    const nextToken =
      response && typeof response === 'object' && typeof response.token === 'string' && response.token.trim()
        ? response.token.trim()
        : null;
    const activeToken = nextToken || token;
    if (nextToken) {
      await onTokenRefresh?.(nextToken);
    }
    if (!currentPassword || !currentPassword.trim()) {
      const userId = user?.id;
      if (userId) {
        const storageKey = `@openspace/password-initialized/${userId}`;
        try {
          await AsyncStorage.setItem(storageKey, '1');
        } catch {
          // non-fatal local storage error
        }
      }
      setPasswordInitializedOverride(true);
    }
    const refreshedUser = await api.getAuthenticatedUser(activeToken);
    setUser(refreshedUser);
  }

  async function handleRequestEmailChange(newEmail: string, currentPassword: string) {
    await api.updateAuthenticatedUserSettings(token, {
      email: newEmail,
      current_password: currentPassword,
    });
  }

  async function handleConfirmEmailChange(tokenOrCode: string) {
    const message = await api.verifyEmailChangeToken(token, tokenOrCode);
    try {
      await AsyncStorage.removeItem(EMAIL_CHANGE_PENDING_KEY);
    } catch {
      // ignore storage cleanup errors
    }
    const refreshedUser = await api.getAuthenticatedUser(token);
    setUser(refreshedUser);
    return message;
  }

  // ── Notifications ────────────────────────────────────────────────────────────
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifLoadingMore, setNotifLoadingMore] = useState(false);
  const [notifHasMore, setNotifHasMore] = useState(false);
  const [notifNextMaxId, setNotifNextMaxId] = useState<number | undefined>(undefined);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const providerOrder: SocialProvider[] = ['google', 'apple'];
  const feedTabs: Array<{ key: FeedType; label: string; icon: string; tooltip: string }> = [
    { key: 'home', label: t('home.feedTabHome'), icon: 'home-variant', tooltip: t('home.feedTabHomeTooltip') },
    { key: 'trending', label: t('home.feedTabTrending'), icon: 'fire', tooltip: t('home.feedTabTrendingTooltip') },
    { key: 'public', label: t('home.feedTabPublic'), icon: 'earth', tooltip: t('home.feedTabPublicTooltip') },
    { key: 'explore', label: t('home.feedTabExplore'), icon: 'compass-outline', tooltip: t('home.feedTabExploreTooltip') },
  ];

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(AUTO_PLAY_MEDIA_SETTING_KEY);
        if (!active || stored === null) return;
        setAutoPlayMedia(stored === '1');
      } catch {
        // Use default if read fails.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    Promise.all([
      api.getAuthenticatedUser(token),
      api.getLinkedSocialIdentities(token),
    ])
      .then(([authenticatedUser, identities]) => {
        if (!active) return;
        setUser(authenticatedUser);
        setLinkedIdentities(identities);
      })
      .catch((errorValue) => {
        if (!active) return;
        if (handleUnauthorized(errorValue)) return;
        setFeedError(t('home.feedLoadError'));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setIdentitiesLoading(false);
      });

    // Load the feed via loadFeed so pagination state (hasMore, nextMaxId) is set correctly
    loadFeed('home').finally(() => {
      if (!active) setFeedLoading(false);
    });

    return () => {
      active = false;
    };
  }, [token]);

  // ── Notification unread-count polling ────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    function fetchUnreadCount() {
      api.getUnreadNotificationsCount(token).then((count) => {
        setUnreadCount(count);
      }).catch((errorValue) => {
        handleUnauthorized(errorValue);
      });
    }

    fetchUnreadCount();
    notifPollTimerRef.current = setInterval(fetchUnreadCount, 60_000);

    // Re-fetch immediately when tab regains visibility
    function handleVisibilityChange() {
      if (Platform.OS === 'web' && document.visibilityState === 'visible') {
        fetchUnreadCount();
      }
    }
    if (Platform.OS === 'web') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (notifPollTimerRef.current) clearInterval(notifPollTimerRef.current);
      if (Platform.OS === 'web') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [token]);

  // Keep feedNewestIdRef in sync with the highest post ID currently loaded.
  // We use the max ID across all posts (not just feedPosts[0]) because non-home
  // feeds (trending, public, explore) are sorted by score/popularity — their top
  // post is not necessarily the newest by ID. Using feedPosts[0].id on those feeds
  // caused false-positive "new posts available" banners, since posts already in the
  // list with higher IDs would be returned by the minId poll.
  useEffect(() => {
    if (feedPosts.length === 0) return;
    const maxId = feedPosts.reduce((max, p) => (p.id > max ? p.id : max), feedPosts[0].id);
    if (typeof maxId === 'number') feedNewestIdRef.current = maxId;
  }, [feedPosts]);

  // Keep activeFeedRef in sync so the poller always sees the current feed
  useEffect(() => { activeFeedRef.current = activeFeed; }, [activeFeed]);

  // Track whether the user is currently viewing the main feed (not a profile/community/etc.)
  const isOnFeedRef = useRef(true);
  useEffect(() => {
    isOnFeedRef.current = displayRoute.screen === 'feed';
  });

  // ── New-posts polling (every 5 minutes, feed view only) ───────────────────
  useEffect(() => {
    if (!token) return;
    // Reset banner whenever the active feed tab or token changes
    setNewPostsAvailable(false);
    feedNewestIdRef.current = undefined;

    const poll = async () => {
      // Only show the banner when the user is looking at the feed
      if (!isOnFeedRef.current) return;
      const newestId = feedNewestIdRef.current;
      if (typeof newestId !== 'number') return;
      try {
        const fresh = await api.getFeed(token, activeFeedRef.current, 3, undefined, newestId);
        if (fresh.length > 0) setNewPostsAvailable(true);
      } catch {
        // silently ignore — non-critical background check
      }
    };

    const timer = setInterval(poll, 5 * 60_000); // 5 minutes

    // Also check when the browser tab becomes visible again (re-focus after switching tabs)
    const onVisible = () => {
      if (Platform.OS === 'web' && document.visibilityState === 'visible') void poll();
    };
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, activeFeed]);

  useEffect(() => {
    if (menuOpen) {
      setMenuDrawerMounted(true);
      menuDrawerTranslateX.setValue(sideDrawerWidth);
      Animated.parallel([
        Animated.timing(menuDrawerTranslateX, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(menuDrawerBackdropOpacity, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(menuDrawerTranslateX, {
          toValue: sideDrawerWidth,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(menuDrawerBackdropOpacity, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start(() => setMenuDrawerMounted(false));
    }
  }, [menuOpen, menuDrawerBackdropOpacity, menuDrawerTranslateX, sideDrawerWidth]);

  useEffect(() => {
    if (linkedAccountsOpen) {
      setLinkedAccountsDrawerMounted(true);
      linkedAccountsDrawerTranslateX.setValue(sideDrawerWidth);
      Animated.parallel([
        Animated.timing(linkedAccountsDrawerTranslateX, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(linkedAccountsDrawerBackdropOpacity, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(linkedAccountsDrawerTranslateX, {
          toValue: sideDrawerWidth,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(linkedAccountsDrawerBackdropOpacity, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start(() => setLinkedAccountsDrawerMounted(false));
    }
  }, [linkedAccountsOpen, linkedAccountsDrawerBackdropOpacity, linkedAccountsDrawerTranslateX, sideDrawerWidth]);

  useEffect(() => {
    if (blockedUsersDrawerOpen) {
      setBlockedUsersDrawerMounted(true);
      blockedUsersDrawerTranslateX.setValue(sideDrawerWidth);
      Animated.parallel([
        Animated.timing(blockedUsersDrawerTranslateX, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(blockedUsersDrawerBackdropOpacity, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(blockedUsersDrawerTranslateX, {
          toValue: sideDrawerWidth,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(blockedUsersDrawerBackdropOpacity, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start(() => setBlockedUsersDrawerMounted(false));
    }
  }, [blockedUsersDrawerOpen, blockedUsersDrawerBackdropOpacity, blockedUsersDrawerTranslateX, sideDrawerWidth]);

  useEffect(() => {
    if (moderationTasksOpen) {
      setModerationTasksDrawerMounted(true);
      moderationTasksDrawerTranslateX.setValue(sideDrawerWidth);
      Animated.parallel([
        Animated.timing(moderationTasksDrawerTranslateX, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(moderationTasksDrawerBackdropOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(moderationTasksDrawerTranslateX, { toValue: sideDrawerWidth, duration: 280, useNativeDriver: true }),
        Animated.timing(moderationTasksDrawerBackdropOpacity, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start(() => setModerationTasksDrawerMounted(false));
    }
  }, [moderationTasksOpen, moderationTasksDrawerBackdropOpacity, moderationTasksDrawerTranslateX, sideDrawerWidth]);

  useEffect(() => {
    if (moderationPenaltiesOpen) {
      setModerationPenaltiesDrawerMounted(true);
      moderationPenaltiesDrawerTranslateX.setValue(sideDrawerWidth);
      Animated.parallel([
        Animated.timing(moderationPenaltiesDrawerTranslateX, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(moderationPenaltiesDrawerBackdropOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(moderationPenaltiesDrawerTranslateX, { toValue: sideDrawerWidth, duration: 280, useNativeDriver: true }),
        Animated.timing(moderationPenaltiesDrawerBackdropOpacity, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start(() => setModerationPenaltiesDrawerMounted(false));
    }
  }, [moderationPenaltiesOpen, moderationPenaltiesDrawerBackdropOpacity, moderationPenaltiesDrawerTranslateX, sideDrawerWidth]);

  useEffect(() => {
    if (moderationTasksDetailItem) {
      moderationTasksDetailTranslateX.setValue(sideDrawerWidth);
      Animated.timing(moderationTasksDetailTranslateX, { toValue: 0, duration: 260, useNativeDriver: true }).start();
    } else {
      Animated.timing(moderationTasksDetailTranslateX, { toValue: sideDrawerWidth, duration: 260, useNativeDriver: true }).start();
    }
  }, [moderationTasksDetailItem, moderationTasksDetailTranslateX, sideDrawerWidth]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search || '');
    const changeEmailToken = (params.get('change_email_token') || '').trim();
    if (!changeEmailToken) return;
    if (processedChangeEmailTokenRef.current === changeEmailToken) return;
    processedChangeEmailTokenRef.current = changeEmailToken;
    let shouldClearTokenFromUrl = true;

    const clearTokenFromUrl = () => {
      try {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete('change_email_token');
        window.history.replaceState({}, '', nextUrl.toString());
      } catch {
        // ignore URL mutation errors
      }
    };

    api.verifyEmailChangeToken(token, changeEmailToken)
      .then(async (message) => {
        try {
          await AsyncStorage.removeItem(EMAIL_CHANGE_PENDING_KEY);
        } catch {
          // ignore storage cleanup errors
        }
        setNotice(message || t('settings.emailChangeConfirmed', { defaultValue: 'Email changed successfully.' }));
        try {
          const refreshedUser = await api.getAuthenticatedUser(token);
          setUser(refreshedUser);
        } catch {
          // best effort refresh
        }
      })
      .catch((errorValue: any) => {
        if (handleUnauthorized(errorValue)) {
          shouldClearTokenFromUrl = false;
          processedChangeEmailTokenRef.current = null;
          return;
        }
        setError(errorValue?.message || t('settings.emailChangeConfirmError', { defaultValue: 'Could not confirm email change.' }));
      })
      .finally(() => {
        if (shouldClearTokenFromUrl) {
          clearTokenFromUrl();
        }
      });
  }, [token, t]);

  useEffect(() => {
    if (!user?.username) return;
    let active = true;
    setMyProfilePostsLoading(true);
    setMyProfileCommentsLoading(true);
    setMyPinnedPostsLoading(true);
    Promise.allSettled([
      api.getUserPosts(token, user.username, 10),
      api.getUserComments(token, user.username, 10),
      api.getPinnedPosts(token, user.username, 10),
    ])
      .then(([postsResult, commentsResult, pinnedResult]) => {
        if (!active) return;
        const posts = postsResult.status === 'fulfilled' ? postsResult.value : [];
        const comments = commentsResult.status === 'fulfilled' ? commentsResult.value : [];
        const pinned = pinnedResult.status === 'fulfilled' ? pinnedResult.value : [];
        const safePosts = Array.isArray(posts) ? posts : [];
        const safeComments = Array.isArray(comments) ? comments : [];
        const safePinned = Array.isArray(pinned) ? pinned : [];
        setMyProfilePosts(safePosts);
        setMyProfileComments(safeComments);
        setMyPinnedPosts(safePinned);
        void hydrateLongPostsForRichRendering(safePosts).then((hydrated) => {
          if (!active) return;
          setMyProfilePosts(hydrated);
        });
        void hydrateLongPostsForRichRendering(safePinned).then((hydrated) => {
          if (!active) return;
          setMyPinnedPosts(hydrated);
        });
      })
      .finally(() => {
        if (!active) return;
        setMyProfilePostsLoading(false);
        setMyProfileCommentsLoading(false);
        setMyPinnedPostsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, user?.username]);

  async function loadMyFollowingsPage(maxId?: number) {
    const followings = await api.getFollowings(token, PROFILE_FOLLOWINGS_PAGE_SIZE, maxId);
    const safeFollowings = Array.isArray(followings) ? followings : [];
    const hasMore = safeFollowings.length === PROFILE_FOLLOWINGS_PAGE_SIZE;
    return { followings: safeFollowings, hasMore };
  }

  useEffect(() => {
    if (!user?.username) return;
    let active = true;
    setMyFollowingsLoading(true);
    setMyFollowingsMaxId(undefined);
    setMyFollowingsHasMore(true);

    loadMyFollowingsPage(undefined)
      .then(({ followings, hasMore }) => {
        if (!active) return;
        setMyFollowings(followings);
        const lastId = followings.length ? followings[followings.length - 1]?.id : undefined;
        setMyFollowingsMaxId(typeof lastId === 'number' ? lastId : undefined);
        setMyFollowingsHasMore(hasMore);
      })
      .catch(() => {
        if (!active) return;
        setMyFollowings([]);
        setMyFollowingsMaxId(undefined);
        setMyFollowingsHasMore(false);
      })
      .finally(() => {
        if (!active) return;
        setMyFollowingsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, user?.username]);

  async function loadMoreMyFollowings() {
    if (myFollowingsLoading || myFollowingsLoadingMore || !myFollowingsHasMore) return;
    setMyFollowingsLoadingMore(true);
    try {
      const { followings, hasMore } = await loadMyFollowingsPage(myFollowingsMaxId);
      setMyFollowings((prev) => {
        const existingIds = new Set(prev.map((f) => f.id));
        const deduped = followings.filter((f) => !existingIds.has(f.id));
        return [...prev, ...deduped];
      });
      const lastId = followings.length ? followings[followings.length - 1]?.id : undefined;
      setMyFollowingsMaxId(typeof lastId === 'number' ? lastId : myFollowingsMaxId);
      setMyFollowingsHasMore(hasMore);
    } catch {
      setMyFollowingsHasMore(false);
    } finally {
      setMyFollowingsLoadingMore(false);
    }
  }

  async function loadMyJoinedCommunitiesPage(offset = 0) {
    const communities = await api.getJoinedCommunities(token, PROFILE_COMMUNITIES_PAGE_SIZE, offset);
    const safeCommunities = Array.isArray(communities) ? communities : [];
    const hasMore = safeCommunities.length === PROFILE_COMMUNITIES_PAGE_SIZE;
    return { communities: safeCommunities, hasMore };
  }

  useEffect(() => {
    if (!user?.username) return;
    let active = true;
    setMyJoinedCommunitiesLoading(true);
    setMyJoinedCommunitiesOffset(0);
    setMyJoinedCommunitiesHasMore(true);

    loadMyJoinedCommunitiesPage(0)
      .then(({ communities, hasMore }) => {
        if (!active) return;
        setMyJoinedCommunities(communities);
        setMyJoinedCommunitiesOffset(communities.length);
        setMyJoinedCommunitiesHasMore(hasMore);
      })
      .catch(() => {
        if (!active) return;
        setMyJoinedCommunities([]);
        setMyJoinedCommunitiesOffset(0);
        setMyJoinedCommunitiesHasMore(false);
      })
      .finally(() => {
        if (!active) return;
        setMyJoinedCommunitiesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, user?.username]);

  async function loadMoreMyJoinedCommunities() {
    if (myJoinedCommunitiesLoading || myJoinedCommunitiesLoadingMore || !myJoinedCommunitiesHasMore) return;
    setMyJoinedCommunitiesLoadingMore(true);
    try {
      const { communities, hasMore } = await loadMyJoinedCommunitiesPage(myJoinedCommunitiesOffset);
      setMyJoinedCommunities((prev) => {
        const existingIds = new Set(prev.map((community) => community.id));
        const deduped = communities.filter((community) => !existingIds.has(community.id));
        return [...prev, ...deduped];
      });
      setMyJoinedCommunitiesOffset((prev) => prev + communities.length);
      setMyJoinedCommunitiesHasMore(hasMore);
    } catch {
      setMyJoinedCommunitiesHasMore(false);
    } finally {
      setMyJoinedCommunitiesLoadingMore(false);
    }
  }

  async function loadProfileFollowingsPage(username: string, maxId?: number) {
    const followings = await api.getFollowings(token, PROFILE_FOLLOWINGS_PAGE_SIZE, maxId, username);
    const safeFollowings = Array.isArray(followings) ? followings : [];
    const hasMore = safeFollowings.length === PROFILE_FOLLOWINGS_PAGE_SIZE;
    return { followings: safeFollowings, hasMore };
  }

  async function loadProfileJoinedCommunitiesPage(username: string, offset = 0) {
    const communities = await api.getUserCommunities(token, username);
    const safeCommunities = Array.isArray(communities) ? communities : [];
    const hasMore = false;
    return { communities: safeCommunities, hasMore };
  }

  useEffect(() => {
    if (route.screen !== 'profile' || !route.username) return;
    let active = true;
    const username = route.username;

    // --- Stage 0: instantly seed header from 30-second in-memory cache ---
    const cached = profileUserCacheRef.current.get(username);
    if (cached && Date.now() - cached.ts < 30_000) {
      setProfileUser(cached.data);
      setProfileUserLoading(false);
    } else {
      setProfileUserLoading(true);
    }

    setProfilePostsLoading(true);
    setProfileCommentsLoading(true);
    setProfilePinnedPostsLoading(true);
    setProfileJoinedCommunitiesLoading(true);
    setProfileFollowingsLoading(true);
    setProfileJoinedCommunitiesOffset(0);
    setProfileFollowingsMaxId(undefined);
    setProfileJoinedCommunitiesHasMore(true);
    setProfileFollowingsHasMore(true);

    // --- Stage 1 (critical path): user + posts — renders the profile immediately ---
    Promise.allSettled([
      api.getUserByUsername(token, username),
      api.getUserPosts(token, username, 10),
    ])
      .then(([userResult, postsResult]) => {
        if (!active) return;
        const nextUser: any = userResult.status === 'fulfilled' ? userResult.value : null;
        const nextPosts = postsResult.status === 'fulfilled' ? postsResult.value : [];
        const safeProfilePosts = Array.isArray(nextPosts) ? nextPosts : [];

        // Update and store in cache so the next visit is instant
        if (nextUser) {
          profileUserCacheRef.current.set(username, { data: nextUser, ts: Date.now() });
        }
        setProfileUser(nextUser);
        // Seed follow state from the profile object
        if (nextUser?.username && typeof nextUser?.is_following === 'boolean') {
          setFollowStateByUsername((prev) => ({ ...prev, [nextUser.username]: nextUser.is_following }));
        }
        setProfilePosts(safeProfilePosts);
        setProfileUserLoading(false);
        setProfilePostsLoading(false);

        // Defer long-post hydration so the profile UI paints before extra requests fire
        setTimeout(() => {
          void hydrateLongPostsForRichRendering(safeProfilePosts).then((hydrated) => {
            if (!active) return;
            setProfilePosts(hydrated);
          });
        }, 0);
      })
      .catch(() => {
        if (!active) return;
        setProfileUser(null);
        setProfilePosts([]);
        setProfileUserLoading(false);
        setProfilePostsLoading(false);
      });

    // --- Stage 2 (background): everything else loads while user already sees the profile ---
    Promise.allSettled([
      api.getUserComments(token, username, 10),
      api.getPinnedPosts(token, username, 10),
      loadProfileJoinedCommunitiesPage(username, 0),
      loadProfileFollowingsPage(username),
      userCircles.length === 0 ? api.getCircles(token) : Promise.resolve(userCircles),
      userLists.length === 0   ? api.getLists(token)   : Promise.resolve(userLists),
    ])
      .then(([
        commentsResult,
        pinnedResult,
        communitiesResult,
        followingsResult,
        circlesResult,
        listsResult,
      ]) => {
        if (!active) return;
        const nextComments = commentsResult.status === 'fulfilled' ? commentsResult.value : [];
        const nextPinned = pinnedResult.status === 'fulfilled' ? pinnedResult.value : [];
        const nextCommunities = communitiesResult.status === 'fulfilled' ? communitiesResult.value : { communities: [], hasMore: false };
        const nextFollowings = followingsResult.status === 'fulfilled' ? followingsResult.value : { followings: [], hasMore: false };

        if (circlesResult.status === 'fulfilled' && Array.isArray(circlesResult.value)) {
          setUserCircles(circlesResult.value);
        }
        if (listsResult.status === 'fulfilled' && Array.isArray(listsResult.value)) {
          setUserLists(listsResult.value);
        }

        const safeProfileComments = Array.isArray(nextComments) ? nextComments : [];
        const safeProfilePinned = Array.isArray(nextPinned) ? nextPinned : [];
        setProfileComments(safeProfileComments);
        setProfilePinnedPosts(safeProfilePinned);
        setProfileJoinedCommunities(Array.isArray(nextCommunities.communities) ? nextCommunities.communities : []);
        setProfileJoinedCommunitiesOffset(Array.isArray(nextCommunities.communities) ? nextCommunities.communities.length : 0);
        setProfileJoinedCommunitiesHasMore(!!nextCommunities.hasMore);
        setProfileFollowings(Array.isArray(nextFollowings.followings) ? nextFollowings.followings : []);
        const lastFollowingId = Array.isArray(nextFollowings.followings) && nextFollowings.followings.length
          ? nextFollowings.followings[nextFollowings.followings.length - 1]?.id
          : undefined;
        setProfileFollowingsMaxId(typeof lastFollowingId === 'number' ? lastFollowingId : undefined);
        setProfileFollowingsHasMore(!!nextFollowings.hasMore);

        // Defer pinned-post hydration too
        setTimeout(() => {
          void hydrateLongPostsForRichRendering(safeProfilePinned).then((hydrated) => {
            if (!active) return;
            setProfilePinnedPosts(hydrated);
          });
        }, 0);
      })
      .catch(() => {
        if (!active) return;
        setProfileComments([]);
        setProfilePinnedPosts([]);
        setProfileJoinedCommunities([]);
        setProfileFollowings([]);
        setProfileJoinedCommunitiesHasMore(false);
        setProfileFollowingsHasMore(false);
      })
      .finally(() => {
        if (!active) return;
        setProfileCommentsLoading(false);
        setProfilePinnedPostsLoading(false);
        setProfileJoinedCommunitiesLoading(false);
        setProfileFollowingsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [route, token]);

  async function loadMoreProfileFollowings() {
    if (route.screen !== 'profile' || !route.username) return;
    if (profileFollowingsLoading || profileFollowingsLoadingMore || !profileFollowingsHasMore) return;
    setProfileFollowingsLoadingMore(true);
    try {
      const { followings, hasMore } = await loadProfileFollowingsPage(route.username, profileFollowingsMaxId);
      setProfileFollowings((prev) => {
        const existingIds = new Set(prev.map((f) => f.id));
        const deduped = followings.filter((f) => !existingIds.has(f.id));
        return [...prev, ...deduped];
      });
      const lastId = followings.length ? followings[followings.length - 1]?.id : undefined;
      setProfileFollowingsMaxId(typeof lastId === 'number' ? lastId : profileFollowingsMaxId);
      setProfileFollowingsHasMore(hasMore);
    } catch {
      setProfileFollowingsHasMore(false);
    } finally {
      setProfileFollowingsLoadingMore(false);
    }
  }

  async function loadMoreProfileJoinedCommunities() {
    if (route.screen !== 'profile' || !route.username) return;
    if (profileJoinedCommunitiesLoading || profileJoinedCommunitiesLoadingMore || !profileJoinedCommunitiesHasMore) return;
    setProfileJoinedCommunitiesLoadingMore(true);
    try {
      const { communities, hasMore } = await loadProfileJoinedCommunitiesPage(route.username, profileJoinedCommunitiesOffset);
      setProfileJoinedCommunities((prev) => {
        const existingIds = new Set(prev.map((community) => community.id));
        const deduped = communities.filter((community) => !existingIds.has(community.id));
        return [...prev, ...deduped];
      });
      setProfileJoinedCommunitiesOffset((prev) => prev + communities.length);
      setProfileJoinedCommunitiesHasMore(hasMore);
    } catch {
      setProfileJoinedCommunitiesHasMore(false);
    } finally {
      setProfileJoinedCommunitiesLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!user?.username) return;
    let cancelled = false;

    async function restoreCommittedSearchState() {
      const key = getSearchResultsStateKey(user.username);
      if (!key) return;

      try {
        const raw = await AsyncStorage.getItem(key);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as { query?: string };
        const persistedQuery = (parsed?.query || '').trim();
        if (persistedQuery.length < 2) return;

        searchCurrentTextRef.current = persistedQuery;
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        setSearchQuery(persistedQuery);
        setSearchExternalResetKey((prev) => prev + 1);
        setSearchResultsActive(true);
        setSearchResultsQuery(persistedQuery);
        await loadSearchResults(persistedQuery, 20, setSearchResultsLoading, committedSearchRequestSeqRef);
      } catch {
        // ignore storage parse/read issues
      }
    }

    restoreCommittedSearchState();

    return () => {
      cancelled = true;
    };
  }, [user?.username]);

  useEffect(() => {
    let active = true;

    api.getModerationCategories(token)
      .then((categories) => {
        if (!active) return;
        setModerationCategories(categories || []);
      })
      .catch((errorValue) => {
        if (!active) return;
        if (handleUnauthorized(errorValue)) return;
        setModerationCategories([]);
      });

    api.getUserModerationPenalties(token)
      .then((penalties) => {
        if (!active) return;
        const now = new Date();
        const active_penalty = (penalties || []).find(
          (p) => p.expiration && new Date(p.expiration) > now
        );
        setSuspensionExpiry(active_penalty?.expiration ?? null);
      })
      .catch(() => {
        if (!active) return;
        setSuspensionExpiry(null);
      });

    return () => {
      active = false;
    };
  }, [token]);

  async function loadSearchResults(
    query: string,
    count: number,
    loadingSetter?: (value: boolean) => void,
    requestSeqRef: React.MutableRefObject<number> = searchRequestSeqRef
  ) {
    const requestSeq = ++requestSeqRef.current;
    if (loadingSetter) loadingSetter(true);
    setSearchError('');

    try {
      const [usersResult, communitiesResult, hashtagsResult] = await Promise.allSettled([
        api.searchUsers(token, query, Math.min(count, 10)),
        api.searchCommunities(token, query, count),
        api.searchHashtags(token, query, Math.min(count, 10)),
      ]);

      if (requestSeq !== requestSeqRef.current) return;

      const users = usersResult.status === 'fulfilled' ? usersResult.value : [];
      const communities = communitiesResult.status === 'fulfilled' ? communitiesResult.value : [];
      const hashtags = hashtagsResult.status === 'fulfilled' ? hashtagsResult.value : [];

      setSearchUsers(users);
      setSearchCommunities(communities);
      setSearchHashtags(hashtags);

      if (
        usersResult.status === 'rejected' &&
        communitiesResult.status === 'rejected' &&
        hashtagsResult.status === 'rejected'
      ) {
        setSearchError(t('home.searchLoadError'));
      } else {
        setSearchError('');
      }
    } finally {
      if (requestSeq === requestSeqRef.current && loadingSetter) {
        loadingSetter(false);
      }
    }
  }

  useEffect(() => {
    const query = searchQuery.trim();

    if (query.length < 2) {
      setSearchLoading(false);
      setSearchError('');
      if (!searchResultsActive) {
        setSearchUsers([]);
        setSearchCommunities([]);
        setSearchHashtags([]);
      }
      return;
    }

    const timer = setTimeout(() => {
      loadSearchResults(query, 8, setSearchLoading, searchRequestSeqRef);
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery, t, token, searchResultsActive]);

  useEffect(() => (
    () => {
      if (searchBlurTimerRef.current) {
        clearTimeout(searchBlurTimerRef.current);
        searchBlurTimerRef.current = null;
      }
    }
  ), []);

  useEffect(() => {
    if (route.screen !== 'post') {
      lastNonPostRouteRef.current = route;
    }

    if (route.screen === 'feed') {
      const targetFeed = route.feed;
      if (targetFeed !== activeFeed) {
        setActiveFeed(targetFeed);
      }
      if (feedPostsFeed !== targetFeed && !feedLoading) {
        loadFeed(targetFeed);
      }
      setActivePost(null);
      return;
    }

    if (route.screen === 'search') {
      const routedQuery = (route.query || '').trim();
      if (routedQuery.length >= 2) {
        searchCurrentTextRef.current = routedQuery;
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        setSearchExternalResetKey((prev) => prev + 1);
        setSearchQuery(routedQuery);
        setSearchResultsActive(true);
        setSearchResultsQuery(routedQuery);
        loadSearchResults(routedQuery, 20, setSearchResultsLoading, committedSearchRequestSeqRef);
      }
      setActivePost(null);
      return;
    }

    if (route.screen === 'post') {
      if (activeFeed !== route.feed && route.feed) {
        setActiveFeed(route.feed);
      }
      const postInCurrentContext =
        feedPosts.find((post) => post.uuid === route.postUuid) ||
        communityRoutePosts.find((post) => post.uuid === route.postUuid) ||
        myProfilePosts.find((post) => post.uuid === route.postUuid) ||
        profilePosts.find((post) => post.uuid === route.postUuid) ||
        null;
      if (postInCurrentContext) {
        setActivePost(postInCurrentContext);
        void loadCommentsForPost(postInCurrentContext);
      }
      return;
    }

    setActivePost(null);
  }, [route, activeFeed, feedLoading, feedPostsFeed, feedPosts, communityRoutePosts, myProfilePosts, profilePosts]);

  useEffect(() => {
    const routePostUuid = route.screen === 'post' ? route.postUuid : null;
    if (!routePostUuid) return;

    const routedPostInMemory =
      feedPosts.find((post) => post.uuid === routePostUuid) ||
      communityRoutePosts.find((post) => post.uuid === routePostUuid) ||
      myProfilePosts.find((post) => post.uuid === routePostUuid) ||
      profilePosts.find((post) => post.uuid === routePostUuid) ||
      null;

    if (routedPostInMemory) {
      if (activePost?.uuid !== routedPostInMemory.uuid) {
        setActivePost(routedPostInMemory);
      }
      void loadCommentsForPost(routedPostInMemory);
      setPostRouteLoading(false);
      return;
    }

    if (activePost?.uuid === routePostUuid) return;
    let cancelled = false;

    async function fetchRoutedPost() {
      setPostRouteLoading(true);
      try {
        const fetchedPost = await api.getPostByUuid(token, routePostUuid!);
        if (cancelled) return;
        setActivePost(fetchedPost);
        void loadCommentsForPost(fetchedPost);
      } catch {
        if (cancelled) return;
        setError(t('home.feedLoadError'));
      } finally {
        if (!cancelled) setPostRouteLoading(false);
      }
    }

    fetchRoutedPost();
    return () => {
      cancelled = true;
    };
  }, [route, token, activePost?.uuid, feedPosts, communityRoutePosts, myProfilePosts, profilePosts]);

  // Match the server's own page size — the existing site uses count=10
  const FEED_PAGE_SIZE = 10;

  // silent=true skips the full-screen spinner (used by pull-to-refresh)
  async function loadFeed(feed: FeedType, silent = false) {
    if (!silent) setFeedLoading(true);
    setFeedError('');
    setFeedNextMaxId(undefined);
    setFeedHasMore(false);
    setNewPostsAvailable(false);
    try {
      const nextPosts = await api.getFeed(token, feed, FEED_PAGE_SIZE);
      setFeedPosts(nextPosts);
      setFeedPostsFeed(feed);
      if (nextPosts.length > 0) {
        // Optimistically assume more pages exist whenever any posts come back.
        // The true end is confirmed only when a subsequent page returns empty.
        const lastId = nextPosts[nextPosts.length - 1]?.id;
        setFeedHasMore(true);
        setFeedNextMaxId(typeof lastId === 'number' ? lastId : undefined);
      }
    } catch (e: any) {
      if (handleUnauthorized(e)) return;
      setFeedPosts([]);
      setFeedPostsFeed(feed);
      setFeedError(e.message || t('home.feedLoadError'));
    } finally {
      if (!silent) setFeedLoading(false);
    }
  }

  // Pull-to-refresh / banner tap: reload without full-screen spinner, scroll to top
  async function handleRefreshFeed() {
    if (feedRefreshing) return;
    setFeedRefreshing(true);
    await loadFeed(activeFeed, true);
    setFeedRefreshing(false);
    try { mainScrollRef.current?.scrollTo?.({ y: 0, animated: true }); } catch {}
  }

  async function loadMoreFeed() {
    if (feedLoadingMore || !feedHasMore || feedNextMaxId === undefined) return;
    setFeedLoadingMore(true);
    try {
      const morePosts = await api.getFeed(token, activeFeed, FEED_PAGE_SIZE, feedNextMaxId);
      if (morePosts.length > 0) {
        setFeedPosts((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          return [...prev, ...morePosts.filter((p) => !existingIds.has(p.id))];
        });
        const lastId = morePosts[morePosts.length - 1]?.id;
        setFeedNextMaxId(typeof lastId === 'number' ? lastId : undefined);
        setFeedHasMore(true);
      } else {
        // Empty page = genuinely reached the end
        setFeedHasMore(false);
        setFeedNextMaxId(undefined);
      }
    } catch (errorValue) {
      if (handleUnauthorized(errorValue)) return;
      // silently fail — user can keep scrolling to retry
    } finally {
      setFeedLoadingMore(false);
    }
  }

  // Ref to the root ScrollView so we can attach a DOM scroll listener on web
  const mainScrollRef = useRef<any>(null);

  useEffect(() => {
    // Web-only: native has a window shim but no addEventListener/DOM scroll.
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    // On web, React Native Web renders ScrollView as a plain div.
    // Grab the underlying DOM node and listen directly on it.
    const node = mainScrollRef.current;
    const scrollTarget: EventTarget | null =
      node && typeof node.getScrollableNode === 'function'
        ? node.getScrollableNode()
        : node?._nativeTag
          ? null
          : (node as HTMLElement | null);

    const target = scrollTarget ?? window;
    if (typeof (target as any).addEventListener !== 'function') return;

    const handleScroll = () => {
      let scrollTop: number;
      let distFromBottom: number;
      if (target === window) {
        scrollTop = window.scrollY || document.documentElement.scrollTop;
        distFromBottom = document.documentElement.scrollHeight - scrollTop - window.innerHeight;
      } else {
        const el = target as HTMLElement;
        scrollTop = el.scrollTop;
        distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      }
      topBarScrollHandlerRef.current(scrollTop);
      if (distFromBottom < 600) {
        void loadMoreFeed();
      }
    };

    target.addEventListener('scroll', handleScroll as EventListener, { passive: true } as AddEventListenerOptions);
    return () => target.removeEventListener('scroll', handleScroll as EventListener);
  }, [feedHasMore, feedLoadingMore, feedLoading, feedNextMaxId, activeFeed]);

  useEffect(() => {
    const isCommunityRoute = route.screen === 'community';
    const routeCommunityName = isCommunityRoute ? route.name : '';

    if (!isCommunityRoute || !routeCommunityName) {
      setCommunityRoutePosts([]);
      setCommunityRouteError('');
      setCommunityRouteLoading(false);
      setCommunityRoutePosterFilterUsername(null);
      setCommunityInfo(null);
      setCommunityPendingJoinRequest(false);
      setCommunityTimelineMuted(false);
      setCommunityMuteLoading(false);
      setCommunityNotifEnabled(null);
      setCommunityOwner(null);
      setCommunityMembers([]);
      setCommunityMembersHasMore(false);
      setCommunityMembersNextMaxId(undefined);
      setCommunityMembersLoadingMore(false);
      return;
    }

    let cancelled = false;

    async function loadCommunityRoute() {
      setCommunityRouteLoading(true);
      setCommunityInfoLoading(true);
      setCommunityMembersLoading(true);
      setCommunityRouteError('');
      try {
        const [posts, info, owner, members, pinnedPosts] = await Promise.all([
          api.getCommunityPosts(token, routeCommunityName, 20),
          api.getCommunity(token, routeCommunityName).catch(() => null),
          api.getCommunityOwner(token, routeCommunityName).catch(() => null),
          api.getCommunityMembers(token, routeCommunityName, 9).catch(() => []),
          api.getCommunityPinnedPosts(token, routeCommunityName).catch(() => []),
        ]);
        if (!cancelled) {
          const safePosts = Array.isArray(posts) ? posts : [];
          const safeMembers = Array.isArray(members) ? (members as CommunityMember[]) : [];
          setCommunityRoutePosts(safePosts);
          setCommunityPinnedPosts(Array.isArray(pinnedPosts) ? pinnedPosts : []);
          setCommunityInfo(info);
          setCommunityPendingJoinRequest(!!info?.is_pending_join_request);
          setCommunityTimelineMuted(!!info?.is_timeline_muted);
          setCommunityNotifEnabled(typeof info?.are_new_post_notifications_enabled === 'boolean' ? info.are_new_post_notifications_enabled : null);
          setCommunityOwner(owner);
          setCommunityMembers(safeMembers);
          setCommunityMembersHasMore(safeMembers.length === 9);
          const lastMemberId = safeMembers.length ? safeMembers[safeMembers.length - 1]?.id : undefined;
          setCommunityMembersNextMaxId(typeof lastMemberId === 'number' ? lastMemberId : undefined);
          void hydratePostsByIdForConsistentRendering(safePosts).then((hydrated) => {
            if (cancelled) return;
            setCommunityRoutePosts(hydrated);
          });
        }
      } catch (e: any) {
        if (!cancelled) {
          setCommunityRoutePosts([]);
          setCommunityRouteError(e?.message || t('home.feedLoadError'));
        }
      } finally {
        if (!cancelled) {
          setCommunityRouteLoading(false);
          setCommunityInfoLoading(false);
          setCommunityMembersLoading(false);
        }
      }
    }

    setCommunityInfo(null);
    setCommunityPinnedPosts([]);
    setCommunityNotifEnabled(null);
    setCommunityOwner(null);
    setCommunityMembers([]);
    setCommunityRoutePosterFilterUsername(null);
    setCommunityMembersHasMore(false);
    setCommunityMembersNextMaxId(undefined);
    setCommunityMembersLoadingMore(false);
    void loadCommunityRoute();
    return () => {
      cancelled = true;
    };
  }, [route, token, t, communityRouteRefreshKey]);

  function refreshCommunityRouteData() {
    setCommunityRouteRefreshKey((prev) => prev + 1);
  }

  function filterCommunityPostsByUser(username: string, communityName: string) {
    const normalizedUsername = (username || '').trim();
    const activeCommunityName = route.screen === 'community' ? route.name : '';
    if (!normalizedUsername || !activeCommunityName) return;
    if (communityName && communityName !== activeCommunityName) return;
    setCommunityRoutePosterFilterUsername(normalizedUsername);
    setNotice(
      t('home.communityPostsFilteredByUserNotice', {
        username: normalizedUsername,
        community: activeCommunityName,
        defaultValue: `Showing posts in c/${activeCommunityName} by @${normalizedUsername}.`,
      })
    );
  }

  const filteredCommunityRoutePosts = React.useMemo(() => {
    if (!communityRoutePosterFilterUsername) return communityRoutePosts;
    const target = communityRoutePosterFilterUsername.toLowerCase();
    return communityRoutePosts.filter((post) => (post.creator?.username || '').toLowerCase() === target);
  }, [communityRoutePosts, communityRoutePosterFilterUsername]);

  function refreshManageCommunitiesRouteData() {
    setManageCommunitiesRefreshKey((prev) => prev + 1);
  }

  async function openCommunityManagerByName(name: string) {
    const normalized = (name || '').trim();
    if (!normalized) return;
    try {
      const fullCommunity = await api.getCommunity(token, normalized);
      setCommunityManageTarget(fullCommunity);
      setCommunityManageDrawerOpen(true);
    } catch (e: any) {
      setError(e?.message || t('community.manageListLoadError', { defaultValue: 'Unable to load manageable communities right now.' }));
    }
  }

  async function handleJoinCommunity() {
    const name = route.screen === 'community' ? route.name : '';
    if (!name || communityJoinLoading) return;
    setCommunityJoinLoading(true);
    try {
      const result = await api.joinCommunity(token, name);
      if (result && result.status === 'pending') {
        // Restricted community — join request submitted, awaiting approval.
        setCommunityPendingJoinRequest(true);
        setCommunityInfo((prev) => prev ? { ...prev, is_pending_join_request: true } : prev);
        setNotice(t('home.communityJoinRequestSent', {
          defaultValue: 'Your request to join c/{{name}} has been sent. An admin will review it shortly.',
          name,
        }));
      } else {
        setCommunityInfo((prev) => prev ? {
          ...prev,
          members_count: (prev.members_count ?? 0) + 1,
          memberships: [...(prev.memberships ?? []), { user_id: -1 }],
        } : prev);
      }
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
    } finally {
      setCommunityJoinLoading(false);
    }
  }

  async function handleLeaveCommunity() {
    const name = route.screen === 'community' ? route.name : '';
    if (!name || communityJoinLoading) return;
    setCommunityJoinLoading(true);
    try {
      const response = await api.leaveCommunity(token, name);
      setCommunityInfo((prev) => prev ? {
        ...prev,
        members_count: Math.max(0, (prev.members_count ?? 1) - 1),
        memberships: [],
      } : prev);
      const removedPostsCount = Number(response?.removed_posts_count || 0);
      if (removedPostsCount > 0) {
        setNotice(
          t('community.leaveDeletedContributionsNotice', {
            defaultValue:
              'You left c/{{name}}. {{count}} of your post contribution(s) were permanently removed from this community.',
            name,
            count: removedPostsCount,
          })
        );
      } else {
        setNotice(
          t('community.leaveSuccessNotice', {
            defaultValue: 'You left c/{{name}}.',
            name,
          })
        );
      }
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
    } finally {
      setCommunityJoinLoading(false);
      setCommunityLeaveConfirmOpen(false);
    }
  }

  function requestLeaveCommunity() {
    const name = route.screen === 'community' ? route.name : '';
    if (!name || communityJoinLoading) return;
    setCommunityLeaveConfirmOpen(true);
  }

  async function handleToggleCommunityNotifications() {
    const name = route.screen === 'community' ? route.name : '';
    if (!name || communityNotifLoading) return;
    setCommunityNotifLoading(true);
    try {
      const wasEnabled = communityNotifEnabled === true;
      const result = wasEnabled
        ? await api.unsubscribeFromCommunityNotifications(token, name)
        : await api.subscribeToCommunityNotifications(token, name);
      setCommunityNotifEnabled(result.are_new_post_notifications_enabled);
      if (!wasEnabled) {
        setNotice(t('community.notificationsEnabledNotice', {
          defaultValue: 'You will start to receive Notifications of new posts from this Community',
        }));
      }
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
    } finally {
      setCommunityNotifLoading(false);
    }
  }

  async function handleMuteCommunityTimeline(durationDays: number | null) {
    const name = route.screen === 'community' ? route.name : '';
    if (!name || communityMuteLoading) return;
    setCommunityMuteLoading(true);
    try {
      await api.muteCommunityTimeline(token, name, durationDays);
      setCommunityTimelineMuted(true);
      setCommunityInfo((prev) => prev ? { ...prev, is_timeline_muted: true } : prev);
      const muteLabel = durationDays
        ? t('community.feedMuted30DaysNotice', { defaultValue: 'Community muted for 30 days.' })
        : t('community.feedMutedIndefiniteNotice', { defaultValue: 'Community muted indefinitely.' });
      setNotice(muteLabel);
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
    } finally {
      setCommunityMuteLoading(false);
    }
  }

  async function handleUnmuteCommunityTimeline() {
    const name = route.screen === 'community' ? route.name : '';
    if (!name || communityMuteLoading) return;
    setCommunityMuteLoading(true);
    try {
      await api.unmuteCommunityTimeline(token, name);
      setCommunityTimelineMuted(false);
      setCommunityInfo((prev) => prev ? { ...prev, is_timeline_muted: false } : prev);
      setNotice(t('community.feedUnmutedNotice', { defaultValue: 'Community unmuted. Posts will appear in your feed again.' }));
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
    } finally {
      setCommunityMuteLoading(false);
    }
  }

  async function loadMoreCommunityMembers() {
    const communityName = displayRoute.screen === 'community' ? (displayRoute.name || '').trim() : '';
    if (!communityName || communityMembersLoading || communityMembersLoadingMore || !communityMembersHasMore) return;

    setCommunityMembersLoadingMore(true);
    try {
      const rows = await api.getCommunityMembers(token, communityName, 9, communityMembersNextMaxId);
      const safeRows = Array.isArray(rows) ? rows : [];
      setCommunityMembers((prev) => {
        const seen = new Set(
          prev
            .map((member) => (typeof member.id === 'number' ? `id:${member.id}` : member.username ? `u:${member.username}` : ''))
            .filter(Boolean)
        );
        const deduped = safeRows.filter((member) => {
          const key = typeof member.id === 'number' ? `id:${member.id}` : member.username ? `u:${member.username}` : '';
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return [...prev, ...deduped];
      });
      setCommunityMembersHasMore(safeRows.length === 9);
      const lastId = safeRows.length ? safeRows[safeRows.length - 1]?.id : undefined;
      setCommunityMembersNextMaxId((prev) => (typeof lastId === 'number' ? lastId : prev));
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
      setCommunityMembersHasMore(false);
    } finally {
      setCommunityMembersLoadingMore(false);
    }
  }

  useEffect(() => {
    setFollowStateByUsername((prev) => {
      const next = { ...prev };
      for (const post of [...feedPosts, ...communityRoutePosts]) {
        const username = post.creator?.username;
        if (!username || username in next) continue;
        if (typeof post.creator?.is_following === 'boolean') {
          next[username] = post.creator.is_following;
        }
      }
      return next;
    });
  }, [feedPosts, communityRoutePosts]);

  async function handleToggleFollow(username: string, currentlyFollowing: boolean) {
    if (!username || followActionLoadingByUsername[username]) return;

    setFollowActionLoadingByUsername((prev) => ({ ...prev, [username]: true }));
    try {
      if (currentlyFollowing) {
        await api.unfollowUser(token, username);
      } else {
        await api.followUser(token, username);
      }

      setFollowStateByUsername((prev) => ({ ...prev, [username]: !currentlyFollowing }));
      setFeedPosts((prev) =>
        prev.map((post) => {
          if (post.creator?.username !== username) return post;
          return {
            ...post,
            creator: {
              ...post.creator,
              is_following: !currentlyFollowing,
            },
          };
        })
      );
      setCommunityRoutePosts((prev) =>
        prev.map((post) => {
          if (post.creator?.username !== username) return post;
          return {
            ...post,
            creator: {
              ...post.creator,
              is_following: !currentlyFollowing,
            },
          };
        })
      );
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
    } finally {
      setFollowActionLoadingByUsername((prev) => ({ ...prev, [username]: false }));
    }
  }

  async function handleToggleUserPostSubscription(username: string) {
    if (!username || userPostSubLoadingByUsername[username]) return;
    setUserPostSubLoadingByUsername((prev) => ({ ...prev, [username]: true }));
    const currentlySubscribed = userPostSubByUsername[username] === true;
    try {
      if (currentlySubscribed) {
        await api.unsubscribeFromUserNewPostNotifications(token, username);
        setUserPostSubByUsername((prev) => ({ ...prev, [username]: false }));
      } else {
        await api.subscribeToUserNewPostNotifications(token, username);
        setUserPostSubByUsername((prev) => ({ ...prev, [username]: true }));
        setNotice(t('profile.subscribedToPostsNotice', {
          defaultValue: 'You will be notified when this person publishes a new post.',
        }));
      }
    } catch (e: any) {
      // If subscribe failed because already subscribed, resolve state to true
      const msg: string = e?.message || '';
      if (!currentlySubscribed && msg) {
        setUserPostSubByUsername((prev) => ({ ...prev, [username]: true }));
      } else {
        setError(msg || t('home.feedLoadError'));
      }
    } finally {
      setUserPostSubLoadingByUsername((prev) => ({ ...prev, [username]: false }));
    }
  }

  async function handleSelectFeed(feed: FeedType) {
    if (feed === activeFeed && route.screen === 'feed') return;
    closeSearchDropdown();
    if (user?.username) {
      const key = getSearchResultsStateKey(user.username);
      if (key) await AsyncStorage.removeItem(key);
    }
    setSearchResultsActive(false);
    setSearchResultsLoading(false);
    setSearchResultsQuery('');
    setActiveFeed(feed);
    onNavigate({ screen: 'feed', feed });
  }

  function toPlainText(value?: string) {
    if (!value) return '';
    return value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function blocksToPlainText(value?: unknown[]) {
    if (!Array.isArray(value)) return '';
    return value
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        const typed = block as { text?: unknown; caption?: unknown; url?: unknown };
        const parts = [
          typeof typed.text === 'string' ? typed.text : '',
          typeof typed.caption === 'string' ? typed.caption : '',
          typeof typed.url === 'string' ? typed.url : '',
        ].filter(Boolean);
        return parts.join(' ').trim();
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  function postHasMedia(post?: FeedPost | null) {
    if (!post) return false;
    if (post.media_thumbnail) return true;
    if (!Array.isArray(post.media) || post.media.length === 0) return false;
    return post.media.some((item) => !!item?.thumbnail || !!item?.image || !!item?.file);
  }

  function getPostText(post: FeedPost) {
    const type = (post.type || '').toUpperCase();
    if (type === 'LP') {
      const blocksText = blocksToPlainText(post.long_text_blocks);
      if (blocksText) return toPlainText(blocksText);
      const renderedHtmlText = toPlainText(post.long_text_rendered_html);
      if (renderedHtmlText) return renderedHtmlText;
      const longText = toPlainText(post.long_text);
      if (longText) return longText;
      return toPlainText(post.text);
    }
    const shortText = toPlainText(post.text);
    if (shortText) return shortText;
    return toPlainText(post.long_text);
  }

  function getPostLengthType(post: FeedPost): 'long' | 'short' {
    const type = (post.type || '').toUpperCase();
    if (type === 'LP') return 'long';
    if (type === 'P') return 'short';
    return getPostText(post).length > 280 ? 'long' : 'short';
  }

  function shouldHydrateLongPost(post: FeedPost) {
    const type = (post.type || '').toUpperCase();
    if (type !== 'LP' || typeof post.id !== 'number') return false;
    const hasBlocks = Array.isArray(post.long_text_blocks) && post.long_text_blocks.length > 0;
    const hasRenderedHtml = typeof post.long_text_rendered_html === 'string' && !!post.long_text_rendered_html.trim();
    return !hasBlocks && !hasRenderedHtml;
  }

  async function hydrateLongPostsForRichRendering(posts: FeedPost[]) {
    if (!Array.isArray(posts) || posts.length === 0) return posts;
    const candidates = posts.filter((post) => {
      if (!shouldHydrateLongPost(post)) return false;
      if (longPostHydratedIdsRef.current.has(post.id)) return false;
      if (longPostHydrationInFlightRef.current.has(post.id)) return false;
      return true;
    });
    if (candidates.length === 0) return posts;

    const limitedCandidates = candidates.slice(0, 8);
    limitedCandidates.forEach((post) => longPostHydrationInFlightRef.current.add(post.id));

    const hydratedPairs = await Promise.all(
      limitedCandidates.map(async (post) => {
        try {
          const full = await api.getPostByUuid(token, post.uuid!);
          const hasBlocks = Array.isArray(full.long_text_blocks) && full.long_text_blocks.length > 0;
          const hasRenderedHtml = typeof full.long_text_rendered_html === 'string' && !!full.long_text_rendered_html.trim();
          if (hasBlocks || hasRenderedHtml) {
            longPostHydratedIdsRef.current.add(post.id);
            return [post.id, full] as const;
          }
          return [post.id, null] as const;
        } catch {
          return [post.id, null] as const;
        } finally {
          longPostHydrationInFlightRef.current.delete(post.id);
        }
      })
    );

    const hydratedById = new Map<number, FeedPost>();
    hydratedPairs.forEach(([id, full]) => {
      if (full) hydratedById.set(id, full);
    });
    if (hydratedById.size === 0) return posts;

    return posts.map((post) => hydratedById.get(post.id) || post);
  }

  async function hydratePostsByIdForConsistentRendering(posts: FeedPost[]) {
    if (!Array.isArray(posts) || posts.length === 0) return posts;

    const candidates = posts.filter((post) => {
      if (typeof post.id !== 'number') return false;
      if (fullPostHydratedIdsRef.current.has(post.id)) return false;
      if (fullPostHydrationInFlightRef.current.has(post.id)) return false;
      return true;
    });
    if (candidates.length === 0) return posts;

    const limitedCandidates = candidates.slice(0, 20);
    limitedCandidates.forEach((post) => fullPostHydrationInFlightRef.current.add(post.id));

    const hydratedPairs = await Promise.all(
      limitedCandidates.map(async (post) => {
        try {
          const full = await api.getPostByUuid(token, post.uuid!);
          fullPostHydratedIdsRef.current.add(post.id);
          return [post.id, full] as const;
        } catch {
          return [post.id, null] as const;
        } finally {
          fullPostHydrationInFlightRef.current.delete(post.id);
        }
      })
    );

    const hydratedById = new Map<number, FeedPost>();
    hydratedPairs.forEach(([id, full]) => {
      if (full) hydratedById.set(id, full);
    });
    if (hydratedById.size === 0) return posts;

    return posts.map((post) => hydratedById.get(post.id) || post);
  }

  function getPostReactionCount(post: FeedPost) {
    return (post.reactions_emoji_counts || []).reduce((sum, item) => sum + (item?.count || 0), 0);
  }

  function getPostCommentsCount(post: FeedPost) {
    const loadedComments = localComments[post.id];
    if (loadedComments) {
      return Math.max(post.comments_count || 0, loadedComments.length);
    }
    return post.comments_count || 0;
  }

  function getSourcePost(postId: number) {
    return (
      feedPosts.find((post) => post.id === postId) ||
      communityRoutePosts.find((post) => post.id === postId) ||
      myProfilePosts.find((post) => post.id === postId) ||
      profilePosts.find((post) => post.id === postId) ||
      (activePost?.id === postId ? activePost : null)
    );
  }

  function toggleExpand(postId: number) {
    setExpandedPostIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
  }

  async function loadCommentsForPost(post: FeedPost) {
    if (!post.uuid) return;
    try {
      const comments = await api.getPostComments(token, post.uuid, 20);
      setLocalComments((prev) => ({ ...prev, [post.id]: comments }));
      const maxId = comments.length > 0 ? Math.max(...comments.map((c) => c.id)) : 0;
      setCommentsMaxIdByPost((prev) => ({ ...prev, [post.id]: maxId }));
      setCommentsHasMoreByPost((prev) => ({ ...prev, [post.id]: comments.length >= 20 }));
    } catch {
      // Do not block the post UI if comment loading fails.
    }
  }

  async function loadMoreCommentsForPost(post: FeedPost) {
    if (!post.uuid) return;
    const minId = commentsMaxIdByPost[post.id];
    if (!minId) return;
    setCommentsLoadingMoreByPost((prev) => ({ ...prev, [post.id]: true }));
    try {
      const more = await api.getPostComments(token, post.uuid, 20, minId);
      setLocalComments((prev) => ({ ...prev, [post.id]: [...(prev[post.id] || []), ...more] }));
      const newMaxId = more.length > 0 ? Math.max(...more.map((c) => c.id)) : minId;
      setCommentsMaxIdByPost((prev) => ({ ...prev, [post.id]: newMaxId }));
      setCommentsHasMoreByPost((prev) => ({ ...prev, [post.id]: more.length >= 20 }));
    } catch {
      // ignore
    } finally {
      setCommentsLoadingMoreByPost((prev) => ({ ...prev, [post.id]: false }));
    }
  }

  function toggleCommentBox(postId: number) {
    const isOpening = !commentBoxPostIds[postId];
    setCommentBoxPostIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
    if (isOpening) {
      const sourcePost = getSourcePost(postId);
      if (sourcePost) void loadCommentsForPost(sourcePost);
    }
  }


  function clearDraftCommentMedia(postId: number) {
    setDraftCommentMediaByPostId((prev) => ({ ...prev, [postId]: null }));
  }

  function clearDraftReplyMedia(commentId: number) {
    setDraftReplyMediaByCommentId((prev) => ({ ...prev, [commentId]: null }));
  }

  async function setDraftCommentGif(postId: number) {
    // Same Giphy picker the native app uses — provider is mounted at app
    // root so it works for both web (RN-Web) and native callers.
    const url = await gifPicker.open();
    if (!url || !/^https?:\/\//i.test(url)) return;
    setDraftCommentMediaByPostId((prev) => ({
      ...prev,
      [postId]: { kind: 'gif', uri: url },
    }));
  }

  async function setDraftReplyGif(commentId: number) {
    const url = await gifPicker.open();
    if (!url || !/^https?:\/\//i.test(url)) return;
    setDraftReplyMediaByCommentId((prev) => ({
      ...prev,
      [commentId]: { kind: 'gif', uri: url },
    }));
  }

  function pickDraftCommentImage(postId: number) {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setError(t('home.mediaUploadUnsupported', { defaultValue: 'Media upload is currently available on web only.' }));
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const preview = URL.createObjectURL(file);
      setDraftCommentMediaByPostId((prev) => ({
        ...prev,
        [postId]: {
          kind: 'image',
          file,
          uri: preview,
          name: file.name || 'comment-image.jpg',
        },
      }));
    };
    input.click();
  }

  function pickDraftReplyImage(commentId: number) {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setError(t('home.mediaUploadUnsupported', { defaultValue: 'Media upload is currently available on web only.' }));
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const preview = URL.createObjectURL(file);
      setDraftReplyMediaByCommentId((prev) => ({
        ...prev,
        [commentId]: {
          kind: 'image',
          file,
          uri: preview,
          name: file.name || 'reply-image.jpg',
        },
      }));
    };
    input.click();
  }

  async function submitComment(postId: number, text: string) {
    const nextValue = text.trim();
    const media = draftCommentMediaByPostId[postId] || null;
    if (!nextValue && !media) return;
    const sourcePost = getSourcePost(postId);
    if (!sourcePost?.uuid) {
      setError(t('home.feedLoadError'));
      return;
    }

    try {
      const createdComment = await api.createPostComment(token, sourcePost.uuid, {
        text: nextValue,
        image: media?.kind === 'image' ? (media.file || null) : null,
        gif_url: media?.kind === 'gif' ? media.uri : undefined,
      });
      setLocalComments((prev) => ({
        ...prev,
        [postId]: [createdComment, ...(prev[postId] || [])],
      }));
      clearDraftCommentMedia(postId);
      applyPostPatch(postId, (post) => ({
        ...post,
        comments_count: (post.comments_count || 0) + 1,
      }));
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
    }
  }

  async function loadRepliesForComment(postUuid: string, commentId: number) {
    setCommentRepliesLoadingById((prev) => ({ ...prev, [commentId]: true }));
    try {
      const replies = await api.getPostCommentReplies(token, postUuid, commentId, 20);
      setCommentRepliesById((prev) => ({ ...prev, [commentId]: replies }));
      const maxId = replies.length > 0 ? Math.max(...replies.map((r) => r.id)) : 0;
      setRepliesMaxIdByComment((prev) => ({ ...prev, [commentId]: maxId }));
      setRepliesHasMoreByComment((prev) => ({ ...prev, [commentId]: replies.length >= 20 }));
    } catch {
      setCommentRepliesById((prev) => ({ ...prev, [commentId]: [] }));
    } finally {
      setCommentRepliesLoadingById((prev) => ({ ...prev, [commentId]: false }));
    }
  }

  async function loadMoreRepliesForComment(postUuid: string, commentId: number) {
    const minId = repliesMaxIdByComment[commentId];
    if (!minId) return;
    setRepliesLoadingMoreByComment((prev) => ({ ...prev, [commentId]: true }));
    try {
      const more = await api.getPostCommentReplies(token, postUuid, commentId, 20, minId);
      setCommentRepliesById((prev) => ({ ...prev, [commentId]: [...(prev[commentId] || []), ...more] }));
      const newMaxId = more.length > 0 ? Math.max(...more.map((r) => r.id)) : minId;
      setRepliesMaxIdByComment((prev) => ({ ...prev, [commentId]: newMaxId }));
      setRepliesHasMoreByComment((prev) => ({ ...prev, [commentId]: more.length >= 20 }));
    } catch {
      // ignore
    } finally {
      setRepliesLoadingMoreByComment((prev) => ({ ...prev, [commentId]: false }));
    }
  }

  function toggleCommentReplies(postId: number, commentId: number) {
    const isOpening = !commentRepliesExpanded[commentId];
    setCommentRepliesExpanded((prev) => ({ ...prev, [commentId]: !prev[commentId] }));
    if (!isOpening) return;

    const sourcePost = getSourcePost(postId);
    if (!sourcePost?.uuid) return;
    if (commentRepliesById[commentId]) return;
    void loadRepliesForComment(sourcePost.uuid, commentId);
  }

  async function submitReply(postId: number, commentId: number, text: string) {
    const sourcePost = getSourcePost(postId);
    const nextValue = text.trim();
    const media = draftReplyMediaByCommentId[commentId] || null;
    if (!sourcePost?.uuid || (!nextValue && !media)) return;

    try {
      const createdReply = await api.createPostCommentReply(token, sourcePost.uuid, commentId, {
        text: nextValue,
        image: media?.kind === 'image' ? (media.file || null) : null,
        gif_url: media?.kind === 'gif' ? media.uri : undefined,
      });
      setCommentRepliesById((prev) => ({
        ...prev,
        [commentId]: [createdReply, ...(prev[commentId] || [])],
      }));
      setCommentRepliesExpanded((prev) => ({ ...prev, [commentId]: true }));
      clearDraftReplyMedia(commentId);
      setLocalComments((prev) => ({
        ...prev,
        [postId]: (prev[postId] || []).map((comment) =>
          comment.id === commentId
            ? { ...comment, replies_count: (comment.replies_count || 0) + 1 }
            : comment
        ),
      }));
    } catch (e: any) {
      setError(e?.message || t('home.replyLoadFailed'));
    }
  }

  function startEditingComment(commentId: number, _currentText: string, isReply: boolean) {
    if (isReply) {
      setEditingReplyById((prev) => ({ ...prev, [commentId]: true }));
      return;
    }
    setEditingCommentById((prev) => ({ ...prev, [commentId]: true }));
  }

  function cancelEditingComment(commentId: number, isReply: boolean) {
    if (isReply) {
      setEditingReplyById((prev) => ({ ...prev, [commentId]: false }));
      return;
    }
    setEditingCommentById((prev) => ({ ...prev, [commentId]: false }));
  }

  async function saveEditedComment(postId: number, commentId: number, isReply: boolean, text: string, parentCommentId?: number) {
    const sourcePost = getSourcePost(postId);
    const nextValue = text.trim();
    if (!sourcePost?.uuid || !nextValue) return;

    setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: true }));
    try {
      const updated = await api.updatePostComment(token, sourcePost.uuid, commentId, nextValue);
      if (isReply && parentCommentId) {
        setCommentRepliesById((prev) => ({
          ...prev,
          [parentCommentId]: (prev[parentCommentId] || []).map((reply) =>
            reply.id === commentId ? { ...reply, ...updated, text: updated.text || nextValue } : reply
          ),
        }));
        setEditingReplyById((prev) => ({ ...prev, [commentId]: false }));
      } else {
        setLocalComments((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).map((comment) =>
            comment.id === commentId ? { ...comment, ...updated, text: updated.text || nextValue } : comment
          ),
        }));
        setEditingCommentById((prev) => ({ ...prev, [commentId]: false }));
      }
    } catch (e: any) {
      setError(e?.message || t('home.commentEditFailed'));
    } finally {
      setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: false }));
    }
  }

  async function deleteComment(postId: number, commentId: number, isReply: boolean, parentCommentId?: number) {
    const sourcePost = getSourcePost(postId);
    if (!sourcePost?.uuid) return;

    setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: true }));
    try {
      await api.deletePostComment(token, sourcePost.uuid, commentId);
      if (isReply && parentCommentId) {
        setCommentRepliesById((prev) => ({
          ...prev,
          [parentCommentId]: (prev[parentCommentId] || []).filter((reply) => reply.id !== commentId),
        }));
        setLocalComments((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).map((comment) =>
            comment.id === parentCommentId
              ? { ...comment, replies_count: Math.max((comment.replies_count || 1) - 1, 0) }
              : comment
          ),
        }));
      } else {
        setLocalComments((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).filter((comment) => comment.id !== commentId),
        }));
        applyPostPatch(postId, (post) => ({
          ...post,
          comments_count: Math.max((post.comments_count || 1) - 1, 0),
        }));
        setCommentRepliesById((prev) => {
          const next = { ...prev };
          delete next[commentId];
          return next;
        });
      }
      setNotice(t('home.commentDeleteSuccess'));
    } catch (e: any) {
      setError(e?.message || t('home.commentDeleteFailed'));
    } finally {
      setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: false }));
    }
  }

  function clearWebFocus() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const activeEl = document.activeElement as HTMLElement | null;
    activeEl?.blur?.();
  }

  function openPostDetail(post: FeedPost, options?: { resumeTimeSec?: number }) {
    clearWebFocus();
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const playingVideos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
      playingVideos.forEach((video) => {
        try {
          video.pause();
        } catch {
          // Ignore browser/runtime pause edge cases.
        }
      });
    }
    setPostDetailInitialMediaTimeSec(
      typeof options?.resumeTimeSec === 'number' && Number.isFinite(options.resumeTimeSec)
        ? options.resumeTimeSec
        : null
    );
    setActivePost(post);
    void loadCommentsForPost(post);
    onNavigate({ screen: 'post', postUuid: post.uuid || String(post.id), feed: activeFeed });
  }

  function closePostDetail() {
    clearWebFocus();
    setPostDetailInitialMediaTimeSec(null);
    setActivePost(null);
    const returnRoute = lastNonPostRouteRef.current;
    onNavigate(returnRoute, true);
  }

  function applyPostPatch(postId: number, patch: (post: FeedPost) => FeedPost) {
    setFeedPosts((prev) => prev.map((post) => (post.id === postId ? patch(post) : post)));
    setCommunityRoutePosts((prev) => prev.map((post) => (post.id === postId ? patch(post) : post)));
    setMyProfilePosts((prev) => prev.map((post) => (post.id === postId ? patch(post) : post)));
    setMyPinnedPosts((prev) => prev.map((post) => (post.id === postId ? patch(post) : post)));
    setProfilePosts((prev) => prev.map((post) => (post.id === postId ? patch(post) : post)));
    setProfilePinnedPosts((prev) => prev.map((post) => (post.id === postId ? patch(post) : post)));
    setActivePost((prev) => (prev && prev.id === postId ? patch(prev) : prev));
  }

  function openLongPostEdit(post: FeedPost) {
    const sourceBlocks = Array.isArray(post.long_text_blocks) ? post.long_text_blocks : [];
    const blocks: LongPostBlock[] = sourceBlocks.map((b, idx) => {
      const block = b as Record<string, unknown>;
      return {
        id: `edit-${idx}-${Date.now()}`,
        type: (block.type as LongPostBlock['type']) || 'paragraph',
        text: typeof block.text === 'string' ? block.text : undefined,
        level: typeof block.level === 'number' ? (block.level as 1 | 2 | 3) : undefined,
        url: typeof block.url === 'string' ? block.url : undefined,
        caption: typeof block.caption === 'string' ? block.caption : undefined,
      };
    });
    const fallbackBlocks = blocks.length > 0
      ? blocks
      : (post.long_text
        ? [{ id: `edit-legacy-${Date.now()}`, type: 'paragraph' as const, text: post.long_text }]
        : createInitialLongPostBlocks());
    const normalized = splitLongPostTitleFromBlocks(fallbackBlocks);
    setEditingLongPost(post);
    setLongPostEditTitle(normalized.title);
    setLongPostEditBlocks(normalized.blocks);
    setLongPostEditError('');
    setLongPostEditDrawerOpen(true);
  }

  async function saveLongPostEdit() {
    if (!editingLongPost?.uuid) return;
    try {
      const composedBlocks = composeLongPostBlocksWithTitle(longPostEditTitle, longPostEditBlocks);
      const plainText = extractPlainTextFromBlocks(composedBlocks);
      const updated = await api.updatePostContent(token, editingLongPost.uuid, {
        long_text_blocks: composedBlocks,
        long_text: plainText.length >= 500 ? plainText : undefined,
        long_text_rendered_html: buildLongPostHtmlFromBlocks(composedBlocks),
      });
      const returnedBlocks = Array.isArray(updated?.long_text_blocks) && (updated.long_text_blocks as unknown[]).length > 0
        ? (updated.long_text_blocks as LongPostBlock[])
        : composedBlocks;
      const normalizedReturned = splitLongPostTitleFromBlocks(returnedBlocks);
      applyPostPatch(editingLongPost.id, (current) => ({
        ...current,
        type: 'LP',
        long_text_blocks: composeLongPostBlocksWithTitle(normalizedReturned.title, normalizedReturned.blocks),
        long_text: updated?.long_text ?? current.long_text,
        long_text_rendered_html: updated?.long_text_rendered_html ?? current.long_text_rendered_html,
      }));
      setLongPostEditDrawerOpen(false);
      setEditingLongPost(null);
      setLongPostEditTitle('');
      setNotice(t('home.postEditSuccess'));
    } catch (e: any) {
      console.error('[saveLongPostEdit] 400 response body:', e?.data);
      setLongPostEditError(e?.message || t('home.postEditFailed'));
    }
  }

  async function editPost(post: FeedPost, text: string) {
    if (!post.uuid) {
      setError(t('home.postEditUnavailable'));
      return;
    }
    try {
      const updated = await api.updatePost(token, post.uuid, text);
      const nextText = updated?.text ?? text;
      applyPostPatch(post.id, (current) => ({ ...current, text: nextText }));
      setNotice(t('home.postEditSuccess'));
    } catch (e: any) {
      setError(e?.message || t('home.postEditFailed'));
      throw e;
    }
  }

  async function deletePost(post: FeedPost) {
    if (!post.uuid) {
      setError(t('home.postDeleteUnavailable'));
      return;
    }
    try {
      await api.deletePost(token, post.uuid);
      setFeedPosts((prev) => prev.filter((item) => item.id !== post.id));
      setCommunityRoutePosts((prev) => prev.filter((item) => item.id !== post.id));
      setMyProfilePosts((prev) => prev.filter((item) => item.id !== post.id));
      setMyPinnedPosts((prev) => prev.filter((item) => item.id !== post.id));
      setActivePost((prev) => (prev?.id === post.id ? null : prev));
      setNotice(t('home.postDeleteSuccess'));
    } catch (e: any) {
      setError(e?.message || t('home.postDeleteFailed'));
      throw e;
    }
  }

  async function handleMovePostCommunities(post: FeedPost) {
    // Seed selection from post's current communities
    const current = Array.isArray(post.shared_community_names) && post.shared_community_names.length > 0
      ? post.shared_community_names
      : (post.community?.name ? [post.community.name] : []);
    setMoveCommunitiesSelectedNames(current);
    setMoveCommunitiesSearch('');
    setMoveCommunitiesPost(post);
    setMoveCommunitiesLoading(true);
    try {
      const firstPage = await api.getJoinedCommunities(token, 20, 0);
      const all: SearchCommunityResult[] = Array.isArray(firstPage) ? [...firstPage] : [];
      let offset = all.length;
      while (all.length > 0 && all.length % 20 === 0) {
        const next = await api.getJoinedCommunities(token, 20, offset);
        if (!Array.isArray(next) || next.length === 0) break;
        all.push(...next);
        offset += next.length;
        if (next.length < 20) break;
      }
      setMoveCommunitiesJoined(all.filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i));
    } catch {
      setMoveCommunitiesJoined([]);
    } finally {
      setMoveCommunitiesLoading(false);
    }
  }

  async function submitMovePostCommunities() {
    if (!moveCommunitiesPost?.uuid || moveCommunitiesSubmitting) return;
    if (moveCommunitiesSelectedNames.length === 0) {
      setError(t('home.movePostCommunitiesNoneError', { defaultValue: 'Select at least one community.' }));
      return;
    }
    setMoveCommunitiesSubmitting(true);
    try {
      const updated = await api.updatePostTargets(token, moveCommunitiesPost.uuid, {
        community_names: moveCommunitiesSelectedNames,
      });
      applyPostPatch(moveCommunitiesPost.id, (current) => ({
        ...current,
        community: updated?.community ?? current.community,
        shared_community_names: moveCommunitiesSelectedNames,
        shared_communities_count: moveCommunitiesSelectedNames.length,
      }));
      setMoveCommunitiesPost(null);
      setNotice(t('home.movePostCommunitiesSuccess', { defaultValue: 'Communities updated.' }));
    } catch (e: any) {
      setError(e?.message || t('home.movePostCommunitiesFailed', { defaultValue: 'Could not update communities.' }));
    } finally {
      setMoveCommunitiesSubmitting(false);
    }
  }

  async function togglePinPost(post: FeedPost) {
    if (!post.uuid) {
      setError(t('home.postPinUnavailable'));
      return;
    }
    try {
      const currentlyPinned = !!post.is_pinned;
      const updated = currentlyPinned
        ? await api.unpinPost(token, post.uuid)
        : await api.pinPost(token, post.uuid);

      const nextPinned =
        typeof updated?.is_pinned === 'boolean' ? updated.is_pinned : !currentlyPinned;
      const nextPinnedAt =
        typeof updated?.pinned_at === 'string'
          ? updated.pinned_at
          : (nextPinned ? new Date().toISOString() : undefined);

      applyPostPatch(post.id, (current) => ({
        ...current,
        is_pinned: nextPinned,
        pinned_at: nextPinnedAt,
      }));

      setMyPinnedPosts((prev) => {
        const existing = prev.find((item) => item.id === post.id);
        const without = prev.filter((item) => item.id !== post.id);
        if (!nextPinned) return without;
        const source = existing || post;
        return [{ ...source, is_pinned: true, pinned_at: nextPinnedAt }, ...without];
      });

      setNotice(nextPinned ? t('home.postPinnedSuccess') : t('home.postUnpinnedSuccess'));
    } catch (e: any) {
      setError(e?.message || t('home.postPinFailed'));
      throw e;
    }
  }

  async function toggleCommunityPinPost(post: FeedPost) {
    if (!post.uuid || !communityInfo?.name) {
      setError(t('home.postPinUnavailable', { defaultValue: 'Unable to pin this post.' }));
      return;
    }
    const communityName = communityInfo.name;
    try {
      const currentlyPinned = !!post.is_community_pinned;
      const updated = currentlyPinned
        ? await api.unpinCommunityPost(token, communityName, post.uuid)
        : await api.pinCommunityPost(token, communityName, post.uuid);

      const nextPinned =
        typeof updated?.is_community_pinned === 'boolean' ? updated.is_community_pinned : !currentlyPinned;

      // Patch the post in all feed lists so the badge updates immediately
      applyPostPatch(post.id, (current) => ({
        ...current,
        is_community_pinned: nextPinned,
      }));

      // Update the community pinned posts sidebar list
      setCommunityPinnedPosts((prev) => {
        const without = prev.filter((item) => item.id !== post.id);
        if (!nextPinned) return without;
        return [{ ...post, is_community_pinned: true }, ...without];
      });

      setNotice(
        nextPinned
          ? t('home.communityPostPinnedSuccess', { defaultValue: 'Post pinned to community.' })
          : t('home.communityPostUnpinnedSuccess', { defaultValue: 'Post unpinned from community.' }),
      );
    } catch (e: any) {
      setError(e?.message || t('home.postPinFailed', { defaultValue: 'Failed to update pin.' }));
      throw e;
    }
  }

  async function toggleClosePost(post: FeedPost) {
    if (!post.uuid) {
      setError(t('home.postCloseUnavailable', { defaultValue: 'Unable to lock this post.' }));
      return;
    }
    try {
      const currentlyClosed = !!post.is_closed;
      const updated = currentlyClosed
        ? await api.openPost(token, post.uuid)
        : await api.closePost(token, post.uuid);

      const nextClosed =
        typeof updated?.is_closed === 'boolean' ? updated.is_closed : !currentlyClosed;

      applyPostPatch(post.id, (current) => ({
        ...current,
        is_closed: nextClosed,
      }));

      setNotice(
        nextClosed
          ? t('home.postLockedSuccess', { defaultValue: 'Post locked. Comments are disabled.' })
          : t('home.postUnlockedSuccess', { defaultValue: 'Post unlocked. Comments are enabled.' }),
      );
    } catch (e: any) {
      setError(e?.message || t('home.postCloseFailed', { defaultValue: 'Failed to update post lock.' }));
      throw e;
    }
  }

  function openEditProfileDrawer() {
    const vis = user?.visibility === 'O' || user?.visibility === 'T' || user?.visibility === 'P'
      ? user.visibility as 'P' | 'O' | 'T'
      : 'P';
    setEditUsername(user?.username || '');
    setEditName(user?.profile?.name || '');
    setEditLocation(user?.profile?.location || '');
    setEditBio(user?.profile?.bio || '');
    setEditUrl(user?.profile?.url || '');
    setEditFollowersCountVisible(
      user?.followers_count_visible === false ? false : true
    );
    setEditCommunityPostsVisible(
      user?.community_posts_visible === false ? false : true
    );
    setEditProfileVisibility(vis);
    setEditProfileDrawerOpen(true);
  }

  async function submitEditProfile() {
    if (editProfileSaving) return;
    setEditProfileSaving(true);
    try {
      await updateMyProfile({
        username: editUsername.trim() || undefined,
        name: editName.trim() || undefined,
        location: editLocation.trim() || undefined,
        bio: editBio.trim() || undefined,
        url: editUrl.trim() || undefined,
        followers_count_visible: !!editFollowersCountVisible,
        community_posts_visible: !!editCommunityPostsVisible,
        visibility: editProfileVisibility,
      });
      setEditProfileDrawerOpen(false);
    } finally {
      setEditProfileSaving(false);
    }
  }

  async function updateMyProfile(payload: UpdateAuthenticatedUserPayload) {
    const profilePayload = {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.location !== undefined ? { location: payload.location } : {}),
      ...(payload.bio !== undefined ? { bio: payload.bio } : {}),
      ...(payload.url !== undefined ? { url: payload.url } : {}),
    };

    try {
      const updatedUser = await api.updateAuthenticatedUser(token, payload);
      if (updatedUser && typeof updatedUser === 'object') {
        const nextUser = updatedUser as any;
        setUser((prev: any) => ({
          ...(prev || {}),
          ...(payload || {}),
          ...nextUser,
          profile: {
            ...(prev?.profile || {}),
            ...profilePayload,
            ...(nextUser?.profile || {}),
          },
        }));
      } else {
        setUser((prev: any) => ({
          ...(prev || {}),
          ...(payload || {}),
          profile: {
            ...(prev?.profile || {}),
            ...profilePayload,
          },
        }));
      }
      setNotice(t('home.profileUpdateSuccess', { defaultValue: 'Profile updated.' }));
    } catch (e: any) {
      setError(e?.message || t('home.profileUpdateFailed', { defaultValue: 'Could not update profile right now.' }));
      throw e;
    }
  }

  async function updateMyProfileMedia(media: UpdateAuthenticatedUserMediaPayload) {
    try {
      const updatedUser = await api.updateAuthenticatedUserWithMedia(token, {}, media);
      if (updatedUser && typeof updatedUser === 'object') {
        const nextUser = updatedUser as any;
        setUser((prev: any) => ({
          ...(prev || {}),
          ...nextUser,
          profile: {
            ...(prev?.profile || {}),
            ...(nextUser?.profile || {}),
          },
        }));
      }
      setNotice(t('home.profileUpdateSuccess', { defaultValue: 'Profile updated.' }));
    } catch (e: any) {
      setError(e?.message || t('home.profileUpdateFailed', { defaultValue: 'Could not update profile right now.' }));
      throw e;
    }
  }


  async function ensureReactionGroups() {
    if (reactionGroups.length > 0) return;
    setReactionPickerLoading(true);
    try {
      const groups = await api.getPostReactionEmojiGroups(token);
      setReactionGroups(groups);
    } catch (e: any) {
      setError(e?.message || t('home.reactionLoadFailed'));
    } finally {
      setReactionPickerLoading(false);
    }
  }

  async function refreshPostReactionCounts(post: FeedPost) {
    if (!post.uuid) return;
    try {
      const counts = await api.getPostReactionCounts(token, post.uuid);
      applyPostPatch(post.id, (current) => {
        const existing = current.reactions_emoji_counts || [];
        // Update counts in place, preserving the current display order.
        // Add any new emojis from the server at the end; drop any that hit zero.
        const countMap = new Map(counts.map((c) => [c.emoji?.id, c.count ?? 0]));
        const updated = existing
          .map((e) => ({ ...e, count: countMap.has(e.emoji?.id) ? countMap.get(e.emoji?.id)! : (e.count ?? 0) }))
          .filter((e) => (e.count ?? 0) > 0);
        const existingIds = new Set(existing.map((e) => e.emoji?.id));
        counts.forEach((c) => {
          if (!existingIds.has(c.emoji?.id) && (c.count ?? 0) > 0) updated.push(c);
        });
        return { ...current, reactions_emoji_counts: updated };
      });
    } catch {
      // Keep UI resilient if counts refresh fails.
    }
  }

  async function openReactionPicker(post: FeedPost) {
    requestAnimationFrame(() => {
      setReactionPickerPostId(post.id);
    });
    await ensureReactionGroups();
  }

  function closeReactionPicker() {
    if (reactionActionLoading) return;
    setReactionPickerPostId(null);
  }

  async function reactToPostWithEmoji(post: FeedPost, emojiId?: number) {
    if (!post.uuid || !emojiId || reactionActionLoading) return;
    const isAlreadyMyReaction = post.reaction?.emoji?.id === emojiId;
    const prevReactionEmojiId = post.reaction?.emoji?.id;
    const emojiMeta = (post.reactions_emoji_counts || []).find((e) => e.emoji?.id === emojiId)?.emoji;

    // Optimistic update — apply immediately so the UI feels instant
    if (isAlreadyMyReaction) {
      applyPostPatch(post.id, (current) => ({
        ...current,
        reaction: null,
        reactions_emoji_counts: (current.reactions_emoji_counts || [])
          .map((e) => e.emoji?.id === emojiId ? { ...e, count: Math.max(0, (e.count || 1) - 1) } : e)
          .filter((e) => (e.count || 0) > 0),
      }));
    } else {
      applyPostPatch(post.id, (current) => ({
        ...current,
        reaction: { emoji: emojiMeta },
        reactions_emoji_counts: (current.reactions_emoji_counts || []).map((e) => {
          if (e.emoji?.id === emojiId) return { ...e, count: (e.count || 0) + 1 };
          if (prevReactionEmojiId && e.emoji?.id === prevReactionEmojiId) return { ...e, count: Math.max(0, (e.count || 1) - 1) };
          return e;
        }),
      }));
    }

    setReactionActionLoading(true);
    try {
      if (isAlreadyMyReaction) {
        // Removal: optimistic update is already correct — no reconciliation needed
        await api.removeReactionFromPost(token, post.uuid);
      } else {
        // Add: reconcile with server to get canonical reaction object and counts
        const reaction = await api.reactToPost(token, post.uuid, emojiId);
        applyPostPatch(post.id, (current) => ({ ...current, reaction }));
        await refreshPostReactionCounts(post);
      }
      setReactionPickerPostId(null);
    } catch (e: any) {
      // Revert optimistic update on failure
      applyPostPatch(post.id, () => post);
      setError(e?.message || t('home.reactionLoadFailed'));
    } finally {
      setReactionActionLoading(false);
    }
  }

  async function reactToComment(postId: number, commentId: number, emojiId?: number) {
    const sourcePost = getSourcePost(postId);
    if (!sourcePost?.uuid || !emojiId || reactionActionLoading) return;

    const currentComment = (localComments[postId] || []).find((c) => c.id === commentId);
    const isAlreadyMyReaction = currentComment?.reaction?.emoji?.id === emojiId;

    // Optimistic update
    setLocalComments((prev) => ({
      ...prev,
      [postId]: (prev[postId] || []).map((comment) => {
        if (comment.id !== commentId) return comment;
        if (isAlreadyMyReaction) {
          return {
            ...comment,
            reaction: null,
            reactions_emoji_counts: (comment.reactions_emoji_counts || [])
              .map((e) => e.emoji?.id === emojiId ? { ...e, count: Math.max(0, (e.count || 1) - 1) } : e)
              .filter((e) => (e.count || 0) > 0),
          };
        }
        const prevEmojiId = comment.reaction?.emoji?.id;
        const emojiMeta = (comment.reactions_emoji_counts || []).find((e) => e.emoji?.id === emojiId)?.emoji;
        return {
          ...comment,
          reaction: { emoji: emojiMeta },
          reactions_emoji_counts: (comment.reactions_emoji_counts || []).map((e) => {
            if (e.emoji?.id === emojiId) return { ...e, count: (e.count || 0) + 1 };
            if (prevEmojiId && e.emoji?.id === prevEmojiId) return { ...e, count: Math.max(0, (e.count || 1) - 1) };
            return e;
          }),
        };
      }),
    }));

    setReactionActionLoading(true);
    try {
      if (isAlreadyMyReaction) {
        // Removal: optimistic update is already correct — no reconciliation needed
        await api.removeReactionFromPostComment(token, sourcePost.uuid, commentId);
      } else {
        // Add: use server's canonical reaction object so emoji metadata and id are always correct
        const reaction = await api.reactToPostComment(token, sourcePost.uuid, commentId, emojiId);
        const counts = await api.getPostCommentReactionCounts(token, sourcePost.uuid, commentId);
        setLocalComments((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).map((comment) =>
            comment.id === commentId ? { ...comment, reaction, reactions_emoji_counts: counts } : comment
          ),
        }));
      }
    } catch (e: any) {
      // Revert optimistic update on failure
      if (currentComment) {
        setLocalComments((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).map((c) => (c.id === commentId ? currentComment : c)),
        }));
      }
      setError(e?.message || t('home.reactionLoadFailed'));
    } finally {
      setReactionActionLoading(false);
    }
  }

  function openReportPostModal(post: FeedPost) {
    setReportPostTarget(post);
  }

  function closeReportPostModal() {
    if (reportingPost) return;
    setReportPostTarget(null);
  }

  function openCommentReportModal(postUuid: string, commentId: number) {
    setReportTarget({ kind: 'comment', postUuid, commentId });
  }

  function openCommunityReportModal(communityName: string, displayName?: string) {
    setReportTarget({ kind: 'community', communityName, displayName });
  }

  function closeReportModal() {
    if (reportingItem) return;
    setReportTarget(null);
  }

  async function submitGenericReport(categoryId: number) {
    if (!reportTarget) return;
    setReportingItem(true);
    try {
      if (reportTarget.kind === 'comment') {
        await api.reportComment(token, reportTarget.postUuid, reportTarget.commentId, categoryId);
      } else if (reportTarget.kind === 'community') {
        await api.reportCommunity(token, reportTarget.communityName, categoryId);
      }
      setNotice(t('home.reportSuccess', { defaultValue: 'Reported, thanks!' }));
      setReportTarget(null);
    } catch (e: any) {
      setError(e?.message || t('home.reportFailed', { defaultValue: 'Could not submit report right now.' }));
    } finally {
      setReportingItem(false);
    }
  }

  async function loadModerationTasks(status: 'P' | 'A' | 'R', reset = true) {
    setModerationTasksLoading(true);
    if (reset) setModerationTasksItems([]);
    try {
      const items = await api.getGlobalModeratedObjects(token, { count: 20, statuses: [status] });
      setModerationTasksItems(Array.isArray(items) ? items : []);
    } catch (e: any) {
      setError(e?.message || t('home.moderationLoadFailed', { defaultValue: 'Could not load moderation queue.' }));
    } finally {
      setModerationTasksLoading(false);
    }
  }

  async function openModerationTaskDetail(item: GlobalModeratedObject) {
    setModerationTasksDetailItem(item);
    setModerationTasksDetailReports([]);
    setModerationTasksDetailReportsLoading(true);
    try {
      const reports = await api.getModeratedObjectReports(token, item.id);
      setModerationTasksDetailReports(Array.isArray(reports) ? reports : []);
    } catch {
      // show what we have
    } finally {
      setModerationTasksDetailReportsLoading(false);
    }
  }

  async function handleModerationAction(id: number, action: 'approve' | 'reject' | 'verify') {
    setModerationTasksActionLoading(id);
    try {
      if (action === 'approve') await api.approveModeratedObject(token, id);
      else if (action === 'reject') await api.rejectModeratedObject(token, id);
      else await api.verifyModeratedObject(token, id);
      setModerationTasksItems((prev) => prev.filter((item) => item.id !== id));
      setModerationTasksDetailItem(null);
    } catch (e: any) {
      setError(e?.message || t('home.moderationActionFailed', { defaultValue: 'Action failed. Try again.' }));
    } finally {
      setModerationTasksActionLoading(null);
    }
  }

  async function loadUserPenalties() {
    setUserPenaltiesLoading(true);
    try {
      const penalties = await api.getUserModerationPenalties(token);
      setUserPenalties(Array.isArray(penalties) ? penalties : []);
    } catch {
      // ignore
    } finally {
      setUserPenaltiesLoading(false);
    }
  }

  async function submitPostReport(categoryName: ReportablePostCategoryName) {
    if (!reportPostTarget?.uuid) {
      setError(t('home.reportPostUnavailable'));
      return;
    }

    const category = moderationCategories.find((item) => matchesReportCategory(item, categoryName));
    if (!category?.id) {
      setError(t('home.reportPostCategoriesUnavailable'));
      return;
    }

    setReportingPost(true);
    try {
      const message = await api.reportPost(token, reportPostTarget.uuid, category.id);
      setNotice(message || t('home.reportPostSuccess'));
      setReportPostTarget(null);
    } catch (e: any) {
      setError(e?.message || t('home.reportPostFailed'));
    } finally {
      setReportingPost(false);
    }
  }

  async function openReactionList(post: FeedPost, emoji?: ReactionEmoji) {
    if (!post.uuid) {
      setError(t('home.reactionUnavailable'));
      return;
    }
    setReactionListOpen(true);
    setReactionListPost(post);
    setReactionListEmoji(emoji || null);
    setReactionListUsers([]);
    setReactionListLoading(true);
    try {
      const reactions = await api.getPostReactions(token, post.uuid, emoji?.id);
      setReactionListUsers(reactions);
    } catch (e: any) {
      setError(e?.message || t('home.reactionLoadFailed'));
    } finally {
      setReactionListLoading(false);
    }
  }

  async function loadReactionListInline(post: FeedPost, emoji?: ReactionEmoji) {
    if (!post.uuid) {
      setError(t('home.reactionUnavailable'));
      return;
    }
    setReactionListEmoji(emoji || null);
    setReactionListUsers([]);
    setReactionListLoading(true);
    try {
      const reactions = await api.getPostReactions(token, post.uuid, emoji?.id);
      setReactionListUsers(reactions);
    } catch (e: any) {
      setError(e?.message || t('home.reactionLoadFailed'));
    } finally {
      setReactionListLoading(false);
    }
  }

  function closeReactionList() {
    setReactionListOpen(false);
    setReactionListPost(null);
    setReactionListEmoji(null);
    setReactionListUsers([]);
    setReactionListLoading(false);
  }

  async function handleSharePost(post: FeedPost) {
    // On web, always derive the base from the current browser origin so the link
    // works correctly in both local dev (localhost:8081) and any deployed domain.
    const webBase =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : (process.env.EXPO_PUBLIC_WEB_BASE_URL || 'https://staging.openspace.social');
    const shareUrl = `${webBase.replace(/\/+$/, '')}/posts/${post.uuid || post.id}`;

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        if (navigator.share) {
          await navigator.share({ title: t('home.sharePostTitle'), url: shareUrl });
          return;
        }
        await navigator.clipboard.writeText(shareUrl);
        setNotice(t('home.postLinkCopied'));
        return;
      } catch (e) {
        setError(t('home.shareFailed'));
        return;
      }
    }

    try {
      await Linking.openURL(shareUrl);
    } catch (e) {
      setError(t('home.openShareLinkFailed'));
    }
  }

  function handleRepostPost(post: FeedPost) {
    // Open the composer at the compose step so the user can optionally add a
    // quote/comment, then proceed to the destination picker.
    setComposerSharedPost(post);
    setComposerStep('compose');
    showComposerDrawer();
  }

  function isInternalOpenspaceUrl(url: string) {
    try {
      const parsed = new URL(url);
      const hostname = (parsed.hostname || '').toLowerCase();
      return (
        hostname.endsWith('openspace.social') ||
        hostname === 'openspace-staging-api.us-east-2.elasticbeanstalk.com' ||
        hostname === 'localhost' ||
        hostname === '127.0.0.1'
      );
    } catch {
      return false;
    }
  }

  async function confirmOpenPendingExternalLink() {
    const url = pendingExternalLink;
    if (!url) {
      setExternalLinkModalOpen(false);
      return;
    }

    if (externalLinkResetTimerRef.current) {
      clearTimeout(externalLinkResetTimerRef.current);
      externalLinkResetTimerRef.current = null;
    }

    setExternalLinkModalOpen(false);
    externalLinkResetTimerRef.current = setTimeout(() => {
      setPendingExternalLink(null);
      externalLinkResetTimerRef.current = null;
    }, 220);

    setTimeout(() => {
      Linking.openURL(url).catch(() => setError(t('home.openLinkFailed')));
    }, 140);
  }

  function cancelOpenPendingExternalLink() {
    if (externalLinkResetTimerRef.current) {
      clearTimeout(externalLinkResetTimerRef.current);
      externalLinkResetTimerRef.current = null;
    }
    setExternalLinkModalOpen(false);
    externalLinkResetTimerRef.current = setTimeout(() => {
      setPendingExternalLink(null);
      externalLinkResetTimerRef.current = null;
    }, 220);
  }

  function openLink(url?: string) {
    if (!url) return;
    if (isInternalOpenspaceUrl(url)) {
      Linking.openURL(url).catch(() => setError(t('home.openLinkFailed')));
      return;
    }
    setPendingExternalLink(url);
    setExternalLinkModalOpen(true);
  }

  const welcomeText = user?.username
    ? t('home.welcomeBack', { name: user.username })
    : t('home.welcomeBackGeneric');

  function createRandomState() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getProviderName(provider: SocialProvider) {
    return provider === 'google' ? t('home.providerGoogle') : t('home.providerApple');
  }

  function getProviderIcon(provider: SocialProvider) {
    return provider === 'google' ? 'google' : 'apple';
  }

  function getLinkedIdentity(provider: SocialProvider) {
    return linkedIdentities.find((identity) => identity.provider === provider) || null;
  }

  async function reloadLinkedIdentities() {
    try {
      const identities = await api.getLinkedSocialIdentities(token);
      setLinkedIdentities(identities);
    } catch (errorValue) {
      if (handleUnauthorized(errorValue)) return;
      throw errorValue;
    }
  }

  function openSocialPopup(provider: SocialProvider): Promise<string> {
    return new Promise((resolve, reject) => {
      if (Platform.OS !== 'web' || typeof window === 'undefined') {
        reject(new Error(t('home.linkWebOnly')));
        return;
      }

      const redirectUri = process.env.EXPO_PUBLIC_SOCIAL_AUTH_REDIRECT_URI || window.location.origin;
      const nonce = createRandomState();
      const state = createRandomState();
      const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
      const appleClientId = process.env.EXPO_PUBLIC_APPLE_CLIENT_ID;

      if (provider === 'google' && !googleClientId) {
        reject(new Error(t('home.linkConfigMissing')));
        return;
      }
      if (provider === 'apple' && !appleClientId) {
        reject(new Error(t('home.linkConfigMissing')));
        return;
      }

      const params = new URLSearchParams();
      if (provider === 'google') {
        params.set('client_id', googleClientId as string);
        params.set('redirect_uri', redirectUri);
        params.set('response_type', 'id_token');
        params.set('scope', 'openid email profile');
        params.set('prompt', 'select_account');
        params.set('nonce', nonce);
        params.set('state', state);
      } else {
        params.set('client_id', appleClientId as string);
        params.set('redirect_uri', redirectUri);
        params.set('response_type', 'code id_token');
        params.set('response_mode', 'fragment');
        // Keep popup+hash flow for web: requesting name/email requires form_post.
        params.set('scope', 'openid');
        params.set('nonce', nonce);
        params.set('state', state);
      }

      const authUrl = provider === 'google'
        ? `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
        : `https://appleid.apple.com/auth/authorize?${params.toString()}`;

      const width = 480;
      const height = 640;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        authUrl,
        `${provider}-link-auth`,
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        reject(new Error(t('home.linkPopupBlocked')));
        return;
      }

      const maxWaitMs = 120000;
      const startedAt = Date.now();
      let redirectHandled = false;
      const interval = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(interval);
          reject(new Error(redirectHandled ? t('home.linkFailed') : t('home.linkCancelled')));
          return;
        }

        if (Date.now() - startedAt > maxWaitMs) {
          popup.close();
          window.clearInterval(interval);
          reject(new Error(t('home.linkTimeout')));
          return;
        }

        let href = '';
        try {
          href = popup.location.href;
        } catch (e) {
          return;
        }

        if (!href || !href.startsWith(redirectUri)) return;

        redirectHandled = true;

        const hash = popup.location.hash || '';
        const search = popup.location.search || '';
        const paramsFromHash = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
        const paramsFromQuery = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
        const tokenFromProvider =
          paramsFromHash.get('id_token') ||
          paramsFromQuery.get('id_token');
        const errorFromProvider =
          paramsFromHash.get('error') ||
          paramsFromQuery.get('error');
        const errorDescription =
          paramsFromHash.get('error_description') ||
          paramsFromQuery.get('error_description');
        const returnedState =
          paramsFromHash.get('state') ||
          paramsFromQuery.get('state');

        if (errorFromProvider) {
          popup.close();
          window.clearInterval(interval);
          reject(new Error(errorDescription || errorFromProvider));
          return;
        }
        if (returnedState && returnedState !== state) {
          popup.close();
          window.clearInterval(interval);
          reject(new Error(t('home.linkStateMismatch')));
          return;
        }
        if (!tokenFromProvider) {
          popup.close();
          window.clearInterval(interval);
          reject(
            new Error(
              t('home.linkFailed', {
                defaultValue: 'Could not complete account linking. Please try again.',
              })
            )
          );
          return;
        }

        popup.close();
        window.clearInterval(interval);
        resolve(tokenFromProvider);
      }, 500);
    });
  }

  async function handleLinkProvider(provider: SocialProvider) {
    setError('');
    setNotice('');
    setProviderLoading(provider);
    try {
      const idToken = await openSocialPopup(provider);
      const message = await api.linkSocialIdentity(token, provider, idToken);
      await reloadLinkedIdentities();
      setNotice(message || t('home.linkSuccess', { provider: getProviderName(provider) }));
    } catch (e: any) {
      const rawMessage = String(e?.message || '').toLowerCase();
      if (
        rawMessage.includes('invalid token') ||
        rawMessage.includes('already linked') ||
        rawMessage.includes('another user') ||
        rawMessage.includes('email already') ||
        rawMessage.includes('already exists')
      ) {
        setError(
          t('home.linkEmailAlreadyLinked', {
            defaultValue: 'Email already linked to an Openspace account.',
          })
        );
      } else {
        setError(e.message || t('home.linkFailed'));
      }
    } finally {
      setProviderLoading(null);
    }
  }

  async function handleUnlinkProvider(provider: SocialProvider) {
    setError('');
    setNotice('');
    setProviderLoading(provider);
    try {
      const message = await api.unlinkSocialIdentity(token, provider);
      await reloadLinkedIdentities();
      setNotice(message || t('home.unlinkSuccess', { provider: getProviderName(provider) }));
    } catch (e: any) {
      setError(e.message || t('home.unlinkFailed'));
    } finally {
      setProviderLoading(null);
    }
  }

  function clearTooltipTimer() {
    if (!tooltipTimerRef.current) return;
    clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
  }

  function startTooltipDelay(tabKey: FeedType) {
    clearTooltipTimer();
    tooltipTimerRef.current = setTimeout(() => {
      setTooltipTab(tabKey);
      tooltipTimerRef.current = null;
    }, 2000);
  }

  useEffect(() => {
    return () => clearTooltipTimer();
  }, []);

  useEffect(() => {
    return () => {
      if (externalLinkResetTimerRef.current) {
        clearTimeout(externalLinkResetTimerRef.current);
        externalLinkResetTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (inviteDrawerOpenTimerRef.current) {
        clearTimeout(inviteDrawerOpenTimerRef.current);
        inviteDrawerOpenTimerRef.current = null;
      }
    };
  }, []);

  function hideWelcomeNotice() {
    if (welcomeTimerRef.current) {
      clearTimeout(welcomeTimerRef.current);
      welcomeTimerRef.current = null;
    }
    Animated.timing(welcomeTranslateX, {
      toValue: -380,
      duration: 260,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShowWelcomeNotice(false);
    });
  }

  function showWelcomeNoticeWithAnimation() {
    if (welcomeTimerRef.current) {
      clearTimeout(welcomeTimerRef.current);
      welcomeTimerRef.current = null;
    }
    setShowWelcomeNotice(true);
    welcomeTranslateX.setValue(-380);
    requestAnimationFrame(() => {
      Animated.timing(welcomeTranslateX, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start();
    });
    welcomeTimerRef.current = setTimeout(() => {
      hideWelcomeNotice();
      welcomeTimerRef.current = null;
    }, 7000);
  }

  useEffect(() => {
    if (loading) return;
    let cancelled = false;

    async function maybeShowWelcomeNotice() {
      const noticeKey = `${WELCOME_NOTICE_KEY_PREFIX}:${user?.username || 'anonymous'}`;
      const now = Date.now();

      try {
        const stored = await AsyncStorage.getItem(noticeKey);
        const lastShown = stored ? Number(stored) : 0;
        const shouldShow =
          !lastShown ||
          Number.isNaN(lastShown) ||
          now - lastShown >= WELCOME_NOTICE_COOLDOWN_MS;

        if (!cancelled && shouldShow) {
          showWelcomeNoticeWithAnimation();
          await AsyncStorage.setItem(noticeKey, String(now));
        }
      } catch {
        if (!cancelled) {
          // Fail-open for UX if storage is unavailable.
          showWelcomeNoticeWithAnimation();
        }
      }
    }

    maybeShowWelcomeNotice();

    return () => {
      cancelled = true;
      if (welcomeTimerRef.current) {
        clearTimeout(welcomeTimerRef.current);
        welcomeTimerRef.current = null;
      }
    };
  }, [loading, user?.username]);

  useEffect(() => {
    return () => {
      if (typeof URL === 'undefined') return;
      for (const image of composerImages) {
        if (image.previewUri?.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(image.previewUri);
          } catch {
            // best-effort cleanup for browser object URLs
          }
        }
      }
      if (composerVideo?.previewUri?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(composerVideo.previewUri);
        } catch {
          // best-effort cleanup for browser object URLs
        }
      }
    };
  }, [composerImages, composerVideo]);

  useEffect(() => {
    if (!longPostDrawerOpen || composerPostType !== 'LP') return;

    const hasDraftContent = composerLongPostEditorMode === 'lexical'
      ? !!composerLongPostTitle.trim() || !!extractPlainTextFromHtml(composerLongPostLexicalHtml)
      : !!composerLongPostTitle.trim() || composerLongPostBlocks.some((block) => {
        const text = (block.text || '').trim();
        const url = (block.url || '').trim();
        const caption = (block.caption || '').trim();
        return !!text || !!url || !!caption;
      });
    if (!hasDraftContent) return;

    if (longPostAutosaveTimerRef.current) {
      clearTimeout(longPostAutosaveTimerRef.current);
      longPostAutosaveTimerRef.current = null;
    }

    longPostAutosaveTimerRef.current = setTimeout(() => {
      void saveLongPostDraft(false);
    }, 20000);

    return () => {
      if (longPostAutosaveTimerRef.current) {
        clearTimeout(longPostAutosaveTimerRef.current);
        longPostAutosaveTimerRef.current = null;
      }
    };
  }, [
    longPostDrawerOpen,
    composerPostType,
    composerLongPostEditorMode,
    composerLongPostTitle,
    composerLongPostBlocks,
    composerLongPostLexicalHtml,
  ]);

  // ── Notification handlers ─────────────────────────────────────────────────────

  async function handleOpenNotifications() {
    setNotifDrawerOpen(true);
    setNotifLoading(true);
    setNotifications([]);
    setNotifHasMore(false);
    setNotifNextMaxId(undefined);
    try {
      const result = await api.getNotifications(token);
      setNotifications(result.notifications);
      setNotifHasMore(result.hasMore);
      setNotifNextMaxId(result.nextMaxId);
    } catch {
      // silently ignore — empty state will show
    } finally {
      setNotifLoading(false);
    }
  }

  async function handleLoadMoreNotifications() {
    if (notifLoadingMore || !notifHasMore) return;
    setNotifLoadingMore(true);
    try {
      const result = await api.getNotifications(token, notifNextMaxId);
      setNotifications((prev) => [...prev, ...result.notifications]);
      setNotifHasMore(result.hasMore);
      setNotifNextMaxId(result.nextMaxId);
    } catch {
      // silently ignore
    } finally {
      setNotifLoadingMore(false);
    }
  }

  async function handleMarkAllRead() {
    // Update UI immediately so the button disappears and rows clear right away
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await api.markNotificationsRead(token);
    } catch {
      // silently ignore — UI is already updated optimistically
    }
  }

  async function handleMarkRead(id: number) {
    try {
      await api.markNotificationRead(token, id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silently ignore
    }
  }

  async function handleDeleteNotification(id: number) {
    try {
      await api.deleteNotification(token, id);
      const deleted = notifications.find((n) => n.id === id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (deleted && !deleted.read) setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silently ignore
    }
  }

  async function handleDeleteAllNotifications() {
    try {
      await api.deleteAllNotifications(token);
      setNotifications([]);
      setNotifHasMore(false);
      setNotifNextMaxId(undefined);
      setUnreadCount(0);
    } catch {
      // silently ignore
    }
  }

  async function handleDeleteFilteredNotifications(ids: number[]) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const idSet = new Set(ids);
    const removedUnread = notifications.reduce((acc, n) => (
      idSet.has(n.id) && !n.read ? acc + 1 : acc
    ), 0);
    setNotifications((prev) => prev.filter((n) => !idSet.has(n.id)));
    if (removedUnread > 0) setUnreadCount((prev) => Math.max(0, prev - removedUnread));
    try {
      await Promise.allSettled(ids.map((id) => api.deleteNotification(token, id)));
    } catch {
      // silently ignore: UI already updated optimistically
    }
  }

  function handleNotificationNavigatePost(postId: number, postUuid?: string) {
    setNotifDrawerOpen(false);
    onNavigate({ screen: 'post', postUuid: postUuid || String(postId) });
  }

  function handleNotificationNavigateProfile(username: string) {
    setNotifDrawerOpen(false);
    onNavigate({ screen: 'profile', username });
  }

  function handleNotificationNavigateCommunity(name: string) {
    setNotifDrawerOpen(false);
    onNavigate({ screen: 'community', name });
  }

  // ─────────────────────────────────────────────────────────────────────────────

  // ── Profile actions menu handlers ─────────────────────────────────────────────

  async function handleConnect(circlesIds: number[]) {
    if (!profileUser?.username) return;
    setProfileActionsLoading(true);
    try {
      await api.connectWithUser(token, profileUser.username, circlesIds);
      setProfileUser((prev: any) => prev ? { ...prev, is_connected: true, is_fully_connected: false } : prev);
    } catch {
      setError('Could not send connection request.');
    } finally {
      setProfileActionsLoading(false);
    }
  }

  async function handleUpdateConnection(circlesIds: number[]) {
    if (!profileUser?.username) return;
    setProfileActionsLoading(true);
    try {
      await api.updateConnection(token, profileUser.username, circlesIds);
      setProfileUser((prev: any) => prev ? { ...prev, connected_circles: userCircles.filter((c) => circlesIds.includes(c.id)) } : prev);
    } catch {
      setError('Could not update connection.');
    } finally {
      setProfileActionsLoading(false);
    }
  }

  async function handleConfirmConnection(circlesIds: number[]) {
    if (!profileUser?.username) return;
    setProfileActionsLoading(true);
    try {
      await api.confirmConnection(token, profileUser.username, circlesIds);
      setProfileUser((prev: any) => prev ? { ...prev, is_connected: true, is_fully_connected: true } : prev);
    } catch {
      setError('Could not confirm connection.');
    } finally {
      setProfileActionsLoading(false);
    }
  }

  async function handleDisconnect() {
    if (!profileUser?.username) return;
    setProfileActionsLoading(true);
    try {
      await api.disconnectFromUser(token, profileUser.username);
      setProfileUser((prev: any) => prev ? { ...prev, is_connected: false, is_fully_connected: false, connected_circles: [] } : prev);
    } catch {
      setError('Could not disconnect.');
    } finally {
      setProfileActionsLoading(false);
    }
  }

  async function handleDeclineConnection() {
    if (!profileUser?.username) return;
    setProfileActionsLoading(true);
    try {
      await api.disconnectFromUser(token, profileUser.username);
      setProfileUser((prev: any) => prev ? { ...prev, is_connected: false, is_fully_connected: false, is_pending_connection_confirmation: false, connected_circles: [] } : prev);
    } catch {
      setError('Could not decline connection.');
    } finally {
      setProfileActionsLoading(false);
    }
  }

  async function handleAddToList(listId: number, username: string) {
    // Fetch current list members, add username, send full replacement list
    try {
      const detail = await api.getListDetail(token, listId);
      const currentUsernames = (detail.users || []).map((u: any) => u.username).filter(Boolean);
      if (!currentUsernames.includes(username)) {
        await api.updateList(token, listId, { usernames: [...currentUsernames, username] });
        setUserLists((prev) => prev.map((l) => l.id === listId ? { ...l, follows_count: l.follows_count + 1 } : l));
      }
    } catch {
      throw new Error('Could not add to list.');
    }
  }

  async function handleCreateList(name: string, emojiId: number): Promise<ListResult | null> {
    try {
      const list = await api.createList(token, name, emojiId);
      setUserLists((prev) => [...prev, list]);
      return list;
    } catch {
      setError('Could not create list.');
      return null;
    }
  }

  async function handleCreateCircle(name: string, color: string): Promise<typeof userCircles[0] | null> {
    try {
      const circle = await api.createCircle(token, name, color);
      setUserCircles((prev) => [...prev, circle]);
      return circle;
    } catch {
      setError('Could not create circle.');
      return null;
    }
  }

  async function handleBlockUser(username: string) {
    try {
      await api.blockUser(token, username);
      setNotice(`@${username} has been blocked.`);
      setProfileUser((prev: any) =>
        prev?.username === username ? { ...prev, is_blocked: true } : prev
      );
    } catch {
      setError('Could not block user.');
    }
  }

  async function handleUnblockUser(username: string) {
    try {
      await api.unblockUser(token, username);
      setNotice(`@${username} has been unblocked.`);
      setProfileUser((prev: any) =>
        prev?.username === username ? { ...prev, is_blocked: false } : prev
      );
    } catch {
      setError('Could not unblock user.');
    }
  }

  async function handleReportUser(username: string, categoryId: number, description?: string) {
    try {
      await api.reportUser(token, username, categoryId, description);
      setNotice(`@${username} has been reported. Thank you.`);
    } catch {
      setError('Could not submit report.');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  function handleProfileComingSoon() {
    setMenuOpen(false);
    onNavigate({ screen: 'me' });
  }

  function clearComposerMedia() {
    if (typeof URL !== 'undefined') {
      for (const image of composerImages) {
        if (image.previewUri?.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(image.previewUri);
          } catch {
            // best-effort cleanup for browser object URLs
          }
        }
      }
      if (composerVideo?.previewUri?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(composerVideo.previewUri);
        } catch {
          // best-effort cleanup for browser object URLs
        }
      }
    }
    setComposerImages([]);
    setComposerVideo(null);
  }

  function openComposerModal(action?: 'video' | 'image' | 'emoji') {
    composerTextRef.current = '';
    if (composerTextLengthDebounceRef.current) clearTimeout(composerTextLengthDebounceRef.current);
    setComposerTextLength(0);
    setComposerLinkPreview(null);
    setComposerLinkPreviewLoading(false);
    composerLinkPreviewUrlRef.current = null;
    setComposerInputKey((prev) => prev + 1);
    setComposerPostType('P');
    setComposerLongPostEditorMode('lexical');
    setComposerLongPostTitle('');
    setComposerLongPostBlocks(createInitialLongPostBlocks());
    setComposerLongPostLexicalHtml('');
    setComposerLongPostLexicalResetKey((prev) => prev + 1);
    showComposerDrawer();
    setComposerStep('compose');
    setComposerDraftUuid(null);
    setComposerLongPostMediaCount(0);
    setComposerDraftSavedAt(null);
    setComposerDraftExpiryDays(14);
    setComposerDraftsOpen(false);
    setComposerDrafts([]);
    setComposerSelectedCircleId(null);
    setComposerSelectedCommunityNames([]);
    setComposerCommunitySearch('');
    setLongPostDrawerOpen(false);
    setLongPostDrawerExpanded(false);
    if (action === 'image' || action === 'video') {
      openComposerMediaPicker(action);
    }
  }

  function showComposerDrawer() {
    composerClosingRef.current = false;
    setComposerOpen(true);
    setComposerModalMounted(true);
    const startAnimation = () => {
      composerTranslateX.setValue(composerDrawerWidth);
      Animated.timing(composerTranslateX, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(startAnimation);
      return;
    }
    setTimeout(startAnimation, 0);
  }

  function resetComposerState() {
    composerTextRef.current = '';
    if (composerTextLengthDebounceRef.current) clearTimeout(composerTextLengthDebounceRef.current);
    setComposerTextLength(0);
    setComposerLinkPreview(null);
    setComposerLinkPreviewLoading(false);
    composerLinkPreviewUrlRef.current = null;
    setComposerInputKey((prev) => prev + 1);
    clearComposerMedia();
    setComposerSubmitting(false);
    setComposerStep('compose');
    setComposerDraftUuid(null);
    setComposerLongPostMediaCount(0);
    setComposerDraftSavedAt(null);
    setComposerDraftExpiryDays(14);
    setComposerDraftsOpen(false);
    setComposerDraftsLoading(false);
    setComposerDrafts([]);
    setComposerDraftDeleteUuid(null);
    setComposerSelectedCircleId(null);
    setComposerSelectedCommunityNames([]);
    setComposerCommunitySearch('');
    setComposerDestinationsLoading(false);
    setComposerPostType('P');
    setComposerLongPostEditorMode('lexical');
    setComposerLongPostTitle('');
    setComposerLongPostBlocks(createInitialLongPostBlocks());
    setComposerLongPostLexicalHtml('');
    setComposerLongPostLexicalResetKey((prev) => prev + 1);
    longPostInlineMediaOrderRef.current = 1000;
    setLongPostDrawerOpen(false);
    setLongPostDrawerExpanded(false);
    setComposerSharedPost(null);
    if (longPostAutosaveTimerRef.current) {
      clearTimeout(longPostAutosaveTimerRef.current);
      longPostAutosaveTimerRef.current = null;
    }
  }

  async function refreshComposerDraftMediaCount(draftUuid?: string | null) {
    if (!draftUuid) {
      setComposerLongPostMediaCount(0);
      return;
    }
    try {
      const media = await api.getPostMedia(token, draftUuid);
      setComposerLongPostMediaCount(media.length);
    } catch {
      // Non-fatal: keep current UI state.
    }
  }

  async function syncRemovedLongPostMedia(removedUrls: string[]) {
    if (!composerDraftUuid || !removedUrls.length || longPostMediaSyncInFlightRef.current) return;
    longPostMediaSyncInFlightRef.current = true;
    try {
      const removedSet = new Set(removedUrls.map(canonicalizeMediaUrl).filter(Boolean));
      const media = await api.getPostMedia(token, composerDraftUuid);
      const toDelete = media.filter((item) => {
        const content = item.content_object || {};
        const candidates = [
          canonicalizeMediaUrl(content.image),
          canonicalizeMediaUrl(content.thumbnail),
          canonicalizeMediaUrl(content.file),
        ].filter(Boolean);
        return candidates.some((url) => removedSet.has(url));
      });

      for (const item of toDelete) {
        if (typeof item.id !== 'number') continue;
        await api.deletePostMedia(token, composerDraftUuid, item.id);
      }

      if (toDelete.length > 0) {
        const nextMedia = await api.getPostMedia(token, composerDraftUuid);
        setComposerLongPostMediaCount(nextMedia.length);
      }
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not update media right now.' }));
    } finally {
      longPostMediaSyncInFlightRef.current = false;
    }
  }

  async function uploadLongPostBlockImages(files: Array<Blob & { name?: string; type?: string }>) {
    if (!files.length) return [];
    if (Platform.OS !== 'web') {
      throw new Error(
        t('home.postComposerMediaUnsupported', { defaultValue: 'Media upload is currently available on web.' })
      );
    }

    const longPayload = getComposerLongPayload();
    let draftUuid = composerDraftUuid;
    if (!draftUuid) {
      const createdDraft = await api.createPost(token, {
        ...longPayload,
        is_draft: true,
      });
      draftUuid = createdDraft.uuid || null;
      if (!draftUuid) {
        throw new Error(
          t('home.postComposerFailed', { defaultValue: 'Could not publish your post right now.' })
        );
      }
      setComposerDraftUuid(draftUuid);
      setComposerDraftSavedAt(new Date().toISOString());
    }
    const existingMedia = await api.getPostMedia(token, draftUuid);
    setComposerLongPostMediaCount(existingMedia.length);
    const existingCount = existingMedia.length;
    const remainingSlots = Math.max(0, LONG_POST_MAX_IMAGES - existingCount);
    if (remainingSlots <= 0) {
      throw new Error(
        t('home.postComposerMaxImagesReached', {
          count: LONG_POST_MAX_IMAGES,
          defaultValue: `You can upload up to ${LONG_POST_MAX_IMAGES} photos.`,
        })
      );
    }

    if (files.length > remainingSlots) {
      throw new Error(
        t('home.postComposerMaxImagesReached', {
          count: LONG_POST_MAX_IMAGES,
          defaultValue: `You can upload up to ${LONG_POST_MAX_IMAGES} photos.`,
        })
      );
    }

    const maxExistingOrder = existingMedia.reduce((max, item) => {
      const val = typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : max;
      return Math.max(max, val);
    }, -1);
    if (maxExistingOrder >= longPostInlineMediaOrderRef.current) {
      longPostInlineMediaOrderRef.current = maxExistingOrder + 1;
    }

    const orders = files.map(() => longPostInlineMediaOrderRef.current++);

    for (let i = 0; i < files.length; i += 1) {
      try {
        await api.addPostMedia(token, draftUuid, {
          file: files[i],
          order: orders[i],
        });
      } catch (e: any) {
        if (e instanceof ApiRequestError && e.status === 400 && /maximum amount of post media items reached/i.test(e.message || '')) {
          throw new Error(
            t('home.postComposerMaxImagesReached', {
              count: LONG_POST_MAX_IMAGES,
              defaultValue: `You can upload up to ${LONG_POST_MAX_IMAGES} photos.`,
            })
          );
        }
        throw e;
      }
    }

    const media = await api.getPostMedia(token, draftUuid);
    setComposerLongPostMediaCount(media.length);
    const uploadedUrls = orders.map((order) => {
      const match = media.find((item) => item.order === order);
      const content = match?.content_object;
      return content?.image || content?.thumbnail || content?.file || '';
    }).filter((url): url is string => !!url);

    if (uploadedUrls.length !== files.length) {
      throw new Error(
        t('home.postComposerFailed', { defaultValue: 'Could not publish your post right now.' })
      );
    }

    return uploadedUrls;
  }

  function hideComposerDrawer(onHidden?: () => void) {
    if (!composerModalMounted) {
      onHidden?.();
      return;
    }
    if (composerClosingRef.current) return;
    composerClosingRef.current = true;
    Animated.timing(composerTranslateX, {
      toValue: composerDrawerWidth,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      composerClosingRef.current = false;
      setComposerOpen(false);
      setComposerModalMounted(false);
      onHidden?.();
    });
  }

  function closeComposerModal() {
    hideComposerDrawer(() => {
      resetComposerState();
    });
  }

  function switchToLongPostForm() {
    setComposerPostType('LP');
    hideComposerDrawer(() => {
      setLongPostDrawerOpen(true);
    });
  }

  async function openComposerDestinationFromLongPost() {
    if (composerSubmitting || composerDestinationsLoading) return;
    setComposerPostType('LP');
    setError('');
    setLongPostDrawerOpen(false);
    setComposerStep('destination');
    showComposerDrawer();
    try {
      await loadComposerDestinations();
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not publish your post right now.' }));
    }
  }

  function getComposerLongPayload() {
    if (composerLongPostEditorMode === 'lexical') {
      const renderedHtml = composeLongPostHtmlWithTitle(composerLongPostTitle, composerLongPostLexicalHtml);
      const trimmedLongText = extractPlainTextFromHtml(renderedHtml);
      // Parse body blocks from the Lexical HTML so images and their authored
      // positions are stored as structured data, not just as raw HTML.
      const bodyBlocks = parseLongPostHtmlBlocksForPreview(composerLongPostLexicalHtml);
      const trimmedTitle = composerLongPostTitle.trim();
      const blocksWithTitle: LongPostBlock[] = trimmedTitle
        ? [
            { id: `lexical-title-${Date.now()}`, position: 0, type: 'heading', level: 1, text: trimmedTitle },
            ...bodyBlocks.map((b, i) => ({ ...b, position: i + 1 })),
          ]
        : bodyBlocks.map((b, i) => ({ ...b, position: i }));
      return {
        long_text: trimmedLongText.length >= 500 ? trimmedLongText : undefined,
        long_text_blocks: blocksWithTitle.length > 0 ? blocksWithTitle : undefined,
        long_text_rendered_html: renderedHtml || undefined,
        long_text_version: 2,
        type: 'LP' as const,
        draft_expiry_days: composerDraftExpiryDays,
      };
    }

    const composedBlocks = composeLongPostBlocksWithTitle(composerLongPostTitle, composerLongPostBlocks);
    const trimmedLongText = extractPlainTextFromBlocks(composedBlocks);
    return {
      long_text: trimmedLongText.length >= 500 ? trimmedLongText : undefined,
      long_text_blocks: composedBlocks,
      long_text_rendered_html: buildLongPostHtmlFromBlocks(composedBlocks),
      long_text_version: 1,
      type: 'LP' as const,
      draft_expiry_days: composerDraftExpiryDays,
    };
  }

  function buildLongPostPreviewPost(params: {
    title: string;
    blocks: LongPostBlock[];
    editorMode: LongPostEditorMode;
    lexicalHtml?: string;
  }): FeedPost {
    const nowIso = new Date().toISOString();
    let longText = '';
    let renderedHtml = '';
    let blocksPayload: LongPostBlock[] | undefined;
    let version = 1;

    if (params.editorMode === 'lexical') {
      const lexicalBodyHtml = params.lexicalHtml || '';
      renderedHtml = composeLongPostHtmlWithTitle(params.title, lexicalBodyHtml);
      longText = extractPlainTextFromHtml(renderedHtml);
      const parsedBodyBlocks = parseLongPostHtmlBlocksForPreview(lexicalBodyHtml);
      const trimmedTitle = params.title.trim();
      blocksPayload = trimmedTitle
        ? [
            {
              id: `preview-title-${Date.now()}`,
              position: 0,
              type: 'heading',
              level: 1,
              text: trimmedTitle,
            },
            ...parsedBodyBlocks.map((block, idx) => ({
              ...block,
              position: idx + 1,
            })),
          ]
        : parsedBodyBlocks.map((block, idx) => ({
          ...block,
          position: idx,
        }));
      version = 2;
    } else {
      const composed = composeLongPostBlocksWithTitle(params.title, params.blocks);
      blocksPayload = composed.map((block, idx) => ({ ...block, position: idx }));
      renderedHtml = buildLongPostHtmlFromBlocks(composed);
      longText = extractPlainTextFromBlocks(composed);
      version = 1;
    }

    const imageUrls = extractImageUrlsFromLongPostHtml(renderedHtml);
    const hasInlineImageBlocks = Array.isArray(blocksPayload)
      && blocksPayload.some((block) => block.type === 'image' && !!block.url);
    const mediaPreview = hasInlineImageBlocks
      ? []
      : imageUrls.map((url, index) => ({
          id: index + 1,
          type: 'image',
          order: index,
          image: url,
          thumbnail: url,
          file: url,
          content_object: {
            image: url,
            thumbnail: url,
            file: url,
          },
        }));

    return {
      id: -Math.floor(Date.now() / 1000),
      uuid: `preview-${Date.now()}`,
      type: 'LP',
      created: nowIso,
      text: undefined,
      long_text: longText || undefined,
      long_text_blocks: blocksPayload as unknown[] | undefined,
      long_text_rendered_html: renderedHtml || undefined,
      long_text_version: version,
      media: mediaPreview,
      media_thumbnail: mediaPreview[0]?.thumbnail,
      comments_count: 0,
      reactions_emoji_counts: [],
      creator: {
        name: user?.name || user?.username || t('home.youLabel', { defaultValue: 'You' }),
        username: user?.username || 'you',
        avatar: user?.avatar,
      },
    };
  }

  function openComposerLongPostPreview() {
    const previewPost = buildLongPostPreviewPost({
      title: composerLongPostTitle,
      blocks: composerLongPostBlocks,
      editorMode: composerLongPostEditorMode,
      lexicalHtml: composerLongPostLexicalHtml,
    });
    setExpandedPostIds((prev) => ({ ...prev, [previewPost.id]: false }));
    setLongPostPreviewPost(previewPost);
    setLongPostPreviewOpen(true);
  }

  function openEditLongPostPreview() {
    const previewPost = buildLongPostPreviewPost({
      title: longPostEditTitle,
      blocks: longPostEditBlocks,
      editorMode: 'blocks',
      lexicalHtml: '',
    });
    setExpandedPostIds((prev) => ({ ...prev, [previewPost.id]: false }));
    setLongPostPreviewPost(previewPost);
    setLongPostPreviewOpen(true);
  }

  async function saveLongPostDraft(showSuccessNotice = true) {
    if (composerDraftSaving || composerSubmitting || composerDestinationsLoading) return;
    setComposerDraftSaving(true);
    setError('');
    try {
      const longPayload = getComposerLongPayload();
      if (!composerDraftUuid) {
        const created = await api.createPost(token, {
          ...longPayload,
          is_draft: true,
        });
        setComposerDraftUuid(created.uuid || null);
        await refreshComposerDraftMediaCount(created.uuid || null);
      } else {
        await api.updatePostContent(token, composerDraftUuid, {
          ...longPayload,
          is_draft: true,
        });
        await refreshComposerDraftMediaCount(composerDraftUuid);
      }
      setComposerDraftSavedAt(new Date().toISOString());
      if (showSuccessNotice) {
        setNotice(t('home.postComposerDraftSuccess', { defaultValue: 'Draft saved.' }));
      }
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not save draft right now.' }));
    } finally {
      setComposerDraftSaving(false);
    }
  }

  async function loadLongPostDrafts() {
    setComposerDraftsLoading(true);
    setError('');
    try {
      const drafts = await api.getDraftPosts(token, 20);
      const longDrafts = drafts.filter((post) => post.type === 'LP');
      setComposerDrafts(longDrafts);
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not load drafts right now.' }));
    } finally {
      setComposerDraftsLoading(false);
    }
  }

  function openLongPostDraftsDrawer() {
    setComposerDraftsOpen(true);
    void loadLongPostDrafts();
  }

  async function resumeLongPostDraft(post: FeedPost) {
    const draftRenderedHtml =
      typeof post.long_text_rendered_html === 'string' ? post.long_text_rendered_html : '';
    const rawBlocks = Array.isArray(post.long_text_blocks) && post.long_text_blocks.length > 0
      ? (post.long_text_blocks as LongPostBlock[])
      : (post.long_text
        ? [{ id: `draft-legacy-${Date.now()}`, type: 'paragraph' as const, text: post.long_text }]
        : createInitialLongPostBlocks());
    const normalized = splitLongPostTitleFromBlocks(rawBlocks);
    const fromRendered = draftRenderedHtml
      ? splitTitleFromLongPostHtml(draftRenderedHtml)
      : { title: '', bodyHtml: '' };
    const blocksHtml = buildLongPostHtmlFromBlocks(normalized.blocks);
    const blocksContainTable = normalized.blocks.some((block) => block.type === 'table' && !!block.tableHtml);
    const renderedContainsTable = /<table\b/i.test(fromRendered.bodyHtml || '');
    // Always resume drafts in Lexical mode. If rendered HTML lost table nodes,
    // rebuild from stored blocks so grids/tables survive draft restore.
    const lexicalBodyHtml =
      blocksContainTable && !renderedContainsTable
        ? blocksHtml
        : (fromRendered.bodyHtml || blocksHtml);
    const lexicalBodyBlocks = parseLongPostHtmlBlocksForPreview(lexicalBodyHtml);
    const resolvedTitle = fromRendered.title || normalized.title;

    setComposerPostType('LP');
    setComposerLongPostTitle(resolvedTitle);
    setComposerLongPostBlocks(ensureLongPostBlocks(lexicalBodyBlocks));
    setComposerLongPostEditorMode('lexical');
    setComposerLongPostLexicalHtml(lexicalBodyHtml);
    setComposerLongPostLexicalResetKey((prev) => prev + 1);
    setComposerDraftUuid(post.uuid || null);
    await refreshComposerDraftMediaCount(post.uuid || null);
    setComposerDraftSavedAt(post.created || null);
    setComposerDraftsOpen(false);
    setLongPostDrawerOpen(true);
  }

  async function deleteLongPostDraft(postUuid?: string) {
    if (!postUuid || composerDraftDeleteUuid) return;
    setComposerDraftDeleteUuid(postUuid);
    setError('');
    try {
      await api.deletePost(token, postUuid);
      setComposerDrafts((prev) => prev.filter((post) => post.uuid !== postUuid));
      if (composerDraftUuid === postUuid) {
        setComposerDraftUuid(null);
        setComposerLongPostMediaCount(0);
        setComposerDraftSavedAt(null);
      }
      setNotice(t('home.postDeletedNotice', { defaultValue: 'Post deleted.' }));
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not delete draft right now.' }));
    } finally {
      setComposerDraftDeleteUuid(null);
    }
  }

  function requestDeleteLongPostDraft(postUuid?: string) {
    if (!postUuid || composerDraftDeleteUuid) return;
    setComposerDraftDeleteConfirmUuid(postUuid);
  }

  async function confirmDeleteLongPostDraft() {
    const targetUuid = composerDraftDeleteConfirmUuid;
    if (!targetUuid) return;
    setComposerDraftDeleteConfirmUuid(null);
    await deleteLongPostDraft(targetUuid);
  }

  function openComposerMediaPicker(kind: ComposerMediaType) {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setNotice(t('home.postComposerMediaUnsupported', { defaultValue: 'Media upload is currently available on web.' }));
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'video' ? 'video/*' : 'image/*';
    if (kind === 'image') {
      input.multiple = true;
    }
    input.onchange = () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;

      if (kind === 'video') {
        const file = files[0];
        const previewUri = typeof URL !== 'undefined' ? URL.createObjectURL(file) : undefined;
        if (typeof URL !== 'undefined') {
          for (const image of composerImages) {
            if (image.previewUri?.startsWith('blob:')) {
              try {
                URL.revokeObjectURL(image.previewUri);
              } catch {
                // best-effort cleanup for browser object URLs
              }
            }
          }
          if (composerVideo?.previewUri?.startsWith('blob:')) {
            try {
              URL.revokeObjectURL(composerVideo.previewUri);
            } catch {
              // best-effort cleanup for browser object URLs
            }
          }
        }
        setComposerImages([]);
        setComposerVideo({
          file: file as Blob & { name?: string; type?: string },
          previewUri,
        });
        return;
      }

      const imageFiles = files.filter((file) => file.type.startsWith('image/')).slice(0, 5);
      if (!imageFiles.length) return;

      setComposerVideo((prev) => {
        if (prev?.previewUri?.startsWith('blob:') && typeof URL !== 'undefined') {
          try {
            URL.revokeObjectURL(prev.previewUri);
          } catch {
            // best-effort cleanup for browser object URLs
          }
        }
        return null;
      });

      setComposerImages((prev) => {
        const remaining = Math.max(0, 5 - prev.length);
        if (remaining <= 0) {
          setNotice(t('home.postComposerMaxImagesReached', { count: 5, defaultValue: 'You can upload up to 5 photos.' }));
          return prev;
        }
        const nextFiles = imageFiles.slice(0, remaining);
        const nextEntries: ComposerImageSelection[] = nextFiles.map((file) => ({
          file: file as Blob & { name?: string; type?: string },
          previewUri: typeof URL !== 'undefined' ? URL.createObjectURL(file) : undefined,
        }));
        return [...prev, ...nextEntries];
      });
    };
    input.click();
  }

  function removeComposerImage(index: number) {
    setComposerImages((prev) => {
      const target = prev[index];
      if (target?.previewUri?.startsWith('blob:') && typeof URL !== 'undefined') {
        try {
          URL.revokeObjectURL(target.previewUri);
        } catch {
          // best-effort cleanup for browser object URLs
        }
      }
      return prev.filter((_, idx) => idx !== index);
    });
  }

  function rotateComposerImage(index: number) {
    if (composerSubmitting) return;
    setComposerImages((prev) => {
      const updated = [...prev];
      const item = updated[index];
      if (!item) return prev;
      updated[index] = {
        ...item,
        rotation: (((item.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270,
      };
      return updated;
    });
  }

  /**
   * Returns the upload-ready blob for a composer image, applying any pending
   * canvas rotation. Falls back to the original file if rotation fails.
   */
  async function getUploadBlob(
    image: ComposerImageSelection,
  ): Promise<Blob & { name?: string; type?: string }> {
    if (!image.rotation) return image.file;
    try {
      const { rotateImageBlob } = await import('../utils/imageRotation');
      const rotated = await rotateImageBlob(image.file as Blob, image.rotation as 90 | 180 | 270);
      // canvas.toBlob() already sets the MIME type on the returned Blob.
      // DO NOT use Object.assign to set `type` — Blob.type is a read-only Web IDL
      // attribute (getter-only on the prototype), so assigning it in strict mode
      // throws a TypeError and the catch block would silently fall back to the
      // original unrotated file.  Just attach `name` as a plain own property.
      const result = rotated as Blob & { name?: string; type?: string };
      const originalName = (image.file as any).name as string | undefined;
      if (originalName) (result as any).name = originalName;
      return result;
    } catch (e) {
      console.error('[HomeScreen] getUploadBlob rotation failed, using original', e);
      return image.file;
    }
  }

  async function loadSidebarData() {
    if (!token) return;
    setSidebarLoading(true);
    const [communitiesResult, circlesResult, hashtagsResult] = await Promise.allSettled([
      api.getJoinedCommunities(token, 10, 0),
      api.getCircles(token),
      api.getTrendingHashtags(token, 8),
    ]);
    if (communitiesResult.status === 'fulfilled') {
      const v = communitiesResult.value;
      setSidebarCommunities(Array.isArray(v) ? v.slice(0, 8) : []);
    }
    if (circlesResult.status === 'fulfilled') {
      const v = circlesResult.value;
      setSidebarCircles(Array.isArray(v) ? v : []);
    }
    if (hashtagsResult.status === 'fulfilled') {
      const v = hashtagsResult.value;
      setSidebarHashtags(Array.isArray(v) ? v.slice(0, 8) : []);
    }
    setSidebarDataLoaded(true);
    setSidebarLoading(false);
  }

  async function loadComposerDestinations() {
    setComposerDestinationsLoading(true);
    try {
      const [circles, joinedCommunitiesFirstPage] = await Promise.all([
        api.getCircles(token),
        api.getJoinedCommunities(token, 20, 0),
      ]);

      const joinedCommunitiesAll: SearchCommunityResult[] = Array.isArray(joinedCommunitiesFirstPage)
        ? [...joinedCommunitiesFirstPage]
        : [];
      let offset = joinedCommunitiesAll.length;
      while (joinedCommunitiesAll.length > 0 && joinedCommunitiesAll.length % 20 === 0) {
        const nextPage = await api.getJoinedCommunities(token, 20, offset);
        if (!Array.isArray(nextPage) || nextPage.length === 0) break;
        joinedCommunitiesAll.push(...nextPage);
        offset += nextPage.length;
        if (nextPage.length < 20) break;
      }

      const safeCircles = Array.isArray(circles) ? circles : [];
      const safeCommunities = joinedCommunitiesAll.filter(
        (community, index, all) => all.findIndex((candidate) => candidate.id === community.id) === index
      );
      setComposerCircles(safeCircles);
      setComposerJoinedCommunities(safeCommunities);

      const hasCommunities = safeCommunities.length > 0;

      if (safeCircles.length > 0) {
        const circleStillExists = safeCircles.some((circle) => circle.id === composerSelectedCircleId);
        if (!circleStillExists && composerSelectedCircleId !== null) setComposerSelectedCircleId(null);
      } else {
        // Keep null to represent Public destination for non-community posts.
        setComposerSelectedCircleId(null);
      }

      if (hasCommunities) {
        const safeNames = new Set(
          safeCommunities.map((community) => community.name).filter((name): name is string => !!name)
        );
        setComposerSelectedCommunityNames((prev) => prev.filter((name) => safeNames.has(name)).slice(0, 3));
      } else {
        setComposerSelectedCommunityNames([]);
      }

      if (safeCircles.length === 0 && !hasCommunities) {
        throw new Error(
          t('home.postComposerDestinationEmpty', {
            defaultValue: 'You need at least one circle or joined community before publishing.',
          })
        );
      }
    } finally {
      setComposerDestinationsLoading(false);
    }
  }

  async function goToComposerDestinationStep() {
    if (composerSubmitting || composerDestinationsLoading) return;
    const trimmedText = composerTextRef.current.trim();
    const longPayload = composerPostType === 'LP' ? getComposerLongPayload() : null;
    const trimmedLongText = longPayload?.long_text || extractPlainTextFromHtml(longPayload?.long_text_rendered_html);
    const hasImages = composerImages.length > 0;
    const hasVideo = !!composerVideo;
    const hasTextContent = composerPostType === 'LP' ? !!trimmedLongText : !!trimmedText;
    if (!hasTextContent && !hasImages && !hasVideo && !composerSharedPost) {
      setError(t('home.postComposerValidation', { defaultValue: 'Write something or attach media.' }));
      return;
    }
    setError('');
    try {
      await loadComposerDestinations();
      setComposerStep('destination');
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not publish your post right now.' }));
    }
  }

  async function submitComposerPost(options?: { saveAsDraft?: boolean }) {
    const saveAsDraft = !!options?.saveAsDraft;
    if (composerSubmitting || composerDestinationsLoading || composerDraftSaving) return;
    if (composerStep === 'compose' && !saveAsDraft) {
      await goToComposerDestinationStep();
      return;
    }
    const trimmedText = composerTextRef.current.trim();
    const longPayload = composerPostType === 'LP' ? getComposerLongPayload() : null;
    const trimmedLongText = longPayload?.long_text || extractPlainTextFromHtml(longPayload?.long_text_rendered_html);
    const hasImages = composerImages.length > 0;
    const hasVideo = !!composerVideo;
    const hasTextContent = composerPostType === 'LP' ? !!trimmedLongText : !!trimmedText;
    if (!hasTextContent && !hasImages && !hasVideo && !composerSharedPost) {
      setError(t('home.postComposerValidation', { defaultValue: 'Write something or attach media.' }));
      return;
    }

    if (composerPostType === 'LP' && saveAsDraft) {
      await saveLongPostDraft(true);
      return;
    }

    const targetCircleId = saveAsDraft ? null : composerSelectedCircleId;
    const targetCommunityNames = saveAsDraft ? [] : composerSelectedCommunityNames.slice(0, 3);

    setComposerSubmitting(true);
    setError('');
    setNotice('');

    try {
      let finalizedPost: FeedPost | null = null;
      let finalizedUuid: string | null = composerDraftUuid || null;

      const postPayload = {
        text: composerPostType === 'LP' ? undefined : (trimmedText || undefined),
        long_text: composerPostType === 'LP' ? longPayload?.long_text : undefined,
        long_text_blocks: composerPostType === 'LP' ? longPayload?.long_text_blocks : undefined,
        long_text_rendered_html: composerPostType === 'LP' ? longPayload?.long_text_rendered_html : undefined,
        long_text_version: composerPostType === 'LP' ? longPayload?.long_text_version : undefined,
        draft_expiry_days: composerPostType === 'LP' ? longPayload?.draft_expiry_days : undefined,
        type: composerPostType,
      } as const;

      const createPrimaryPost = async (primaryImage?: Blob | null, isDraft = false) => {
        return api.createPost(token, {
          ...postPayload,
          image: primaryImage,
          video: composerVideo?.file,
          circle_id: targetCircleId ? [targetCircleId] : undefined,
          community_names: targetCommunityNames.length > 0 ? targetCommunityNames : undefined,
          is_draft: isDraft || undefined,
          shared_post_uuid: composerSharedPost?.uuid,
        });
      };

      if (composerPostType === 'LP' && composerDraftUuid && !hasImages && !hasVideo && !saveAsDraft) {
        await api.updatePostContent(token, composerDraftUuid, {
          long_text: longPayload?.long_text,
          long_text_blocks: longPayload?.long_text_blocks,
          long_text_rendered_html: longPayload?.long_text_rendered_html,
          long_text_version: longPayload?.long_text_version,
          is_draft: true,
          draft_expiry_days: longPayload?.draft_expiry_days,
          type: 'LP',
        });
        await api.updatePostTargets(token, composerDraftUuid, {
          circle_id: targetCircleId ? [targetCircleId] : [],
          community_names: targetCommunityNames,
        });
        finalizedPost = await api.publishPost(token, composerDraftUuid);
        finalizedUuid = composerDraftUuid;
      } else if (hasImages && composerImages.length > 1) {
        const draftPost = await createPrimaryPost(await getUploadBlob(composerImages[0]!), true);

        if (!draftPost.uuid) {
          throw new Error(t('home.postComposerFailed', { defaultValue: 'Could not publish your post right now.' }));
        }
        finalizedUuid = draftPost.uuid;

        for (let index = 1; index < composerImages.length; index += 1) {
          const image = composerImages[index];
          await api.addPostMedia(token, draftPost.uuid, {
            file: await getUploadBlob(image),
            order: index + 1,
          });
        }
        if (!saveAsDraft) {
          finalizedPost = await api.publishPost(token, draftPost.uuid);
        }
      } else {
        const createdPost = await createPrimaryPost(
          composerImages[0] ? await getUploadBlob(composerImages[0]) : undefined,
          saveAsDraft,
        );
        finalizedPost = createdPost;
        finalizedUuid = createdPost.uuid || finalizedUuid;
        if (saveAsDraft && composerPostType === 'LP') {
          setComposerDraftUuid(createdPost.uuid || null);
          setComposerDraftSavedAt(new Date().toISOString());
        }
      }

      // Guardrail: don't show false success if backend returned an OK without
      // a verifiable published post payload.
      if (!saveAsDraft) {
        const hasPublishIdentity = !!finalizedPost?.id || !!finalizedUuid;
        if (!hasPublishIdentity) {
          console.error('[ComposerPublish] Missing post identity in publish response', {
            composerPostType,
            finalizedPost,
            finalizedUuid,
            hasImages,
            hasVideo,
            longTextLength: trimmedLongText?.length || 0,
          });
          throw new Error(
            t('home.postComposerPublishVerifyFailed', {
              defaultValue: 'Post publish could not be verified. Please reopen drafts and retry.',
            })
          );
        }

        let verified = false;
        if (finalizedPost?.uuid) {
          try {
            await api.getPostByUuid(token, finalizedPost.uuid);
            verified = true;
          } catch {
            verified = false;
          }
        }
        if (!verified && finalizedUuid && user?.username) {
          try {
            // API caps this endpoint at count <= 20.
            const recentMine = await api.getUserPosts(token, user.username, 20);
            verified = recentMine.some(
              (post) =>
                (typeof finalizedPost?.id === 'number' && post.id === finalizedPost.id)
                || (post.uuid && post.uuid === finalizedUuid)
            );
          } catch {
            verified = false;
          }
        }
        if (!verified) {
          console.error('[ComposerPublish] Publish verification failed', {
            composerPostType,
            finalizedPost,
            finalizedUuid,
            user: user?.username,
            hasImages,
            hasVideo,
            longTextLength: trimmedLongText?.length || 0,
          });
          throw new Error(
            t('home.postComposerPublishVerifyFailed', {
              defaultValue: 'Post publish could not be verified. Please reopen drafts and retry.',
            })
          );
        }
      }

      closeComposerModal();
      setNotice(
        saveAsDraft
          ? t('home.postComposerDraftSuccess', { defaultValue: 'Draft saved.' })
          : t('home.postComposerSuccess', { defaultValue: 'Post published.' })
      );
      await loadFeed(activeFeed);
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not publish your post right now.' }));
    } finally {
      setComposerSubmitting(false);
    }
  }

  function handleSearchFocus() {
    if (searchBlurTimerRef.current) {
      clearTimeout(searchBlurTimerRef.current);
      searchBlurTimerRef.current = null;
    }
    setSearchFocused(true);
  }

  function handleSearchBlur() {
    searchBlurTimerRef.current = setTimeout(() => {
      setSearchFocused(false);
    }, 180);
  }

  function closeSearchDropdown() {
    if (searchBlurTimerRef.current) {
      clearTimeout(searchBlurTimerRef.current);
      searchBlurTimerRef.current = null;
    }
    setSearchFocused(false);
  }

  async function handleShowAllSearchResults() {
    const query = searchCurrentTextRef.current.trim();
    if (query.length < 2) return;
    closeSearchDropdown();
    setSearchResultsActive(true);
    setSearchResultsQuery(query);
    onNavigate({ screen: 'search', query });
    if (user?.username) {
      const key = getSearchResultsStateKey(user.username);
      if (key) {
        await AsyncStorage.setItem(
          key,
          JSON.stringify({
            query,
            updated_at: Date.now(),
          })
        );
      }
    }
    await loadSearchResults(query, 20, setSearchResultsLoading, committedSearchRequestSeqRef);
  }

  async function handleBackToHomeFeed() {
    if (user?.username) {
      const key = getSearchResultsStateKey(user.username);
      if (key) await AsyncStorage.removeItem(key);
    }
    setSearchResultsActive(false);
    setSearchResultsLoading(false);
    setSearchResultsQuery('');
    searchCurrentTextRef.current = '';
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearchQuery('');
    setSearchExternalResetKey((prev) => prev + 1);
    closeSearchDropdown();
    setActiveFeed('home');
    onNavigate({ screen: 'feed', feed: 'home' });
    await loadFeed('home');
  }

  function handleSelectSearchUser(username?: string) {
    if (!username) return;
    closeSearchDropdown();
    onNavigate({ screen: 'profile', username });
  }

  function handleSelectSearchCommunity(name?: string) {
    if (!name) return;
    closeSearchDropdown();
    onNavigate({ screen: 'community', name });
  }

  function handleSelectSearchHashtag(name?: string) {
    if (!name) return;
    closeSearchDropdown();
    onNavigate({ screen: 'hashtag', name });
  }

  // Keep the last non-post route as the background context while a post modal is open.
  const displayRoute = route.screen === 'post' ? lastNonPostRouteRef.current : route;
  const viewingProfileRoute = displayRoute.screen === 'profile' || displayRoute.screen === 'me';
  const viewingCommunitiesRoute = displayRoute.screen === 'communities';
  const viewingCommunityRoute = displayRoute.screen === 'community';
  const viewingHashtagRoute = displayRoute.screen === 'hashtag';
  const viewingBlockedRoute = displayRoute.screen === 'blocked';
  const viewingManageCommunitiesRoute = displayRoute.screen === 'manage-communities';
  const viewingMutedCommunitiesRoute = displayRoute.screen === 'muted-communities';
  const viewingSettingsRoute = displayRoute.screen === 'settings';
  const viewingFollowPeopleRoute =
    displayRoute.screen === 'followers' ||
    displayRoute.screen === 'following' ||
    viewingBlockedRoute;
  const profileRouteUsername = displayRoute.screen === 'profile'
    ? displayRoute.username
    : user?.username || '';
  const communityRouteName = displayRoute.screen === 'community' ? displayRoute.name : '';
  const canManageCurrentCommunity = React.useMemo(() => {
    if (!communityInfo || typeof user?.id !== 'number') return false;
    if (communityInfo.is_creator) return true;
    const memberships = Array.isArray(communityInfo.memberships) ? communityInfo.memberships : [];
    const mine = memberships.find((row: any) => row?.user_id === user.id);
    return !!mine?.is_administrator || !!mine?.is_moderator;
  }, [communityInfo, user?.id]);
  const hashtagRouteName = displayRoute.screen === 'hashtag' ? displayRoute.name : '';
  const SIDEBAR_BREAKPOINT = 1280;
  const SIDEBAR_LEFT_W = 260;
  const SIDEBAR_RIGHT_W = 260;
  const showSidebars = viewportWidth >= SIDEBAR_BREAKPOINT;
  const showHomeShellSidebars = showSidebars && !viewingCommunitiesRoute;
  const showBottomTabs = !showSidebars;
  // On phones, use every pixel of the viewport. Below this breakpoint we strip
  // the outer horizontal padding and card chrome so content runs edge-to-edge.
  const isEdgeToEdge = viewportWidth < 700;
  const activeBottomTab: BottomTab = (() => {
    if (notifDrawerOpen) return 'notifications';
    const screen = displayRoute.screen;
    if (screen === 'feed') return 'home';
    if (
      screen === 'communities' ||
      screen === 'community' ||
      screen === 'manage-communities' ||
      screen === 'muted-communities'
    ) return 'communities';
    if (
      screen === 'me' ||
      screen === 'profile' ||
      screen === 'followers' ||
      screen === 'following' ||
      screen === 'blocked' ||
      screen === 'circles' ||
      screen === 'lists' ||
      screen === 'settings'
    ) return 'profile';
    return null;
  })();

  const showSearchDropdown = searchFocused && searchQuery.trim().length >= 2;
  const hasAnySearchResults = searchUsers.length > 0 || searchCommunities.length > 0 || searchHashtags.length > 0;
  const hasActivePostMedia = postHasMedia(activePost);
  const composerCommunitySearchTrimmed = composerCommunitySearch.trim().toLowerCase();
  const filteredComposerJoinedCommunities = composerCommunitySearchTrimmed
    ? composerJoinedCommunities.filter((community) => {
        const name = (community.name || '').toLowerCase();
        const title = (community.title || '').toLowerCase();
        return name.includes(composerCommunitySearchTrimmed) || title.includes(composerCommunitySearchTrimmed);
      })
    : composerJoinedCommunities;

  const moveCommunitiesSearchTrimmed = moveCommunitiesSearch.trim().toLowerCase();
  const filteredMoveCommunitiesJoined = moveCommunitiesSearchTrimmed
    ? moveCommunitiesJoined.filter((community) => {
        const name = (community.name || '').toLowerCase();
        const title = (community.title || '').toLowerCase();
        return name.includes(moveCommunitiesSearchTrimmed) || title.includes(moveCommunitiesSearchTrimmed);
      })
    : moveCommunitiesJoined;

  function sanitizeCircleColor(value?: string) {
    if (!value || typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed;
    if (/^rgb(a)?\(/i.test(trimmed)) return trimmed;
    if (/^hsl(a)?\(/i.test(trimmed)) return trimmed;
    return undefined;
  }
  const showingMainSearchResults = !viewingProfileRoute &&
    !viewingCommunitiesRoute &&
    !viewingManageCommunitiesRoute &&
    !viewingCommunityRoute &&
    !viewingHashtagRoute &&
    searchResultsActive &&
    searchResultsQuery.length >= 2;
  const isWideSearchResultsLayout = viewportWidth >= 1200;
  const isCompactProfileLayout = viewportWidth < 1180;
  const profileTabs: Array<{ key: ProfileTabKey; label: string }> = [
    { key: 'all', label: t('home.profileTabAll') },
    { key: 'about', label: t('home.profileTabAbout') },
    { key: 'followers', label: t('home.profileTabFollowers') },
    { key: 'photos', label: t('home.profileTabPhotos') },
    { key: 'reels', label: t('home.profileTabReels') },
    { key: 'more', label: t('home.profileTabMore') },
  ];
  const showFeedFollowButton = !viewingProfileRoute && !viewingCommunitiesRoute && !viewingManageCommunitiesRoute && !viewingMutedCommunitiesRoute && !viewingCommunityRoute && !viewingHashtagRoute && !viewingFollowPeopleRoute && !viewingSettingsRoute && !showingMainSearchResults && displayRoute.screen !== 'circles' && displayRoute.screen !== 'lists';
  const reactionListModalHeight = Math.max(420, Math.min(Math.floor(viewportHeight * 0.8), 740));
  const composerDrawerWidth =
    Platform.OS === 'web'
      ? composerStep === 'compose'
        ? Math.min(980, viewportWidth)
        : Math.min(840, viewportWidth)
      : viewportWidth;

  function handleNavigateProfile(username: string) {
    onNavigate({ screen: 'profile', username });
  }

  function handleNavigateHashtag(tag: string) {
    onNavigate({ screen: 'search', query: `#${tag}` });
  }

  function handleNavigateHashtagFromPostDetail(tag: string) {
    closeReactionList();
    clearWebFocus();
    setActivePost(null);
    onNavigate({ screen: 'search', query: `#${tag}` } as any, true);
  }

  function handleNavigateProfileFromPostDetail(username: string) {
    closeReactionList();
    clearWebFocus();
    setActivePost(null);
    onNavigate({ screen: 'profile', username }, true);
  }

  function handleNavigateCommunity(name: string) {
    onNavigate({ screen: 'community', name });
  }

  function renderPostCard(
    post: FeedPost,
    variant: 'feed' | 'profile' = 'feed',
    pinnedPostsSource: FeedPost[] = myPinnedPosts,
    options?: { allowExpandControl?: boolean; onToggleCommunityPinPost?: (post: FeedPost) => void | Promise<void>; onToggleClosePost?: (post: FeedPost) => void | Promise<void> }
  ) {
    const PIN_LIMIT = 5;
    const pinnedIndex = pinnedPostsSource.findIndex((item) => item.id === post.id);
    return (
      <PostCard
        key={`${variant}-${activeFeed}-${post.id}`}
        post={post}
        variant={variant}
        styles={styles}
        c={c}
        t={t}
        currentUsername={user?.username}
        expandedPostIds={expandedPostIds}
        commentBoxPostIds={commentBoxPostIds}
        localComments={localComments}
        commentRepliesById={commentRepliesById}
        commentRepliesExpanded={commentRepliesExpanded}
        commentRepliesLoadingById={commentRepliesLoadingById}
        draftCommentMediaByPostId={draftCommentMediaByPostId}
        draftReplyMediaByCommentId={draftReplyMediaByCommentId}
        editingCommentById={editingCommentById}
        editingReplyById={editingReplyById}
        commentMutationLoadingById={commentMutationLoadingById}
        reactionGroups={reactionGroups}
        reactionPickerLoading={reactionPickerLoading}
        reactionActionLoading={reactionActionLoading}
        followStateByUsername={followStateByUsername}
        followActionLoadingByUsername={followActionLoadingByUsername}
        showFollowButton={variant === 'feed' && showFeedFollowButton}
        onEnsureReactionGroups={ensureReactionGroups}
        onReactToComment={reactToComment}
        onReactToPostWithEmoji={reactToPostWithEmoji}
        onToggleFollow={handleToggleFollow}
        onOpenPostDetail={openPostDetail}
        onToggleExpand={toggleExpand}
        onOpenReactionList={openReactionList}
        onOpenReactionPicker={openReactionPicker}
        onToggleCommentBox={toggleCommentBox}
        onToggleCommentReplies={toggleCommentReplies}
        onSharePost={handleSharePost}
        onRepostPost={handleRepostPost}
        onOpenLink={openLink}
        onPickDraftCommentImage={pickDraftCommentImage}
        onPickDraftReplyImage={pickDraftReplyImage}
        onSetDraftCommentGif={setDraftCommentGif}
        onSetDraftReplyGif={setDraftReplyGif}
        onClearDraftCommentMedia={clearDraftCommentMedia}
        onClearDraftReplyMedia={clearDraftReplyMedia}
        onStartEditingComment={startEditingComment}
        onCancelEditingComment={cancelEditingComment}
        onSaveEditedComment={saveEditedComment}
        onDeleteComment={deleteComment}
        onSubmitComment={submitComment}
        onSubmitReply={submitReply}
        onOpenReportPostModal={openReportPostModal}
        onReportComment={openCommentReportModal}
        onEditPost={editPost}
        onOpenLongPostEdit={openLongPostEdit}
        onDeletePost={deletePost}
        onMovePostCommunities={handleMovePostCommunities}
        onTogglePinPost={togglePinPost}
        pinnedPostsCount={pinnedPostsSource.length}
        pinnedPostsLimit={PIN_LIMIT}
        pinnedDisplayIndex={pinnedIndex >= 0 ? pinnedIndex + 1 : null}
        pinnedDisplayLimit={PIN_LIMIT}
        onNavigateProfile={handleNavigateProfile}
        onNavigateHashtag={handleNavigateHashtag}
        onNavigateCommunity={handleNavigateCommunity}
        onFilterCommunityPostsByUser={route.screen === 'community' ? filterCommunityPostsByUser : undefined}
        token={token}
        onFetchUserProfile={api.getUserProfile}
        getPostText={getPostText}
        getPostLengthType={getPostLengthType}
        getPostReactionCount={getPostReactionCount}
        getPostCommentsCount={getPostCommentsCount}
        autoPlayMedia={autoPlayMedia}
        isPostDetailOpen={!!activePost}
        allowExpandControl={options?.allowExpandControl ?? true}
        onToggleCommunityPinPost={options?.onToggleCommunityPinPost}
        onToggleClosePost={options?.onToggleClosePost}
        translationLanguageCode={(user as any)?.translation_language?.code}
      />
    );
  }

  // ── Scroll-driven top-bar auto-hide (mobile only) ─────────────────────────
  // Top nav + mobile feed-tab bar collapse upward when the user scrolls down
  // and reappear when they scroll up. Bottom tab bar stays anchored.
  const topChromeTranslateY = useRef(new Animated.Value(0)).current;
  const [topChromeHeight, setTopChromeHeight] = useState(60);
  const lastScrollYRef = useRef(0);
  const topBarHiddenRef = useRef(false);
  // The web DOM scroll listener is registered once with stale closures; we
  // call through this ref so it always hits the latest handler.
  const topBarScrollHandlerRef = useRef<(y: number) => void>(() => {});

  function handleTopBarOnScroll(currentY: number) {
    if (!showBottomTabs) return;
    const delta = currentY - lastScrollYRef.current;
    lastScrollYRef.current = currentY;

    // Always show near the top — don't leave bars hidden when user pulls back.
    if (currentY < 16) {
      if (topBarHiddenRef.current) {
        topBarHiddenRef.current = false;
        Animated.timing(topChromeTranslateY, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }).start();
      }
      return;
    }

    if (delta > 8 && !topBarHiddenRef.current) {
      topBarHiddenRef.current = true;
      Animated.timing(topChromeTranslateY, {
        toValue: -topChromeHeight,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else if (delta < -8 && topBarHiddenRef.current) {
      topBarHiddenRef.current = false;
      Animated.timing(topChromeTranslateY, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }

  // Keep the ref pointing at the latest closure (captures fresh topChromeHeight
  // and showBottomTabs) for the DOM scroll listener to call.
  topBarScrollHandlerRef.current = handleTopBarOnScroll;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <Animated.View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h && h !== topChromeHeight) setTopChromeHeight(h);
        }}
        style={[
          // Top chrome must stack above feed-post stacking contexts
          // (feedPostHeader is zIndex 1600). Applied on both desktop and
          // mobile web — otherwise Animated.View's implicit transform
          // creates a stacking context that traps topNav's zIndex below
          // sidebar/feed siblings, hiding the search dropdown.
          { zIndex: 1700, position: 'relative' as const },
          showBottomTabs && {
            position: 'absolute' as const,
            top: 0,
            left: 0,
            right: 0,
            transform: [{ translateY: topChromeTranslateY }],
          },
        ]}
      >
      <View style={[styles.topNav, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={styles.topNavLeft}>
          {showBottomTabs ? null : (
            <TouchableOpacity
              style={[styles.topNavBrand, { backgroundColor: c.primary }]}
              activeOpacity={0.85}
              onPress={handleBackToHomeFeed}
              accessibilityLabel={t('home.backToHomeFeedAction')}
            >
              <Text style={styles.topNavBrandLetter}>O</Text>
            </TouchableOpacity>
          )}
          <View style={styles.topNavSearchWrap}>
            <View style={[styles.topNavSearch, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
              <MaterialCommunityIcons name="magnify" size={18} color={c.textMuted} />
              <TextInput
                key={searchExternalResetKey}
                ref={searchInputRef}
                onChangeText={(value) => {
                  searchCurrentTextRef.current = value;
                  if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                  searchDebounceRef.current = setTimeout(() => setSearchQuery(value), 200);
                }}
                onFocus={handleSearchFocus}
                onBlur={handleSearchBlur}
                onSubmitEditing={handleShowAllSearchResults}
                placeholder={t('home.searchPlaceholder')}
                placeholderTextColor={c.placeholder}
                style={[styles.topNavSearchInput, { color: c.textPrimary }]}
              />
            </View>

            {showSearchDropdown ? (
              <View style={[styles.searchDropdown, { backgroundColor: c.surface, borderColor: c.border }]}>
                {searchLoading ? (
                  <View style={styles.searchDropdownLoading}>
                    <ActivityIndicator color={c.primary} size="small" />
                  </View>
                ) : null}

                {!searchLoading ? (
                  <ScrollView
                    style={styles.searchDropdownScroll}
                    contentContainerStyle={styles.searchDropdownScrollContent}
                    keyboardShouldPersistTaps="handled"
                  >
                    <TouchableOpacity
                      style={[styles.searchShowAllButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      onPress={handleShowAllSearchResults}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.searchShowAllButtonText, { color: c.textLink }]}>
                        {t('home.searchShowAllAction')}
                      </Text>
                    </TouchableOpacity>

                    <View style={styles.searchSection}>
                      <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>
                        {t('home.searchSectionUsers')}
                      </Text>
                      {searchUsers.length === 0 ? (
                        <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>
                          {t('home.searchNoUsers')}
                        </Text>
                      ) : (
                        searchUsers.map((item) => (
                          <TouchableOpacity
                            key={`search-user-${item.id}`}
                            style={[styles.searchResultRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                            activeOpacity={0.85}
                            onPress={() => handleSelectSearchUser(item.username)}
                          >
                            <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                              {item.profile?.avatar ? (
                                <Image source={{ uri: item.profile.avatar }} style={styles.searchAvatarImage} resizeMode="cover" />
                              ) : (
                                <Text style={styles.searchAvatarLetter}>
                                  {(item.username?.[0] || t('home.unknownUser')[0] || 'U').toUpperCase()}
                                </Text>
                              )}
                            </View>
                            <View style={styles.searchResultMeta}>
                              <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>
                                @{item.username || t('home.unknownUser')}
                              </Text>
                              <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>
                                {item.profile?.name || t('home.searchNoDisplayName')}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>

                    <View style={styles.searchSection}>
                      <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>
                        {t('home.searchSectionCommunities')}
                      </Text>
                      {searchCommunities.length === 0 ? (
                        <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>
                          {t('home.searchNoCommunities')}
                        </Text>
                      ) : (
                        searchCommunities.map((item) => (
                          <TouchableOpacity
                            key={`search-community-${item.id}`}
                            style={[styles.searchResultRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                            activeOpacity={0.85}
                            onPress={() => handleSelectSearchCommunity(item.name)}
                          >
                            <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                              {item.avatar ? (
                                <Image source={{ uri: item.avatar }} style={styles.searchAvatarImage} resizeMode="cover" />
                              ) : (
                                <MaterialCommunityIcons name="account-group-outline" size={16} color="#fff" />
                              )}
                            </View>
                            <View style={styles.searchResultMeta}>
                              <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>
                                c/{item.name || t('home.unknownUser')}
                              </Text>
                              <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>
                                {item.title || t('home.searchNoCommunityTitle')}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>

                    <View style={styles.searchSection}>
                      <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>
                        {t('home.searchSectionHashtags')}
                      </Text>
                      {searchHashtags.length === 0 ? (
                        <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>
                          {t('home.searchNoHashtags')}
                        </Text>
                      ) : (
                        searchHashtags.map((item) => (
                          <TouchableOpacity
                            key={`search-hashtag-${item.id}`}
                            style={[styles.searchResultRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                            activeOpacity={0.85}
                            onPress={() => handleSelectSearchHashtag(item.name)}
                          >
                            <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                              {item.image || item.emoji?.image ? (
                                <Image source={{ uri: item.image || item.emoji?.image }} style={styles.searchAvatarImage} resizeMode="cover" />
                              ) : (
                                <MaterialCommunityIcons name="pound" size={16} color="#fff" />
                              )}
                            </View>
                            <View style={styles.searchResultMeta}>
                              <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>
                                #{item.name || t('home.unknownUser')}
                              </Text>
                              <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>
                                {t('home.searchHashtagPostsCount', { count: item.posts_count || 0 })}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>

                    {searchError ? (
                      <Text style={[styles.searchSectionError, { color: c.errorText }]}>
                        {searchError}
                      </Text>
                    ) : null}

                    {!searchError && !hasAnySearchResults ? (
                      <Text style={[styles.searchSectionEmptyGlobal, { color: c.textMuted }]}>
                        {t('home.searchNoResults')}
                      </Text>
                    ) : null}
                  </ScrollView>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        <View style={[styles.topNavCenter, showBottomTabs && { display: 'none' as const }]}>
          {feedTabs.map((tab) => {
            const isActive = tab.key === activeFeed;
            return (
              <View key={tab.key} style={styles.topNavFeedWrap}>
                {tooltipTab === tab.key ? (
                  <View style={[styles.feedTooltip, { backgroundColor: c.surface, borderColor: c.border }]}>
                    <Text style={[styles.feedTooltipText, { color: c.textPrimary }]}>
                      {tab.tooltip}
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  style={[styles.topNavFeedButton, { borderBottomColor: isActive ? c.primary : 'transparent' }]}
                  onPress={() => {
                    clearTooltipTimer();
                    setTooltipTab(null);
                    handleSelectFeed(tab.key);
                  }}
                  onHoverIn={() => startTooltipDelay(tab.key)}
                  onHoverOut={() => {
                    clearTooltipTimer();
                    setTooltipTab((current) => (current === tab.key ? null : current));
                  }}
                  onLongPress={() => setTooltipTab(tab.key)}
                  onPressOut={() => {
                    clearTooltipTimer();
                    setTooltipTab((current) => (current === tab.key ? null : current));
                  }}
                  accessibilityLabel={`${tab.label}. ${tab.tooltip}`}
                >
                  <MaterialCommunityIcons
                    name={tab.icon as any}
                    size={22}
                    color={isActive ? c.primary : c.textMuted}
                  />
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={[styles.topNavRight, showBottomTabs && { flex: 0 as const, gap: 4 }]}>
          {showBottomTabs ? null : (
            <>
              <TouchableOpacity style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]} activeOpacity={0.85}>
                <MaterialCommunityIcons name="message-outline" size={18} color={c.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                activeOpacity={0.85}
                onPress={() => void handleOpenNotifications()}
              >
                <MaterialCommunityIcons
                  name={unreadCount > 0 ? 'bell-badge-outline' : 'bell-outline'}
                  size={18}
                  color={unreadCount > 0 ? c.primary : c.textSecondary}
                />
                {unreadCount > 0 ? (
                  <View style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    minWidth: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: c.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 2,
                  }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', lineHeight: 12 }}>
                      {unreadCount > 99 ? '99+' : String(unreadCount)}
                    </Text>
                  </View>
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.topNavUtility,
                  viewingCommunitiesRoute
                    ? { backgroundColor: `${c.primary}20`, borderWidth: 1, borderColor: c.primary }
                    : { backgroundColor: c.inputBackground },
                ]}
                activeOpacity={0.85}
                onPress={() => onNavigate({ screen: 'communities' })}
                accessibilityLabel={t('home.sideMenuCommunities', { defaultValue: 'Communities' })}
              >
                <MaterialCommunityIcons
                  name="account-group-outline"
                  size={18}
                  color={viewingCommunitiesRoute ? c.primary : c.textSecondary}
                />
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity
            style={[styles.topNavProfile, { backgroundColor: user ? c.primary : 'transparent' }]}
            activeOpacity={0.85}
            onPress={() => setMenuOpen(true)}
            accessibilityLabel={t('home.profileMenuTitle')}
            disabled={!user}
          >
            {user && (
              user.profile?.avatar
                ? <Image source={{ uri: user.profile.avatar }} style={styles.topNavProfileImage} resizeMode="cover" />
                : <Text style={styles.topNavProfileText}>{user.username[0].toUpperCase()}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {showBottomTabs && displayRoute.screen === 'feed' ? (
        <View style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: c.border,
          backgroundColor: c.surface,
        }}>
          {feedTabs.map((tab) => {
            const isActive = tab.key === activeFeed;
            return (
              <TouchableOpacity
                key={`mobile-feed-tab-${tab.key}`}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 11,
                  borderBottomWidth: 2,
                  borderBottomColor: isActive ? c.primary : 'transparent',
                }}
                activeOpacity={0.75}
                onPress={() => handleSelectFeed(tab.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={tab.label}
              >
                <MaterialCommunityIcons
                  name={tab.icon as any}
                  size={18}
                  color={isActive ? c.primary : c.textMuted}
                />
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: isActive ? c.primary : c.textMuted,
                  }}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
      </Animated.View>

      <Modal
        visible={menuDrawerMounted}
        transparent
        animationType="none"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Animated.View
          style={[
            styles.drawerBackdrop,
            { opacity: menuDrawerBackdropOpacity },
          ]}
          pointerEvents="auto"
        >
          <Pressable style={{ flex: 1 }} onPress={() => setMenuOpen(false)} />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawerPanel,
            {
              width: sideDrawerWidth,
              backgroundColor: c.surface,
              transform: [{ translateX: menuDrawerTranslateX }],
            },
          ]}
        >
            <View style={[styles.sideMenuCard, { backgroundColor: c.surface, borderColor: c.border, width: '100%' }]}>

              {/* ── Header ────────────────────────────────── */}
              <View style={[styles.sideMenuHeader, { borderBottomColor: c.border }]}>
                <View style={[styles.sideMenuAvatar, { backgroundColor: c.primary }]}>
                  {user?.profile?.avatar
                    ? <Image source={{ uri: user.profile.avatar }} style={styles.sideMenuAvatarImage} resizeMode="cover" />
                    : <Text style={styles.sideMenuAvatarLetter}>{(user?.username?.[0] || '').toUpperCase()}</Text>
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sideMenuUsername, { color: c.textPrimary }]} numberOfLines={1}>
                    {user?.profile?.name || user?.username || ''}
                  </Text>
                  <Text style={[styles.sideMenuHandle, { color: c.textMuted }]} numberOfLines={1}>
                    @{user?.username || ''}
                  </Text>
                </View>
                <View style={styles.sideMenuHeaderActions}>
                  <TouchableOpacity
                    style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                    onPress={() => {
                      toggleTheme();
                    }}
                    activeOpacity={0.85}
                    accessibilityLabel={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
                    >
                      <MaterialCommunityIcons
                        name={isDark ? 'weather-sunny' : 'weather-night'}
                        size={18}
                        color={c.textSecondary}
                      />
                    </TouchableOpacity>
                </View>
              </View>

              {/* ── MY OPENSPACE ──────────────────────────── */}
              <Text style={[styles.sideMenuSectionLabel, { color: c.textMuted }]}>
                {t('home.sideMenuSectionMyOpenspace', { defaultValue: 'MY OPENSPACE' })}
              </Text>

              {[
                { icon: 'account-outline', label: t('home.sideMenuProfile', { defaultValue: 'Profile' }), onPress: () => { setMenuOpen(false); onNavigate({ screen: 'me' }); } },
                { icon: 'account-group-outline', label: t('home.sideMenuCommunities', { defaultValue: 'Communities' }), onPress: () => { setMenuOpen(false); onNavigate({ screen: 'communities' }); } },
                { icon: 'shield-crown-outline', label: t('home.sideMenuManageCommunities', { defaultValue: 'Manage Communities' }), onPress: () => { setMenuOpen(false); onNavigate({ screen: 'manage-communities' }); } },
                { icon: 'bell-off-outline', label: t('home.sideMenuMutedCommunities', { defaultValue: 'Muted Communities' }), onPress: () => { setMenuOpen(false); onNavigate({ screen: 'muted-communities' }); } },
                { icon: 'circle-outline', label: t('home.sideMenuCircles', { defaultValue: 'Circles' }), onPress: () => { setMenuOpen(false); onNavigate({ screen: 'circles' }); } },
                { icon: 'format-list-bulleted', label: t('home.sideMenuLists', { defaultValue: 'Lists' }), onPress: () => { setMenuOpen(false); onNavigate({ screen: 'lists' }); } },
                { icon: 'account-arrow-down-outline', label: t('home.sideMenuFollowers', { defaultValue: 'Followers' }), onPress: () => { setMenuOpen(false); onNavigate({ screen: 'followers' }); } },
                { icon: 'account-arrow-up-outline', label: t('home.sideMenuFollowing', { defaultValue: 'Following' }), onPress: () => { setMenuOpen(false); onNavigate({ screen: 'following' }); } },
                { icon: 'email-plus-outline', label: t('home.sideMenuInvites', { defaultValue: 'Invites' }), onPress: handleOpenInviteDrawerFromMenu },
                ...(user?.is_superuser ? [{ icon: 'shield-check-outline', label: t('home.sideMenuModerationTasks', { defaultValue: 'Moderation tasks' }), badge: (user?.pending_communities_moderated_objects_count ?? 0) > 0 ? user.pending_communities_moderated_objects_count : undefined, onPress: () => { setMenuOpen(false); setModerationTasksStatus('P'); setModerationTasksOpen(true); loadModerationTasks('P'); } }] : []),
                { icon: 'gavel', label: t('home.sideMenuModerationPenalties', { defaultValue: 'Moderation penalties' }), badge: undefined, onPress: () => { setMenuOpen(false); setModerationPenaltiesOpen(true); loadUserPenalties(); } },
              ].map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.sideMenuItem, { borderColor: c.border }]}
                  activeOpacity={0.75}
                  onPress={item.onPress}
                >
                  <MaterialCommunityIcons name={item.icon as any} size={18} color={c.textSecondary} />
                  <Text style={[styles.sideMenuItemText, { color: c.textPrimary }]}>{item.label}</Text>
                  {item.badge != null && item.badge > 0 ? (
                    <View style={{ marginLeft: 'auto', backgroundColor: '#dc2626', borderRadius: 999, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{item.badge > 99 ? '99+' : item.badge}</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              ))}

              {/* ── APP & ACCOUNT ─────────────────────────── */}
              <Text style={[styles.sideMenuSectionLabel, { color: c.textMuted, marginTop: 6 }]}>
                {t('home.sideMenuSectionAppAccount', { defaultValue: 'APP & ACCOUNT' })}
              </Text>

              {[
                { icon: 'cog-outline', label: t('home.sideMenuSettings', { defaultValue: 'Settings' }), onPress: handleOpenSettingsFromMenu },
                { icon: 'account-cog-outline', label: t('home.linkedAccountsTitle'), onPress: () => { setMenuOpen(false); setLinkedAccountsOpen(true); } },
                { icon: 'help-circle-outline', label: t('home.sideMenuSupport', { defaultValue: 'Support & Feedback' }), onPress: () => { setMenuOpen(false); setNotice(t('home.sideMenuSupportComingSoon', { defaultValue: 'Support & Feedback — coming soon' })); } },
              ].map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.sideMenuItem, { borderColor: c.border }]}
                  activeOpacity={0.75}
                  onPress={item.onPress}
                >
                  <MaterialCommunityIcons name={item.icon as any} size={18} color={c.textSecondary} />
                  <Text style={[styles.sideMenuItemText, { color: c.textPrimary }]}>{item.label}</Text>
                </TouchableOpacity>
              ))}

              {/* Logout */}
              <TouchableOpacity
                style={[styles.sideMenuLogout, { borderColor: c.border }]}
                activeOpacity={0.75}
                onPress={() => { setMenuOpen(false); onLogout(); }}
              >
                <MaterialCommunityIcons name="logout" size={18} color={c.logoutText} />
                <Text style={[styles.sideMenuItemText, { color: c.logoutText }]}>
                  {t('auth.signOut')}
                </Text>
              </TouchableOpacity>

            </View>
        </Animated.View>
      </Modal>

      <Modal
        visible={linkedAccountsDrawerMounted}
        transparent
        animationType="none"
        onRequestClose={() => setLinkedAccountsOpen(false)}
      >
        <Animated.View
          style={[
            styles.drawerBackdrop,
            { opacity: linkedAccountsDrawerBackdropOpacity },
          ]}
          pointerEvents="auto"
        >
          <Pressable style={{ flex: 1 }} onPress={() => setLinkedAccountsOpen(false)} />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawerPanel,
            {
              width: sideDrawerWidth,
              backgroundColor: c.surface,
              transform: [{ translateX: linkedAccountsDrawerTranslateX }],
            },
          ]}
        >
          <View style={styles.settingsDrawerHeader}>
            <Text style={[styles.settingsDrawerTitle, { color: c.textPrimary }]}>
              {t('home.linkedAccountsTitle')}
            </Text>
          </View>

          <Text style={[styles.linkedSubtitle, { color: c.textMuted }]}>
            {t('home.linkedAccountsDescription')}
          </Text>

          {identitiesLoading ? (
            <ActivityIndicator color={c.primary} size="small" />
          ) : (
            <View style={styles.providerList}>
              {providerOrder.map((provider) => {
                const identity = getLinkedIdentity(provider);
                const isLoadingProvider = providerLoading === provider;
                const isLinked = !!identity;

                return (
                  <View
                    key={provider}
                    style={[styles.providerRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  >
                    <View style={styles.providerMeta}>
                      <MaterialCommunityIcons
                        name={getProviderIcon(provider)}
                        size={18}
                        color={provider === 'google' ? '#DB4437' : c.textPrimary}
                      />
                      <View style={styles.providerTextWrap}>
                        <Text style={[styles.providerName, { color: c.textPrimary }]}>
                          {getProviderName(provider)}
                        </Text>
                        <Text style={[styles.providerStatus, { color: c.textMuted }]}>
                          {isLinked
                            ? t('home.linkedStatusWithEmail', { email: identity?.email || t('home.linkedStatusConnected') })
                            : t('home.linkedStatusNotConnected')}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.providerButton,
                        {
                          borderColor: c.border,
                          backgroundColor: isLinked ? c.background : c.primary,
                        },
                      ]}
                      onPress={() => (isLinked ? handleUnlinkProvider(provider) : handleLinkProvider(provider))}
                      disabled={providerLoading !== null}
                      activeOpacity={0.85}
                    >
                      {isLoadingProvider ? (
                        <ActivityIndicator color={isLinked ? c.textPrimary : '#fff'} size="small" />
                      ) : (
                        <Text style={[styles.providerButtonText, { color: isLinked ? c.textPrimary : '#fff' }]}>
                          {isLinked ? t('home.unlinkAction') : t('home.linkAction')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </Animated.View>
      </Modal>

      <Modal
        visible={blockedUsersDrawerMounted}
        transparent
        animationType="none"
        onRequestClose={() => setBlockedUsersDrawerOpen(false)}
      >
        <Animated.View
          style={[
            styles.drawerBackdrop,
            { opacity: blockedUsersDrawerBackdropOpacity },
          ]}
          pointerEvents="auto"
        >
          <Pressable style={{ flex: 1 }} onPress={() => setBlockedUsersDrawerOpen(false)} />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawerPanel,
            {
              width: sideDrawerWidth,
              backgroundColor: c.surface,
              transform: [{ translateX: blockedUsersDrawerTranslateX }],
            },
          ]}
        >
          <View style={styles.settingsDrawerHeader}>
            <Text style={[styles.settingsDrawerTitle, { color: c.textPrimary }]}>
              {t('blocked.title', { defaultValue: 'Blocked Accounts' })}
            </Text>
          </View>
          <FollowPeopleScreen
            mode="blocked"
            token={token}
            c={c}
            t={t}
            onNotice={setNotice}
            hideHeader
            onOpenProfile={(username: string) => {
              setBlockedUsersDrawerOpen(false);
              onNavigate({ screen: 'profile', username });
            }}
          />
        </Animated.View>
      </Modal>

      {/* ── Moderation Tasks drawer ──────────────────────────────── */}
      <Modal
        visible={moderationTasksDrawerMounted}
        transparent
        animationType="none"
        onRequestClose={() => setModerationTasksOpen(false)}
      >
        <Animated.View style={[styles.drawerBackdrop, { opacity: moderationTasksDrawerBackdropOpacity }]} pointerEvents="auto">
          <Pressable style={{ flex: 1 }} onPress={() => setModerationTasksOpen(false)} />
        </Animated.View>
        <Animated.View style={[styles.drawerPanel, { width: sideDrawerWidth, backgroundColor: c.surface, transform: [{ translateX: moderationTasksDrawerTranslateX }] }]}>
          <View style={styles.settingsDrawerHeader}>
            <Text style={[styles.settingsDrawerTitle, { color: c.textPrimary }]}>
              {t('home.sideMenuModerationTasks', { defaultValue: 'Moderation Tasks' })}
            </Text>
          </View>

          {/* Status tabs */}
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border }}>
            {(['P', 'A', 'R'] as const).map((s) => {
              const label = s === 'P' ? t('home.modTasksPending', { defaultValue: 'Pending' })
                : s === 'A' ? t('home.modTasksApproved', { defaultValue: 'Approved' })
                : t('home.modTasksRejected', { defaultValue: 'Rejected' });
              const active = moderationTasksStatus === s;
              return (
                <TouchableOpacity
                  key={s}
                  style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: active ? c.primary : 'transparent' }}
                  onPress={() => { setModerationTasksStatus(s); setModerationTasksItems([]); loadModerationTasks(s); }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: active ? c.primary : c.textMuted }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {moderationTasksLoading ? (
              <ActivityIndicator color={c.primary} size="small" style={{ marginTop: 24 }} />
            ) : moderationTasksItems.length === 0 ? (
              <Text style={[styles.feedStatText, { color: c.textMuted, textAlign: 'center', marginTop: 32, paddingHorizontal: 16 }]}>
                {t('home.modTasksEmpty', { defaultValue: 'No items in this queue.' })}
              </Text>
            ) : moderationTasksItems.map((item) => {
              const typeLabel = item.object_type === 'P' ? 'Post'
                : item.object_type === 'PC' ? 'Comment'
                : item.object_type === 'C' ? 'Community'
                : item.object_type === 'U' ? 'User'
                : 'Hashtag';
              const co = item.content_object;
              const authorUsername = co?.creator?.username || co?.commenter?.username || co?.username || '';
              const contentText = co?.text || co?.name || co?.title || '';
              const severityColor = item.category?.severity === 'C' ? '#dc2626'
                : item.category?.severity === 'H' ? '#ea580c'
                : item.category?.severity === 'M' ? '#ca8a04'
                : '#16a34a';
              const isActioning = moderationTasksActionLoading === item.id;

              return (
                <TouchableOpacity key={item.id} activeOpacity={0.75} onPress={() => void openModerationTaskDetail(item)} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
                  {/* Header row: type badge + category + report count */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <View style={{ backgroundColor: severityColor, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{typeLabel}</Text>
                    </View>
                    {item.category ? (
                      <Text style={{ fontSize: 12, color: c.textMuted, flex: 1 }} numberOfLines={1}>{item.category.title || item.category.name}</Text>
                    ) : <View style={{ flex: 1 }} />}
                    <Text style={{ fontSize: 12, color: c.textMuted }}>{item.reports_count} report{item.reports_count !== 1 ? 's' : ''}</Text>
                  </View>

                  {/* Author + content preview */}
                  {authorUsername ? (
                    <Text style={{ fontSize: 12, fontWeight: '600', color: c.textSecondary, marginBottom: 2 }}>@{authorUsername}</Text>
                  ) : null}
                  {contentText ? (
                    <Text style={{ fontSize: 13, color: c.textSecondary, lineHeight: 18 }} numberOfLines={2}>{contentText}</Text>
                  ) : null}

                  {/* Actions */}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    {isActioning ? (
                      <ActivityIndicator color={c.primary} size="small" />
                    ) : item.status === 'P' ? (
                      <>
                        <TouchableOpacity
                          style={{ backgroundColor: '#16a34a', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5 }}
                          activeOpacity={0.85}
                          onPress={() => void handleModerationAction(item.id, 'approve')}
                        >
                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{t('home.modTasksApproveBtn', { defaultValue: 'Approve' })}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ backgroundColor: '#dc2626', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5 }}
                          activeOpacity={0.85}
                          onPress={() => void handleModerationAction(item.id, 'reject')}
                        >
                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{t('home.modTasksRejectBtn', { defaultValue: 'Reject' })}</Text>
                        </TouchableOpacity>
                      </>
                    ) : item.status === 'A' && !item.verified ? (
                      <TouchableOpacity
                        style={{ backgroundColor: '#7c3aed', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5 }}
                        activeOpacity={0.85}
                        onPress={() => void handleModerationAction(item.id, 'verify')}
                      >
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{t('home.modTasksVerifyBtn', { defaultValue: 'Verify & Penalise' })}</Text>
                      </TouchableOpacity>
                    ) : item.verified ? (
                      <Text style={{ fontSize: 12, color: '#16a34a', fontWeight: '600' }}>✓ {t('home.modTasksVerified', { defaultValue: 'Verified' })}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* ── Task detail sub-panel (slides in from right over the drawer) ── */}
          <Animated.View style={{
            position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
            backgroundColor: c.surface,
            transform: [{ translateX: moderationTasksDetailTranslateX }],
            zIndex: 10,
          }}>
                {/* Header */}
                <View style={[styles.settingsDrawerHeader, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <TouchableOpacity onPress={() => setModerationTasksDetailItem(null)} activeOpacity={0.75}>
                    <MaterialCommunityIcons name="arrow-left" size={20} color={c.textSecondary} />
                  </TouchableOpacity>
                  <Text style={[styles.settingsDrawerTitle, { color: c.textPrimary, flex: 1 }]}>
                    {t('home.modTasksDetailTitle', { defaultValue: 'Report details' })}
                  </Text>
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
                  {moderationTasksDetailItem && (() => {
                    const item = moderationTasksDetailItem;
                    const co = item.content_object;
                    const typeLabel = item.object_type === 'P' ? 'Post' : item.object_type === 'PC' ? 'Comment' : item.object_type === 'C' ? 'Community' : item.object_type === 'U' ? 'User' : 'Hashtag';
                    const authorUsername = co?.creator?.username || co?.commenter?.username || co?.username || '';
                    const contentText = co?.text || co?.name || co?.title || '';
                    const parentPostText = co?.post?.text;
                    const severityColor = item.category?.severity === 'C' ? '#dc2626' : item.category?.severity === 'H' ? '#ea580c' : item.category?.severity === 'M' ? '#ca8a04' : '#16a34a';
                    const isActioning = moderationTasksActionLoading === item.id;

                    return (
                      <>
                        {/* Content section */}
                        <View style={{ backgroundColor: c.inputBackground, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: c.border }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <View style={{ backgroundColor: severityColor, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{typeLabel}</Text>
                            </View>
                            {item.category && (
                              <Text style={{ fontSize: 13, color: c.textMuted }}>{item.category.title || item.category.name}</Text>
                            )}
                          </View>
                          {authorUsername ? (
                            <Text style={{ fontSize: 13, fontWeight: '700', color: c.textSecondary, marginBottom: 4 }}>@{authorUsername}</Text>
                          ) : null}
                          {/* For comments, show the parent post context */}
                          {parentPostText ? (
                            <View style={{ borderLeftWidth: 2, borderLeftColor: c.border, paddingLeft: 10, marginBottom: 8 }}>
                              <Text style={{ fontSize: 11, color: c.textMuted, marginBottom: 2 }}>{t('home.modTasksDetailInReplyTo', { defaultValue: 'On post:' })}</Text>
                              <Text style={{ fontSize: 12, color: c.textMuted }} numberOfLines={2}>{parentPostText}</Text>
                            </View>
                          ) : null}
                          {contentText ? (
                            <Text style={{ fontSize: 14, color: c.textPrimary, lineHeight: 20 }}>{contentText}</Text>
                          ) : null}
                        </View>

                        {/* Reports section */}
                        <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          {t('home.modTasksDetailReportsTitle', { defaultValue: 'Reports ({{count}})', count: item.reports_count })}
                        </Text>

                        {moderationTasksDetailReportsLoading ? (
                          <ActivityIndicator color={c.primary} size="small" />
                        ) : moderationTasksDetailReports.map((report) => (
                          <View key={report.id} style={{ borderBottomWidth: 1, borderBottomColor: c.border, paddingBottom: 12 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                                {report.reporter.profile?.avatar ? (
                                  <Image source={{ uri: report.reporter.profile.avatar }} style={{ width: 28, height: 28, borderRadius: 14 }} resizeMode="cover" />
                                ) : (
                                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{(report.reporter.username?.[0] || '?').toUpperCase()}</Text>
                                )}
                              </View>
                              <Text style={{ fontSize: 13, fontWeight: '600', color: c.textSecondary }}>@{report.reporter.username}</Text>
                              <View style={{ flex: 1 }} />
                              <Text style={{ fontSize: 11, color: c.textMuted }}>{report.category.title || report.category.name}</Text>
                            </View>
                            {report.description ? (
                              <Text style={{ fontSize: 13, color: c.textSecondary, marginLeft: 36, lineHeight: 18 }}>{report.description}</Text>
                            ) : null}
                          </View>
                        ))}

                        {/* Action buttons */}
                        {!item.verified && (
                          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 4, paddingBottom: 8 }}>
                            {isActioning ? (
                              <ActivityIndicator color={c.primary} size="small" />
                            ) : item.status === 'P' ? (
                              <>
                                <TouchableOpacity
                                  style={{ flex: 1, backgroundColor: '#16a34a', borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
                                  activeOpacity={0.85}
                                  onPress={() => void handleModerationAction(item.id, 'approve')}
                                >
                                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{t('home.modTasksApproveBtn', { defaultValue: 'Approve' })}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={{ flex: 1, backgroundColor: '#dc2626', borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
                                  activeOpacity={0.85}
                                  onPress={() => void handleModerationAction(item.id, 'reject')}
                                >
                                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{t('home.modTasksRejectBtn', { defaultValue: 'Reject' })}</Text>
                                </TouchableOpacity>
                              </>
                            ) : item.status === 'A' ? (
                              <TouchableOpacity
                                style={{ flex: 1, backgroundColor: '#7c3aed', borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
                                activeOpacity={0.85}
                                onPress={() => void handleModerationAction(item.id, 'verify')}
                              >
                                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{t('home.modTasksVerifyBtn', { defaultValue: 'Verify & Penalise' })}</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        )}
                        {item.verified && (
                          <Text style={{ fontSize: 13, color: '#16a34a', fontWeight: '600', textAlign: 'center' }}>✓ {t('home.modTasksVerified', { defaultValue: 'Verified' })}</Text>
                        )}
                      </>
                    );
                  })()}
                </ScrollView>
          </Animated.View>

        </Animated.View>
      </Modal>

      {/* ── Moderation Penalties drawer ──────────────────────────── */}
      <Modal
        visible={moderationPenaltiesDrawerMounted}
        transparent
        animationType="none"
        onRequestClose={() => setModerationPenaltiesOpen(false)}
      >
        <Animated.View style={[styles.drawerBackdrop, { opacity: moderationPenaltiesDrawerBackdropOpacity }]} pointerEvents="auto">
          <Pressable style={{ flex: 1 }} onPress={() => setModerationPenaltiesOpen(false)} />
        </Animated.View>
        <Animated.View style={[styles.drawerPanel, { width: sideDrawerWidth, backgroundColor: c.surface, transform: [{ translateX: moderationPenaltiesDrawerTranslateX }] }]}>
          <View style={styles.settingsDrawerHeader}>
            <Text style={[styles.settingsDrawerTitle, { color: c.textPrimary }]}>
              {t('home.sideMenuModerationPenalties', { defaultValue: 'Moderation Penalties' })}
            </Text>
          </View>

          <Text style={[styles.linkedSubtitle, { color: c.textMuted }]}>
            {t('home.modPenaltiesDescription', { defaultValue: 'Active penalties applied to your account.' })}
          </Text>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 12 }}>
            {userPenaltiesLoading ? (
              <ActivityIndicator color={c.primary} size="small" style={{ marginTop: 24 }} />
            ) : userPenalties.length === 0 ? (
              <Text style={[styles.feedStatText, { color: c.textMuted, textAlign: 'center', marginTop: 32 }]}>
                {t('home.modPenaltiesNone', { defaultValue: 'No active penalties. Your account is in good standing.' })}
              </Text>
            ) : userPenalties.map((penalty) => {
              const expiry = penalty.expiration ? new Date(penalty.expiration) : null;
              const isPermanent = !expiry;
              const expiryLabel = isPermanent
                ? t('home.modPenaltyPermanent', { defaultValue: 'Permanent' })
                : t('home.modPenaltyExpires', { defaultValue: 'Expires {{date}}', date: expiry!.toLocaleDateString() });

              return (
                <View key={penalty.id} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <MaterialCommunityIcons name="gavel" size={18} color="#dc2626" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: c.textPrimary }}>
                      {penalty.type === 'S' ? t('home.modPenaltySuspension', { defaultValue: 'Suspension' }) : penalty.type}
                    </Text>
                    <Text style={{ fontSize: 12, color: isPermanent ? '#dc2626' : c.textMuted, marginTop: 2 }}>
                      {expiryLabel}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </Animated.View>
      </Modal>

      <InviteDrawer
        visible={inviteDrawerOpen}
        token={token}
        inviterName={user?.profile?.name || user?.username}
        onClose={() => setInviteDrawerOpen(false)}
      />

      <EditProfileDrawer
        visible={editProfileDrawerOpen}
        onClose={() => setEditProfileDrawerOpen(false)}
        c={c}
        t={t}
        editUsername={editUsername}
        setEditUsername={setEditUsername}
        editName={editName}
        setEditName={setEditName}
        editLocation={editLocation}
        setEditLocation={setEditLocation}
        editBio={editBio}
        setEditBio={setEditBio}
        editUrl={editUrl}
        setEditUrl={setEditUrl}
        editFollowersCountVisible={editFollowersCountVisible}
        setEditFollowersCountVisible={setEditFollowersCountVisible}
        editCommunityPostsVisible={editCommunityPostsVisible}
        setEditCommunityPostsVisible={setEditCommunityPostsVisible}
        editProfileVisibility={editProfileVisibility}
        setEditProfileVisibility={setEditProfileVisibility}
        savingProfile={editProfileSaving}
        onSave={submitEditProfile}
      />

      <CommunityManagementDrawer
        visible={communityManageDrawerOpen && !!communityManageTarget}
        token={token}
        c={c}
        t={t}
        community={communityManageTarget}
        currentUserId={user?.id}
        onClose={() => {
          setCommunityManageDrawerOpen(false);
          setCommunityManageTarget(null);
        }}
        onUpdated={(nextCommunity) => {
          const previousName = (communityManageTarget?.name || '').trim();
          const nextName = (nextCommunity?.name || '').trim();

          setCommunityInfo(nextCommunity);
          setCommunityManageTarget(nextCommunity);

          if (
            displayRoute.screen === 'community' &&
            nextName &&
            previousName &&
            nextName !== previousName &&
            displayRoute.name === previousName
          ) {
            onNavigate({ screen: 'community', name: nextName });
          }

          refreshCommunityRouteData();
          refreshManageCommunitiesRouteData();
        }}
        onDeleted={() => {
          setCommunityManageDrawerOpen(false);
          setCommunityManageTarget(null);
          setNotice(t('community.deleted', { defaultValue: 'Community deleted.' }));
          if (displayRoute.screen === 'community') {
            onNavigate({ screen: 'communities' });
          } else {
            refreshManageCommunitiesRouteData();
          }
        }}
        onNotice={setNotice}
        onError={setError}
      />


      <Modal
        visible={externalLinkModalOpen}
        transparent
        animationType="fade"
        onRequestClose={cancelOpenPendingExternalLink}
      >
        <TouchableOpacity
          style={styles.externalLinkModalBackdrop}
          activeOpacity={1}
          onPress={cancelOpenPendingExternalLink}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.externalLinkModalCard,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <Text style={[styles.externalLinkModalTitle, { color: c.textPrimary }]}>
                {t('home.externalLinkWarningTitle')}
              </Text>
              <Text style={[styles.externalLinkModalBody, { color: c.textSecondary }]}>
                {t('home.externalLinkWarningBody')}
              </Text>
              {pendingExternalLink ? (
                <Text numberOfLines={2} style={[styles.externalLinkModalUrl, { color: c.textMuted }]}>
                  {pendingExternalLink}
                </Text>
              ) : null}
              <View style={styles.externalLinkModalActions}>
                <TouchableOpacity
                  style={[styles.externalLinkCancelButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={cancelOpenPendingExternalLink}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.externalLinkCancelButtonText, { color: c.textSecondary }]}>
                    {t('home.externalLinkCancelAction')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.externalLinkContinueButton, { backgroundColor: c.primary }]}
                  onPress={confirmOpenPendingExternalLink}
                  activeOpacity={0.85}
                >
                  <Text style={styles.externalLinkContinueButtonText}>
                    {t('home.externalLinkContinueAction')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={composerModalMounted}
        transparent
        animationType="none"
        onRequestClose={closeComposerModal}
      >
        <TouchableOpacity
          style={styles.postComposerModalBackdrop}
          activeOpacity={1}
          onPress={closeComposerModal}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <Animated.View
              style={[
                styles.postComposerModalCard,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  width: composerDrawerWidth,
                  transform: [{ translateX: composerTranslateX }],
                },
              ]}
            >
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                  {composerStep === 'compose'
                    ? t('home.postComposerTitle', { defaultValue: 'Create post' })
                    : t('home.postComposerDestinationTitle', { defaultValue: 'Choose where to publish' })}
                </Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={closeComposerModal}
                  activeOpacity={0.85}
                  disabled={composerSubmitting}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.postComposerContent}>
              {composerStep === 'compose' ? (
                <View style={styles.postComposerComposeContent}>
                  <View style={styles.postComposerModeRow}>
                    <Text style={[styles.postComposerModeLabel, { color: c.textSecondary }]}>
                      {composerPostType === 'LP'
                        ? t('home.longPostModeActive', { defaultValue: 'Long post mode active' })
                        : t('home.shortPostModeActive', { defaultValue: 'Short post mode active' })}
                    </Text>
                    <TouchableOpacity
                      style={[styles.postComposerModeButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      activeOpacity={0.85}
                      onPress={switchToLongPostForm}
                    >
                      <MaterialCommunityIcons name="text-box-edit-outline" size={16} color={c.textSecondary} />
                      <Text style={[styles.postComposerModeButtonText, { color: c.textSecondary }]}>
                        {t('home.longPostSwitchToForm', { defaultValue: 'Switch to Long Post Form' })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <MentionHashtagInput
                    style={[
                      styles.postComposerTextInput,
                      {
                        borderColor: c.inputBorder,
                        backgroundColor: c.inputBackground,
                        color: c.textPrimary,
                      },
                    ]}
                    placeholder={composerSharedPost
                      ? t('home.repostComposerInputPlaceholder', { defaultValue: 'Add a comment… (optional)' })
                      : t('home.postComposerInputPlaceholder', { defaultValue: "What's on your mind?" })}
                    placeholderTextColor={c.placeholder}
                    onChangeText={(value) => {
                      composerTextRef.current = value;
                      if (composerTextLengthDebounceRef.current) clearTimeout(composerTextLengthDebounceRef.current);
                      composerTextLengthDebounceRef.current = setTimeout(() => setComposerTextLength(value.length), 100);
                      void refreshComposerLinkPreview(value);
                      if (composerPostType === 'LP') {
                        setComposerPostType('P');
                      }
                    }}
                    token={token}
                    c={c}
                    multiline
                    textAlignVertical="top"
                    maxLength={SHORT_POST_MAX_LENGTH}
                    editable={!composerSubmitting && !composerDestinationsLoading}
                  />

                  {/* Shared post preview in compose step */}
                  {composerSharedPost ? (
                    <View style={{
                      marginTop: 8,
                      marginBottom: 4,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: 10,
                      backgroundColor: c.inputBackground,
                      overflow: 'hidden',
                    }}>
                      {composerSharedPost.community?.name ? (
                        <View style={{ paddingHorizontal: 10, paddingTop: 7, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted }}>
                            c/{composerSharedPost.community.name}
                          </Text>
                        </View>
                      ) : null}
                      <View style={{ paddingHorizontal: 10, paddingTop: 5, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: c.primary, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                          {(composerSharedPost.creator?.avatar || composerSharedPost.creator?.profile?.avatar) ? (
                            <Image
                              source={{ uri: composerSharedPost.creator.avatar || composerSharedPost.creator.profile?.avatar }}
                              style={{ width: 20, height: 20 }}
                              resizeMode="cover"
                            />
                          ) : (
                            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
                              {(composerSharedPost.creator?.username?.[0] || 'U').toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: c.textPrimary }}>
                          @{composerSharedPost.creator?.username || t('home.unknownUser', { defaultValue: 'Unknown' })}
                        </Text>
                      </View>
                      {composerSharedPost.text ? (
                        <Text
                          numberOfLines={3}
                          style={{ paddingHorizontal: 10, paddingBottom: 9, fontSize: 13, lineHeight: 18, color: c.textSecondary }}
                        >
                          {composerSharedPost.text}
                        </Text>
                      ) : (
                        <View style={{ height: 8 }} />
                      )}
                    </View>
                  ) : null}

                  <View style={styles.postComposerCounterAndToolsRow}>
                    <View style={styles.postComposerToolbarInline}>
                      <TouchableOpacity
                        style={[styles.postComposerToolButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        activeOpacity={0.85}
                        disabled={composerSubmitting || !!composerVideo}
                        onPress={() => openComposerMediaPicker('image')}
                      >
                        <MaterialCommunityIcons name="image" size={18} color="#22c55e" />
                        <Text style={[styles.postComposerToolButtonText, { color: c.textSecondary }]}>
                          {t('home.postComposerImageAction', { defaultValue: 'Photos' })}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.postComposerToolButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        activeOpacity={0.85}
                        disabled={composerSubmitting || composerImages.length > 0}
                        onPress={() => openComposerMediaPicker('video')}
                      >
                        <MaterialCommunityIcons name="video" size={18} color="#ff2d55" />
                        <Text style={[styles.postComposerToolButtonText, { color: c.textSecondary }]}>
                          {t('home.postComposerVideoAction', { defaultValue: 'Video' })}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.postComposerCounterRow}>
                      <Text style={[styles.postComposerCounterText, { color: c.textMuted }]}>
                        {t('home.postComposerCharacterCounter', {
                          defaultValue: '{{count}}/{{max}} characters',
                          count: composerTextLength,
                          max: SHORT_POST_MAX_LENGTH,
                        })}
                      </Text>
                    </View>
                  </View>

                  {!composerVideo && composerImages.length === 0 && composerTextLength > 0 ? (
                    <View style={[styles.postComposerLinkPreviewWrap, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                      {composerLinkPreviewLoading ? (
                        <View style={styles.postComposerLinkPreviewLoading}>
                          <ActivityIndicator size="small" color={c.primary} />
                          <Text style={[styles.postComposerLinkPreviewLoadingText, { color: c.textMuted }]}>
                            {t('home.postComposerLinkPreviewLoading', { defaultValue: 'Loading link preview...' })}
                          </Text>
                        </View>
                      ) : composerLinkPreview ? (
                        <TouchableOpacity
                          style={styles.postComposerLinkPreviewCard}
                          activeOpacity={0.9}
                          onPress={() => openLink(composerLinkPreview.url)}
                        >
                          {composerLinkPreview.imageUrl ? (
                            <Image
                              source={{ uri: composerLinkPreview.imageUrl }}
                              style={styles.postComposerLinkPreviewImage}
                              resizeMode="cover"
                            />
                          ) : null}
                          <View style={styles.postComposerLinkPreviewMeta}>
                            {composerLinkPreview.siteName ? (
                              <Text numberOfLines={1} style={[styles.postComposerLinkPreviewSite, { color: c.textMuted }]}>
                                {composerLinkPreview.siteName}
                              </Text>
                            ) : null}
                            <Text numberOfLines={2} style={[styles.postComposerLinkPreviewTitle, { color: c.textPrimary }]}>
                              {composerLinkPreview.title}
                            </Text>
                            {composerLinkPreview.description ? (
                              <Text numberOfLines={2} style={[styles.postComposerLinkPreviewDescription, { color: c.textSecondary }]}>
                                {composerLinkPreview.description}
                              </Text>
                            ) : null}
                            <Text numberOfLines={1} style={[styles.postComposerLinkPreviewUrl, { color: c.textLink }]}>
                              {composerLinkPreview.url}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}

                  {composerVideo ? (
                    <View style={[styles.postComposerPreviewWrap, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                      <View style={styles.postComposerVideoPreview}>
                        <MaterialCommunityIcons name="video" size={26} color={c.textSecondary} />
                        <Text numberOfLines={1} style={[styles.postComposerPreviewName, { color: c.textSecondary }]}>
                          {composerVideo.file.name || t('home.postComposerVideoLabel', { defaultValue: 'Video selected' })}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  {!composerVideo && composerImages.length > 0 ? (
                    <View style={[styles.postComposerPreviewWrap, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                      <View style={styles.postComposerImageGrid}>
                        {composerImages.map((image, index) => (
                          <View key={`composer-image-${index}`} style={styles.postComposerImageTile}>
                            {image.previewUri ? (
                              <Image
                                source={{ uri: image.previewUri }}
                                style={[
                                  styles.postComposerImageTilePreview,
                                  image.rotation
                                    ? { transform: [{ rotate: `${image.rotation}deg` }] }
                                    : undefined,
                                ]}
                                resizeMode="cover"
                              />
                            ) : (
                              <View style={styles.postComposerVideoPreview}>
                                <MaterialCommunityIcons name="image" size={22} color={c.textSecondary} />
                              </View>
                            )}
                            {/* Remove button — top-right */}
                            <TouchableOpacity
                              style={[styles.postComposerImageRemove, { backgroundColor: c.surface, borderColor: c.border }]}
                              activeOpacity={0.85}
                              disabled={composerSubmitting}
                              onPress={() => removeComposerImage(index)}
                            >
                              <MaterialCommunityIcons name="close" size={14} color={c.textSecondary} />
                            </TouchableOpacity>
                            {/* Rotate button — bottom-left */}
                            <TouchableOpacity
                              style={[styles.postComposerImageRotate, { backgroundColor: c.surface, borderColor: c.border }]}
                              activeOpacity={0.85}
                              disabled={composerSubmitting}
                              onPress={() => rotateComposerImage(index)}
                            >
                              <MaterialCommunityIcons name="rotate-right" size={14} color={c.textSecondary} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {composerVideo || composerImages.length > 0 ? (
                    <View style={styles.postComposerToolbar}>
                      <TouchableOpacity
                        style={[styles.postComposerToolButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        activeOpacity={0.85}
                        disabled={composerSubmitting}
                        onPress={clearComposerMedia}
                      >
                        <MaterialCommunityIcons name="close-circle-outline" size={18} color={c.textSecondary} />
                        <Text style={[styles.postComposerToolButtonText, { color: c.textSecondary }]}>
                          {t('home.postComposerRemoveMediaAction', { defaultValue: 'Remove all media' })}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ) : (
                <ScrollView
                  style={styles.postComposerDestinationScroll}
                  contentContainerStyle={styles.postComposerDestinationScrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                <View style={styles.postComposerDestinationStepWrap}>
                  <Text style={[styles.postComposerDestinationTitle, { color: c.textPrimary }]}>
                    {t('home.postComposerDestinationTitle', { defaultValue: 'Choose where to publish' })}
                  </Text>
                  <Text style={[styles.postComposerDestinationBody, { color: c.textMuted }]}>
                    {t('home.postComposerDestinationBody', {
                      defaultValue: 'Select one circle or up to 3 joined communities.',
                    })}
                  </Text>

                  {/* Shared post preview when reposting */}
                  {composerSharedPost ? (
                    <View style={{
                      marginTop: 12,
                      marginBottom: 4,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: 12,
                      backgroundColor: c.inputBackground,
                      overflow: 'hidden',
                    }}>
                      {composerSharedPost.community?.name ? (
                        <View style={{ paddingHorizontal: 12, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted }}>
                            c/{composerSharedPost.community.name}
                          </Text>
                        </View>
                      ) : null}
                      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.primary, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                          {(composerSharedPost.creator?.avatar || composerSharedPost.creator?.profile?.avatar) ? (
                            <Image
                              source={{ uri: composerSharedPost.creator.avatar || composerSharedPost.creator.profile?.avatar }}
                              style={{ width: 22, height: 22 }}
                              resizeMode="cover"
                            />
                          ) : (
                            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
                              {(composerSharedPost.creator?.username?.[0] || 'U').toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: c.textPrimary }}>
                          @{composerSharedPost.creator?.username || t('home.unknownUser', { defaultValue: 'Unknown' })}
                        </Text>
                      </View>
                      {composerSharedPost.text ? (
                        <Text
                          numberOfLines={3}
                          style={{ paddingHorizontal: 12, paddingBottom: 10, fontSize: 13, lineHeight: 19, color: c.textPrimary }}
                        >
                          {composerSharedPost.text}
                        </Text>
                      ) : (
                        <View style={{ height: 10 }} />
                      )}
                    </View>
                  ) : null}

                  {composerDestinationsLoading ? (
                    <View style={styles.postComposerDestinationLoading}>
                      <ActivityIndicator color={c.primary} size="small" />
                    </View>
                  ) : (
                    <>
                      <Text style={[styles.postComposerDestinationSectionTitle, { color: c.textPrimary }]}>
                        {t('home.postComposerCircleOption', { defaultValue: 'Circle' })}
                      </Text>
                      <ScrollView
                        style={[styles.postComposerDestinationList, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        contentContainerStyle={styles.postComposerDestinationListContent}
                      >
                        <TouchableOpacity
                          key="composer-circle-public"
                          style={[
                            styles.postComposerDestinationItem,
                            {
                              borderColor: composerSelectedCircleId === null ? c.primary : c.border,
                              backgroundColor: composerSelectedCircleId === null ? `${c.primary}14` : c.surface,
                            },
                          ]}
                          activeOpacity={0.85}
                          onPress={() => setComposerSelectedCircleId(null)}
                        >
                          <MaterialCommunityIcons
                            name={composerSelectedCircleId === null ? 'radiobox-marked' : 'radiobox-blank'}
                            size={18}
                            color={composerSelectedCircleId === null ? c.primary : c.textMuted}
                          />
                          <View style={styles.postComposerDestinationItemMeta}>
                            <Text style={[styles.postComposerDestinationItemTitle, { color: c.textPrimary }]}>
                              {t('home.postComposerPublicDestinationTitle', { defaultValue: 'Public (no circle)' })}
                            </Text>
                            <Text style={[styles.postComposerDestinationItemSubtitle, { color: c.textMuted }]}>
                              {t('home.postComposerPublicDestinationSubtitle', {
                                defaultValue: 'Visible outside circles based on your profile privacy settings.',
                              })}
                            </Text>
                          </View>
                        </TouchableOpacity>

                        {composerCircles.map((circle) => {
                          const selected = composerSelectedCircleId === circle.id;
                          const circleColor = sanitizeCircleColor(circle.color);
                          return (
                            <TouchableOpacity
                              key={`composer-circle-${circle.id}`}
                              style={[
                                styles.postComposerDestinationItem,
                                {
                                  borderColor: selected ? c.primary : c.border,
                                  backgroundColor: selected ? `${c.primary}14` : c.surface,
                                },
                              ]}
                              activeOpacity={0.85}
                              onPress={() => setComposerSelectedCircleId(circle.id)}
                            >
                              <MaterialCommunityIcons
                                name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                                size={18}
                                color={selected ? c.primary : c.textMuted}
                              />
                              <View
                                style={[
                                  styles.postComposerCircleColorSwatch,
                                  { backgroundColor: circleColor || c.border },
                                ]}
                              />
                              <View style={styles.postComposerDestinationItemMeta}>
                                <Text style={[styles.postComposerDestinationItemTitle, { color: c.textPrimary }]}>
                                  {circle.name || t('home.postComposerCircleOption', { defaultValue: 'Circle' })}
                                </Text>
                                <Text style={[styles.postComposerDestinationItemSubtitle, { color: c.textMuted }]}>
                                  {t('home.postComposerCircleUsersCount', {
                                    count: circle.users_count || 0,
                                    defaultValue: '{{count}} members',
                                  })}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          );
                        })}

                        {composerCircles.length === 0 ? (
                          <Text style={[styles.postComposerDestinationEmptyText, { color: c.textMuted }]}>
                            {t('home.postComposerNoCircles', { defaultValue: 'No circles found.' })}
                          </Text>
                        ) : null}
                      </ScrollView>

                      <Text style={[styles.postComposerDestinationSectionTitle, { color: c.textPrimary }]}>
                        {t('home.postComposerCommunityOption', { defaultValue: 'Community' })}
                      </Text>
                      <View style={styles.postComposerDestinationCounterRow}>
                        <Text style={[styles.postComposerDestinationBody, { color: c.textMuted }]}>
                          {t('home.postComposerCommunitySelectHint', {
                            defaultValue: 'Select up to 3 communities.',
                          })}
                        </Text>
                        <Text style={[styles.postComposerDestinationCounterText, { color: c.textMuted }]}>
                          {`${composerSelectedCommunityNames.length}/3`}
                        </Text>
                      </View>

                      <TextInput
                        style={[
                          styles.postComposerDestinationSearchInput,
                          { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary },
                        ]}
                        placeholder={t('home.postComposerCommunitySearchPlaceholder', {
                          defaultValue: 'Search your communities',
                        })}
                        placeholderTextColor={c.placeholder}
                        value={composerCommunitySearch}
                        onChangeText={setComposerCommunitySearch}
                        editable={!composerSubmitting}
                      />

                      <ScrollView
                        style={[styles.postComposerDestinationList, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        contentContainerStyle={styles.postComposerDestinationListContent}
                      >
                        {filteredComposerJoinedCommunities.map((community) => {
                          const selected = !!community.name && composerSelectedCommunityNames.includes(community.name);
                          const communityInitial = (community.title || community.name || 'C').slice(0, 1).toUpperCase();
                          return (
                            <TouchableOpacity
                              key={`composer-community-${community.id}`}
                              style={[
                                styles.postComposerDestinationItem,
                                {
                                  borderColor: selected ? c.primary : c.border,
                                  backgroundColor: selected ? `${c.primary}14` : c.surface,
                                },
                              ]}
                              activeOpacity={0.85}
                              onPress={() => {
                                const targetName = community.name || '';
                                if (!targetName) return;
                                setComposerSelectedCommunityNames((prev) => {
                                  if (prev.includes(targetName)) {
                                    return prev.filter((name) => name !== targetName);
                                  }
                                  if (prev.length >= 3) {
                                    setError(
                                      t('home.postComposerCommunityLimitReached', {
                                        defaultValue: 'You can select up to 3 communities.',
                                      })
                                    );
                                    return prev;
                                  }
                                  return [...prev, targetName];
                                });
                              }}
                            >
                              <MaterialCommunityIcons
                                name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                                size={18}
                                color={selected ? c.primary : c.textMuted}
                              />
                              <View style={[styles.postComposerCommunityAvatar, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                                {community.avatar ? (
                                  <Image
                                    source={{ uri: community.avatar }}
                                    style={styles.postComposerCommunityAvatarImage}
                                    resizeMode="cover"
                                  />
                                ) : (
                                  <Text style={[styles.postComposerCommunityAvatarLetter, { color: c.textSecondary }]}>
                                    {communityInitial}
                                  </Text>
                                )}
                              </View>
                              <View style={styles.postComposerDestinationItemMeta}>
                                <Text style={[styles.postComposerDestinationItemTitle, { color: c.textPrimary }]}>
                                  {community.title || (community.name ? `c/${community.name}` : t('home.postComposerCommunityOption', { defaultValue: 'Community' }))}
                                </Text>
                                <Text style={[styles.postComposerDestinationItemSubtitle, { color: c.textMuted }]}>
                                  {community.name ? `c/${community.name}` : ''}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          );
                        })}

                        {filteredComposerJoinedCommunities.length === 0 ? (
                          <Text style={[styles.postComposerDestinationEmptyText, { color: c.textMuted }]}>
                            {composerCommunitySearchTrimmed
                              ? t('home.postComposerNoMatchingCommunities', { defaultValue: 'No matching communities found.' })
                              : t('home.postComposerNoJoinedCommunities', { defaultValue: 'No joined communities found.' })}
                          </Text>
                        ) : null}
                      </ScrollView>
                    </>
                  )}
                </View>
                </ScrollView>
              )}
              </View>

              <View style={styles.postComposerActions}>
                {composerStep === 'compose' && composerPostType === 'LP' ? (
                  <>
                    <TouchableOpacity
                      style={[styles.externalLinkCancelButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      onPress={() => void submitComposerPost({ saveAsDraft: true })}
                      activeOpacity={0.85}
                      disabled={composerSubmitting || composerDestinationsLoading}
                    >
                      <Text style={[styles.externalLinkCancelButtonText, { color: c.textSecondary }]}>
                        {t('home.postComposerDraftAction', { defaultValue: 'Save as Draft' })}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.externalLinkContinueButton, { backgroundColor: c.primary }]}
                      onPress={() => void goToComposerDestinationStep()}
                      activeOpacity={0.85}
                      disabled={composerSubmitting || composerDestinationsLoading}
                    >
                      {composerSubmitting || composerDestinationsLoading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.externalLinkContinueButtonText}>
                          {t('home.postComposerSaveAndPublishAction', { defaultValue: 'Save and Publish' })}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                <TouchableOpacity
                  style={[styles.externalLinkCancelButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={composerStep === 'destination' ? () => setComposerStep('compose') : closeComposerModal}
                  activeOpacity={0.85}
                  disabled={composerSubmitting || composerDestinationsLoading}
                >
                  <Text style={[styles.externalLinkCancelButtonText, { color: c.textSecondary }]}>
                    {composerStep === 'destination'
                      ? t('home.backAction', { defaultValue: 'Back' })
                      : t('home.cancelAction')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.externalLinkContinueButton, { backgroundColor: c.primary }]}
                  onPress={() => void submitComposerPost()}
                  activeOpacity={0.85}
                  disabled={composerSubmitting || composerDestinationsLoading}
                >
                  {composerSubmitting || composerDestinationsLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.externalLinkContinueButtonText}>
                      {composerStep === 'compose'
                        ? t('home.nextAction', { defaultValue: 'Next' })
                        : t('home.postComposerPublishAction', { defaultValue: 'Publish' })}
                    </Text>
                  )}
                </TouchableOpacity>
                  </>
                )}
              </View>
            </Animated.View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <PostDetailModal
        styles={styles}
        c={c}
        t={t}
        visible={!!activePost || postRouteLoading}
        postRouteLoading={postRouteLoading}
        activePost={activePost}
        hasActivePostMedia={hasActivePostMedia}
        currentUsername={user?.username}
        currentUserAvatar={user?.profile?.avatar}
        localComments={localComments}
        commentsHasMoreByPost={commentsHasMoreByPost}
        commentsLoadingMoreByPost={commentsLoadingMoreByPost}
        onLoadMoreComments={(post) => void loadMoreCommentsForPost(post)}
        commentRepliesById={commentRepliesById}
        repliesHasMoreByComment={repliesHasMoreByComment}
        repliesLoadingMoreByComment={repliesLoadingMoreByComment}
        onLoadMoreReplies={(postUuid, commentId) => void loadMoreRepliesForComment(postUuid, commentId)}
        commentRepliesExpanded={commentRepliesExpanded}
        commentRepliesLoadingById={commentRepliesLoadingById}
        draftCommentMediaByPostId={draftCommentMediaByPostId}
        draftReplyMediaByCommentId={draftReplyMediaByCommentId}
        editingCommentById={editingCommentById}
        editingReplyById={editingReplyById}
        commentMutationLoadingById={commentMutationLoadingById}
        reactionGroups={reactionGroups}
        reactionPickerLoading={reactionPickerLoading}
        reactionActionLoading={reactionActionLoading}
        getPostText={getPostText}
        getPostReactionCount={getPostReactionCount}
        getPostCommentsCount={getPostCommentsCount}
        initialMediaTimeSec={postDetailInitialMediaTimeSec}
        onConsumeInitialMediaTime={() => setPostDetailInitialMediaTimeSec(null)}
        onClose={closePostDetail}
        onLoadReactionList={loadReactionListInline}
        onEnsureReactionGroups={ensureReactionGroups}
        onReactToPostWithEmoji={reactToPostWithEmoji}
        onReactToComment={reactToComment}
        onToggleCommentReplies={toggleCommentReplies}
        onSharePost={handleSharePost}
        onRepostPost={handleRepostPost}
        onReportPost={openReportPostModal}
        onReportComment={openCommentReportModal}
        overlayModal={reportTarget?.kind === 'comment' ? (
          <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={closeReportModal}
          >
            <TouchableOpacity style={styles.reactionListBackdrop} activeOpacity={1} onPress={closeReportModal}>
              <TouchableOpacity activeOpacity={1} onPress={() => {}}>
                <View style={[styles.reportModalCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                  <View style={styles.linkedModalHeader}>
                    <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                      {t('home.reportCommentTitle', { defaultValue: 'Report comment' })}
                    </Text>
                    <TouchableOpacity
                      style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                      onPress={closeReportModal}
                      activeOpacity={0.85}
                      disabled={reportingItem}
                    >
                      <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.reportModalSubtitle, { color: c.textMuted }]}>
                    {t('home.reportCommentPrompt', { defaultValue: 'Why are you reporting this comment?' })}
                  </Text>

                  <ScrollView
                    style={styles.reportOptionScroll}
                    contentContainerStyle={styles.reportOptionList}
                    showsVerticalScrollIndicator
                  >
                    {moderationCategories.map((cat) => {
                      const normalizedName = normalizeModerationLabel(cat.name);
                      const normalizedTitle = normalizeModerationLabel(cat.title);
                      const match = (s: string) => normalizedName.includes(s) || normalizedTitle.includes(s);
                      let i18nKey: string | null = null;
                      if (match('spam')) i18nKey = 'spam';
                      else if (match('copyright') || match('trademark')) i18nKey = 'copyright';
                      else if (match('platform abuse') || match('abuse')) i18nKey = 'abuse';
                      else if (match('pornograph')) i18nKey = 'pornography';
                      else if (match('guideline')) i18nKey = 'guidelines';
                      else if (match('hatred') || match('bullying')) i18nKey = 'hatred';
                      else if (match('self harm')) i18nKey = 'selfHarm';
                      else if (match('violent') || match('gory')) i18nKey = 'violent';
                      else if (match('child') || match('csam') || match('exploitation')) i18nKey = 'csam';
                      else if (match('illegal') || match('drug')) i18nKey = 'illegal';
                      else if (match('deceptive')) i18nKey = 'deceptive';
                      else if (match('other')) i18nKey = 'other';
                      const displayTitle = i18nKey ? t(`home.reportCategory.${i18nKey}.title`) : cat.title || cat.name;
                      const displayDesc = i18nKey ? t(`home.reportCategory.${i18nKey}.description`) : cat.description || '';
                      return (
                        <TouchableOpacity
                          key={`report-comment-detail-${cat.id}`}
                          style={[styles.reportOptionCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                          activeOpacity={0.85}
                          onPress={() => void submitGenericReport(cat.id)}
                          disabled={reportingItem}
                        >
                          <Text style={[styles.reportOptionTitle, { color: c.textPrimary }]}>{displayTitle}</Text>
                          <Text style={[styles.reportOptionDescription, { color: c.textMuted }]}>{displayDesc}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {reportingItem ? <ActivityIndicator color={c.primary} size="small" /> : null}
                </View>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        ) : undefined}
        onOpenSharedPost={openPostDetail}
        onOpenLink={openLink}
        onPickDraftCommentImage={pickDraftCommentImage}
        onPickDraftReplyImage={pickDraftReplyImage}
        onSetDraftCommentGif={setDraftCommentGif}
        onSetDraftReplyGif={setDraftReplyGif}
        onClearDraftCommentMedia={clearDraftCommentMedia}
        onClearDraftReplyMedia={clearDraftReplyMedia}
        onStartEditingComment={startEditingComment}
        onCancelEditingComment={cancelEditingComment}
        onSaveEditedComment={saveEditedComment}
        onDeleteComment={deleteComment}
        onSubmitComment={submitComment}
        onSubmitReply={submitReply}
        onNavigateProfile={handleNavigateProfileFromPostDetail}
        onNavigateHashtag={handleNavigateHashtagFromPostDetail}
        token={token}
        reactionListOpen={reactionListOpen}
        reactionListLoading={reactionListLoading}
        reactionListEmoji={reactionListEmoji}
        reactionListUsers={reactionListUsers}
        onCloseReactionList={closeReactionList}
      />

      <LongPostDrawer
        visible={longPostDrawerOpen}
        expanded={longPostDrawerExpanded}
        editorMode={composerLongPostEditorMode}
        lexicalHtml={composerLongPostLexicalHtml}
        lexicalResetKey={composerLongPostLexicalResetKey}
        title={composerLongPostTitle}
        blocks={composerLongPostBlocks}
        onUploadImageFiles={uploadLongPostBlockImages}
        onNotify={(message) => {
          setNotice(message);
          showToast(message, { type: 'error' });
        }}
        draftExpiryDays={composerDraftExpiryDays}
        draftSaving={composerDraftSaving}
        mediaCount={composerLongPostMediaCount}
        maxImages={LONG_POST_MAX_IMAGES}
        draftSavedAtLabel={
          composerDraftSavedAt
            ? t('home.longPostDraftSavedAt', {
              defaultValue: 'Last saved {{time}}',
              time: new Date(composerDraftSavedAt).toLocaleTimeString(),
            })
            : null
        }
        onChangeBlocks={(value) => {
          setComposerLongPostBlocks(value);
          setComposerPostType('LP');
        }}
        onChangeEditorMode={(mode) => {
          if (
            mode === 'lexical' &&
            !composerLongPostLexicalHtml.trim()
          ) {
            const bootstrapBlocks = composeLongPostBlocksWithTitle(composerLongPostTitle, composerLongPostBlocks);
            const bootstrapHtml = buildLongPostHtmlFromBlocks(bootstrapBlocks);
            if (bootstrapHtml.trim()) {
              setComposerLongPostLexicalHtml(bootstrapHtml);
            }
          }
          setComposerLongPostEditorMode(mode);
          setComposerPostType('LP');
          setComposerLongPostLexicalResetKey((prev) => prev + 1);
        }}
        onChangeLexicalHtml={(value) => {
          const previousUrls = new Set(
            extractImageUrlsFromLongPostHtml(composerLongPostLexicalHtml).map(canonicalizeMediaUrl).filter(Boolean)
          );
          const nextUrls = new Set(
            extractImageUrlsFromLongPostHtml(value).map(canonicalizeMediaUrl).filter(Boolean)
          );
          const removed = Array.from(previousUrls).filter((url) => !nextUrls.has(url));
          setComposerLongPostLexicalHtml(value);
          setComposerPostType('LP');
          if (removed.length > 0) {
            void syncRemovedLongPostMedia(removed);
          }
        }}
        onChangeTitle={(value) => {
          setComposerLongPostTitle(value);
          setComposerPostType('LP');
        }}
        onChangeDraftExpiryDays={setComposerDraftExpiryDays}
        onSaveDraft={() => {
          void saveLongPostDraft(true);
        }}
        onPreview={openComposerLongPostPreview}
        onOpenDrafts={openLongPostDraftsDrawer}
        onClose={() => setLongPostDrawerOpen(false)}
        onApply={() => {
          void openComposerDestinationFromLongPost();
        }}
        onToggleExpanded={() => setLongPostDrawerExpanded((prev) => !prev)}
        token={token}
      />

      <Modal
        visible={composerDraftsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setComposerDraftsOpen(false)}
      >
        <TouchableOpacity
          style={styles.postComposerModalBackdrop}
          activeOpacity={1}
          onPress={() => setComposerDraftsOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.postComposerModalCard,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  width: Math.min(560, composerDrawerWidth),
                },
              ]}
            >
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                  {t('home.longPostDraftsTitle', { defaultValue: 'Long post drafts' })}
                </Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={() => setComposerDraftsOpen(false)}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              {composerDraftsLoading ? (
                <View style={styles.postComposerDraftsLoading}>
                  <ActivityIndicator color={c.primary} size="small" />
                </View>
              ) : (
                <ScrollView style={styles.postComposerDraftsList} contentContainerStyle={styles.postComposerDraftsListContent}>
                  {composerDrafts.map((draft) => (
                    <View
                      key={`lp-draft-${draft.uuid || draft.id}`}
                      style={[styles.postComposerDraftItem, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    >
                      <View style={styles.postComposerDraftItemMeta}>
                        <Text numberOfLines={2} style={[styles.postComposerDraftItemTitle, { color: c.textPrimary }]}>
                          {extractPlainTextFromBlocks((draft.long_text_blocks as LongPostBlock[]) || []).slice(0, 120)
                            || draft.long_text
                            || t('home.longPostDraftUntitled', { defaultValue: 'Untitled long post draft' })}
                        </Text>
                        <Text style={[styles.postComposerDraftItemSubtitle, { color: c.textMuted }]}>
                          {[
                            draft.created
                              ? t('home.longPostDraftCreatedAt', {
                                defaultValue: 'Created {{date}}',
                                date: new Date(draft.created).toLocaleString(),
                              })
                              : null,
                            draft.draft_expires_at
                              ? t('home.longPostDraftExpiresAt', {
                                defaultValue: 'Expires {{date}}',
                                date: new Date(draft.draft_expires_at).toLocaleString(),
                              })
                              : null,
                          ].filter(Boolean).join(' • ')}
                        </Text>
                      </View>
                      <View style={styles.postComposerDraftItemActions}>
                        <TouchableOpacity
                          style={[styles.externalLinkCancelButton, { borderColor: c.border, backgroundColor: c.surface }]}
                          activeOpacity={0.85}
                          disabled={composerDraftDeleteUuid === draft.uuid}
                          onPress={() => requestDeleteLongPostDraft(draft.uuid)}
                        >
                          {composerDraftDeleteUuid === draft.uuid ? (
                            <ActivityIndicator color={c.textSecondary} size="small" />
                          ) : (
                            <Text style={[styles.externalLinkCancelButtonText, { color: c.textSecondary }]}>
                              {t('home.deleteAction', { defaultValue: 'Delete' })}
                            </Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.externalLinkContinueButton, { backgroundColor: c.primary }]}
                          activeOpacity={0.85}
                          disabled={composerDraftDeleteUuid === draft.uuid}
                          onPress={() => void resumeLongPostDraft(draft)}
                        >
                          <Text style={styles.externalLinkContinueButtonText}>
                            {t('home.resumeAction', { defaultValue: 'Resume' })}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                  {composerDrafts.length === 0 ? (
                    <Text style={[styles.postComposerDestinationEmptyText, { color: c.textMuted }]}>
                      {t('home.longPostDraftsEmpty', { defaultValue: 'No saved long post drafts yet.' })}
                    </Text>
                  ) : null}
                </ScrollView>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <LongPostDrawer
        visible={longPostEditDrawerOpen}
        expanded={longPostEditDrawerExpanded}
        title={longPostEditTitle}
        blocks={longPostEditBlocks}
        draftExpiryDays={0}
        onChangeTitle={setLongPostEditTitle}
        onChangeBlocks={setLongPostEditBlocks}
        onChangeDraftExpiryDays={() => {}}
        onSaveDraft={() => {}}
        onPreview={openEditLongPostPreview}
        onOpenDrafts={() => {}}
        errorMessage={longPostEditError}
        onClose={() => {
          setLongPostEditDrawerOpen(false);
          setEditingLongPost(null);
          setLongPostEditTitle('');
          setLongPostEditError('');
        }}
        onApply={() => { setLongPostEditError(''); void saveLongPostEdit(); }}
        onToggleExpanded={() => setLongPostEditDrawerExpanded((prev) => !prev)}
        token={token}
      />

      <Modal
        visible={longPostPreviewOpen && !!longPostPreviewPost}
        transparent
        animationType="fade"
        onRequestClose={() => setLongPostPreviewOpen(false)}
      >
        <TouchableOpacity
          style={styles.postComposerModalBackdrop}
          activeOpacity={1}
          onPress={() => setLongPostPreviewOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.postComposerModalCard,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  width: Math.min(760, composerDrawerWidth),
                },
              ]}
            >
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                  {t('home.longPostPreviewTitle', { defaultValue: 'Feed Preview' })}
                </Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={() => setLongPostPreviewOpen(false)}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.postComposerDraftsList}
                contentContainerStyle={[
                  styles.postComposerDraftsListContent,
                  longPostPreviewExpandState.canExpand ? styles.postComposerDraftsListWithFooter : null,
                ]}
              >
                <View pointerEvents="none">
                  {longPostPreviewPost ? renderPostCard(longPostPreviewPost, 'feed', [], { allowExpandControl: false }) : null}
                </View>
              </ScrollView>
              {longPostPreviewPost && longPostPreviewExpandState.canExpand ? (
                <View style={[styles.previewExpandFooter, { borderTopColor: c.border, backgroundColor: c.surface }]}>
                  <TouchableOpacity
                    style={[styles.footerButtonGhost, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    activeOpacity={0.85}
                    onPress={() => toggleExpand(longPostPreviewPost.id)}
                  >
                    <Text style={[styles.footerGhostText, { color: c.textSecondary }]}>
                      {longPostPreviewExpandState.isExpanded
                        ? t('home.seeLess', { defaultValue: 'See less' })
                        : t('home.seeMore', { defaultValue: 'See more' })}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={!!composerDraftDeleteConfirmUuid}
        transparent
        animationType="fade"
        onRequestClose={() => setComposerDraftDeleteConfirmUuid(null)}
      >
        <TouchableOpacity
          style={styles.externalLinkModalBackdrop}
          activeOpacity={1}
          onPress={() => setComposerDraftDeleteConfirmUuid(null)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.externalLinkModalCard,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <Text style={[styles.externalLinkModalTitle, { color: c.textPrimary }]}>
                {t('home.longPostDraftDeleteConfirmTitle', { defaultValue: 'Delete draft?' })}
              </Text>
              <Text style={[styles.externalLinkModalBody, { color: c.textSecondary }]}>
                {t('home.longPostDraftDeleteConfirmBody', {
                  defaultValue: 'Are you sure you want to delete this draft?',
                })}
              </Text>
              <View style={styles.externalLinkModalActions}>
                <TouchableOpacity
                  style={[styles.externalLinkCancelButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={() => setComposerDraftDeleteConfirmUuid(null)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.externalLinkCancelButtonText, { color: c.textSecondary }]}>
                    {t('home.cancelAction', { defaultValue: 'Cancel' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.externalLinkContinueButton, { backgroundColor: c.primary }]}
                  onPress={() => void confirmDeleteLongPostDraft()}
                  activeOpacity={0.85}
                >
                  <Text style={styles.externalLinkContinueButtonText}>
                    {t('home.deleteAction', { defaultValue: 'Delete' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={reactionPickerPostId !== null}
        transparent
        animationType="fade"
        onRequestClose={closeReactionPicker}
      >
        <TouchableOpacity style={styles.reactionPickerBackdrop} activeOpacity={1} onPress={closeReactionPicker}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.reactionPickerCard,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>{t('home.reactionPickerTitle')}</Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={closeReactionPicker}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              {reactionPickerLoading ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : (
                <View style={styles.reactionPickerContent}>
                  <ScrollView style={styles.reactionPickerScroll} contentContainerStyle={styles.reactionPickerScrollContent}>
                    {reactionGroups.map((group) => (
                      <View key={`reaction-group-${group.id}`} style={styles.reactionGroup}>
                        <Text style={[styles.reactionGroupTitle, { color: c.textMuted }]}>
                          {group.keyword || t('home.reactAction')}
                        </Text>
                        <View style={styles.reactionEmojiWrap}>
                          {(group.emojis || []).map((emoji) => (
                            <TouchableOpacity
                              key={`reaction-emoji-${group.id}-${emoji.id}`}
                              style={[styles.reactionEmojiButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                              activeOpacity={0.85}
                              disabled={reactionActionLoading}
                              onPress={() => { const p = reactionPickerPostId !== null ? getSourcePost(reactionPickerPostId) : null; if (p) void reactToPostWithEmoji(p, emoji.id); }}
                            >
                              {emoji.image ? (
                                <Image source={{ uri: emoji.image }} style={styles.reactionEmojiImage} resizeMode="contain" />
                              ) : (
                                <MaterialCommunityIcons name="emoticon-outline" size={20} color={c.textSecondary} />
                              )}
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={reactionListOpen && !(!!activePost || postRouteLoading)}
        transparent
        animationType="fade"
        onRequestClose={closeReactionList}
      >
        <TouchableOpacity style={styles.reactionListBackdrop} activeOpacity={1} onPress={closeReactionList}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.reactionListCard,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  height: reactionListModalHeight,
                },
              ]}
            >
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                  {t('home.reactionReactorsTitle')}
                </Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={closeReactionList}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.reactionListSubtitle, { color: c.textMuted }]}>
                {reactionListEmoji?.keyword || ''}
              </Text>

              {reactionListPost?.reactions_emoji_counts?.length ? (
                <View style={styles.reactionSummaryWrap}>
                  <TouchableOpacity
                    style={[
                      styles.reactionSummaryChip,
                      {
                        borderColor: c.border,
                        backgroundColor: !reactionListEmoji?.id ? c.surface : c.inputBackground,
                      },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => void openReactionList(reactionListPost)}
                  >
                    <Text style={[styles.reactionSummaryCount, { color: c.textSecondary }]}>
                      {t('home.profileTabAll')}
                    </Text>
                  </TouchableOpacity>
                  {(reactionListPost.reactions_emoji_counts || [])
                    .filter((entry) => (entry?.count || 0) > 0)
                    .map((entry, idx) => (
                      <TouchableOpacity
                        key={`feed-reaction-filter-${reactionListPost.id}-${entry.emoji?.id || idx}`}
                        style={[
                          styles.reactionSummaryChip,
                          {
                            borderColor: c.border,
                            backgroundColor: reactionListEmoji?.id === entry.emoji?.id ? c.surface : c.inputBackground,
                          },
                        ]}
                        activeOpacity={0.85}
                        onPress={() => void openReactionList(reactionListPost, entry.emoji)}
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

              <View style={styles.reactionListContent}>
                {reactionListLoading ? (
                  <View style={styles.reactionListState}>
                    <ActivityIndicator color={c.primary} size="small" />
                  </View>
                ) : reactionListUsers.length === 0 ? (
                  <View style={styles.reactionListState}>
                    <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>{t('home.reactionReactorsEmpty')}</Text>
                  </View>
                ) : (
                  <ScrollView style={styles.reactionListScroll} contentContainerStyle={styles.reactionListScrollContent}>
                    {reactionListUsers.map((item, idx) => (
                      <TouchableOpacity
                        key={`reaction-user-${item.id || idx}`}
                        style={[styles.reactionUserRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        activeOpacity={0.85}
                        onPress={() => {
                          const username = item.reactor?.username;
                          if (!username) return;
                          closeReactionList();
                          onNavigate({ screen: 'profile', username });
                        }}
                      >
                        <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}>
                          {item.reactor?.profile?.avatar || item.reactor?.avatar ? (
                            <Image
                              source={{ uri: item.reactor?.profile?.avatar || item.reactor?.avatar || '' }}
                              style={styles.feedAvatarImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <Text style={styles.feedAvatarLetter}>
                              {(item.reactor?.username?.[0] || 'O').toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <View style={styles.feedHeaderMeta}>
                          <Text style={[styles.feedAuthor, { color: c.textPrimary }]}>
                            @{item.reactor?.username || t('home.unknownUser')}
                          </Text>
                          <Text style={[styles.feedDate, { color: c.textMuted }]}>
                            {item.created ? new Date(item.created).toLocaleString() : ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={!!reportPostTarget}
        transparent
        animationType="fade"
        onRequestClose={closeReportPostModal}
      >
        <TouchableOpacity style={styles.reactionListBackdrop} activeOpacity={1} onPress={closeReportPostModal}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.reportModalCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                  {t('home.reportPostTitle')}
                </Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={closeReportPostModal}
                  activeOpacity={0.85}
                  disabled={reportingPost}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.reportModalSubtitle, { color: c.textMuted }]}>
                {t('home.reportPostPrompt')}
              </Text>

              <ScrollView
                style={styles.reportOptionScroll}
                contentContainerStyle={styles.reportOptionList}
                showsVerticalScrollIndicator
              >
                {REPORTABLE_POST_CATEGORY_NAMES.map((categoryName) => (
                  <TouchableOpacity
                    key={`report-option-${categoryName}`}
                    style={[styles.reportOptionCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    activeOpacity={0.85}
                    onPress={() => submitPostReport(categoryName)}
                    disabled={reportingPost}
                  >
                    <Text style={[styles.reportOptionTitle, { color: c.textPrimary }]}>
                      {t(`home.reportCategory.${categoryName}.title`)}
                    </Text>
                    <Text style={[styles.reportOptionDescription, { color: c.textMuted }]}>
                      {t(`home.reportCategory.${categoryName}.description`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {reportingPost ? <ActivityIndicator color={c.primary} size="small" /> : null}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Generic report modal (comments, communities) ──────────── */}
      <Modal
        visible={!!reportTarget}
        transparent
        animationType="fade"
        onRequestClose={closeReportModal}
      >
        <TouchableOpacity style={styles.reactionListBackdrop} activeOpacity={1} onPress={closeReportModal}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.reportModalCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                  {reportTarget?.kind === 'community'
                    ? t('home.reportCommunityTitle', { defaultValue: 'Report community' })
                    : t('home.reportCommentTitle', { defaultValue: 'Report comment' })}
                </Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={closeReportModal}
                  activeOpacity={0.85}
                  disabled={reportingItem}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.reportModalSubtitle, { color: c.textMuted }]}>
                {reportTarget?.kind === 'community'
                  ? t('home.reportCommunityPrompt', { defaultValue: 'Why are you reporting this community?' })
                  : t('home.reportCommentPrompt', { defaultValue: 'Why are you reporting this comment?' })}
              </Text>

              <ScrollView
                style={styles.reportOptionScroll}
                contentContainerStyle={styles.reportOptionList}
                showsVerticalScrollIndicator
              >
                {moderationCategories.map((cat) => {
                  const normalizedName = normalizeModerationLabel(cat.name);
                  const normalizedTitle = normalizeModerationLabel(cat.title);
                  const match = (s: string) => normalizedName.includes(s) || normalizedTitle.includes(s);
                  let i18nKey: string | null = null;
                  if (match('spam')) i18nKey = 'spam';
                  else if (match('copyright') || match('trademark')) i18nKey = 'copyright';
                  else if (match('platform abuse') || match('abuse')) i18nKey = 'abuse';
                  else if (match('pornograph')) i18nKey = 'pornography';
                  else if (match('guideline')) i18nKey = 'guidelines';
                  else if (match('hatred') || match('bullying')) i18nKey = 'hatred';
                  else if (match('self harm')) i18nKey = 'selfHarm';
                  else if (match('violent') || match('gory')) i18nKey = 'violent';
                  else if (match('child') || match('csam') || match('exploitation')) i18nKey = 'csam';
                  else if (match('illegal') || match('drug')) i18nKey = 'illegal';
                  else if (match('deceptive')) i18nKey = 'deceptive';
                  else if (match('other')) i18nKey = 'other';
                  const displayTitle = i18nKey
                    ? t(`home.reportCategory.${i18nKey}.title`)
                    : cat.title || cat.name;
                  const displayDesc = i18nKey
                    ? t(`home.reportCategory.${i18nKey}.description`)
                    : cat.description || '';
                  return (
                    <TouchableOpacity
                      key={`report-generic-${cat.id}`}
                      style={[styles.reportOptionCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      activeOpacity={0.85}
                      onPress={() => void submitGenericReport(cat.id)}
                      disabled={reportingItem}
                    >
                      <Text style={[styles.reportOptionTitle, { color: c.textPrimary }]}>{displayTitle}</Text>
                      <Text style={[styles.reportOptionDescription, { color: c.textMuted }]}>{displayDesc}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {reportingItem ? <ActivityIndicator color={c.primary} size="small" /> : null}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Change communities modal ─────────────────────────────── */}
      <Modal
        visible={!!moveCommunitiesPost}
        transparent
        animationType="fade"
        onRequestClose={() => !moveCommunitiesSubmitting && setMoveCommunitiesPost(null)}
      >
        <TouchableOpacity
          style={[styles.postComposerModalBackdrop, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
          activeOpacity={1}
          onPress={() => !moveCommunitiesSubmitting && setMoveCommunitiesPost(null)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[
              styles.postComposerModalCard,
              {
                backgroundColor: c.surface,
                borderColor: c.border,
                maxHeight: '80%',
              },
            ]}
          >
            {/* Header */}
            <View style={[styles.linkedModalHeader, { borderBottomColor: c.border }]}>
              <Text style={[styles.postComposerDestinationSectionTitle, { color: c.textPrimary, marginBottom: 0, fontSize: 16 }]}>
                {t('home.movePostCommunitiesTitle', { defaultValue: 'Change communities' })}
              </Text>
              <TouchableOpacity onPress={() => !moveCommunitiesSubmitting && setMoveCommunitiesPost(null)} activeOpacity={0.7}>
                <MaterialCommunityIcons name="close" size={20} color={c.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.postComposerDestinationCounterRow}>
                <Text style={[styles.postComposerDestinationBody, { color: c.textMuted }]}>
                  {t('home.movePostCommunitiesHint', { defaultValue: 'Select up to 3 communities.' })}
                </Text>
                <Text style={[styles.postComposerDestinationCounterText, { color: c.textMuted }]}>
                  {`${moveCommunitiesSelectedNames.length}/3`}
                </Text>
              </View>

              <TextInput
                style={[
                  styles.postComposerDestinationSearchInput,
                  { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary },
                ]}
                placeholder={t('home.postComposerCommunitySearchPlaceholder', { defaultValue: 'Search your communities' })}
                placeholderTextColor={c.placeholder}
                value={moveCommunitiesSearch}
                onChangeText={setMoveCommunitiesSearch}
                editable={!moveCommunitiesSubmitting}
              />

              {moveCommunitiesLoading ? (
                <ActivityIndicator color={c.primary} size="small" style={{ marginTop: 12 }} />
              ) : (
                <View style={[styles.postComposerDestinationList, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                  {filteredMoveCommunitiesJoined.map((community) => {
                    const selected = !!community.name && moveCommunitiesSelectedNames.includes(community.name);
                    const communityInitial = (community.title || community.name || 'C').slice(0, 1).toUpperCase();
                    return (
                      <TouchableOpacity
                        key={`move-community-${community.id}`}
                        style={[
                          styles.postComposerDestinationItem,
                          {
                            borderColor: selected ? c.primary : c.border,
                            backgroundColor: selected ? `${c.primary}14` : c.surface,
                          },
                        ]}
                        activeOpacity={0.85}
                        disabled={moveCommunitiesSubmitting}
                        onPress={() => {
                          const targetName = community.name || '';
                          if (!targetName) return;
                          setMoveCommunitiesSelectedNames((prev) => {
                            if (prev.includes(targetName)) return prev.filter((n) => n !== targetName);
                            if (prev.length >= 3) {
                              setError(t('home.postComposerCommunityLimitReached', { defaultValue: 'You can select up to 3 communities.' }));
                              return prev;
                            }
                            return [...prev, targetName];
                          });
                        }}
                      >
                        <MaterialCommunityIcons
                          name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={18}
                          color={selected ? c.primary : c.textMuted}
                        />
                        <View style={[styles.postComposerCommunityAvatar, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                          {community.avatar ? (
                            <Image
                              source={{ uri: community.avatar }}
                              style={styles.postComposerCommunityAvatarImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <Text style={[styles.postComposerCommunityAvatarLetter, { color: c.textSecondary }]}>
                              {communityInitial}
                            </Text>
                          )}
                        </View>
                        <View style={styles.postComposerDestinationItemMeta}>
                          <Text style={[styles.postComposerDestinationItemTitle, { color: c.textPrimary }]}>
                            {community.title || (community.name ? `c/${community.name}` : '')}
                          </Text>
                          <Text style={[styles.postComposerDestinationItemSubtitle, { color: c.textMuted }]}>
                            {community.name ? `c/${community.name}` : ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {filteredMoveCommunitiesJoined.length === 0 && !moveCommunitiesLoading ? (
                    <Text style={[styles.postComposerDestinationEmptyText, { color: c.textMuted }]}>
                      {moveCommunitiesSearchTrimmed
                        ? t('home.postComposerNoMatchingCommunities', { defaultValue: 'No matching communities found.' })
                        : t('home.postComposerNoJoinedCommunities', { defaultValue: 'No joined communities found.' })}
                    </Text>
                  ) : null}
                </View>
              )}
            </ScrollView>

            {/* Actions */}
            <View style={[styles.postComposerActions, { borderTopColor: c.border }]}>
              <TouchableOpacity
                style={[styles.externalLinkCancelButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => !moveCommunitiesSubmitting && setMoveCommunitiesPost(null)}
                activeOpacity={0.85}
                disabled={moveCommunitiesSubmitting}
              >
                <Text style={[styles.externalLinkCancelButtonText, { color: c.textSecondary }]}>
                  {t('home.cancelAction', { defaultValue: 'Cancel' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.externalLinkContinueButton, { backgroundColor: c.primary, opacity: moveCommunitiesSubmitting ? 0.6 : 1 }]}
                onPress={() => void submitMovePostCommunities()}
                activeOpacity={0.85}
                disabled={moveCommunitiesSubmitting || moveCommunitiesLoading}
              >
                {moveCommunitiesSubmitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.externalLinkContinueButtonText}>
                    {t('home.movePostCommunitiesSave', { defaultValue: 'Save' })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {showWelcomeNotice && !loading ? (
        <View style={[styles.welcomeNoticeWrap, showBottomTabs && { marginTop: topChromeHeight }]}>
          <Animated.View
            style={[
              styles.welcomeNotice,
              { backgroundColor: c.surface, borderColor: c.border, transform: [{ translateX: welcomeTranslateX }] },
            ]}
          >
            <Text style={[styles.welcomeNoticeText, { color: c.textPrimary }]}>
              {welcomeText}
            </Text>
            <TouchableOpacity
              style={[styles.welcomeNoticeClose, { backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={hideWelcomeNotice}
              accessibilityLabel={t('home.closeNoticeAction')}
            >
              <MaterialCommunityIcons name="close" size={16} color={c.textSecondary} />
            </TouchableOpacity>
          </Animated.View>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flex: 1 }}>

        {/* ── Left sidebar ──────────────────────────────────────── */}
        {showHomeShellSidebars ? (
          <View style={{ width: SIDEBAR_LEFT_W, flexShrink: 0, overflow: 'hidden', borderRightWidth: 1, borderRightColor: c.border, backgroundColor: c.surface }}>
          <ScrollView
            style={[styles.sidebarPanel, { width: SIDEBAR_LEFT_W }]}
            contentContainerStyle={styles.sidebarContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Profile card */}
            <View style={[styles.sidebarWidget, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
              <View style={styles.sidebarProfileRow}>
                <View style={[styles.sidebarAvatar, { backgroundColor: c.primary }]}>
                  {user?.profile?.avatar ? (
                    <Image source={{ uri: user.profile.avatar }} style={styles.sidebarAvatarImage} resizeMode="cover" />
                  ) : (
                    <Text style={[styles.sidebarAvatarLetter, { color: '#fff' }]}>
                      {(user?.username?.[0] || 'O').toUpperCase()}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.sidebarProfileName, { color: c.textPrimary }]} numberOfLines={1}>
                    {user?.profile?.name || user?.username || ''}
                  </Text>
                  <Text style={[styles.sidebarProfileUsername, { color: c.textMuted }]} numberOfLines={1}>
                    @{user?.username}
                  </Text>
                </View>
              </View>
              <View style={styles.sidebarProfileStats}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={[styles.sidebarStatNumber, { color: c.textPrimary }]}>{user?.posts_count ?? 0}</Text>
                  <Text style={[styles.sidebarStatLabel, { color: c.textMuted }]}>{t('home.sidebarStatPosts', { defaultValue: 'Posts' })}</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={[styles.sidebarStatNumber, { color: c.textPrimary }]}>{user?.followers_count ?? 0}</Text>
                  <Text style={[styles.sidebarStatLabel, { color: c.textMuted }]}>{t('home.sidebarStatFollowers', { defaultValue: 'Followers' })}</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={[styles.sidebarStatNumber, { color: c.textPrimary }]}>{user?.following_count ?? 0}</Text>
                  <Text style={[styles.sidebarStatLabel, { color: c.textMuted }]}>{t('home.sidebarStatFollowing', { defaultValue: 'Following' })}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.sidebarViewProfileBtn, { borderColor: c.primary }]}
                activeOpacity={0.85}
                onPress={() => onNavigate({ screen: 'me' })}
              >
                <Text style={[styles.sidebarViewProfileBtnText, { color: c.primary }]}>
                  {t('home.sidebarViewProfile', { defaultValue: 'View Profile' })}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Joined communities */}
            <View style={[styles.sidebarWidget, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
              <View style={styles.sidebarWidgetHeader}>
                <Text style={[styles.sidebarWidgetTitle, { color: c.textPrimary }]}>
                  {t('home.sidebarCommunitiesTitle', { defaultValue: 'Communities' })}
                </Text>
                <TouchableOpacity onPress={() => onNavigate({ screen: 'communities' })} activeOpacity={0.8}>
                  <Text style={[styles.sidebarWidgetAction, { color: c.primary }]}>
                    {t('home.sidebarExploreAction', { defaultValue: 'Explore' })}
                  </Text>
                </TouchableOpacity>
              </View>
              {sidebarLoading && !sidebarDataLoaded ? (
                <ActivityIndicator size="small" color={c.primary} style={{ marginVertical: 12 }} />
              ) : sidebarCommunities.length === 0 ? (
                <Text style={[styles.sidebarEmptyText, { color: c.textMuted }]}>
                  {t('home.sidebarCommunitiesEmpty', { defaultValue: 'Join communities to see them here.' })}
                </Text>
              ) : (
                sidebarCommunities.map((community) => {
                  const initial = (community.title || community.name || 'C').slice(0, 1).toUpperCase();
                  return (
                    <TouchableOpacity
                      key={community.id}
                      style={styles.sidebarListRow}
                      activeOpacity={0.8}
                      onPress={() => handleNavigateCommunity(community.name || '')}
                    >
                      <View style={[styles.sidebarCommunityAvatar, { backgroundColor: c.border }]}>
                        {community.avatar ? (
                          <Image source={{ uri: community.avatar }} style={styles.sidebarCommunityAvatarImage} resizeMode="cover" />
                        ) : (
                          <Text style={[styles.sidebarCommunityAvatarLetter, { color: c.textSecondary }]}>{initial}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.sidebarListRowTitle, { color: c.textPrimary }]} numberOfLines={1}>
                          {community.title || `c/${community.name}`}
                        </Text>
                        <Text style={[styles.sidebarListRowSub, { color: c.textMuted }]} numberOfLines={1}>
                          c/{community.name}
                        </Text>
                      </View>
                      <MaterialCommunityIcons name="chevron-right" size={14} color={c.textMuted} />
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </ScrollView>
          </View>
        ) : null}

        {/* ── Main feed ─────────────────────────────────────────── */}
        <View style={{ flex: 1, position: 'relative' }}>
          {/* New posts banner — stays visible while loading to show progress */}
          {(newPostsAvailable || feedRefreshing) && !feedLoading && displayRoute.screen === 'feed' ? (
            <TouchableOpacity
              activeOpacity={feedRefreshing ? 1 : 0.9}
              onPress={feedRefreshing ? undefined : handleRefreshFeed}
              style={[styles.newPostsBanner, { backgroundColor: c.primary }]}
            >
              {feedRefreshing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialCommunityIcons name="arrow-up" size={14} color="#fff" />
              )}
              <Text style={styles.newPostsBannerText}>
                {feedRefreshing
                  ? t('home.newPostsBannerLoading', { defaultValue: 'Loading…' })
                  : t('home.newPostsBanner', { defaultValue: 'New posts available' })}
              </Text>
            </TouchableOpacity>
          ) : null}

        <ScrollView
          ref={mainScrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.rootContent,
            showHomeShellSidebars ? { paddingHorizontal: 16 } : null,
            isEdgeToEdge ? { paddingHorizontal: 0, paddingVertical: 0 } : null,
            showBottomTabs ? { paddingTop: topChromeHeight } : null,
          ]}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={feedRefreshing}
              onRefresh={handleRefreshFeed}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
        onScroll={({ nativeEvent }) => {
          // Native (iOS/Android) scroll handling — web uses the DOM listener above
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          handleTopBarOnScroll(contentOffset.y);
          const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 400;
          if (nearBottom && feedHasMore && !feedLoadingMore && !feedLoading) {
            void loadMoreFeed();
          }
        }}
      >
        {loading ? (
          <ActivityIndicator color={c.primary} size="large" />
        ) : (
          <>
            {displayRoute.screen === 'me' ? (
              <MyProfileScreen
                styles={styles}
                c={c}
                t={t}
                user={user}
                profileRouteUsername={profileRouteUsername}
                isCompactProfileLayout={isCompactProfileLayout}
                profileTabs={profileTabs}
                profileActiveTab={profileActiveTab}
                onSetProfileActiveTab={setProfileActiveTab}
                myProfilePosts={myProfilePosts}
                myProfilePostsLoading={myProfilePostsLoading}
                myProfileComments={myProfileComments}
                myProfileCommentsLoading={myProfileCommentsLoading}
                myPinnedPosts={myPinnedPosts}
                myPinnedPostsLoading={myPinnedPostsLoading}
                myJoinedCommunities={myJoinedCommunities}
                myJoinedCommunitiesLoading={myJoinedCommunitiesLoading}
                myJoinedCommunitiesLoadingMore={myJoinedCommunitiesLoadingMore}
                myJoinedCommunitiesHasMore={myJoinedCommunitiesHasMore}
                onLoadMoreJoinedCommunities={loadMoreMyJoinedCommunities}
                onOpenCommunity={(name: string) => onNavigate({ screen: 'community', name })}
                myFollowings={myFollowings}
                myFollowingsLoading={myFollowingsLoading}
                myFollowingsLoadingMore={myFollowingsLoadingMore}
                myFollowingsHasMore={myFollowingsHasMore}
                onLoadMoreFollowings={loadMoreMyFollowings}
                onOpenProfile={(username: string) => onNavigate({ screen: 'profile', username })}
                onOpenFollowersScreen={() => onNavigate({ screen: 'followers' })}
                onOpenFollowingScreen={() => onNavigate({ screen: 'following' })}
                onUpdateProfile={updateMyProfile}
                onUpdateProfileMedia={updateMyProfileMedia}
                onNotice={setNotice}
                onOpenEditProfile={openEditProfileDrawer}
                renderPostCard={(post, variant) => renderPostCard(post, variant, myPinnedPosts)}
                isOwnProfile
                isProfileLoading={false}
                isEdgeToEdge={isEdgeToEdge}
              />
            ) : null}

            {displayRoute.screen === 'profile' ? (
              <PublicProfileScreen
                styles={styles}
                c={c}
                t={t}
                user={profileUserLoading ? { username: profileRouteUsername, profile: {} } : (profileUser || { username: profileRouteUsername, profile: {} })}
                profileRouteUsername={profileRouteUsername}
                isCompactProfileLayout={isCompactProfileLayout}
                profileTabs={profileTabs}
                profileActiveTab={profileActiveTab}
                onSetProfileActiveTab={setProfileActiveTab}
                myProfilePosts={profilePosts}
                myProfilePostsLoading={profilePostsLoading}
                myProfileComments={profileComments}
                myProfileCommentsLoading={profileCommentsLoading}
                myPinnedPosts={profilePinnedPosts}
                myPinnedPostsLoading={profilePinnedPostsLoading}
                myJoinedCommunities={profileJoinedCommunities}
                myJoinedCommunitiesLoading={profileJoinedCommunitiesLoading}
                myJoinedCommunitiesLoadingMore={profileJoinedCommunitiesLoadingMore}
                myJoinedCommunitiesHasMore={profileJoinedCommunitiesHasMore}
                onLoadMoreJoinedCommunities={loadMoreProfileJoinedCommunities}
                onOpenCommunity={(name: string) => onNavigate({ screen: 'community', name })}
                myFollowings={profileFollowings}
                myFollowingsLoading={profileFollowingsLoading}
                myFollowingsLoadingMore={profileFollowingsLoadingMore}
                myFollowingsHasMore={profileFollowingsHasMore}
                onLoadMoreFollowings={loadMoreProfileFollowings}
                onOpenProfile={(username: string) => onNavigate({ screen: 'profile', username })}
                onUpdateProfile={updateMyProfile}
                onUpdateProfileMedia={updateMyProfileMedia}
                onNotice={setNotice}
                renderPostCard={(post, variant) => renderPostCard(post, variant, profilePinnedPosts)}
                isProfileLoading={profileUserLoading}
                isFollowing={!!followStateByUsername[profileRouteUsername]}
                followLoading={!!followActionLoadingByUsername[profileRouteUsername]}
                onToggleFollow={handleToggleFollow}
                isConnected={!!profileUser?.is_connected}
                isFullyConnected={!!profileUser?.is_fully_connected}
                isPendingConfirmation={!!profileUser?.is_pending_connection_confirmation}
                connectionCircleIds={(profileUser?.connected_circles || []).map((c: any) => c.id).filter(Boolean)}
                userCircles={userCircles}
                userLists={userLists}
                moderationCategories={moderationCategories}
                actionsLoading={profileActionsLoading}
                onConnect={handleConnect}
                onUpdateConnection={handleUpdateConnection}
                onConfirmConnection={handleConfirmConnection}
                onDeclineConnection={handleDeclineConnection}
                onDisconnect={handleDisconnect}
                onAddToList={handleAddToList}
                onCreateList={handleCreateList}
                onFetchEmojiGroups={() => api.getEmojiGroups(token)}
                onCreateCircle={handleCreateCircle}
                onBlockUser={handleBlockUser}
                onUnblockUser={handleUnblockUser}
                onReportUser={handleReportUser}
                isSubscribedToPosts={userPostSubByUsername[profileRouteUsername] ?? null}
                subscribeToPostsLoading={!!userPostSubLoadingByUsername[profileRouteUsername]}
                onToggleSubscribeToPosts={
                  profileRouteUsername && profileRouteUsername !== user?.username
                    ? () => void handleToggleUserPostSubscription(profileRouteUsername)
                    : undefined
                }
                isEdgeToEdge={isEdgeToEdge}
              />
            ) : null}

            {viewingCommunityRoute ? (
              <CommunityProfileScreen
                styles={styles}
                c={c}
                t={t}
                community={communityInfo}
                communityLoading={communityInfoLoading}
                communityOwner={communityOwner}
                communityMembers={communityMembers}
                communityMembersLoading={communityMembersLoading}
                communityMembersLoadingMore={communityMembersLoadingMore}
                communityMembersHasMore={communityMembersHasMore}
                posts={filteredCommunityRoutePosts}
                postsLoading={communityRouteLoading}
                postsError={communityRouteError}
                communityPostsFilterUsername={communityRoutePosterFilterUsername}
                onClearCommunityPostsFilter={() => setCommunityRoutePosterFilterUsername(null)}
                isJoined={!!(communityInfo?.memberships?.length)}
                isPendingJoinRequest={communityPendingJoinRequest}
                joinLoading={communityJoinLoading}
                notificationsEnabled={communityNotifEnabled}
                notificationsLoading={communityNotifLoading}
                isTimelineMuted={communityTimelineMuted}
                muteLoading={communityMuteLoading}
                canManageCommunity={canManageCurrentCommunity}
                communityPinnedPosts={communityPinnedPosts}
                communityPinnedPostsLoading={communityPinnedPostsLoading}
                onToggleCommunityPinPost={canManageCurrentCommunity ? toggleCommunityPinPost : undefined}
                onJoin={() => void handleJoinCommunity()}
                onLeave={() => requestLeaveCommunity()}
                onToggleNotifications={() => void handleToggleCommunityNotifications()}
                onMuteTimeline={(durationDays) => void handleMuteCommunityTimeline(durationDays)}
                onUnmuteTimeline={() => void handleUnmuteCommunityTimeline()}
                onLoadMoreMembers={() => void loadMoreCommunityMembers()}
                onOpenManageCommunity={() => {
                  setCommunityManageTarget(communityInfo);
                  setCommunityManageDrawerOpen(true);
                }}
                onOpenProfile={(username) => onNavigate({ screen: 'profile', username })}
                onReportCommunity={communityInfo?.name ? () => openCommunityReportModal(communityInfo.name!, communityInfo.title) : undefined}
                renderPostCard={(post, variant) =>
                  renderPostCard(post, variant, myPinnedPosts, {
                    onToggleCommunityPinPost: canManageCurrentCommunity ? toggleCommunityPinPost : undefined,
                    onToggleClosePost: canManageCurrentCommunity ? toggleClosePost : undefined,
                  })
                }
                isEdgeToEdge={isEdgeToEdge}
              />
            ) : null}

            {viewingHashtagRoute ? (
              <RouteSummaryCard
                styles={styles}
                c={c}
                title={`#${hashtagRouteName}`}
                subtitle={t('home.hashtagRouteLabel', { hashtag: hashtagRouteName })}
              />
            ) : null}

            {displayRoute.screen === 'circles' ? (
              <CirclesScreen
                token={token}
                c={c}
                t={t}
                onNotice={setNotice}
              />
            ) : null}

            {displayRoute.screen === 'communities' ? (
              <CommunitiesScreen
                token={token}
                c={c}
                t={t}
                onNotice={setNotice}
                onOpenCommunity={(name: string) => onNavigate({ screen: 'community', name })}
              />
            ) : null}

            {displayRoute.screen === 'manage-communities' ? (
              <ManageCommunitiesScreen
                token={token}
                c={c}
                t={t}
                onNotice={setNotice}
                refreshKey={manageCommunitiesRefreshKey}
                onOpenCommunity={(name: string) => onNavigate({ screen: 'community', name })}
                onOpenManageCommunity={(name: string) => {
                  void openCommunityManagerByName(name);
                }}
              />
            ) : null}

            {displayRoute.screen === 'muted-communities' ? (
              <MutedCommunitiesScreen
                token={token}
                c={c}
                t={t}
                onNotice={setNotice}
                onOpenCommunity={(name: string) => onNavigate({ screen: 'community', name })}
              />
            ) : null}

            {displayRoute.screen === 'lists' ? (
              <ListsScreen
                token={token}
                c={c}
                t={t}
                onNotice={setNotice}
              />
            ) : null}

            {displayRoute.screen === 'followers' ? (
              <FollowPeopleScreen
                mode="followers"
                token={token}
                c={c}
                t={t}
                onNotice={setNotice}
                onOpenProfile={(username: string) => onNavigate({ screen: 'profile', username })}
              />
            ) : null}

            {displayRoute.screen === 'following' ? (
              <FollowPeopleScreen
                mode="following"
                token={token}
                c={c}
                t={t}
                onNotice={setNotice}
                onOpenProfile={(username: string) => onNavigate({ screen: 'profile', username })}
              />
            ) : null}

            {displayRoute.screen === 'blocked' ? (
              <FollowPeopleScreen
                mode="blocked"
                token={token}
                c={c}
                t={t}
                onNotice={setNotice}
                onOpenProfile={(username: string) => onNavigate({ screen: 'profile', username })}
              />
            ) : null}

            {displayRoute.screen === 'settings' ? (
              <SettingsScreen
                c={c}
                t={t}
                token={token}
                currentEmail={user?.email || ''}
                hasUsablePassword={resolvedHasUsablePassword || passwordInitializedOverride}
                requiresCurrentPassword={effectiveRequiresCurrentPassword}
                autoPlayMedia={autoPlayMedia}
                onToggleAutoPlayMedia={() => {
                  void handleToggleAutoPlayMedia();
                }}
                onOpenLinkedAccounts={() => setLinkedAccountsOpen(true)}
                onOpenBlockedUsers={() => setBlockedUsersDrawerOpen(true)}
                onNotice={setNotice}
                onChangePassword={handleChangePassword}
                onRequestEmailChange={handleRequestEmailChange}
                onConfirmEmailChange={handleConfirmEmailChange}
                onGetNotificationSettings={() => api.getNotificationSettings(token)}
                onUpdateNotificationSettings={(patch) => api.updateNotificationSettings(token, patch)}
                onDeleteAccount={() => onLogout()}
              />
            ) : null}

            {showingMainSearchResults ? (
              <SearchResultsScreen
                styles={styles}
                c={c}
                t={t}
                isWideSearchResultsLayout={isWideSearchResultsLayout}
                searchResultsQuery={searchResultsQuery}
                searchResultsLoading={searchResultsLoading}
                searchError={searchError}
                searchUsers={searchUsers}
                searchCommunities={searchCommunities}
                searchHashtags={searchHashtags}
                hasAnySearchResults={hasAnySearchResults}
                onBack={handleBackToHomeFeed}
                onSelectUser={handleSelectSearchUser}
                onSelectCommunity={handleSelectSearchCommunity}
                onSelectHashtag={handleSelectSearchHashtag}
                isEdgeToEdge={isEdgeToEdge}
              />
            ) : null}

            {!viewingProfileRoute && !viewingCommunitiesRoute && !viewingManageCommunitiesRoute && !viewingCommunityRoute && !viewingHashtagRoute && !viewingFollowPeopleRoute && !viewingSettingsRoute && !showingMainSearchResults && displayRoute.screen !== 'circles' && displayRoute.screen !== 'lists' ? (
              <FeedScreen
                styles={styles}
                c={c}
                t={t}
                user={user}
                onComposerPress={() => openComposerModal()}
                onComposerActionPress={(action) => openComposerModal(action)}
                feedLoading={feedLoading}
                feedError={feedError}
                feedPosts={feedPosts}
                activeFeed={activeFeed}
                feedLoadingMore={feedLoadingMore}
                feedHasMore={feedHasMore}
                renderPostCard={renderPostCard}
                isEdgeToEdge={isEdgeToEdge}
                hideComposer={showBottomTabs}
              />
            ) : null}

          {!!suspensionExpiry && (
            <View style={[styles.errorBox, { backgroundColor: `${c.errorText}18`, borderColor: c.errorText, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
              <MaterialCommunityIcons name="account-lock-outline" size={20} color={c.errorText} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.errorText, { color: c.errorText, fontWeight: '600' }]}>
                  {t('home.suspensionBannerTitle', { defaultValue: 'Your account is suspended' })}
                </Text>
                <Text style={[styles.errorText, { color: c.errorText, fontWeight: '400', marginTop: 2 }]}>
                  {t('home.suspensionBannerExpiry', {
                    defaultValue: `Suspension lifts: ${new Date(suspensionExpiry).toLocaleString()}`,
                    expiry: new Date(suspensionExpiry).toLocaleString(),
                  })}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSuspensionExpiry(null)} activeOpacity={0.7}>
                <MaterialCommunityIcons name="close" size={18} color={c.errorText} />
              </TouchableOpacity>
            </View>
          )}

          {!!error && (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: c.errorBackground, borderColor: c.errorBorder },
              ]}
            >
              <Text style={[styles.errorText, { color: c.errorText }]}>
                {error}
              </Text>
            </View>
          )}

          </>
        )}
      </ScrollView>
        </View>{/* end main feed wrapper */}

        {/* ── Right sidebar ─────────────────────────────────────── */}
        {showHomeShellSidebars ? (
          <View style={{ width: SIDEBAR_RIGHT_W, flexShrink: 0, overflow: 'hidden', borderLeftWidth: 1, borderLeftColor: c.border, backgroundColor: c.surface }}>
          <ScrollView
            style={[styles.sidebarPanel, { width: SIDEBAR_RIGHT_W }]}
            contentContainerStyle={styles.sidebarContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Your circles */}
            <View style={[styles.sidebarWidget, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
              <View style={styles.sidebarWidgetHeader}>
                <Text style={[styles.sidebarWidgetTitle, { color: c.textPrimary }]}>
                  {t('home.sidebarCirclesTitle', { defaultValue: 'Your Circles' })}
                </Text>
                <TouchableOpacity onPress={() => onNavigate({ screen: 'circles' })} activeOpacity={0.8}>
                  <Text style={[styles.sidebarWidgetAction, { color: c.primary }]}>
                    {t('home.sidebarManageAction', { defaultValue: 'Manage' })}
                  </Text>
                </TouchableOpacity>
              </View>
              {sidebarLoading && !sidebarDataLoaded ? (
                <ActivityIndicator size="small" color={c.primary} style={{ marginVertical: 12 }} />
              ) : sidebarCircles.length === 0 ? (
                <View style={{ paddingBottom: 4 }}>
                  <Text style={[styles.sidebarEmptyText, { color: c.textMuted }]}>
                    {t('home.sidebarCirclesEmpty', { defaultValue: 'You have no circles yet.' })}
                  </Text>
                  <TouchableOpacity
                    onPress={() => onNavigate({ screen: 'circles' })}
                    activeOpacity={0.8}
                    style={{ marginTop: 6 }}
                  >
                    <Text style={{ fontSize: 12, color: c.primary, fontWeight: '600' }}>
                      {t('home.sidebarCirclesCreate', { defaultValue: 'Create a circle →' })}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                sidebarCircles.map((circle) => (
                  <TouchableOpacity
                    key={circle.id}
                    style={styles.sidebarListRow}
                    activeOpacity={0.8}
                    onPress={() => onNavigate({ screen: 'circles' })}
                  >
                    <View style={[styles.sidebarCircleDot, { backgroundColor: circle.color || c.primary }]} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.sidebarListRowTitle, { color: c.textPrimary }]} numberOfLines={1}>
                        {circle.name}
                      </Text>
                      <Text style={[styles.sidebarListRowSub, { color: c.textMuted }]}>
                        {t('home.sidebarCircleMembers', { count: circle.users_count ?? 0, defaultValue: '{{count}} members' })}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </View>

            {/* Trending hashtags */}
            <View style={[styles.sidebarWidget, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
              <Text style={[styles.sidebarWidgetTitle, { color: c.textPrimary }]}>
                {t('home.sidebarTrendingTitle', { defaultValue: 'Trending' })}
              </Text>
              {sidebarLoading && !sidebarDataLoaded ? (
                <ActivityIndicator size="small" color={c.primary} style={{ marginVertical: 12 }} />
              ) : sidebarHashtags.length === 0 ? (
                <Text style={[styles.sidebarEmptyText, { color: c.textMuted }]}>
                  {t('home.sidebarTrendingEmpty', { defaultValue: 'Trending topics will appear here as the community grows.' })}
                </Text>
              ) : (
                sidebarHashtags.map((hashtag, index) => (
                  <TouchableOpacity
                    key={hashtag.id}
                    style={[styles.sidebarHashtagRow, index < sidebarHashtags.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.border }]}
                    activeOpacity={0.8}
                    onPress={() => hashtag.name && onNavigate({ screen: 'hashtag', name: hashtag.name })}
                  >
                    <Text style={[styles.sidebarHashtagName, { color: c.textPrimary }]} numberOfLines={1}>
                      #{hashtag.name}
                    </Text>
                    {typeof hashtag.posts_count === 'number' && hashtag.posts_count > 0 ? (
                      <Text style={[styles.sidebarHashtagCount, { color: c.textMuted }]}>
                        {hashtag.posts_count.toLocaleString()} {t('home.sidebarHashtagPosts', { defaultValue: 'posts' })}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                ))
              )}
            </View>
          </ScrollView>
          </View>
        ) : null}

      </View>{/* end three-column row */}

      {showBottomTabs ? (
        <BottomTabBar
          c={c}
          t={t}
          activeTab={activeBottomTab}
          unreadNotifications={unreadCount}
          onNavigateHome={() => onNavigate({ screen: 'feed', feed: 'home' })}
          onNavigateCommunities={() => onNavigate({ screen: 'communities' })}
          onOpenComposer={() => openComposerModal()}
          onOpenNotifications={() => void handleOpenNotifications()}
          onNavigateProfile={() => onNavigate({ screen: 'me' })}
        />
      ) : null}

      <Modal
        transparent
        visible={communityLeaveConfirmOpen}
        animationType="fade"
        onRequestClose={() => {
          if (!communityJoinLoading) setCommunityLeaveConfirmOpen(false);
        }}
      >
        <Pressable
          style={[styles.leaveConfirmBackdrop, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
          onPress={() => {
            if (!communityJoinLoading) setCommunityLeaveConfirmOpen(false);
          }}
        >
          <Pressable
            style={[styles.leaveConfirmCard, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={() => {}}
          >
            <Text style={[styles.leaveConfirmTitle, { color: c.textPrimary }]}>
              {t('community.leaveConfirmTitle', { defaultValue: 'Leave this community?' })}
            </Text>
            <Text style={[styles.leaveConfirmText, { color: c.textSecondary }]}>
              {t('community.leaveConfirmMessage', {
                defaultValue:
                  'If you leave c/{{name}}, all of your content contributions in this community will be permanently deleted.',
                name: route.screen === 'community' ? route.name : '',
              })}
            </Text>
            <Text style={[styles.leaveConfirmWarning, { color: c.errorText || '#dc2626' }]}>
              {t('community.leaveConfirmWarning', {
                defaultValue:
                  'This cannot be undone. Deleted contributions will not come back if you join again later.',
              })}
            </Text>
            <View style={styles.leaveConfirmActions}>
              <TouchableOpacity
                style={[styles.leaveConfirmBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                activeOpacity={0.85}
                disabled={communityJoinLoading}
                onPress={() => setCommunityLeaveConfirmOpen(false)}
              >
                <Text style={[styles.leaveConfirmBtnText, { color: c.textPrimary }]}>
                  {t('home.cancelAction', { defaultValue: 'Cancel' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.leaveConfirmBtn,
                  { borderColor: c.errorText || '#dc2626', backgroundColor: `${c.errorText || '#dc2626'}22` },
                ]}
                activeOpacity={0.85}
                disabled={communityJoinLoading}
                onPress={() => void handleLeaveCommunity()}
              >
                {communityJoinLoading ? (
                  <ActivityIndicator size="small" color={c.errorText || '#dc2626'} />
                ) : (
                  <Text style={[styles.leaveConfirmBtnText, { color: c.errorText || '#dc2626' }]}>
                    {t('community.leaveConfirmAction', { defaultValue: 'Leave and delete contributions' })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <NotificationDrawer
        visible={notifDrawerOpen}
        c={c}
        t={t}
        notifications={notifications}
        loading={notifLoading}
        loadingMore={notifLoadingMore}
        hasMore={notifHasMore}
        unreadCount={unreadCount}
        onClose={() => setNotifDrawerOpen(false)}
        onLoadMore={() => void handleLoadMoreNotifications()}
        onMarkAllRead={() => void handleMarkAllRead()}
        onMarkRead={(id) => void handleMarkRead(id)}
        onDeleteNotification={(id) => void handleDeleteNotification(id)}
        onDeleteAll={() => void handleDeleteAllNotifications()}
        onDeleteFiltered={(ids) => handleDeleteFilteredNotifications(ids)}
        onNavigateProfile={handleNotificationNavigateProfile}
        onNavigatePost={handleNotificationNavigatePost}
        onNavigateCommunity={handleNotificationNavigateCommunity}
        onAcceptConnection={async (username) => {
          await api.confirmConnection(token, username, []);
          if (profileUser?.username === username) {
            setProfileUser((prev: any) => prev ? { ...prev, is_connected: true, is_fully_connected: true, is_pending_connection_confirmation: false } : prev);
          }
        }}
        onDeclineConnection={async (username) => {
          await api.disconnectFromUser(token, username);
          if (profileUser?.username === username) {
            setProfileUser((prev: any) => prev ? { ...prev, is_connected: false, is_fully_connected: false, is_pending_connection_confirmation: false, connected_circles: [] } : prev);
          }
        }}
        onAcceptCommunityAdminInvite={async (inviteId, communityName) => {
          await api.respondCommunityAdministratorInvite(token, communityName, inviteId, 'accept');
          setNotice(t('community.administratorInviteAcceptedNotice', { defaultValue: `You are now an administrator of c/${communityName}.` }));
        }}
        onDeclineCommunityAdminInvite={async (inviteId, communityName) => {
          await api.respondCommunityAdministratorInvite(token, communityName, inviteId, 'decline');
          setNotice(t('community.administratorInviteDeclinedNotice', { defaultValue: `Administrator invite to c/${communityName} declined.` }));
        }}
        onAcceptCommunityOwnershipTransfer={async (inviteId, communityName) => {
          await api.respondCommunityOwnershipTransferInvite(token, communityName, inviteId, 'accept');
          setNotice(t('community.ownershipTransferAcceptedNotice', { defaultValue: `You are now the owner of c/${communityName}.` }));
        }}
        onDeclineCommunityOwnershipTransfer={async (inviteId, communityName) => {
          await api.respondCommunityOwnershipTransferInvite(token, communityName, inviteId, 'decline');
          setNotice(t('community.ownershipTransferDeclinedNotice', { defaultValue: `Ownership transfer for c/${communityName} declined.` }));
        }}
        onOpenModerationTasks={() => {
          setNotifDrawerOpen(false);
          setModerationTasksStatus('P');
          setModerationTasksOpen(true);
          loadModerationTasks('P');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topNav: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    // Raised above feedPostHeader (zIndex 1600) so the searchDropdown
    // (a descendant of topNav) paints above the feed on desktop web.
    // On mobile the Animated.View wrapper also declares a high zIndex,
    // but this ensures desktop has the right stacking regardless.
    zIndex: 1700,
  },
  topNavLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  topNavBrand: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topNavBrandLetter: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 24,
  },
  topNavSearch: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    maxWidth: 340,
  },
  topNavSearchWrap: {
    position: 'relative',
    flex: 1,
    maxWidth: 340,
  },
  topNavSearchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  searchDropdown: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: 14,
    zIndex: 1200,
    maxHeight: 460,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  searchDropdownLoading: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchDropdownScroll: {
    maxHeight: 460,
  },
  searchDropdownScrollContent: {
    padding: 10,
    gap: 12,
  },
  searchShowAllButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchShowAllButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  backToFeedButton: {
    position: 'absolute',
    left: 0,
    top: 0,
    minWidth: 0,
  },
  backToFeedButtonSlim: {
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 10,
    minHeight: 34,
  },
  backToFeedButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  backToFeedButtonText: {
    fontSize: 12,
  },
  searchResultsWideLayout: {
    width: '100%',
    maxWidth: 1400,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 20,
    marginBottom: 20,
  },
  searchResultsLeftReserve: {
    width: 260,
    minHeight: 1,
  },
  searchResultsMainCard: {
    flex: 1,
    maxWidth: 1120,
  },
  searchMainHeader: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    minHeight: 48,
  },
  searchMainSections: {
    gap: 24,
  },
  searchMainTitle: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 34,
    textAlign: 'center',
  },
  searchSection: {
    gap: 8,
  },
  searchSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingHorizontal: 2,
  },
  searchSectionEmpty: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  searchSectionError: {
    fontSize: 12,
    fontWeight: '700',
  },
  searchSectionEmptyGlobal: {
    fontSize: 12,
    fontWeight: '600',
  },
  searchResultRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchTileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  searchTile: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '48%',
    minWidth: 250,
  },
  searchTileWide: {
    width: '31.5%',
  },
  searchAvatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  searchAvatarImage: {
    width: '100%',
    height: '100%',
  },
  searchAvatarLetter: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  searchResultMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  searchResultPrimary: {
    fontSize: 15,
    fontWeight: '700',
  },
  searchResultSecondary: {
    fontSize: 12,
    fontWeight: '600',
  },
  topNavCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 6,
  },
  topNavFeedButton: {
    width: 72,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
  },
  topNavFeedWrap: {
    position: 'relative',
  },
  feedTooltip: {
    position: 'absolute',
    top: 52,
    left: '50%',
    transform: [{ translateX: -74 }],
    width: 148,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    opacity: 1,
    zIndex: 1000,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  feedTooltipText: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    fontWeight: '600',
  },
  topNavRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flex: 1,
    minWidth: 200,
  },
  topNavUtility: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topNavProfile: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  topNavProfileImage: {
    width: 38,
    height: 38,
    borderRadius: 999,
  },
  topNavProfileText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingTop: 70,
    paddingRight: 16,
  },
  linkedAccountsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  leaveConfirmBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  leaveConfirmCard: {
    width: '100%',
    maxWidth: 560,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  leaveConfirmTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  leaveConfirmText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  leaveConfirmWarning: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  leaveConfirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  leaveConfirmBtn: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 40,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveConfirmBtnText: {
    fontSize: 14,
    fontWeight: '800',
  },
  drawerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  drawerPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    paddingTop: 20,
    paddingHorizontal: 14,
    paddingBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 24,
  },
  menuCard: {
    width: 280,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  linkedModalCard: {
    width: 520,
    maxWidth: '92%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  postComposerModalCard: {
    height: '100%',
    borderWidth: 1,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    padding: 14,
    gap: 12,
    overflow: 'hidden',
  },
  postComposerContent: {
    flex: 1,
    minHeight: 0,
  },
  postComposerComposeContent: {
    flex: 1,
    paddingBottom: 6,
    gap: 10,
  },
  postComposerModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  postComposerModeLabel: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  postComposerModeButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  postComposerModeButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  postComposerDestinationScroll: {
    flex: 1,
  },
  postComposerDestinationScrollContent: {
    paddingBottom: 6,
  },
  postComposerTextInput: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 174,
    maxHeight: 360,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    lineHeight: 22,
  },
  postComposerCounterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 0,
  },
  postComposerCounterAndToolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 0,
  },
  postComposerToolbarInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    flex: 1,
  },
  postComposerCounterText: {
    fontSize: 12,
    fontWeight: '600',
  },
  postComposerPreviewWrap: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 90,
    maxHeight: 280,
  },
  postComposerLinkPreviewWrap: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 70,
  },
  postComposerLinkPreviewLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 70,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  postComposerLinkPreviewLoadingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  postComposerLinkPreviewCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 78,
  },
  postComposerLinkPreviewImage: {
    width: 108,
    minWidth: 108,
    height: '100%',
  },
  postComposerLinkPreviewMeta: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  postComposerLinkPreviewSite: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  postComposerLinkPreviewTitle: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
    marginBottom: 4,
  },
  postComposerLinkPreviewDescription: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4,
  },
  postComposerLinkPreviewUrl: {
    fontSize: 12,
    fontWeight: '600',
  },
  postComposerPreviewImage: {
    width: '100%',
    height: 220,
  },
  postComposerVideoPreview: {
    minHeight: 90,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postComposerPreviewName: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  postComposerImageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 10,
  },
  postComposerImageTile: {
    width: 92,
    height: 92,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  postComposerImageTilePreview: {
    width: '100%',
    height: '100%',
  },
  postComposerImageRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postComposerImageRotate: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postComposerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  postComposerToolButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  postComposerToolButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  postComposerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
    paddingTop: 10,
  },
  postComposerDestinationStepWrap: {
    gap: 10,
  },
  postComposerDestinationTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  postComposerDestinationBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  postComposerDestinationCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  postComposerDestinationCounterText: {
    fontSize: 12,
    fontWeight: '700',
  },
  postComposerDestinationSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  postComposerDestinationTypeTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  postComposerDestinationTypeTab: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
  },
  postComposerDestinationTypeTabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  postComposerDestinationLoading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postComposerDestinationSearchInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 10,
    fontSize: 16,
  },
  postComposerDestinationList: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 140,
    maxHeight: 260,
  },
  postComposerDestinationListContent: {
    padding: 10,
    gap: 8,
  },
  postComposerDestinationItem: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postComposerCircleColorSwatch: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  postComposerCommunityAvatar: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postComposerCommunityAvatarImage: {
    width: '100%',
    height: '100%',
  },
  postComposerCommunityAvatarLetter: {
    fontSize: 12,
    fontWeight: '700',
  },
  postComposerDestinationItemMeta: {
    flex: 1,
  },
  postComposerDestinationItemTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  postComposerDestinationItemSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  postComposerDestinationEmptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  postComposerDraftsLoading: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postComposerDraftsList: {
    flex: 1,
  },
  postComposerDraftsListContent: {
    paddingBottom: 6,
    gap: 8,
  },
  postComposerDraftsListWithFooter: {
    paddingBottom: 16,
  },
  previewExpandFooter: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'flex-end',
  },
  footerButtonGhost: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 34,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerGhostText: {
    fontSize: 13,
    fontWeight: '700',
  },
  postComposerDraftItem: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  postComposerDraftItemMeta: {
    gap: 4,
  },
  postComposerDraftItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  postComposerDraftItemSubtitle: {
    fontSize: 12,
  },
  postComposerDraftItemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  reactionPickerCard: {
    width: 640,
    maxWidth: '94%',
    minHeight: 320,
    maxHeight: '80%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    overflow: 'hidden',
    zIndex: 2300,
    elevation: 24,
  },
  reactionPickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 2200,
  },
  reactionPickerContent: {
    flex: 1,
    minHeight: 120,
  },
  reactionPickerScroll: {
    flex: 1,
  },
  reactionPickerScrollContent: {
    gap: 12,
    paddingBottom: 10,
  },
  reactionGroup: {
    gap: 8,
  },
  reactionGroupTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  reactionEmojiWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reactionEmojiButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmojiImage: {
    width: 22,
    height: 22,
  },
  reactionListCard: {
    width: 620,
    maxWidth: '94%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    overflow: 'hidden',
  },
  reactionListBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  reactionListSubtitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  reportModalCard: {
    width: 680,
    maxWidth: '94%',
    minHeight: 420,
    maxHeight: '90%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  reportModalSubtitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  reportOptionScroll: {
    maxHeight: 420,
  },
  reportOptionList: {
    gap: 10,
    paddingBottom: 4,
  },
  reportOptionCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  reportOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  reportOptionDescription: {
    fontSize: 12,
    lineHeight: 17,
  },
  reactionListContent: {
    flex: 1,
    minHeight: 120,
  },
  reactionListState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionListScroll: {
    flex: 1,
  },
  reactionListScrollContent: {
    paddingBottom: 8,
    gap: 8,
  },
  reactionUserRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  linkedModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  settingsDrawerHeader: {
    marginBottom: 8,
  },
  profileMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  // ── Side menu (consolidated profile + settings menu) ──────────────────────
  sideMenuCard: {
    width: 300,
    minHeight: '100%',
    paddingHorizontal: 16,
    paddingTop: 28,
    paddingBottom: 32,
    gap: 2,
  },
  sideMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 16,
    marginBottom: 8,
    borderBottomWidth: 1,
  },
  sideMenuHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sideMenuAvatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sideMenuAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 999,
  },
  sideMenuAvatarLetter: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 18,
  },
  sideMenuUsername: {
    fontSize: 15,
    fontWeight: '700',
  },
  sideMenuHandle: {
    fontSize: 12,
    marginTop: 1,
  },
  sideMenuSectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  sideMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 0,
  },
  sideMenuItemText: {
    fontSize: 14,
    fontWeight: '600',
  },
  sideMenuLogout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: 10,
    marginTop: 4,
  },
  // Legacy — kept so any remaining references don't crash
  profileMenuCard: { width: 0, height: 0 },
  profileMenuHeader: {},
  profileMenuAvatar: { width: 0, height: 0, borderRadius: 0, alignItems: 'center', justifyContent: 'center' },
  profileMenuHeaderText: {},
  profileMenuTitle: {},
  profileMenuSubtitle: {},
  profileMenuItem: {},
  profileMenuItemText: {},
  menuItem: {},
  menuItemText: {},
  menuLanguageWrap: {},
  menuLabel: {},
  rootContent: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 32,
  },
  postDetailRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  postDetailTextOnlyRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  postDetailTextOnlyCard: {
    width: '100%',
    maxWidth: 980,
    height: '92%',
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  postDetailTextOnlyHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postDetailTextOnlyComposerWrap: {
    borderTopWidth: 1,
    padding: 12,
  },
  postDetailLeft: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    position: 'relative',
  },
  postDetailClose: {
    position: 'absolute',
    top: 18,
    left: 18,
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  postDetailMediaWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  postDetailMedia: {
    width: '100%',
    height: '100%',
    maxWidth: 980,
    maxHeight: 900,
  },
  postDetailMediaNavButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  postDetailMediaNavButtonLeft: {
    left: 16,
  },
  postDetailMediaNavButtonRight: {
    right: 16,
  },
  postDetailMediaCounter: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    zIndex: 4,
  },
  postDetailMediaCounterText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  postDetailMediaThumbStrip: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 4,
    paddingRight: 20,
  },
  postDetailMediaThumbButton: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  postDetailMediaThumbButtonActive: {
    borderColor: '#3B82F6',
  },
  postDetailMediaThumbImage: {
    width: '100%',
    height: '100%',
  },
  postDetailMediaFallback: {
    width: '100%',
    maxWidth: 760,
    minHeight: 300,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
  },
  postDetailMediaFallbackText: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '600',
  },
  postDetailRight: {
    width: 420,
    maxWidth: '42%',
    borderLeftWidth: 1,
  },
  postDetailHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postDetailBody: {
    flex: 1,
  },
  postDetailBodyContent: {
    padding: 14,
    gap: 12,
  },
  postDetailText: {
    fontSize: 15,
    lineHeight: 22,
  },
  welcomeNoticeWrap: {
    position: 'absolute',
    top: 86,
    left: 16,
    right: 16,
    alignItems: 'flex-start',
    zIndex: 1100,
    pointerEvents: 'box-none',
  },
  welcomeNotice: {
    width: 420,
    maxWidth: '96%',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  welcomeNoticeText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  welcomeNoticeClose: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  logoLetter: {
    fontSize: 38,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
  },
  welcome: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 360,
    marginBottom: 18,
  },
  feedCard: {
    width: '100%',
    maxWidth: 760,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  feedComposerCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  feedComposerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  feedComposerInputMock: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  feedComposerInputText: {
    fontSize: 20,
    fontWeight: '500',
  },
  feedComposerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedComposerActionButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePageCard: {
    width: '100%',
    maxWidth: 1220,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  profileCoverWrap: {
    width: '100%',
    height: 360,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  profileCoverImage: {
    width: '100%',
    height: '100%',
  },
  profileCoverFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCoverAction: {
    position: 'absolute',
    right: 16,
    // Positioned relative to the outer profile-header wrapper (cover +
    // identity row). 312 lands the pill at the bottom-right of the 360px
    // desktop cover. The narrow override in MyProfileScreen.tsx retargets
    // this to top:140 for the 180px mobile cover.
    top: 312,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  profileCoverActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  profileIdentityRow: {
    marginTop: -34,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 20,
    flexWrap: 'wrap',
  },
  profileIdentityRowCompact: {
    marginTop: -22,
    alignItems: 'flex-start',
  },
  profileIdentityLeft: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    minWidth: 320,
    flex: 1,
    // Allow the text column to truncate/wrap instead of overflowing into
    // the actions column on desktop. Without this, Text elements with
    // numberOfLines={1} compute their intrinsic full-line width and push
    // past their flex bounds, visually running under the action buttons.
    flexShrink: 1,
  },
  profileIdentityLeftCompact: {
    minWidth: 0,
    alignItems: 'center',
    width: '100%',
  },
  profileAvatarWrap: {
    width: 180,
    height: 180,
    borderRadius: 999,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarActionWrap: {
    position: 'relative',
    width: 180,
    height: 214,
    alignItems: 'center',
  },
  profileAvatarImage: {
    width: '100%',
    height: '100%',
  },
  profileAvatarEditAction: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    zIndex: 10,
    elevation: 10,
  },
  profileAvatarEditActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  profileAvatarLetter: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '800',
    lineHeight: 58,
  },
  profileIdentityMeta: {
    gap: 10,
    paddingBottom: 14,
    // Let the meta column shrink so <Text numberOfLines={1}> truncates
    // when the action buttons take space on the right, rather than
    // overflowing its flex bounds.
    minWidth: 0,
    flexShrink: 1,
    flex: 1,
  },
  profileDisplayNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  profileNameCountsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginLeft: 0,
    flexWrap: 'wrap',
  },
  profileDisplayName: {
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 38,
  },
  profileDisplayNameCompact: {
    fontSize: 26,
    lineHeight: 32,
    textAlign: 'center',
  },
  profileMetaText: {
    fontSize: 15,
    fontWeight: '600',
  },
  profileMetaCountText: {
    fontSize: 15,
    fontWeight: '700',
  },
  profileVerifiedBadge: {
    transform: [{ translateY: 2 }],
  },
  profileMetaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  profileIdentityActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 22,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  profileIdentityActionsCompact: {
    width: '100%',
    paddingBottom: 12,
    justifyContent: 'flex-start',
  },
  profilePrimaryBtn: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profilePrimaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  profileSecondaryBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileSecondaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  profileHandle: {
    fontSize: 16,
    fontWeight: '500',
  },
  profileCountLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  profileFollowButton: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileFollowButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  profileInfoCard: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  profileInfoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  profileInfoCardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  profileInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileInfoValue: {
    fontSize: 14,
    lineHeight: 20,
  },
  profilePageSection: {
    marginTop: 20,
    marginBottom: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  profilePageSectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  profileEditModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  profileEditModalCard: {
    width: 760,
    maxWidth: '96%',
    maxHeight: '90%',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  profileEditModalScroll: {
    maxHeight: 620,
  },
  profileEditModalScrollContent: {
    padding: 14,
    gap: 10,
  },
  profileEditOptionRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileEditOptionRowSelected: {
    borderWidth: 2,
  },
  profileEditOptionIcon: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditOptionTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  profileEditOptionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  profileEditOptionSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  profileEditDetailsGroup: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  profileEditMediaWrap: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 4,
  },
  profileEditCoverPreview: {
    width: '100%',
    height: 170,
    borderBottomWidth: 1,
    position: 'relative',
  },
  profileEditCoverImage: {
    width: '100%',
    height: '100%',
  },
  profileEditCoverFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditCoverActions: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileEditAvatarPreview: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    width: 108,
    height: 108,
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
  },
  profileEditAvatarImage: {
    width: '100%',
    height: '100%',
  },
  profileEditAvatarFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditAvatarFallbackLetter: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 38,
  },
  profileEditAvatarActions: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'column',
    gap: 6,
  },
  profileEditMediaAction: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditField: {
    gap: 6,
  },
  profileEditFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  profileEditInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    fontWeight: '600',
  },
  profileEditTextarea: {
    minHeight: 196,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  profileEditVisibilitySection: {
    marginTop: 2,
    gap: 10,
  },
  profileEditVisibilityHeading: {
    fontSize: 16,
    fontWeight: '800',
    paddingHorizontal: 2,
  },
  profileEditVisibilityCheckWrap: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditModalActions: {
    borderTopWidth: 1,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  profileEditModalButton: {
    minWidth: 120,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  profileEditModalButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  profileEditModalButtonTextPrimary: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  profileAvatarOptionsCard: {
    width: 420,
    maxWidth: '94%',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  profileAvatarOptionsTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 2,
  },
  profileAvatarOptionsAction: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileAvatarOptionsActionText: {
    fontSize: 15,
    fontWeight: '700',
  },
  profileAvatarOptionsCancel: {
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    marginTop: 2,
  },
  profileAvatarOptionsCancelText: {
    fontSize: 14,
    fontWeight: '700',
  },
  profileAvatarEditorCard: {
    width: 520,
    maxWidth: '95%',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  profileCoverEditorCard: {
    width: 820,
    maxWidth: '96%',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  profileCoverEditorPreview: {
    width: '94%',
    aspectRatio: 3,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  profileCoverEditorImage: {
    width: '100%',
    height: '100%',
  },
  profileAvatarEditorPreview: {
    width: 280,
    height: 280,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  profileAvatarEditorImage: {
    width: '100%',
    height: '100%',
  },
  profileAvatarEditorControls: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 8,
  },
  profileAvatarControlLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  profileAvatarControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  profileAvatarControlBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarControlValue: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 56,
    textAlign: 'center',
  },
  profileAvatarPositionPad: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  profileAvatarPositionMid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileAvatarSwitchRow: {
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  profileTabsRow: {
    marginTop: 12,
    borderTopWidth: 1,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  profileTabBtn: {
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  profileTabText: {
    fontSize: 16,
    fontWeight: '700',
  },
  profileBodyLayout: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    flexWrap: 'wrap',
  },
  profileBodyLayoutCompact: {
    flexDirection: 'column',
  },
  profileBodyLeft: {
    width: 430,
    flexShrink: 0,
    maxWidth: '100%',
  },
  profileBodyLeftCompact: {
    width: '100%',
  },
  profileBodyRight: {
    flex: 1,
    minWidth: 340,
    gap: 14,
  },
  profileBodyRightCompact: {
    minWidth: 0,
    width: '100%',
  },
  profileDetailCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  profileDetailTitle: {
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 12,
  },
  profileSectionTitleText: {
    marginBottom: 0,
  },
  profileSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  profileDetailList: {
    gap: 10,
  },
  profileDetailItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  profileDetailText: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  profileDetailTextWebWrap: {
    overflow: 'hidden',
    wordBreak: 'break-word',
  } as any,
  profileComposerCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  profileComposerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileComposerInputMock: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  profileComposerInputText: {
    fontSize: 16,
    fontWeight: '600',
  },
  profilePostsCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  profileActivityFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  profileActivityFilterChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  profileActivityFilterChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  profileCommentList: {
    gap: 10,
  },
  profileCommentCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  profileCommentText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  profileCommentMeta: {
    fontSize: 12,
    fontWeight: '600',
  },
  profileCommunitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  profileCommunityTile: {
    width: '30.5%',
    minWidth: 92,
    maxWidth: 140,
    alignItems: 'center',
    gap: 8,
  },
  profileCommunityAvatarWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCommunityAvatar: {
    width: '100%',
    height: '100%',
  },
  profileCommunityAvatarFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCommunityAvatarLetter: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
  },
  profileCommunityName: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  profileShowMoreJoinedBtn: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileShowMoreJoinedText: {
    fontSize: 14,
    fontWeight: '700',
  },
  feedTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  feedTab: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  feedTabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  feedLoading: {
    marginVertical: 16,
  },
  feedErrorText: {
    fontSize: 14,
    marginVertical: 10,
  },
  feedEmptyText: {
    fontSize: 14,
    marginVertical: 10,
  },
  feedList: {
    gap: 10,
  },
  feedPostCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  feedHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  feedHeaderMeta: {
    flex: 1,
  },
  feedAvatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  feedAvatarImage: {
    width: '100%',
    height: '100%',
  },
  feedAvatarLetter: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  followButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  followButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reportButton: {
    borderWidth: 1,
    borderRadius: 999,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postActionMenuWrap: {
    position: 'relative',
    zIndex: 1400,
    elevation: 1400,
  },
  postActionMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  postActionMenuModalCard: {
    width: 220,
    maxWidth: '92%',
    borderWidth: 1,
    borderRadius: 12,
    zIndex: 100,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
    overflow: 'hidden',
  },
  postActionMenuCard: {
    position: 'absolute',
    top: 36,
    right: 0,
    width: 240,
    minWidth: 240,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    zIndex: 1500,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1500,
    overflow: 'visible',
  },
  postActionMenuTiles: {
    width: '100%',
    alignItems: 'stretch',
    gap: 10,
  },
  postActionMenuItem: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postActionMenuItemText: {
    fontSize: 14,
    fontWeight: '700',
  },
  postActionMenuDivider: {
    height: 1,
    width: '100%',
  },
  feedPostHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    position: 'relative',
    zIndex: 1600,
    overflow: 'visible',
  },
  feedHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedCommunityHeaderLink: {
    fontSize: 13,
    fontWeight: '700',
  },
  feedAuthor: {
    fontSize: 14,
    fontWeight: '700',
  },
  feedDate: {
    fontSize: 12,
  },
  feedCommunity: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  feedText: {
    fontSize: 14,
    lineHeight: 20,
  },
  feedTextWrap: {
    marginBottom: 10,
  },
  longPostBlockList: {
    gap: 10,
  },
  longPostParagraph: {
    marginBottom: 4,
  },
  longPostHeading: {
    fontWeight: '800',
    letterSpacing: 0.2,
    marginTop: 2,
  },
  longPostHeadingH1: {
    fontSize: 26,
    lineHeight: 32,
    marginBottom: 4,
  },
  longPostHeadingH2: {
    fontSize: 22,
    lineHeight: 28,
    marginBottom: 3,
  },
  longPostHeadingH3: {
    fontSize: 18,
    lineHeight: 24,
    marginBottom: 2,
  },
  longPostQuoteWrap: {
    borderLeftWidth: 3,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 2,
  },
  longPostQuoteText: {
    fontSize: 15,
    lineHeight: 22,
    fontStyle: 'italic',
  },
  longPostImageWrap: {
    marginVertical: 4,
    overflow: 'hidden',
    borderRadius: 12,
  },
  longPostImage: {
    width: '100%',
    minHeight: 220,
    maxHeight: 460,
    borderRadius: 12,
  },
  longPostCaption: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  longPostEmbedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginVertical: 2,
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  longPostEmbedText: {
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 320,
  },
  shortPostVideoEmbedWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: 'hidden',
    marginVertical: 2,
  },
  shortPostLinkPreviewCard: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 86,
  },
  shortPostLinkPreviewImage: {
    width: 132,
    minWidth: 132,
    height: '100%',
  },
  shortPostLinkPreviewMeta: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  shortPostLinkPreviewSite: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  shortPostLinkPreviewTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    marginBottom: 5,
  },
  shortPostLinkPreviewDescription: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4,
  },
  shortPostLinkPreviewUrl: {
    fontSize: 12,
    fontWeight: '600',
  },
  postInlineEditWrap: {
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  postInlineEditInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 280,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
    fontSize: 14,
    lineHeight: 20,
  },
  postInlineEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  postEditModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  postEditModalCard: {
    width: 780,
    maxWidth: '96%',
    minHeight: 420,
    maxHeight: '86%',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  postEditModalBody: {
    fontSize: 15,
    lineHeight: 22,
  },
  postMetaRow: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  postLengthBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  postLengthBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  postPinnedBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  postPinnedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  seeMoreText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  feedMedia: {
    width: '100%',
    height: 360,
    borderRadius: 12,
    marginBottom: 10,
  },
  feedMediaGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  feedMediaGridItem: {
    width: '49.1%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  feedMediaGridImage: {
    width: '100%',
    height: '100%',
  },
  feedMediaGridMoreOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  feedMediaGridMoreText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  feedMediaFallback: {
    width: '100%',
    minHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  feedMediaFallbackText: {
    fontSize: 13,
  },
  feedStatsRow: {
    marginTop: 2,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reactionSummaryWrap: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detailPanelTabsRow: {
    marginTop: 10,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  },
  detailPanelTabButton: {
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailPanelTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reactionSummaryChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  reactionSummaryEmojiImage: {
    width: 14,
    height: 14,
  },
  reactionSummaryCount: {
    fontSize: 12,
    fontWeight: '700',
  },
  feedStatText: {
    fontSize: 12,
  },
  feedActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  feedActionButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 8,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  feedActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  linkChipWrap: {
    marginTop: 10,
    gap: 8,
  },
  linkChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  linkChipText: {
    fontSize: 12,
    flex: 1,
  },
  commentsBox: {
    marginTop: 10,
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 8,
  },
  commentThreadItem: {
    gap: 6,
  },
  commentBubble: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  commentBubbleText: {
    fontSize: 13,
    lineHeight: 19,
  },
  detailCommentItem: {
    gap: 6,
  },
  detailCommentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  detailCommentAvatar: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 2,
  },
  detailCommentAvatarImage: {
    width: '100%',
    height: '100%',
  },
  detailCommentAvatarLetter: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  detailCommentBubble: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 2,
  },
  detailCommentAuthor: {
    fontSize: 13,
    fontWeight: '800',
  },
  commentAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  commentTimeInline: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 0,
  },
  detailCommentText: {
    fontSize: 14,
    lineHeight: 20,
  },
  detailCommentMetaRow: {
    marginLeft: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  detailCommentMetaTime: {
    fontSize: 12,
  },
  detailCommentMetaAction: {
    fontSize: 12,
    fontWeight: '700',
  },
  commentReactionActionWrap: {
    position: 'relative',
    zIndex: 20,
  },
  commentReactionPickerPopover: {
    position: 'absolute',
    bottom: 22,
    left: -6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minWidth: 260,
    maxWidth: 340,
    maxHeight: 280,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 10,
  },
  commentReactionPickerScroll: {
    maxHeight: 260,
  },
  commentReactionPickerScrollContent: {
    gap: 8,
    paddingBottom: 2,
  },
  commentReactionPickerGroup: {
    gap: 5,
  },
  commentReactionPickerGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  commentReactionPickerEmojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  commentReactionPickerEmojiButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentReactionPickerEmojiImage: {
    width: 16,
    height: 16,
  },
  postReactionActionWrap: {
    position: 'relative',
    zIndex: 30,
    flex: 1,
  },
  postReactionPickerPopover: {
    position: 'absolute',
    bottom: 46,
    left: 0,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minWidth: 260,
    maxWidth: 360,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 10,
  },
  commentReplyLoadingSlot: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentReactionSummaryWrap: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  commentReactionBubbleRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commentReactionChipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  commentReactionChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  commentReactionEmojiImage: {
    width: 12,
    height: 12,
  },
  commentReactionCount: {
    fontSize: 11,
    fontWeight: '700',
  },
  commentReactionTotal: {
    fontSize: 11,
    fontWeight: '600',
  },
  commentRepliesWrap: {
    marginLeft: 42,
    gap: 8,
    paddingTop: 2,
  },
  commentReplyRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 4,
  },
  commentReplyMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  commentReplyAvatar: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 2,
  },
  commentReplyBubble: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  commentReplyComposer: {
    flexDirection: 'column',
    gap: 6,
  },
  commentReplyInput: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },
  commentReplySendButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  commentComposer: {
    flexDirection: 'column',
    gap: 6,
  },
  commentInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 16,
  },
  commentSendButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentSendText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  errorBox: {
    width: '100%',
    maxWidth: 560,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  errorText: {
    fontSize: 14,
  },
  linkedCard: {
    width: '100%',
    maxWidth: 560,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  linkedTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  settingsDrawerTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  linkedSubtitle: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
  },
  settingsModalCard: {
    width: 420,
    maxWidth: '92%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  settingsToggleRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingsToggleMeta: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  settingsToggleTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  settingsToggleSubtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  settingsTogglePill: {
    width: 52,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    padding: 2,
    justifyContent: 'center',
  },
  settingsToggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: '#ffffff',
  },
  settingsToggleKnobOn: {
    transform: [{ translateX: 24 }],
  },
  settingsToggleKnobOff: {
    transform: [{ translateX: 0 }],
  },
  providerList: {
    gap: 10,
  },
  providerRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  providerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  providerTextWrap: {
    flex: 1,
  },
  providerName: {
    fontSize: 14,
    fontWeight: '700',
  },
  providerStatus: {
    fontSize: 12,
    marginTop: 2,
  },
  providerButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  externalLinkModalCard: {
    width: '90%',
    maxWidth: 420,
    minWidth: 280,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  externalLinkModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  postComposerModalBackdrop: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingVertical: 8,
  },
  externalLinkModalTitle: {
    fontSize: 19,
    fontWeight: '800',
  },
  externalLinkModalBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  externalLinkModalUrl: {
    fontSize: 12,
  },
  externalLinkModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 2,
  },
  externalLinkCancelButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  externalLinkCancelButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  externalLinkContinueButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  externalLinkContinueButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },

  // ── Sidebar ──────────────────────────────────────────────────────────────────
  sidebarPanel: {
    flexShrink: 0,
  },
  sidebarContent: {
    padding: 8,
    gap: 8,
  },
  sidebarWidget: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  sidebarWidgetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sidebarWidgetTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  sidebarWidgetAction: {
    fontSize: 14,
    fontWeight: '600',
  },
  sidebarEmptyText: {
    fontSize: 14,
    lineHeight: 20,
    paddingBottom: 2,
  },
  newPostsBanner: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  newPostsBannerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  sidebarProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sidebarAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  sidebarAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  sidebarAvatarLetter: {
    fontWeight: '700',
    fontSize: 17,
  },
  sidebarProfileName: {
    fontSize: 16,
    fontWeight: '700',
  },
  sidebarProfileUsername: {
    fontSize: 14,
  },
  sidebarProfileStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 2,
  },
  sidebarStatNumber: {
    fontSize: 16,
    fontWeight: '700',
  },
  sidebarStatLabel: {
    fontSize: 13,
    marginTop: 1,
  },
  sidebarViewProfileBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
  },
  sidebarViewProfileBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  sidebarListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  sidebarListRowTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  sidebarListRowSub: {
    fontSize: 13,
    marginTop: 1,
  },
  sidebarCommunityAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  sidebarCommunityAvatarImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  sidebarCommunityAvatarLetter: {
    fontSize: 13,
    fontWeight: '700',
  },
  sidebarCircleDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  sidebarHashtagRow: {
    paddingVertical: 6,
    gap: 2,
  },
  sidebarHashtagName: {
    fontSize: 14,
    fontWeight: '700',
  },
  sidebarHashtagCount: {
    fontSize: 13,
  },
});
