/**
 * nativeSocialIdToken — kicks off a native Google or Apple Sign-In and
 * returns the resulting JWT identity token from the provider. Used by both
 * the unauthenticated login flow (LandingScreen → LandingScreen.handleSocialAuth)
 * and the post-login linking flow (Settings → Linked accounts).
 *
 * - iOS Apple → AuthenticationServices via `expo-apple-authentication`.
 * - Android Apple → Apple's web auth URL in Custom Tabs, redirected through
 *   our public Netlify bridge page back into the app via the
 *   `openspacesocial://apple-callback` URL scheme.
 * - Google (both platforms) → Google's official Sign-In SDK. Required by
 *   Google's 2023 OAuth policy; the SDK works on iOS too.
 *
 * The function intentionally throws localised error messages so callers
 * can surface them directly; cancellations also throw with a recognisable
 * message ("auth.socialCancelled" t-key).
 */

import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import type { SocialProvider } from '../api/client';

type Translator = (key: string, options?: any) => string;

function createRandomState(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function nativeSocialIdToken(
  provider: SocialProvider,
  t: Translator,
): Promise<string> {
  if (provider === 'apple') {
    if (Platform.OS === 'ios') {
      const isAvailable = await AppleAuthentication.isAvailableAsync();
      if (!isAvailable) {
        throw new Error(
          t('auth.socialAppleUnavailable', {
            defaultValue: 'Sign in with Apple is not available on this device.',
          }),
        );
      }
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        throw new Error(
          t('auth.socialNoToken', { defaultValue: 'No identity token returned.' }),
        );
      }
      return credential.identityToken;
    }

    // Android Apple — same web-bridge flow LandingScreen uses.
    const appleClientId = process.env.EXPO_PUBLIC_APPLE_CLIENT_ID;
    if (!appleClientId) {
      throw new Error(
        `${t('auth.socialConfigMissing')} (EXPO_PUBLIC_APPLE_CLIENT_ID)`,
      );
    }
    const bridgeUrl = 'https://openspace-web-2026.netlify.app/auth/apple-bridge';
    const appCallback = 'openspacesocial://apple-callback';
    const state = createRandomState();
    const nonce = createRandomState();
    const params = new URLSearchParams();
    params.set('client_id', appleClientId);
    params.set('redirect_uri', bridgeUrl);
    params.set('response_type', 'code id_token');
    params.set('response_mode', 'fragment');
    params.set('scope', 'openid');
    params.set('state', state);
    params.set('nonce', nonce);
    const authUrl = `https://appleid.apple.com/auth/authorize?${params.toString()}`;

    const result = await WebBrowser.openAuthSessionAsync(authUrl, appCallback);
    if (result.type !== 'success' || !result.url) {
      if (result.type === 'cancel' || result.type === 'dismiss') {
        throw new Error(t('auth.socialCancelled'));
      }
      throw new Error(
        t('auth.socialNoToken', { defaultValue: 'No identity token returned.' }),
      );
    }
    const cbQuery = result.url.includes('?')
      ? result.url.split('?')[1].split('#')[0]
      : '';
    const cbParams = new URLSearchParams(cbQuery);
    const errFromCb = cbParams.get('error');
    if (errFromCb) throw new Error(errFromCb);
    const returnedState = cbParams.get('state');
    if (returnedState && returnedState !== state) {
      throw new Error(t('auth.socialStateMismatch'));
    }
    const idToken = cbParams.get('id_token');
    if (!idToken) {
      throw new Error(
        t('auth.socialNoToken', { defaultValue: 'No identity token returned.' }),
      );
    }
    return idToken;
  }

  // Google native — Google's official SDK on both platforms.
  if (!process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID) {
    throw new Error(
      `${t('auth.socialConfigMissing')} (EXPO_PUBLIC_GOOGLE_CLIENT_ID)`,
    );
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Sign out first so the account picker always shows; otherwise the SDK
    // silently re-uses the last account, which is annoying when the user
    // wants to link a different Google identity than they signed in with.
    try {
      await GoogleSignin.signOut();
    } catch {
      // not critical
    }
    const result: any = await GoogleSignin.signIn();
    const idToken: string | undefined =
      result?.idToken || result?.data?.idToken || result?.user?.idToken;
    if (!idToken) {
      throw new Error(
        t('auth.socialNoToken', { defaultValue: 'No identity token returned.' }),
      );
    }
    return idToken;
  } catch (e: any) {
    const code = e?.code;
    if (code === statusCodes.SIGN_IN_CANCELLED || code === 'SIGN_IN_CANCELLED') {
      throw new Error(t('auth.socialCancelled'));
    }
    if (code === statusCodes.IN_PROGRESS || code === 'IN_PROGRESS') {
      throw new Error(
        t('auth.socialInProgress', {
          defaultValue: 'A sign-in is already in progress.',
        }),
      );
    }
    if (
      code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE ||
      code === 'PLAY_SERVICES_NOT_AVAILABLE'
    ) {
      throw new Error(
        t('auth.socialPlayServicesMissing', {
          defaultValue: 'Google Play services are required.',
        }),
      );
    }
    throw e;
  }
}
