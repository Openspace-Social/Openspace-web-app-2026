import React from 'react';
import ReactDOM from 'react-dom';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $generateNodesFromDOM, $generateHtmlFromNodes } from '@lexical/html';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { $createLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  ListItemNode,
  ListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { api, SearchUserResult, SearchHashtagResult } from '../api/client';
import {
  INSERT_LEXICAL_IMAGE_COMMAND,
  SET_LEXICAL_IMAGE_ALIGN_COMMAND,
  LexicalImageNode,
  LexicalImagesPlugin,
} from './LexicalImageNode.web';
import {
  INSERT_LEXICAL_VIDEO_EMBED_COMMAND,
  LexicalVideoEmbedNode,
  LexicalVideoEmbedsPlugin,
} from './LexicalVideoEmbedNode.web';
import {
  INSERT_LEXICAL_LINK_EMBED_COMMAND,
  LexicalLinkEmbedNode,
  LexicalLinkEmbedsPlugin,
} from './LexicalLinkEmbedNode.web';
import {
  LexicalTablePlugin,
  INSERT_TABLE_COMMAND,
  INSERT_TABLE_ROW_BELOW_COMMAND,
  INSERT_TABLE_ROW_ABOVE_COMMAND,
  INSERT_TABLE_COL_AFTER_COMMAND,
  INSERT_TABLE_COL_BEFORE_COMMAND,
  DELETE_TABLE_ROW_COMMAND,
  DELETE_TABLE_COL_COMMAND,
  TOGGLE_TABLE_BORDERS_COMMAND,
  TABLE_CSS,
  isInsideTable,
  isTableBordered,
} from './LexicalTablePlugin.web';
import { parseExternalVideoUrl, fetchExternalVideoPreview } from '../utils/externalVideoEmbeds';
import { fetchShortPostLinkPreviewCached, getUrlHostLabel, ShortPostLinkPreview } from '../utils/shortPostEmbeds';

type LexicalLongPostEditorProps = {
  value: string;
  placeholder?: string;
  onChange: (html: string) => void;
  onUploadImageFiles?: (files: Array<Blob & { name?: string; type?: string }>) => Promise<string[]>;
  expandedHeight?: boolean;
  maxImages?: number;
  onNotify?: (message: string) => void;
  token?: string;
};

// ─── Mention / Hashtag autocomplete plugin ───────────────────────────────────

type MHSuggestion = {
  kind: 'user' | 'hashtag';
  id: number;
  label: string;   // "@username" or "#tag"
  subLabel?: string; // display name or "N posts"
  avatar?: string;
};

function MentionHashtagPlugin({ token }: { token?: string }) {
  const [editor] = useLexicalComposerContext();

  const [suggestions, setSuggestions] = React.useState<MHSuggestion[]>([]);
  const [loading, setLoading]         = React.useState(false);
  const [pos, setPos]                 = React.useState<{ x: number; y: number } | null>(null);
  const triggerRef  = React.useRef<{ char: '@' | '#'; startOffset: number } | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef   = React.useRef('');

  const clear = React.useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    triggerRef.current = null;
    latestRef.current  = '';
    setSuggestions([]);
    setLoading(false);
    setPos(null);
  }, []);

  // ── Watch editor state for @ / # ──────────────────────────────────────────
  React.useEffect(() => {
    return editor.registerUpdateListener(() => {
      if (!token) return;
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) { clear(); return; }

        const anchor     = selection.anchor;
        const anchorNode = anchor.getNode();
        if (!$isTextNode(anchorNode)) { clear(); return; }

        const textBefore = anchorNode.getTextContent().slice(0, anchor.offset);
        const match      = /(?:^|[\s\n])([@#])([A-Za-z0-9_]*)$/.exec(textBefore);
        if (!match) { clear(); return; }

        const char  = match[1] as '@' | '#';
        const query = match[2];
        const spaceLen = match[0].length - match[1].length - match[2].length;
        const startOffset = match.index + spaceLen;

        // Get caret viewport coords via native browser Selection API
        const domSel = window.getSelection();
        if (!domSel || domSel.rangeCount === 0) { clear(); return; }
        const rect = domSel.getRangeAt(0).getBoundingClientRect();
        const newPos = (rect.width > 0 || rect.height > 0)
          ? { x: rect.left, y: rect.bottom }
          : null;
        if (!newPos) { clear(); return; }

        triggerRef.current = { char, startOffset };
        setPos(newPos);

        if (query.length === 0) {
          setSuggestions([]);
          setLoading(false);
          return;
        }

        latestRef.current = query;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setLoading(true);

        debounceRef.current = setTimeout(async () => {
          const expected = latestRef.current;
          try {
            if (char === '@') {
              const users: SearchUserResult[] = await api.searchUsers(token, query, 6);
              if (latestRef.current !== expected) return;
              setSuggestions(users.map(u => ({
                kind: 'user',
                id: u.id,
                label: `@${u.username ?? ''}`,
                subLabel: u.profile?.name,
                avatar: u.profile?.avatar,
              })));
            } else {
              const tags: SearchHashtagResult[] = await api.searchHashtags(token, query, 6);
              if (latestRef.current !== expected) return;
              setSuggestions(tags.map(h => ({
                kind: 'hashtag',
                id: h.id,
                label: `#${h.name ?? ''}`,
                subLabel: h.posts_count ? `${h.posts_count.toLocaleString()} posts` : undefined,
              })));
            }
          } catch {
            if (latestRef.current === expected) setSuggestions([]);
          } finally {
            if (latestRef.current === expected) setLoading(false);
          }
        }, 280);
      });
    });
  }, [editor, token, clear]);

  // Dismiss on outside mousedown
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const popup  = document.getElementById('__mh_lexical_popup__');
      if (popup && popup.contains(target)) return;
      clear();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [clear]);

  React.useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // ── Insert selected suggestion ────────────────────────────────────────────
  const select = React.useCallback((label: string) => {
    const trig = triggerRef.current;
    if (!trig) return;
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
      const anchor     = selection.anchor;
      const anchorNode = anchor.getNode();
      if (!$isTextNode(anchorNode)) return;
      // Select from trigger start to current cursor, then replace
      anchorNode.select(trig.startOffset, anchor.offset);
      const sel2 = $getSelection();
      if ($isRangeSelection(sel2)) sel2.insertText(label + ' ');
    });
    clear();
  }, [editor, clear]);

  // ── Render popup ──────────────────────────────────────────────────────────
  const show = (suggestions.length > 0 || loading) && !!pos;
  if (!show || !pos) return null;

  const W = 240, MAX_H = 240, GAP = 6;
  const sw   = window.innerWidth;
  const sh   = window.innerHeight;
  const left = Math.max(4, Math.min(pos.x, sw - W - 4));
  const spaceBelow = sh - pos.y;
  const top  = spaceBelow < MAX_H + GAP
    ? Math.max(4, pos.y - GAP - MAX_H)
    : pos.y + GAP;

  return ReactDOM.createPortal(
    <div
      id="__mh_lexical_popup__"
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed', left, top,
        width: W, maxHeight: MAX_H,
        background: '#fff', border: '1px solid #e5e7eb',
        borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
        zIndex: 2147483647, overflowY: 'auto',
      }}
    >
      {loading && suggestions.length === 0 ? (
        <div style={{ padding: '14px 12px', color: '#6b7280', fontSize: 13, textAlign: 'center' }}>
          Loading…
        </div>
      ) : suggestions.map((s, idx) => (
        <div
          key={`${s.kind}-${s.id}`}
          onMouseDown={(e) => { e.preventDefault(); select(s.label); }}
          style={{
            display: 'flex', alignItems: 'center',
            padding: '9px 12px', cursor: 'pointer',
            borderBottom: idx < suggestions.length - 1 ? '1px solid #f1f5f9' : 'none',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#f8fafc'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ''; }}
        >
          {s.kind === 'user' ? (
            s.avatar
              ? <img src={s.avatar} alt="" style={{ width: 28, height: 28, borderRadius: 14, marginRight: 8, objectFit: 'cover', flexShrink: 0 }} />
              : <div style={{ width: 28, height: 28, borderRadius: 14, marginRight: 8, background: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                  {(s.label[1] ?? '?').toUpperCase()}
                </div>
          ) : (
            <div style={{ width: 28, height: 28, borderRadius: 14, marginRight: 8, background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366F1', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
              #
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {s.kind === 'user' && s.subLabel ? (
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.subLabel}
              </div>
            ) : null}
            <div style={{ fontSize: 12, color: '#6b7280', lineHeight: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.kind === 'user' ? s.label : (s.subLabel ? `${s.label} · ${s.subLabel}` : s.label)}
            </div>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function LoadInitialHtmlPlugin({ initialHtml }: { initialHtml: string }) {
  const [editor] = useLexicalComposerContext();
  const initializedRef = React.useRef(false);

  React.useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const safeHtml = initialHtml && initialHtml.trim() ? initialHtml : '<p></p>';
      const parser = new DOMParser();
      const dom = parser.parseFromString(safeHtml, 'text/html');
      const nodes = $generateNodesFromDOM(editor, dom);
      if (nodes.length > 0) {
        root.append(...nodes);
      } else {
        root.append($createParagraphNode());
      }
    });
  }, [editor, initialHtml]);

  return null;
}

function ToolbarButton({
  label,
  onClick,
  active = false,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      style={active ? activeToolbarButtonStyle : toolbarButtonStyle}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ToolbarPlugin({
  onUploadImageFiles,
  onHeightChange,
  currentImageCount,
  maxImages = 5,
  onNotify,
}: {
  onUploadImageFiles?: (files: Array<Blob & { name?: string; type?: string }>) => Promise<string[]>;
  onHeightChange?: (height: number) => void;
  currentImageCount: number;
  maxImages?: number;
  onNotify?: (message: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkEmbedOpen, setLinkEmbedOpen] = React.useState(false);
  const [videoOpen, setVideoOpen] = React.useState(false);
  const [tableOpen, setTableOpen] = React.useState(false);
  /**
   * pendingUpload holds the CURRENT blob (already rotated if the user clicked
   * rotate) and its preview URL. The rotation is applied eagerly to the blob
   * on every rotate click, so Upload always just sends blob as-is.
   */
  const [pendingUpload, setPendingUpload] = React.useState<{
    blob: Blob & { name?: string; type?: string };
    previewUrl: string;
  } | null>(null);
  const [rotating, setRotating] = React.useState(false);
  const [tableRows, setTableRows] = React.useState('3');
  const [tableCols, setTableCols] = React.useState('3');
  const [tableHeaders, setTableHeaders] = React.useState(true);
  const [linkText, setLinkText] = React.useState('');
  const [linkUrl, setLinkUrl] = React.useState('https://');
  const [linkError, setLinkError] = React.useState('');
  const [linkEmbedUrl, setLinkEmbedUrl] = React.useState('https://');
  const [linkEmbedError, setLinkEmbedError] = React.useState('');
  const [linkEmbedPreviewLoading, setLinkEmbedPreviewLoading] = React.useState(false);
  const [linkEmbedPreview, setLinkEmbedPreview] = React.useState<ShortPostLinkPreview | null>(null);
  const [videoUrl, setVideoUrl] = React.useState('https://');
  const [videoError, setVideoError] = React.useState('');
  const [videoPreviewLoading, setVideoPreviewLoading] = React.useState(false);
  const [videoPreview, setVideoPreview] = React.useState<{ title: string; thumbnailUrl?: string; providerName: string } | null>(null);
  const [cursorInTable, setCursorInTable] = React.useState(false);
  const [tableBordered, setTableBordered] = React.useState(false);
  const [activeFormats, setActiveFormats] = React.useState({
    bold: false,
    italic: false,
    underline: false,
    h2: false,
    h3: false,
    paragraph: true,
    quote: false,
  });

  React.useEffect(() => {
    const readActiveFormats = () => {
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const anchorNode = selection.anchor.getNode();
        const blockNode = anchorNode.getTopLevelElement();
        if (!blockNode || $isRootOrShadowRoot(blockNode)) {
          setActiveFormats({
            bold: selection.hasFormat('bold'),
            italic: selection.hasFormat('italic'),
            underline: selection.hasFormat('underline'),
            h2: false,
            h3: false,
            paragraph: true,
            quote: false,
          });
          return;
        }
        const isHeading = $isHeadingNode(blockNode);
        const headingTag = isHeading ? blockNode.getTag() : null;
        const blockType = blockNode.getType();

        setActiveFormats({
          bold: selection.hasFormat('bold'),
          italic: selection.hasFormat('italic'),
          underline: selection.hasFormat('underline'),
          h2: headingTag === 'h2',
          h3: headingTag === 'h3',
          paragraph: blockType === 'paragraph',
          quote: blockType === 'quote',
        });
      });
    };

    const unregister = editor.registerUpdateListener(() => {
      readActiveFormats();
      setCursorInTable(isInsideTable(editor));
      setTableBordered(isTableBordered(editor));
    });
    document.addEventListener('selectionchange', readActiveFormats);
    readActiveFormats();
    return () => {
      unregister();
      document.removeEventListener('selectionchange', readActiveFormats);
    };
  }, [editor]);

  React.useEffect(() => {
    const el = toolbarRef.current;
    if (!el || !onHeightChange) return;

    const notify = () => {
      const next = Math.ceil(el.getBoundingClientRect().height || 0);
      onHeightChange(next);
    };

    notify();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => notify());
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', notify);
    return () => window.removeEventListener('resize', notify);
  }, [onHeightChange]);

  const applyBlock = React.useCallback((kind: 'paragraph' | 'h2' | 'h3' | 'quote') => {
    if (kind === 'paragraph') {
      // Normalize out of list context first so paragraph command is reliable.
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    }
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (kind === 'paragraph') {
        $setBlocksType(selection, () => $createParagraphNode());
        return;
      }
      if (kind === 'quote') {
        $setBlocksType(selection, () => $createQuoteNode());
        return;
      }
      $setBlocksType(selection, () => $createHeadingNode(kind === 'h2' ? 'h2' : 'h3'));
    });
  }, [editor]);

  const openLinkComposer = React.useCallback(() => {
    let selectedText = '';
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selectedText = selection.getTextContent();
      }
    });
    setLinkText(selectedText || '');
    setLinkUrl('https://');
    setLinkError('');
    setLinkEmbedOpen(false);
    setVideoOpen(false);
    setTableOpen(false);
    setLinkOpen(true);
  }, [editor]);

  const openLinkEmbedComposer = React.useCallback(() => {
    setLinkEmbedOpen(true);
    setLinkOpen(false);
    setVideoOpen(false);
    setTableOpen(false);
    setLinkEmbedUrl('https://');
    setLinkEmbedError('');
    setLinkEmbedPreview(null);
  }, []);

  const openVideoComposer = React.useCallback(() => {
    setVideoOpen(true);
    setLinkOpen(false);
    setLinkEmbedOpen(false);
    setTableOpen(false);
    setVideoUrl('https://');
    setVideoError('');
    setVideoPreview(null);
  }, []);

  const applyLinkFromComposer = React.useCallback(() => {
    const url = linkUrl.trim();
    const text = linkText.trim();
    if (!url) {
      setLinkError('URL is required.');
      return;
    }

    let appliedToSelection = false;
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      const selectedText = selection.getTextContent();
      if (!selection.isCollapsed()) {
        if (text && text !== selectedText) {
          selection.insertText(text);
        }
        appliedToSelection = true;
        return;
      }

      const displayText = text || url;
      const linkNode = $createLinkNode(url);
      linkNode.append($createTextNode(displayText));
      selection.insertNodes([linkNode, $createTextNode(' ')]);
    });

    if (appliedToSelection) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    }

    setLinkOpen(false);
    setLinkError('');
  }, [editor, linkText, linkUrl]);

  const loadLinkEmbedPreview = React.useCallback(async () => {
    const raw = linkEmbedUrl.trim();
    if (!raw || !/^https?:\/\//i.test(raw)) {
      setLinkEmbedError('Use a valid URL that starts with http:// or https://');
      setLinkEmbedPreview(null);
      return;
    }
    setLinkEmbedError('');
    setLinkEmbedPreviewLoading(true);
    try {
      const preview = await fetchShortPostLinkPreviewCached(raw);
      if (preview.isVideoEmbed) {
        setLinkEmbedError('Use "Video URL" for YouTube or Vimeo embeds.');
        setLinkEmbedPreview(null);
      } else {
        setLinkEmbedPreview(preview);
        setLinkEmbedUrl(preview.url || raw);
      }
    } catch (error: any) {
      setLinkEmbedError(error?.message || 'Could not load link preview.');
      setLinkEmbedPreview(null);
    } finally {
      setLinkEmbedPreviewLoading(false);
    }
  }, [linkEmbedUrl]);

  const applyLinkEmbedFromComposer = React.useCallback(() => {
    const raw = linkEmbedUrl.trim();
    if (!raw || !/^https?:\/\//i.test(raw)) {
      setLinkEmbedError('Use a valid URL that starts with http:// or https://');
      return;
    }

    const preview = linkEmbedPreview || {
      url: raw,
      title: getUrlHostLabel(raw) || raw,
      siteName: getUrlHostLabel(raw),
    };

    editor.dispatchCommand(INSERT_LEXICAL_LINK_EMBED_COMMAND, {
      url: preview.url || raw,
      title: preview.title || preview.url || raw,
      description: preview.description,
      imageUrl: preview.imageUrl,
      siteName: preview.siteName,
    });

    setLinkEmbedOpen(false);
    setLinkEmbedError('');
    setLinkEmbedPreview(null);
  }, [editor, linkEmbedPreview, linkEmbedUrl]);

  const loadVideoPreview = React.useCallback(async () => {
    const raw = videoUrl.trim();
    const parsed = parseExternalVideoUrl(raw);
    if (!parsed) {
      setVideoError('Use a valid YouTube or Vimeo URL.');
      setVideoPreview(null);
      return;
    }
    setVideoError('');
    setVideoPreviewLoading(true);
    try {
      const preview = await fetchExternalVideoPreview(parsed.sourceUrl);
      setVideoPreview(preview);
      setVideoUrl(parsed.sourceUrl);
    } catch (error: any) {
      setVideoError(error?.message || 'Could not load preview.');
      setVideoPreview(null);
    } finally {
      setVideoPreviewLoading(false);
    }
  }, [videoUrl]);

  const applyVideoFromComposer = React.useCallback(() => {
    const raw = videoUrl.trim();
    const parsed = parseExternalVideoUrl(raw);
    if (!parsed) {
      setVideoError('Use a valid YouTube or Vimeo URL.');
      return;
    }
    editor.dispatchCommand(INSERT_LEXICAL_VIDEO_EMBED_COMMAND, {
      url: parsed.sourceUrl,
      title: videoPreview?.title,
      thumbnailUrl: videoPreview?.thumbnailUrl,
    });
    setVideoOpen(false);
    setVideoError('');
    setVideoPreview(null);
  }, [editor, videoPreview, videoUrl]);

  const insertImageByUrl = React.useCallback(() => {
    if (currentImageCount >= maxImages) {
      onNotify?.(`You can add up to ${maxImages} images in a long post.`);
      return;
    }
    const next = window.prompt('Image URL:', 'https://');
    if (next === null) return;
    const url = next.trim();
    if (!url) return;
    editor.dispatchCommand(INSERT_LEXICAL_IMAGE_COMMAND, { src: url, altText: '' });
  }, [currentImageCount, editor, maxImages, onNotify]);

  const insertImageByUpload = React.useCallback(async () => {
    if (currentImageCount >= maxImages) {
      onNotify?.(`You can add up to ${maxImages} images in a long post.`);
      return;
    }
    if (!onUploadImageFiles) {
      window.alert('Upload handler is unavailable.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = false;

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const previewUrl = URL.createObjectURL(file);
      setPendingUpload({
        blob: file as Blob & { name?: string; type?: string },
        previewUrl,
      });
    };

    input.click();
  }, [currentImageCount, maxImages, onNotify, onUploadImageFiles]);

  /**
   * Eagerly applies canvas rotation to pendingUpload.blob and replaces the
   * preview URL so what the user sees matches exactly what will be uploaded.
   * Using a ref to always read the latest pendingUpload without stale-closure issues.
   */
  const pendingUploadRef = React.useRef(pendingUpload);
  React.useEffect(() => {
    pendingUploadRef.current = pendingUpload;
  }, [pendingUpload]);

  const applyRotation = React.useCallback(async (degrees: 90 | 270) => {
    const current = pendingUploadRef.current;
    if (!current || rotating) return;
    setRotating(true);
    try {
      const { rotateImageBlob } = await import('../utils/imageRotation');
      const rotated = await rotateImageBlob(current.blob, degrees);
      // Preserve the original filename as an own property (type comes from canvas)
      const name = (current.blob as any).name as string | undefined;
      if (name) (rotated as any).name = name;
      const newPreviewUrl = URL.createObjectURL(rotated);
      // Revoke old preview only after new URL is ready
      URL.revokeObjectURL(current.previewUrl);
      setPendingUpload({
        blob: rotated as Blob & { name?: string; type?: string },
        previewUrl: newPreviewUrl,
      });
    } catch (e) {
      console.error('[LexicalLongPostEditor] applyRotation failed', e);
      onNotify?.('Could not rotate image.');
    } finally {
      setRotating(false);
    }
  }, [rotating, onNotify]);

  /** Upload the blob exactly as it is — rotation has already been applied eagerly. */
  const confirmPendingUpload = React.useCallback(async () => {
    const current = pendingUploadRef.current;
    if (!current || !onUploadImageFiles) return;
    setPendingUpload(null);
    URL.revokeObjectURL(current.previewUrl);
    try {
      const urls = await onUploadImageFiles([current.blob]);
      if (urls?.[0]) {
        editor.dispatchCommand(INSERT_LEXICAL_IMAGE_COMMAND, { src: urls[0], altText: '' });
      }
    } catch (error) {
      console.error('[LexicalLongPostEditor] image upload failed', error);
      onNotify?.('Could not upload image.');
    }
  }, [editor, onNotify, onUploadImageFiles]);

  const alignSelection = React.useCallback((align: 'left' | 'center' | 'right') => {
    const handled = editor.dispatchCommand(SET_LEXICAL_IMAGE_ALIGN_COMMAND, align);
    if (!handled) {
      editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, align);
    }
  }, [editor]);

  return (
    <div ref={toolbarRef} style={toolbarStyle}>
      <ToolbarButton label="B" active={activeFormats.bold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} />
      <ToolbarButton label="I" active={activeFormats.italic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} />
      <ToolbarButton label="U" active={activeFormats.underline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')} />
      <ToolbarButton label="H2" active={activeFormats.h2} onClick={() => applyBlock('h2')} />
      <ToolbarButton label="H3" active={activeFormats.h3} onClick={() => applyBlock('h3')} />
      <ToolbarButton label="¶" active={activeFormats.paragraph} onClick={() => applyBlock('paragraph')} />
      <ToolbarButton label="❝" active={activeFormats.quote} onClick={() => applyBlock('quote')} />
      <ToolbarButton label="• List" onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)} />
      <ToolbarButton label="1. List" onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)} />
      <ToolbarButton label="No List" onClick={() => editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)} />
      <ToolbarButton label="Link" onClick={openLinkComposer} />
      <ToolbarButton label="Embed Link" onClick={openLinkEmbedComposer} active={linkEmbedOpen} />
      <ToolbarButton label="Video URL" onClick={openVideoComposer} active={videoOpen} />
      <ToolbarButton label="Image URL" onClick={insertImageByUrl} />
      <ToolbarButton label="Upload Image" onClick={() => { void insertImageByUpload(); }} />
      <ToolbarButton label="Left" onClick={() => alignSelection('left')} />
      <ToolbarButton label="Center" onClick={() => alignSelection('center')} />
      <ToolbarButton label="Right" onClick={() => alignSelection('right')} />
      <ToolbarButton label="Undo" onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)} />
      <ToolbarButton label="Redo" onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)} />
      <ToolbarButton label="⊞ Table" onClick={() => { setTableOpen((v) => !v); setLinkOpen(false); setLinkEmbedOpen(false); setVideoOpen(false); }} active={tableOpen} />
      {cursorInTable ? (
        <>
          <ToolbarButton label="+ Row ↓" onClick={() => editor.dispatchCommand(INSERT_TABLE_ROW_BELOW_COMMAND, undefined)} />
          <ToolbarButton label="+ Row ↑" onClick={() => editor.dispatchCommand(INSERT_TABLE_ROW_ABOVE_COMMAND, undefined)} />
          <ToolbarButton label="+ Col →" onClick={() => editor.dispatchCommand(INSERT_TABLE_COL_AFTER_COMMAND, undefined)} />
          <ToolbarButton label="+ Col ←" onClick={() => editor.dispatchCommand(INSERT_TABLE_COL_BEFORE_COMMAND, undefined)} />
          <ToolbarButton label="− Row" onClick={() => editor.dispatchCommand(DELETE_TABLE_ROW_COMMAND, undefined)} />
          <ToolbarButton label="− Col" onClick={() => editor.dispatchCommand(DELETE_TABLE_COL_COMMAND, undefined)} />
          <ToolbarButton
            label={tableBordered ? 'Grid: visible' : 'Grid: hidden'}
            active={tableBordered}
            onClick={() => editor.dispatchCommand(TOGGLE_TABLE_BORDERS_COMMAND, undefined)}
          />
        </>
      ) : null}
      {tableOpen ? (
        <div style={tableComposerStyle}>
          <div style={linkComposerTitleStyle}>Insert table / grid</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
            <label style={linkLabelStyle}>Rows</label>
            <input
              type="number"
              min={1}
              max={20}
              value={tableRows}
              onChange={(e) => setTableRows(e.target.value)}
              style={{ ...linkInputStyle, width: 54 }}
            />
            <label style={linkLabelStyle}>Cols</label>
            <input
              type="number"
              min={1}
              max={10}
              value={tableCols}
              onChange={(e) => setTableCols(e.target.value)}
              style={{ ...linkInputStyle, width: 54 }}
            />
          </div>
          <label style={{ ...linkLabelStyle, display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <input
              type="checkbox"
              checked={tableHeaders}
              onChange={(e) => setTableHeaders(e.target.checked)}
            />
            Header row
          </label>
          <div style={linkActionsStyle}>
            <button type="button" style={linkGhostButtonStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => setTableOpen(false)}>Cancel</button>
            <button
              type="button"
              style={linkPrimaryButtonStyle}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const rows = Math.max(1, Math.min(20, Number(tableRows) || 3));
                const cols = Math.max(1, Math.min(10, Number(tableCols) || 3));
                editor.dispatchCommand(INSERT_TABLE_COMMAND, { rows, columns: cols, includeHeaders: tableHeaders } as any);
                setTableOpen(false);
              }}
            >
              Insert
            </button>
          </div>
        </div>
      ) : null}
      {videoOpen ? (
        <div style={linkComposerStyle}>
          <div style={linkComposerTitleStyle}>Insert external video</div>
          <label style={linkLabelStyle}>YouTube or Vimeo URL</label>
          <input
            type="url"
            value={videoUrl}
            onChange={(event) => setVideoUrl(event.target.value)}
            style={linkInputStyle}
            placeholder="https://youtube.com/watch?v=..."
          />
          {videoPreviewLoading ? (
            <div style={{ ...linkLabelStyle, marginTop: 6 }}>Loading preview...</div>
          ) : null}
          {videoPreview ? (
            <div style={videoPreviewCardStyle}>
              <div style={videoPreviewThumbWrapStyle}>
                {videoPreview.thumbnailUrl ? (
                  <img src={videoPreview.thumbnailUrl} alt={videoPreview.title} style={videoPreviewThumbStyle} />
                ) : null}
                <div style={videoPreviewPlayStyle}>▶</div>
              </div>
              <div style={videoPreviewMetaStyle}>
                <div style={videoPreviewProviderStyle}>{videoPreview.providerName}</div>
                <div style={videoPreviewTitleStyle}>{videoPreview.title}</div>
              </div>
            </div>
          ) : null}
          {videoError ? <div style={linkErrorStyle}>{videoError}</div> : null}
          <div style={linkActionsStyle}>
            <button
              type="button"
              style={linkGhostButtonStyle}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setVideoOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              style={linkGhostButtonStyle}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { void loadVideoPreview(); }}
            >
              Preview
            </button>
            <button
              type="button"
              style={linkPrimaryButtonStyle}
              onMouseDown={(event) => event.preventDefault()}
              onClick={applyVideoFromComposer}
            >
              Insert
            </button>
          </div>
        </div>
      ) : null}
      {linkEmbedOpen ? (
        <div style={linkComposerStyle}>
          <div style={linkComposerTitleStyle}>Embed link preview</div>
          <label style={linkLabelStyle}>URL</label>
          <input
            type="url"
            value={linkEmbedUrl}
            onChange={(event) => setLinkEmbedUrl(event.target.value)}
            style={linkInputStyle}
            placeholder="https://example.com/story"
          />
          {linkEmbedPreviewLoading ? (
            <div style={{ ...linkLabelStyle, marginTop: 6 }}>Loading preview...</div>
          ) : null}
          {linkEmbedPreview ? (
            <div style={videoPreviewCardStyle}>
              {linkEmbedPreview.imageUrl ? (
                <div style={videoPreviewThumbWrapStyle}>
                  <img src={linkEmbedPreview.imageUrl} alt={linkEmbedPreview.title} style={videoPreviewThumbStyle} />
                </div>
              ) : null}
              <div style={videoPreviewMetaStyle}>
                <div style={videoPreviewProviderStyle}>
                  {linkEmbedPreview.siteName || getUrlHostLabel(linkEmbedPreview.url)}
                </div>
                <div style={videoPreviewTitleStyle}>{linkEmbedPreview.title || linkEmbedPreview.url}</div>
                {linkEmbedPreview.description ? (
                  <div style={linkEmbedDescriptionStyle}>{linkEmbedPreview.description}</div>
                ) : null}
              </div>
            </div>
          ) : null}
          {linkEmbedError ? <div style={linkErrorStyle}>{linkEmbedError}</div> : null}
          <div style={linkActionsStyle}>
            <button
              type="button"
              style={linkGhostButtonStyle}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setLinkEmbedOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              style={linkGhostButtonStyle}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { void loadLinkEmbedPreview(); }}
            >
              Preview
            </button>
            <button
              type="button"
              style={linkPrimaryButtonStyle}
              onMouseDown={(event) => event.preventDefault()}
              onClick={applyLinkEmbedFromComposer}
            >
              Insert
            </button>
          </div>
        </div>
      ) : null}
      {linkOpen ? (
        <div style={linkComposerStyle}>
          <div style={linkComposerTitleStyle}>Insert link</div>
          <label style={linkLabelStyle}>Display text</label>
          <input
            type="text"
            value={linkText}
            onChange={(event) => setLinkText(event.target.value)}
            style={linkInputStyle}
            placeholder="Text to show"
          />
          <label style={linkLabelStyle}>URL</label>
          <input
            type="url"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            style={linkInputStyle}
            placeholder="https://example.com"
          />
          {linkError ? <div style={linkErrorStyle}>{linkError}</div> : null}
          <div style={linkActionsStyle}>
            <button
              type="button"
              style={linkGhostButtonStyle}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setLinkOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              style={linkPrimaryButtonStyle}
              onMouseDown={(event) => event.preventDefault()}
              onClick={applyLinkFromComposer}
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
      {pendingUpload
        ? ReactDOM.createPortal(
            <div style={rotationOverlayStyle}>
              <div style={rotationModalStyle}>
                <div style={rotationModalTitleStyle}>Rotate image before uploading</div>
                <div style={rotationPreviewWrapStyle}>
                  {/* Square frame — the previewUrl is already the rotated blob */}
                  <div style={rotationPreviewFrameStyle}>
                    {rotating ? (
                      <div style={rotationSpinnerStyle}>…</div>
                    ) : (
                      <img
                        key={pendingUpload.previewUrl}
                        src={pendingUpload.previewUrl}
                        alt="preview"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                    )}
                  </div>
                </div>
                <div style={rotationButtonRowStyle}>
                  <button
                    type="button"
                    style={rotating ? rotationActionButtonDisabledStyle : rotationActionButtonStyle}
                    disabled={rotating}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { void applyRotation(270); }}
                  >
                    ↺ Rotate Left
                  </button>
                  <button
                    type="button"
                    style={rotating ? rotationActionButtonDisabledStyle : rotationActionButtonStyle}
                    disabled={rotating}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { void applyRotation(90); }}
                  >
                    ↻ Rotate Right
                  </button>
                </div>
                <div style={linkActionsStyle}>
                  <button
                    type="button"
                    style={linkGhostButtonStyle}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      URL.revokeObjectURL(pendingUpload.previewUrl);
                      setPendingUpload(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    style={rotating ? { ...linkPrimaryButtonStyle, opacity: 0.5 } : linkPrimaryButtonStyle}
                    disabled={rotating}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { void confirmPendingUpload(); }}
                  >
                    Upload
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function SelectionToolbarPlugin({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [editor] = useLexicalComposerContext();
  const [visible, setVisible] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 0, top: 0 });
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState('https://');
  const [hasSelection, setHasSelection] = React.useState(false);
  const [activeFormats, setActiveFormats] = React.useState({
    bold: false,
    italic: false,
    underline: false,
    h2: false,
    h3: false,
    paragraph: true,
  });
  const floatingRef = React.useRef<HTMLDivElement | null>(null);

  const applyBlock = React.useCallback((kind: 'h2' | 'h3' | 'paragraph') => {
    if (kind === 'paragraph') {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    }
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (kind === 'paragraph') {
        $setBlocksType(selection, () => $createParagraphNode());
        return;
      }
      $setBlocksType(selection, () => $createHeadingNode(kind));
    });
  }, [editor]);

  React.useEffect(() => {
    const updatePosition = () => {
      const rootEl = editor.getRootElement();
      const container = containerRef.current;
      const browserSelection = window.getSelection();
      if (!rootEl || !container || !browserSelection || browserSelection.rangeCount === 0) {
        if (!linkOpen) {
          setVisible(false);
          setHasSelection(false);
        }
        return;
      }

      const range = browserSelection.getRangeAt(0);
      const hasActiveRange = !range.collapsed && rootEl.contains(range.commonAncestorContainer);
      setHasSelection(hasActiveRange);

      editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const anchorNode = selection.anchor.getNode();
        const blockNode = anchorNode.getTopLevelElement();
        if (!blockNode || $isRootOrShadowRoot(blockNode)) {
          setActiveFormats({
            bold: selection.hasFormat('bold'),
            italic: selection.hasFormat('italic'),
            underline: selection.hasFormat('underline'),
            h2: false,
            h3: false,
            paragraph: true,
          });
          return;
        }
        const isHeading = $isHeadingNode(blockNode);
        const headingTag = isHeading ? blockNode.getTag() : null;
        const blockType = blockNode.getType();
        setActiveFormats({
          bold: selection.hasFormat('bold'),
          italic: selection.hasFormat('italic'),
          underline: selection.hasFormat('underline'),
          h2: headingTag === 'h2',
          h3: headingTag === 'h3',
          paragraph: blockType === 'paragraph',
        });
      });

      if (!hasActiveRange) {
        if (!linkOpen) {
          setVisible(false);
        }
        return;
      }

      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const rawLeft = rect.left + rect.width / 2 - containerRect.left;
      const top = rect.top - containerRect.top - 10;
      const clampPadding = 24;
      const approxHalfWidth = linkOpen ? 180 : 165;
      const minLeft = clampPadding + approxHalfWidth;
      const maxLeft = Math.max(minLeft, containerRect.width - clampPadding - approxHalfWidth);
      const left = Math.min(maxLeft, Math.max(minLeft, rawLeft));
      setPosition({ left, top });
      setVisible(true);
    };

    const unregister = editor.registerUpdateListener(() => {
      updatePosition();
    });

    document.addEventListener('selectionchange', updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      unregister();
      document.removeEventListener('selectionchange', updatePosition);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [containerRef, editor, linkOpen]);

  React.useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const floating = floatingRef.current;
      const rootEl = editor.getRootElement();
      if (floating?.contains(target)) return;
      if (rootEl?.contains(target)) return;
      setVisible(false);
      setLinkOpen(false);
      setHasSelection(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [editor]);

  if (!visible && !linkOpen) return null;

  return (
    <div
      ref={floatingRef}
      style={{
        position: 'absolute',
        left: position.left,
        top: position.top,
        transform: 'translate(-50%, -100%)',
        zIndex: 8,
      }}
    >
      {hasSelection ? (
        <div style={selectionToolbarStyle}>
          <button type="button" style={activeFormats.bold ? activeSelectionToolbarButtonStyle : selectionToolbarButtonStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}>B</button>
          <button type="button" style={activeFormats.italic ? activeSelectionToolbarButtonStyle : selectionToolbarButtonStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}>I</button>
          <button type="button" style={activeFormats.underline ? activeSelectionToolbarButtonStyle : selectionToolbarButtonStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}>U</button>
          <button type="button" style={activeFormats.paragraph ? activeSelectionToolbarButtonStyle : selectionToolbarButtonStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => applyBlock('paragraph')}>P</button>
          <button type="button" style={activeFormats.h2 ? activeSelectionToolbarButtonStyle : selectionToolbarButtonStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => applyBlock('h2')}>H2</button>
          <button type="button" style={activeFormats.h3 ? activeSelectionToolbarButtonStyle : selectionToolbarButtonStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => applyBlock('h3')}>H3</button>
          <button type="button" style={selectionToolbarButtonStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => setLinkOpen((prev) => !prev)}>Link</button>
        </div>
      ) : null}
      {linkOpen ? (
        <div style={selectionLinkWrapStyle}>
          <input
            type="url"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            style={selectionLinkInputStyle}
            placeholder="https://example.com"
          />
          <button
            type="button"
            style={selectionLinkButtonStyle}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const url = linkUrl.trim();
              if (!url) return;
              editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
              setLinkOpen(false);
            }}
          >
            Apply
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function LexicalLongPostEditor({
  value,
  placeholder,
  onChange,
  onUploadImageFiles,
  expandedHeight = false,
  maxImages = 5,
  onNotify,
  token,
}: LexicalLongPostEditorProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [toolbarHeight, setToolbarHeight] = React.useState(52);
  const imageCount = React.useMemo(() => {
    const source = value || '';
    if (!source.trim()) return 0;
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(source, 'text/html');
      return doc.querySelectorAll('img').length;
    }
    const matches = source.match(/<img\b/gi);
    return matches ? matches.length : 0;
  }, [value]);
  const composerKey = React.useMemo(
    () => `openspace-lexical-${Math.random().toString(36).slice(2, 10)}`,
    [LexicalImageNode, LexicalVideoEmbedNode, LexicalLinkEmbedNode, HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, TableNode, TableRowNode, TableCellNode]
  );

  const initialConfig = React.useMemo(
    () => ({
      namespace: 'OpenSpaceLongPostLexical',
      onError: (error: Error) => {
        console.error('[LexicalLongPostEditor]', error);
      },
      theme: {
        paragraph: 'oslx-paragraph',
        quote: 'oslx-quote',
        heading: {
          h1: 'oslx-h1',
          h2: 'oslx-h2',
          h3: 'oslx-h3',
        },
        list: {
          ul: 'oslx-ul',
          ol: 'oslx-ol',
          listitem: 'oslx-li',
        },
        link: 'oslx-link',
        text: {
          bold: 'oslx-bold',
          italic: 'oslx-italic',
          underline: 'oslx-underline',
          strikethrough: 'oslx-strike',
        },
        table: 'oslx-table',
        tableCell: 'oslx-table-cell',
        tableCellHeader: 'oslx-table-cell-header',
        tableRow: 'oslx-table-row',
        tableSelected: 'oslx-table-selected',
        tableSelection: 'oslx-table-selection',
      },
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, LexicalImageNode, LexicalVideoEmbedNode, LexicalLinkEmbedNode, TableNode, TableRowNode, TableCellNode],
    }),
    [LexicalImageNode, LexicalVideoEmbedNode, LexicalLinkEmbedNode, HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, TableNode, TableRowNode, TableCellNode]
  );

  return (
    <div
      ref={containerRef}
      style={{
        ...wrapStyle,
        minHeight: expandedHeight ? 620 : 440,
      }}
    >
      <style>
        {`
          .oslx-paragraph { margin: 0 0 12px 0; font-size: 1rem; line-height: 1.6; font-weight: 400; }
          .oslx-h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 12px 0; font-weight: 800; }
          .oslx-h2 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 10px 0; font-weight: 800; }
          .oslx-h3 { font-size: 1.25rem; line-height: 1.3; margin: 0 0 8px 0; font-weight: 700; }
          .oslx-quote { margin: 0 0 12px 0; padding: 8px 12px; border-left: 3px solid #6366F1; background: #EEF2FF; }
          .oslx-ul, .oslx-ol { margin: 0 0 12px 20px; }
          .oslx-li { margin: 4px 0; }
          .oslx-link { color: #2563EB; text-decoration: underline; }
          .oslx-bold { font-weight: 700; }
          .oslx-italic { font-style: italic; }
          .oslx-underline { text-decoration: underline; }
          .oslx-strike { text-decoration: line-through; }
          ${TABLE_CSS}
        `}
      </style>
      <LexicalComposer key={composerKey} initialConfig={initialConfig}>
        <MentionHashtagPlugin token={token} />
        <LoadInitialHtmlPlugin initialHtml={value} />
        <LexicalImagesPlugin />
        <LexicalVideoEmbedsPlugin />
        <LexicalLinkEmbedsPlugin />
        <LexicalTablePlugin />
        <ToolbarPlugin
          onUploadImageFiles={onUploadImageFiles}
          onHeightChange={setToolbarHeight}
          currentImageCount={imageCount}
          maxImages={maxImages}
          onNotify={onNotify}
        />
        <SelectionToolbarPlugin containerRef={containerRef} />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              style={{
                ...editorStyle,
                minHeight: expandedHeight ? 580 : 400,
              } as any}
            />
          }
          placeholder={
            <div style={{ ...placeholderStyle, top: toolbarHeight + 12 }}>
              {placeholder || 'Start writing your long post...'}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState: any, editor: any) => {
            editorState.read(() => {
              onChange($generateHtmlFromNodes(editor, null));
            });
          }}
        />
      </LexicalComposer>
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  borderRadius: 14,
  overflow: 'hidden',
  backgroundColor: '#F8FAFC',
  minHeight: 440,
  position: 'relative',
};

const toolbarStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  padding: '10px',
  borderBottom: '1px solid #E2E8F0',
  background: '#EEF2FF',
};

const toolbarButtonStyle: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  borderRadius: 8,
  padding: '6px 10px',
  background: '#FFFFFF',
  color: '#1E293B',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const activeToolbarButtonStyle: React.CSSProperties = {
  ...toolbarButtonStyle,
  border: '1px solid #4F46E5',
  background: '#E0E7FF',
  color: '#312E81',
};

const tableComposerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 260,
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  background: '#FFFFFF',
  padding: 10,
  boxShadow: '0 12px 24px rgba(2, 6, 23, 0.18)',
  zIndex: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const linkComposerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 280,
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  background: '#FFFFFF',
  padding: 10,
  boxShadow: '0 12px 24px rgba(2, 6, 23, 0.18)',
  zIndex: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const linkComposerTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: '#0F172A',
  marginBottom: 2,
};

const linkLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#334155',
};

const linkInputStyle: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  borderRadius: 8,
  height: 34,
  padding: '0 8px',
  fontSize: 13,
  color: '#0F172A',
};

const linkActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 2,
};

const linkGhostButtonStyle: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  borderRadius: 8,
  background: '#F8FAFC',
  color: '#334155',
  fontSize: 12,
  fontWeight: 700,
  padding: '6px 10px',
  cursor: 'pointer',
};

const linkPrimaryButtonStyle: React.CSSProperties = {
  border: '1px solid #4F46E5',
  borderRadius: 8,
  background: '#6366F1',
  color: '#FFFFFF',
  fontSize: 12,
  fontWeight: 700,
  padding: '6px 10px',
  cursor: 'pointer',
};

const linkErrorStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#DC2626',
};

const videoPreviewCardStyle: React.CSSProperties = {
  marginTop: 8,
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  background: '#F8FAFC',
  display: 'flex',
  alignItems: 'stretch',
  overflow: 'hidden',
};

const videoPreviewThumbWrapStyle: React.CSSProperties = {
  width: 132,
  minWidth: 132,
  maxWidth: '40%',
  aspectRatio: '16 / 9',
  background: '#0F172A',
  position: 'relative',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const videoPreviewThumbStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const videoPreviewPlayStyle: React.CSSProperties = {
  position: 'absolute',
  width: 34,
  height: 34,
  borderRadius: 999,
  background: 'rgba(15,23,42,0.72)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  fontWeight: 700,
};

const videoPreviewMetaStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '8px 10px',
};

const videoPreviewProviderStyle: React.CSSProperties = {
  color: '#4338CA',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  marginBottom: 4,
};

const videoPreviewTitleStyle: React.CSSProperties = {
  color: '#0F172A',
  fontSize: 13,
  fontWeight: 700,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const linkEmbedDescriptionStyle: React.CSSProperties = {
  marginTop: 3,
  color: '#475569',
  fontSize: 11,
  lineHeight: 1.35,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const selectionToolbarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  background: '#0F172A',
  borderRadius: 10,
  padding: 6,
  boxShadow: '0 12px 24px rgba(2,6,23,0.28)',
};

const selectionToolbarButtonStyle: React.CSSProperties = {
  border: '1px solid #334155',
  borderRadius: 7,
  background: '#1E293B',
  color: '#F8FAFC',
  fontSize: 11,
  fontWeight: 700,
  padding: '4px 8px',
  cursor: 'pointer',
};

const activeSelectionToolbarButtonStyle: React.CSSProperties = {
  ...selectionToolbarButtonStyle,
  border: '1px solid #6366F1',
  background: '#312E81',
  color: '#FFFFFF',
};

const selectionLinkWrapStyle: React.CSSProperties = {
  marginTop: 6,
  display: 'flex',
  gap: 6,
  background: '#0F172A',
  borderRadius: 10,
  padding: 6,
};

const selectionLinkInputStyle: React.CSSProperties = {
  width: 200,
  border: '1px solid #334155',
  borderRadius: 7,
  background: '#F8FAFC',
  color: '#0F172A',
  height: 28,
  padding: '0 8px',
  fontSize: 12,
};

const selectionLinkButtonStyle: React.CSSProperties = {
  border: '1px solid #4F46E5',
  borderRadius: 7,
  background: '#6366F1',
  color: '#FFFFFF',
  fontSize: 11,
  fontWeight: 700,
  padding: '4px 8px',
  cursor: 'pointer',
};

const editorStyle: React.CSSProperties = {
  minHeight: 400,
  padding: '12px 14px',
  color: '#0F172A',
  fontSize: 16,
  lineHeight: '24px',
  whiteSpace: 'pre-wrap',
  outline: 'none',
  caretColor: '#0F172A',
};

const placeholderStyle: React.CSSProperties = {
  position: 'absolute',
  top: 72,
  left: 14,
  color: '#94A3B8',
  fontSize: 16,
  lineHeight: '24px',
  fontFamily: 'inherit',
  fontWeight: 400,
  pointerEvents: 'none',
};

// ─── Image rotation modal styles ─────────────────────────────────────────────

const rotationOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2147483646,
};

const rotationModalStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 14,
  padding: 20,
  width: 300,
  maxWidth: '90vw',
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.28)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const rotationModalTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#0F172A',
  textAlign: 'center',
};

const rotationPreviewWrapStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#F1F5F9',
  borderRadius: 8,
  padding: 10,
};

/**
 * Square frame: rotating inside a square looks correct at any 90° step because
 * the width and height are equal — no clipping and no layout shift.
 */
const rotationPreviewFrameStyle: React.CSSProperties = {
  width: 220,
  height: 220,
  borderRadius: 8,
  overflow: 'hidden',
  flexShrink: 0,
};

const rotationButtonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  justifyContent: 'center',
};

const rotationActionButtonStyle: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  borderRadius: 8,
  background: '#F8FAFC',
  color: '#334155',
  fontSize: 13,
  fontWeight: 700,
  padding: '7px 14px',
  cursor: 'pointer',
};

const rotationActionButtonDisabledStyle: React.CSSProperties = {
  ...rotationActionButtonStyle,
  opacity: 0.45,
  cursor: 'not-allowed',
};

const rotationSpinnerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 28,
  color: '#94A3B8',
};
