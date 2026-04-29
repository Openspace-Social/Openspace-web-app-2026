/**
 * webAppleAuth — wrapper around Apple's official "Sign in with Apple JS"
 * library for the web. iOS native uses AuthenticationServices via
 * expo-apple-authentication; this file is web only.
 *
 * Apple's spec requires response_mode=form_post when an id_token is requested,
 * so the popup-polling pattern we use for Google can't work. The hosted JS SDK
 * handles the form_post + postMessage handoff back to the parent window for us
 * and returns the id_token directly.
 */

const APPLE_AUTH_SDK_URL =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

let scriptLoadPromise: Promise<void> | null = null;

function loadAppleAuthScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Apple sign-in is only available in a browser.'));
  }
  if ((window as any).AppleID?.auth) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${APPLE_AUTH_SDK_URL}"]`,
    );
    if (existing) {
      if ((window as any).AppleID?.auth) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Apple sign-in SDK.')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = APPLE_AUTH_SDK_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error('Failed to load Apple sign-in SDK.'));
    };
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

export type WebAppleSignInOptions = {
  clientId: string;
  redirectURI: string;
  state: string;
  nonce: string;
  scope?: string;
};

export type WebAppleSignInResult = {
  idToken: string;
  state?: string;
};

export class AppleSignInCancelled extends Error {
  constructor() {
    super('Apple sign-in cancelled.');
    this.name = 'AppleSignInCancelled';
  }
}

export async function webAppleSignIn(
  opts: WebAppleSignInOptions,
): Promise<WebAppleSignInResult> {
  await loadAppleAuthScript();
  const AppleID = (window as any).AppleID;
  if (!AppleID || !AppleID.auth || typeof AppleID.auth.signIn !== 'function') {
    throw new Error('Apple sign-in SDK is not available.');
  }

  AppleID.auth.init({
    clientId: opts.clientId,
    scope: opts.scope ?? 'name email',
    redirectURI: opts.redirectURI,
    state: opts.state,
    nonce: opts.nonce,
    usePopup: true,
  });

  let response: any;
  try {
    response = await AppleID.auth.signIn();
  } catch (e: any) {
    const errorCode: unknown = e?.error || e?.error_code || e?.message;
    if (
      errorCode === 'popup_closed_by_user' ||
      errorCode === 'user_cancelled_authorize' ||
      errorCode === 'user_trigger_new_signin_flow'
    ) {
      throw new AppleSignInCancelled();
    }
    throw new Error(
      typeof errorCode === 'string' && errorCode ? errorCode : 'Apple sign-in failed.',
    );
  }

  const idToken: string | undefined = response?.authorization?.id_token;
  if (!idToken) {
    throw new Error('No identity token returned from Apple.');
  }
  return { idToken, state: response?.authorization?.state };
}
