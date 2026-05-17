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
  Share,
  Switch,
  useWindowDimensions,
} from 'react-native';
import { AntDesign } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ApiRequestError, api, type FederatedIdentityJob } from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import LanguagePicker from '../components/LanguagePicker';
import AboutUsDrawer from '../components/AboutUsDrawer';
import PrivacyPolicyDrawer from '../components/PrivacyPolicyDrawer';
import TermsOfUseDrawer from '../components/TermsOfUseDrawer';
import GuidelinesDrawer from '../components/GuidelinesDrawer';
import { AppRoute } from '../routing';
import { useAppToast } from '../toast/AppToastContext';
import { passwordPolicyHint, validatePasswordAgainstBackendPolicy } from '../utils/passwordPolicy';
import { AppleSignInCancelled, webAppleSignIn } from '../utils/webAppleAuth';
import { WebForm } from '../utils/WebForm';
import {
  clearFederationVisitorAttribution,
  loadFederationVisitorAttribution,
  setFederationVisitorPreferredAuthMode,
  type FederationPreferredAuthMode,
} from '../utils/federationAttribution';
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
  route?: AppRoute;
  onNavigate?: (next: AppRoute, replace?: boolean) => void;
}

type SocialProvider = 'google' | 'apple';

function formatMastodonJobLabel(jobType: FederatedIdentityJob['job_type']) {
  switch (jobType) {
    case 'import_follows':
      return 'Follow import';
    case 'import_followers':
      return 'Follower preview';
    case 'auto_follow_old_account':
      return 'Auto-follow old account';
    case 'migration_notice':
      return 'Migration notice';
    case 'crosspost_setup':
      return 'Cross-posting';
    case 'mirror_posts':
      return 'Post mirroring';
    default:
      return jobType.replace(/_/g, ' ');
  }
}

function formatMastodonJobStatus(job: FederatedIdentityJob) {
  switch (job.status) {
    case 'queued':
      return 'Requested and running in the background';
    case 'running':
      return 'Working in the background';
    case 'completed':
      if (job.job_type === 'crosspost_setup') {
        return 'Enabled';
      }
      return 'Finished';
    case 'failed':
      return 'Needs attention';
    default:
      return job.status;
  }
}

export default function LandingScreen({ onLogin, route, onNavigate }: LandingScreenProps) {
  const { theme, isDark, toggleTheme } = useTheme();
  const { showToast } = useAppToast();
  const { t } = useTranslation();
  const c = theme.colors;
  const { width } = useWindowDimensions();
  const isWide = width >= 860;

  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'verifyEmail' | 'recoverPassword' | 'recoverAccount' | 'resetPassword' | 'socialUsername' | 'linkMastodon' | 'mastodonChooseFlow' | 'continueMastodon' | 'mastodonSetupChecklist' | 'shareProfile' | 'appleLinkAccount' | 'appleLinkVerify' | 'mastodonLinkAccount' | 'mastodonLinkVerify'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  // Defaults to true (opt-out style) — user can untick before submitting. We record the
  // user's actual choice on the EmailSubscription via the marketing_consent payload field,
  // which the Django RegisterSerializer wires through apply_signup_marketing_consent().
  const [signupMarketingConsent, setSignupMarketingConsent] = useState(true);
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
  // Mastodon-link onboarding step (slots in between verifyEmail/socialUsername
  // and shareProfile). Reuses the shareFlowToken — that's the auth token
  // the user has just been issued by register/verifyEmail/socialAuth, and
  // it's already authorised to call /api/auth/user/federation/link/.
  const [onboardingMastodonInput, setOnboardingMastodonInput] = useState('');
  const [onboardingMastodonLinking, setOnboardingMastodonLinking] = useState(false);
  const [mastodonContinueInput, setMastodonContinueInput] = useState('');
  const [mastodonContinueLoading, setMastodonContinueLoading] = useState(false);
  const [mastodonOnboardingIdentityId, setMastodonOnboardingIdentityId] = useState<number | null>(null);
  const [mastodonOnboardingRemoteHandle, setMastodonOnboardingRemoteHandle] = useState('');
  const [mastodonOnboardingLocalActorUrl, setMastodonOnboardingLocalActorUrl] = useState('');
  const [mastodonOnboardingSuggestedUsernames, setMastodonOnboardingSuggestedUsernames] = useState<string[]>([]);
  const [mastodonOnboardingJobs, setMastodonOnboardingJobs] = useState<FederatedIdentityJob[]>([]);
  const [appleLinkIdToken, setAppleLinkIdToken] = useState('');
  const [appleLinkUsername, setAppleLinkUsername] = useState('');
  const [appleLinkCode, setAppleLinkCode] = useState('');
  const [mastodonLinkUsernameInput, setMastodonLinkUsernameInput] = useState('');
  const [mastodonLinkInstanceInput, setMastodonLinkInstanceInput] = useState('');
  const [mastodonLinkLoading, setMastodonLinkLoading] = useState(false);
  const [mastodonLinkToken, setMastodonLinkToken] = useState('');
  const [mastodonLinkUsernameDisplay, setMastodonLinkUsernameDisplay] = useState('');
  const [mastodonLinkCode, setMastodonLinkCode] = useState('');
  const [federationReferralToken, setFederationReferralToken] = useState('');
  const [federationVisitorMode, setFederationVisitorMode] = useState<FederationPreferredAuthMode | null>(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [socialLoadingProvider, setSocialLoadingProvider] = useState<SocialProvider | null>(null);
  const [error, setError] = useState('');
  const [aboutUsOpen, setAboutUsOpen] = useState(false);
  const [privacyPolicyOpen, setPrivacyPolicyOpen] = useState(false);
  const [termsOfUseOpen, setTermsOfUseOpen] = useState(false);
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);

  // Sync the legal drawers with the route. When the user lands on /terms,
  // /privacy, /about, or /guidelines (either by typing the URL or by tapping
  // a footer/agreement link that called onNavigate), open the matching drawer.
  // Closing a drawer below calls onNavigate({screen:'landing'}) which flips
  // the URL back to / and unsets the drawer here on the next render.
  useEffect(() => {
    setAboutUsOpen(route?.screen === 'about');
    setPrivacyPolicyOpen(route?.screen === 'privacy');
    setTermsOfUseOpen(route?.screen === 'terms');
    setGuidelinesOpen(route?.screen === 'guidelines');
  }, [route?.screen]);

  // When the user taps a drawer-opening button (footer link, agreement text),
  // change the URL via onNavigate. The useEffect above then opens the drawer.
  // If onNavigate isn't wired (e.g. running on native), fall back to setting
  // the local state directly so the drawer still works.
  const openLegalDrawer = (screen: 'about' | 'privacy' | 'terms' | 'guidelines') => {
    if (onNavigate) {
      onNavigate({ screen });
      return;
    }
    if (screen === 'about') setAboutUsOpen(true);
    if (screen === 'privacy') setPrivacyPolicyOpen(true);
    if (screen === 'terms') setTermsOfUseOpen(true);
    if (screen === 'guidelines') setGuidelinesOpen(true);
  };

  const closeLegalDrawer = () => {
    if (onNavigate) {
      onNavigate({ screen: 'landing' });
      return;
    }
    setAboutUsOpen(false);
    setPrivacyPolicyOpen(false);
    setTermsOfUseOpen(false);
    setGuidelinesOpen(false);
  };
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

  useEffect(() => {
    let cancelled = false;
    loadFederationVisitorAttribution()
      .then((context) => {
        if (cancelled || !context?.visitorToken) return;
        setFederationReferralToken(context.visitorToken);
        setFederationVisitorMode(context.preferredAuthMode || 'signup');
        setAuthMode((currentMode) => {
          if (currentMode !== 'login') return currentMode;
          return context.preferredAuthMode === 'mastodon' ? 'mastodonChooseFlow' : 'signup';
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
      openLegalDrawer('about');
      return;
    }
    if (key === 'privacyPolicy') {
      openLegalDrawer('privacy');
      return;
    }
    if (key === 'termsOfUse') {
      openLegalDrawer('terms');
      return;
    }
    if (key === 'guidelines') {
      openLegalDrawer('guidelines');
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
      void clearFederationVisitorAttribution();
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
        marketing_consent: signupMarketingConsent,
        ...(federationReferralToken ? { federation_referral_token: federationReferralToken } : {}),
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
    setMastodonContinueInput('');
    setMastodonOnboardingIdentityId(null);
    setMastodonOnboardingRemoteHandle('');
    setMastodonOnboardingLocalActorUrl('');
    setMastodonOnboardingSuggestedUsernames([]);
    setMastodonOnboardingJobs([]);
    setAppleLinkIdToken('');
    setAppleLinkUsername('');
    setAppleLinkCode('');
  }

  function switchToSignup() {
    setAuthMode('signup');
    setFederationVisitorMode('signup');
    void setFederationVisitorPreferredAuthMode('signup');
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
    setAuthMode('linkMastodon');
  }

  function finishShareAndContinue() {
    if (!shareFlowToken) {
      setError(t('auth.errorShareSessionMissing'));
      return;
    }
    void clearFederationVisitorAttribution();
    onLogin?.(shareFlowToken);
  }

  // Onboarding-time Mastodon link. Mirrors the OAuth flow used by the
  // post-signup LinkedAccountsScreen but operates against `shareFlowToken`
  // (the token the user just received from register / verifyEmail /
  // social auth), and advances to the share-profile step on success.
  async function handleOnboardingLinkMastodon() {
    const value = onboardingMastodonInput.trim();
    if (!value) {
      setError(
        t('home.mastodonIdentifierRequired', {
          defaultValue: 'Enter a Mastodon instance URL or @name@instance to continue.',
        }),
      );
      return;
    }
    if (!shareFlowToken) {
      setError(t('auth.errorShareSessionMissing'));
      return;
    }
    setError('');
    setNotice('');
    setOnboardingMastodonLinking(true);
    try {
      const redirectUri = Platform.OS === 'web'
        ? `${window.location.origin.replace(/\/+$/, '')}/mastodon-callback`
        : 'openspacesocial://mastodon-callback';
      const started = await api.startFederatedLink(shareFlowToken, {
        redirect_uri: redirectUri,
        acct: value.startsWith('@') ? value : undefined,
        instance_domain: value.startsWith('@') ? undefined : value,
      });
      const authResult = await WebBrowser.openAuthSessionAsync(started.authorization_url, redirectUri);
      if (authResult.type !== 'success' || !authResult.url) {
        throw new Error(
          t('home.mastodonAuthorizationFailed', {
            defaultValue: 'Mastodon authorization was cancelled or failed.',
          }),
        );
      }
      const parsed = new URL(authResult.url);
      const code = parsed.searchParams.get('code');
      const state = parsed.searchParams.get('state');
      if (!code || !state) {
        throw new Error(
          t('home.mastodonMissingCallbackParams', {
            defaultValue: 'Mastodon did not return the expected authorization details.',
          }),
        );
      }
      await api.completeFederatedLink(shareFlowToken, { code, state });
      setOnboardingMastodonInput('');
      setNotice(
        t('home.mastodonLinkSuccess', {
          defaultValue: 'Mastodon account linked successfully.',
        }),
      );
      setAuthMode('shareProfile');
    } catch (e: any) {
      setError(
        e?.message
        || t('home.mastodonLinkFailed', { defaultValue: 'Could not link your Mastodon account.' }),
      );
    } finally {
      setOnboardingMastodonLinking(false);
    }
  }

  function skipOnboardingMastodon() {
    setError('');
    setNotice('');
    setAuthMode('shareProfile');
  }

  function switchToContinueMastodon() {
    setError('');
    setNotice('');
    setFederationVisitorMode('mastodon');
    void setFederationVisitorPreferredAuthMode('mastodon');
    setMastodonContinueInput('');
    setMastodonLinkUsernameInput('');
    setMastodonLinkInstanceInput('');
    setMastodonLinkCode('');
    setMastodonLinkToken('');
    setAuthMode('mastodonChooseFlow');
  }

  function getMastodonOnboardingRedirectUri() {
    return Platform.OS === 'web'
      ? window.location.origin.replace(/\/+$/, '')
      : 'openspacesocial://mastodon-auth-complete';
  }

  function parseMastodonOnboardingCallback(url: string, expectedRedirectUri: string) {
    const parsed = new URL(url);
    const normalizedExpected = expectedRedirectUri.replace(/\/+$/, '');
    const callbackBase = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
    if (callbackBase !== normalizedExpected) {
      throw new Error(
        t('auth.mastodonUnexpectedCallback', {
          defaultValue: 'Received an unexpected Mastodon callback.',
        }),
      );
    }
    const fragment = new URLSearchParams((parsed.hash || '').replace(/^#/, ''));
    if (fragment.get('status') !== 'success') {
      throw new Error(
        fragment.get('error') ||
        t('auth.mastodonOnboardingFailed', {
          defaultValue: 'Mastodon sign in was cancelled or failed.',
        }),
      );
    }
    const token = fragment.get('token');
    const username = fragment.get('username');
    const identityLinkId = Number(fragment.get('identity_link_id') || '0');
    if (!token || !username || !identityLinkId) {
      throw new Error(
        t('auth.mastodonMissingCallbackParams', {
          defaultValue: 'Mastodon did not return the expected onboarding details.',
        }),
      );
    }
    return {
      token,
      username,
      isNewUser: fragment.get('is_new_user') === '1',
      identityLinkId,
      linkedAccountId: fragment.get('linked_account_id') ? Number(fragment.get('linked_account_id')) : null,
      remoteHandle: fragment.get('remote_handle') || '',
      localActorUrl: fragment.get('local_actor_url') || '',
      usernameSuggestions: (() => {
        try {
          return JSON.parse(fragment.get('username_suggestions') || '[]');
        } catch {
          return [];
        }
      })() as string[],
    };
  }

  async function handleContinueWithMastodon() {
    const handleOrInstance = mastodonContinueInput.trim();
    if (!handleOrInstance) {
      setError(
        t('auth.mastodonIdentifierRequired', {
          defaultValue: 'Enter a Mastodon handle or instance to continue.',
        }),
      );
      return;
    }

    setError('');
    setNotice('');
    setMastodonContinueLoading(true);
    try {
      const frontendRedirectUri = getMastodonOnboardingRedirectUri();
      const started = await api.startMastodonOnboarding({
        handleOrInstance,
        frontend_redirect_uri: frontendRedirectUri,
        ...(federationReferralToken ? { federation_referral_token: federationReferralToken } : {}),
      });
      const authResult = await WebBrowser.openAuthSessionAsync(started.redirectUrl, frontendRedirectUri);
      if (authResult.type !== 'success' || !authResult.url) {
        throw new Error(
          t('auth.mastodonOnboardingCancelled', {
            defaultValue: 'Mastodon authorization was cancelled.',
          }),
        );
      }
      const callback = parseMastodonOnboardingCallback(authResult.url, frontendRedirectUri);
      if (!callback.isNewUser) {
        void clearFederationVisitorAttribution();
        onLogin?.(callback.token);
        return;
      }
      setShareFlowToken(callback.token);
      setShareFlowUsername(callback.username);
      setMastodonOnboardingIdentityId(callback.identityLinkId);
      setMastodonOnboardingRemoteHandle(callback.remoteHandle);
      setMastodonOnboardingLocalActorUrl(callback.localActorUrl || `https://openspace.social/${callback.username}`);
      setMastodonOnboardingSuggestedUsernames(callback.usernameSuggestions || []);
      setMastodonOnboardingJobs([]);
      setNotice(
        t('auth.mastodonOnboardingVerified', {
          defaultValue: 'Verified {{remoteHandle}} and created @{{username}} on OpenSpace.',
          remoteHandle: callback.remoteHandle || handleOrInstance,
          username: callback.username,
        }),
      );
      setAuthMode('mastodonSetupChecklist');
    } catch (e: any) {
      setError(e?.message || t('auth.mastodonOnboardingFailed', { defaultValue: 'Could not continue with Mastodon.' }));
    } finally {
      setMastodonContinueLoading(false);
    }
  }

  function parseMastodonLinkCallback(url: string, expectedRedirect: string) {
    const parsed = new URL(url);
    const expected = new URL(expectedRedirect);
    const normalizedExpected = `${expected.protocol}//${expected.host}${expected.pathname}`.replace(/\/+$/, '');
    const callbackBase = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
    if (callbackBase !== normalizedExpected) {
      throw new Error(
        t('auth.mastodonUnexpectedCallback', {
          defaultValue: 'Received an unexpected Mastodon callback.',
        }),
      );
    }
    const fragment = new URLSearchParams((parsed.hash || '').replace(/^#/, ''));
    if (fragment.get('status') !== 'success') {
      throw new Error(
        fragment.get('error') ||
        t('auth.mastodonLinkFailed', {
          defaultValue: 'Mastodon link failed or was cancelled.',
        }),
      );
    }
    const flow = fragment.get('flow') || 'link_existing';
    const isAlreadyLinked = fragment.get('is_already_linked') === '1';
    return {
      flow,
      isAlreadyLinked,
      token: fragment.get('token') || '',
      username: fragment.get('username') || '',
      linkToken: fragment.get('link_token') || '',
    };
  }

  async function handleStartMastodonLink() {
    const username = mastodonLinkUsernameInput.trim();
    const handleOrInstance = mastodonLinkInstanceInput.trim();
    if (!username) {
      setError(
        t('auth.mastodonLinkUsernameRequired', {
          defaultValue: 'Enter your existing Openspace username to link.',
        }),
      );
      return;
    }
    if (!handleOrInstance) {
      setError(
        t('auth.mastodonIdentifierRequired', {
          defaultValue: 'Enter a Mastodon handle or instance to continue.',
        }),
      );
      return;
    }

    setError('');
    setNotice('');
    setMastodonLinkLoading(true);
    try {
      const frontendRedirectUri = getMastodonOnboardingRedirectUri();
      const started = await api.startMastodonOnboarding({
        handleOrInstance,
        frontend_redirect_uri: frontendRedirectUri,
        flow: 'link_existing',
        existing_username: username,
        ...(federationReferralToken ? { federation_referral_token: federationReferralToken } : {}),
      });
      const authResult = await WebBrowser.openAuthSessionAsync(started.redirectUrl, frontendRedirectUri);
      if (authResult.type !== 'success' || !authResult.url) {
        throw new Error(
          t('auth.mastodonOnboardingCancelled', {
            defaultValue: 'Mastodon authorization was cancelled.',
          }),
        );
      }
      const callback = parseMastodonLinkCallback(authResult.url, frontendRedirectUri);
      if (callback.isAlreadyLinked && callback.token) {
        onLogin?.(callback.token);
        return;
      }
      if (!callback.linkToken) {
        throw new Error(
          t('auth.mastodonMissingCallbackParams', {
            defaultValue: 'Mastodon did not return the expected link details.',
          }),
        );
      }
      setMastodonLinkToken(callback.linkToken);
      setMastodonLinkUsernameDisplay(callback.username || username);
      setMastodonLinkCode('');
      setNotice(
        t('auth.mastodonLinkCodeSent', {
          defaultValue: 'A verification code was sent to the email on file for {{username}}.',
          username: callback.username || username,
        }),
      );
      setAuthMode('mastodonLinkVerify');
    } catch (e: any) {
      setError(e?.message || t('auth.mastodonLinkFailed', { defaultValue: 'Could not link Mastodon to your account.' }));
    } finally {
      setMastodonLinkLoading(false);
    }
  }

  async function handleConfirmMastodonLink() {
    const code = mastodonLinkCode.trim();
    if (!mastodonLinkToken) {
      setError(t('auth.mastodonLinkSessionExpired', {
        defaultValue: 'This link request expired. Please start over.',
      }));
      return;
    }
    if (!code) {
      setError(t('auth.verificationCodeRequired', { defaultValue: 'Enter the verification code.' }));
      return;
    }

    setError('');
    setNotice('');
    setMastodonLinkLoading(true);
    try {
      const result = await api.confirmMastodonLink({
        link_token: mastodonLinkToken,
        code,
      });
      onLogin?.(result.token);
    } catch (e: any) {
      setError(e?.message || t('auth.mastodonLinkConfirmFailed', { defaultValue: 'Could not verify the code.' }));
    } finally {
      setMastodonLinkLoading(false);
    }
  }

  async function runMastodonChecklistAction(
    action: 'importFollows' | 'importFollowers' | 'autoFollow' | 'migrationNotice' | 'enableCrosspost'
  ) {
    if (!shareFlowToken || !mastodonOnboardingIdentityId) {
      setError(t('auth.errorShareSessionMissing'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      let job: FederatedIdentityJob | null = null;
      if (action === 'importFollows') {
        job = await api.importFederatedIdentityFollows(shareFlowToken, mastodonOnboardingIdentityId, { limit: 25 });
      } else if (action === 'importFollowers') {
        job = await api.importFederatedIdentityFollowers(shareFlowToken, mastodonOnboardingIdentityId, { limit: 25 });
      } else if (action === 'autoFollow') {
        job = await api.autoFollowFederatedOldAccount(shareFlowToken, mastodonOnboardingIdentityId);
      } else if (action === 'migrationNotice') {
        job = await api.createFederatedMigrationNotice(shareFlowToken, mastodonOnboardingIdentityId);
      } else if (action === 'enableCrosspost') {
        const response = await api.updateFederatedCrosspostSettings(shareFlowToken, mastodonOnboardingIdentityId, {
          crosspost_openbook_to_mastodon: true,
        });
        job = response.job;
      }
      if (job) {
        setMastodonOnboardingJobs((prev) => [job!, ...prev.filter((entry) => entry.job_type !== job!.job_type)]);
      }
    } catch (e: any) {
      setError(e?.message || t('auth.mastodonChecklistActionFailed', { defaultValue: 'Could not complete that Mastodon setup step.' }));
    } finally {
      setLoading(false);
    }
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
      setAuthMode('linkMastodon');
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

  async function handleShareProfile(platform: 'mastodon' | 'threads' | 'x' | 'bluesky' | 'reddit') {
    const profileHandle = shareFlowUsername ? `@${shareFlowUsername}` : '';
    const profileUrl = `https://openspace.social/${shareFlowUsername || ''}`.replace(/\/$/, '');
    const shareText = t('auth.shareProfileMessage', { username: profileHandle || t('auth.newAccountLabel') });
    const encodedUrl = encodeURIComponent(profileUrl);
    const encodedText = encodeURIComponent(shareText);
    // Mastodon's /share takes a single `text` param — URL is folded into
    // the text body. Defaulting to mastodon.social gives the largest
    // pool of users a working compose dialog out of the box; users
    // logged into a different instance can still post from there.
    const mastodonShareText = encodeURIComponent(`${shareText} ${profileUrl}`);
    const threadsShareText = encodeURIComponent(`${shareText} ${profileUrl}`);

    const intentUrl = platform === 'mastodon'
      ? `https://mastodon.social/share?text=${mastodonShareText}`
      : platform === 'threads'
        ? `https://www.threads.net/intent/post?text=${threadsShareText}`
        : platform === 'x'
          ? `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`
          : platform === 'bluesky'
            ? `https://bsky.app/intent/compose?text=${encodeURIComponent(`${shareText} ${profileUrl}`)}`
            : platform === 'reddit'
              ? `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`
              : null;

    // ── Web ────────────────────────────────────────────────────────────
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (intentUrl) window.open(intentUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    // ── Native (iOS / Android) ────────────────────────────────────────
    // All five remaining platforms have working web compose intents
    // that route to the installed app via Universal Links / App Links
    // (with the system browser as the fallback when the app isn't
    // installed). If the OS rejects the URL for some reason, fall back
    // to the native share sheet so the user still has SOME way to
    // share.
    const nativeSharePayload =
      Platform.OS === 'ios'
        ? { url: profileUrl, message: shareText }
        : { message: `${shareText} ${profileUrl}` };

    if (!intentUrl) {
      try {
        await Share.share(nativeSharePayload);
      } catch {
        // user cancelled
      }
      return;
    }

    try {
      await Linking.openURL(intentUrl);
    } catch {
      try {
        await Share.share(nativeSharePayload);
      } catch {
        // user cancelled the fallback — no-op
      }
    }
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
        throw new Error(t('auth.socialPlayServicesMissing', { defaultValue: 'Google Sign-In is unavailable on this device.' }));
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
        ? await api.socialAuthGoogle(idToken, federationReferralToken || undefined)
        : await api.socialAuthApple(idToken, false, federationReferralToken || undefined);
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
        void clearFederationVisitorAttribution();
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
                  : authMode === 'linkMastodon'
                    ? t('auth.linkMastodonTitle', { defaultValue: 'Bring your Mastodon timeline' })
                  : authMode === 'mastodonChooseFlow'
                    ? t('auth.mastodonChooseFlowTitle', { defaultValue: 'Continue with Mastodon' })
                  : authMode === 'continueMastodon'
                    ? t('auth.continueWithMastodonTitle', { defaultValue: 'Sign in with Mastodon' })
                  : authMode === 'mastodonLinkAccount'
                    ? t('auth.mastodonLinkAccountTitle', { defaultValue: 'Link Mastodon to existing account' })
                  : authMode === 'mastodonLinkVerify'
                    ? t('auth.mastodonLinkVerifyTitle', { defaultValue: 'Verify Email Code' })
                  : authMode === 'mastodonSetupChecklist'
                    ? t('auth.mastodonSetupChecklistTitle', { defaultValue: 'Set up your fediverse identity' })
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

          {!!federationReferralToken && (
            <View
              style={[
                styles.fediverseVisitorCard,
                { backgroundColor: c.inputBackground, borderColor: c.border },
              ]}
            >
              <View style={styles.fediverseVisitorHeader}>
                <View style={[styles.fediverseVisitorIconWrap, { backgroundColor: `${c.primary}18` }]}>
                  <MaterialCommunityIcons name="earth-arrow-right" size={18} color={c.primary} />
                </View>
                <View style={styles.fediverseVisitorHeaderText}>
                  <Text style={[styles.fediverseVisitorTitle, { color: c.textPrimary }]}>
                    {t('auth.fediverseVisitorTitle', { defaultValue: 'Coming from Mastodon or the fediverse?' })}
                  </Text>
                  <Text style={[styles.fediverseVisitorBody, { color: c.textSecondary }]}>
                    {t('auth.fediverseVisitorBody', {
                      defaultValue: 'Bring your Mastodon identity, keep your audience, and cross-post instead of starting over.',
                    })}
                  </Text>
                </View>
              </View>
              <View style={styles.fediverseVisitorPills}>
                {[
                  t('auth.fediverseVisitorPillOne', { defaultValue: 'Bring your Mastodon identity' }),
                  t('auth.fediverseVisitorPillTwo', { defaultValue: 'Keep your audience' }),
                  t('auth.fediverseVisitorPillThree', { defaultValue: 'Cross-post instead of starting over' }),
                ].map((pill) => (
                  <View key={pill} style={[styles.fediverseVisitorPill, { borderColor: c.border, backgroundColor: c.surface }]}>
                    <Text style={[styles.fediverseVisitorPillText, { color: c.textSecondary }]}>{pill}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.fediverseVisitorActions}>
                <TouchableOpacity
                  style={[styles.fediversePrimaryButton, { backgroundColor: c.primary }]}
                  onPress={() => {
                    setFederationVisitorMode('signup');
                    void setFederationVisitorPreferredAuthMode('signup');
                    setAuthMode('signup');
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.fediversePrimaryButtonText}>
                    {t('auth.fediverseVisitorPrimaryCta', { defaultValue: 'Join OpenSpace directly' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.fediverseSecondaryButton, { borderColor: c.border, backgroundColor: c.surface }]}
                  onPress={() => {
                    setFederationVisitorMode('mastodon');
                    void setFederationVisitorPreferredAuthMode('mastodon');
                    setAuthMode('mastodonChooseFlow');
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.fediverseSecondaryButtonText, { color: c.textLink }]}>
                    {t('auth.fediverseVisitorSecondaryCta', { defaultValue: 'Continue with Mastodon' })}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.fediverseVisitorHint, { color: c.textMuted }]}>
                {federationVisitorMode === 'mastodon'
                  ? t('auth.fediverseVisitorHintMastodon', { defaultValue: 'We will help you connect your Mastodon identity without losing momentum.' })
                  : t('auth.fediverseVisitorHintSignup', { defaultValue: 'Use email, Google, Apple, or Mastodon to get started. Your fediverse visit will still be tracked.' })}
              </Text>
            </View>
          )}

          {authMode === 'login' ? (
            <WebForm onSubmit={handleLogin}>
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

              <TouchableOpacity
                style={[styles.socialButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={switchToContinueMastodon}
                disabled={loading || socialLoadingProvider !== null}
                activeOpacity={0.85}
              >
                <View style={styles.socialButtonContent}>
                  <MaterialCommunityIcons name="mastodon" size={17} color="#6364FF" />
                  <Text style={[styles.socialButtonText, { color: c.textPrimary }]}>
                    {t('auth.socialContinueMastodon', { defaultValue: 'Continue with Mastodon' })}
                  </Text>
                </View>
              </TouchableOpacity>
            </WebForm>
          ) : authMode === 'signup' ? (
            <WebForm onSubmit={handleRegister}>
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

              <View style={styles.marketingConsentRow}>
                <View style={styles.marketingConsentText}>
                  <Text style={[styles.marketingConsentTitle, { color: c.textPrimary }]}>
                    {t('auth.signUpMarketingConsentTitle', {
                      defaultValue: 'Email me product news and updates',
                    })}
                  </Text>
                  <Text style={[styles.marketingConsentBody, { color: c.textMuted }]}>
                    {t('auth.signUpMarketingConsentBody', {
                      defaultValue: 'Occasional emails about new features and community highlights. You can unsubscribe any time.',
                    })}
                  </Text>
                </View>
                <Switch
                  value={signupMarketingConsent}
                  onValueChange={setSignupMarketingConsent}
                  trackColor={{ false: '#94a3b8', true: c.primary }}
                  thumbColor="#ffffff"
                />
              </View>

              <Text style={[styles.agreementText, { color: c.textMuted }]}>
                <Text style={[styles.agreementAge, { color: c.textPrimary }]}>
                  {t('auth.signUpAgeRequirement', {
                    defaultValue: 'You agree to being at least 16 years of age or older. Users aged 16–18 must have parental consent.',
                  })}
                </Text>
                {' '}
                {t('auth.signUpAgreementPrefix')}{' '}
                <Text style={[styles.agreementLink, { color: c.textLink }]} onPress={() => openLegalDrawer('terms')}>
                  {t('footer.termsOfUse')}
                </Text>
                {', '}
                <Text style={[styles.agreementLink, { color: c.textLink }]} onPress={() => openLegalDrawer('guidelines')}>
                  {t('footer.guidelines')}
                </Text>
                {' '}{t('auth.signUpAgreementAnd')}{' '}
                <Text style={[styles.agreementLink, { color: c.textLink }]} onPress={() => openLegalDrawer('privacy')}>
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
            </WebForm>
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
          ) : authMode === 'mastodonChooseFlow' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                {t('auth.mastodonChooseFlowIntro', {
                  defaultValue: 'How would you like to use your Mastodon account with Openspace?',
                })}
              </Text>

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                ]}
                onPress={() => {
                  setError('');
                  setNotice('');
                  setAuthMode('continueMastodon');
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.buttonText}>
                  {t('auth.mastodonChooseFlowNew', { defaultValue: "I'm new to Openspace" })}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.background }]}
                onPress={() => {
                  setError('');
                  setNotice('');
                  setAuthMode('mastodonLinkAccount');
                }}
                activeOpacity={0.85}
              >
                <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                  {t('auth.mastodonChooseFlowExisting', { defaultValue: 'I already have an Openspace account' })}
                </Text>
              </TouchableOpacity>
            </>
          ) : authMode === 'continueMastodon' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                {t('auth.continueWithMastodonDescription', {
                  defaultValue: 'Enter your Mastodon handle or instance, verify ownership, and we will create or reconnect your OpenSpace identity from there.',
                })}
              </Text>
              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.continueWithMastodonLabel', { defaultValue: 'Mastodon handle or instance' })}
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
                value={mastodonContinueInput}
                onChangeText={setMastodonContinueInput}
                placeholder={t('auth.continueWithMastodonPlaceholder', { defaultValue: '@mem1984@mastodon.social' })}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!mastodonContinueLoading}
                returnKeyType="done"
                onSubmitEditing={handleContinueWithMastodon}
              />
              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  mastodonContinueLoading && styles.buttonDisabled,
                ]}
                onPress={handleContinueWithMastodon}
                disabled={mastodonContinueLoading}
                activeOpacity={0.85}
              >
                {mastodonContinueLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>
                    {t('auth.socialContinueMastodon', { defaultValue: 'Continue with Mastodon' })}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          ) : authMode === 'mastodonSetupChecklist' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                {t('auth.mastodonSetupChecklistDescription', {
                  defaultValue: 'You are all set. We verified {{remoteHandle}}, created @{{username}} on OpenSpace, and linked the two identities. Everything below is optional and can keep running in the background while you move on.',
                  remoteHandle: mastodonOnboardingRemoteHandle || 'your Mastodon account',
                  username: shareFlowUsername || 'your account',
                })}
              </Text>

              <View style={[styles.noticeBox, { backgroundColor: c.inputBackground, borderColor: c.inputBorder }]}>
                <Text style={[styles.noticeText, { color: c.textSecondary }]}>
                  {t('auth.mastodonCreatedIdentity', {
                    defaultValue: 'Your new OpenSpace account: @{{username}}',
                    username: shareFlowUsername || 'your account',
                  })}
                </Text>
                {mastodonOnboardingLocalActorUrl ? (
                  <Text style={[styles.noticeText, { color: c.textMuted, marginTop: 4 }]}>
                    {mastodonOnboardingLocalActorUrl}
                  </Text>
                ) : null}
                {mastodonOnboardingSuggestedUsernames.length > 0 ? (
                  <Text style={[styles.noticeText, { color: c.textMuted, marginTop: 6 }]}>
                    {t('auth.mastodonUsernameSuggestions', {
                      defaultValue: 'We reserved your preferred username. If you ever want alternates later, you could also use: {{suggestions}}',
                      suggestions: mastodonOnboardingSuggestedUsernames.join(', '),
                    })}
                  </Text>
                ) : null}
              </View>

              <Text style={[styles.footerText, { color: c.textMuted, alignSelf: 'stretch', marginTop: -2, marginBottom: 4 }]}>
                {t('auth.mastodonChecklistOptionalHint', {
                  defaultValue: 'Optional setup: import people, prepare a migration note, or enable cross-posting. You do not need to wait here.',
                })}
              </Text>

              <TouchableOpacity
                style={[styles.socialButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => runMastodonChecklistAction('importFollows')}
                disabled={loading}
                activeOpacity={0.85}
              >
                <View style={styles.socialButtonContent}>
                  <MaterialCommunityIcons name="account-arrow-right-outline" size={18} color={c.textPrimary} />
                  <Text style={[styles.socialButtonText, { color: c.textPrimary }]}>
                    {t('auth.mastodonChecklistImportFollows', { defaultValue: 'Import accounts I follow' })}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.socialButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => runMastodonChecklistAction('importFollowers')}
                disabled={loading}
                activeOpacity={0.85}
              >
                <View style={styles.socialButtonContent}>
                  <MaterialCommunityIcons name="account-multiple-outline" size={18} color={c.textPrimary} />
                  <Text style={[styles.socialButtonText, { color: c.textPrimary }]}>
                    {t('auth.mastodonChecklistImportFollowers', { defaultValue: 'Preview my followers' })}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.socialButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => runMastodonChecklistAction('autoFollow')}
                disabled={loading}
                activeOpacity={0.85}
              >
                <View style={styles.socialButtonContent}>
                  <MaterialCommunityIcons name="account-plus-outline" size={18} color={c.textPrimary} />
                  <Text style={[styles.socialButtonText, { color: c.textPrimary }]}>
                    {t('auth.mastodonChecklistAutoFollow', { defaultValue: 'Auto-follow my old Mastodon account' })}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.socialButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => runMastodonChecklistAction('migrationNotice')}
                disabled={loading}
                activeOpacity={0.85}
              >
                <View style={styles.socialButtonContent}>
                  <MaterialCommunityIcons name="bullhorn-outline" size={18} color={c.textPrimary} />
                  <Text style={[styles.socialButtonText, { color: c.textPrimary }]}>
                    {t('auth.mastodonChecklistMigrationNotice', { defaultValue: 'Prepare a migration notice' })}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.socialButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => runMastodonChecklistAction('enableCrosspost')}
                disabled={loading}
                activeOpacity={0.85}
              >
                <View style={styles.socialButtonContent}>
                  <MaterialCommunityIcons name="source-branch" size={18} color={c.textPrimary} />
                  <Text style={[styles.socialButtonText, { color: c.textPrimary }]}>
                    {t('auth.mastodonChecklistEnableCrosspost', { defaultValue: 'Enable OpenSpace → Mastodon cross-posting' })}
                  </Text>
                </View>
              </TouchableOpacity>

              {mastodonOnboardingJobs.length > 0 ? (
                <View style={{ gap: 8, marginTop: 8 }}>
                  {mastodonOnboardingJobs.map((job) => (
                    <View
                      key={job.id}
                      style={[
                        styles.noticeBox,
                        { backgroundColor: c.inputBackground, borderColor: c.inputBorder },
                      ]}
                    >
                      <Text style={[styles.noticeText, { color: c.textPrimary }]}>
                        {formatMastodonJobLabel(job.job_type)}: {formatMastodonJobStatus(job)}
                      </Text>
                      {job.result?.imported_count ? (
                        <Text style={[styles.noticeText, { color: c.textSecondary, marginTop: 4 }]}>
                          {t('auth.mastodonImportedCount', {
                            defaultValue: '{{count}} accounts ready to review.',
                            count: job.result.imported_count,
                          })}
                        </Text>
                      ) : null}
                      {job.result?.suggested_notice ? (
                        <Text style={[styles.noticeText, { color: c.textSecondary, marginTop: 4 }]}>
                          {job.result.suggested_notice}
                        </Text>
                      ) : null}
                      {job.error ? (
                        <Text style={[styles.noticeText, { color: c.errorText, marginTop: 4 }]}>
                          {job.error}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  loading && styles.buttonDisabled,
                ]}
                onPress={() => setAuthMode('shareProfile')}
                disabled={loading}
                activeOpacity={0.85}
              >
                <Text style={styles.buttonText}>
                  {t('auth.mastodonChecklistContinue', { defaultValue: 'Enter OpenSpace' })}
                </Text>
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
          ) : authMode === 'mastodonLinkAccount' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                {t('auth.mastodonLinkAccountIntro', {
                  defaultValue: 'Already have an Openspace account? Sign in to your Mastodon and we\'ll link the two together. We\'ll email a verification code to your Openspace email to confirm.',
                })}
              </Text>

              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.openspaceUsername', { defaultValue: 'Your Openspace username' })}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBackground, borderColor: c.inputBorder, color: c.textPrimary },
                ]}
                value={mastodonLinkUsernameInput}
                onChangeText={setMastodonLinkUsernameInput}
                placeholder={t('auth.usernamePlaceholder')}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                editable={!mastodonLinkLoading}
              />

              <Text style={[styles.label, { color: c.textSecondary, marginTop: 12 }]}>
                {t('auth.mastodonHandleOrInstance', { defaultValue: 'Mastodon handle or instance' })}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBackground, borderColor: c.inputBorder, color: c.textPrimary },
                ]}
                value={mastodonLinkInstanceInput}
                onChangeText={setMastodonLinkInstanceInput}
                placeholder={t('auth.continueMastodonPlaceholder', { defaultValue: '@you@mastodon.social or mastodon.social' })}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleStartMastodonLink}
                editable={!mastodonLinkLoading}
              />

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  mastodonLinkLoading && styles.buttonDisabled,
                ]}
                onPress={handleStartMastodonLink}
                disabled={mastodonLinkLoading}
                activeOpacity={0.85}
              >
                {mastodonLinkLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>
                    {t('auth.mastodonLinkContinueButton', { defaultValue: 'Continue with Mastodon' })}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          ) : authMode === 'mastodonLinkVerify' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                {t('auth.mastodonLinkVerifyIntro', {
                  defaultValue: 'Enter the verification code we sent to the email on file for {{username}}.',
                  username: mastodonLinkUsernameDisplay || '',
                })}
              </Text>
              <Text style={[styles.label, { color: c.textSecondary }]}>
                {t('auth.verificationCode', { defaultValue: 'Verification Code' })}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBackground, borderColor: c.inputBorder, color: c.textPrimary },
                ]}
                value={mastodonLinkCode}
                onChangeText={setMastodonLinkCode}
                placeholder={t('auth.verificationCodePlaceholder')}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={handleConfirmMastodonLink}
                editable={!mastodonLinkLoading}
              />
              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  mastodonLinkLoading && styles.buttonDisabled,
                ]}
                onPress={handleConfirmMastodonLink}
                disabled={mastodonLinkLoading}
                activeOpacity={0.85}
              >
                {mastodonLinkLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>
                    {t('auth.mastodonLinkVerifyButton', { defaultValue: 'Verify & Link Account' })}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          ) : authMode === 'linkMastodon' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                {t('auth.linkMastodonDescription', {
                  defaultValue: 'Already on Mastodon? Sign in once and your home timeline will live alongside Openspace, with replies, boosts, and bookmarks all wired up.',
                })}
              </Text>

              <TextInput
                style={[
                  styles.input,
                  { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary },
                ]}
                value={onboardingMastodonInput}
                onChangeText={setOnboardingMastodonInput}
                placeholder={t('auth.linkMastodonPlaceholder', {
                  defaultValue: 'mastodon.social or @you@mastodon.social',
                })}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!onboardingMastodonLinking}
              />

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                  onboardingMastodonLinking && styles.buttonDisabled,
                ]}
                onPress={handleOnboardingLinkMastodon}
                disabled={onboardingMastodonLinking}
                activeOpacity={0.85}
              >
                {onboardingMastodonLinking ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>
                    {t('auth.linkMastodonCta', { defaultValue: 'Link Mastodon' })}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.background }]}
                onPress={skipOnboardingMastodon}
                disabled={onboardingMastodonLinking}
                activeOpacity={0.85}
              >
                <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                  {t('auth.linkMastodonSkipCta', { defaultValue: 'Skip for now' })}
                </Text>
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
                  onPress={() => handleShareProfile('mastodon')}
                  activeOpacity={0.85}
                >
                  <View style={styles.shareButtonContent}>
                    <MaterialCommunityIcons name="mastodon" size={16} color={c.textLink} />
                    <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                      {t('auth.shareMastodon', { defaultValue: 'Mastodon' })}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.background }, styles.shareChip]}
                  onPress={() => handleShareProfile('threads')}
                  activeOpacity={0.85}
                >
                  <View style={styles.shareButtonContent}>
                    <MaterialCommunityIcons name="at" size={16} color={c.textLink} />
                    <Text style={[styles.secondaryActionText, { color: c.textLink }]}>
                      {t('auth.shareThreads', { defaultValue: 'Threads' })}
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
                <WebForm onSubmit={handlePasswordResetSubmit}>
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
                </WebForm>
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
            ) : authMode === 'mastodonChooseFlow' || authMode === 'mastodonLinkAccount' || authMode === 'mastodonLinkVerify' ? (
              <>
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                  {t('auth.changedYourMind', { defaultValue: 'Changed your mind?' })}{' '}
                </Text>
                <TouchableOpacity onPress={switchToLogin}>
                  <Text style={[styles.footerLink, { color: c.textLink }]}>
                    {t('auth.backToSignIn')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : authMode === 'linkMastodon' ? (
              <>
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                  {t('auth.linkMastodonFooterHint', { defaultValue: 'Not on Mastodon yet?' })}{' '}
                </Text>
                <TouchableOpacity onPress={skipOnboardingMastodon}>
                  <Text style={[styles.footerLink, { color: c.textLink }]}>
                    {t('auth.linkMastodonSkipCta', { defaultValue: 'Skip for now' })}
                  </Text>
                </TouchableOpacity>
              </>
            ) : authMode === 'continueMastodon' ? (
              <>
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                  {t('auth.alreadyHaveAccount')}{' '}
                </Text>
                <TouchableOpacity onPress={switchToLogin}>
                  <Text style={[styles.footerLink, { color: c.textLink }]}>
                    {t('auth.backToSignIn')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : authMode === 'mastodonSetupChecklist' ? (
              <>
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                  {t('auth.mastodonChecklistFooterHint', { defaultValue: 'These tasks keep working in the background, and you can revisit them later from Linked Accounts.' })}{' '}
                </Text>
                <TouchableOpacity onPress={() => setAuthMode('shareProfile')}>
                  <Text style={[styles.footerLink, { color: c.textLink }]}>
                    {t('auth.linkMastodonSkipCta', { defaultValue: 'Move on for now' })}
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
      <AboutUsDrawer visible={aboutUsOpen} onClose={closeLegalDrawer} />
      <PrivacyPolicyDrawer visible={privacyPolicyOpen} onClose={closeLegalDrawer} />
      <TermsOfUseDrawer visible={termsOfUseOpen} onClose={closeLegalDrawer} />
      <GuidelinesDrawer visible={guidelinesOpen} onClose={closeLegalDrawer} />

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
  fediverseVisitorCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  fediverseVisitorHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  fediverseVisitorIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fediverseVisitorHeaderText: {
    flex: 1,
    gap: 4,
  },
  fediverseVisitorTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  fediverseVisitorBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  fediverseVisitorPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fediverseVisitorPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  fediverseVisitorPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  fediverseVisitorActions: {
    gap: 10,
  },
  fediversePrimaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  fediversePrimaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  fediverseSecondaryButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  fediverseSecondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  fediverseVisitorHint: {
    fontSize: 12,
    lineHeight: 18,
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
  marketingConsentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    marginBottom: 6,
  },
  marketingConsentText: {
    flex: 1,
    gap: 2,
  },
  marketingConsentTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  marketingConsentBody: {
    fontSize: 12,
    lineHeight: 16,
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
