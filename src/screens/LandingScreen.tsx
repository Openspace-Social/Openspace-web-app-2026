import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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

interface LandingScreenProps {
  onLogin?: (token: string) => void;
}

type SocialProvider = 'google' | 'apple';

export default function LandingScreen({ onLogin }: LandingScreenProps) {
  const { theme, isDark, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;
  const { width } = useWindowDimensions();
  const isWide = width >= 860;

  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'verifyEmail' | 'recoverPassword' | 'recoverAccount' | 'resetPassword' | 'socialUsername' | 'shareProfile' | 'appleLinkEmail' | 'appleLinkVerify'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');
  const [passwordResetToken, setPasswordResetToken] = useState('');
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
  const [appleLinkEmail, setAppleLinkEmail] = useState('');
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

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const token = new URLSearchParams(window.location.search).get('reset_token');
    if (!token) return;
    setPasswordResetToken(token);
    setAuthMode('resetPassword');
    setError('');
    setNotice('');
  }, []);

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

  async function handlePasswordResetFromLink() {
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

    setError('');
    setNotice('');
    setLoading(true);
    try {
      const message = await api.verifyPasswordReset(passwordResetToken, newPassword);
      setPasswordResetSuccess(true);
      setNotice(message || t('auth.passwordResetSuccess'));
      if (Platform.OS === 'web') {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e: any) {
      setError(e.message || t('auth.passwordResetFailed'));
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
    setNewPassword('');
    setConfirmNewPassword('');
    setSocialOnboardingToken('');
    setSocialUsername('');
    setShareFlowToken('');
    setShareFlowUsername('');
    setAppleLinkIdToken('');
    setAppleLinkEmail('');
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
    if (!appleLinkEmail.trim()) {
      setError('Email is required.');
      return;
    }

    setError('');
    setNotice('');
    setLoading(true);
    try {
      const message = await api.requestAppleSocialLinkCode(appleLinkIdToken, appleLinkEmail.trim());
      setNotice(message || 'Verification code sent to your email.');
      setAuthMode('appleLinkVerify');
    } catch (e: any) {
      setError(e.message || 'Could not send verification code.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAppleLinkConfirm() {
    if (!appleLinkIdToken) {
      setError('Apple session expired. Please try Apple sign in again.');
      return;
    }
    if (!appleLinkEmail.trim()) {
      setError('Email is required.');
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
        appleLinkEmail.trim(),
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

  function openSocialPopup(provider: SocialProvider): Promise<string> {
    return new Promise((resolve, reject) => {
      if (Platform.OS !== 'web' || typeof window === 'undefined') {
        reject(new Error(t('auth.socialWebOnly')));
        return;
      }

      const redirectUri = process.env.EXPO_PUBLIC_SOCIAL_AUTH_REDIRECT_URI || window.location.origin;
      const nonce = createRandomState();
      const state = createRandomState();
      const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
      const appleClientId = process.env.EXPO_PUBLIC_APPLE_CLIENT_ID;

      debugSocial('init', {
        provider,
        origin: window.location.origin,
        redirectUri,
        googleClientId: maskClientId(googleClientId),
        appleClientId: maskClientId(appleClientId),
      });

      if (provider === 'google' && !googleClientId) {
        reject(new Error(`${t('auth.socialConfigMissing')} (EXPO_PUBLIC_GOOGLE_CLIENT_ID)`));
        return;
      }
      if (provider === 'apple' && !appleClientId) {
        reject(new Error(`${t('auth.socialConfigMissing')} (EXPO_PUBLIC_APPLE_CLIENT_ID)`));
        return;
      }

      const params = new URLSearchParams();
      if (provider === 'google') {
        params.set('client_id', googleClientId as string);
        params.set('redirect_uri', redirectUri);
        params.set('response_type', 'id_token');
        params.set('scope', 'openid email profile');
        params.set('prompt', 'select_account');
        params.set('nonce', nonce);
        params.set('state', state);
      } else {
        params.set('client_id', appleClientId as string);
        params.set('redirect_uri', redirectUri);
        params.set('response_type', 'code id_token');
        params.set('response_mode', 'fragment');
        // Keep popup+hash flow for web: requesting name/email requires form_post.
        params.set('scope', 'openid');
        params.set('nonce', nonce);
        params.set('state', state);
      }

      const authUrl = provider === 'google'
        ? `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
        : `https://appleid.apple.com/auth/authorize?${params.toString()}`;

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
      if (
        provider === 'apple' &&
        e instanceof ApiRequestError &&
        e.code === 'apple_account_link_required'
      ) {
        setAppleLinkIdToken(idToken);
        setAppleLinkEmail('');
        setAppleLinkCode('');
        setNotice('Looks like this Apple ID is not linked yet. Enter your existing account email to link it.');
        setAuthMode('appleLinkEmail');
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
      <View style={[styles.topHeader, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={styles.topHeaderInner}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.topHeaderLinks}
          >
            {headerLinks.map((key) => (
              <TouchableOpacity
                key={key}
                onPress={() => handleHeaderLinkPress(key)}
                style={styles.topHeaderButton}
              >
                <Text style={[styles.topHeaderLink, { color: c.textMuted }]}>
                  {t(`footer.${key}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.topHeaderControls}>
            <LanguagePicker />
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
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.mainContent, isWide && styles.mainContentWide]}>
          {/* Hero / branding */}
          <View style={[styles.hero, isWide && styles.heroWide]}>
            <View style={[styles.logoMark, { shadowColor: c.primaryShadow }]}>
              <Text style={styles.logoLetter}>O</Text>
            </View>
            <Text style={[styles.appName, { color: c.textPrimary }]}>
              Openspace<Text style={[styles.appNameDomain, { color: c.textMuted }]}>.Social</Text>
            </Text>
            <Text style={[styles.tagline, { color: c.textSecondary }]}>
              {t('tagline')}
            </Text>
          </View>

          {/* Login card */}
          <View
            style={[
              styles.card,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              shadowColor: isDark ? '#000' : '#94A3B8',
            },
          ]}
        >
          <Text style={[styles.cardTitle, { color: c.textPrimary }]}>
            {authMode === 'login'
              ? t('auth.signIn')
              : authMode === 'signup'
                ? t('auth.getStarted')
                : authMode === 'verifyEmail'
                  ? t('auth.verifyEmailTitle')
                  : authMode === 'socialUsername'
                    ? t('auth.socialUsernameTitle')
                  : authMode === 'appleLinkEmail'
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

              <Text style={[styles.socialDivider, { color: c.textMuted }]}>
                {t('auth.socialOrDivider')}
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
            </>
          ) : authMode === 'signup' ? (
            <>
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

              <Text style={[styles.socialDivider, { color: c.textMuted }]}>
                {t('auth.socialOrDivider')}
              </Text>

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
          ) : authMode === 'appleLinkEmail' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                Enter the email of your existing Openspace account. We'll send a verification code to link this Apple ID.
              </Text>
              <Text style={[styles.label, { color: c.textSecondary }]}>Email</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: c.inputBackground,
                    borderColor: c.inputBorder,
                    color: c.textPrimary,
                  },
                ]}
                value={appleLinkEmail}
                onChangeText={setAppleLinkEmail}
                placeholder={t('auth.emailPlaceholder')}
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
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
            </>
          ) : authMode === 'appleLinkVerify' ? (
            <>
              <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                Enter the verification code sent to {appleLinkEmail || 'your email'}.
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
              ) : (
                <>
                  <Text style={[styles.verificationIntro, { color: c.textSecondary }]}>
                    {t('auth.resetPasswordDescription')}
                  </Text>

                  <Text style={[styles.label, { color: c.textSecondary }]}>
                    {t('auth.newPasswordLabel')}
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
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder={t('auth.newPasswordPlaceholder')}
                    placeholderTextColor={c.placeholder}
                    secureTextEntry
                    returnKeyType="next"
                  />

                  <Text style={[styles.label, { color: c.textSecondary }]}>
                    {t('auth.confirmNewPasswordLabel')}
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
                    value={confirmNewPassword}
                    onChangeText={setConfirmNewPassword}
                    placeholder={t('auth.confirmNewPasswordPlaceholder')}
                    placeholderTextColor={c.placeholder}
                    secureTextEntry
                    returnKeyType="done"
                    onSubmitEditing={handlePasswordResetFromLink}
                  />

                  <TouchableOpacity
                    style={[
                      styles.button,
                      { backgroundColor: c.primary, shadowColor: c.primaryShadow },
                      loading && styles.buttonDisabled,
                    ]}
                    onPress={handlePasswordResetFromLink}
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
            ) : authMode === 'appleLinkEmail' || authMode === 'appleLinkVerify' ? (
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

        <Text style={[styles.copyright, { color: c.textMuted }]}>
          © 2026–2027 Openspace.Social. All rights reserved.
        </Text>
      </ScrollView>
      <AboutUsDrawer visible={aboutUsOpen} onClose={() => setAboutUsOpen(false)} />
      <PrivacyPolicyDrawer visible={privacyPolicyOpen} onClose={() => setPrivacyPolicyOpen(false)} />
      <TermsOfUseDrawer visible={termsOfUseOpen} onClose={() => setTermsOfUseOpen(false)} />
      <GuidelinesDrawer visible={guidelinesOpen} onClose={() => setGuidelinesOpen(false)} />
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
  topHeader: {
    width: '100%',
    borderBottomWidth: 1,
  },
  topHeaderInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  topHeaderLinks: {
    alignItems: 'center',
    gap: 0,
    paddingRight: 8,
  },
  topHeaderButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  topHeaderLink: {
    fontSize: 14,
    fontWeight: '400',
  },
  topHeaderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  themeToggle: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  themeToggleIcon: {
    fontSize: 20,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 48,
  },
  mainContent: {
    width: '100%',
    alignItems: 'center',
    flexDirection: 'column',
    gap: 40,
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
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  logoLetter: {
    fontSize: 38,
    fontWeight: '800',
    color: '#fff',
  },
  appName: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  appNameDomain: {
    fontSize: 32,
    fontWeight: '400',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 16,
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 24,
  },
  card: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    borderRadius: 20,
    padding: 28,
    borderWidth: 1,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
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
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
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
    marginBottom: 14,
    marginTop: 2,
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
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 16,
    outlineStyle: 'none',
  } as any,
  button: {
    borderRadius: 12,
    paddingVertical: 16,
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
    marginTop: -8,
    marginBottom: 16,
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
  agreementLink: {
    fontSize: 12,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
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
    marginTop: 32,
    textAlign: 'center',
  },
});
