/**
 * main.tsx — entry for the bundled Lexical long-post editor.
 *
 * Imports the existing web LexicalLongPostEditor straight from the parent
 * app's src/ tree so we get true single-source-of-truth: any change there
 * ships to both web and native after one rebuild of this bundle.
 *
 * Bridge protocol (between this WebView and the React Native host):
 *   - Native → Web: window.postMessage / window.dispatchEvent('message')
 *       { type: 'init', token: string, initialHtml: string }
 *       { type: 'set-html', html: string }
 *       { type: 'upload-image-result', uploadId: string, url?: string,
 *         error?: string }
 *   - Web → Native: window.ReactNativeWebView.postMessage(JSON.stringify(...))
 *       { type: 'change', html: string }
 *       { type: 'upload-image-request', uploadId: string, dataUrl: string,
 *         filename: string }
 *       { type: 'ready' }
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LexicalLongPostEditor from '../../src/components/LexicalLongPostEditor.web';
import { parseLongPostHtmlToBlocks } from '../../src/utils/longPostBlocks';

// Convenience: post a message back up to RN.
function postToNative(payload: any) {
  const w: any = window;
  try {
    w.ReactNativeWebView?.postMessage(JSON.stringify(payload));
  } catch {
    // running in a browser — no host present, swallow
  }
}

// Pending upload requests resolved by RN's response messages. The Lexical
// editor passes us a Blob[] via `onUploadImageFiles`; we forward each as a
// data URL to RN, which uploads via api.addPostMedia and replies with the
// public URL. We turn that back into the Promise<string[]> the editor
// expects.
const pendingUploads = new Map<string, { resolve: (url: string) => void; reject: (e: Error) => void }>();
let uploadCounter = 0;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

function App() {
  const [token, setToken] = useState<string | undefined>();
  const [initialHtml, setInitialHtml] = useState<string>('');
  const [ready, setReady] = useState(false);
  // Bumped whenever the host pushes a new HTML body (e.g. resuming a
  // draft). Used as the LexicalLongPostEditor's `key` so the
  // LoadInitialHtmlPlugin fires again on the new content; without this
  // the plugin's `initializedRef` guard would ignore subsequent loads.
  const [editorKey, setEditorKey] = useState(0);
  const valueRef = useRef('');

  // Listen for messages from the host. RN-WebView dispatches them as
  // window 'message' events (data is a string).
  useEffect(() => {
    function handle(ev: MessageEvent) {
      let payload: any = ev.data;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { return; }
      }
      if (!payload || typeof payload !== 'object') return;
      if (payload.type === 'init') {
        setToken(payload.token || undefined);
        setInitialHtml(payload.initialHtml || '');
        setReady(true);
      } else if (payload.type === 'set-html') {
        setInitialHtml(payload.html || '');
        setEditorKey((k) => k + 1);
      } else if (payload.type === 'upload-image-result') {
        const pending = pendingUploads.get(payload.uploadId);
        if (!pending) return;
        pendingUploads.delete(payload.uploadId);
        if (payload.url) pending.resolve(payload.url);
        else pending.reject(new Error(payload.error || 'Upload failed'));
      }
    }
    window.addEventListener('message', handle);
    document.addEventListener('message', handle as any);
    postToNative({ type: 'ready' });
    return () => {
      window.removeEventListener('message', handle);
      document.removeEventListener('message', handle as any);
    };
  }, []);

  const handleChange = useCallback((html: string) => {
    valueRef.current = html;
    // Emit both HTML and parsed blocks so the native composer can submit
    // the same payload web does. The backend sanitizer strips iframe /
    // table / data-* from `long_text_rendered_html`, but blocks survive
    // intact (URLs, table HTML, link-embed metadata are preserved).
    let blocks: any[] | undefined;
    try {
      blocks = parseLongPostHtmlToBlocks(html);
    } catch {
      blocks = undefined;
    }
    postToNative({ type: 'change', html, blocks });
  }, []);

  const onUploadImageFiles = useCallback(async (files: Array<Blob & { name?: string; type?: string }>) => {
    const urls: string[] = [];
    for (const file of files) {
      const dataUrl = await blobToDataUrl(file);
      const id = `up-${Date.now()}-${++uploadCounter}`;
      const url = await new Promise<string>((resolve, reject) => {
        pendingUploads.set(id, { resolve, reject });
        postToNative({
          type: 'upload-image-request',
          uploadId: id,
          dataUrl,
          filename: (file as any).name || 'long-image.jpg',
          mimeType: (file as any).type || 'image/jpeg',
        });
      });
      urls.push(url);
    }
    return urls;
  }, []);

  // Until RN sends `init`, render nothing — keeps the editor from focusing
  // before the host is ready.
  if (!ready) return null;

  return (
    <div style={{ padding: 12, minHeight: '100vh', boxSizing: 'border-box' }}>
      <LexicalLongPostEditor
        key={`editor-${editorKey}`}
        value={initialHtml}
        onChange={handleChange}
        token={token}
        expandedHeight
        onUploadImageFiles={onUploadImageFiles}
        onNotify={(message: string) => postToNative({ type: 'notify', message })}
      />
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
