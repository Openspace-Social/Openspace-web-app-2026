/**
 * PostComposerScreen — native composer for short and long posts.
 *
 * Opened from the bottom-tab `+` button. Mirrors the web composer in terms
 * of the API call (api.createPost) and the audience picker semantics
 * (community_names + circle_id), but skips Lexical entirely — the body is
 * a plain TextInput on native, sent as `text` for short posts and
 * `long_text` for long posts.
 *
 * Web is untouched: this screen is registered in the native AppNavigator
 * only and never imported from HomeScreen.
 */

import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Clipboard from 'expo-clipboard';
import { normalizeImageForUpload } from '../utils/normalizeImage';
import { validatePickedMedia, verifyUriExists } from '../utils/mediaValidation';
import {
  api,
  type CircleResult,
  type CreatePostPayload,
  type FeedPost,
  type FederatedLinkedAccount,
  type FederatedPublishResult,
  type SearchCommunityResult,
} from '../api/client';
import MentionHashtagInput from '../components/MentionHashtagInput';
import { MentionPopupOverlay } from '../components/MentionPopupProvider';
import LongPostLexicalEditor, {
  uploadDataUrlAsPostMedia,
  type LongPostLexicalEditorHandle,
} from '../components/LongPostLexicalEditor';
import { WebView as RNWebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildLongPostHtmlFromBlocks, escapeHtml as escapeLongPostHtml } from '../utils/longPostBlocks';
import {
  extractFirstUrlFromText,
  fetchShortPostLinkPreviewCached,
  getUrlHostLabel,
  type ShortPostLinkPreview,
} from '../utils/shortPostEmbeds';

const MAX_COMMUNITIES = 3;
const MAX_SHORT_LENGTH = 5000;
const MAX_LONG_LENGTH = 10_000;
const MAX_IMAGES = 5;
// Default Mastodon status limit. Most instances run the upstream default
// of 500 chars; some allow more. We don't currently fetch the linked
// instance's `max_status_chars`, so we gate optimistically at 500 — false
// positive (instance allows more) is benign; false negative would let the
// user submit and get a confusing remote 422 toast.
const MASTODON_DEFAULT_MAX_CHARS = 500;

type Mode = 'short' | 'long';

function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Props = {
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  /** When set, the composer enters quote/repost mode: the shared post is
   *  shown as a non-editable preview and `shared_post_uuid` is sent on
   *  submit. Long-post mode is disabled while reposting. */
  sharedPost?: FeedPost;
  onClose: () => void;
  onPosted: (post: FeedPost) => void;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
};

/**
 * Memoized short-mode composer input wrapper.
 *
 * Why this exists as a separate component:
 *
 * Web users reported the short-post TextInput felt laggy — typing fast left
 * a visible gap between keypress and characters appearing. Profile pointed at
 * the parent PostComposerScreen re-rendering on every keystroke (text is
 * controlled in parent state) and recreating the input's `style` array as a
 * new reference each time. RN-Web's TextInput sees the fresh style prop and
 * does work — re-applying styles, possibly re-attaching listeners — adding
 * tens of ms per keystroke on slower browsers.
 *
 * Extracting the input into a React.memo'd component with primitive-ish
 * props (`text`, `submitting`, `maxLength`, `token`, plus the stable
 * `onChangeText` setter from useState) lets React skip the wrapper's render
 * whenever those don't change. The style array is memoized INSIDE so it
 * gets a stable reference between renders, and the placeholder string is
 * also memoized so translation lookup doesn't recompute on every parent
 * re-render. The TextInput inside only re-renders when `text` actually
 * changes — which is unavoidable, but at least the surrounding work is
 * minimised.
 *
 * The component must still receive the theme `c` and styles `s` because
 * the parent owns them; both are stable references across renders (`s` is
 * useMemo'd in the parent, `c` is theme-context-stable until theme switch).
 */
const ShortComposerInput = React.memo(function ShortComposerInput(props: {
  text: string;
  onChangeText: (v: string) => void;
  token: string | null;
  sharedPost: any;
  submitting: boolean;
  maxLength: number;
  c: any;
  s: any;
  t: (key: string, opts?: any) => string;
}) {
  const { text, onChangeText, token, sharedPost, submitting, maxLength, c, s, t } = props;
  const inputStyle = useMemo(() => [s.input, {
    color: c.textPrimary,
    borderColor: c.inputBorder,
    backgroundColor: c.inputBackground,
    minHeight: 140,
  }], [s.input, c.textPrimary, c.inputBorder, c.inputBackground]);
  const placeholder = useMemo(
    () => (sharedPost
      ? t('home.repostComposerInputPlaceholder', { defaultValue: 'Add a comment… (optional)' })
      : t('home.composerShortPlaceholder', { defaultValue: "What's on your mind?" })),
    [sharedPost, t],
  );
  return (
    <MentionHashtagInput
      value={text}
      onChangeText={onChangeText}
      token={token || undefined}
      placeholder={placeholder}
      placeholderTextColor={c.textMuted}
      multiline
      numberOfLines={5}
      editable={!submitting}
      maxLength={maxLength}
      c={c}
      style={inputStyle}
    />
  );
});

export default function PostComposerScreen({ token, c, t, sharedPost, onClose, onPosted, onNotice, onError }: Props) {
  const s = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('short');
  const [text, setText] = useState('');
  // Long-post rich text — the embedded Lexical editor produces HTML; we
  // store the title inline as an `<h1>` (the editor handles it natively).
  const [longHtml, setLongHtml] = useState<string>('');
  // Long-post title — stored separately from the editor body to mirror the
  // web composer. Prepended as an `<h1>` heading block at save/publish time.
  const [longTitle, setLongTitle] = useState<string>('');
  // Structured blocks parsed by the editor on every change. Sent alongside
  // the HTML so the backend keeps tables / iframes / link-embed metadata
  // (the HTML sanitizer strips those from `long_text_rendered_html`).
  const [longBlocks, setLongBlocks] = useState<unknown[]>([]);
  // Inline images are uploaded as the user inserts them. We lazily create
  // a draft post so addPostMedia has a uuid to attach to; the same draft
  // is finalized on publish.
  const [longDraftUuid, setLongDraftUuid] = useState<string | null>(null);
  const longDraftUuidRef = useRef<string | null>(null);
  longDraftUuidRef.current = longDraftUuid;
  const longMediaOrderRef = useRef(0);
  const editorRef = useRef<LongPostLexicalEditorHandle | null>(null);
  // Long-post extras: full-screen mode, draft autosave + expiry, preview.
  const [fullscreen, setFullscreen] = useState(false);
  const [draftExpiryDays, setDraftExpiryDays] = useState<number | null>(14);
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [previewOpen, setPreviewOpen] = useState(false);
  // Long-post "Next" flow: tapping Next in the header swaps the composer
  // for a fullscreen Audience picker that owns the final Post action.
  // Short posts keep their inline audience row.
  const [longAudienceOpen, setLongAudienceOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsList, setDraftsList] = useState<FeedPost[]>([]);

  const openDrafts = useCallback(async () => {
    if (!token) return;
    setDraftsOpen(true);
    setDraftsLoading(true);
    try {
      const list = await api.getDraftPosts(token, 20);
      const long = (Array.isArray(list) ? list : []).filter((p) => (p as any)?.type === 'LP');
      setDraftsList(long);
    } catch (e: any) {
      onError(e?.message || t('home.composerLongDraftsLoadError', { defaultValue: 'Could not load drafts.' }));
    } finally {
      setDraftsLoading(false);
    }
  }, [token, onError, t]);

  const loadDraft = useCallback((draft: FeedPost) => {
    const uuid = (draft as any)?.uuid as string | undefined;
    if (!uuid) return;
    // Prefer rebuilding from `long_text_blocks` when present — the
    // backend sanitizer drops <table> / <iframe> / data-* from
    // `long_text_rendered_html`, so the blocks copy is the only path
    // that round-trips tables, video embeds, and link-embed cards.
    const rawBlocks = (draft as any)?.long_text_blocks;
    const blocksArr: any[] | undefined = Array.isArray(rawBlocks) ? rawBlocks : undefined;
    // If the first block is a level-1 heading, treat it as the post title
    // (matches the web composer's `splitLongPostTitleFromBlocks`).
    let title = '';
    let bodyBlocks: any[] | undefined = blocksArr;
    if (blocksArr && blocksArr.length > 0) {
      const first = blocksArr[0];
      if (first?.type === 'heading' && (first.level || 2) === 1 && (first.text || '').trim()) {
        title = (first.text || '').trim();
        bodyBlocks = blocksArr.slice(1);
      }
    }
    let html: string;
    if (bodyBlocks && bodyBlocks.length > 0) {
      html = buildLongPostHtmlFromBlocks(bodyBlocks);
    } else if (!title) {
      html = (draft as any)?.long_text_rendered_html || '<p></p>';
    } else {
      html = '<p></p>';
    }
    longDraftUuidRef.current = uuid;
    setLongDraftUuid(uuid);
    setLongTitle(title);
    setLongHtml(html);
    setLongBlocks(bodyBlocks || []);
    editorRef.current?.setHtml(html);
    setDraftsOpen(false);
  }, []);

  const deleteDraft = useCallback(async (draft: FeedPost) => {
    const uuid = (draft as any)?.uuid as string | undefined;
    if (!token || !uuid) return;
    try {
      await api.deletePost(token, uuid);
      setDraftsList((prev) => prev.filter((d) => (d as any)?.uuid !== uuid));
      // If we just deleted the draft we're currently editing, drop the
      // composer's stale draft uuid so a fresh save creates a new one.
      if (longDraftUuidRef.current === uuid) {
        longDraftUuidRef.current = null;
        setLongDraftUuid(null);
      }
    } catch (e: any) {
      onError(e?.message || t('home.composerLongDraftDeleteError', { defaultValue: 'Could not delete draft.' }));
    }
  }, [token, onError, t]);
  const [imageUris, setImageUris] = useState<string[]>([]);
  // Mutually exclusive with imageUris by business rule: either ≤5 photos
  // or 1 video, never both. Picking a video clears any selected images,
  // and picking images clears any selected video.
  const [composerVideo, setComposerVideo] = useState<{
    uri: string;
    name: string;
    mimeType: string;
  } | null>(null);
  // Inline error banner — global toasts are hidden behind native Modals
  // (the toast layer renders below the Modal's native window), so we
  // surface errors inside the composer too.
  const [inlineError, setInlineError] = useState('');

  // Link preview state — auto-detect URLs in the body and fetch metadata
  // (title / description / image / site / video flag) the same way web's
  // composer does. Users can dismiss a preview, and the dismissed URL
  // stays hidden until they edit the link.
  const [linkPreview, setLinkPreview] = useState<ShortPostLinkPreview | null>(null);
  const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);
  const [dismissedPreviewUrl, setDismissedPreviewUrl] = useState<string | null>(null);
  const linkPreviewSeqRef = useRef(0);
  // Per-image clockwise rotation in degrees (0 / 90 / 180 / 270). Mirrors
  // web's composer where users can re-orient an image before posting; the
  // rotation is applied with expo-image-manipulator on submit so the final
  // file uploads in the correct orientation.
  const [rotations, setRotations] = useState<Record<string, 0 | 90 | 180 | 270>>({});
  const [submitting, setSubmitting] = useState(false);

  const [communities, setCommunities] = useState<SearchCommunityResult[]>([]);
  const [pinnedCommunities, setPinnedCommunities] = useState<SearchCommunityResult[]>([]);
  const [circles, setCircles] = useState<CircleResult[]>([]);
  const [selectedCommunities, setSelectedCommunities] = useState<Set<string>>(new Set());
  // Circle selection is single-choice — `null` represents the Public option
  // (no circle), matching web's `composerSelectedCircleId === null` model.
  const [selectedCircleId, setSelectedCircleId] = useState<number | null>(null);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [federatedLinkedAccounts, setFederatedLinkedAccounts] = useState<FederatedLinkedAccount[]>([]);
  const [publishDestination, setPublishDestination] = useState<'openbook' | 'mastodon' | 'both'>('openbook');
  const [selectedFederatedAccountId, setSelectedFederatedAccountId] = useState<number | null>(null);

  // Defer the link-preview effect off the typing-hot path. The previous
  // version ran `extractFirstUrlFromText` (regex scan) + at least one
  // setState on EVERY keystroke — even when typing plain text with no URL
  // in sight. React would have to commit those state updates before it
  // could re-paint the textarea, which on web showed up as visible typing
  // lag during fast input.
  //
  // useDeferredValue gives the link-preview pipeline a "stale-but-cheap"
  // copy of text. React keeps the textarea snappy by updating `text`
  // immediately for the input, while `deferredText` lags behind during
  // fast bursts and catches up when the typing pause makes a render slot
  // available. The 320 ms setTimeout further coalesces fast catch-ups,
  // and our existing seq-counter ensures only the latest in-flight fetch
  // is ever applied to state.
  const deferredText = useDeferredValue(text);
  useEffect(() => {
    const url = extractFirstUrlFromText(deferredText);
    if (!url) {
      // Same primitive-guard pattern as the suggestion-popup clear path:
      // skip the setState calls when state is already in the desired
      // shape, so deferred-value catch-ups don't generate empty no-op
      // renders.
      if (linkPreview !== null) setLinkPreview(null);
      if (linkPreviewLoading) setLinkPreviewLoading(false);
      return;
    }
    if (dismissedPreviewUrl && url === dismissedPreviewUrl) {
      if (linkPreview !== null) setLinkPreview(null);
      if (linkPreviewLoading) setLinkPreviewLoading(false);
      return;
    }
    if (linkPreview && linkPreview.url === url) return; // already loaded
    const seq = ++linkPreviewSeqRef.current;
    setLinkPreviewLoading(true);
    const handle = setTimeout(() => {
      void fetchShortPostLinkPreviewCached(url)
        .then((preview) => {
          if (linkPreviewSeqRef.current !== seq) return;
          setLinkPreview(preview);
        })
        .catch(() => {
          if (linkPreviewSeqRef.current !== seq) return;
          setLinkPreview(null);
        })
        .finally(() => {
          if (linkPreviewSeqRef.current === seq) setLinkPreviewLoading(false);
        });
    }, 320);
    return () => clearTimeout(handle);
  }, [deferredText, dismissedPreviewUrl, linkPreview, linkPreviewLoading]);

  // Pre-load joined + pinned communities + circles so the audience
  // sheet has something to show as soon as the user taps it.
  // Joined communities are paginated server-side at a max of 20 per
  // call, so we walk pages until we hit a short page (< 20 items) or
  // a hard cap. Mirrors the web composer at HomeScreen.tsx:5202.
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try {
        const [firstJoinedRes, pinnedRes, circlesRes, federatedAccountsRes] = await Promise.allSettled([
          api.getJoinedCommunities(token, 20, 0),
          api.getPinnedCommunities(token),
          api.getCircles(token),
          api.getFederatedLinkedAccounts(token),
        ]);
        if (!active) return;
        if (pinnedRes.status === 'fulfilled') {
          setPinnedCommunities(Array.isArray(pinnedRes.value) ? pinnedRes.value : []);
        }
        if (circlesRes.status === 'fulfilled') {
          setCircles(Array.isArray(circlesRes.value) ? circlesRes.value : []);
        }
        if (federatedAccountsRes.status === 'fulfilled') {
          const nextAccounts = Array.isArray(federatedAccountsRes.value) ? federatedAccountsRes.value : [];
          setFederatedLinkedAccounts(nextAccounts);
          setSelectedFederatedAccountId((current) => current ?? nextAccounts[0]?.id ?? null);
        }
        if (firstJoinedRes.status !== 'fulfilled') return;
        const all: SearchCommunityResult[] = Array.isArray(firstJoinedRes.value)
          ? [...firstJoinedRes.value]
          : [];
        // Show the first page immediately so the picker isn't empty
        // while the rest of the pages stream in.
        setCommunities(all);
        // Hard cap as a safety net for runaway membership counts. 25
        // pages × 20 = 500 communities, plenty for any real account.
        const PAGE_SIZE = 20;
        const MAX_PAGES = 25;
        let offset = all.length;
        let pages = 1;
        while (
          active
          && all.length > 0
          && all.length % PAGE_SIZE === 0
          && pages < MAX_PAGES
        ) {
          let nextPage: SearchCommunityResult[];
          try {
            nextPage = await api.getJoinedCommunities(token, PAGE_SIZE, offset);
          } catch {
            break;
          }
          if (!active) return;
          if (!Array.isArray(nextPage) || nextPage.length === 0) break;
          all.push(...nextPage);
          offset += nextPage.length;
          pages += 1;
          // Push each page into state as it arrives so the user sees
          // the list grow rather than waiting for everything at once.
          setCommunities([...all]);
          if (nextPage.length < PAGE_SIZE) break;
        }
      } catch {
        // non-fatal; audience sheet just shows empty states
      }
    })();
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (federatedLinkedAccounts.length === 0) {
      setSelectedFederatedAccountId(null);
      if (publishDestination !== 'openbook') {
        setPublishDestination('openbook');
      }
      return;
    }
    if (
      selectedFederatedAccountId == null
      || !federatedLinkedAccounts.some((account) => account.id === selectedFederatedAccountId)
    ) {
      setSelectedFederatedAccountId(federatedLinkedAccounts[0]?.id ?? null);
    }
  }, [federatedLinkedAccounts, selectedFederatedAccountId, publishDestination]);

  const maxLength = mode === 'long' ? MAX_LONG_LENGTH : MAX_SHORT_LENGTH;
  const longPlain = useMemo(() => htmlToPlainText(longHtml), [longHtml]);
  // Count distinct `<img>` tags in the long-post HTML so the counter
  // matches the published post (web uses the same approach).
  const longImageCount = useMemo(() => {
    if (!longHtml) return 0;
    const matches = longHtml.match(/<img\b[^>]*>/gi);
    return matches ? matches.length : 0;
  }, [longHtml]);
  const LONG_POST_MAX_IMAGES = 5;
  const longCharsRemaining = MAX_LONG_LENGTH - longPlain.length;
  const longCharsOver = longCharsRemaining < 0;
  const longCharsLow = !longCharsOver && longCharsRemaining <= 500;
  const canPost = !submitting && (
    sharedPost
      // Reposts are valid even without a comment.
      ? true
      : mode === 'long'
        ? longPlain.length > 0
        : (text.trim().length > 0 || imageUris.length > 0 || composerVideo != null)
  );
  const remaining = maxLength - text.length;
  const overLimit = mode === 'long' ? false : remaining < 0;
  // Effective length the Mastodon instance will see — long posts ship as
  // plain text, short posts ship as the typed text.
  const mastodonEffectiveLength = mode === 'long' ? longPlain.length : text.length;
  const mastodonGateActive = publishDestination !== 'openbook';
  const mastodonRemaining = MASTODON_DEFAULT_MAX_CHARS - mastodonEffectiveLength;
  const mastodonOverLimit = mastodonGateActive && mastodonRemaining < 0;
  const mastodonBlocked = mastodonOverLimit;
  const remainingImageSlots = Math.max(0, MAX_IMAGES - imageUris.length);

  // Lexical editor calls back to RN whenever the user inserts an image.
  // We lazy-create a draft post the first time so api.addPostMedia has a
  // UUID to attach to, then return the public URL the editor swaps in.
  const onLongPostUploadImage = useCallback(async (dataUrl: string, filename: string): Promise<string> => {
    if (!token) throw new Error('No auth token');
    let draftUuid = longDraftUuidRef.current;
    if (!draftUuid) {
      const draft = await api.createPost(token, {
        type: 'LP',
        is_draft: true,
        long_text: ' ',
        long_text_rendered_html: '<p></p>',
        long_text_version: 2,
        text: ' ',
      });
      draftUuid = (draft as any)?.uuid as string | null;
      if (!draftUuid) throw new Error('Draft uuid missing');
      longDraftUuidRef.current = draftUuid;
      setLongDraftUuid(draftUuid);
    }
    const order = longMediaOrderRef.current++;
    return await uploadDataUrlAsPostMedia(token, draftUuid, dataUrl, filename, order);
  }, [token]);

  // ── Long-post draft save (manual + autosave) ─────────────────────────────
  const saveLongDraft = useCallback(async (silent: boolean): Promise<string | null> => {
    if (!token) return null;
    const trimmedTitle = longTitle.trim();
    const bodyHtml = longHtml || '';
    const fullHtml = trimmedTitle
      ? `<h1>${escapeLongPostHtml(trimmedTitle)}</h1>${bodyHtml}`
      : bodyHtml;
    const plain = trimmedTitle ? `${trimmedTitle}\n\n${longPlain}` : longPlain;
    if (!fullHtml.trim() && !plain.trim()) return null;
    const previewText = (plain.slice(0, 280) || ' ').trim() || ' ';
    if (!silent) setSavingDraft(true);
    setAutosaveStatus('saving');
    try {
      let uuid = longDraftUuidRef.current;
      const titleBlock = trimmedTitle
        ? [{ id: `title-${Date.now()}`, type: 'heading', level: 1, text: trimmedTitle, position: 0 }]
        : [];
      const blocksWithTitle = [...titleBlock, ...longBlocks] as unknown[];
      const blocksPayload = blocksWithTitle.length > 0 ? blocksWithTitle : undefined;
      if (!uuid) {
        const created = await api.createPost(token, {
          type: 'LP',
          is_draft: true,
          long_text: plain,
          long_text_blocks: blocksPayload,
          long_text_rendered_html: fullHtml,
          long_text_version: 2,
          text: previewText,
          ...(draftExpiryDays != null ? { draft_expiry_days: draftExpiryDays } : {}),
        });
        uuid = (created as any)?.uuid as string | null;
        if (uuid) {
          longDraftUuidRef.current = uuid;
          setLongDraftUuid(uuid);
        }
      } else {
        await api.updatePostContent(token, uuid, {
          type: 'LP',
          is_draft: true,
          long_text: plain,
          long_text_blocks: blocksPayload,
          long_text_rendered_html: fullHtml,
          long_text_version: 2,
          ...(draftExpiryDays != null ? { draft_expiry_days: draftExpiryDays } : {}),
        });
        if (selectedCircleId != null || selectedCommunities.size > 0) {
          await api.updatePostTargets(token, uuid, {
            circle_id: selectedCircleId != null ? [selectedCircleId] : [],
            community_names: Array.from(selectedCommunities).slice(0, MAX_COMMUNITIES),
          });
        }
      }
      setAutosaveStatus('saved');
      if (!silent) {
        onNotice(t('home.composerLongDraftSaved', { defaultValue: 'Draft saved.' }));
      }
      return uuid;
    } catch (e: any) {
      setAutosaveStatus('idle');
      if (!silent) onError(e?.message || t('home.composerLongDraftError', { defaultValue: 'Could not save draft.' }));
      return null;
    } finally {
      if (!silent) setSavingDraft(false);
    }
  }, [token, longHtml, longPlain, longBlocks, longTitle, draftExpiryDays, selectedCircleId, selectedCommunities, onNotice, onError, t]);

  // Auto-save every 20s of editing inactivity in long mode.
  useEffect(() => {
    if (mode !== 'long') return;
    if (!longHtml.trim() && !longPlain.trim()) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void saveLongDraft(true);
    }, 20_000);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [mode, longHtml, longPlain, saveLongDraft]);

  const pickMedia = useCallback(async () => {
    if (submitting) return;
    // If a video is already attached, the user has to remove it first
    // before adding more media (business rule: video is exclusive).
    if (composerVideo) {
      onError(t('home.composerVideoExclusive', {
        defaultValue: 'Remove the video first to add photos.',
      }));
      return;
    }
    if (remainingImageSlots <= 0) {
      onError(t('home.composerMaxImagesReached', {
        count: MAX_IMAGES,
        defaultValue: `You can attach up to ${MAX_IMAGES} images.`,
      }));
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        onError(t('home.profileImagePickerPermissionDenied', { defaultValue: 'Photo access is needed to attach media.' }));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: remainingImageSlots,
        allowsEditing: false,
        quality: 0.9,
      });
      if (result.canceled) return;
      const assets = result.assets || [];
      // If the user picked a video — even mixed with images — take the
      // first video and discard everything else. Matches IG/Twitter where
      // video selection is single and replaces any photo selection.
      const videoAsset = assets.find((a) => a?.type === 'video');
      if (videoAsset?.uri) {
        const videoCheck = validatePickedMedia({
          kind: 'video',
          size: (videoAsset as any).fileSize,
          durationMs: (videoAsset as any).duration,
        });
        if (!videoCheck.ok) {
          // Also pin the message to the composer's inline error banner —
          // the fullScreenModal presents in its own iOS UIWindow, so a
          // toast from the parent AppToastProvider renders *behind* the
          // modal and the user never sees it.
          setInlineError(videoCheck.reason);
          onError(videoCheck.reason);
          return;
        }
        const fallbackName = (() => {
          const segments = videoAsset.uri.split('/');
          return segments[segments.length - 1] || 'post-video.mp4';
        })();
        const name = videoAsset.fileName || fallbackName;
        const mimeType = videoAsset.mimeType || 'video/mp4';
        setComposerVideo({ uri: videoAsset.uri, name, mimeType });
        setImageUris([]);
        setRotations({});
        // Clear any stale rejection banner from a previous pick attempt.
        setInlineError('');
        if (assets.some((a) => a?.type === 'image')) {
          // Tell the user we dropped their photos so they're not surprised.
          onNotice(t('home.composerVideoReplacedImages', {
            defaultValue: 'Video selected — photos were removed.',
          }));
        }
        return;
      }
      // Validate each picked image against the size cap; collect the
      // first rejection (if any) so the user sees a specific reason
      // instead of a silent "nothing happened".
      const imageAssets = assets.filter((a) => a?.type !== 'video');
      const newUris: string[] = [];
      let imageRejection: string | null = null;
      for (const asset of imageAssets) {
        if (!asset?.uri) continue;
        const check = validatePickedMedia({
          kind: 'image',
          size: (asset as any).fileSize,
        });
        if (!check.ok) { imageRejection = check.reason; continue; }
        newUris.push(asset.uri);
      }
      if (imageRejection) {
        setInlineError(imageRejection);
        onError(imageRejection);
      }
      if (newUris.length === 0) return;
      setImageUris((prev) => {
        const merged = [...prev, ...newUris];
        // Hard-cap in case selectionLimit isn't honoured by the platform.
        return merged.slice(0, MAX_IMAGES);
      });
      // Clear any stale rejection banner from a previous pick — but
      // ONLY if every image in this batch passed. If some were rejected
      // we want the rejection reason to stay visible.
      if (!imageRejection) setInlineError('');
    } catch {
      onError(t('home.profileImagePickerFailed', { defaultValue: 'Could not open the photo library.' }));
    }
  }, [submitting, composerVideo, remainingImageSlots, onError, onNotice, t]);

  const pasteMedia = useCallback(async () => {
    if (submitting) return;
    if (composerVideo) {
      onError(t('home.composerVideoExclusive', {
        defaultValue: 'Remove the video first to add photos.',
      }));
      return;
    }
    if (remainingImageSlots <= 0) {
      onError(t('home.composerMaxImagesReached', {
        count: MAX_IMAGES,
        defaultValue: `You can attach up to ${MAX_IMAGES} images.`,
      }));
      return;
    }
    try {
      const hasImage = await Clipboard.hasImageAsync();
      if (!hasImage) {
        onNotice(t('home.composerPasteNoImage', {
          defaultValue: 'No image found in clipboard. Copy an image first.',
        }));
        return;
      }
      const result = await Clipboard.getImageAsync({ format: 'jpeg' });
      if (!result?.data) return;
      // Clipboard image is a data URL; expo-image-manipulator accepts it and
      // outputs a file:// URI on disk, which is what FormData uploads need.
      const normalized = await normalizeImageForUpload(result.data);
      setImageUris((prev) => {
        if (prev.length >= MAX_IMAGES) return prev;
        return [...prev, normalized];
      });
    } catch (e: any) {
      onError(e?.message || t('home.composerPasteFailed', {
        defaultValue: 'Could not paste image from clipboard.',
      }));
    }
  }, [submitting, composerVideo, remainingImageSlots, onError, onNotice, t]);

  const removeVideo = useCallback(() => {
    setComposerVideo(null);
  }, []);

  const removeImage = useCallback((uri: string) => {
    setImageUris((prev) => prev.filter((u) => u !== uri));
    setRotations((prev) => {
      if (!(uri in prev)) return prev;
      const next = { ...prev };
      delete next[uri];
      return next;
    });
  }, []);

  const rotateImage = useCallback((uri: string) => {
    setRotations((prev) => {
      const current = prev[uri] || 0;
      const next = ((current + 90) % 360) as 0 | 90 | 180 | 270;
      return { ...prev, [uri]: next };
    });
  }, []);

  const submit = useCallback(async () => {
    if (!canPost || overLimit || mastodonBlocked) return;
    if (publishDestination !== 'mastodon' && circles.length === 0 && communities.length === 0) {
      const msg = t('home.postComposerDestinationEmpty', {
        defaultValue: 'You need at least one circle or joined community before publishing.',
      });
      setInlineError(msg);
      onError(msg);
      return;
    }
    if (publishDestination !== 'openbook' && !selectedFederatedAccountId) {
      const msg = t('home.postComposerMastodonAccountRequired', {
        defaultValue: 'Choose a linked Mastodon account before publishing there.',
      });
      setInlineError(msg);
      onError(msg);
      return;
    }
    // Verify every picked URI is still readable. iOS PHPhotoPicker URIs
    // can be invalidated by the OS between pick and submit — when that
    // happens, RN's FormData silently sends a request without the file
    // part, the server creates a text-only post, and the user thinks
    // their image uploaded. Catch it here with a clear error instead.
    for (const uri of imageUris) {
      const err = await verifyUriExists(uri);
      if (err) {
        setInlineError(err);
        onError(err);
        return;
      }
    }
    if (composerVideo?.uri) {
      const err = await verifyUriExists(composerVideo.uri);
      if (err) {
        setInlineError(err);
        onError(err);
        return;
      }
    }
    setInlineError('');
    setSubmitting(true);
    try {
      const trimmed = text.trim();
      const basePayload: CreatePostPayload = {};
      if (selectedCircleId != null) {
        basePayload.circle_id = [selectedCircleId];
      }
      if (selectedCommunities.size > 0) {
        basePayload.community_names = Array.from(selectedCommunities).slice(0, MAX_COMMUNITIES);
      }
      if (sharedPost?.uuid) {
        basePayload.shared_post_uuid = sharedPost.uuid;
      }

      // Bake any user-chosen rotation AND normalize to JPEG. Even when
      // there's no rotation, we still re-encode so HEIC/HEIF originals
      // (iOS Photos default since iPhone 7) ship as JPEG the backend
      // can decode without `pillow-heif`.
      const rotateIfNeeded = async (uri: string): Promise<string> => {
        const deg = rotations[uri] || 0;
        return normalizeImageForUpload(uri, { rotate: deg as 0 | 90 | 180 | 270 });
      };

      let finalized: FeedPost | FederatedPublishResult | null = null;
      if (mode === 'long') {
        // Lexical produces the body HTML; the title is stored separately
        // (mirroring the web composer) and prepended as an `<h1>` heading
        // block at submit time so the published post renders identically.
        const trimmedTitle = longTitle.trim();
        const bodyHtml = longHtml || '';
        const fullHtml = trimmedTitle
          ? `<h1>${escapeLongPostHtml(trimmedTitle)}</h1>${bodyHtml}`
          : bodyHtml;
        const plain = trimmedTitle ? `${trimmedTitle}\n\n${longPlain}` : longPlain;
        const previewText = (plain.slice(0, 280) || ' ').trim() || ' ';

        const titleBlock = trimmedTitle
          ? [{ id: `title-${Date.now()}`, type: 'heading', level: 1, text: trimmedTitle, position: 0 }]
          : [];
        const blocksWithTitle = [...titleBlock, ...longBlocks] as unknown[];
        const blocksPayload = blocksWithTitle.length > 0 ? blocksWithTitle : undefined;
        if (longDraftUuid) {
          // Inline images already attached to a draft — finalize it.
          await api.updatePostContent(token, longDraftUuid, {
            type: 'LP',
            long_text: plain,
            long_text_blocks: blocksPayload,
            long_text_rendered_html: fullHtml,
            long_text_version: 2,
          });
          if (selectedCircleId != null || selectedCommunities.size > 0) {
            await api.updatePostTargets(token, longDraftUuid, {
              circle_id: selectedCircleId != null ? [selectedCircleId] : [],
              community_names: Array.from(selectedCommunities).slice(0, MAX_COMMUNITIES),
            });
          }
          finalized = publishDestination === 'openbook'
            ? await api.publishPost(token, longDraftUuid)
            : await api.publishPostWithFederation(token, longDraftUuid, {
                publish_destination: publishDestination,
                federated_linked_account_id: selectedFederatedAccountId || undefined,
              });
        } else {
          const payload = {
            ...basePayload,
            type: 'LP',
            long_text: plain,
            long_text_blocks: blocksPayload,
            long_text_rendered_html: fullHtml,
            // version 2 matches what web's Lexical editor sends (HTML-first
            // rather than block-first authoring).
            long_text_version: 2,
            // Backend still likes a non-empty `text` preview.
            text: previewText,
            publish_destination: publishDestination,
            federated_linked_account_id: selectedFederatedAccountId || undefined,
          };
          finalized = publishDestination === 'openbook'
            ? await api.createPost(token, payload)
            : await api.createPostWithFederation(token, payload);
        }
      } else if (composerVideo) {
        // Video upload — single-call createPost with the `video` payload
        // field. Backend normalizes the filename extension (e.g. .mpg4 →
        // .mp4) on its side, so we just forward the picker's metadata.
        basePayload.text = trimmed;
        basePayload.video = {
          uri: composerVideo.uri,
          type: composerVideo.mimeType,
          name: composerVideo.name,
        } as any;
        basePayload.publish_destination = publishDestination;
        basePayload.federated_linked_account_id = selectedFederatedAccountId || undefined;
        finalized = publishDestination === 'openbook'
          ? await api.createPost(token, basePayload)
          : await api.createPostWithFederation(token, basePayload);
      } else if (imageUris.length <= 1) {
        // Fast path — single (or no) image: createPost handles it directly.
        const single = imageUris[0];
        if (single) {
          const finalUri = await rotateIfNeeded(single);
          basePayload.image = { uri: finalUri, type: 'image/jpeg', name: 'post-image.jpg' } as any;
        }
        basePayload.text = trimmed;
        basePayload.publish_destination = publishDestination;
        basePayload.federated_linked_account_id = selectedFederatedAccountId || undefined;
        finalized = publishDestination === 'openbook'
          ? await api.createPost(token, basePayload)
          : await api.createPostWithFederation(token, basePayload);
      } else {
        // Multi-image short post — create as draft, attach each image, publish.
        const draft = await api.createPost(token, { ...basePayload, text: trimmed, is_draft: true });
        const draftUuid = (draft as any)?.uuid as string | undefined;
        if (!draftUuid) throw new Error('Draft post has no uuid');
        // If any image attach (or the publish) fails we own the orphan
        // draft. Roll it back so the user retries from a clean state
        // instead of accumulating invisible drafts that only the daily
        // flush job (~24h) cleans up.
        try {
          for (let i = 0; i < imageUris.length; i += 1) {
            const uri = imageUris[i];
            const finalUri = await rotateIfNeeded(uri);
            await api.addPostMedia(token, draftUuid, {
              file: { uri: finalUri, type: 'image/jpeg', name: `post-image-${i + 1}.jpg` } as any,
              order: i,
            });
          }
          finalized = publishDestination === 'openbook'
            ? await api.publishPost(token, draftUuid)
            : await api.publishPostWithFederation(token, draftUuid, {
                publish_destination: publishDestination,
                federated_linked_account_id: selectedFederatedAccountId || undefined,
              });
        } catch (uploadErr) {
          try {
            await api.deletePost(token, draftUuid);
          } catch (cleanupErr) {
            console.warn('[ComposerPublish] Orphan draft cleanup failed', cleanupErr);
          }
          throw uploadErr;
        }
      }

      const localPost = finalized && 'publish_destination' in (finalized as any)
        ? (finalized as FederatedPublishResult).local_post
        : finalized as FeedPost | null;
      const federatedResult = finalized && 'publish_destination' in (finalized as any)
        ? finalized as FederatedPublishResult
        : null;
      const crosspostStillPublishing = federatedResult?.publish_destination === 'both'
        && !!localPost?.uuid
        && String(federatedResult.mastodon_publish_status || localPost?.mastodon_publish_status || '').toUpperCase() === 'PE';

      onNotice(
        publishDestination === 'mastodon'
          ? t('home.postComposerMastodonSuccess', { defaultValue: 'Posted to Mastodon.' })
          : crosspostStillPublishing
            ? t('home.postComposerCrossPostPending', { defaultValue: 'Posted to Openspace. Mastodon cross-post is still publishing.' })
          : publishDestination === 'both'
            ? t('home.postComposerCrossPostSuccess', { defaultValue: 'Posted to Openspace and Mastodon.' })
            : t('home.composerPostedNotice', { defaultValue: 'Posted!' })
      );
      if (localPost) {
        onPosted(localPost);
        if (crosspostStillPublishing && token && localPost.uuid) {
          void api.waitForMastodonPublishResolution(token, localPost.uuid).then((resolvedPost) => {
            const statusValue = String(resolvedPost.mastodon_publish_status || '').toUpperCase();
            if (statusValue === 'PB') {
              onNotice(t('home.postComposerCrossPostSuccess', { defaultValue: 'Posted to Openspace and Mastodon.' }));
            } else if (statusValue === 'FA') {
              onError(
                resolvedPost.mastodon_publish_error
                || t('home.postComposerCrossPostFailed', {
                  defaultValue: 'Posted to Openspace, but the Mastodon cross-post failed.',
                })
              );
            }
          }).catch(() => {
            onError(t('home.postComposerCrossPostUnknown', {
              defaultValue: 'Posted to Openspace, but we could not confirm the Mastodon cross-post status.',
            }));
          });
        }
      } else {
        onClose();
      }
    } catch (e: any) {
      const msg = e?.message || t('home.composerPostError', { defaultValue: 'Could not publish post.' });
      setInlineError(msg);
      onError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [canPost, overLimit, publishDestination, selectedFederatedAccountId, circles.length, communities.length, text, mode, imageUris, composerVideo, rotations, selectedCircleId, selectedCommunities, longHtml, longPlain, longBlocks, longTitle, longDraftUuid, sharedPost, token, onPosted, onNotice, onError, onClose, t]);

  const toggleCommunity = useCallback((name: string) => {
    setSelectedCommunities((prev) => {
      const next = new Set(prev);
      const key = name.trim();
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < MAX_COMMUNITIES) {
        next.add(key);
      }
      return next;
    });
  }, []);

  const selectCircle = useCallback((id: number | null) => {
    setSelectedCircleId(id);
  }, []);

  // Pin / unpin from the audience picker. Optimistic — flip local state
  // immediately, roll back if the API rejects (e.g. cap exceeded server-
  // side, even though we also gate it client-side).
  const MAX_PINNED_COMMUNITIES = 3;
  const togglePinCommunity = useCallback(async (community: SearchCommunityResult) => {
    if (!token) return;
    const name = (community.name || '').trim();
    if (!name) return;
    const isPinned = pinnedCommunities.some((p) => (p.name || '').trim() === name);
    if (!isPinned && pinnedCommunities.length >= MAX_PINNED_COMMUNITIES) {
      onNotice(t('home.composerPinLimitReached', {
        max: MAX_PINNED_COMMUNITIES,
        defaultValue: `You can pin up to ${MAX_PINNED_COMMUNITIES} communities. Unpin one first.`,
      }));
      return;
    }
    const previous = pinnedCommunities;
    setPinnedCommunities(isPinned
      ? previous.filter((p) => (p.name || '').trim() !== name)
      : [...previous, community]);
    try {
      if (isPinned) await api.unpinCommunity(token, name);
      else await api.pinCommunity(token, name);
    } catch (e: any) {
      setPinnedCommunities(previous);
      onError(e?.message || t('home.composerPinFailed', {
        defaultValue: 'Could not update pinned communities.',
      }));
    }
  }, [token, pinnedCommunities, onError, onNotice, t]);

  const selectedCircleName = useMemo(() => {
    if (selectedCircleId == null) return null;
    const found = circles.find((cc) => cc.id === selectedCircleId);
    return found?.name || t('home.composerCircleFallback', { defaultValue: 'Circle' });
  }, [selectedCircleId, circles, t]);

  const audienceSummary = useMemo(() => {
    const parts: string[] = [];
    if (selectedCommunities.size > 0) {
      parts.push(t('home.composerAudienceCommunities', {
        count: selectedCommunities.size,
        defaultValue: `${selectedCommunities.size} ${selectedCommunities.size === 1 ? 'community' : 'communities'}`,
      }));
    }
    parts.push(selectedCircleName
      ? t('home.composerAudienceCircleNamed', { name: selectedCircleName, defaultValue: `Circle: ${selectedCircleName}` })
      : t('home.composerAudiencePublic', { defaultValue: 'Public' }));
    return parts.join(' · ');
  }, [selectedCommunities.size, selectedCircleName, t]);

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: c.background }]}
      // behavior was previously iOS-only — Android got `undefined` which
      // makes KeyboardAvoidingView a no-op. Result: when the keyboard
      // appeared, the Audience / Publish-destination cards at the bottom
      // of the ScrollView sat flush against the keyboard's top, with no
      // breathing room. 'height' on Android shrinks the KAV (which is the
      // root flex container), the inner ScrollView reflows, and the
      // ScrollView's contentContainer paddingBottom (40px below) keeps
      // the last card visibly above the keyboard. iOS stays on 'padding'
      // which is the iOS norm for full-screen modal composers.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Status-bar safe-area spacer — fullScreenModal covers the whole
       *  screen, so the header lands under the notch / clock without
       *  this padding. */}
      <View style={{ height: insets.top, backgroundColor: c.surface }} />
      {/* Header */}
      <View style={[s.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity
          onPress={mode === 'long' && fullscreen ? () => setFullscreen(false) : onClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          disabled={submitting}
        >
          <MaterialCommunityIcons
            name={mode === 'long' && fullscreen ? 'arrow-collapse-vertical' : 'close'}
            size={22}
            color={c.textSecondary}
          />
        </TouchableOpacity>
        <View style={s.headerTitleWrap}>
          <Text style={[s.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
            {t('home.composerTitle', { defaultValue: 'New post' })}
          </Text>
          {mode === 'long' && autosaveStatus !== 'idle' ? (
            <View style={[s.headerSavedBadge, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
              {autosaveStatus === 'saving' ? (
                <ActivityIndicator size="small" color={c.primary} />
              ) : (
                <MaterialCommunityIcons name="check-circle-outline" size={12} color={c.primary} />
              )}
              <Text style={[s.headerSavedText, { color: c.textMuted }]}>
                {autosaveStatus === 'saving'
                  ? t('home.composerLongAutosaving', { defaultValue: 'Saving…' })
                  : t('home.composerLongAutosaved', { defaultValue: 'Saved' })}
              </Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity
          style={[s.postBtn, { backgroundColor: canPost && !overLimit && !mastodonBlocked ? c.primary : c.border, opacity: canPost && !overLimit && !mastodonBlocked ? 1 : 0.7 }]}
          activeOpacity={0.85}
          onPress={() => {
            if (mode === 'long') {
              setLongAudienceOpen(true);
            } else {
              void submit();
            }
          }}
          disabled={!canPost || overLimit || mastodonBlocked}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={s.postBtnText}>
              {mode === 'long'
                ? t('home.composerNextAction', { defaultValue: 'Next' })
                : t('home.composerPostAction', { defaultValue: 'Post' })}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {inlineError ? (
        <View style={[s.errorBanner, { backgroundColor: `${c.errorText}1a`, borderColor: c.errorText }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={c.errorText} />
          <Text style={[s.errorBannerText, { color: c.errorText }]} numberOfLines={3}>{inlineError}</Text>
          <TouchableOpacity onPress={() => setInlineError('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialCommunityIcons name="close" size={16} color={c.errorText} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Mode toggle — hidden in repost mode (you can't quote-repost into a long post). */}
      {sharedPost ? null : (
      <View style={[s.modeRow, { borderBottomColor: c.border }]}>
        {(['short', 'long'] as const).map((m) => {
          const active = mode === m;
          const label = m === 'short'
            ? t('home.composerModeShort', { defaultValue: 'Short' })
            : t('home.composerModeLong', { defaultValue: 'Long' });
          return (
            <TouchableOpacity
              key={m}
              style={[s.modeTab, { borderBottomColor: active ? c.primary : 'transparent' }]}
              onPress={() => setMode(m)}
              activeOpacity={0.8}
            >
              <Text style={[s.modeTabText, { color: active ? c.primary : c.textMuted }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      )}

      {mode === 'long' ? (
        // Long mode renders without an outer ScrollView so the editor can
        // take `flex: 1` in fullscreen. The <LongPostLexicalEditor>
        // sits at one stable React position regardless of `fullscreen`,
        // so toggling fullscreen no longer remounts the WebView and any
        // in-progress edits survive the toggle.
        <View style={{ flex: 1 }}>
          {!fullscreen ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 10 }}>
              <View style={s.longActionsRow}>
              <TouchableOpacity
                style={[s.longActionBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                activeOpacity={0.85}
                onPress={() => setFullscreen((p) => !p)}
              >
                <MaterialCommunityIcons
                  name={fullscreen ? 'arrow-collapse-vertical' : 'arrow-expand-vertical'}
                  size={16}
                  color={c.textPrimary}
                />
                <Text style={[s.longActionBtnText, { color: c.textPrimary }]}>
                  {fullscreen
                    ? t('home.composerLongExitFullscreen', { defaultValue: 'Exit fullscreen' })
                    : t('home.composerLongFullscreen', { defaultValue: 'Fullscreen' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.longActionBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                activeOpacity={0.85}
                onPress={() => setPreviewOpen(true)}
                disabled={!longPlain.trim() && !longHtml.trim()}
              >
                <MaterialCommunityIcons name="eye-outline" size={16} color={c.textPrimary} />
                <Text style={[s.longActionBtnText, { color: c.textPrimary }]}>
                  {t('home.composerLongPreview', { defaultValue: 'Preview' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.longActionBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                activeOpacity={0.85}
                onPress={() => void openDrafts()}
              >
                <MaterialCommunityIcons name="folder-open-outline" size={16} color={c.textPrimary} />
                <Text style={[s.longActionBtnText, { color: c.textPrimary }]}>
                  {t('home.composerLongDrafts', { defaultValue: 'Drafts' })}
                </Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={[s.longActionBtn, { borderColor: c.border, backgroundColor: c.inputBackground, opacity: savingDraft ? 0.6 : 1 }]}
                activeOpacity={0.85}
                onPress={() => void saveLongDraft(false)}
                disabled={savingDraft}
              >
                {savingDraft ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="content-save-outline" size={16} color={c.textPrimary} />
                    <Text style={[s.longActionBtnText, { color: c.textPrimary }]}>
                      {t('home.composerLongSaveDraft', { defaultValue: 'Save draft' })}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
          ) : null}

          {!fullscreen ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
              <TextInput
                style={[s.longTitleInput, {
                  borderColor: c.inputBorder,
                  backgroundColor: c.inputBackground,
                  color: c.textPrimary,
                }]}
                placeholder={t('home.longPostTitlePlaceholder', { defaultValue: 'Write post title…' })}
                placeholderTextColor={c.textMuted}
                value={longTitle}
                onChangeText={setLongTitle}
                editable={!submitting}
                maxLength={140}
              />
            </View>
          ) : null}

          {/* The editor sits at a stable React position regardless of
           *  fullscreen — only its parent style flips. That way toggling
           *  fullscreen never unmounts the WebView (in-progress edits
           *  survive). */}
          <View style={fullscreen ? { flex: 1 } : { height: 420, paddingHorizontal: 16, paddingTop: 10 }}>
            <LongPostLexicalEditor
              ref={editorRef}
              c={c}
              token={token}
              initialHtml={longHtml}
              onChangeHtml={(html, blocks) => {
                setLongHtml(html);
                if (Array.isArray(blocks)) setLongBlocks(blocks);
              }}
              onUploadImage={onLongPostUploadImage}
              onNotify={(msg) => onNotice(msg)}
              containerStyle={fullscreen ? { flex: 1, borderRadius: 0, borderWidth: 0 } : undefined}
            />
          </View>

          {!fullscreen ? (
            <ScrollView
              style={{ flex: 0 }}
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 40, gap: 10 }}
              keyboardShouldPersistTaps="handled"
            >
            {/* Counters */}
            <View style={s.longMetaRow}>
              <Text style={[s.longMetaText, { color: c.textMuted }]}>
                {t('home.composerLongImagesCounter', {
                  used: longImageCount,
                  max: LONG_POST_MAX_IMAGES,
                  defaultValue: `Images used: ${longImageCount} / ${LONG_POST_MAX_IMAGES}`,
                })}
              </Text>
              <View style={{ flex: 1 }} />
              <Text
                style={[
                  s.longMetaText,
                  {
                    color: longCharsOver
                      ? c.errorText
                      : longCharsLow
                        ? '#ea580c'
                        : c.textMuted,
                    fontWeight: longCharsOver || longCharsLow ? '800' : '600',
                  },
                ]}
              >
                {t('home.composerLongCharCounter', {
                  used: longPlain.length,
                  max: MAX_LONG_LENGTH,
                  defaultValue: `Characters: ${longPlain.length} / ${MAX_LONG_LENGTH}`,
                })}
              </Text>
            </View>

            {/* Draft expiry picker */}
            <View style={s.longExpiryRow}>
              <Text style={[s.longMetaText, { color: c.textMuted }]}>
                {t('home.composerLongDraftExpiryLabel', { defaultValue: 'Draft expires in' })}
              </Text>
              {[10, 14, 20].map((d) => {
                const active = draftExpiryDays === d;
                return (
                  <TouchableOpacity
                    key={`expiry-${d}`}
                    style={[
                      s.longExpiryChip,
                      {
                        borderColor: active ? c.primary : c.border,
                        backgroundColor: active ? `${c.primary}22` : c.inputBackground,
                      },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => setDraftExpiryDays(d)}
                  >
                    <Text style={[s.longExpiryChipText, { color: active ? c.primary : c.textPrimary }]}>
                      {`${d}d`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <View style={{ flex: 1 }} />
              {autosaveStatus !== 'idle' ? (
                <Text style={[s.longMetaText, { color: c.textMuted, fontStyle: 'italic' }]}>
                  {autosaveStatus === 'saving'
                    ? t('home.composerLongAutosaving', { defaultValue: 'Saving…' })
                    : t('home.composerLongAutosaved', { defaultValue: 'Saved' })}
                </Text>
              ) : null}
            </View>

            </ScrollView>
          ) : null}
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <>
            <ShortComposerInput
              text={text}
              onChangeText={setText}
              token={token}
              sharedPost={sharedPost}
              submitting={submitting}
              maxLength={maxLength}
              c={c}
              s={s}
              t={t}
            />

            {sharedPost ? <SharedPostPreview post={sharedPost} c={c} /> : null}

            <View style={s.metaRow}>
              <Text style={[s.charCounter, { color: overLimit ? c.errorText : c.textMuted }]}>
                {remaining}
              </Text>
              {mastodonGateActive ? (
                <Text style={[s.charCounter, { color: mastodonOverLimit ? c.errorText : c.textMuted, marginLeft: 12 }]}>
                  {t('home.composerMastodonCounter', {
                    remaining: mastodonRemaining,
                    max: MASTODON_DEFAULT_MAX_CHARS,
                    defaultValue: 'Mastodon: {{remaining}}',
                  })}
                </Text>
              ) : null}
            </View>
            {mastodonOverLimit ? (
              <View style={[s.linkPreviewCard, { borderColor: c.errorText, backgroundColor: c.inputBackground }]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color={c.errorText} style={{ marginRight: 8 }} />
                <Text style={{ color: c.errorText, flex: 1 }}>
                  {t('home.composerMastodonOverLimitWarning', {
                    max: MASTODON_DEFAULT_MAX_CHARS,
                    defaultValue: 'This post is too long for Mastodon (max {{max}} characters). Shorten it or post to Openspace only.',
                  })}
                </Text>
              </View>
            ) : null}
        {linkPreviewLoading && !linkPreview ? (
          <View style={[s.linkPreviewCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
            <ActivityIndicator color={c.primary} size="small" style={{ marginRight: 10 }} />
            <Text style={[s.linkPreviewLoadingText, { color: c.textMuted }]} numberOfLines={1}>
              {t('home.composerLinkPreviewLoading', { defaultValue: 'Fetching link preview…' })}
            </Text>
          </View>
        ) : linkPreview ? (
          <View style={[s.linkPreviewCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
            {linkPreview.imageUrl ? (
              <View style={s.linkPreviewImageWrap}>
                <Image source={{ uri: linkPreview.imageUrl }} style={s.linkPreviewImage} resizeMode="cover" />
                {linkPreview.isVideoEmbed ? (
                  <View style={s.linkPreviewPlay}>
                    <MaterialCommunityIcons name="play" size={22} color="#fff" />
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={s.linkPreviewBody}>
              {linkPreview.siteName ? (
                <Text style={[s.linkPreviewSite, { color: c.textMuted }]} numberOfLines={1}>
                  {linkPreview.siteName}
                </Text>
              ) : (
                <Text style={[s.linkPreviewSite, { color: c.textMuted }]} numberOfLines={1}>
                  {getUrlHostLabel(linkPreview.url)}
                </Text>
              )}
              <Text style={[s.linkPreviewTitle, { color: c.textPrimary }]} numberOfLines={2}>
                {linkPreview.title}
              </Text>
              {linkPreview.description ? (
                <Text style={[s.linkPreviewDesc, { color: c.textMuted }]} numberOfLines={2}>
                  {linkPreview.description}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={[s.linkPreviewClose, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
              activeOpacity={0.85}
              onPress={() => {
                setDismissedPreviewUrl(linkPreview.url);
                setLinkPreview(null);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('home.composerLinkPreviewDismiss', { defaultValue: 'Dismiss preview' })}
            >
              <MaterialCommunityIcons name="close" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : null}

        {composerVideo ? (
          <View style={s.imageStrip}>
            <View
              style={[
                s.imageThumbWrap,
                { borderColor: c.border, backgroundColor: '#000' },
              ]}
            >
              <View
                style={[
                  s.imageThumb,
                  { alignItems: 'center', justifyContent: 'center' },
                ]}
              >
                <MaterialCommunityIcons name="play-circle" size={36} color="rgba(255,255,255,0.85)" />
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 4 }} numberOfLines={1}>
                  {t('home.composerVideoSelected', { defaultValue: 'Video selected' })}
                </Text>
              </View>
              <TouchableOpacity
                style={[s.imageRemove, { backgroundColor: 'rgba(0,0,0,0.65)' }]}
                activeOpacity={0.85}
                onPress={removeVideo}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={t('home.composerRemoveVideo', { defaultValue: 'Remove video' })}
              >
                <MaterialCommunityIcons name="close" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {imageUris.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.imageStrip}
            contentContainerStyle={{ gap: 10, paddingRight: 4 }}
          >
            {imageUris.map((uri) => {
              const rotation = rotations[uri] || 0;
              return (
                <View
                  key={uri}
                  style={[s.imageThumbWrap, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                >
                  <Image
                    source={{ uri }}
                    style={[s.imageThumb, { transform: [{ rotate: `${rotation}deg` }] }]}
                    resizeMode="cover"
                  />
                  <TouchableOpacity
                    style={[s.imageRotate, { backgroundColor: 'rgba(0,0,0,0.65)' }]}
                    activeOpacity={0.85}
                    onPress={() => rotateImage(uri)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={t('home.composerRotateImage', { defaultValue: 'Rotate image' })}
                  >
                    <MaterialCommunityIcons name="rotate-right" size={14} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.imageRemove, { backgroundColor: 'rgba(0,0,0,0.65)' }]}
                    activeOpacity={0.85}
                    onPress={() => removeImage(uri)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialCommunityIcons name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        ) : null}

        <View style={[s.publishCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
          <Text style={[s.publishCardTitle, { color: c.textPrimary }]}>
            {t('home.postComposerPublishDestinationLabel', { defaultValue: 'Publish destination' })}
          </Text>
          <View style={s.publishOptions}>
            {([
              { key: 'openbook', icon: 'home-variant-outline', label: t('home.postComposerPublishDestinationOpenSpace', { defaultValue: 'OpenSpace' }) },
              { key: 'mastodon', icon: 'mastodon', label: t('home.postComposerPublishDestinationMastodon', { defaultValue: 'Mastodon' }) },
              { key: 'both', icon: 'source-branch', label: t('home.postComposerPublishDestinationBoth', { defaultValue: 'Both' }) },
            ] as Array<{ key: 'openbook' | 'mastodon' | 'both'; icon: string; label: string }>).map((option) => {
              const disabled = option.key !== 'openbook' && federatedLinkedAccounts.length === 0;
              const selected = publishDestination === option.key;
              return (
                <TouchableOpacity
                  key={`native-publish-${option.key}`}
                  style={[
                    s.publishOption,
                    {
                      borderColor: selected ? c.primary : c.border,
                      backgroundColor: selected ? `${c.primary}18` : c.surface,
                      opacity: disabled ? 0.45 : 1,
                    },
                  ]}
                  activeOpacity={0.85}
                  disabled={disabled}
                  onPress={() => setPublishDestination(option.key)}
                >
                  <MaterialCommunityIcons name={option.icon as any} size={18} color={selected ? c.primary : c.textMuted} />
                  <Text style={[s.publishOptionText, { color: selected ? c.primary : c.textPrimary }]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {federatedLinkedAccounts.length === 0 ? (
            <Text style={[s.publishHint, { color: c.textMuted }]}>
              {t('home.postComposerNoMastodonAccounts', {
                defaultValue: 'Link a Mastodon account in Linked Accounts to publish there.',
              })}
            </Text>
          ) : null}
          {publishDestination !== 'openbook' && federatedLinkedAccounts.length > 0 ? (
            <View style={s.publishAccountList}>
              {federatedLinkedAccounts.map((account) => {
                const selected = selectedFederatedAccountId === account.id;
                return (
                  <TouchableOpacity
                    key={`native-mastodon-account-${account.id}`}
                    style={[
                      s.publishAccountRow,
                      {
                        borderColor: selected ? c.primary : c.border,
                        backgroundColor: selected ? `${c.primary}18` : c.surface,
                      },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => setSelectedFederatedAccountId(account.id)}
                  >
                    <MaterialCommunityIcons
                      name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                      size={18}
                      color={selected ? c.primary : c.textMuted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.publishAccountName, { color: c.textPrimary }]}>
                        {account.acct || `@${account.username || ''}@${account.instance_domain}`}
                      </Text>
                      <Text style={[s.publishAccountSubtext, { color: c.textMuted }]} numberOfLines={1}>
                        {account.instance_domain}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          style={[s.audienceRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          activeOpacity={0.85}
          onPress={() => setAudienceOpen(true)}
        >
          <MaterialCommunityIcons name="account-multiple-outline" size={18} color={c.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={[s.audienceLabel, { color: c.textMuted }]}>
              {t('home.composerAudienceLabel', { defaultValue: 'Audience' })}
            </Text>
            <Text style={[s.audienceValue, { color: c.textPrimary }]} numberOfLines={1}>
              {audienceSummary}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={c.textMuted} />
        </TouchableOpacity>
          </>
        </ScrollView>
      )}

      {/* Bottom toolbar — short post only. Long mode owns its own image
       *  controls inline with the editor. */}
      {mode === 'short' ? (() => {
        // True when the user has already hit the per-post image cap AND
        // hasn't switched to video. Drives both the disabled state and
        // the dimmed visual cue on the picker / paste buttons below, so
        // the user can SEE they can't add more without having to tap
        // and get an error toast.
        const atImageLimit = !composerVideo && imageUris.length >= MAX_IMAGES;
        const pickerDisabled = submitting || atImageLimit;
        const pasteDisabled = submitting || !!composerVideo || atImageLimit;
        return (
        <View style={[s.toolbar, { borderTopColor: c.border, backgroundColor: c.surface }]}>
          <TouchableOpacity
            style={[
              s.toolbarBtn,
              { backgroundColor: c.inputBackground, flex: 1 },
              // 0.55 mirrors the "disabled control" opacity used elsewhere
              // in the composer (see send-button states). Pressing has no
              // effect when disabled, but the dimmed look + the "5/5"
              // counter together telegraph why.
              pickerDisabled && { opacity: 0.55 },
            ]}
            activeOpacity={0.85}
            onPress={() => void pickMedia()}
            disabled={pickerDisabled}
          >
            <MaterialCommunityIcons
              name="image-multiple-outline"
              size={20}
              color={atImageLimit ? c.textMuted : c.textSecondary}
            />
            <Text
              style={[
                s.toolbarBtnText,
                { color: atImageLimit ? c.textMuted : c.textPrimary },
              ]}
            >
              {composerVideo
                ? t('home.composerVideoCount', { defaultValue: '1 video selected' })
                : imageUris.length === 0
                  ? t('home.composerAddMedia', {
                      count: MAX_IMAGES,
                      defaultValue: `Add media (up to ${MAX_IMAGES} photos or 1 video)`,
                    })
                  : atImageLimit
                    ? t('home.composerImagesMaxReached', {
                        count: imageUris.length,
                        max: MAX_IMAGES,
                        defaultValue: `${imageUris.length}/${MAX_IMAGES} images — max reached`,
                      })
                    : t('home.composerImagesCount', {
                        count: imageUris.length,
                        max: MAX_IMAGES,
                        defaultValue: `${imageUris.length}/${MAX_IMAGES} images`,
                      })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              s.toolbarBtn,
              { backgroundColor: c.inputBackground },
              pasteDisabled && { opacity: 0.55 },
            ]}
            activeOpacity={0.85}
            onPress={() => void pasteMedia()}
            disabled={pasteDisabled}
            accessibilityLabel={t('home.pasteFromClipboard', { defaultValue: 'Paste image from clipboard' })}
          >
            <MaterialCommunityIcons
              name="content-paste"
              size={20}
              color={pasteDisabled ? c.textMuted : c.textSecondary}
            />
            <Text
              style={[
                s.toolbarBtnText,
                { color: pasteDisabled ? c.textMuted : c.textPrimary },
              ]}
            >
              {t('home.pasteAction', { defaultValue: 'Paste' })}
            </Text>
          </TouchableOpacity>
        </View>
        );
      })() : null}

      {/* Drafts list — fullscreen drawer with a scrollable list of long-
       *  post drafts. Each tile has Resume + Delete actions. */}
      <Modal visible={draftsOpen} animationType="slide" onRequestClose={() => setDraftsOpen(false)}>
        <View style={[s.draftsRoot, { backgroundColor: c.background }]}>
          <View style={{ height: insets.top, backgroundColor: c.surface }} />
          <View style={[s.draftsHeader, { borderBottomColor: c.border, backgroundColor: c.surface }]}>
            <Text style={[s.draftsTitle, { color: c.textPrimary }]}>
              {t('home.composerLongDraftsTitle', { defaultValue: 'Long-post drafts' })}
            </Text>
            <TouchableOpacity
              onPress={() => setDraftsOpen(false)}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              style={[s.previewCloseBtn, { backgroundColor: c.inputBackground }]}
            >
              <MaterialCommunityIcons name="close" size={18} color={c.textPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 40 }}>
            {draftsLoading ? (
              <ActivityIndicator color={c.primary} size="large" style={{ marginVertical: 28 }} />
            ) : draftsList.length === 0 ? (
              <View style={s.draftsEmptyWrap}>
                <MaterialCommunityIcons name="folder-open-outline" size={36} color={c.textMuted} />
                <Text style={[s.draftsEmpty, { color: c.textMuted }]}>
                  {t('home.composerLongDraftsEmpty', { defaultValue: 'No long-post drafts yet.' })}
                </Text>
                <Text style={[s.draftsEmptyHint, { color: c.textMuted }]}>
                  {t('home.composerLongDraftsEmptyHint', {
                    defaultValue: 'Drafts you save while writing a long post will appear here.',
                  })}
                </Text>
              </View>
            ) : (
              draftsList.map((d) => {
                const uuid = (d as any).uuid as string | undefined;
                const text = (d as any).long_text || (d as any).text || '';
                const created = (d as any).created;
                const expires = (d as any).draft_expires_at;
                const dateLabel = created ? new Date(created).toLocaleString() : '';
                return (
                  <View
                    key={`draft-${uuid || Math.random()}`}
                    style={[s.draftCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  >
                    <Text style={[s.draftCardTitle, { color: c.textPrimary }]} numberOfLines={3}>
                      {text.trim() || t('home.composerLongDraftUntitled', { defaultValue: 'Untitled draft' })}
                    </Text>
                    <Text style={[s.draftCardSub, { color: c.textMuted }]} numberOfLines={1}>
                      {dateLabel}{expires ? ` · ${t('home.composerLongDraftExpiry', { defaultValue: 'expires' })} ${new Date(expires).toLocaleDateString()}` : ''}
                    </Text>
                    <View style={s.draftCardActions}>
                      <TouchableOpacity
                        style={[s.draftCardBtn, { backgroundColor: c.primary }]}
                        activeOpacity={0.85}
                        onPress={() => loadDraft(d)}
                      >
                        <MaterialCommunityIcons name="pencil-outline" size={16} color="#fff" />
                        <Text style={[s.draftCardBtnText, { color: '#fff' }]}>
                          {t('home.composerLongDraftResume', { defaultValue: 'Resume' })}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.draftCardBtnSecondary, { borderColor: c.border, backgroundColor: c.surface }]}
                        activeOpacity={0.85}
                        onPress={() => {
                          const confirmTitle = t('home.composerLongDraftDeleteTitle', { defaultValue: 'Delete draft?' });
                          const confirmBody = t('home.composerLongDraftDeleteBody', { defaultValue: 'This draft will be permanently removed.' });
                          if (Platform.OS === 'web') {
                            // eslint-disable-next-line no-alert
                            if (typeof window !== 'undefined' && (window as any).confirm?.(`${confirmTitle}\n\n${confirmBody}`)) {
                              void deleteDraft(d);
                            }
                          } else {
                            Alert.alert(confirmTitle, confirmBody, [
                              { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                              { text: t('home.composerLongDraftDeleteConfirm', { defaultValue: 'Delete' }), style: 'destructive', onPress: () => void deleteDraft(d) },
                            ]);
                          }
                        }}
                      >
                        <MaterialCommunityIcons name="delete-outline" size={16} color={c.errorText} />
                        <Text style={[s.draftCardBtnText, { color: c.errorText }]}>
                          {t('home.composerLongDraftDelete', { defaultValue: 'Delete' })}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Long-post preview — renders the post body the same way it'll
       *  appear once published (same HTML lands in the feed). */}
      <Modal visible={previewOpen} animationType="slide" onRequestClose={() => setPreviewOpen(false)}>
        <View style={[s.previewRoot, { backgroundColor: c.background }]}>
          {/* Safe-area top padding so the close button clears the notch. */}
          <View style={{ height: Platform.OS === 'ios' ? 44 : 0, backgroundColor: c.surface }} />
          <View style={[s.previewHeader, { borderBottomColor: c.border, backgroundColor: c.surface }]}>
            <Text style={[s.previewTitle, { color: c.textPrimary }]}>
              {t('home.composerLongPreviewTitle', { defaultValue: 'Preview' })}
            </Text>
            <TouchableOpacity
              onPress={() => setPreviewOpen(false)}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              style={[s.previewCloseBtn, { backgroundColor: c.inputBackground }]}
            >
              <MaterialCommunityIcons name="close" size={18} color={c.textPrimary} />
            </TouchableOpacity>
          </View>
          <PreviewWebView c={c} html={longHtml || '<p></p>'} />
        </View>
      </Modal>

      {/* Audience picker sheet */}
      <AudienceSheet
        visible={audienceOpen}
        onClose={() => setAudienceOpen(false)}
        c={c}
        t={t}
        communities={communities}
        pinnedCommunities={pinnedCommunities}
        circles={circles}
        selectedCommunities={selectedCommunities}
        selectedCircleId={selectedCircleId}
        onToggleCommunity={toggleCommunity}
        onSelectCircle={selectCircle}
        onSearchCommunities={(q) => api.searchCommunities(token, q, 20)}
        onTogglePinCommunity={togglePinCommunity}
      />

      {/* Long-post audience step — shown when the user taps "Next" in long
       *  mode. Acts as a separate page with its own header (back to editor)
       *  and a final "Post" action at the bottom. */}
      <Modal
        visible={longAudienceOpen}
        animationType="slide"
        onRequestClose={() => setLongAudienceOpen(false)}
      >
        <LongAudiencePage
          c={c}
          t={t}
          insetsTop={insets.top}
          communities={communities}
          pinnedCommunities={pinnedCommunities}
          circles={circles}
          selectedCommunities={selectedCommunities}
          selectedCircleId={selectedCircleId}
          onToggleCommunity={toggleCommunity}
          onSelectCircle={selectCircle}
          onSearchCommunities={(q) => api.searchCommunities(token, q, 20)}
          onTogglePinCommunity={togglePinCommunity}
          onBack={() => setLongAudienceOpen(false)}
          onPost={async () => {
            await submit();
            setLongAudienceOpen(false);
          }}
          submitting={submitting}
          canPost={canPost && !overLimit && !mastodonBlocked}
          audienceSummary={audienceSummary}
        />
      </Modal>
      {/* Mount the popup overlay INSIDE this screen — react-navigation
          presents PostComposer as fullScreenModal on iOS, which paints in
          a separate native window. The app-root MentionPopupOverlay is
          behind it, so the @mention/#hashtag suggestion node never
          appears here. Mirroring PostDetailModal / HomeScreen composer
          fixes. */}
      <MentionPopupOverlay />
    </KeyboardAvoidingView>
  );
}

// ── Long-post preview ─────────────────────────────────────────────────────
// Renders the editor's HTML body inside a small WebView so the user sees
// exactly the markup their published post will produce — same Lexical
// classes (`oslx-*`), same iframe / figure shapes the feed renderer paints.
function PreviewWebView({ c, html }: { c: any; html: string }) {
  const doc = `<!doctype html>
<html><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 16px; background: ${c.background}; color: ${c.textPrimary}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 17px; line-height: 1.55; }
  html, body { overflow-x: hidden; }
  body { word-wrap: break-word; overflow-wrap: anywhere; }
  h1, .oslx-h1 { font-size: 28px; font-weight: 900; margin: 0.5em 0 0.3em; line-height: 1.2; }
  h2, .oslx-h2 { font-size: 22px; font-weight: 800; margin: 0.6em 0 0.3em; }
  h3, .oslx-h3 { font-size: 19px; font-weight: 800; margin: 0.6em 0 0.3em; }
  p, .oslx-paragraph { margin: 0.4em 0; }
  blockquote, .oslx-quote { border-left: 3px solid #6366F1; background: #6366F114; margin: 0.6em 0; padding: 6px 12px; border-radius: 4px; }
  ul, .oslx-ul { padding-left: 22px; margin: 0.4em 0; }
  ol, .oslx-ol { padding-left: 22px; margin: 0.4em 0; }
  a, .oslx-link { color: #2563EB; text-decoration: underline; }
  img { max-width: 100%; height: auto; border-radius: 8px; }
  iframe { width: 100%; aspect-ratio: 16/9; border: 0; border-radius: 10px; }
  /* Tables: long rows scroll inside a wrapper instead of pushing the
     body wider than the viewport. */
  .table-scroll { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0.6em 0; }
  /* Tables produced by the Lexical editor are layout grids — borders
     stay transparent unless the author explicitly opts into the
     oslx-table-bordered class (matches the web renderer). */
  table.oslx-table, table { width: 100%; border-collapse: collapse; border: 0; }
  table td, table th { padding: 8px 10px; border: 0; vertical-align: top; }
  table.oslx-table-bordered, table.oslx-table-bordered td, table.oslx-table-bordered th { border: 1px solid ${c.border}; }
  table.oslx-table-bordered th { background: #F1F5F9; }
  /* Link-embed card — populated from the figure's data-* attributes by
     the script below so previews match the published post. */
  figure[data-os-link-embed="true"] {
    display: flex; gap: 12px; align-items: stretch;
    border: 1px solid ${c.border}; border-radius: 12px;
    background: ${c.inputBackground}; padding: 0; margin: 0.6em 0;
    overflow: hidden; text-decoration: none;
  }
  figure[data-os-link-embed="true"] .le-img { width: 96px; min-width: 96px; background: #00000010; background-size: cover; background-position: center; }
  figure[data-os-link-embed="true"] .le-body { flex: 1; padding: 10px 12px; min-width: 0; }
  figure[data-os-link-embed="true"] .le-site { font-size: 12px; color: ${c.textMuted}; margin-bottom: 2px; }
  figure[data-os-link-embed="true"] .le-title { font-size: 15px; font-weight: 800; color: ${c.textPrimary}; margin-bottom: 2px; }
  figure[data-os-link-embed="true"] .le-desc { font-size: 13px; color: ${c.textSecondary}; }
  figure[data-os-link-embed="true"] a { color: ${c.textPrimary}; text-decoration: none; display: block; }
  .oslx-bold, b, strong { font-weight: 800; }
  .oslx-italic, i, em { font-style: italic; }
  .oslx-underline, u { text-decoration: underline; }
  .oslx-strike, s { text-decoration: line-through; }
  code { background: ${c.inputBackground}; padding: 2px 4px; border-radius: 4px; font-family: ui-monospace, Menlo, monospace; font-size: 0.95em; }
</style>
</head>
<body>${html}
<script>
  (function(){
    // Wrap raw tables so they scroll horizontally instead of overflowing
    // the body. Skip if already wrapped.
    document.querySelectorAll('table').forEach(function(tbl){
      if (tbl.parentElement && tbl.parentElement.classList.contains('table-scroll')) return;
      var wrap = document.createElement('div');
      wrap.className = 'table-scroll';
      tbl.parentNode.insertBefore(wrap, tbl);
      wrap.appendChild(tbl);
    });
    // Render link-embed figures as proper cards using their data-*
    // attributes (data-title, data-description, data-image-url, data-site-name).
    document.querySelectorAll('figure[data-os-link-embed="true"]').forEach(function(fig){
      var url = fig.getAttribute('data-url') || (fig.querySelector('a') && fig.querySelector('a').getAttribute('href')) || '';
      var title = fig.getAttribute('data-title') || url;
      var desc = fig.getAttribute('data-description') || '';
      var img = fig.getAttribute('data-image-url') || '';
      var site = fig.getAttribute('data-site-name') || '';
      try { if (!site && url) site = new URL(url).hostname.replace(/^www\\./, ''); } catch(e) {}
      fig.innerHTML = '';
      var anchor = document.createElement('a');
      anchor.setAttribute('href', url);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
      anchor.style.display = 'flex';
      anchor.style.gap = '12px';
      anchor.style.width = '100%';
      if (img) {
        var thumb = document.createElement('div');
        thumb.className = 'le-img';
        thumb.style.backgroundImage = 'url("' + img.replace(/"/g, '%22') + '")';
        anchor.appendChild(thumb);
      }
      var body = document.createElement('div');
      body.className = 'le-body';
      if (site) { var s = document.createElement('div'); s.className = 'le-site'; s.textContent = site; body.appendChild(s); }
      var ttl = document.createElement('div'); ttl.className = 'le-title'; ttl.textContent = title; body.appendChild(ttl);
      if (desc) { var d = document.createElement('div'); d.className = 'le-desc'; d.textContent = desc; body.appendChild(d); }
      anchor.appendChild(body);
      fig.appendChild(anchor);
    });
  })();
</script>
</body></html>`;
  return (
    <RNWebView
      originWhitelist={['*']}
      // baseUrl matches EMBED_PARENT_HOST so YouTube/Twitch referrer
      // checks pass. Without it embeds report "Error 153 / video player
      // configuration error".
      source={{ html: doc, baseUrl: 'https://openspacelive.com' }}
      style={{ flex: 1, backgroundColor: c.background }}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      automaticallyAdjustContentInsets={false}
    />
  );
}

// ── Shared-post preview card (repost mode) ──────────────────────────────
// Renders a compact, non-editable preview of the post being quoted/reposted.
// Same fields the web composer surfaces: creator, optional community, and
// a snippet of body text so the user can confirm what they're about to share.
function SharedPostPreview({ post, c }: { post: FeedPost; c: any }) {
  const creator: any = (post as any)?.creator || {};
  const community: any = (post as any)?.community || null;
  const username = creator?.username || '';
  const avatar = creator?.profile?.avatar || creator?.avatar || '';
  const text = ((post as any)?.text || (post as any)?.long_text || '').toString();
  const snippet = text.length > 240 ? `${text.slice(0, 240).trim()}…` : text;
  return (
    <View style={{
      marginTop: 12,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      padding: 12,
      backgroundColor: c.inputBackground,
      gap: 8,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={{ width: 28, height: 28, borderRadius: 14 }} />
        ) : (
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.border }} />
        )}
        <Text style={{ color: c.textPrimary, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
          {username ? `@${username}` : ''}
        </Text>
        {community?.name ? (
          <Text style={{ color: c.textMuted, fontSize: 12 }} numberOfLines={1}>
            {`· c/${community.name}`}
          </Text>
        ) : null}
      </View>
      {snippet ? (
        <Text style={{ color: c.textPrimary, fontSize: 14, lineHeight: 20 }} numberOfLines={6}>
          {snippet}
        </Text>
      ) : null}
    </View>
  );
}

// ── Audience picker sheet ────────────────────────────────────────────────────

type AudienceProps = {
  visible: boolean;
  onClose: () => void;
  c: any;
  t: (key: string, options?: any) => string;
  communities: SearchCommunityResult[];
  pinnedCommunities: SearchCommunityResult[];
  circles: CircleResult[];
  selectedCommunities: Set<string>;
  selectedCircleId: number | null;
  onToggleCommunity: (name: string) => void;
  onSelectCircle: (id: number | null) => void;
  /** Backend search lookup so users can post to communities outside the
   *  small set of joined ones returned by `getJoinedCommunities`. */
  onSearchCommunities: (query: string) => Promise<SearchCommunityResult[]>;
  /** Pin/unpin a community to/from the user's pinned shortlist (max 3). */
  onTogglePinCommunity: (community: SearchCommunityResult) => void;
};

type AudienceTab = 'communities' | 'circles';

function AudienceSheet({
  visible,
  onClose,
  c,
  t,
  communities,
  pinnedCommunities,
  circles,
  selectedCommunities,
  selectedCircleId,
  onToggleCommunity,
  onSelectCircle,
  onSearchCommunities,
  onTogglePinCommunity,
}: AudienceProps) {
  const [tab, setTab] = useState<AudienceTab>('communities');

  const circleSummaryLabel = (() => {
    if (selectedCircleId == null) return t('home.composerAudiencePublic', { defaultValue: 'Public' });
    const found = circles.find((cc) => cc.id === selectedCircleId);
    return found?.name || t('home.composerCircleFallback', { defaultValue: 'Circle' });
  })();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={sheetStyles.overlay} onPress={onClose}>
        <Pressable style={[sheetStyles.sheet, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
          <View style={[sheetStyles.handle, { backgroundColor: c.border }]} />
          <View style={[sheetStyles.header, { borderBottomColor: c.border }]}>
            <Text style={[sheetStyles.title, { color: c.textPrimary }]}>
              {t('home.composerAudienceLabel', { defaultValue: 'Audience' })}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialCommunityIcons name="close" size={20} color={c.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={[sheetStyles.tabsRow, { borderBottomColor: c.border }]}>
            <TouchableOpacity
              style={[sheetStyles.tab, { borderBottomColor: tab === 'communities' ? c.primary : 'transparent' }]}
              onPress={() => setTab('communities')}
              activeOpacity={0.8}
            >
              <Text style={[sheetStyles.tabLabel, { color: tab === 'communities' ? c.primary : c.textPrimary }]}>
                {t('home.composerTabCommunities', { defaultValue: 'Communities' })}
              </Text>
              <Text style={[sheetStyles.tabCounter, { color: tab === 'communities' ? c.primary : c.textMuted }]}>
                {`${selectedCommunities.size}/${MAX_COMMUNITIES}`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[sheetStyles.tab, { borderBottomColor: tab === 'circles' ? c.primary : 'transparent' }]}
              onPress={() => setTab('circles')}
              activeOpacity={0.8}
            >
              <Text style={[sheetStyles.tabLabel, { color: tab === 'circles' ? c.primary : c.textPrimary }]}>
                {t('home.composerTabCircles', { defaultValue: 'Circles' })}
              </Text>
              <Text
                style={[sheetStyles.tabCounter, { color: tab === 'circles' ? c.primary : c.textMuted }]}
                numberOfLines={1}
              >
                {circleSummaryLabel}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }} keyboardShouldPersistTaps="handled">
            {tab === 'communities' ? (
              <CommunitiesPickerList
                c={c}
                t={t}
                joinedCommunities={communities}
                pinnedCommunities={pinnedCommunities}
                selectedCommunities={selectedCommunities}
                onToggleCommunity={onToggleCommunity}
                onSearchCommunities={onSearchCommunities}
                onTogglePinCommunity={onTogglePinCommunity}
              />
            ) : (
              <>
                {/* Public — first item, single-select with circles below. */}
                <TouchableOpacity
                  key="circle-public"
                  style={[
                    sheetStyles.row,
                    {
                      borderColor: c.border,
                      backgroundColor: selectedCircleId == null ? `${c.primary}18` : c.inputBackground,
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => onSelectCircle(null)}
                >
                  <View style={[sheetStyles.avatar, { backgroundColor: c.primary }]}>
                    <MaterialCommunityIcons name="earth" size={20} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[sheetStyles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>
                      {t('home.postComposerPublicDestinationTitle', { defaultValue: 'Public (no circle)' })}
                    </Text>
                    <Text style={[sheetStyles.rowSub, { color: c.textMuted }]} numberOfLines={2}>
                      {t('home.postComposerPublicDestinationSubtitle', {
                        defaultValue: 'Visible outside circles based on your profile privacy settings.',
                      })}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name={selectedCircleId == null ? 'radiobox-marked' : 'radiobox-blank'}
                    size={20}
                    color={selectedCircleId == null ? c.primary : c.textMuted}
                  />
                </TouchableOpacity>

                {circles.length === 0 ? (
                  <Text style={[sheetStyles.empty, { color: c.textMuted }]}>
                    {t('home.composerNoCircles', { defaultValue: "You haven't created any circles yet." })}
                  </Text>
                ) : (
                  circles.map((circle) => {
                    const selected = circle.id != null && circle.id === selectedCircleId;
                    return (
                      <TouchableOpacity
                        key={`circle-${circle.id}`}
                        style={[
                          sheetStyles.row,
                          { borderColor: c.border, backgroundColor: selected ? `${c.primary}18` : c.inputBackground },
                        ]}
                        activeOpacity={0.85}
                        onPress={() => circle.id != null && onSelectCircle(circle.id)}
                      >
                        <View style={[sheetStyles.colorDot, { backgroundColor: circle.color || c.primary, borderWidth: 1, borderColor: c.border }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[sheetStyles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>
                            {circle.name || t('home.composerCircleFallback', { defaultValue: 'Circle' })}
                          </Text>
                          {typeof circle.users_count === 'number' ? (
                            <Text style={[sheetStyles.rowSub, { color: c.textMuted }]}>
                              {t('home.composerCircleUsers', {
                                count: circle.users_count,
                                defaultValue: `${circle.users_count} ${circle.users_count === 1 ? 'member' : 'members'}`,
                              })}
                            </Text>
                          ) : null}
                        </View>
                        <MaterialCommunityIcons
                          name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                          size={20}
                          color={selected ? c.primary : c.textMuted}
                        />
                      </TouchableOpacity>
                    );
                  })
                )}
              </>
            )}
          </ScrollView>

          <View style={[sheetStyles.footer, { borderTopColor: c.border }]}>
            <TouchableOpacity
              style={[sheetStyles.doneBtn, { backgroundColor: c.primary }]}
              activeOpacity={0.85}
              onPress={onClose}
            >
              <Text style={sheetStyles.doneBtnText}>
                {t('home.composerAudienceDone', { defaultValue: 'Done' })}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Long-post Audience page ──────────────────────────────────────────────
// Fullscreen sibling to AudienceSheet — the long-post composer routes the
// user here via the header "Next" button. Same row markup; the Post action
// lives in the footer here so the audience step is the explicit final step.
type LongAudienceProps = {
  c: any;
  t: (key: string, options?: any) => string;
  insetsTop: number;
  communities: SearchCommunityResult[];
  pinnedCommunities: SearchCommunityResult[];
  circles: CircleResult[];
  selectedCommunities: Set<string>;
  selectedCircleId: number | null;
  onToggleCommunity: (name: string) => void;
  onSelectCircle: (id: number | null) => void;
  onSearchCommunities: (query: string) => Promise<SearchCommunityResult[]>;
  onTogglePinCommunity: (community: SearchCommunityResult) => void;
  onBack: () => void;
  onPost: () => Promise<void> | void;
  submitting: boolean;
  canPost: boolean;
  audienceSummary: string;
};

function LongAudiencePage({
  c, t, insetsTop, communities, pinnedCommunities, circles, selectedCommunities, selectedCircleId,
  onToggleCommunity, onSelectCircle, onSearchCommunities, onTogglePinCommunity, onBack, onPost, submitting, canPost, audienceSummary,
}: LongAudienceProps) {
  const [tab, setTab] = useState<AudienceTab>('communities');
  const circleSummaryLabel = (() => {
    if (selectedCircleId == null) return t('home.composerAudiencePublic', { defaultValue: 'Public' });
    const found = circles.find((cc) => cc.id === selectedCircleId);
    return found?.name || t('home.composerCircleFallback', { defaultValue: 'Circle' });
  })();
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ height: insetsTop, backgroundColor: c.surface }} />
      <View style={[sheetStyles.header, { borderBottomColor: c.border, backgroundColor: c.surface, paddingHorizontal: 16, paddingVertical: 12 }]}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} disabled={submitting}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={c.textSecondary} />
        </TouchableOpacity>
        <Text style={[sheetStyles.title, { color: c.textPrimary, marginLeft: 12 }]}>
          {t('home.composerAudienceLabel', { defaultValue: 'Audience' })}
        </Text>
        <View style={{ flex: 1 }} />
      </View>

      <View style={[sheetStyles.tabsRow, { borderBottomColor: c.border, backgroundColor: c.surface }]}>
        <TouchableOpacity
          style={[sheetStyles.tab, { borderBottomColor: tab === 'communities' ? c.primary : 'transparent' }]}
          onPress={() => setTab('communities')}
          activeOpacity={0.8}
        >
          <Text style={[sheetStyles.tabLabel, { color: tab === 'communities' ? c.primary : c.textPrimary }]}>
            {t('home.composerTabCommunities', { defaultValue: 'Communities' })}
          </Text>
          <Text style={[sheetStyles.tabCounter, { color: tab === 'communities' ? c.primary : c.textMuted }]}>
            {`${selectedCommunities.size}/${MAX_COMMUNITIES}`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[sheetStyles.tab, { borderBottomColor: tab === 'circles' ? c.primary : 'transparent' }]}
          onPress={() => setTab('circles')}
          activeOpacity={0.8}
        >
          <Text style={[sheetStyles.tabLabel, { color: tab === 'circles' ? c.primary : c.textPrimary }]}>
            {t('home.composerTabCircles', { defaultValue: 'Circles' })}
          </Text>
          <Text style={[sheetStyles.tabCounter, { color: tab === 'circles' ? c.primary : c.textMuted }]} numberOfLines={1}>
            {circleSummaryLabel}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }} keyboardShouldPersistTaps="handled">
        {tab === 'communities' ? (
          <CommunitiesPickerList
            c={c}
            t={t}
            joinedCommunities={communities}
            pinnedCommunities={pinnedCommunities}
            selectedCommunities={selectedCommunities}
            onToggleCommunity={onToggleCommunity}
            onSearchCommunities={onSearchCommunities}
            onTogglePinCommunity={onTogglePinCommunity}
          />
        ) : (
          <>
            <TouchableOpacity
              key="circle-public"
              style={[sheetStyles.row, { borderColor: c.border, backgroundColor: selectedCircleId == null ? `${c.primary}18` : c.inputBackground }]}
              activeOpacity={0.85}
              onPress={() => onSelectCircle(null)}
            >
              <View style={[sheetStyles.avatar, { backgroundColor: c.primary }]}>
                <MaterialCommunityIcons name="earth" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[sheetStyles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>
                  {t('home.composerAudiencePublic', { defaultValue: 'Public' })}
                </Text>
                <Text style={[sheetStyles.rowSub, { color: c.textMuted }]} numberOfLines={1}>
                  {t('home.composerAudiencePublicSub', { defaultValue: 'Visible to everyone' })}
                </Text>
              </View>
              <MaterialCommunityIcons name={selectedCircleId == null ? 'check-circle' : 'circle-outline'} size={20} color={selectedCircleId == null ? c.primary : c.textMuted} />
            </TouchableOpacity>
            {circles.map((cc) => {
              const selected = selectedCircleId === cc.id;
              const circleColor = cc.color || c.primary;
              return (
                <TouchableOpacity
                  key={`circle-${cc.id}`}
                  style={[sheetStyles.row, { borderColor: c.border, backgroundColor: selected ? `${circleColor}22` : c.inputBackground }]}
                  activeOpacity={0.85}
                  onPress={() => onSelectCircle(cc.id)}
                >
                  <View style={[sheetStyles.avatar, { backgroundColor: circleColor, borderWidth: 1, borderColor: c.border }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[sheetStyles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>{cc.name}</Text>
                    <Text style={[sheetStyles.rowSub, { color: c.textMuted }]} numberOfLines={1}>
                      {t('home.composerCircleSub', { count: cc.users_count || 0, defaultValue: `${cc.users_count || 0} members` })}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name={selected ? 'check-circle' : 'circle-outline'} size={20} color={selected ? circleColor : c.textMuted} />
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>

      <View style={[sheetStyles.footer, { borderTopColor: c.border, backgroundColor: c.surface }]}>
        <Text style={[sheetStyles.rowSub, { color: c.textMuted, marginBottom: 8 }]} numberOfLines={1}>
          {audienceSummary}
        </Text>
        <TouchableOpacity
          style={[sheetStyles.doneBtn, { backgroundColor: canPost ? c.primary : c.border, opacity: canPost ? 1 : 0.7 }]}
          activeOpacity={0.85}
          onPress={() => void onPost()}
          disabled={!canPost || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={sheetStyles.doneBtnText}>
              {t('home.composerPostAction', { defaultValue: 'Post' })}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c: any) =>
  StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      // Was 12; tightened so the header sits closer to the status-bar
      // spacer above (which is `insets.top` tall and unavoidable). Saves
      // ~8 vertical px and gives the composer body that much more room
      // above the keyboard. Touch targets stay comfortable because the
      // close icon has its own 10px hitSlop.
      paddingVertical: 8,
      borderBottomWidth: 1,
    },
    headerTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerTitle: { fontSize: 16, fontWeight: '800', flexShrink: 1 },
    headerSavedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    headerSavedText: { fontSize: 11, fontWeight: '700' },
    postBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 999,
      minWidth: 70,
      alignItems: 'center',
    },
    postBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 12,
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
    },
    errorBannerText: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 18 },
    longTitle: {
      fontSize: 26,
      fontWeight: '900',
      paddingVertical: 8,
      borderBottomWidth: 1,
    },
    longActionsRow: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    longActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    longActionBtnText: { fontSize: 12, fontWeight: '700' },
    longMetaRow: { flexDirection: 'row', alignItems: 'center' },
    longMetaText: { fontSize: 12, fontWeight: '600' },
    longExpiryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    longExpiryChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    longExpiryChipText: { fontSize: 12, fontWeight: '800' },
    longTitleInput: {
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 18,
      fontWeight: '800',
    },

    previewRoot: { flex: 1 },
    previewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
    },
    previewTitle: { fontSize: 16, fontWeight: '800' },
    previewCloseBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },

    draftsRoot: { flex: 1 },
    draftsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
    },
    draftsTitle: { fontSize: 18, fontWeight: '900' },
    draftsEmptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 56, paddingHorizontal: 28 },
    draftsEmpty: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
    draftsEmptyHint: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
    draftCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
    draftCardTitle: { fontSize: 15, fontWeight: '800', lineHeight: 21 },
    draftCardSub: { fontSize: 12 },
    draftCardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
    draftCardBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      flex: 1, paddingVertical: 9, borderRadius: 10,
    },
    draftCardBtnSecondary: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1,
    },
    draftCardBtnText: { fontSize: 13, fontWeight: '800' },
    insertImageBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderRadius: 10,
      paddingVertical: 10,
    },
    insertImageBtnText: { fontSize: 13, fontWeight: '700' },
    modeRow: { flexDirection: 'row', borderBottomWidth: 1 },
    modeTab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2 },
    modeTabText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },

    input: {
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      lineHeight: 22,
      textAlignVertical: 'top',
    },
    metaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
    charCounter: { fontSize: 12, fontWeight: '700' },

    linkPreviewCard: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 10,
      marginTop: 14,
      borderWidth: 1,
      borderRadius: 12,
      padding: 10,
      position: 'relative',
    },
    linkPreviewLoadingText: { fontSize: 13, fontWeight: '600', flex: 1 },
    linkPreviewImageWrap: {
      width: 88,
      height: 88,
      borderRadius: 8,
      overflow: 'hidden',
      backgroundColor: '#0B0E13',
    },
    linkPreviewImage: { width: '100%', height: '100%' },
    linkPreviewPlay: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.32)',
    },
    linkPreviewBody: { flex: 1, justifyContent: 'center', gap: 2, paddingRight: 22 },
    linkPreviewSite: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    linkPreviewTitle: { fontSize: 14, fontWeight: '800', lineHeight: 18 },
    linkPreviewDesc: { fontSize: 12, lineHeight: 16 },
    linkPreviewClose: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    imageStrip: {
      marginTop: 14,
    },
    imageThumbWrap: {
      width: 132,
      height: 132,
      borderWidth: 1,
      borderRadius: 12,
      overflow: 'hidden',
    },
    imageThumb: { width: '100%', height: '100%' },
    imageRemove: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    imageRotate: {
      position: 'absolute',
      bottom: 6,
      right: 6,
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },

    publishCard: {
      marginTop: 18,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      gap: 10,
    },
    publishCardTitle: {
      fontSize: 13,
      fontWeight: '800',
    },
    publishOptions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    publishOption: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    publishOptionText: {
      fontSize: 13,
      fontWeight: '700',
    },
    publishHint: {
      fontSize: 12,
      lineHeight: 17,
    },
    publishAccountList: {
      gap: 8,
    },
    publishAccountRow: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 9,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    publishAccountName: {
      fontSize: 13,
      fontWeight: '700',
    },
    publishAccountSubtext: {
      fontSize: 12,
      marginTop: 2,
    },

    audienceRow: {
      marginTop: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    audienceLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
    audienceValue: { fontSize: 14, fontWeight: '700', marginTop: 2 },

    toolbar: {
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: 1,
    },
    toolbarBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
    },
    toolbarBtnText: { fontSize: 13, fontWeight: '700' },
  });

// ── Communities picker (search + select) ─────────────────────────────────
// Shared list-with-search used by both AudienceSheet (short post) and
// LongAudiencePage (long post) so the two surfaces stay in sync. Type ≥2
// chars to query the backend; clearing the input restores the joined
// shortlist that the parent prefetched.
type CommunitiesPickerListProps = {
  c: any;
  t: (key: string, options?: any) => string;
  joinedCommunities: SearchCommunityResult[];
  pinnedCommunities: SearchCommunityResult[];
  selectedCommunities: Set<string>;
  onToggleCommunity: (name: string) => void;
  onSearchCommunities: (query: string) => Promise<SearchCommunityResult[]>;
  onTogglePinCommunity: (community: SearchCommunityResult) => void;
};

function CommunitiesPickerList({
  c, t, joinedCommunities, pinnedCommunities, selectedCommunities,
  onToggleCommunity, onSearchCommunities, onTogglePinCommunity,
}: CommunitiesPickerListProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchCommunityResult[]>([]);
  const [searching, setSearching] = useState(false);
  const seqRef = useRef(0);
  // Parent recomputes `onSearchCommunities` (a fresh arrow each render).
  // Keep the latest in a ref so the search effect only re-runs on query
  // changes, not on every parent re-render.
  const searchFnRef = useRef(onSearchCommunities);
  searchFnRef.current = onSearchCommunities;

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++seqRef.current;
    setSearching(true);
    const handle = setTimeout(() => {
      searchFnRef.current(trimmed)
        .then((found) => {
          if (seq !== seqRef.current) return;
          setResults(Array.isArray(found) ? found : []);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setResults([]);
        })
        .finally(() => {
          if (seq === seqRef.current) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const showingSearch = query.trim().length >= 2;
  const pinnedNames = new Set(pinnedCommunities.map((p) => (p.name || '').trim()));

  const renderRow = (com: SearchCommunityResult) => {
    const name = (com.name || '').trim();
    const selected = name ? selectedCommunities.has(name) : false;
    const blocked = !selected && selectedCommunities.size >= MAX_COMMUNITIES;
    const pinned = name ? pinnedNames.has(name) : false;
    return (
      <TouchableOpacity
        key={`com-${com.id}-${name}`}
        style={[
          sheetStyles.row,
          { borderColor: c.border, backgroundColor: selected ? `${c.primary}18` : c.inputBackground, opacity: blocked ? 0.55 : 1 },
        ]}
        activeOpacity={0.85}
        onPress={() => { if (name && !blocked) onToggleCommunity(name); }}
      >
        <View style={[sheetStyles.avatar, { backgroundColor: com.color || c.primary }]}>
          {com.avatar ? (
            <Image source={{ uri: com.avatar }} style={sheetStyles.avatarImage} resizeMode="cover" />
          ) : (
            <Text style={sheetStyles.avatarLetter}>{(com.title?.[0] || com.name?.[0] || 'C').toUpperCase()}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[sheetStyles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>
            {com.title || name}
          </Text>
          <Text style={[sheetStyles.rowSub, { color: c.textMuted }]} numberOfLines={1}>{`c/${name}`}</Text>
        </View>
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); onTogglePinCommunity(com); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ paddingHorizontal: 6, paddingVertical: 4 }}
          accessibilityLabel={pinned
            ? t('home.composerUnpinCommunity', { defaultValue: 'Unpin community' })
            : t('home.composerPinCommunity', { defaultValue: 'Pin community' })}
        >
          <MaterialCommunityIcons
            name={pinned ? 'pin' : 'pin-outline'}
            size={18}
            color={pinned ? c.primary : c.textMuted}
          />
        </TouchableOpacity>
        <MaterialCommunityIcons
          name={selected ? 'check-circle' : 'circle-outline'}
          size={20}
          color={selected ? c.primary : c.textMuted}
        />
      </TouchableOpacity>
    );
  };

  // De-dupe the joined list against pinned so a community doesn't appear
  // in both sections when not searching.
  const joinedMinusPinned = joinedCommunities.filter((com) => !pinnedNames.has((com.name || '').trim()));

  return (
    <>
      <View style={[sheetStyles.searchRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={c.textMuted} />
        <TextInput
          style={[sheetStyles.searchInput, { color: c.textPrimary }]}
          placeholder={t('home.composerSearchCommunities', { defaultValue: 'Search communities…' })}
          placeholderTextColor={c.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <TouchableOpacity
            onPress={() => setQuery('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('home.composerSearchClear', { defaultValue: 'Clear search' })}
          >
            <MaterialCommunityIcons name="close-circle" size={16} color={c.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {showingSearch ? (
        searching ? (
          <ActivityIndicator color={c.primary} size="small" style={{ paddingVertical: 12 }} />
        ) : results.length === 0 ? (
          <Text style={[sheetStyles.empty, { color: c.textMuted }]}>
            {t('home.composerSearchCommunitiesNoResults', { defaultValue: 'No communities found.' })}
          </Text>
        ) : (
          <>{results.map(renderRow)}</>
        )
      ) : (
        <>
          {pinnedCommunities.length > 0 ? (
            <>
              <Text style={[sheetStyles.sectionHeader, { color: c.textMuted }]}>
                {t('home.composerPinnedCommunitiesHeader', { defaultValue: 'Pinned' })}
              </Text>
              {pinnedCommunities.map(renderRow)}
            </>
          ) : null}
          {joinedMinusPinned.length > 0 ? (
            <>
              <Text style={[sheetStyles.sectionHeader, { color: c.textMuted, marginTop: pinnedCommunities.length > 0 ? 6 : 0 }]}>
                {t('home.composerJoinedCommunitiesHeader', { defaultValue: 'Joined' })}
              </Text>
              {joinedMinusPinned.map(renderRow)}
            </>
          ) : pinnedCommunities.length === 0 ? (
            <Text style={[sheetStyles.empty, { color: c.textMuted }]}>
              {t('home.composerNoCommunities', { defaultValue: "You haven't joined any communities yet." })}
            </Text>
          ) : null}
        </>
      )}
    </>
  );
}

const sheetStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    height: '85%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  handle: { width: 44, height: 5, borderRadius: 999, alignSelf: 'center', marginTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 16, fontWeight: '800' },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderBottomWidth: 2,
    gap: 2,
  },
  tabLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  tabCounter: { fontSize: 11, fontWeight: '700', maxWidth: 140 },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginBottom: 8 },
  empty: { fontSize: 13, paddingVertical: 8 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 4 },
  sectionHeader: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImage: { width: 36, height: 36 },
  avatarLetter: { color: '#fff', fontWeight: '800', fontSize: 14 },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 12, marginTop: 2 },
  footer: { padding: 16, borderTopWidth: 1 },
  doneBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  doneBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
