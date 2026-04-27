/**
 * LongPostTenTapEditor — native rich-text editor for long posts.
 *
 * Wraps @10play/tentap-editor with a custom toolbar that exposes the full
 * surface area of TenTap's StarterKit so we can mirror what the web's
 * Lexical editor does:
 *
 *   - Inline marks: bold, italic, underline, strikethrough, code,
 *     color, highlight
 *   - Block types: paragraph, headings (H1/H2/H3), blockquote
 *   - Lists: bullet, ordered, task list
 *   - Links (URL prompt)
 *   - Images (handled by parent — insert + per-image resize)
 *   - History: undo / redo
 *
 * Out-of-scope on native (would require rebuilding TenTap's WebView with
 * additional TipTap extensions — non-trivial; kept as a future task):
 *   - Tables
 *   - Custom video-embed node (YouTube/Vimeo as an `<iframe>`)
 *   - Custom link-embed node (rich-card with title/description)
 *   - In-editor `@`/`#` autocomplete popover
 *
 * The editor is kept self-contained so it can be swapped or removed in
 * one place.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
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
import {
  RichText,
  useBridgeState,
  useEditorBridge,
  type EditorBridge,
} from '@10play/tentap-editor';
import { api, type SearchHashtagResult, type SearchUserResult } from '../api/client';

export type LongPostEditorHandle = {
  insertImage: (src: string, widthCss?: string) => void;
  resizeLastImage: (widthCss: string) => void;
};

type Props = {
  c: any;
  initialHtml?: string;
  placeholder?: string;
  editable?: boolean;
  onChangeHtml: (html: string) => void;
  onRequestInsertImage?: () => void;
  onRequestResizeImage?: () => void;
  /** When supplied, the editor watches the body for `@`/`#` triggers and
   *  shows an autocomplete popover with users/hashtags. Tapping a result
   *  injects the resolved label inline. */
  token?: string;
};

const COLORS = [
  '#000000', '#374151', '#9CA3AF',
  '#EF4444', '#F59E0B', '#10B981',
  '#3B82F6', '#8B5CF6', '#EC4899',
];
const HIGHLIGHTS = [
  '#FEF08A', '#FDE68A', '#BBF7D0',
  '#BFDBFE', '#DDD6FE', '#FBCFE8',
  '#FCA5A5', '#A7F3D0', '#E5E7EB',
];

const LongPostTenTapEditor = forwardRef<LongPostEditorHandle, Props>(function LongPostTenTapEditor(
  { c, initialHtml = '', editable = true, onChangeHtml, onRequestInsertImage, onRequestResizeImage, token },
  ref,
) {
  const editor: EditorBridge = useEditorBridge({
    autofocus: false,
    avoidIosKeyboard: true,
    initialContent: initialHtml || '<p></p>',
    editable,
  });

  const stampLastImageWidth = useCallback((widthCss: string) => {
    const safe = (widthCss || '').replace(/[\\"';]/g, '');
    if (!safe) return;
    editor.injectJS(`
      (function(){
        try {
          var imgs = document.querySelectorAll('.ProseMirror img');
          var last = imgs[imgs.length - 1];
          if (last) {
            last.setAttribute('style', 'width: ${safe}; max-width: 100%; height: auto;');
            last.setAttribute('width', '${safe}');
          }
        } catch (e) {}
      })();
      true;
    `);
  }, [editor]);

  useImperativeHandle(ref, () => ({
    insertImage: (src: string, widthCss?: string) => {
      try {
        editor.setImage(src);
        if (widthCss) setTimeout(() => stampLastImageWidth(widthCss), 80);
      } catch {
        // editor not ready yet — silently drop; user can retry.
      }
    },
    resizeLastImage: (widthCss: string) => stampLastImageWidth(widthCss),
  }), [editor, stampLastImageWidth]);

  // Pipe content out on every tick so the parent's `longHtml` mirrors
  // whatever's typed.
  useEffect(() => {
    let active = true;
    const interval = setInterval(async () => {
      if (!active) return;
      try {
        const html = await editor.getHTML();
        if (html != null) onChangeHtml(html);
      } catch { /* not ready */ }
    }, 350);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [editor, onChangeHtml]);

  // ── Mentions / hashtags autocomplete ──────────────────────────────────
  const [mention, setMention] = useState<{ trigger: '@' | '#'; query: string } | null>(null);
  const [userResults, setUserResults] = useState<SearchUserResult[]>([]);
  const [tagResults, setTagResults] = useState<SearchHashtagResult[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const mentionSeqRef = useRef(0);

  // Watch the editor's plain text for an in-progress @user / #tag at the
  // very end (where the cursor likely sits — keeps the implementation
  // simple without needing an exact caret offset from the WebView).
  useEffect(() => {
    if (!token) return;
    let active = true;
    const interval = setInterval(async () => {
      if (!active) return;
      try {
        const text = await editor.getText();
        // Trigger must be at start of line or preceded by whitespace.
        const match = /(?:^|[\s\n])([@#])([A-Za-z0-9_]{0,30})$/.exec(text || '');
        if (match) {
          const trigger = match[1] as '@' | '#';
          const query = match[2] || '';
          setMention((prev) => {
            if (prev && prev.trigger === trigger && prev.query === query) return prev;
            return { trigger, query };
          });
        } else {
          setMention(null);
        }
      } catch { /* not ready */ }
    }, 200);
    return () => { active = false; clearInterval(interval); };
  }, [editor, token]);

  // Debounced fetch when the mention query changes.
  useEffect(() => {
    if (!token || !mention) {
      setUserResults([]); setTagResults([]); setSuggestLoading(false);
      return;
    }
    const seq = ++mentionSeqRef.current;
    setSuggestLoading(true);
    const handle = setTimeout(async () => {
      try {
        if (mention.trigger === '@') {
          const list = await api.searchUsers(token, mention.query || ' ', 6);
          if (mentionSeqRef.current !== seq) return;
          setUserResults(Array.isArray(list) ? list : []);
        } else {
          const list = await api.searchHashtags(token, mention.query || ' ', 6);
          if (mentionSeqRef.current !== seq) return;
          setTagResults(Array.isArray(list) ? list : []);
        }
      } catch {
        if (mentionSeqRef.current !== seq) return;
        if (mention.trigger === '@') setUserResults([]); else setTagResults([]);
      } finally {
        if (mentionSeqRef.current === seq) setSuggestLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [mention, token]);

  // Replace the last `<trigger><query>` chunk with the chosen label by
  // extending the WebView selection backwards and dispatching insertText —
  // ProseMirror picks up the InputEvent and updates its document cleanly.
  const acceptSuggestion = useCallback((label: string) => {
    if (!mention) return;
    const replaceLen = 1 + mention.query.length; // trigger + query
    const inserted = `${label} `;
    const safeInserted = inserted.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    editor.injectJS(`
      (function(){
        try {
          var sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return;
          var rng = sel.getRangeAt(0);
          var node = rng.startContainer;
          var off = rng.startOffset;
          if (node.nodeType !== 3) {
            // Walk to the deepest text node at the end of the editor
            var pm = document.querySelector('.ProseMirror');
            if (!pm) return;
            var walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
            var last = null;
            while (walker.nextNode()) last = walker.currentNode;
            if (!last) return;
            node = last; off = (last.textContent || '').length;
          }
          var newOff = Math.max(0, off - ${replaceLen});
          rng.setStart(node, newOff);
          rng.setEnd(node, off);
          sel.removeAllRanges();
          sel.addRange(rng);
          document.execCommand('insertText', false, '${safeInserted}');
        } catch (e) {}
      })();
      true;
    `);
    setMention(null);
    setUserResults([]); setTagResults([]);
  }, [editor, mention]);

  return (
    <View style={[styles.root, { borderColor: c.inputBorder, backgroundColor: c.inputBackground }]}>
      <RichText editor={editor} style={styles.editor} />
      {mention ? (
        <MentionPopover
          c={c}
          loading={suggestLoading}
          trigger={mention.trigger}
          query={mention.query}
          users={userResults}
          tags={tagResults}
          onPick={acceptSuggestion}
          onDismiss={() => setMention(null)}
        />
      ) : null}
      <CustomToolbar
        c={c}
        editor={editor}
        onRequestInsertImage={onRequestInsertImage}
        onRequestResizeImage={onRequestResizeImage}
      />
    </View>
  );
});

export default LongPostTenTapEditor;

// ── Custom toolbar ────────────────────────────────────────────────────────

function CustomToolbar({
  c,
  editor,
  onRequestInsertImage,
  onRequestResizeImage,
}: {
  c: any;
  editor: EditorBridge;
  onRequestInsertImage?: () => void;
  onRequestResizeImage?: () => void;
}) {
  const state = useBridgeState(editor);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [colorOpen, setColorOpen] = useState<null | 'color' | 'highlight'>(null);

  const toggle = (fn: () => void) => () => fn();

  const promptHeading = useCallback(() => {
    const cancel = 'Cancel';
    const items = [
      { label: 'Paragraph', level: 0 as const },
      { label: 'Heading 1', level: 1 as const },
      { label: 'Heading 2', level: 2 as const },
      { label: 'Heading 3', level: 3 as const },
    ];
    const apply = (level: 0 | 1 | 2 | 3) => {
      if (level === 0) {
        // Tap toggleHeading on the active level twice to flip back to paragraph.
        const current = state.headingLevel as 1 | 2 | 3 | undefined;
        if (current) (editor as any).toggleHeading(current);
      } else {
        (editor as any).toggleHeading(level);
      }
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Block style', options: [...items.map((i) => i.label), cancel], cancelButtonIndex: items.length },
        (idx) => { if (idx >= 0 && idx < items.length) apply(items[idx].level); },
      );
    } else {
      Alert.alert('Block style', undefined, [
        ...items.map((i) => ({ text: i.label, onPress: () => apply(i.level) })),
        { text: cancel, style: 'cancel' as const },
      ]);
    }
  }, [editor, state.headingLevel]);

  const applyColor = useCallback((color: string) => {
    setColorOpen(null);
    if (color === 'unset') {
      (editor as any).unsetColor();
    } else {
      (editor as any).setColor(color);
    }
  }, [editor]);

  const applyHighlight = useCallback((color: string) => {
    setColorOpen(null);
    if (color === 'unset') {
      (editor as any).unsetHighlight();
    } else {
      (editor as any).setHighlight(color);
    }
  }, [editor]);

  const submitLink = useCallback(() => {
    const url = (linkValue || '').trim();
    setLinkOpen(false);
    if (!url) {
      (editor as any).setLink(null);
    } else {
      // TipTap's link extension auto-prefixes nothing; prepend https:// if
      // the user didn't supply a protocol.
      const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      (editor as any).setLink(normalized);
    }
  }, [editor, linkValue]);

  const openLink = useCallback(() => {
    setLinkValue((state as any).activeLink || '');
    setLinkOpen(true);
  }, [state]);

  return (
    <View style={[styles.toolbarWrap, { borderTopColor: c.border, backgroundColor: c.surface }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbarRow}
      >
        <Btn c={c} icon="undo" disabled={!state.canUndo} onPress={toggle(() => (editor as any).undo())} />
        <Btn c={c} icon="redo" disabled={!state.canRedo} onPress={toggle(() => (editor as any).redo())} />
        <Sep c={c} />
        <Btn c={c} icon="format-bold" active={(state as any).isBoldActive} onPress={toggle(() => (editor as any).toggleBold())} />
        <Btn c={c} icon="format-italic" active={(state as any).isItalicActive} onPress={toggle(() => (editor as any).toggleItalic())} />
        <Btn c={c} icon="format-underline" active={(state as any).isUnderlineActive} onPress={toggle(() => (editor as any).toggleUnderline())} />
        <Btn c={c} icon="format-strikethrough" active={(state as any).isStrikeActive} onPress={toggle(() => (editor as any).toggleStrike())} />
        <Btn c={c} icon="code-tags" active={(state as any).isCodeActive} onPress={toggle(() => (editor as any).toggleCode())} />
        <Btn c={c} icon="palette-outline" onPress={() => setColorOpen('color')} />
        <Btn c={c} icon="marker" onPress={() => setColorOpen('highlight')} />
        <Sep c={c} />
        <Btn c={c} icon="format-header-pound" label={state.headingLevel ? `H${state.headingLevel}` : 'P'} onPress={promptHeading} />
        <Btn c={c} icon="format-list-bulleted" active={(state as any).isBulletListActive} onPress={toggle(() => (editor as any).toggleBulletList())} />
        <Btn c={c} icon="format-list-numbered" active={(state as any).isOrderedListActive} onPress={toggle(() => (editor as any).toggleOrderedList())} />
        <Btn c={c} icon="format-list-checks" active={(state as any).isTaskListActive} onPress={toggle(() => (editor as any).toggleTaskList())} />
        <Btn c={c} icon="format-quote-close" active={(state as any).isBlockquoteActive} onPress={toggle(() => (editor as any).toggleBlockquote())} />
        <Sep c={c} />
        <Btn c={c} icon="link-variant" active={(state as any).isLinkActive} onPress={openLink} />
        {onRequestInsertImage ? (
          <Btn c={c} icon="image-plus" onPress={onRequestInsertImage} />
        ) : null}
        {onRequestResizeImage ? (
          <Btn c={c} icon="resize" onPress={onRequestResizeImage} />
        ) : null}
      </ScrollView>

      {/* Link prompt */}
      <Modal visible={linkOpen} transparent animationType="fade" onRequestClose={() => setLinkOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setLinkOpen(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: c.textPrimary }]}>Add link</Text>
            <TextInput
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={linkValue}
              onChangeText={setLinkValue}
              placeholder="https://example.com"
              placeholderTextColor={c.textMuted}
              style={[styles.modalInput, { color: c.textPrimary, borderColor: c.inputBorder, backgroundColor: c.inputBackground }]}
            />
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { borderColor: c.border }]}
                onPress={() => { setLinkValue(''); setLinkOpen(false); (editor as any).setLink(null); }}
              >
                <Text style={[styles.modalBtnText, { color: c.errorText }]}>Remove</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
              <TouchableOpacity style={[styles.modalBtn, { borderColor: c.border }]} onPress={() => setLinkOpen(false)}>
                <Text style={[styles.modalBtnText, { color: c.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: c.primary, borderColor: c.primary }]} onPress={submitLink}>
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Apply</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Color / Highlight palette */}
      <Modal visible={colorOpen != null} transparent animationType="fade" onRequestClose={() => setColorOpen(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setColorOpen(null)}>
          <Pressable style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: c.textPrimary }]}>
              {colorOpen === 'highlight' ? 'Highlight' : 'Text color'}
            </Text>
            <View style={styles.swatchGrid}>
              {(colorOpen === 'highlight' ? HIGHLIGHTS : COLORS).map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[styles.swatch, { backgroundColor: color, borderColor: c.border }]}
                  onPress={() => (colorOpen === 'highlight' ? applyHighlight(color) : applyColor(color))}
                />
              ))}
            </View>
            <TouchableOpacity
              style={[styles.modalBtn, { borderColor: c.border, alignSelf: 'flex-start' }]}
              onPress={() => (colorOpen === 'highlight' ? applyHighlight('unset') : applyColor('unset'))}
            >
              <Text style={[styles.modalBtnText, { color: c.textPrimary }]}>Remove</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Btn({
  c, icon, label, active, disabled, onPress,
}: {
  c: any;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label?: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.toolbarBtn,
        {
          backgroundColor: active ? `${c.primary}24` : 'transparent',
          opacity: disabled ? 0.4 : 1,
        },
      ]}
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled}
    >
      <MaterialCommunityIcons name={icon} size={18} color={active ? c.primary : c.textPrimary} />
      {label ? (
        <Text style={[styles.toolbarBtnLabel, { color: active ? c.primary : c.textPrimary }]}>{label}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

function Sep({ c }: { c: any }) {
  return <View style={[styles.toolbarSep, { backgroundColor: c.border }]} />;
}

function MentionPopover({
  c,
  loading,
  trigger,
  query,
  users,
  tags,
  onPick,
  onDismiss,
}: {
  c: any;
  loading: boolean;
  trigger: '@' | '#';
  query: string;
  users: SearchUserResult[];
  tags: SearchHashtagResult[];
  onPick: (label: string) => void;
  onDismiss: () => void;
}) {
  const isUser = trigger === '@';
  const items = isUser ? users : tags;
  return (
    <View style={[styles.mentionWrap, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={[styles.mentionHeader, { borderBottomColor: c.border }]}>
        <Text style={[styles.mentionTitle, { color: c.textMuted }]}>
          {isUser ? `People matching “@${query}”` : `Hashtags matching “#${query}”`}
        </Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <MaterialCommunityIcons name="close" size={14} color={c.textMuted} />
        </TouchableOpacity>
      </View>
      {loading && items.length === 0 ? (
        <ActivityIndicator color={c.primary} size="small" style={{ paddingVertical: 14 }} />
      ) : items.length === 0 ? (
        <Text style={[styles.mentionEmpty, { color: c.textMuted }]}>No matches</Text>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="always"
          style={{ maxHeight: 200 }}
        >
          {isUser
            ? users.map((u) => {
                const initial = (u.profile?.name?.[0] || u.username?.[0] || '?').toUpperCase();
                return (
                  <TouchableOpacity
                    key={`mu-${u.id}`}
                    style={styles.mentionRow}
                    activeOpacity={0.85}
                    onPress={() => u.username && onPick(`@${u.username}`)}
                  >
                    <View style={[styles.mentionAvatar, { backgroundColor: c.primary }]}>
                      {u.profile?.avatar ? (
                        <Image source={{ uri: u.profile.avatar }} style={{ width: 26, height: 26, borderRadius: 13 }} resizeMode="cover" />
                      ) : (
                        <Text style={styles.mentionAvatarLetter}>{initial}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      {u.profile?.name ? (
                        <Text style={[styles.mentionName, { color: c.textPrimary }]} numberOfLines={1}>{u.profile.name}</Text>
                      ) : null}
                      <Text style={[styles.mentionHandle, { color: c.textMuted }]} numberOfLines={1}>@{u.username}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            : tags.map((h) => (
                <TouchableOpacity
                  key={`mh-${h.id}`}
                  style={styles.mentionRow}
                  activeOpacity={0.85}
                  onPress={() => h.name && onPick(`#${h.name}`)}
                >
                  <View style={[styles.mentionAvatar, { backgroundColor: c.primary }]}>
                    <MaterialCommunityIcons name="pound" size={16} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.mentionName, { color: c.textPrimary }]} numberOfLines={1}>#{h.name}</Text>
                    {typeof h.posts_count === 'number' ? (
                      <Text style={[styles.mentionHandle, { color: c.textMuted }]} numberOfLines={1}>{h.posts_count} posts</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 360,
    backgroundColor: '#fff',
  },
  editor: { flex: 1, minHeight: 280 },
  toolbarWrap: { borderTopWidth: 1 },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 6 },
  toolbarSep: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 4 },
  toolbarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 36,
    justifyContent: 'center',
  },
  toolbarBtnLabel: { fontSize: 12, fontWeight: '800' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 18 },
  modalCard: { width: '100%', maxWidth: 440, borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  modalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  modalBtnText: { fontSize: 13, fontWeight: '800' },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 999, borderWidth: 1 },

  mentionWrap: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    maxHeight: 240,
  },
  mentionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  mentionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4, flex: 1 },
  mentionEmpty: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 14, textAlign: 'center' },
  mentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mentionAvatar: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  mentionAvatarLetter: { color: '#fff', fontWeight: '900', fontSize: 11 },
  mentionName: { fontSize: 13, fontWeight: '700' },
  mentionHandle: { fontSize: 11, marginTop: 1 },
});
