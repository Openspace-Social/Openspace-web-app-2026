import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

// Open a URL the user tapped (post body, comment, link preview card, etc.).
// Tries the in-app browser first (SFSafariViewController on iOS / Chrome
// Custom Tabs on Android — keeps users in-context), falls back to the
// system browser via Linking.openURL on any failure, and only resolves
// `false` if both pathways are unavailable.
//
// The dual-pathway is important: WebBrowser.openBrowserAsync rejects for
// several reasons that a plain Linking.openURL handles gracefully —
// most commonly URLs that come in without a scheme, but also dev-mode
// SFSafariViewController hiccups when Metro's debugger is attached.
// Calling sites used to fall straight through to a "coming soon" toast
// the moment WebBrowser rejected, which made any of those edge cases
// look like the link was completely broken.
export async function openExternalLink(input: string | undefined | null): Promise<boolean> {
  const url = normalizeUrl(input);
  if (!url) return false;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      return !!opened;
    } catch {
      // Fall through to the other handlers.
    }
  }

  try {
    await WebBrowser.openBrowserAsync(url);
    return true;
  } catch {
    // Fall through to system browser.
  }

  // Linking.canOpenURL is unreliable across platforms — on Android 11+ it
  // can return false for https URLs that the system would actually open
  // fine (depends on <queries> declarations + user's installed apps), and
  // on iOS it's been observed to throw inside Modals. Skip the gate and
  // call openURL directly — system handles the dispatch and surfaces a
  // real error if the URL is genuinely unopenable.
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

function normalizeUrl(input: string | undefined | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Already has a scheme — leave it alone (covers http/https/mailto/tel/etc.).
  if (/^[a-z][a-z0-9+\-.]*:/i.test(trimmed)) return trimmed;

  // Bare domain or path — assume https. The link tokenizer in PostCard
  // only matches http(s)://, so this branch mostly catches user-typed
  // raw text and link-preview metadata that omits the scheme.
  return `https://${trimmed}`;
}
