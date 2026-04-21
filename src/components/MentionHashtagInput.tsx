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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { api, SearchHashtagResult, SearchUserResult } from '../api/client';

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
};

export type MentionHashtagInputProps = {
  value: string;
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
  /** Kept for API compat — placement is now auto-detected */
  suggestionListAbove?: boolean;
  c?: any;
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
  const m = /(?:^|[\s\n])([@#])([A-Za-z0-9_]*)$/.exec(before);
  if (!m) return null;
  const spaceLen = m[0].length - m[1].length - m[2].length;
  return { trigger: m[1] as '@' | '#', query: m[2], startIndex: m.index + spaceLen };
}

function applyInsertion(text: string, start: number, cursor: number, rep: string): string {
  return text.slice(0, start) + rep + ' ' + text.slice(cursor);
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
 * Find the actual textarea/input DOM element from a React Native Web ref.
 * RN Web may wrap the element; findDOMNode + querySelector handles both cases.
 */
function getInputDOMEl(
  inputRef: React.RefObject<any>,
  containerRef: React.RefObject<View>,
): HTMLTextAreaElement | HTMLInputElement | null {
  try {
    // First try: inputRef directly (RN Web forwards ref to DOM element)
    const direct = inputRef.current;
    if (direct && typeof direct.getBoundingClientRect === 'function') {
      return direct as HTMLTextAreaElement;
    }
    // Second try: findDOMNode on the input ref
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
    // Third try: search within container
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
  c,
}: MentionHashtagInputProps) {
  const { height: screenH, width: screenW } = useWindowDimensions();

  const [suggestions,    setSuggestions]    = useState<Suggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [activeTrigger,  setActiveTrigger]  = useState<ActiveTrigger | null>(null);
  const [popupPos,       setPopupPos]       = useState<PopupPos | null>(null);
  const [portalEl,       setPortalEl]       = useState<HTMLDivElement | null>(null);

  const containerRef   = useRef<View>(null);
  const textInputRef   = useRef<any>(null);
  const cursorRef      = useRef<number>(value.length);
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
      const domEl = getInputDOMEl(textInputRef, containerRef);
      if (!domEl) return;

      const caret = getCaretViewportPos(domEl, caretPos);
      if (caret) {
        setPopupPos({ x: caret.x, y: caret.y, spaceAbove: caret.y });
      } else {
        // Fallback: position below the input
        const rect = domEl.getBoundingClientRect();
        setPopupPos({ x: rect.left + 8, y: rect.bottom, spaceAbove: rect.top });
      }
    } else {
      containerRef.current?.measure((_fx, _fy, _w, h, px, py) => {
        setPopupPos({ x: px, y: py + h, spaceAbove: py });
      });
    }
  }

  // ─── text / cursor handlers ──────────────────────────────────────────────

  function handleChangeText(text: string) {
    onChangeText(text);
    if (!token) return;

    const pos = text.length >= value.length
      ? text.length
      : Math.min(cursorRef.current, text.length);

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
    onChangeText(applyInsertion(value, activeTrigger.startIndex, cursorRef.current, rep));
    clearSuggestions();
  }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // ─── popup geometry ──────────────────────────────────────────────────────

  const hasSuggestions = suggestions.length > 0 || suggestLoading;
  const showPopup      = hasSuggestions && !!popupPos;

  const spaceBelow = popupPos ? screenH - popupPos.y : 0;
  const openAbove  = !!popupPos && spaceBelow < LIST_MAX_H + GAP && popupPos.spaceAbove > spaceBelow;

  const popupLeft   = popupPos
    ? Math.max(4, Math.min(popupPos.x, screenW - POPUP_W - 4))
    : 0;
  const popupTop    = !openAbove && popupPos ? popupPos.y + GAP : undefined;
  const popupBottom = openAbove  && popupPos ? screenH - popupPos.spaceAbove + GAP : undefined;

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
    width: POPUP_W,
    maxHeight: LIST_MAX_H,
    backgroundColor: surface,
    borderWidth: 1,
    borderColor,
    borderRadius: 10,
    overflow: 'hidden',
  };

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <View ref={containerRef} collapsable={false}>
      <TextInput
        ref={textInputRef}
        style={[{ color: textColor, backgroundColor: bgColor }, style]}
        value={value}
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
                  ...(popupTop    !== undefined ? { top: popupTop }       : {}),
                  ...(popupBottom !== undefined ? { bottom: popupBottom } : {}),
                  ...({ boxShadow: '0 4px 16px rgba(0,0,0,0.13)' } as any),
                  zIndex: 99999,
                },
              ]}
            >
              {suggestionRows}
            </View>,
            portalEl,
          )
        : null}

      {/* NATIVE — transparent Modal, no focus issues on iOS/Android */}
      {Platform.OS !== 'web' ? (
        <Modal
          visible={showPopup}
          transparent
          animationType="none"
          onRequestClose={clearSuggestions}
        >
          <Pressable style={{ flex: 1 }} onPress={clearSuggestions}>
            <Pressable onPress={() => {}}>
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
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}
