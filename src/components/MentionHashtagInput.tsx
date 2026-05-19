/**
 * MentionHashtagInput
 *
 * Drop-in TextInput with @mention / #hashtag autocomplete.
 *
 * WEB  — ReactDOM.createPortal + position:fixed div so the popup floats above
 *         everything. mousedown on the popup calls preventDefault so the
 *         TextInput never loses focus mid-typing.
 *         Caret position is computed with the "mirror-div" technique:
 *         a hidden div is positioned at exactly the same viewport location as
 *         the real textarea, filled with identical text, and a zero-width span
 *         marks the caret — its getBoundingClientRect() gives the exact screen
 *         coordinates of the cursor without any async lag.
 *
 * NATIVE — transparent Modal (standard approach; no focus issues on iOS/Android).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { api, SearchHashtagResult, SearchUserResult } from '../api/client';
import { useMentionPopup } from './MentionPopupProvider';

// ─── conditional react-dom imports (web only, tree-shaken on native) ─────────
let _createPortal: ((node: React.ReactNode, container: Element) => React.ReactPortal) | null = null;
let _findDOMNode: ((instance: any) => Element | null | Text) | null = null;
if (Platform.OS === 'web') {
  try {
    const rd = require('react-dom');
    _createPortal = rd.createPortal;
    _findDOMNode  = rd.findDOMNode;
  } catch {}
}

// ─── types ───────────────────────────────────────────────────────────────────

type UserSuggestion    = { kind: 'user';    id: number; username: string; displayName?: string; avatar?: string };
type HashtagSuggestion = { kind: 'hashtag'; id: number; name: string;    postsCount?: number };
type Suggestion = UserSuggestion | HashtagSuggestion;

type ActiveTrigger = { trigger: '@' | '#'; query: string; startIndex: number };

type PopupPos = {
  /** Popup anchor X in viewport coordinates */
  x: number;
  /** Popup anchor Y in viewport coordinates (bottom edge of the caret line) */
  y: number;
  /** Available space above the anchor (for flip-up logic) */
  spaceAbove: number;
  /** Width of the input the popup is anchored to (used to center the
   *  popup under wide inputs on tablets, where the native code path can't
   *  measure the caret's X within the input). */
  inputWidth: number;
};

export type MentionHashtagInputProps = {
  value?: string;
  onChangeText: (value: string) => void;
  token?: string;
  style?: any;
  placeholder?: string;
  placeholderTextColor?: string;
  multiline?: boolean;
  numberOfLines?: number;
  returnKeyType?: 'done' | 'send' | 'go' | 'next' | 'search';
  blurOnSubmit?: boolean;
  onSubmitEditing?: () => void;
  editable?: boolean;
  textAlignVertical?: 'auto' | 'top' | 'bottom' | 'center';
  maxLength?: number;
  autoFocus?: boolean;
  /** Kept for API compat — placement is now auto-detected */
  suggestionListAbove?: boolean;
  c?: any;
  /** Web only: invoked when the user pastes one or more images directly
   *  into the input. The default DOM paste is preventDefault'd so the
   *  binary blob doesn't get stringified into the text. No-op on native. */
  onWebPasteImages?: (files: File[]) => void;
};

// ─── constants ────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 280;
const MAX_SUGGEST = 6;
const POPUP_W     = 240;
const LIST_MAX_H  = 240;
const GAP         = 6;

// ─── helpers ─────────────────────────────────────────────────────────────────

function detectTrigger(text: string, pos: number): ActiveTrigger | null {
  const before = text.slice(0, pos);
  // Mentions allow `.` (matches server `username_characters_validator`);
  // hashtags allow alphanumerics + `_` only (server `\w+` excludes `.`).
  const m = /(?:^|[\s\n])(@[A-Za-z0-9_.]*|#[A-Za-z0-9_]*)$/.exec(before);
  if (!m) return null;
  const trigger = m[1].charAt(0) as '@' | '#';
  const query = m[1].slice(1);
  const spaceLen = m[0].length - m[1].length;
  return { trigger, query, startIndex: m.index + spaceLen };
}

function applyInsertion(text: string, start: number, cursor: number, rep: string): string {
  return text.slice(0, start) + rep + ' ' + text.slice(cursor);
}

/**
 * Resolve the caret index after a text change by diffing old → new from
 * both ends. The caret sits at the end of the changed region.
 *
 * Used as the native caret source: on native `onChangeText` fires BEFORE
 * `onSelectionChange`, so the selection ref is one keystroke stale inside
 * the change handler. Diffing is robust for keystrokes, paste, delete and
 * replace-selection, and — unlike the old `text.length` guess — works when
 * the edit happens in the MIDDLE of the post (the case that broke trigger
 * detection on complex posts that already contain #tags / links).
 */
function caretFromDiff(prev: string, next: string): number {
  const max = Math.min(prev.length, next.length);
  let start = 0;
  while (start < max && prev[start] === next[start]) start++;
  let end = 0;
  while (end < max - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++;
  return next.length - end;
}

/**
 * Mirror-div technique — positions a hidden div at the EXACT same viewport
 * location as the textarea and measures the span at `caretIndex`.
 * Returns viewport (x, y) of the caret, where y is the BOTTOM of the line.
 */
function getCaretViewportPos(
  el: HTMLTextAreaElement | HTMLInputElement,
  caretIndex: number,
): { x: number; y: number; lineH: number } | null {
  try {
    const elRect   = el.getBoundingClientRect();
    const computed = window.getComputedStyle(el);

    const div = document.createElement('div');

    // Overlay the mirror div at exactly the textarea's viewport position
    div.style.position     = 'fixed';
    div.style.top          = elRect.top  + 'px';
    div.style.left         = elRect.left + 'px';
    div.style.width        = elRect.width  + 'px';
    div.style.height       = elRect.height + 'px';
    div.style.overflow     = 'hidden';
    div.style.visibility   = 'hidden';
    div.style.pointerEvents = 'none';
    div.style.whiteSpace   = 'pre-wrap';
    div.style.wordBreak    = 'break-word';
    // Shift content up by scrollTop so visible text aligns with textarea
    div.style.marginTop    = -el.scrollTop + 'px';

    // Copy typographic properties so line-wrapping is identical
    const copyProps = [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
      'letterSpacing', 'lineHeight',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'boxSizing', 'textIndent',
    ];
    for (const p of copyProps) {
      (div.style as any)[p] = (computed as any)[p];
    }

    // Text before the caret
    div.textContent = el.value.slice(0, caretIndex);

    // Zero-width span marks the caret position
    const span = document.createElement('span');
    span.textContent = '\u200b';
    div.appendChild(span);

    document.body.appendChild(div);
    const r = span.getBoundingClientRect();
    document.body.removeChild(div);

    return { x: r.left, y: r.bottom, lineH: r.height };
  } catch {
    return null;
  }
}

/**
 * Find the actual textarea/input DOM element for a MentionHashtagInput.
 *
 * Strategy 1 (most reliable): `document.getElementById(inputId)` — the TextInput
 *   is given a unique `id` prop so it can always be found directly, even when
 *   rendered inside a React Native Modal (which uses its own internal React portal
 *   that can break findDOMNode traversal).
 *
 * Strategy 2: direct ref access — works when RN Web forwards the ref to the
 *   raw DOM element.
 *
 * Strategy 3: findDOMNode — legacy fallback for older RN Web versions.
 *
 * Strategy 4: querySelector inside container — last resort.
 */
function getInputDOMEl(
  inputId: string,
  inputRef: React.RefObject<any>,
  containerRef: React.RefObject<View | null>,
): HTMLTextAreaElement | HTMLInputElement | null {
  try {
    // Strategy 1: direct DOM lookup by id — immune to portal/Modal boundaries
    if (typeof document !== 'undefined' && inputId) {
      const el = document.getElementById(inputId);
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
        return el as HTMLTextAreaElement;
      }
    }
    // Strategy 2: inputRef directly (RN Web forwards ref to DOM element)
    const direct = inputRef.current;
    if (direct && typeof direct.getBoundingClientRect === 'function') {
      return direct as HTMLTextAreaElement;
    }
    // Strategy 3: findDOMNode on the input ref
    if (_findDOMNode && direct) {
      const node = _findDOMNode(direct) as HTMLElement | null;
      if (node && (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT')) {
        return node as HTMLTextAreaElement;
      }
      if (node) {
        const inner = node.querySelector?.('textarea, input');
        if (inner) return inner as HTMLTextAreaElement;
      }
    }
    // Strategy 4: search within container
    if (_findDOMNode && containerRef.current) {
      const container = _findDOMNode(containerRef.current) as HTMLElement | null;
      const inner = container?.querySelector?.('textarea, input');
      if (inner) return inner as HTMLTextAreaElement;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── component ────────────────────────────────────────────────────────────────

export default function MentionHashtagInput({
  value,
  onChangeText,
  token,
  style,
  placeholder,
  placeholderTextColor,
  multiline = false,
  numberOfLines,
  returnKeyType,
  blurOnSubmit,
  onSubmitEditing,
  editable,
  textAlignVertical,
  maxLength,
  autoFocus,
  c,
  onWebPasteImages,
}: MentionHashtagInputProps) {
  const { height: screenH, width: screenW } = useWindowDimensions();
  const mentionPopup = useMentionPopup();

  // Allow the input to be used uncontrolled (no `value` prop) so callers
  // that manage text via refs don't crash. When controlled, `value` wins;
  // when uncontrolled, we shadow the current text internally.
  const isControlled = typeof value === 'string';
  const [uncontrolledText, setUncontrolledText] = useState('');
  const currentText = isControlled ? (value as string) : uncontrolledText;

  const [suggestions,    setSuggestions]    = useState<Suggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [activeTrigger,  setActiveTrigger]  = useState<ActiveTrigger | null>(null);
  const [popupPos,       setPopupPos]       = useState<PopupPos | null>(null);
  const [portalEl,       setPortalEl]       = useState<HTMLDivElement | null>(null);
  // Track the on-screen keyboard so the open-above / open-below decision
  // accounts for the area the keyboard occludes. Without this, the popup
  // computes spaceBelow against the full screen height and happily renders
  // below the input — straight behind the keyboard, invisible to the user.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKeyboardHeight(e?.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ─── web paste-image listener ───────────────────────────────────────────
  // Attach a `paste` listener directly to the underlying <textarea>/<input>
  // so the user can Cmd/Ctrl+V an image (or screenshot) into a composer and
  // have it attached just like they'd picked it from the file picker.
  // Scoped to the input element — global document-level listeners would
  // fight with other paste targets on the page.
  useEffect(() => {
    if (Platform.OS !== 'web' || !onWebPasteImages) return undefined;
    let raf = 0;
    let domEl: HTMLTextAreaElement | HTMLInputElement | null = null;
    const handler = (event: Event) => {
      const ce = event as ClipboardEvent;
      const items = ce.clipboardData?.items;
      if (!items || items.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length === 0) return;
      ce.preventDefault();
      onWebPasteImages(files);
    };
    // The DOM element isn't available on the first render; retry on the
    // next frame until it appears (typically 1 frame).
    const attach = () => {
      domEl = getInputDOMEl(inputIdRef.current, textInputRef, containerRef);
      if (domEl) {
        domEl.addEventListener('paste', handler as EventListener);
      } else {
        raf = requestAnimationFrame(attach);
      }
    };
    attach();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (domEl) domEl.removeEventListener('paste', handler as EventListener);
    };
  }, [onWebPasteImages]);

  const containerRef   = useRef<View>(null);
  const textInputRef   = useRef<any>(null);
  const cursorRef      = useRef<number>(currentText.length);
  // Stable unique id so we can always find the underlying <textarea>/<input>
  // via document.getElementById — works even inside React Native Web Modals
  // where findDOMNode cannot traverse the portal boundary.
  const inputIdRef     = useRef<string>(`mhi-${Math.random().toString(36).slice(2, 10)}`);
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef<string>('');

  // ─── colours ────────────────────────────────────────────────────────────

  const textColor   = c?.textPrimary    ?? '#111827';
  const bgColor     = c?.inputBackground ?? '#fff';
  const borderColor = c?.border         ?? '#e5e7eb';
  const mutedColor  = c?.textMuted      ?? '#6b7280';
  const primary     = c?.primary        ?? '#6366F1';
  const surface     = c?.surface        ?? '#ffffff';

  // ─── web portal setup ───────────────────────────────────────────────────

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const div = document.createElement('div');

    // Position the portal container at the top-left of the viewport with a
    // z-index high enough to float above React Native Web's Modal overlay
    // (which typically uses z-index ~9999).  width/height = 0 with
    // overflow:visible means the div itself has no hit-area, so it never
    // blocks clicks on the LongPostDrawer or anything else underneath.
    div.style.position = 'fixed';
    div.style.top      = '0';
    div.style.left     = '0';
    div.style.width    = '0';
    div.style.height   = '0';
    div.style.overflow = 'visible';
    div.style.zIndex   = '2147483647'; // INT_MAX — always on top

    document.body.appendChild(div);
    setPortalEl(div);

    // Prevent mousedown inside the popup from stealing focus from the TextInput
    const stop = (e: MouseEvent) => e.preventDefault();
    div.addEventListener('mousedown', stop);

    return () => {
      div.removeEventListener('mousedown', stop);
      if (div.parentNode) div.parentNode.removeChild(div);
    };
  }, []);

  // ─── autocomplete ───────────────────────────────────────────────────────

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setSuggestLoading(false);
    setActiveTrigger(null);
    setPopupPos(null);
    latestQueryRef.current = '';
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const fetchSuggestions = useCallback(
    (trigger: '@' | '#', query: string) => {
      if (!token) return;
      latestQueryRef.current = query;
      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(async () => {
        const expected = latestQueryRef.current;
        setSuggestLoading(true);
        try {
          if (trigger === '@') {
            const users: SearchUserResult[] = await api.searchUsers(token, query, MAX_SUGGEST);
            if (latestQueryRef.current !== expected) return;
            setSuggestions(users.map(u => ({
              kind: 'user', id: u.id,
              username: u.username ?? '',
              displayName: u.profile?.name,
              avatar: u.profile?.avatar,
            })));
          } else {
            const tags: SearchHashtagResult[] = await api.searchHashtags(token, query, MAX_SUGGEST);
            if (latestQueryRef.current !== expected) return;
            setSuggestions(tags.map(h => ({
              kind: 'hashtag', id: h.id,
              name: h.name ?? '',
              postsCount: h.posts_count,
            })));
          }
        } catch {
          if (latestQueryRef.current === expected) setSuggestions([]);
        } finally {
          if (latestQueryRef.current === expected) setSuggestLoading(false);
        }
      }, DEBOUNCE_MS);
    },
    [token],
  );

  // ─── position computation ────────────────────────────────────────────────

  function computePosition(text: string, caretPos: number) {
    if (Platform.OS === 'web') {
      const domEl = getInputDOMEl(inputIdRef.current, textInputRef, containerRef);
      if (!domEl) return;

      const inputRect = domEl.getBoundingClientRect();
      const caret = getCaretViewportPos(domEl, caretPos);
      if (caret) {
        setPopupPos({ x: caret.x, y: caret.y, spaceAbove: caret.y, inputWidth: inputRect.width });
      } else {
        // Fallback: position below the input
        setPopupPos({ x: inputRect.left + 8, y: inputRect.bottom, spaceAbove: inputRect.top, inputWidth: inputRect.width });
      }
    } else {
      containerRef.current?.measure((_fx, _fy, w, h, px, py) => {
        setPopupPos({ x: px, y: py + h, spaceAbove: py, inputWidth: w });
      });
    }
  }

  // ─── follow-the-input loop (native) ──────────────────────────────────────
  // While the popup is active, re-measure the input every animation frame so
  // the popup tracks scrolling / keyboard movement instead of floating in a
  // stale screen position. setState bails early when the position hasn't
  // changed (Object.is on the returned ref), so steady frames don't trigger
  // re-renders.
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    if (!suggestions.length && !suggestLoading && !activeTrigger) return undefined;
    if (!containerRef.current) return undefined;
    let cancelled = false;
    let rafId: number | null = null;
    const tick = () => {
      if (cancelled || !containerRef.current) return;
      containerRef.current.measureInWindow((x, y, w, h) => {
        if (cancelled) return;
        setPopupPos((prev) => {
          if (
            prev
            && Math.abs(prev.x - x) < 0.5
            && Math.abs(prev.y - (y + h)) < 0.5
            && Math.abs(prev.inputWidth - w) < 0.5
          ) return prev;
          return { x, y: y + h, spaceAbove: y, inputWidth: w };
        });
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [suggestions.length, suggestLoading, activeTrigger]);

  // ─── follow-the-input loop (web) ─────────────────────────────────────────
  // computePosition()'s mirror-div measurement is a one-shot snapshot. When
  // layout shifts while the popup is open — a link-preview card loading
  // below, media thumbnails appearing, the ScrollView scrolling — the input
  // moves but the cached popupPos doesn't, so the popup detaches from the
  // caret. Re-measure each frame against the live caret. setPopupPos bails
  // when unchanged, so steady frames don't trigger re-renders.
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    if (!suggestions.length && !suggestLoading && !activeTrigger) return undefined;
    let cancelled = false;
    let rafId: number | null = null;
    const tick = () => {
      if (cancelled) return;
      const domEl = getInputDOMEl(inputIdRef.current, textInputRef, containerRef);
      if (domEl) {
        const caretIdx = typeof domEl.selectionStart === 'number'
          ? domEl.selectionStart
          : cursorRef.current;
        const caret = getCaretViewportPos(domEl, caretIdx);
        if (caret) {
          const inputW = domEl.getBoundingClientRect().width;
          setPopupPos((prev) => {
            if (
              prev
              && Math.abs(prev.x - caret.x) < 0.5
              && Math.abs(prev.y - caret.y) < 0.5
              && Math.abs(prev.inputWidth - inputW) < 0.5
            ) {
              return prev;
            }
            return { x: caret.x, y: caret.y, spaceAbove: caret.y, inputWidth: inputW };
          });
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [suggestions.length, suggestLoading, activeTrigger]);

  // ─── text / cursor handlers ──────────────────────────────────────────────

  function handleChangeText(text: string) {
    onChangeText(text);
    if (!isControlled) setUncontrolledText(text);
    if (!token) return;

    // Resolve the TRUE caret position. On web the <textarea>'s selectionStart
    // is already updated by the time onChange fires; on native it isn't
    // (onSelectionChange fires after onChangeText), so diff old → new text.
    // The previous code guessed "caret = end of text whenever it grew", which
    // made detectTrigger scan the end of the post — so editing mid-text in a
    // complex post either missed the @/# entirely or latched onto a trailing
    // #tag / link fragment.
    let pos: number;
    const domEl = Platform.OS === 'web'
      ? getInputDOMEl(inputIdRef.current, textInputRef, containerRef)
      : null;
    if (domEl && typeof domEl.selectionStart === 'number') {
      pos = domEl.selectionStart;
    } else {
      pos = caretFromDiff(currentText, text);
    }
    cursorRef.current = pos;

    const trig = detectTrigger(text, pos);
    if (!trig) { clearSuggestions(); return; }

    setActiveTrigger(trig);

    if (trig.query.length === 0) {
      setSuggestions([]);
      setSuggestLoading(false);
      computePosition(text, pos);
      return;
    }

    computePosition(text, pos);
    fetchSuggestions(trig.trigger, trig.query);
  }

  function handleSelectionChange(e: any) {
    const sel = e?.nativeEvent?.selection;
    if (sel && typeof sel.start === 'number') cursorRef.current = sel.start;
  }

  // ─── selection ───────────────────────────────────────────────────────────

  function selectSuggestion(s: Suggestion) {
    if (!activeTrigger) return;
    const rep = s.kind === 'user' ? `@${s.username}` : `#${s.name}`;
    // Clamp against the current text — guards the edge case where the parent
    // reset `value` out from under us and left the refs/trigger stale.
    const start = Math.min(activeTrigger.startIndex, currentText.length);
    const cursor = Math.min(Math.max(cursorRef.current, start), currentText.length);
    const next = applyInsertion(currentText, start, cursor, rep);
    onChangeText(next);
    if (!isControlled) setUncontrolledText(next);
    clearSuggestions();
  }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // ─── popup geometry ──────────────────────────────────────────────────────

  const hasSuggestions = suggestions.length > 0 || suggestLoading;
  const showPopup      = hasSuggestions && !!popupPos;

  // Subtract the on-screen keyboard from the visible space below the input.
  // Without this, on native the popup would happily anchor below the input
  // and render straight behind the keyboard, invisible to the user.
  const visibleBottom = Platform.OS === 'web' ? screenH : screenH - keyboardHeight;
  const spaceBelow = popupPos ? Math.max(0, visibleBottom - popupPos.y) : 0;
  const openAbove  = !!popupPos && spaceBelow < LIST_MAX_H + GAP && popupPos.spaceAbove > spaceBelow;

  // Tablet / wide-screen popup sizing. The 240px default is right for phone
  // inputs but looks pinched on iPad — and on the native path, where the
  // popup anchors to the input's LEFT edge (caret pixel position isn't
  // exposed by RN's TextInput), a 240px popup on a 700+ px wide input
  // floats far from where the user is actually typing. Widen on tablets,
  // and center the popup horizontally under the input on the native path
  // so it feels associated with the field instead of pinned to a corner.
  const isWideScreen = screenW >= 700;
  const popupW = isWideScreen ? 320 : POPUP_W;

  const desiredLeft = popupPos
    ? (Platform.OS !== 'web' && isWideScreen
        ? popupPos.x + Math.max(0, (popupPos.inputWidth - popupW) / 2)
        : popupPos.x)
    : 0;
  const popupLeft = popupPos
    ? Math.max(4, Math.min(desiredLeft, screenW - popupW - 4))
    : 0;

  // "below" anchor: top of popup = bottom-of-caret + gap (viewport pixels)
  const popupTop    = !openAbove && popupPos ? popupPos.y + GAP : undefined;

  // "above" anchor (native) — uses `bottom` measured from screen bottom
  const popupBottom = openAbove && popupPos ? screenH - popupPos.spaceAbove + GAP : undefined;

  // "above" anchor (web) — the portal container is position:fixed at top:0/height:0,
  // so `bottom` is meaningless there; convert to a `top` value instead.
  // We want the popup's bottom edge at (spaceAbove − GAP) from viewport top,
  // so top = spaceAbove − GAP − LIST_MAX_H (clamped ≥ 4).
  const popupTopAbove = openAbove && popupPos
    ? Math.max(4, popupPos.spaceAbove - GAP - LIST_MAX_H)
    : undefined;

  // ─── suggestion rows (shared between web & native) ───────────────────────

  const suggestionRows = (
    <>
      {suggestLoading && suggestions.length === 0 ? (
        <View style={{ paddingVertical: 14, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={primary} />
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="always" bounces={false}>
          {suggestions.map((s, idx) => (
            <TouchableOpacity
              key={`${s.kind}-${s.id}-${idx}`}
              onPress={() => selectSuggestion(s)}
              activeOpacity={0.75}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 9,
                paddingHorizontal: 12,
                borderBottomWidth: idx < suggestions.length - 1 ? 1 : 0,
                borderBottomColor: borderColor,
              }}
            >
              {s.kind === 'user' ? (
                <>
                  {s.avatar ? (
                    <Image source={{ uri: s.avatar }}
                      style={{ width: 28, height: 28, borderRadius: 14, marginRight: 8 }} />
                  ) : (
                    <View style={{
                      width: 28, height: 28, borderRadius: 14, marginRight: 8,
                      backgroundColor: primary, alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                        {(s.username?.[0] ?? '?').toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {s.displayName ? (
                      <Text style={{ fontSize: 13, fontWeight: '600', color: textColor, lineHeight: 18 }}
                        numberOfLines={1}>{s.displayName}</Text>
                    ) : null}
                    <Text style={{ fontSize: 12, color: mutedColor, lineHeight: 16 }}
                      numberOfLines={1}>@{s.username}</Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={{
                    width: 28, height: 28, borderRadius: 14, marginRight: 8,
                    backgroundColor: primary + '18', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ color: primary, fontWeight: '800', fontSize: 14 }}>#</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: textColor, lineHeight: 18 }}
                      numberOfLines={1}>#{s.name}</Text>
                    {s.postsCount != null && s.postsCount > 0 ? (
                      <Text style={{ fontSize: 11, color: mutedColor, lineHeight: 15 }}>
                        {s.postsCount.toLocaleString()} posts
                      </Text>
                    ) : null}
                  </View>
                </>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </>
  );

  const panelStyle: any = {
    width: popupW,
    maxHeight: LIST_MAX_H,
    backgroundColor: surface,
    borderWidth: 1,
    borderColor,
    borderRadius: 10,
    overflow: 'hidden',
  };

  // ─── render ───────────────────────────────────────────────────────────────

  // Pull layout-only properties out of `style` so the wrapper View takes the
  // same dimensions/flex as callers expect.  Appearance props (border, color,
  // background, padding…) stay on the TextInput only, avoiding double borders.
  const containerLayoutStyle = useMemo(() => {
    const flat: any = StyleSheet.flatten(style) ?? {};
    const LAYOUT_KEYS = [
      'flex', 'flexGrow', 'flexShrink', 'flexBasis',
      'alignSelf', 'alignItems', 'justifyContent',
      'width', 'minWidth', 'maxWidth',
      'height', 'minHeight', 'maxHeight',
      'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'marginHorizontal', 'marginVertical',
    ];
    const out: any = {};
    for (const k of LAYOUT_KEYS) {
      if (flat[k] !== undefined) out[k] = flat[k];
    }
    return out;
  }, [style]);

  return (
    <View ref={containerRef} collapsable={false} style={containerLayoutStyle}>
      <TextInput
        ref={textInputRef}
        // nativeID renders as the DOM `id` attribute on RN Web, giving us a
        // reliable document.getElementById hook that works across Modal portals.
        nativeID={inputIdRef.current}
        style={[{ color: textColor, backgroundColor: bgColor }, style]}
        {...(isControlled ? { value: value as string } : { defaultValue: '' })}
        onChangeText={handleChangeText}
        onSelectionChange={handleSelectionChange}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor ?? mutedColor}
        multiline={multiline}
        numberOfLines={numberOfLines}
        returnKeyType={returnKeyType}
        blurOnSubmit={blurOnSubmit}
        onSubmitEditing={onSubmitEditing}
        editable={editable}
        textAlignVertical={textAlignVertical}
        maxLength={maxLength}
        autoFocus={autoFocus}
      />

      {/* WEB — portal-based fixed overlay; mousedown preventDefault keeps focus */}
      {Platform.OS === 'web' && showPopup && portalEl && _createPortal
        ? _createPortal(
            <View
              style={[
                panelStyle,
                {
                  position: 'absolute' as any,
                  left: popupLeft,
                  // Portal container is position:fixed at top:0/height:0.
                  // Open-below: anchor top edge just below the caret.
                  // Open-above: anchor bottom edge just above the caret using
                  //   CSS translateY(-100%) so the popup hugs the cursor
                  //   regardless of how many results are shown.
                  top: openAbove
                    ? (popupPos ? popupPos.spaceAbove - GAP : 0)
                    : (popupTop ?? 0),
                  ...({ boxShadow: '0 4px 16px rgba(0,0,0,0.13)' } as any),
                  ...({ transform: openAbove ? 'translateY(-100%)' : undefined } as any),
                  zIndex: 99999,
                },
              ]}
            >
              {suggestionRows}
            </View>,
            portalEl,
          )
        : null}

      {/* NATIVE — popup is rendered via MentionPopupProvider (the inline
       *  Modal we used to render here silently failed to paint inside
       *  react-navigation's native stack and inside PostDetailModal). The
       *  effect below pushes the popup node into the provider's overlay
       *  whenever this input has an active popup. */}
      <NativePopupBridge
        active={Platform.OS !== 'web' && showPopup}
        setNode={mentionPopup.setNode}
        clear={clearSuggestions}
        node={
          <Pressable style={{ flex: 1 }} onPress={clearSuggestions} pointerEvents="box-none">
            <View
              style={[
                panelStyle,
                {
                  position: 'absolute',
                  left: popupLeft,
                  ...(popupTop    !== undefined ? { top: popupTop }       : {}),
                  ...(popupBottom !== undefined ? { bottom: popupBottom } : {}),
                  elevation: 8,
                },
              ]}
            >
              {suggestionRows}
            </View>
          </Pressable>
        }
      />
    </View>
  );
}

/**
 * Tiny helper that bridges the popup node into the global provider via
 * useEffect, so we don't push from inside MentionHashtagInput's render
 * path. Clears on unmount/blur so dismissing the input also dismisses
 * the popup.
 */
function NativePopupBridge({
  active,
  node,
  setNode,
  clear,
}: {
  active: boolean;
  node: React.ReactNode;
  setNode: (n: React.ReactNode | null) => void;
  clear: () => void;
}) {
  useEffect(() => {
    if (!active) {
      setNode(null);
      return undefined;
    }
    setNode(node);
    return () => setNode(null);
  }, [active, node, setNode]);

  // Cleanup on unmount.
  useEffect(() => () => { setNode(null); clear(); }, [setNode, clear]);
  return null;
}
