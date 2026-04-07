import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Platform,
  ScrollView,
  TextInput,
  Image,
  Linking,
  Modal,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { api, FeedPost, FeedType, SocialIdentity, SocialProvider } from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import LanguagePicker from '../components/LanguagePicker';
import { AppRoute } from '../routing';

interface HomeScreenProps {
  token: string;
  onLogout: () => void;
  route: AppRoute;
  onNavigate: (route: AppRoute, replace?: boolean) => void;
}

const WELCOME_NOTICE_KEY_PREFIX = '@openspace/welcome_notice_last_shown';
const WELCOME_NOTICE_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

export default function HomeScreen({ token, onLogout, route, onNavigate }: HomeScreenProps) {
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
  const [postRouteLoading, setPostRouteLoading] = useState(false);
  const [activePost, setActivePost] = useState<FeedPost | null>(null);
  const [expandedPostIds, setExpandedPostIds] = useState<Record<number, boolean>>({});
  const [likedPostIds, setLikedPostIds] = useState<Record<number, boolean>>({});
  const [commentBoxPostIds, setCommentBoxPostIds] = useState<Record<number, boolean>>({});
  const [draftComments, setDraftComments] = useState<Record<number, string>>({});
  const [localComments, setLocalComments] = useState<Record<number, string[]>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkedAccountsOpen, setLinkedAccountsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [tooltipTab, setTooltipTab] = useState<FeedType | null>(null);
  const [showWelcomeNotice, setShowWelcomeNotice] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcomeTranslateX = useRef(new Animated.Value(-380)).current;

  const providerOrder: SocialProvider[] = ['google', 'apple'];
  const feedTabs: Array<{ key: FeedType; label: string; icon: string; tooltip: string }> = [
    { key: 'home', label: t('home.feedTabHome'), icon: 'home-variant', tooltip: t('home.feedTabHomeTooltip') },
    { key: 'trending', label: t('home.feedTabTrending'), icon: 'fire', tooltip: t('home.feedTabTrendingTooltip') },
    { key: 'public', label: t('home.feedTabPublic'), icon: 'earth', tooltip: t('home.feedTabPublicTooltip') },
    { key: 'explore', label: t('home.feedTabExplore'), icon: 'compass-outline', tooltip: t('home.feedTabExploreTooltip') },
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
        setFeedError(t('home.feedLoadError'));
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

  useEffect(() => {
    if (route.screen === 'feed') {
      if (route.feed !== activeFeed) {
        setActiveFeed(route.feed);
        loadFeed(route.feed);
      }
      setActivePost(null);
      return;
    }

    if (route.screen === 'post') {
      if (activeFeed !== route.feed && route.feed) {
        setActiveFeed(route.feed);
        loadFeed(route.feed);
      }
      const postInCurrentFeed = feedPosts.find((post) => post.id === route.postId) || null;
      setActivePost(postInCurrentFeed);
      return;
    }

    setActivePost(null);
  }, [route, feedPosts]);

  useEffect(() => {
    const routePostId = route.screen === 'post' ? route.postId : null;
    if (!routePostId) return;
    const postId = routePostId;
    if (activePost?.id === routePostId) return;
    let cancelled = false;

    async function fetchRoutedPost() {
      setPostRouteLoading(true);
      try {
        const fetchedPost = await api.getPostById(token, postId);
        if (cancelled) return;
        setActivePost(fetchedPost);
      } catch {
        if (cancelled) return;
        setError(t('home.feedLoadError'));
      } finally {
        if (!cancelled) setPostRouteLoading(false);
      }
    }

    fetchRoutedPost();
    return () => {
      cancelled = true;
    };
  }, [route, token, activePost?.id]);

  async function loadFeed(feed: FeedType) {
    setFeedLoading(true);
    setFeedError('');
    try {
      const nextPosts = await api.getFeed(token, feed);
      setFeedPosts(nextPosts);
    } catch (e: any) {
      setFeedPosts([]);
      setFeedError(e.message || t('home.feedLoadError'));
    } finally {
      setFeedLoading(false);
    }
  }

  async function handleSelectFeed(feed: FeedType) {
    if (feed === activeFeed && route.screen === 'feed') return;
    setActiveFeed(feed);
    onNavigate({ screen: 'feed', feed });
    if (feed !== activeFeed || route.screen !== 'feed') {
      await loadFeed(feed);
    }
  }

  function getPostText(post: FeedPost) {
    return (post.text || '').trim();
  }

  function getPostReactionCount(post: FeedPost) {
    const apiCount = (post.reactions_emoji_counts || []).reduce((sum, item) => sum + (item?.count || 0), 0);
    const localLike = likedPostIds[post.id] ? 1 : 0;
    return apiCount + localLike;
  }

  function getPostCommentsCount(post: FeedPost) {
    return (post.comments_count || 0) + (localComments[post.id]?.length || 0);
  }

  function toggleExpand(postId: number) {
    setExpandedPostIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
  }

  function toggleLike(postId: number) {
    setLikedPostIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
  }

  function toggleCommentBox(postId: number) {
    setCommentBoxPostIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
  }

  function updateDraftComment(postId: number, value: string) {
    setDraftComments((prev) => ({ ...prev, [postId]: value }));
  }

  function submitComment(postId: number) {
    const nextValue = (draftComments[postId] || '').trim();
    if (!nextValue) return;
    setLocalComments((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), nextValue] }));
    setDraftComments((prev) => ({ ...prev, [postId]: '' }));
  }

  function clearWebFocus() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const activeEl = document.activeElement as HTMLElement | null;
    activeEl?.blur?.();
  }

  function openPostDetail(post: FeedPost) {
    clearWebFocus();
    setActivePost(post);
    onNavigate({ screen: 'post', postId: post.id, feed: activeFeed });
  }

  function closePostDetail() {
    clearWebFocus();
    setActivePost(null);
    onNavigate({ screen: 'feed', feed: activeFeed }, true);
  }

  async function handleSharePost(post: FeedPost) {
    const webBase = process.env.EXPO_PUBLIC_WEB_BASE_URL || 'https://staging.openspace.social';
    const shareUrl = `${webBase.replace(/\/+$/, '')}/posts/${post.uuid || post.id}`;

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        if (navigator.share) {
          await navigator.share({ title: t('home.sharePostTitle'), url: shareUrl });
          return;
        }
        await navigator.clipboard.writeText(shareUrl);
        setNotice(t('home.postLinkCopied'));
        return;
      } catch (e) {
        setError(t('home.shareFailed'));
        return;
      }
    }

    try {
      await Linking.openURL(shareUrl);
    } catch (e) {
      setError(t('home.openShareLinkFailed'));
    }
  }

  function openLink(url?: string) {
    if (!url) return;
    Linking.openURL(url).catch(() => setError(t('home.openLinkFailed')));
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

  function clearTooltipTimer() {
    if (!tooltipTimerRef.current) return;
    clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
  }

  function startTooltipDelay(tabKey: FeedType) {
    clearTooltipTimer();
    tooltipTimerRef.current = setTimeout(() => {
      setTooltipTab(tabKey);
      tooltipTimerRef.current = null;
    }, 2000);
  }

  useEffect(() => {
    return () => clearTooltipTimer();
  }, []);

  function hideWelcomeNotice() {
    if (welcomeTimerRef.current) {
      clearTimeout(welcomeTimerRef.current);
      welcomeTimerRef.current = null;
    }
    Animated.timing(welcomeTranslateX, {
      toValue: -380,
      duration: 260,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShowWelcomeNotice(false);
    });
  }

  function showWelcomeNoticeWithAnimation() {
    if (welcomeTimerRef.current) {
      clearTimeout(welcomeTimerRef.current);
      welcomeTimerRef.current = null;
    }
    setShowWelcomeNotice(true);
    welcomeTranslateX.setValue(-380);
    requestAnimationFrame(() => {
      Animated.timing(welcomeTranslateX, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start();
    });
    welcomeTimerRef.current = setTimeout(() => {
      hideWelcomeNotice();
      welcomeTimerRef.current = null;
    }, 7000);
  }

  useEffect(() => {
    if (loading) return;
    let cancelled = false;

    async function maybeShowWelcomeNotice() {
      const noticeKey = `${WELCOME_NOTICE_KEY_PREFIX}:${user?.username || 'anonymous'}`;
      const now = Date.now();

      try {
        const stored = await AsyncStorage.getItem(noticeKey);
        const lastShown = stored ? Number(stored) : 0;
        const shouldShow =
          !lastShown ||
          Number.isNaN(lastShown) ||
          now - lastShown >= WELCOME_NOTICE_COOLDOWN_MS;

        if (!cancelled && shouldShow) {
          showWelcomeNoticeWithAnimation();
          await AsyncStorage.setItem(noticeKey, String(now));
        }
      } catch {
        if (!cancelled) {
          // Fail-open for UX if storage is unavailable.
          showWelcomeNoticeWithAnimation();
        }
      }
    }

    maybeShowWelcomeNotice();

    return () => {
      cancelled = true;
      if (welcomeTimerRef.current) {
        clearTimeout(welcomeTimerRef.current);
        welcomeTimerRef.current = null;
      }
    };
  }, [loading, user?.username]);

  function handleProfileComingSoon() {
    setProfileMenuOpen(false);
    onNavigate({ screen: 'me' });
  }

  const viewingProfileRoute = route.screen === 'profile' || route.screen === 'me';
  const profileRouteUsername = route.screen === 'profile'
    ? route.username
    : user?.username || '';
  const hasActivePostMedia = !!activePost?.media_thumbnail;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <View style={[styles.topNav, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={styles.topNavLeft}>
          <View style={[styles.topNavBrand, { backgroundColor: c.primary }]}>
            <Text style={styles.topNavBrandLetter}>O</Text>
          </View>
          <View style={[styles.topNavSearch, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
            <MaterialCommunityIcons name="magnify" size={18} color={c.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('home.searchPlaceholder')}
              placeholderTextColor={c.placeholder}
              style={[styles.topNavSearchInput, { color: c.textPrimary }]}
            />
          </View>
        </View>

        <View style={styles.topNavCenter}>
          {feedTabs.map((tab) => {
            const isActive = tab.key === activeFeed;
            return (
              <View key={tab.key} style={styles.topNavFeedWrap}>
                {tooltipTab === tab.key ? (
                  <View style={[styles.feedTooltip, { backgroundColor: c.surface, borderColor: c.border }]}>
                    <Text style={[styles.feedTooltipText, { color: c.textPrimary }]}>
                      {tab.tooltip}
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  style={[styles.topNavFeedButton, { borderBottomColor: isActive ? c.primary : 'transparent' }]}
                  onPress={() => {
                    clearTooltipTimer();
                    setTooltipTab(null);
                    handleSelectFeed(tab.key);
                  }}
                  onHoverIn={() => startTooltipDelay(tab.key)}
                  onHoverOut={() => {
                    clearTooltipTimer();
                    setTooltipTab((current) => (current === tab.key ? null : current));
                  }}
                  onLongPress={() => setTooltipTab(tab.key)}
                  onPressOut={() => {
                    clearTooltipTimer();
                    setTooltipTab((current) => (current === tab.key ? null : current));
                  }}
                  accessibilityLabel={`${tab.label}. ${tab.tooltip}`}
                >
                  <MaterialCommunityIcons
                    name={tab.icon as any}
                    size={22}
                    color={isActive ? c.primary : c.textMuted}
                  />
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.topNavRight}>
          <TouchableOpacity
            style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
            onPress={() => setMenuOpen(true)}
            activeOpacity={0.85}
            accessibilityLabel={t('language.select')}
          >
            <MaterialCommunityIcons name="grid" size={18} color={c.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]} activeOpacity={0.85}>
            <MaterialCommunityIcons name="message-outline" size={18} color={c.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]} activeOpacity={0.85}>
            <MaterialCommunityIcons name="bell-outline" size={18} color={c.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.topNavProfile, { backgroundColor: c.primary }]}
            activeOpacity={0.85}
            onPress={() => setProfileMenuOpen(true)}
            accessibilityLabel={t('home.profileMenuTitle')}
          >
            <Text style={styles.topNavProfileText}>
              {(user?.username?.[0] || 'U').toUpperCase()}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setMenuOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.menuCard,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <TouchableOpacity
                style={[styles.menuItem, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={toggleTheme}
                activeOpacity={0.85}
                accessibilityLabel={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
              >
                <MaterialCommunityIcons
                  name={isDark ? 'weather-sunny' : 'weather-night'}
                  size={18}
                  color={c.textSecondary}
                />
                <Text style={[styles.menuItemText, { color: c.textSecondary }]}>
                  {isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.menuItem, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => {
                  setMenuOpen(false);
                  setLinkedAccountsOpen(true);
                }}
                activeOpacity={0.85}
                accessibilityLabel={t('home.linkedAccountsTitle')}
              >
                <MaterialCommunityIcons
                  name="account-cog-outline"
                  size={18}
                  color={c.textSecondary}
                />
                <Text style={[styles.menuItemText, { color: c.textSecondary }]}>
                  {t('home.linkedAccountsTitle')}
                </Text>
              </TouchableOpacity>

              <View style={[styles.menuLanguageWrap, { borderColor: c.border }]}>
                <Text style={[styles.menuLabel, { color: c.textMuted }]}>
                  {t('language.select')}
                </Text>
                <LanguagePicker />
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={linkedAccountsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLinkedAccountsOpen(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setLinkedAccountsOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.linkedModalCard,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                  {t('home.linkedAccountsTitle')}
                </Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={() => setLinkedAccountsOpen(false)}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

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
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={profileMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileMenuOpen(false)}
      >
        <TouchableOpacity
          style={styles.profileMenuBackdrop}
          activeOpacity={1}
          onPress={() => setProfileMenuOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.profileMenuCard,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <View style={[styles.profileMenuHeader, { borderBottomColor: c.border }]}>
                <View style={[styles.profileMenuAvatar, { backgroundColor: c.primary }]}>
                  <Text style={styles.topNavProfileText}>
                    {(user?.username?.[0] || 'U').toUpperCase()}
                  </Text>
                </View>
                <View style={styles.profileMenuHeaderText}>
                  <Text style={[styles.profileMenuTitle, { color: c.textPrimary }]}>
                    {user?.username || t('home.profileMenuTitle')}
                  </Text>
                  <Text style={[styles.profileMenuSubtitle, { color: c.textMuted }]}>
                    {t('home.profileMenuTitle')}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.profileMenuItem, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                activeOpacity={0.85}
                onPress={handleProfileComingSoon}
              >
                <MaterialCommunityIcons name="account-outline" size={18} color={c.textSecondary} />
                <Text style={[styles.profileMenuItemText, { color: c.textSecondary }]}>
                  {t('home.viewProfileAction')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.profileMenuItem, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                activeOpacity={0.85}
                onPress={() => {
                  setProfileMenuOpen(false);
                  onLogout();
                }}
              >
                <MaterialCommunityIcons name="logout" size={18} color={c.logoutText} />
                <Text style={[styles.profileMenuItemText, { color: c.logoutText }]}>
                  {t('auth.signOut')}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {showWelcomeNotice && !loading ? (
        <View style={styles.welcomeNoticeWrap}>
          <Animated.View
            style={[
              styles.welcomeNotice,
              { backgroundColor: c.surface, borderColor: c.border, transform: [{ translateX: welcomeTranslateX }] },
            ]}
          >
            <Text style={[styles.welcomeNoticeText, { color: c.textPrimary }]}>
              {welcomeText}
            </Text>
            <TouchableOpacity
              style={[styles.welcomeNoticeClose, { backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={hideWelcomeNotice}
              accessibilityLabel={t('home.closeNoticeAction')}
            >
              <MaterialCommunityIcons name="close" size={16} color={c.textSecondary} />
            </TouchableOpacity>
          </Animated.View>
        </View>
      ) : null}

      <Modal
        visible={!!activePost || postRouteLoading}
        transparent={false}
        animationType="fade"
        onRequestClose={closePostDetail}
      >
        {activePost ? (
          hasActivePostMedia ? (
            <View style={[styles.postDetailRoot, { backgroundColor: '#0B0E13' }]}>
              <View style={styles.postDetailLeft}>
                <TouchableOpacity
                  style={[styles.postDetailClose, { backgroundColor: 'rgba(255,255,255,0.16)' }]}
                  onPress={closePostDetail}
                  activeOpacity={0.85}
                  accessibilityLabel={t('home.closeNoticeAction')}
                >
                  <MaterialCommunityIcons name="close" size={22} color="#fff" />
                </TouchableOpacity>

                <View style={styles.postDetailMediaWrap}>
                  <Image
                    source={{ uri: activePost.media_thumbnail }}
                    style={styles.postDetailMedia}
                    resizeMode="contain"
                  />
                </View>
              </View>

              <View style={[styles.postDetailRight, { backgroundColor: c.surface, borderLeftColor: c.border }]}>
                <View style={[styles.postDetailHeader, { borderBottomColor: c.border }]}>
                  <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}>
                    <Text style={styles.feedAvatarLetter}>
                      {(activePost.creator?.username?.[0] || 'O').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.feedHeaderMeta}>
                    <Text style={[styles.feedAuthor, { color: c.textPrimary }]}>
                      @{activePost.creator?.username || 'unknown'}
                    </Text>
                    <Text style={[styles.feedDate, { color: c.textMuted }]}>
                      {activePost.created ? new Date(activePost.created).toLocaleString() : ''}
                    </Text>
                  </View>
                </View>

                <ScrollView style={styles.postDetailBody} contentContainerStyle={styles.postDetailBodyContent}>
                  {!!getPostText(activePost) && (
                    <Text style={[styles.postDetailText, { color: c.textSecondary }]}>
                      {getPostText(activePost)}
                    </Text>
                  )}

                  <View style={[styles.feedStatsRow, { borderTopColor: c.border, borderBottomColor: c.border }]}>
                    <Text style={[styles.feedStatText, { color: c.textMuted }]}>
                      {t('home.feedReactionsCount', { count: getPostReactionCount(activePost) })}
                    </Text>
                    <Text style={[styles.feedStatText, { color: c.textMuted }]}>
                      {t('home.feedCommentsCount', { count: getPostCommentsCount(activePost) })}
                    </Text>
                  </View>

                  <View style={styles.feedActionsRow}>
                    <TouchableOpacity
                      style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: likedPostIds[activePost.id] ? c.surface : c.inputBackground }]}
                      onPress={() => toggleLike(activePost.id)}
                      activeOpacity={0.85}
                    >
                      <MaterialCommunityIcons
                        name={likedPostIds[activePost.id] ? 'thumb-up' : 'thumb-up-outline'}
                        size={16}
                        color={likedPostIds[activePost.id] ? c.primary : c.textSecondary}
                      />
                      <Text style={[styles.feedActionText, { color: likedPostIds[activePost.id] ? c.primary : c.textSecondary }]}>
                        {t('home.reactAction')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      onPress={() => handleSharePost(activePost)}
                      activeOpacity={0.85}
                    >
                      <MaterialCommunityIcons name="share-variant-outline" size={16} color={c.textSecondary} />
                      <Text style={[styles.feedActionText, { color: c.textSecondary }]}>{t('home.shareAction')}</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.commentsBox, { borderTopColor: c.border }]}>
                    {(localComments[activePost.id] || []).map((comment, index) => (
                      <View
                        key={`${activePost.id}-modal-comment-${index}`}
                        style={[styles.commentBubble, { backgroundColor: c.inputBackground, borderColor: c.border }]}
                      >
                        <Text style={[styles.commentBubbleText, { color: c.textSecondary }]}>{comment}</Text>
                      </View>
                    ))}

                    <View style={styles.commentComposer}>
                      <TextInput
                        style={[styles.commentInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                        value={draftComments[activePost.id] || ''}
                        onChangeText={(value) => updateDraftComment(activePost.id, value)}
                        placeholder={t('home.commentPlaceholder')}
                        placeholderTextColor={c.placeholder}
                      />
                      <TouchableOpacity
                        style={[styles.commentSendButton, { backgroundColor: c.primary }]}
                        onPress={() => submitComment(activePost.id)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.commentSendText}>{t('home.commentPostAction')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </ScrollView>
              </View>
            </View>
          ) : (
            <View style={[styles.postDetailTextOnlyRoot, { backgroundColor: '#0B0E13' }]}>
              <View style={[styles.postDetailTextOnlyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <View style={[styles.postDetailTextOnlyHeader, { borderBottomColor: c.border }]}>
                  <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}>
                    <Text style={styles.feedAvatarLetter}>
                      {(activePost.creator?.username?.[0] || 'O').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.feedHeaderMeta}>
                    <Text style={[styles.feedAuthor, { color: c.textPrimary }]}>
                      @{activePost.creator?.username || 'unknown'}
                    </Text>
                    <Text style={[styles.feedDate, { color: c.textMuted }]}>
                      {activePost.created ? new Date(activePost.created).toLocaleString() : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                    onPress={closePostDetail}
                    activeOpacity={0.85}
                    accessibilityLabel={t('home.closeNoticeAction')}
                  >
                    <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.postDetailBody} contentContainerStyle={styles.postDetailBodyContent}>
                  {!!getPostText(activePost) && (
                    <Text style={[styles.postDetailText, { color: c.textSecondary }]}>
                      {getPostText(activePost)}
                    </Text>
                  )}

                  <View style={[styles.feedStatsRow, { borderTopColor: c.border, borderBottomColor: c.border }]}>
                    <Text style={[styles.feedStatText, { color: c.textMuted }]}>
                      {t('home.feedReactionsCount', { count: getPostReactionCount(activePost) })}
                    </Text>
                    <Text style={[styles.feedStatText, { color: c.textMuted }]}>
                      {t('home.feedCommentsCount', { count: getPostCommentsCount(activePost) })}
                    </Text>
                  </View>

                  <View style={styles.feedActionsRow}>
                    <TouchableOpacity
                      style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: likedPostIds[activePost.id] ? c.surface : c.inputBackground }]}
                      onPress={() => toggleLike(activePost.id)}
                      activeOpacity={0.85}
                    >
                      <MaterialCommunityIcons
                        name={likedPostIds[activePost.id] ? 'thumb-up' : 'thumb-up-outline'}
                        size={16}
                        color={likedPostIds[activePost.id] ? c.primary : c.textSecondary}
                      />
                      <Text style={[styles.feedActionText, { color: likedPostIds[activePost.id] ? c.primary : c.textSecondary }]}>
                        {t('home.reactAction')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      onPress={() => handleSharePost(activePost)}
                      activeOpacity={0.85}
                    >
                      <MaterialCommunityIcons name="share-variant-outline" size={16} color={c.textSecondary} />
                      <Text style={[styles.feedActionText, { color: c.textSecondary }]}>{t('home.shareAction')}</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.commentsBox, { borderTopColor: c.border }]}>
                    {(localComments[activePost.id] || []).map((comment, index) => (
                      <View
                        key={`${activePost.id}-modal-comment-${index}`}
                        style={[styles.commentBubble, { backgroundColor: c.inputBackground, borderColor: c.border }]}
                      >
                        <Text style={[styles.commentBubbleText, { color: c.textSecondary }]}>{comment}</Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>

                <View style={[styles.postDetailTextOnlyComposerWrap, { borderTopColor: c.border }]}>
                  <View style={styles.commentComposer}>
                    <TextInput
                      style={[styles.commentInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                      value={draftComments[activePost.id] || ''}
                      onChangeText={(value) => updateDraftComment(activePost.id, value)}
                      placeholder={t('home.commentPlaceholder')}
                      placeholderTextColor={c.placeholder}
                    />
                    <TouchableOpacity
                      style={[styles.commentSendButton, { backgroundColor: c.primary }]}
                      onPress={() => submitComment(activePost.id)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.commentSendText}>{t('home.commentPostAction')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          )
        ) : (
          <View style={[styles.postDetailRoot, { backgroundColor: '#0B0E13', alignItems: 'center', justifyContent: 'center' }]}>
            <ActivityIndicator color="#fff" size="large" />
          </View>
        )}
      </Modal>

      <ScrollView contentContainerStyle={styles.rootContent}>
        {loading ? (
          <ActivityIndicator color={c.primary} size="large" />
        ) : (
          <>
            {viewingProfileRoute ? (
              <View style={[styles.feedCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.welcome, { color: c.textPrimary }]}>
                  @{profileRouteUsername}
                </Text>
                <Text style={[styles.subtitle, { color: c.textMuted }]}>
                  {route.screen === 'me' ? t('home.profileSelfRouteLabel') : t('home.profileRouteLabel')}
                </Text>
              </View>
            ) : null}

            {!viewingProfileRoute ? (
            <View style={[styles.feedCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[styles.subtitle, { color: c.textMuted }]}>
                {t('home.feedSubtitle')}
              </Text>
              {feedLoading ? (
                <ActivityIndicator color={c.primary} size="small" style={styles.feedLoading} />
              ) : feedError ? (
                <Text style={[styles.feedErrorText, { color: c.errorText }]}>{feedError}</Text>
              ) : feedPosts.length === 0 ? (
                <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>
                  {t('home.feedEmpty')}
                </Text>
              ) : (
                <View style={styles.feedList}>
                  {feedPosts.map((post) => (
                    <View
                      key={`${activeFeed}-${post.id}`}
                      style={[styles.feedPostCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    >
                      <View style={styles.feedPostHeader}>
                        <View style={styles.feedHeaderLeft}>
                          <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}>
                            <Text style={styles.feedAvatarLetter}>
                              {(post.creator?.username?.[0] || 'O').toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.feedHeaderMeta}>
                            <TouchableOpacity
                              activeOpacity={0.8}
                              onPress={() => {
                                const username = post.creator?.username;
                                if (!username) return;
                                onNavigate({ screen: 'profile', username });
                              }}
                            >
                              <Text style={[styles.feedAuthor, { color: c.textPrimary }]}>
                                @{post.creator?.username || 'unknown'}
                              </Text>
                            </TouchableOpacity>
                            <Text style={[styles.feedDate, { color: c.textMuted }]}>
                              {post.created ? new Date(post.created).toLocaleString() : ''}
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={[styles.followButton, { borderColor: c.border, backgroundColor: c.surface }]}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.followButtonText, { color: c.textLink }]}>{t('home.followAction')}</Text>
                        </TouchableOpacity>
                      </View>
                      {post.community?.name ? (
                        <Text style={[styles.feedCommunity, { color: c.textLink }]}>
                          /c/{post.community.name}
                        </Text>
                      ) : null}

                      {getPostText(post) ? (
                        <View style={styles.feedTextWrap}>
                          <Text style={[styles.feedText, { color: c.textSecondary }]}>
                            {expandedPostIds[post.id]
                              ? getPostText(post)
                              : `${getPostText(post).slice(0, 240)}${getPostText(post).length > 240 ? '...' : ''}`}
                          </Text>
                          {getPostText(post).length > 240 ? (
                            <TouchableOpacity onPress={() => toggleExpand(post.id)} activeOpacity={0.85}>
                              <Text style={[styles.seeMoreText, { color: c.textLink }]}>
                                {expandedPostIds[post.id] ? t('home.seeLess') : t('home.seeMore')}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      ) : null}

                      {post.media_thumbnail ? (
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() => openPostDetail(post)}
                          accessibilityLabel={t('home.openPostDetailAction')}
                        >
                          <Image source={{ uri: post.media_thumbnail }} style={[styles.feedMedia, { backgroundColor: c.surface }]} resizeMode="contain" />
                        </TouchableOpacity>
                      ) : null}

                      <View style={[styles.feedStatsRow, { borderTopColor: c.border, borderBottomColor: c.border }]}>
                        <Text style={[styles.feedStatText, { color: c.textMuted }]}>
                          {t('home.feedReactionsCount', { count: getPostReactionCount(post) })}
                        </Text>
                        <Text style={[styles.feedStatText, { color: c.textMuted }]}>
                          {t('home.feedCommentsCount', { count: getPostCommentsCount(post) })}
                        </Text>
                      </View>

                      <View style={styles.feedActionsRow}>
                        <TouchableOpacity
                          style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: likedPostIds[post.id] ? c.surface : c.inputBackground }]}
                          onPress={() => toggleLike(post.id)}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons
                            name={likedPostIds[post.id] ? 'thumb-up' : 'thumb-up-outline'}
                            size={16}
                            color={likedPostIds[post.id] ? c.primary : c.textSecondary}
                          />
                          <Text style={[styles.feedActionText, { color: likedPostIds[post.id] ? c.primary : c.textSecondary }]}>
                            {t('home.reactAction')}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                          onPress={() => {
                            if (post.media_thumbnail) {
                              toggleCommentBox(post.id);
                            } else {
                              openPostDetail(post);
                            }
                          }}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons name="comment-outline" size={16} color={c.textSecondary} />
                          <Text style={[styles.feedActionText, { color: c.textSecondary }]}>{t('home.commentAction')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                          onPress={() => handleSharePost(post)}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons name="share-variant-outline" size={16} color={c.textSecondary} />
                          <Text style={[styles.feedActionText, { color: c.textSecondary }]}>{t('home.shareAction')}</Text>
                        </TouchableOpacity>
                      </View>

                      {post.links && post.links.length > 0 ? (
                        <View style={styles.linkChipWrap}>
                          {post.links.slice(0, 3).map((link, idx) => (
                            <TouchableOpacity
                              key={`${post.id}-link-${idx}`}
                              style={[styles.linkChip, { borderColor: c.border, backgroundColor: c.surface }]}
                              onPress={() => openLink(link.url)}
                              activeOpacity={0.85}
                            >
                              <MaterialCommunityIcons name="link-variant" size={14} color={c.textLink} />
                              <Text style={[styles.linkChipText, { color: c.textSecondary }]}>
                                {link.title || link.url || t('home.openLinkAction')}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}

                      {commentBoxPostIds[post.id] ? (
                        <View style={[styles.commentsBox, { borderTopColor: c.border }]}>
                          {(localComments[post.id] || []).map((comment, index) => (
                            <View key={`${post.id}-comment-${index}`} style={[styles.commentBubble, { backgroundColor: c.surface, borderColor: c.border }]}>
                              <Text style={[styles.commentBubbleText, { color: c.textSecondary }]}>{comment}</Text>
                            </View>
                          ))}
                          <View style={styles.commentComposer}>
                            <TextInput
                              style={[styles.commentInput, { borderColor: c.inputBorder, backgroundColor: c.surface, color: c.textPrimary }]}
                              value={draftComments[post.id] || ''}
                              onChangeText={(value) => updateDraftComment(post.id, value)}
                              placeholder={t('home.commentPlaceholder')}
                              placeholderTextColor={c.placeholder}
                            />
                            <TouchableOpacity
                              style={[styles.commentSendButton, { backgroundColor: c.primary }]}
                              onPress={() => submitComment(post.id)}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.commentSendText}>{t('home.commentPostAction')}</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}
            </View>
            ) : null}

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

          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topNav: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    zIndex: 20,
  },
  topNavLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 200,
  },
  topNavBrand: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topNavBrandLetter: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 24,
  },
  topNavSearch: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    maxWidth: 340,
  },
  topNavSearchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  topNavCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 6,
  },
  topNavFeedButton: {
    width: 72,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
  },
  topNavFeedWrap: {
    position: 'relative',
  },
  feedTooltip: {
    position: 'absolute',
    top: 52,
    left: '50%',
    transform: [{ translateX: -74 }],
    width: 148,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    opacity: 1,
    zIndex: 1000,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  feedTooltipText: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    fontWeight: '600',
  },
  topNavRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flex: 1,
    minWidth: 200,
  },
  topNavUtility: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topNavProfile: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topNavProfileText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingTop: 70,
    paddingRight: 16,
  },
  menuCard: {
    width: 280,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  linkedModalCard: {
    width: 520,
    maxWidth: '92%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  linkedModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  profileMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    paddingTop: 70,
    paddingRight: 16,
  },
  profileMenuCard: {
    width: 270,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  profileMenuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  profileMenuAvatar: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileMenuHeaderText: {
    flex: 1,
  },
  profileMenuTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  profileMenuSubtitle: {
    fontSize: 12,
  },
  profileMenuItem: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileMenuItemText: {
    fontSize: 14,
    fontWeight: '600',
  },
  menuItem: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '600',
  },
  menuLanguageWrap: {
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 8,
  },
  menuLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  rootContent: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 32,
  },
  postDetailRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  postDetailTextOnlyRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  postDetailTextOnlyCard: {
    width: '100%',
    maxWidth: 980,
    height: '92%',
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  postDetailTextOnlyHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postDetailTextOnlyComposerWrap: {
    borderTopWidth: 1,
    padding: 12,
  },
  postDetailLeft: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    position: 'relative',
  },
  postDetailClose: {
    position: 'absolute',
    top: 18,
    left: 18,
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  postDetailMediaWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postDetailMedia: {
    width: '100%',
    height: '100%',
    maxWidth: 980,
    maxHeight: 900,
  },
  postDetailMediaFallback: {
    width: '100%',
    maxWidth: 760,
    minHeight: 300,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
  },
  postDetailMediaFallbackText: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '600',
  },
  postDetailRight: {
    width: 420,
    maxWidth: '42%',
    borderLeftWidth: 1,
  },
  postDetailHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postDetailBody: {
    flex: 1,
  },
  postDetailBodyContent: {
    padding: 14,
    gap: 12,
  },
  postDetailText: {
    fontSize: 15,
    lineHeight: 22,
  },
  welcomeNoticeWrap: {
    position: 'absolute',
    top: 86,
    left: 16,
    right: 16,
    alignItems: 'flex-start',
    zIndex: 1100,
    pointerEvents: 'box-none',
  },
  welcomeNotice: {
    width: 420,
    maxWidth: '96%',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  welcomeNoticeText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  welcomeNoticeClose: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
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
  feedHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  feedHeaderMeta: {
    flex: 1,
  },
  feedAvatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedAvatarLetter: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  followButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  followButtonText: {
    fontSize: 12,
    fontWeight: '700',
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
  feedTextWrap: {
    marginBottom: 10,
  },
  seeMoreText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  feedMedia: {
    width: '100%',
    height: 360,
    borderRadius: 12,
    marginBottom: 10,
  },
  feedMediaFallback: {
    width: '100%',
    minHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  feedMediaFallbackText: {
    fontSize: 13,
  },
  feedStatsRow: {
    marginTop: 2,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feedStatText: {
    fontSize: 12,
  },
  feedActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  feedActionButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  feedActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  linkChipWrap: {
    marginTop: 10,
    gap: 8,
  },
  linkChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  linkChipText: {
    fontSize: 12,
    flex: 1,
  },
  commentsBox: {
    marginTop: 10,
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 8,
  },
  commentBubble: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  commentBubbleText: {
    fontSize: 13,
    lineHeight: 19,
  },
  commentComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  commentSendButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  commentSendText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
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
});
