/**
 * LongPostLexicalEditor — native long-post editor backed by the SAME
 * Lexical editor the web app uses.
 *
 * Hosts a WebView that loads `longPostEditorHtml` (a single inlined HTML
 * built by `long-post-editor-web/`) and bridges messages over postMessage.
 * This guarantees identical editing UX and rendered output across web and
 * native — the editor source lives in one place
 * (`src/components/LexicalLongPostEditor.web.tsx`).
 *
 * Bridge protocol mirrors `long-post-editor-web/src/main.tsx`:
 *   - Native → Web: { type: 'init' | 'set-html' | 'upload-image-result' }
 *   - Web → Native: { type: 'ready' | 'change' | 'upload-image-request' | 'notify' }
 */

import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { api } from '../api/client';
import { longPostEditorHtml } from './longPostEditorHtml';

export type LongPostLexicalEditorHandle = {
  setHtml: (html: string) => void;
};

type Props = {
  c: any;
  token?: string;
  initialHtml?: string;
  onChangeHtml: (html: string, blocks?: unknown[]) => void;
  /** Called when the editor surface is mounted and ready for input. */
  onReady?: () => void;
  /** Called whenever the editor wants to surface a transient message
   *  (e.g. "max images reached"). */
  onNotify?: (message: string) => void;
  /** Called for each inline image the user inserts. The wrapper hands the
   *  image data URL to this callback; whatever string the promise
   *  resolves with becomes the image's final src in the editor. The
   *  composer uses this to upload via api.addPostMedia and return the
   *  public URL. */
  onUploadImage: (dataUrl: string, filename: string) => Promise<string>;
  /** Optional override for the outer container (e.g. flex:1 in fullscreen
   *  mode so the editor consumes every remaining pixel). */
  containerStyle?: ViewStyle | ViewStyle[];
};

const LongPostLexicalEditor = forwardRef<LongPostLexicalEditorHandle, Props>(function LongPostLexicalEditor(
  { c, token, initialHtml = '', onChangeHtml, onReady, onNotify, onUploadImage, containerStyle },
  ref,
) {
  const webRef = useRef<WebView | null>(null);
  const [isReady, setReady] = useState(false);
  const initRef = useRef({ token, initialHtml });
  // Keep latest values without triggering re-renders that would reload the
  // WebView; we re-send them when the editor reports `ready`.
  initRef.current = { token, initialHtml };

  const send = useCallback((payload: any) => {
    const json = JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    webRef.current?.injectJavaScript(`
      (function(){
        try {
          var ev = new MessageEvent('message', { data: '${json}' });
          window.dispatchEvent(ev);
        } catch (e) {}
      })();
      true;
    `);
  }, []);

  useImperativeHandle(ref, () => ({
    setHtml: (html: string) => send({ type: 'set-html', html }),
  }), [send]);

  const handleMessage = useCallback(async (ev: WebViewMessageEvent) => {
    let payload: any;
    try { payload = JSON.parse(ev.nativeEvent.data); } catch { return; }
    if (!payload || typeof payload !== 'object') return;

    if (payload.type === 'ready') {
      setReady(true);
      // Send the initial state once the editor signals it's mounted.
      send({
        type: 'init',
        token: initRef.current.token,
        initialHtml: initRef.current.initialHtml,
      });
      onReady?.();
    } else if (payload.type === 'change') {
      onChangeHtml(
        typeof payload.html === 'string' ? payload.html : '',
        Array.isArray(payload.blocks) ? payload.blocks : undefined,
      );
    } else if (payload.type === 'notify') {
      onNotify?.(String(payload.message || ''));
    } else if (payload.type === 'upload-image-request') {
      const id = String(payload.uploadId || '');
      const dataUrl = String(payload.dataUrl || '');
      const filename = String(payload.filename || 'long-image.jpg');
      try {
        const url = await onUploadImage(dataUrl, filename);
        send({ type: 'upload-image-result', uploadId: id, url });
      } catch (e: any) {
        send({ type: 'upload-image-result', uploadId: id, error: e?.message || 'Upload failed' });
      }
    }
  }, [onChangeHtml, onNotify, onUploadImage, onReady, send]);

  return (
    <View style={[styles.root, { borderColor: c.inputBorder, backgroundColor: '#ffffff' }, containerStyle]}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html: longPostEditorHtml }}
        onMessage={handleMessage}
        keyboardDisplayRequiresUserAction={false}
        // Hide the iOS input-accessory bar (the X / ✓ row) so the editor
        // surface stays clean.
        hideKeyboardAccessoryView
        javaScriptEnabled
        domStorageEnabled
        scalesPageToFit={false}
        automaticallyAdjustContentInsets={false}
        // Without this, iOS WebView reloads when keyboard opens/closes.
        contentMode="mobile"
        style={styles.webview}
      />
      {!isReady ? (
        <View style={[StyleSheet.absoluteFillObject, styles.loading]}>
          <ActivityIndicator color={c.primary} size="small" />
        </View>
      ) : null}
    </View>
  );
});

export default LongPostLexicalEditor;

// ── Helper for the composer: turn the data URL the WebView posts into a
// React Native–shaped file for api.addPostMedia. ────────────────────────
export async function uploadDataUrlAsPostMedia(
  token: string,
  postUuid: string,
  dataUrl: string,
  filename: string,
  order: number,
): Promise<string> {
  // RN's FormData accepts `{ uri, type, name }` for native; data URIs work
  // because iOS/Android WebView fetches resolve them.
  const mimeMatch = /^data:([^;]+);base64,/.exec(dataUrl);
  const mime = mimeMatch?.[1] || 'image/jpeg';
  await api.addPostMedia(token, postUuid, {
    file: { uri: dataUrl, type: mime, name: filename } as any,
    order,
  });
  const media = await api.getPostMedia(token, postUuid);
  const match = media.find((m) => m.order === order);
  const co = match?.content_object as any;
  return co?.image || co?.thumbnail || co?.file || '';
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 420,
  },
  webview: { flex: 1, backgroundColor: '#fff' },
  loading: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffffd0' },
});
