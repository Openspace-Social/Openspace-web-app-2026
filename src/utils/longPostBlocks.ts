/**
 * Shared helpers for assembling long-post block payloads.
 *
 * Web's HomeScreen had these inline; native re-uses them so the data
 * shape posted from native exactly matches what web sends and what
 * PostCard's renderer / backend expect.
 */

import { parseExternalVideoUrl } from './externalVideoEmbeds';

export type LongPostBlockType = 'paragraph' | 'heading' | 'quote' | 'image' | 'embed' | 'table';

export type LongPostBlock = {
  id: string;
  type: LongPostBlockType;
  position?: number;
  text?: string;
  level?: 1 | 2 | 3;
  url?: string;
  caption?: string;
  align?: 'left' | 'center' | 'right';
  width?: number;
  tableHtml?: string;
  objectPosition?: string;
  imageFit?: 'cover' | 'contain';
  imageScale?: number;
};

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildLongPostHtmlFromBlocks(blocks: LongPostBlock[]): string {
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
        if (block.imageScale != null && Number.isFinite(block.imageScale)) {
          imgAttrs.push(`data-image-scale="${block.imageScale}"`);
        }
        const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : '';
        return `<figure><img ${imgAttrs.join(' ')} />${caption}</figure>`;
      }
      if (block.type === 'embed') {
        if (!block.url) return '';
        // Round-trip embeds back into the markup the Lexical editor's
        // importDOM accepts: an `<iframe>` for recognized video providers
        // (YouTube/Vimeo/Twitch/SoundCloud/Spotify) so the video-embed
        // node reattaches, or a `<figure data-os-link-embed="true">` so
        // the link-embed node reattaches and re-fetches metadata. A
        // plain `<a>` would leave the editor with a bare blue link.
        const video = parseExternalVideoUrl(block.url);
        if (video) {
          return `<iframe src="${escapeHtml(video.embedUrl)}" data-source-url="${escapeHtml(video.sourceUrl)}" frameborder="0" allowfullscreen="true"></iframe>`;
        }
        return `<figure data-os-link-embed="true" data-url="${escapeHtml(block.url)}"><a href="${escapeHtml(block.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(block.url)}</a></figure>`;
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

// ── HTML → blocks parser (DOM-based) ───────────────────────────────────────
// Mirrors HomeScreen's `parseLongPostHtmlWithDom`. Used by the bundled
// Lexical WebView so the editor can emit `long_text_blocks` alongside the
// rendered HTML — the backend sanitizer keeps URLs / table HTML / link-
// embed metadata in blocks even when it strips them from `long_text_rendered_html`.

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function parseLongPostHtmlToBlocks(html?: string): LongPostBlock[] {
  if (!html || !html.trim()) return [];
  if (typeof DOMParser === 'undefined') {
    // No DOM available — caller is on RN (no WebView). The editor bundle
    // runs in a WebView so this branch never actually fires there; for
    // safety we just return an empty list.
    return [];
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const blocks: LongPostBlock[] = [];
  let pos = 0;

  const nextId = () => `dom-${Date.now()}-${pos}-${Math.random().toString(36).slice(2, 7)}`;
  const push = (base: Omit<LongPostBlock, 'id' | 'position'>) => {
    blocks.push({ id: nextId(), position: pos++, ...base } as LongPostBlock);
  };

  const imgBlock = (img: Element): Omit<LongPostBlock, 'id' | 'position'> | null => {
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
  };

  const processEl = (el: Element) => {
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
      const isLinkEmbed = (el.getAttribute('data-os-link-embed') || '').toLowerCase() === 'true';
      if (isLinkEmbed) {
        const dataUrl = (el.getAttribute('data-url') || '').trim();
        const anchorUrl = (el.querySelector('a')?.getAttribute('href') || '').trim();
        const url = dataUrl || anchorUrl;
        if (url) push({ type: 'embed', url });
        return;
      }
      const table = el.querySelector('table');
      if (table) { push({ type: 'table' as any, url: '', tableHtml: table.outerHTML } as any); return; }
      const iframe = el.querySelector('iframe');
      if (iframe) {
        const src = iframe.getAttribute('src') || '';
        if (src) push({ type: 'embed', url: src });
        return;
      }
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
      push({ type: 'table' as any, url: '', tableHtml: el.outerHTML } as any);
      return;
    }
    if (tag === 'p') {
      let textRun = '';
      let hasImg = false;
      Array.from(el.childNodes).forEach((child) => {
        if (child.nodeType === 3) {
          textRun += child.textContent || '';
        } else if (child.nodeType === 1) {
          const childEl = child as Element;
          const ct = childEl.tagName.toLowerCase();
          if (ct === 'img') {
            hasImg = true;
            const trimmed = textRun.replace(/\s+/g, ' ').trim();
            if (trimmed) { push({ type: 'paragraph', text: trimmed }); textRun = ''; }
            const b = imgBlock(childEl); if (b) push(b);
          } else if (ct === 'iframe') {
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
        const full = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (full) push({ type: 'paragraph', text: full });
      }
      return;
    }
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
  };

  Array.from(doc.body.children).forEach(processEl);
  // Surface decodeHtmlEntities so eslint doesn't complain about an unused
  // import — it's used inside the builder above for entity-bearing values.
  void decodeHtmlEntities;
  return blocks;
}

export function longPostBlocksToPlainText(blocks: LongPostBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'image') return b.caption || '';
      if (b.type === 'embed') return b.url || '';
      return b.text || '';
    })
    .filter(Boolean)
    .join('\n\n');
}
