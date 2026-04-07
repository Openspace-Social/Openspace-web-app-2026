import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  ScrollView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { api, FeedPost, FeedType, SocialIdentity, SocialProvider } from '../api/client';
import { useTheme } from '../theme/ThemeContext';

interface HomeScreenProps {
  token: string;
  onLogout: () => void;
}

export default function HomeScreen({ token, onLogout }: HomeScreenProps) {
  const { theme, isDark, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [linkedIdentities, setLinkedIdentities] = useState<SocialIdentity[]>([]);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
  const [providerLoading, setProviderLoading] = useState<SocialProvider | null>(null);
  const [activeFeed, setActiveFeed] = useState<FeedType>('home');
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const providerOrder: SocialProvider[] = ['google', 'apple'];
  const feedTabs: Array<{ key: FeedType; label: string }> = [
    { key: 'home', label: 'Home' },
    { key: 'trending', label: 'Trending' },
    { key: 'public', label: 'Public' },
    { key: 'explore', label: 'Explore' },
  ];

  useEffect(() => {
    let active = true;

    Promise.all([
      api.getAuthenticatedUser(token),
      api.getLinkedSocialIdentities(token),
      api.getFeed(token, 'home'),
    ])
      .then(([authenticatedUser, identities, homeFeed]) => {
        if (!active) return;
        setUser(authenticatedUser);
        setLinkedIdentities(identities);
        setFeedPosts(homeFeed);
        setFeedError('');
      })
      .catch(() => {
        if (!active) return;
        setFeedError('Could not load feed right now.');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setFeedLoading(false);
        setIdentitiesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  async function loadFeed(feed: FeedType) {
    setFeedLoading(true);
    setFeedError('');
    try {
      const nextPosts = await api.getFeed(token, feed);
      setFeedPosts(nextPosts);
    } catch (e: any) {
      setFeedPosts([]);
      setFeedError(e.message || 'Could not load feed right now.');
    } finally {
      setFeedLoading(false);
    }
  }

  async function handleSelectFeed(feed: FeedType) {
    if (feed === activeFeed) return;
    setActiveFeed(feed);
    await loadFeed(feed);
  }

  const welcomeText = user?.username
    ? t('home.welcomeBack', { name: user.username })
    : t('home.welcomeBackGeneric');

  function createRandomState() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getProviderName(provider: SocialProvider) {
    return provider === 'google' ? t('home.providerGoogle') : t('home.providerApple');
  }

  function getProviderIcon(provider: SocialProvider) {
    return provider === 'google' ? 'google' : 'apple';
  }

  function getLinkedIdentity(provider: SocialProvider) {
    return linkedIdentities.find((identity) => identity.provider === provider) || null;
  }

  async function reloadLinkedIdentities() {
    const identities = await api.getLinkedSocialIdentities(token);
    setLinkedIdentities(identities);
  }

  function openSocialPopup(provider: SocialProvider): Promise<string> {
    return new Promise((resolve, reject) => {
      if (Platform.OS !== 'web' || typeof window === 'undefined') {
        reject(new Error(t('home.linkWebOnly')));
        return;
      }

      const redirectUri = process.env.EXPO_PUBLIC_SOCIAL_AUTH_REDIRECT_URI || window.location.origin;
      const nonce = createRandomState();
      const state = createRandomState();
      const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
      const appleClientId = process.env.EXPO_PUBLIC_APPLE_CLIENT_ID;

      if (provider === 'google' && !googleClientId) {
        reject(new Error(t('home.linkConfigMissing')));
        return;
      }
      if (provider === 'apple' && !appleClientId) {
        reject(new Error(t('home.linkConfigMissing')));
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

      const width = 480;
      const height = 640;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        authUrl,
        `${provider}-link-auth`,
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        reject(new Error(t('home.linkPopupBlocked')));
        return;
      }

      const maxWaitMs = 120000;
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(interval);
          reject(new Error(t('home.linkCancelled')));
          return;
        }

        if (Date.now() - startedAt > maxWaitMs) {
          popup.close();
          window.clearInterval(interval);
          reject(new Error(t('home.linkTimeout')));
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
          reject(new Error(errorFromHash));
          return;
        }
        if (!tokenFromHash) return;
        if (returnedState && returnedState !== state) {
          popup.close();
          window.clearInterval(interval);
          reject(new Error(t('home.linkStateMismatch')));
          return;
        }

        popup.close();
        window.clearInterval(interval);
        resolve(tokenFromHash);
      }, 500);
    });
  }

  async function handleLinkProvider(provider: SocialProvider) {
    setError('');
    setNotice('');
    setProviderLoading(provider);
    try {
      const idToken = await openSocialPopup(provider);
      const message = await api.linkSocialIdentity(token, provider, idToken);
      await reloadLinkedIdentities();
      setNotice(message || t('home.linkSuccess', { provider: getProviderName(provider) }));
    } catch (e: any) {
      setError(e.message || t('home.linkFailed'));
    } finally {
      setProviderLoading(null);
    }
  }

  async function handleUnlinkProvider(provider: SocialProvider) {
    setError('');
    setNotice('');
    setProviderLoading(provider);
    try {
      const message = await api.unlinkSocialIdentity(token, provider);
      await reloadLinkedIdentities();
      setNotice(message || t('home.unlinkSuccess', { provider: getProviderName(provider) }));
    } catch (e: any) {
      setError(e.message || t('home.unlinkFailed'));
    } finally {
      setProviderLoading(null);
    }
  }

  return (
    <ScrollView style={[styles.root, { backgroundColor: c.background }]} contentContainerStyle={styles.rootContent}>
      {loading ? (
        <ActivityIndicator color={c.primary} size="large" />
      ) : (
        <>
          <View style={[styles.logoMark, { shadowColor: c.primaryShadow }]}>
            <Text style={styles.logoLetter}>O</Text>
          </View>
          <Text style={[styles.welcome, { color: c.textPrimary }]}>
            {welcomeText}
          </Text>
          <Text style={[styles.subtitle, { color: c.textMuted }]}>
            Your timeline and discovery feeds
          </Text>

          <View style={[styles.feedCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={styles.feedTabs}>
              {feedTabs.map((tab) => {
                const isActive = tab.key === activeFeed;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[
                      styles.feedTab,
                      {
                        backgroundColor: isActive ? c.primary : c.inputBackground,
                        borderColor: c.border,
                      },
                    ]}
                    onPress={() => handleSelectFeed(tab.key)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.feedTabText, { color: isActive ? '#fff' : c.textPrimary }]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {feedLoading ? (
              <ActivityIndicator color={c.primary} size="small" style={styles.feedLoading} />
            ) : feedError ? (
              <Text style={[styles.feedErrorText, { color: c.errorText }]}>{feedError}</Text>
            ) : feedPosts.length === 0 ? (
              <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>
                No posts in this feed yet.
              </Text>
            ) : (
              <View style={styles.feedList}>
                {feedPosts.map((post) => (
                  <View key={`${activeFeed}-${post.id}`} style={[styles.feedPostCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                    <View style={styles.feedPostHeader}>
                      <Text style={[styles.feedAuthor, { color: c.textPrimary }]}>
                        @{post.creator?.username || 'unknown'}
                      </Text>
                      <Text style={[styles.feedDate, { color: c.textMuted }]}>
                        {post.created ? new Date(post.created).toLocaleString() : ''}
                      </Text>
                    </View>
                    {post.community?.name ? (
                      <Text style={[styles.feedCommunity, { color: c.textLink }]}>
                        /c/{post.community.name}
                      </Text>
                    ) : null}
                    <Text style={[styles.feedText, { color: c.textSecondary }]}>
                      {post.text || '(No text content)'}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

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

          {!!notice && (
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

          <View style={[styles.linkedCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
              {t('home.linkedAccountsTitle')}
            </Text>
            <Text style={[styles.linkedSubtitle, { color: c.textMuted }]}>
              {t('home.linkedAccountsDescription')}
            </Text>

            {identitiesLoading ? (
              <ActivityIndicator color={c.primary} size="small" />
            ) : (
              <View style={styles.providerList}>
                {providerOrder.map((provider) => {
                  const identity = getLinkedIdentity(provider);
                  const isLoadingProvider = providerLoading === provider;
                  const isLinked = !!identity;

                  return (
                    <View
                      key={provider}
                      style={[styles.providerRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    >
                      <View style={styles.providerMeta}>
                        <MaterialCommunityIcons
                          name={getProviderIcon(provider)}
                          size={18}
                          color={provider === 'google' ? '#DB4437' : c.textPrimary}
                        />
                        <View style={styles.providerTextWrap}>
                          <Text style={[styles.providerName, { color: c.textPrimary }]}>
                            {getProviderName(provider)}
                          </Text>
                          <Text style={[styles.providerStatus, { color: c.textMuted }]}>
                            {isLinked
                              ? t('home.linkedStatusWithEmail', { email: identity?.email || t('home.linkedStatusConnected') })
                              : t('home.linkedStatusNotConnected')}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.providerButton,
                          {
                            borderColor: c.border,
                            backgroundColor: isLinked ? c.background : c.primary,
                          },
                        ]}
                        onPress={() => (isLinked ? handleUnlinkProvider(provider) : handleLinkProvider(provider))}
                        disabled={providerLoading !== null}
                        activeOpacity={0.85}
                      >
                        {isLoadingProvider ? (
                          <ActivityIndicator color={isLinked ? c.textPrimary : '#fff'} size="small" />
                        ) : (
                          <Text style={[styles.providerButtonText, { color: isLinked ? c.textPrimary : '#fff' }]}>
                            {isLinked ? t('home.unlinkAction') : t('home.linkAction')}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.logoutButton, { borderColor: c.logoutBorder }]}
            onPress={onLogout}
          >
            <Text style={[styles.logoutText, { color: c.logoutText }]}>
              {t('auth.signOut')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.themeToggle, { borderColor: c.border, backgroundColor: c.surface }]}
            onPress={toggleTheme}
            activeOpacity={0.75}
            accessibilityLabel={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
          >
            <Text style={styles.themeToggleIcon}>
              {isDark ? '☀️' : '🌙'}
            </Text>
            <Text style={[styles.themeToggleLabel, { color: c.textSecondary }]}>
              {isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  rootContent: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 32,
  },
  themeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  themeToggleIcon: {
    fontSize: 18,
  },
  themeToggleLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  logoLetter: {
    fontSize: 38,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
  },
  welcome: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 360,
    marginBottom: 18,
  },
  feedCard: {
    width: '100%',
    maxWidth: 760,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  feedTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  feedTab: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  feedTabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  feedLoading: {
    marginVertical: 16,
  },
  feedErrorText: {
    fontSize: 14,
    marginVertical: 10,
  },
  feedEmptyText: {
    fontSize: 14,
    marginVertical: 10,
  },
  feedList: {
    gap: 10,
  },
  feedPostCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  feedPostHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  feedAuthor: {
    fontSize: 14,
    fontWeight: '700',
  },
  feedDate: {
    fontSize: 12,
  },
  feedCommunity: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  feedText: {
    fontSize: 14,
    lineHeight: 20,
  },
  errorBox: {
    width: '100%',
    maxWidth: 560,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  errorText: {
    fontSize: 14,
  },
  noticeBox: {
    width: '100%',
    maxWidth: 560,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  noticeText: {
    fontSize: 14,
  },
  linkedCard: {
    width: '100%',
    maxWidth: 560,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  linkedTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  linkedSubtitle: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
  },
  providerList: {
    gap: 10,
  },
  providerRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  providerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  providerTextWrap: {
    flex: 1,
  },
  providerName: {
    fontSize: 14,
    fontWeight: '700',
  },
  providerStatus: {
    fontSize: 12,
    marginTop: 2,
  },
  providerButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  logoutButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
