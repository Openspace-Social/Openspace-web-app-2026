import { Linking } from 'react-native';

// The neutral host the YouTube / Vimeo embed wrapper HTML is served from.
// Must match the WebView's source.baseUrl in PostCard / PostDetailModal so
// the navigation handler can tell "this is the wrapper page itself" apart
// from "the user clicked something that wants to leave the embed."
export const EMBED_BASE_URL = 'https://openspacelive.com';

// react-native-webview's onShouldStartLoadWithRequest event. Typed
// loosely to avoid pulling in the native-only react-native-webview types
// from web bundles.
type EmbedNavigationEvent = {
  url?: string;
  isTopFrame?: boolean;
  navigationType?: string;
  mainDocumentURL?: string;
};

// Decides whether a navigation inside an embed-hosting WebView should
// proceed inline or be handed off to the OS. Two distinct hand-offs:
//
// 1. Custom-scheme URLs (youtube://, vnd.youtube://, intent://, vimeo://):
//    WKWebView refuses non-HTTP(S) schemes and surfaces "Redirection to
//    a url with a scheme that is not HTTP(S)". We forward to Linking
//    with an https fallback for when the native app isn't installed.
//
// 2. Top-frame http(s) navigations away from the embed wrapper: the
//    YouTube player's "Watch on YouTube" link points at
//    https://www.youtube.com/watch?v=ID. If we let the WebView follow
//    it, YouTube's mobile site renders inside the tiny embed frame with
//    yet another "Open in app" prompt. Instead, hand the URL to the OS
//    so the YouTube app (or the system browser) opens it full-screen.
//
// Subframe traffic (the player iframe itself + its XHRs) is left alone.
export function shouldStartLoadWithEmbedRequest(event: EmbedNavigationEvent): boolean {
  const url = event?.url || '';
  if (!url) return false;

  // Custom-scheme URLs → forward to the OS.
  if (!/^(?:https?|about|data|blob):/i.test(url)) {
    const fallback = httpsFallbackForScheme(url);
    Linking.openURL(url).catch(() => {
      if (fallback) {
        Linking.openURL(fallback).catch(() => {});
      }
    });
    return false;
  }

  // The wrapper page itself (initial load + any in-wrapper navigation)
  // and the about:blank Web­Kit fires before the first content load.
  if (
    url.startsWith('about:') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    isEmbedWrapperUrl(url)
  ) {
    return true;
  }

  // iOS only: the player iframe's own loads + its XHRs come through
  // here with isTopFrame=false. Let those continue inside the WebView.
  // (Android only fires this prop for top-frame navigations, so the
  // field is undefined there — treated as top-frame, which is correct.)
  if (event?.isTopFrame === false) {
    return true;
  }

  // Top-frame navigation to a non-wrapper URL → user tapped a link in
  // the player that wants to leave the embed entirely. Hand to the OS.
  Linking.openURL(url).catch(() => {});
  return false;
}

function isEmbedWrapperUrl(url: string): boolean {
  return url === EMBED_BASE_URL || url.startsWith(`${EMBED_BASE_URL}/`);
}

function httpsFallbackForScheme(url: string): string | null {
  const youtubeMatch = url.match(/^(?:youtube|vnd\.youtube):\/\/(.*)$/i);
  if (youtubeMatch) {
    const rest = youtubeMatch[1];
    if (/^(?:www\.|m\.)?youtube\.com|^youtu\.be/i.test(rest)) {
      return `https://${rest}`;
    }
    // Pure-id form: youtube://VIDEO_ID
    return `https://www.youtube.com/watch?v=${rest}`;
  }
  if (/^vimeo:\/\//i.test(url)) {
    return url.replace(/^vimeo:\/\//i, 'https://vimeo.com/');
  }
  // Android intent:// URIs carry an `S.browser_fallback_url=...` extra.
  const intentMatch = url.match(/^intent:\/\/.*[#&;]S\.browser_fallback_url=([^;]+)/i);
  if (intentMatch) {
    try {
      return decodeURIComponent(intentMatch[1]);
    } catch {
      return null;
    }
  }
  return null;
}
