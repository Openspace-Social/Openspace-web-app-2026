import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Image,
  ImageBackground,
  useWindowDimensions,
} from 'react-native';
import { AntDesign } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ApiRequestError, api } from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import LanguagePicker from '../components/LanguagePicker';
import AboutUsDrawer from '../components/AboutUsDrawer';
import PrivacyPolicyDrawer from '../components/PrivacyPolicyDrawer';
import TermsOfUseDrawer from '../components/TermsOfUseDrawer';
import GuidelinesDrawer from '../components/GuidelinesDrawer';
import { useAppToast } from '../toast/AppToastContext';
import { passwordPolicyHint, validatePasswordAgainstBackendPolicy } from '../utils/passwordPolicy';
import { AppleSignInCancelled, webAppleSignIn } from '../utils/webAppleAuth';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';

// Configure the Google Sign-In SDK once at module load. The webClientId is
// what the backend verifies against (audience claim on the returned
// id_token), so it must match the web OAuth client we registered. The
// per-platform client IDs are used by Google's SDK to identify the app
// to the OS for the native sign-in UI; they aren't the audience.
const _googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
const _googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
if (_googleWebClientId) {
  try {
    GoogleSignin.configure({
      webClientId: _googleWebClientId,
      iosClientId: _googleIosClientId,
      // We want an id_token back; the SDK requests it when scopes/profile
      // are present.
      scopes: ['openid', 'email', 'profile'],
    });
  } catch {
    // Configuration is idempotent; ignore re-config errors during HMR.
  }
}

interface LandingScreenProps {
  onLogin?: (token: string) => void;
}

type SocialProvider = 'google' | 'apple';

export default function LandingScreen({ onLogin }: LandingScreenProps) {
  const { theme, isDark, toggleTheme } = useTheme();
  const { showToast } = useAppToast();
  const { t } = useTranslation();
  const c = theme.colors;
  const { width } = useWindowDimensions();
  const isWide = width >= 860;

  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'verifyEmail' | 'recoverPassword' | 'recoverAccount' | 'resetPassword' | 'socialUsername' | 'shareProfile' | 'appleLinkAccount' | 'appleLinkVerify'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');
  const [passwordResetToken, setPasswordResetToken] = useState('');
  const [passwordResetCode, setPasswordResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordResetSuccess, setPasswordResetSuccess] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const [socialOnboardingToken, setSocialOnboardingToken] = useState('');
  const [socialUsername, setSocialUsername] = useState('');
  const [shareFlowToken, setShareFlowToken] = useState('');
  const [shareFlowUsername, setShareFlowUsername] = useState('');
  const [appleLinkIdToken, setAppleLinkIdToken] = useState('');
  const [appleLinkUsername, setAppleLinkUsername] = useState('');
  const [appleLinkCode, setAppleLinkCode] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [socialLoadingProvider, setSocialLoadingProvider] = useState<SocialProvider | null>(null);
  const [error, setError] = useState('');
  const [aboutUsOpen, setAboutUsOpen] = useState(false);
  const [privacyPolicyOpen, setPrivacyPolicyOpen] = useState(false);
  const [termsOfUseOpen, setTermsOfUseOpen] = useState(false);
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const headerLinks = ['aboutUs', 'privacyPolicy', 'termsOfUse', 'guidelines'] as const;

  // Extract a password-reset token from a URL we received from a deep link
  // or a browser address bar. Accepts both the new path-based format
  // (`/reset-password/<token>`) and the legacy query-string format
  // (`/?reset_token=<token>`) so already-sent emails keep working.
  function extractResetTokenFromUrl(rawUrl: string | null | undefined): string | null {
    if (!rawUrl) return null;
    try {
      // URL constructor needs a base for relative input — but our reset URLs
      // are always absolute (https://…). On native this is the Universal
      // Link payload, on web it's window.location.href.
      const parsed = new URL(rawUrl);
      const pathMatch = parsed.pathname.match(/^\/reset-password\/([^/?#]+)/);
      if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
      const queryToken = parsed.searchParams.get('reset_token');
      if (queryToken) return queryToken;
    } catch {
      // Fallback: regex the raw string when URL parsing fails (e.g. a
      // custom-scheme URL like `openspacesocial://reset-password/X` won't
      // always parse cleanly across RN URL polyfills).
      const m = rawUrl.match(/reset-password\/([^/?#&\s]+)/);
      if (m?.[1]) return decodeURIComponent(m[1]);
      const q = rawUrl.match(/[?&]reset_token=([^&\s#]+)/);
      if (q?.[1]) return decodeURIComponent(q[1]);
    }
    return null;
  }

  useEffect(() => {
    let cancelled = false;
    function applyToken(token: string | null) {
      if (!token || cancelled) return;
      setPasswordResetToken(token);
      setAuthMode('resetPassword');
      setError('');
      setNotice('');
    }

    if (Platform.OS === 'web') {
      // Web: read from the current address bar.
      applyToken(extractResetTokenFromUrl(typeof window !== 'undefined' ? window.location.href : null));
      return () => {
        cancelled = true;
      };
    }

    // Native: handle both cold-start (Linking.getInitialURL) and warm
    // foreground (Linking.addEventListener) so the iOS Universal Link /
    // Android App Link routes the user into reset mode whether the app
    // was launched by the email tap or already running in the background.
    Linking.getInitialURL().then((url) => applyToken(extractResetTokenFromUrl(url))).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => applyToken(extractResetTokenFromUrl(url)));
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    showToast(error, { type: 'error' });
    setError('');
  }, [error, showToast]);

  const shortFooterLabel = (key: typeof headerLinks[number]) => {
    switch (key) {
      case 'aboutUs': return 'About';
      case 'privacyPolicy': return 'Privacy';
      case 'termsOfUse': return 'Terms';
      case 'guidelines': return 'Guidelines';
    }
  };

  const handleHeaderLinkPress = (key: typeof headerLinks[number]) => {
    if (key === 'aboutUs') {
      setAboutUsOpen(true);
      return;
    }
    if (key === 'privacyPolicy') {
      setPrivacyPolicyOpen(true);
      return;
    }
    if (key === 'termsOfUse') {
      setTermsOfUseOpen(true);
      return;
    }
    if (key === 'guidelines') {
      setGuidelinesOpen(true);
    }
  };

  async function handleLogin() {
    if (!username.trim() || !password.trim()) {
      setError(t('auth.errorEmptyFields'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { token } = await api.login(username.trim(), password);
      onLogin?.(token);
    } catch (e: any) {
      setError(e.message || t('auth.errorLoginFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    if (!signupEmail.trim() || !signupUsername.trim() || !signupPassword.trim()) {
      setError(t('auth.errorEmptyFields'));
      return;
    }

    if (signupPassword !== signupConfirmPassword) {
      setError(t('auth.errorPasswordsDontMatch'));
      return;
    }

    const passwordValidationError = validatePasswordAgainstBackendPolicy(signupPassword, t);
    if (passwordValidationError) {
      setError(passwordValidationError);
      return;
    }

    setError('');
    setNotice('');
    setLoading(true);
    try {
      const { token } = await api.register({
        email: signupEmail.trim(),
        username: signupUsername.trim(),
        password: signupPassword,
        name: signupUsername.trim(),
        is_of_legal_age: true,
        are_guidelines_accepted: true,
      });
      setVerificationToken(token);
      setVerificationEmail(signupEmail.trim());
      setVerificationCode('');
      setVerificationSuccess(false);
      setNotice(t('auth.verificationCodeSent'));
      setAuthMode('verifyEmail');
    } catch (e: any) {
      setError(e.message || t('auth.errorRegistrationFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyEmail() {
    if (!verificationCode.trim()) {
      setError(t('auth.errorVerificationCodeRequired'));
      return;
    }

    if (!verificationToken) {
      setError(t('auth.errorVerificationSessionMissing'));
      return;
    }

    setError('');
    setNotice('');
    setLoading(true);
    try {
      await api.verifyEmailVerificationToken(verificationToken, verificationCode.trim());
      setVerificationSuccess(true);
      setNotice('');
    } catch (e: any) {
      setError(e.message || t('auth.errorVerificationFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerificationCode() {
    if (!verificationToken) {
      setError(t('auth.errorVerificationSessionMissing'));
      return;
    }

    setError('');
    setNotice('');
    setLoading(true);
    try {
      await api.requestEmailVerificationToken(verificationToken);
      setNotice(t('auth.verificationCodeResent'));
    } catch (e: any) {
      setError(e.message || t('auth.errorResendVerificationFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordRecovery() {
    if (!recoveryEmail.trim()) {
      setError(t('auth.errorRecoveryEmailRequired'));
      return;
    }

    setError('');
    setNotice('');
    setLoading(true);
    try {
      const message = await api.requestPasswordReset(recoveryEmail.trim());
      // Auto-advance the flow: now that the recovery email is on its way,
      // drop the user straight onto the OTP entry step instead of leaving
      // them parked on the email-input screen wondering what to do next.
      // The token state is cleared so the resetPassword screen renders
      // step 1 (code entry) — the email's link tap will still also work
      // and override the token via the Linking listener if used.
      setPasswordResetToken('');
      setPasswordResetCode('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordResetSuccess(false);
      setAuthMode('resetPassword');
      setNotice(message || t('auth.passwordRecoverySent'));
    } catch (e: any) {
      setError(e.message || t('auth.passwordRecoveryFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleAccountRecovery() {
    if (!recoveryIdentifier.trim()) {
      setError(t('auth.errorRecoveryIdentifierRequired'));
      return;
    }

    setError('');
    setNotice('');
    setLoading(true);
    try {
      const message = await api.requestAccountRecovery(recoveryIdentifier.trim());
      setNotice(message || t('auth.accountRecoverySent'));
    } catch (e: any) {
      setError(e.message || t('auth.accountRecoveryFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordResetSubmit() {
    // By the time we reach this submit we always have a JWT in state — it
    // arrived either from the email-link deep-link path or from the OTP
    // exchange in step 1. If it's somehow missing, bail rather than send a
    // half-formed request.
    if (!passwordResetToken) {
      setError(t('auth.errorResetTokenMissing'));
      return;
    }
    if (!newPassword.trim() || !confirmNewPassword.trim()) {
      setError(t('auth.errorResetPasswordFieldsRequired'));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError(t('auth.errorResetPasswordMismatch'));
      return;
    }
    const passwordValidationError = validatePasswordAgainstBackendPolicy(newPassword, t);
    if (passwordValidationError) {
      setError(passwordValidationError);
      return;
    }

    setError('');
    setNotice('');
    setLoading(true);
    try {
      const message = await api.verifyPasswordReset(
        { token: passwordResetToken },
        newPassword,
      );
      setPasswordResetSuccess(true);
      setNotice(message || t('auth.passwordResetSuccess'));
      if (Platform.OS === 'web') {
        // Strip the reset token from the URL after success — this used to
        // just clear the query string, but now the token can also live in
        // the pathname (`/reset-password/<token>`) via the new email link
        // format, so reset to the root path.
        window.history.replaceState({}, document.title, '/');
      }
    } catch (e: any) {
      setError(e.message || t('auth.passwordResetFailed'));
    } finally {
      setLoading(false);
    }
  }

  function switchToEnterResetCode() {
    setAuthMode('resetPassword');
    setPasswordResetToken('');
    setPasswordResetCode('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordResetSuccess(false);
    setError('');
    setNotice('');
  }

  // Step 1 of the manual OTP flow: exchange the 6-digit code for the
  // underlying JWT. On success we drop the token into state, which causes
  // the resetPassword UI to advance to step 2 (new-password fields).
  async function handleVerifyResetCode() {
    const sanitizedCode = passwordResetCode.replace(/\D/g, '');
    if (sanitizedCode.length < 6) {
      setError(t('auth.errorResetCodeRequired', { defaultValue: 'Enter the 6-digit code from your reset email.' }));
      return;
    }
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const { token } = await api.exchangePasswordResetCode(sanitizedCode);
      // Force-dismiss the OTP-step keyboard before re-rendering. Without
      // this iOS sometimes leaves the number-pad keyboard "stuck" — the
      // step 2 password TextInputs then refuse to focus on tap because the
      // keyboard's internal first-responder state still points at the
      // unmounted OTP input.
      Keyboard.dismiss();
      setPasswordResetToken(token);
      // Clear the code from state — it's been consumed server-side and we
      // only need the JWT from here.
      setPasswordResetCode('');
    } catch (e: any) {
      setError(e.message || t('auth.passwordResetCodeFailed', { defaultValue: 'That reset code is invalid or expired.' }));
    } finally {
      setLoading(false);
    }
  }

  function switchToLogin() {
    setAuthMode('login');
    setError('');
    setNotice('');
    setVerificationCode('');
    setVerificationSuccess(false);
    setRecoveryEmail('');
    setRecoveryIdentifier('');
    setPasswordResetSuccess(false);
    setPasswordResetCode('');
    setNewPassword('');
    setConfirmNewPassword('');
    setSocialOnboardingToken('');
    setSocialUsername('');
    setShareFlowToken('');
    setShareFlowUsername('');
    setAppleLinkIdToken('');
    setAppleLinkUsername('');
    setAppleLinkCode('');
  }

  function switchToSignup() {
    setAuthMode('signup');
    setError('');
    setNotice('');
  }

  function switchToRecoverPassword() {
    setAuthMode('recoverPassword');
    setError('');
    setNotice('');
  }

  function switchToRecoverAccount() {
    setAuthMode('recoverAccount');
    setError('');
    setNotice('');
  }

  function completeVerifiedLogin() {
    if (!verificationToken) return;
    setShareFlowToken(verificationToken);
    setShareFlowUsername(signupUsername.trim());
    setAuthMode('shareProfile');
  }

  function finishShareAndContinue() {
    if (!shareFlowToken) {
      setError(t('auth.errorShareSessionMissing'));
      return;
    }
    onLogin?.(shareFlowToken);
  }

  async function handleCompleteSocialUsername() {
    if (!socialOnboardingToken) {
      setError(t('auth.errorSocialSessionMissing'));
      return;
    }
    if (!socialUsername.trim()) {
      setError(t('auth.errorSocialUsernameRequired'));
      return;
    }

    setError('');
    setNotice('');
    setLoading(true);
    try {
      await api.updateAuthenticatedUser(socialOnboardingToken, {
        username: socialUsername.trim(),
      });
      setShareFlowToken(socialOnboardingToken);
      setShareFlowUsername(socialUsername.trim());
      setAuthMode('shareProfile');
    } catch (e: any) {
      setError(e.message || t('auth.errorSocialUsernameUpdateFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleAppleLinkRequestCode() {
    if (!appleLinkIdToken) {
      setError('Apple session expired. Please try Apple sign in again.');
      return;
    }
    if (!appleLinkUsername.trim()) {
      setError('Username is required.');
      return;
    }

    setError('');
    setNotice('');
    setLoading(true);
    try {
      const message = await api.requestAppleSocialLinkCode(appleLinkIdToken, appleLinkUsername.trim());
      setNotice(message || 'Verification code sent to your email.');
      setAuthMode('appleLinkVerify');
    } catch (e: any) {
      setError(e.message || 'Could not send verification code.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAppleProceedOnboarding() {
    if (!appleLinkIdToken) {
      setError('Apple session expired. Please try Apple sign in again.');
      return;
    }
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const response = await api.socialAuthApple(appleLinkIdToken, true);
      if (response.is_new_user) {
        setSocialOnboardingToken(response.token);
        setSocialUsername(response.username || '');
        setAuthMode('socialUsername');
      } else {
        onLogin?.(response.token);
      }
    } catch (e: any) {
      setError(e.message || t('auth.socialAuthFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleAppleLinkConfirm() {
    if (!appleLinkIdToken) {
      setError('Apple session expired. Please try Apple sign in again.');
      return;
    }
    if (!appleLinkUsername.trim()) {
      setError('Username is required.');
      return;
    }
    if (!appleLinkCode.trim()) {
      setError('Verification code is required.');
      return;
    }

    setError('');
    setNotice('');
    setLoading(true);
    try {
      const response = await api.confirmAppleSocialLink(
        appleLinkIdToken,
        appleLinkUsername.trim(),
        appleLinkCode.trim(),
      );
      onLogin?.(response.token);
    } catch (e: any) {
      setError(e.message || 'Could not verify code and link account.');
    } finally {
      setLoading(false);
    }
  }

  async function handleShareProfile(platform: 'instagram' | 'facebook' | 'x' | 'bluesky' | 'reddit') {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const profileHandle = shareFlowUsername ? `@${shareFlowUsername}` : '';
    const profileUrl = `https://openspace.social/${shareFlowUsername || ''}`.replace(/\/$/, '');
    const shareText = t('auth.shareProfileMessage', { username: profileHandle || t('auth.newAccountLabel') });
    const encodedUrl = encodeURIComponent(profileUrl);
    const encodedText = encodeURIComponent(shareText);

    if (platform === 'instagram') {
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(`${shareText} ${profileUrl}`);
          setNotice(t('auth.shareInstagramNotice'));
        }
      } catch (e) {
        setNotice(t('auth.shareInstagramNotice'));
      }
      window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
      return;
    }

    const shareUrl = platform === 'facebook'
      ? `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`
      : platform === 'x'
        ? `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`
        : platform === 'bluesky'
          ? `https://bsky.app/intent/compose?text=${encodeURIComponent(`${shareText} ${profileUrl}`)}`
          : `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`;

    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  }

  function createRandomState() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function maskClientId(value?: string) {
    if (!value) return '(missing)';
    if (value.length <= 12) return `${value.slice(0, 3)}***`;
    return `${value.slice(0, 6)}***${value.slice(-6)}`;
  }

  function debugSocial(event: string, payload: Record<string, unknown>) {
    if (!__DEV__ || Platform.OS !== 'web') return;
    // Local-only diagnostics to troubleshoot OAuth config mismatch issues.
    // eslint-disable-next-line no-console
    console.log(`[social-auth] ${event}`, payload);
  }

  // Native iOS / Android social auth — uses native flows that return an
  // `id_token` the backend already accepts via api.socialAuth{Google,Apple}.
  // Apple uses `expo-apple-authentication` (AuthenticationServices); Google
  // uses `expo-auth-session` (system browser → custom URL scheme redirect).
  async function nativeSocialAuth(provider: SocialProvider): Promise<string> {
    if (provider === 'apple') {
      // iOS — use AuthenticationServices via expo-apple-authentication.
      if (Platform.OS === 'ios') {
        const isAvailable = await AppleAuthentication.isAvailableAsync();
        if (!isAvailable) {
          throw new Error(t('auth.socialAppleUnavailable', { defaultValue: 'Sign in with Apple is not available on this device.' }));
        }
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });
        if (!credential.identityToken) {
          throw new Error(t('auth.socialNoToken', { defaultValue: 'No identity token returned.' }));
        }
        return credential.identityToken;
      }

      // Android — Apple has no native SDK. We open Apple's web auth URL
      // in Custom Tabs, redirect to a public HTTPS bridge page that we
      // host on Netlify, and that page hands the id_token back to the app
      // via the openspacesocial:// custom URL scheme our intent filter
      // catches.
      const appleClientId = process.env.EXPO_PUBLIC_APPLE_CLIENT_ID;
      if (!appleClientId) {
        throw new Error(`${t('auth.socialConfigMissing')} (EXPO_PUBLIC_APPLE_CLIENT_ID)`);
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
        throw new Error(t('auth.socialNoToken', { defaultValue: 'No identity token returned.' }));
      }
      const cbQuery = result.url.includes('?') ? result.url.split('?')[1].split('#')[0] : '';
      const cbParams = new URLSearchParams(cbQuery);
      const errFromCb = cbParams.get('error');
      if (errFromCb) throw new Error(errFromCb);
      const returnedState = cbParams.get('state');
      if (returnedState && returnedState !== state) {
        throw new Error(t('auth.socialStateMismatch'));
      }
      const idToken = cbParams.get('id_token');
      if (!idToken) {
        throw new Error(t('auth.socialNoToken', { defaultValue: 'No identity token returned.' }));
      }
      return idToken;
    }

    // Google native — uses Google's official Sign-In SDK on both iOS and
    // Android. Google's 2023 OAuth policy disallows the generic browser
    // code+PKCE flow on Android, requiring the SDK; the SDK works on iOS
    // too, so we use it everywhere for consistency. The id_token returned
    // has audience = webClientId, which the backend already accepts via
    // SOCIAL_AUTH_GOOGLE_CLIENT_IDS.
    if (!process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID) {
      throw new Error(`${t('auth.socialConfigMissing')} (EXPO_PUBLIC_GOOGLE_CLIENT_ID)`);
    }
    try {
      // Make sure Google Play services are available on Android (no-op on
      // iOS). Without this, signIn fails with a confusing module error.
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      // Sign out first so the account picker always shows; otherwise the
      // SDK silently re-uses the last account, which is annoying when
      // testing or when the user wants to switch.
      try { await GoogleSignin.signOut(); } catch { /* not critical */ }
      const result: any = await GoogleSignin.signIn();
      // SDK shape varies slightly across versions. Normalize.
      const idToken: string | undefined =
        result?.idToken ||
        result?.data?.idToken ||
        result?.user?.idToken;
      if (!idToken) {
        throw new Error(t('auth.socialNoToken', { defaultValue: 'No identity token returned.' }));
      }
      return idToken;
    } catch (e: any) {
      const code = e?.code;
      if (code === statusCodes.SIGN_IN_CANCELLED || code === 'SIGN_IN_CANCELLED') {
        throw new Error(t('auth.socialCancelled'));
      }
      if (code === statusCodes.IN_PROGRESS || code === 'IN_PROGRESS') {
        throw new Error(t('auth.socialInProgress', { defaultValue: 'A sign-in is already in progress.' }));
      }
      if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE || code === 'PLAY_SERVICES_NOT_AVAILABLE') {
        throw new Error(t('auth.socialPlayServicesMissing', { defaultValue: 'Google Play services are required.' }));
      }
      throw e;
    }
  }

  function openSocialPopup(provider: SocialProvider): Promise<string> {
    if (Platform.OS !== 'web') {
      return nativeSocialAuth(provider);
    }
    if (typeof window === 'undefined') {
      return Promise.reject(new Error(t('auth.socialWebOnly')));
    }

    // Apple on web: Apple's spec requires response_mode=form_post when
    // requesting an id_token, which breaks the popup-polling pattern Google
    // uses. Use Apple's hosted "Sign in with Apple JS" SDK instead — it
    // handles the form_post + postMessage handoff to the parent window for
    // us and returns the id_token directly.
    if (provider === 'apple') {
      const appleClientId = process.env.EXPO_PUBLIC_APPLE_CLIENT_ID;
      if (!appleClientId) {
        return Promise.reject(
          new Error(`${t('auth.socialConfigMissing')} (EXPO_PUBLIC_APPLE_CLIENT_ID)`),
        );
      }
      const redirectURI =
        process.env.EXPO_PUBLIC_SOCIAL_AUTH_REDIRECT_URI || window.location.origin;
      const state = createRandomState();
      const nonce = createRandomState();
      debugSocial('init', {
        provider,
        origin: window.location.origin,
        redirectUri: redirectURI,
        appleClientId: maskClientId(appleClientId),
        method: 'apple-jssdk',
      });
      return webAppleSignIn({
        clientId: appleClientId,
        redirectURI,
        state,
        nonce,
      })
        .then((result) => {
          if (result.state && result.state !== state) {
            debugSocial('state-mismatch', {
              provider,
              expectedState: state,
              returnedState: result.state,
            });
            throw new Error(t('auth.socialStateMismatch'));
          }
          debugSocial('token-received', {
            provider,
            tokenLength: result.idToken.length,
            returnedState: result.state,
          });
          return result.idToken;
        })
        .catch((e) => {
          if (e instanceof AppleSignInCancelled) {
            debugSocial('popup-closed', { provider });
            throw new Error(t('auth.socialCancelled'));
          }
          debugSocial('provider-error', { provider, message: e?.message });
          throw e;
        });
    }

    return new Promise((resolve, reject) => {
      const redirectUri = process.env.EXPO_PUBLIC_SOCIAL_AUTH_REDIRECT_URI || window.location.origin;
      const nonce = createRandomState();
      const state = createRandomState();
      const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

      debugSocial('init', {
        provider,
        origin: window.location.origin,
        redirectUri,
        googleClientId: maskClientId(googleClientId),
      });

      if (!googleClientId) {
        reject(new Error(`${t('auth.socialConfigMissing')} (EXPO_PUBLIC_GOOGLE_CLIENT_ID)`));
        return;
      }

      const params = new URLSearchParams();
      params.set('client_id', googleClientId);
      params.set('redirect_uri', redirectUri);
      params.set('response_type', 'id_token');
      params.set('scope', 'openid email profile');
      params.set('prompt', 'select_account');
      params.set('nonce', nonce);
      params.set('state', state);

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

      debugSocial('auth-url', { provider, authUrl });

      const width = 480;
      const height = 640;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        authUrl,
        `${provider}-social-auth`,
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        debugSocial('popup-blocked', { provider });
        reject(new Error(t('auth.socialPopupBlocked')));
        return;
      }

      const maxWaitMs = 120000;
      const startedAt = Date.now();

      const interval = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(interval);
          debugSocial('popup-closed', { provider });
          reject(new Error(t('auth.socialCancelled')));
          return;
        }

        if (Date.now() - startedAt > maxWaitMs) {
          popup.close();
          window.clearInterval(interval);
          debugSocial('popup-timeout', { provider, maxWaitMs });
          reject(new Error(t('auth.socialTimeout')));
          return;
        }

        let href = '';
        try {
          href = popup.location.href;
        } catch (e) {
          return;
        }

        if (!href || !href.startsWith(redirectUri)) return;

        const hash = popup.location.hash || '';
        const paramsFromHash = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
        const tokenFromHash = paramsFromHash.get('id_token');
        const errorFromHash = paramsFromHash.get('error');
        const returnedState = paramsFromHash.get('state');

        if (errorFromHash) {
          popup.close();
          window.clearInterval(interval);
          debugSocial('provider-error', { provider, errorFromHash, returnedState });
          reject(new Error(errorFromHash));
          return;
        }

        if (!tokenFromHash) return;
        if (returnedState && returnedState !== state) {
          popup.close();
          window.clearInterval(interval);
          debugSocial('state-mismatch', { provider, expectedState: state, returnedState });
          reject(new Error(t('auth.socialStateMismatch')));
          return;
        }

        popup.close();
        window.clearInterval(interval);
        debugSocial('token-received', {
          provider,
          tokenLength: tokenFromHash.length,
          returnedState,
        });
        resolve(tokenFromHash);
      }, 500);
    });
  }

  async function handleSocialAuth(provider: SocialProvider) {
    setError('');
    setNotice('');
    setSocialLoadingProvider(provider);
    let idToken = '';
    try {
      idToken = await openSocialPopup(provider);
      debugSocial('api-submit', { provider, idTokenLength: idToken.length });
      const response = provider === 'google'
        ? await api.socialAuthGoogle(idToken)
        : await api.socialAuthApple(idToken);
      debugSocial('api-success', {
        provider,
        username: response.username,
        isNewUser: response.is_new_user,
      });
      if (response.is_new_user) {
        setSocialOnboardingToken(response.token);
        setSocialUsername(response.username || '');
        setAuthMode('socialUsername');
      } else {
        onLogin?.(response.token);
      }
    } catch (e: any) {
      debugSocial('api-error', { provider, message: e?.message });
      if (provider === 'apple' && e instanceof ApiRequestError && e.code === 'apple_account_link_required') {
        setAppleLinkIdToken(idToken);
        setAppleLinkUsername('');
        setAppleLinkCode('');
        setNotice('');
        setAuthMode('appleLinkAccount');
        return;
      }
      setError(e.message || t('auth.socialAuthFailed'));
    } finally {
      setSocialLoadingProvider(null);
    }
  }

  return (
    <ImageBackground
      source={require('../../assets/emojis-bg.png')}
      style={[styles.root, { backgroundColor: c.background }]}
      imageStyle={styles.backgroundImage}
      resizeMode="repeat"
    >
    <KeyboardAvoidingView
      style={styles.rootInner}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {Platform.OS === 'web' && (
        <View style={styles.floatingTopControls} pointerEvents="box-none">
          <LanguagePicker compact={!isWide} />
          <TouchableOpacity
            style={[styles.themeToggle, { borderColor: c.border, backgroundColor: c.background }]}
            onPress={toggleTheme}
            activeOpacity={0.75}
            accessibilityLabel={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
          >
            <Text style={styles.themeToggleIcon}>
              {isDark ? '☀️' : '🌙'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.mainContent, isWide && styles.mainContentWide]}>
          {/* Hero / branding */}
          <View style={[styles.hero, isWide && styles.heroWide]}>
            {Platform.OS !== 'web' && (
              <View style={styles.inlineTopControls}>
                <LanguagePicker compact={!isWide} />
                <TouchableOpacity
                  style={[styles.themeToggle, { borderColor: c.border, backgroundColor: c.background }]}
                  onPress={toggleTheme}
                  activeOpacity={0.75}
                  accessibilityLabel={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
                >
                  <Text style={styles.themeToggleIcon}>
                    {isDark ? '☀️' : '🌙'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.heroTitleRow}>
              <Image
                source={require('../../assets/logo.png')}
                style={[styles.logoImage, isWide && styles.logoImageWide]}
                resizeMode="contain"
              />
              <Text style={[styles.appName, isWide && styles.appNameWide, { color: c.textPrimary }]}>
                Openspace<Text style={[styles.appNameDomain, isWide && styles.appNameDomainWide, { color: c.textMuted }]}>.Social</Text>
              </Text>
            </View>
            <Text style={[styles.tagline, isWide && styles.taglineWide, { color: c.textSecondary }]}>
              {t('tagline')}
            </Text>
            <View style={[styles.federationBadge, isWide && styles.federationBadgeWide, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
              <MaterialCommunityIcons name="lan-connect" size={isWide ? 17 : 15} color={c.textLink} />
              <Text style={[styles.federationBadgeText, isWide && styles.federationBadgeTextWide, { color: c.textPrimary }]}>
                {t('federationBadge')}
              </Text>
            </View>
          </View>

          {/* Login card */}
          <View
            style={[
              styles.card,
              isWide && styles.cardWide,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              shadowColor: isDark ? '#000' : '#94A3B8',
            },
          ]}
        >
          <Text style={[styles.cardTitle, isWide && styles.cardTitleWide, { color: c.textPrimary }]}>
            {authMode === 'login'
              ? t('auth.signIn')
              : authMode === 'signup'
                ? t('auth.getStarted')
                : authMode === 'verifyEmail'
                  ? t('auth.verifyEmailTitle')
                  : authMode === 'socialUsername'
                    ? t('auth.socialUsernameTitle')
                  : authMode === 'appleLinkAccount'
                    ? 'Link Existing Account'
                  : authMode === 'appleLinkVerify'
                    ? 'Verify Email Code'
                  : authMode === 'shareProfile'
                    ? t('auth.shareProfileTitle')
                  : authMode === 'recoverPassword'
                    ? t('auth.recoverPasswordTitle')
                    : authMode === 'recoverAccount'
                      ? t('auth.recoverAccountTitle')
                      : t('auth.resetPasswordTitle')}
          </Text>

          {!!error && (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: c.errorBackground, borderColor: c.errorBorder },
              ]}
            >
              <Text style={[styles.errorText, { color: c.errorText }]}>
                {error}
              </Text>
            </View>
          )}

          {!!notice && !verificationSuccess && (
            <View
              style={[
                styles.noticeBox,
                { backgroundColor: c.inputBackground, borderColor: c.inputBorder },
              ]}
            >
              <Text style={[styles.noticeText, { color: c.textSecondary }]}>
                {notice}
              </Text>
            </View>
          )}

          {authMode === 'login' ? (
            <>
              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.username')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={username}
                onChangeText={setUsername}
                placeholder={t('auth.usernamePlaceholder')}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />

              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.password')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={password}
                onChangeText={setPassword}
                placeholder={t('auth.passwordPlaceholder')}
                placeholderTextColor={c.placeholder}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />

              <View style={styles.forgotLinks}>
                <TouchableOpacity onPress={switchToRecoverPassword}>
                  <Text style={[styles.forgotLink, { color: c.textLink }]}>
                    {t('auth.forgotPassword')}
                  </Text>
                </TouchableOpacity>
                <Text style={[styles.forgotSeparator, { color: c.textMuted }]}>·</Text>
                <TouchableOpacity onPress={switchToRecoverAccount}>
                  <Text style={[styles.forgotLink, { color: c.textLink }]}>
                    {t('auth.forgotEmail')}
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  loading && styles.buttonDisabled,
                ]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>{t('auth.signIn')}</Text>
                )}
              </TouchableOpacity>

              <Text style={[styles.socialDivider, styles.socialDividerBelow, { color: c.textMuted }]}>
                {t('auth.socialOrDividerLogin')}
              </Text>

              <TouchableOpacity
                style={[styles.socialButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => handleSocialAuth('google')}
                disabled={loading || socialLoadingProvider !== null}
                activeOpacity={0.85}
              >
                <View style={styles.socialButtonContent}>
                  <AntDesign name="google" size={16} color="#DB4437" />
                  <Text style={[styles.socialButtonText, { color: c.textPrimary }]}>
                    {socialLoadingProvider === 'google' ? t('auth.socialLoadingGoogle') : t('auth.socialContinueGoogle')}
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Sign in with Apple — iOS + web only. Apple's policy requires
               *  the native AuthenticationServices flow on iOS; Android has
               *  no native Apple Sign-In, and we haven't wired the web
               *  fallback yet, so we hide the button there. */}
              <TouchableOpacity
                style={[styles.socialButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => handleSocialAuth('apple')}
                disabled={loading || socialLoadingProvider !== null}
                activeOpacity={0.85}
              >
                <View style={styles.socialButtonContent}>
                  <AntDesign name="apple" size={17} color={c.textPrimary} />
                  <Text style={[styles.socialButtonText, { color: c.textPrimary }]}>
                    {socialLoadingProvider === 'apple' ? t('auth.socialLoadingApple') : t('auth.socialContinueApple')}
                  </Text>
                </View>
              </TouchableOpacity>
            </>
          ) : authMode === 'signup' ? (
            <>
              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.email')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={signupEmail}
                onChangeText={setSignupEmail}
                placeholder={t('auth.emailPlaceholder')}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
              />

              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.username')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={signupUsername}
                onChangeText={setSignupUsername}
                placeholder={t('auth.usernamePlaceholder')}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />

              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.password')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={signupPassword}
                onChangeText={setSignupPassword}
                placeholder={t('auth.passwordPlaceholder')}
                placeholderTextColor={c.placeholder}
                secureTextEntry
                returnKeyType="next"
              />
              <Text style={[styles.authHelperText, { color: c.textMuted }]}>
                {passwordPolicyHint(t)}
              </Text>

              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.confirmPassword')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={signupConfirmPassword}
                onChangeText={setSignupConfirmPassword}
                placeholder={t('auth.confirmPasswordPlaceholder')}
                placeholderTextColor={c.placeholder}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleRegister}
              />

              <Text style={[styles.agreementText, { color: c.textMuted }]}>
                <Text style={[styles.agreementAge, { color: c.textPrimary }]}>
                  {t('auth.signUpAgeRequirement', {
                    defaultValue: 'You agree to being at least 16 years of age or older. Users aged 16–18 must have parental consent.',
                  })}
                </Text>
                {' '}
                {t('auth.signUpAgreementPrefix')}{' '}
                <Text style={[styles.agreementLink, { color: c.textLink }]} onPress={() => setTermsOfUseOpen(true)}>
                  {t('footer.termsOfUse')}
                </Text>
                {', '}
                <Text style={[styles.agreementLink, { color: c.textLink }]} onPress={() => setGuidelinesOpen(true)}>
                  {t('footer.guidelines')}
                </Text>
                {' '}{t('auth.signUpAgreementAnd')}{' '}
                <Text style={[styles.agreementLink, { color: c.textLink }]} onPress={() => setPrivacyPolicyOpen(true)}>
                  {t('footer.privacyPolicy')}
                </Text>
                {'.'}
              </Text>

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  loading && styles.buttonDisabled,
                ]}
                onPress={handleRegister}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>{t('auth.getStarted')}</Text>
                )}
              </TouchableOpacity>

              <Text style={[styles.socialDivider, styles.socialDividerBelow, { color: c.textMuted }]}>
                {t('auth.socialOrDivider')}
              </Text>

              <TouchableOpacity
                style={[styles.socialButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => handleSocialAuth('google')}
                disabled={loading || socialLoadingProvider !== null}
                activeOpacity={0.85}
              >
                <View style={styles.socialButtonContent}>
                  <AntDesign name="google" size={16} color="#DB4437" />
                  <Text style={[styles.socialButtonText, { color: c.textPrimary }]}>
                    {socialLoadingProvider === 'google' ? t('auth.socialLoadingGoogle') : t('auth.socialContinueGoogle')}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.socialButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => handleSocialAuth('apple')}
                disabled={loading || socialLoadingProvider !== null}
                activeOpacity={0.85}
              >
                <View style={styles.socialButtonContent}>
                  <AntDesign name="apple" size={17} color={c.textPrimary} />
                  <Text style={[styles.socialButtonText, { color: c.textPrimary }]}>
                    {socialLoadingProvider === 'apple' ? t('auth.socialLoadingApple') : t('auth.socialContinueApple')}
                  </Text>
                </View>
              </TouchableOpacity>
            </>
          ) : authMode === 'socialUsername' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                {t('auth.socialUsernameDescription')}
              </Text>

              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.username')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={socialUsername}
                onChangeText={setSocialUsername}
                placeholder={t('auth.usernamePlaceholder')}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleCompleteSocialUsername}
              />

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  loading && styles.buttonDisabled,
                ]}
                onPress={handleCompleteSocialUsername}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>{t('auth.socialUsernameCta')}</Text>
                )}
              </TouchableOpacity>
            </>
          ) : authMode === 'appleLinkAccount' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                We see you are using passkey so we are unable to automatically link existing accounts.
                {'\n\n'}
                If you already have an account with us, enter your username and we will send a verification code to your email.
                {'\n'}
                If you do not already have an account with us, proceed to the next step.
              </Text>
              <Text style={[styles.label, { color: c.textSecondary }]}>Existing Username (Optional if this is a new account)</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={appleLinkUsername}
                onChangeText={setAppleLinkUsername}
                placeholder={t('auth.usernamePlaceholder')}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleAppleLinkRequestCode}
              />
              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  loading && styles.buttonDisabled,
                ]}
                onPress={handleAppleLinkRequestCode}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Send Verification Code</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.background }]}
                onPress={handleAppleProceedOnboarding}
                disabled={loading}
                activeOpacity={0.85}
              >
                <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                  Proceed To Next Step
                </Text>
              </TouchableOpacity>
            </>
          ) : authMode === 'appleLinkVerify' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                Enter the verification code sent to your account email for username {appleLinkUsername || ''}.
              </Text>
              <Text style={[styles.label, { color: c.textSecondary }]}>Verification Code</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={appleLinkCode}
                onChangeText={setAppleLinkCode}
                placeholder={t('auth.verificationCodePlaceholder')}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={handleAppleLinkConfirm}
              />
              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  loading && styles.buttonDisabled,
                ]}
                onPress={handleAppleLinkConfirm}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Verify & Link Account</Text>
                )}
              </TouchableOpacity>
            </>
          ) : authMode === 'shareProfile' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                {t('auth.shareProfileDescription', { username: shareFlowUsername ? `@${shareFlowUsername}` : t('auth.newAccountLabel') })}
              </Text>

              <View style={styles.shareGrid}>
                <TouchableOpacity
                  style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.background }, styles.shareChip]}
                  onPress={() => handleShareProfile('instagram')}
                  activeOpacity={0.85}
                >
                  <View style={styles.shareButtonContent}>
                    <MaterialCommunityIcons name="instagram" size={16} color={c.textLink} />
                    <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                      {t('auth.shareInstagram')}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.background }, styles.shareChip]}
                  onPress={() => handleShareProfile('facebook')}
                  activeOpacity={0.85}
                >
                  <View style={styles.shareButtonContent}>
                    <MaterialCommunityIcons name="facebook" size={16} color={c.textLink} />
                    <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                      {t('auth.shareFacebook')}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.background }, styles.shareChip]}
                  onPress={() => handleShareProfile('x')}
                  activeOpacity={0.85}
                >
                  <View style={styles.shareButtonContent}>
                    <MaterialCommunityIcons name="twitter" size={16} color={c.textLink} />
                    <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                      {t('auth.shareX')}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.background }, styles.shareChip]}
                  onPress={() => handleShareProfile('bluesky')}
                  activeOpacity={0.85}
                >
                  <View style={styles.shareButtonContent}>
                    <MaterialCommunityIcons name="butterfly-outline" size={16} color={c.textLink} />
                    <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                      {t('auth.shareBluesky')}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.background }, styles.shareChip]}
                  onPress={() => handleShareProfile('reddit')}
                  activeOpacity={0.85}
                >
                  <View style={styles.shareButtonContent}>
                    <MaterialCommunityIcons name="reddit" size={16} color={c.textLink} />
                    <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                      {t('auth.shareReddit')}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  loading && styles.buttonDisabled,
                ]}
                onPress={finishShareAndContinue}
                disabled={loading}
                activeOpacity={0.85}
              >
                <Text style={styles.buttonText}>{t('auth.shareContinueCta')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.background }]}
                onPress={finishShareAndContinue}
                activeOpacity={0.85}
              >
                <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                  {t('auth.shareSkipCta')}
                </Text>
              </TouchableOpacity>
            </>
          ) : authMode === 'recoverPassword' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                {t('auth.recoverPasswordDescription')}
              </Text>

              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.recoveryEmailLabel')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={recoveryEmail}
                onChangeText={setRecoveryEmail}
                placeholder={t('auth.recoveryEmailPlaceholder')}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="done"
                onSubmitEditing={handlePasswordRecovery}
              />

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  loading && styles.buttonDisabled,
                ]}
                onPress={handlePasswordRecovery}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>{t('auth.sendRecoveryEmail')}</Text>
                )}
              </TouchableOpacity>
            </>
          ) : authMode === 'recoverAccount' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                {t('auth.recoverAccountDescription')}
              </Text>

              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.recoveryIdentifierLabel')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={recoveryIdentifier}
                onChangeText={setRecoveryIdentifier}
                placeholder={t('auth.recoveryIdentifierPlaceholder')}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleAccountRecovery}
              />

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  loading && styles.buttonDisabled,
                ]}
                onPress={handleAccountRecovery}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>{t('auth.sendRecoveryEmail')}</Text>
                )}
              </TouchableOpacity>
            </>
          ) : authMode === 'resetPassword' ? (
            <>
              {passwordResetSuccess ? (
                <>
                  <View
                    style={[
                      styles.successBox,
                      {
                        backgroundColor: isDark ? '#052E1A' : '#ECFDF3',
                        borderColor: isDark ? '#166534' : '#86EFAC',
                      },
                    ]}
                  >
                    <Text style={[styles.successTitle, { color: isDark ? '#86EFAC' : '#166534' }]}>
                      {t('auth.passwordResetSuccess')}
                    </Text>
                    <Text style={[styles.successSubtitle, { color: isDark ? '#BBF7D0' : '#14532D' }]}>
                      {t('auth.passwordResetSuccessDescription')}
                    </Text>
                  </View>
                </>
              ) : !passwordResetToken ? (
                // ── Step 1: enter the 6-digit code ─────────────────────────
                // Shown when the user came in via "Use a code" rather than
                // tapping the Universal Link in the email. The code is
                // exchanged for a JWT server-side; once we have the JWT,
                // state flips and we render Step 2.
                <>
                  <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                    {t('auth.resetPasswordCodeDescription', { defaultValue: 'Enter the 6-digit code from your reset email.' })}
                  </Text>

                  <Text style={[styles.label, { color: c.textSecondary }]}>
                    {t('auth.resetCodeLabel', { defaultValue: 'Reset code' })}
                  </Text>
                  <TextInput
                    key="reset-otp-input"
                    style={[
                      styles.input,
                      {
                        backgroundColor: c.inputBackground,
                        borderColor: c.inputBorder,
                        color: c.textPrimary,
                        letterSpacing: 4,
                      },
                    ]}
                    value={passwordResetCode}
                    onChangeText={(v) => setPasswordResetCode(v.replace(/\D/g, '').slice(0, 6))}
                    placeholder={t('auth.resetCodePlaceholder', { defaultValue: '123456' })}
                    placeholderTextColor={c.placeholder}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    maxLength={6}
                    returnKeyType="done"
                    onSubmitEditing={handleVerifyResetCode}
                  />

                  <TouchableOpacity
                    style={[
                      styles.button,
                      { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                      loading && styles.buttonDisabled,
                    ]}
                    onPress={handleVerifyResetCode}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>
                        {t('auth.verifyResetCodeButton', { defaultValue: 'Verify code' })}
                      </Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                // ── Step 2: choose a new password ──────────────────────────
                // Reached either by tapping the email link (token loaded
                // automatically from the URL) or by completing Step 1 above.
                <>
                  <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                    {t('auth.resetPasswordDescription')}
                  </Text>

                  <Text style={[styles.label, { color: c.textSecondary }]}>
                    {t('auth.newPasswordLabel')}
                  </Text>
                  <TextInput
                    key="reset-new-password-input"
                    style={[
                      styles.input,
                      {
                        backgroundColor: c.inputBackground,
                        borderColor: c.inputBorder,
                        color: c.textPrimary,
                      },
                    ]}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder={t('auth.newPasswordPlaceholder')}
                    placeholderTextColor={c.placeholder}
                    secureTextEntry
                    returnKeyType="next"
                  />
                  <Text style={[styles.authHelperText, { color: c.textMuted }]}>
                    {passwordPolicyHint(t)}
                  </Text>

                  <Text style={[styles.label, { color: c.textSecondary }]}>
                    {t('auth.confirmNewPasswordLabel')}
                  </Text>
                  <TextInput
                    key="reset-confirm-password-input"
                    style={[
                      styles.input,
                      {
                        backgroundColor: c.inputBackground,
                        borderColor: c.inputBorder,
                        color: c.textPrimary,
                      },
                    ]}
                    value={confirmNewPassword}
                    onChangeText={setConfirmNewPassword}
                    placeholder={t('auth.confirmNewPasswordPlaceholder')}
                    placeholderTextColor={c.placeholder}
                    secureTextEntry
                    returnKeyType="done"
                    onSubmitEditing={handlePasswordResetSubmit}
                  />

                  <TouchableOpacity
                    style={[
                      styles.button,
                      { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                      loading && styles.buttonDisabled,
                    ]}
                    onPress={handlePasswordResetSubmit}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>{t('auth.resetPasswordButton')}</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : (
            <>
              {verificationSuccess ? (
                <>
                  <View
                    style={[
                      styles.successBox,
                      {
                        backgroundColor: isDark ? '#052E1A' : '#ECFDF3',
                        borderColor: isDark ? '#166534' : '#86EFAC',
                      },
                    ]}
                  >
                    <Text style={[styles.successTitle, { color: isDark ? '#86EFAC' : '#166534' }]}>
                      {t('auth.verificationSuccess')}
                    </Text>
                    <Text style={[styles.successSubtitle, { color: isDark ? '#BBF7D0' : '#14532D' }]}>
                      {t('auth.verifyEmailDescription', { email: verificationEmail || t('auth.yourEmail') })}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.button,
                      { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                      loading && styles.buttonDisabled,
                    ]}
                    onPress={completeVerifiedLogin}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.buttonText}>{t('auth.continueToApp')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                    {t('auth.verifyEmailDescription', { email: verificationEmail || t('auth.yourEmail') })}
                  </Text>

                  <Text style={[styles.label, { color: c.textSecondary }]}>
                    {t('auth.verificationCodeLabel')}
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: c.inputBackground,
                        borderColor: c.inputBorder,
                        color: c.textPrimary,
                      },
                    ]}
                    value={verificationCode}
                    onChangeText={setVerificationCode}
                    placeholder={t('auth.verificationCodePlaceholder')}
                    placeholderTextColor={c.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    onSubmitEditing={handleVerifyEmail}
                    maxLength={6}
                  />

                  <TouchableOpacity
                    style={[
                      styles.button,
                      { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                      loading && styles.buttonDisabled,
                    ]}
                    onPress={handleVerifyEmail}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>{t('auth.verifyEmailCta')}</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.background }]}
                    onPress={handleResendVerificationCode}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                      {t('auth.resendVerificationCode')}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          <View style={styles.footer}>
            {authMode === 'login' ? (
              <>
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                  {t('auth.dontHaveAccount')}{' '}
                </Text>
                <TouchableOpacity onPress={switchToSignup}>
                  <Text style={[styles.footerLink, { color: c.textLink }]}>
                    {t('auth.getStarted')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : authMode === 'signup' ? (
              <>
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                  {t('auth.alreadyHaveAccount')}{' '}
                </Text>
                <TouchableOpacity onPress={switchToLogin}>
                  <Text style={[styles.footerLink, { color: c.textLink }]}>
                    {t('auth.signIn')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : authMode === 'verifyEmail' ? (
              <>
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                  {t('auth.wrongEmailPrompt')}{' '}
                </Text>
                <TouchableOpacity onPress={switchToSignup}>
                  <Text style={[styles.footerLink, { color: c.textLink }]}>
                    {t('auth.goBackToSignUp')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : authMode === 'socialUsername' ? (
              <>
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                  {t('auth.needDifferentAccountPrompt')}{' '}
                </Text>
                <TouchableOpacity onPress={switchToLogin}>
                  <Text style={[styles.footerLink, { color: c.textLink }]}>
                    {t('auth.backToSignIn')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : authMode === 'appleLinkAccount' || authMode === 'appleLinkVerify' ? (
              <>
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                  Already linked or changed your mind?{' '}
                </Text>
                <TouchableOpacity onPress={switchToLogin}>
                  <Text style={[styles.footerLink, { color: c.textLink }]}>
                    {t('auth.backToSignIn')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : authMode === 'shareProfile' ? (
              <>
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                  {t('auth.shareSkipHint')}{' '}
                </Text>
                <TouchableOpacity onPress={finishShareAndContinue}>
                  <Text style={[styles.footerLink, { color: c.textLink }]}>
                    {t('auth.shareSkipCta')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                  {t('auth.rememberedCredentials')}{' '}
                </Text>
                <TouchableOpacity onPress={switchToLogin}>
                  <Text style={[styles.footerLink, { color: c.textLink }]}>
                    {t('auth.backToSignIn')}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
          </View>
        </View>

        <View style={styles.bottomLinks}>
          {headerLinks.map((key, idx) => (
            <React.Fragment key={key}>
              {idx > 0 && (
                <Text style={[styles.bottomLinkSeparator, { color: c.textMuted }]}>·</Text>
              )}
              <TouchableOpacity
                onPress={() => handleHeaderLinkPress(key)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={[styles.bottomLink, { color: c.textMuted }]}>
                  {t(`footer.${key}Short`, { defaultValue: shortFooterLabel(key) })}
                </Text>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>

        <Text style={[styles.copyright, { color: c.textMuted }]}>
          © 2026–2027 Openspace.Social. All rights reserved.
        </Text>
      </ScrollView>
      <AboutUsDrawer visible={aboutUsOpen} onClose={() => setAboutUsOpen(false)} />
      <PrivacyPolicyDrawer visible={privacyPolicyOpen} onClose={() => setPrivacyPolicyOpen(false)} />
      <TermsOfUseDrawer visible={termsOfUseOpen} onClose={() => setTermsOfUseOpen(false)} />
      <GuidelinesDrawer visible={guidelinesOpen} onClose={() => setGuidelinesOpen(false)} />

      {/* Full-screen sign-in overlay — visible whenever a social provider's
       *  round-trip is in flight. Without this the user lands back on the
       *  splash screen post-redirect and sees no feedback while the
       *  backend exchange + login completes. */}
      {socialLoadingProvider !== null ? (
        <View
          pointerEvents="auto"
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: 'rgba(0,0,0,0.45)',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
            },
          ]}
        >
          <View style={{ backgroundColor: c.surface, paddingHorizontal: 24, paddingVertical: 20, borderRadius: 14, alignItems: 'center', gap: 10, minWidth: 220 }}>
            <ActivityIndicator color={c.primary} size="large" />
            <Text style={{ color: c.textPrimary, fontWeight: '700', fontSize: 14 }}>
              {socialLoadingProvider === 'google'
                ? t('auth.socialLoadingGoogle')
                : t('auth.socialLoadingApple')}
            </Text>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const CARD_MAX_WIDTH = 440;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  rootInner: {
    flex: 1,
  },
  backgroundImage: {
    opacity: 0.40,
  },
  floatingTopControls: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 12,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 10,
  },
  inlineTopControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 14,
  },
  themeToggle: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  themeToggleIcon: {
    fontSize: 18,
  },
  bottomLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    gap: 6,
  },
  bottomLink: {
    fontSize: 13,
    fontWeight: '500',
  },
  bottomLinkSeparator: {
    fontSize: 13,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  scrollWide: {
    paddingVertical: 48,
  },
  mainContent: {
    width: '100%',
    alignItems: 'center',
    flexDirection: 'column',
    gap: 20,
  },
  mainContentWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 72,
  },
  hero: {
    alignItems: 'center',
  },
  heroWide: {
    flex: 1,
    maxWidth: 400,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 4,
  },
  logoImage: {
    width: 44,
    height: 44,
  },
  logoImageWide: {
    width: 56,
    height: 56,
  },
  appName: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  appNameWide: {
    fontSize: 32,
  },
  appNameDomain: {
    fontSize: 28,
    fontWeight: '400',
    letterSpacing: -0.5,
  },
  appNameDomainWide: {
    fontSize: 32,
  },
  tagline: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 20,
  },
  taglineWide: {
    fontSize: 16,
    lineHeight: 24,
  },
  federationBadge: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  federationBadgeWide: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  federationBadgeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  federationBadgeTextWide: {
    fontSize: 15,
  },
  card: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  cardWide: {
    padding: 28,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 14,
  },
  cardTitleWide: {
    fontSize: 22,
    marginBottom: 20,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
  },
  noticeBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: {
    fontSize: 14,
  },
  verificationIntro: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 14,
  },
  successBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  successTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  successSubtitle: {
    fontSize: 13,
    lineHeight: 20,
  },
  socialButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  socialButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  socialButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  socialDivider: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
    marginTop: 2,
  },
  socialDividerBelow: {
    marginTop: 14,
    marginBottom: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
    outlineStyle: 'none',
  } as any,
  authHelperText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: -8,
    marginBottom: 12,
    lineHeight: 17,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  secondaryAction: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  shareGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  shareChip: {
    marginTop: 0,
    marginBottom: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  shareButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  forgotLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: -4,
    marginBottom: 10,
    gap: 6,
  },
  forgotLink: {
    fontSize: 13,
    fontWeight: '500',
  },
  forgotSeparator: {
    fontSize: 13,
  },
  agreementText: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
    marginTop: 4,
  },
  agreementAge: {
    fontSize: 12,
    fontWeight: '700',
  },
  agreementLink: {
    fontSize: 12,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 14,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: '600',
  },
  copyright: {
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
});
