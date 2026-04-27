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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  api,
  type CircleResult,
  type CreatePostPayload,
  type FeedPost,
  type SearchCommunityResult,
} from '../api/client';
import MentionHashtagInput from '../components/MentionHashtagInput';
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
const MAX_SHORT_LENGTH = 280;
const MAX_LONG_LENGTH = 10_000;
const MAX_IMAGES = 5;

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
  const [circles, setCircles] = useState<CircleResult[]>([]);
  const [selectedCommunities, setSelectedCommunities] = useState<Set<string>>(new Set());
  // Circle selection is single-choice — `null` represents the Public option
  // (no circle), matching web's `composerSelectedCircleId === null` model.
  const [selectedCircleId, setSelectedCircleId] = useState<number | null>(null);
  const [audienceOpen, setAudienceOpen] = useState(false);

  // Watch the body for URLs and fetch a preview after a short debounce.
  // Mirrors HomeScreen's composer logic so YouTube/Vimeo/article previews
  // appear before the user posts.
  useEffect(() => {
    const url = extractFirstUrlFromText(text);
    if (!url) {
      setLinkPreview(null);
      setLinkPreviewLoading(false);
      return;
    }
    if (dismissedPreviewUrl && url === dismissedPreviewUrl) {
      setLinkPreview(null);
      setLinkPreviewLoading(false);
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
  }, [text, dismissedPreviewUrl, linkPreview]);

  // Pre-load joined communities + circles so the audience sheet has
  // something to show as soon as the user taps it.
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try {
        const [communitiesRes, circlesRes] = await Promise.allSettled([
          api.getJoinedCommunities(token, 20, 0),
          api.getCircles(token),
        ]);
        if (!active) return;
        if (communitiesRes.status === 'fulfilled') {
          setCommunities(Array.isArray(communitiesRes.value) ? communitiesRes.value : []);
        }
        if (circlesRes.status === 'fulfilled') {
          setCircles(Array.isArray(circlesRes.value) ? circlesRes.value : []);
        }
      } catch {
        // non-fatal; audience sheet just shows empty states
      }
    })();
    return () => { active = false; };
  }, [token]);

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
        : (text.trim().length > 0 || imageUris.length > 0)
  );
  const remaining = maxLength - text.length;
  const overLimit = mode === 'long' ? false : remaining < 0;
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

  const pickImage = useCallback(async () => {
    if (submitting) return;
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
        onError(t('home.profileImagePickerPermissionDenied', { defaultValue: 'Photo access is needed to attach an image.' }));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: remainingImageSlots,
        allowsEditing: false,
        quality: 0.9,
      });
      if (result.canceled) return;
      const newUris = (result.assets || [])
        .map((a) => a?.uri)
        .filter((uri): uri is string => typeof uri === 'string' && !!uri);
      if (newUris.length === 0) return;
      setImageUris((prev) => {
        const merged = [...prev, ...newUris];
        // Hard-cap in case selectionLimit isn't honoured by the platform.
        return merged.slice(0, MAX_IMAGES);
      });
    } catch {
      onError(t('home.profileImagePickerFailed', { defaultValue: 'Could not open the photo library.' }));
    }
  }, [submitting, remainingImageSlots, onError, t]);

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
    if (!canPost || overLimit) return;
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

      // Bake any user-chosen rotation into the actual file before upload —
      // expo-image-manipulator returns a new file:// URI we can attach.
      const rotateIfNeeded = async (uri: string): Promise<string> => {
        const deg = rotations[uri] || 0;
        if (!deg) return uri;
        try {
          const out = await ImageManipulator.manipulateAsync(
            uri,
            [{ rotate: deg }],
            { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
          );
          return out.uri || uri;
        } catch {
          return uri;
        }
      };

      let finalized;
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
          finalized = await api.publishPost(token, longDraftUuid);
        } else {
          finalized = await api.createPost(token, {
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
          });
        }
      } else if (imageUris.length <= 1) {
        // Fast path — single (or no) image: createPost handles it directly.
        const single = imageUris[0];
        if (single) {
          const finalUri = await rotateIfNeeded(single);
          basePayload.image = { uri: finalUri, type: 'image/jpeg', name: 'post-image.jpg' } as any;
        }
        basePayload.text = trimmed;
        finalized = await api.createPost(token, basePayload);
      } else {
        // Multi-image short post — create as draft, attach each image, publish.
        const draft = await api.createPost(token, { ...basePayload, text: trimmed, is_draft: true });
        const draftUuid = (draft as any)?.uuid as string | undefined;
        if (!draftUuid) throw new Error('Draft post has no uuid');
        for (let i = 0; i < imageUris.length; i += 1) {
          const uri = imageUris[i];
          const finalUri = await rotateIfNeeded(uri);
          await api.addPostMedia(token, draftUuid, {
            file: { uri: finalUri, type: 'image/jpeg', name: `post-image-${i + 1}.jpg` } as any,
            order: i,
          });
        }
        finalized = await api.publishPost(token, draftUuid);
      }

      onNotice(t('home.composerPostedNotice', { defaultValue: 'Posted!' }));
      onPosted(finalized);
    } catch (e: any) {
      const msg = e?.message || t('home.composerPostError', { defaultValue: 'Could not publish post.' });
      setInlineError(msg);
      onError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [canPost, overLimit, text, mode, imageUris, rotations, selectedCircleId, selectedCommunities, longHtml, longPlain, longBlocks, longTitle, longDraftUuid, sharedPost, token, onPosted, onNotice, onError, t]);

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
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
          style={[s.postBtn, { backgroundColor: canPost && !overLimit ? c.primary : c.border, opacity: canPost && !overLimit ? 1 : 0.7 }]}
          activeOpacity={0.85}
          onPress={() => {
            if (mode === 'long') {
              setLongAudienceOpen(true);
            } else {
              void submit();
            }
          }}
          disabled={!canPost || overLimit}
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
            <MentionHashtagInput
              value={text}
              onChangeText={setText}
              token={token}
              placeholder={sharedPost
                ? t('home.repostComposerInputPlaceholder', { defaultValue: 'Add a comment… (optional)' })
                : t('home.composerShortPlaceholder', { defaultValue: "What's on your mind?" })}
              placeholderTextColor={c.textMuted}
              multiline
              numberOfLines={5}
              editable={!submitting}
              maxLength={maxLength}
              c={c}
              style={[s.input, {
                color: c.textPrimary,
                borderColor: c.inputBorder,
                backgroundColor: c.inputBackground,
                minHeight: 140,
              }]}
            />

            {sharedPost ? <SharedPostPreview post={sharedPost} c={c} /> : null}

            <View style={s.metaRow}>
              <Text style={[s.charCounter, { color: overLimit ? c.errorText : c.textMuted }]}>
                {remaining}
              </Text>
            </View>

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
      {mode === 'short' ? (
        <View style={[s.toolbar, { borderTopColor: c.border, backgroundColor: c.surface }]}>
          <TouchableOpacity
            style={[s.toolbarBtn, { backgroundColor: c.inputBackground }]}
            activeOpacity={0.85}
            onPress={() => void pickImage()}
            disabled={submitting}
          >
            <MaterialCommunityIcons name="image-multiple-outline" size={20} color={c.textSecondary} />
            <Text style={[s.toolbarBtnText, { color: c.textPrimary }]}>
              {imageUris.length === 0
                ? t('home.composerAddImages', {
                    count: MAX_IMAGES,
                    defaultValue: `Add images (up to ${MAX_IMAGES})`,
                  })
                : t('home.composerImagesCount', {
                    count: imageUris.length,
                    max: MAX_IMAGES,
                    defaultValue: `${imageUris.length}/${MAX_IMAGES} images`,
                  })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
        circles={circles}
        selectedCommunities={selectedCommunities}
        selectedCircleId={selectedCircleId}
        onToggleCommunity={toggleCommunity}
        onSelectCircle={selectCircle}
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
          circles={circles}
          selectedCommunities={selectedCommunities}
          selectedCircleId={selectedCircleId}
          onToggleCommunity={toggleCommunity}
          onSelectCircle={selectCircle}
          onBack={() => setLongAudienceOpen(false)}
          onPost={async () => {
            await submit();
            setLongAudienceOpen(false);
          }}
          submitting={submitting}
          canPost={canPost && !overLimit}
          audienceSummary={audienceSummary}
        />
      </Modal>
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
  circles: CircleResult[];
  selectedCommunities: Set<string>;
  selectedCircleId: number | null;
  onToggleCommunity: (name: string) => void;
  onSelectCircle: (id: number | null) => void;
};

type AudienceTab = 'communities' | 'circles';

function AudienceSheet({
  visible,
  onClose,
  c,
  t,
  communities,
  circles,
  selectedCommunities,
  selectedCircleId,
  onToggleCommunity,
  onSelectCircle,
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

          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            {tab === 'communities' ? (
              communities.length === 0 ? (
                <Text style={[sheetStyles.empty, { color: c.textMuted }]}>
                  {t('home.composerNoCommunities', { defaultValue: "You haven't joined any communities yet." })}
                </Text>
              ) : (
                communities.map((com) => {
                  const name = (com.name || '').trim();
                  const selected = name ? selectedCommunities.has(name) : false;
                  const blocked = !selected && selectedCommunities.size >= MAX_COMMUNITIES;
                  return (
                    <TouchableOpacity
                      key={`com-${com.id}`}
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
                      <MaterialCommunityIcons
                        name={selected ? 'check-circle' : 'circle-outline'}
                        size={20}
                        color={selected ? c.primary : c.textMuted}
                      />
                    </TouchableOpacity>
                  );
                })
              )
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
                        <View style={[sheetStyles.colorDot, { backgroundColor: circle.color || c.primary }]} />
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
  circles: CircleResult[];
  selectedCommunities: Set<string>;
  selectedCircleId: number | null;
  onToggleCommunity: (name: string) => void;
  onSelectCircle: (id: number | null) => void;
  onBack: () => void;
  onPost: () => Promise<void> | void;
  submitting: boolean;
  canPost: boolean;
  audienceSummary: string;
};

function LongAudiencePage({
  c, t, insetsTop, communities, circles, selectedCommunities, selectedCircleId,
  onToggleCommunity, onSelectCircle, onBack, onPost, submitting, canPost, audienceSummary,
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

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        {tab === 'communities' ? (
          communities.length === 0 ? (
            <Text style={[sheetStyles.empty, { color: c.textMuted }]}>
              {t('home.composerNoCommunities', { defaultValue: "You haven't joined any communities yet." })}
            </Text>
          ) : (
            communities.map((com) => {
              const name = (com.name || '').trim();
              const selected = name ? selectedCommunities.has(name) : false;
              const blocked = !selected && selectedCommunities.size >= MAX_COMMUNITIES;
              return (
                <TouchableOpacity
                  key={`com-${com.id}`}
                  style={[sheetStyles.row, { borderColor: c.border, backgroundColor: selected ? `${c.primary}18` : c.inputBackground, opacity: blocked ? 0.55 : 1 }]}
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
                    <Text style={[sheetStyles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>{com.title || name}</Text>
                    <Text style={[sheetStyles.rowSub, { color: c.textMuted }]} numberOfLines={1}>{`c/${name}`}</Text>
                  </View>
                  <MaterialCommunityIcons name={selected ? 'check-circle' : 'circle-outline'} size={20} color={selected ? c.primary : c.textMuted} />
                </TouchableOpacity>
              );
            })
          )
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
                  <View style={[sheetStyles.avatar, { backgroundColor: circleColor }]} />
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
      paddingVertical: 12,
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
