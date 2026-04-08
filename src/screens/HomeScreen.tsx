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
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  api,
  FeedPost,
  FeedType,
  ModerationCategory,
  SearchCommunityResult,
  SearchHashtagResult,
  SearchUserResult,
  SocialIdentity,
  SocialProvider
} from '../api/client';
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
const SEARCH_RESULTS_STATE_KEY_PREFIX = '@openspace/search_results_state';

type ReactionEmoji = {
  id?: number;
  keyword?: string;
  image?: string;
};

type ReactionGroup = {
  id: number;
  keyword?: string;
  color?: string;
  order?: number;
  emojis?: ReactionEmoji[];
};

type PostReaction = {
  id?: number;
  created?: string;
  emoji?: ReactionEmoji;
  reactor?: {
    id?: number;
    username?: string;
    profile?: { avatar?: string };
  };
};

const REPORTABLE_POST_CATEGORY_NAMES = ['spam', 'copyright', 'abuse', 'pornography'] as const;
type ReportablePostCategoryName = typeof REPORTABLE_POST_CATEGORY_NAMES[number];

function getSearchResultsStateKey(username?: string) {
  if (!username) return null;
  return `${SEARCH_RESULTS_STATE_KEY_PREFIX}:${username}`;
}

function normalizeModerationLabel(value?: string) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchesReportCategory(category: ModerationCategory, categoryName: ReportablePostCategoryName) {
  const normalizedName = normalizeModerationLabel(category.name);
  const normalizedTitle = normalizeModerationLabel(category.title);
  switch (categoryName) {
    case 'spam':
      return normalizedName.includes('spam') || normalizedTitle.includes('spam');
    case 'copyright':
      return (
        normalizedName.includes('copyright') ||
        normalizedName.includes('trademark') ||
        normalizedTitle.includes('copyright') ||
        normalizedTitle.includes('trademark')
      );
    case 'abuse':
      return normalizedName.includes('abuse') || normalizedTitle.includes('abuse');
    case 'pornography':
      return (
        normalizedName.includes('porn') ||
        normalizedName.includes('nudity') ||
        normalizedTitle.includes('porn') ||
        normalizedTitle.includes('nudity')
      );
    default:
      return false;
  }
}

export default function HomeScreen({ token, onLogout, route, onNavigate }: HomeScreenProps) {
  const { theme, isDark, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const { width: viewportWidth } = useWindowDimensions();
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
  const [followStateByUsername, setFollowStateByUsername] = useState<Record<string, boolean>>({});
  const [followActionLoadingByUsername, setFollowActionLoadingByUsername] = useState<Record<string, boolean>>({});
  const [postRouteLoading, setPostRouteLoading] = useState(false);
  const [activePost, setActivePost] = useState<FeedPost | null>(null);
  const [expandedPostIds, setExpandedPostIds] = useState<Record<number, boolean>>({});
  const [commentBoxPostIds, setCommentBoxPostIds] = useState<Record<number, boolean>>({});
  const [draftComments, setDraftComments] = useState<Record<number, string>>({});
  const [localComments, setLocalComments] = useState<Record<number, string[]>>({});
  const [reactionGroups, setReactionGroups] = useState<ReactionGroup[]>([]);
  const [reactionPickerPost, setReactionPickerPost] = useState<FeedPost | null>(null);
  const [reactionPickerLoading, setReactionPickerLoading] = useState(false);
  const [reactionActionLoading, setReactionActionLoading] = useState(false);
  const [reactionListOpen, setReactionListOpen] = useState(false);
  const [reactionListLoading, setReactionListLoading] = useState(false);
  const [reactionListEmoji, setReactionListEmoji] = useState<ReactionEmoji | null>(null);
  const [reactionListUsers, setReactionListUsers] = useState<PostReaction[]>([]);
  const [moderationCategories, setModerationCategories] = useState<ModerationCategory[]>([]);
  const [reportPostTarget, setReportPostTarget] = useState<FeedPost | null>(null);
  const [reportingPost, setReportingPost] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchUsers, setSearchUsers] = useState<SearchUserResult[]>([]);
  const [searchCommunities, setSearchCommunities] = useState<SearchCommunityResult[]>([]);
  const [searchHashtags, setSearchHashtags] = useState<SearchHashtagResult[]>([]);
  const [searchResultsActive, setSearchResultsActive] = useState(false);
  const [searchResultsLoading, setSearchResultsLoading] = useState(false);
  const [searchResultsQuery, setSearchResultsQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkedAccountsOpen, setLinkedAccountsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [tooltipTab, setTooltipTab] = useState<FeedType | null>(null);
  const [showWelcomeNotice, setShowWelcomeNotice] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestSeqRef = useRef(0);
  const committedSearchRequestSeqRef = useRef(0);
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
    if (!user?.username) return;
    let cancelled = false;

    async function restoreCommittedSearchState() {
      const key = getSearchResultsStateKey(user.username);
      if (!key) return;

      try {
        const raw = await AsyncStorage.getItem(key);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as { query?: string };
        const persistedQuery = (parsed?.query || '').trim();
        if (persistedQuery.length < 2) return;

        setSearchQuery(persistedQuery);
        setSearchResultsActive(true);
        setSearchResultsQuery(persistedQuery);
        await loadSearchResults(persistedQuery, 20, setSearchResultsLoading, committedSearchRequestSeqRef);
      } catch {
        // ignore storage parse/read issues
      }
    }

    restoreCommittedSearchState();

    return () => {
      cancelled = true;
    };
  }, [user?.username]);

  useEffect(() => {
    let active = true;

    api.getModerationCategories(token)
      .then((categories) => {
        if (!active) return;
        setModerationCategories(categories || []);
      })
      .catch(() => {
        if (!active) return;
        setModerationCategories([]);
      });

    return () => {
      active = false;
    };
  }, [token]);

  async function loadSearchResults(
    query: string,
    count: number,
    loadingSetter?: (value: boolean) => void,
    requestSeqRef: React.MutableRefObject<number> = searchRequestSeqRef
  ) {
    const requestSeq = ++requestSeqRef.current;
    if (loadingSetter) loadingSetter(true);
    setSearchError('');

    try {
      const [usersResult, communitiesResult, hashtagsResult] = await Promise.allSettled([
        api.searchUsers(token, query, Math.min(count, 10)),
        api.searchCommunities(token, query, count),
        api.searchHashtags(token, query, Math.min(count, 10)),
      ]);

      if (requestSeq !== requestSeqRef.current) return;

      const users = usersResult.status === 'fulfilled' ? usersResult.value : [];
      const communities = communitiesResult.status === 'fulfilled' ? communitiesResult.value : [];
      const hashtags = hashtagsResult.status === 'fulfilled' ? hashtagsResult.value : [];

      setSearchUsers(users);
      setSearchCommunities(communities);
      setSearchHashtags(hashtags);

      if (
        usersResult.status === 'rejected' &&
        communitiesResult.status === 'rejected' &&
        hashtagsResult.status === 'rejected'
      ) {
        setSearchError(t('home.searchLoadError'));
      } else {
        setSearchError('');
      }
    } finally {
      if (requestSeq === requestSeqRef.current && loadingSetter) {
        loadingSetter(false);
      }
    }
  }

  useEffect(() => {
    const query = searchQuery.trim();

    if (query.length < 2) {
      setSearchLoading(false);
      setSearchError('');
      if (!searchResultsActive) {
        setSearchUsers([]);
        setSearchCommunities([]);
        setSearchHashtags([]);
      }
      return;
    }

    const timer = setTimeout(() => {
      loadSearchResults(query, 8, setSearchLoading, searchRequestSeqRef);
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery, t, token, searchResultsActive]);

  useEffect(() => (
    () => {
      if (searchBlurTimerRef.current) {
        clearTimeout(searchBlurTimerRef.current);
        searchBlurTimerRef.current = null;
      }
    }
  ), []);

  useEffect(() => {
    if (route.screen === 'feed') {
      if (route.feed !== activeFeed) {
        setActiveFeed(route.feed);
        loadFeed(route.feed);
      }
      setActivePost(null);
      return;
    }

    if (route.screen === 'search') {
      const routedQuery = (route.query || '').trim();
      if (routedQuery.length >= 2) {
        setSearchQuery(routedQuery);
        setSearchResultsActive(true);
        setSearchResultsQuery(routedQuery);
        loadSearchResults(routedQuery, 20, setSearchResultsLoading, committedSearchRequestSeqRef);
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

  useEffect(() => {
    setFollowStateByUsername((prev) => {
      const next = { ...prev };
      for (const post of feedPosts) {
        const username = post.creator?.username;
        if (!username || username in next) continue;
        if (typeof post.creator?.is_following === 'boolean') {
          next[username] = post.creator.is_following;
        }
      }
      return next;
    });
  }, [feedPosts]);

  async function handleToggleFollow(username: string, currentlyFollowing: boolean) {
    if (!username || followActionLoadingByUsername[username]) return;

    setFollowActionLoadingByUsername((prev) => ({ ...prev, [username]: true }));
    try {
      if (currentlyFollowing) {
        await api.unfollowUser(token, username);
      } else {
        await api.followUser(token, username);
      }

      setFollowStateByUsername((prev) => ({ ...prev, [username]: !currentlyFollowing }));
      setFeedPosts((prev) =>
        prev.map((post) => {
          if (post.creator?.username !== username) return post;
          return {
            ...post,
            creator: {
              ...post.creator,
              is_following: !currentlyFollowing,
            },
          };
        })
      );
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
    } finally {
      setFollowActionLoadingByUsername((prev) => ({ ...prev, [username]: false }));
    }
  }

  async function handleSelectFeed(feed: FeedType) {
    if (feed === activeFeed && route.screen === 'feed') return;
    closeSearchDropdown();
    if (user?.username) {
      const key = getSearchResultsStateKey(user.username);
      if (key) await AsyncStorage.removeItem(key);
    }
    setSearchResultsActive(false);
    setSearchResultsLoading(false);
    setSearchResultsQuery('');
    setActiveFeed(feed);
    onNavigate({ screen: 'feed', feed });
    if (feed !== activeFeed || route.screen !== 'feed') {
      await loadFeed(feed);
    }
  }

  function getPostText(post: FeedPost) {
    return (post.text || '').trim();
  }

  function getPostLengthType(post: FeedPost): 'long' | 'short' {
    return getPostText(post).length > 280 ? 'long' : 'short';
  }

  function getPostReactionCount(post: FeedPost) {
    return (post.reactions_emoji_counts || []).reduce((sum, item) => sum + (item?.count || 0), 0);
  }

  function getPostCommentsCount(post: FeedPost) {
    return (post.comments_count || 0) + (localComments[post.id]?.length || 0);
  }

  function toggleExpand(postId: number) {
    setExpandedPostIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
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

  function applyPostPatch(postId: number, patch: (post: FeedPost) => FeedPost) {
    setFeedPosts((prev) => prev.map((post) => (post.id === postId ? patch(post) : post)));
    setActivePost((prev) => (prev && prev.id === postId ? patch(prev) : prev));
  }

  async function ensureReactionGroups() {
    if (reactionGroups.length > 0) return;
    setReactionPickerLoading(true);
    try {
      const groups = await api.getPostReactionEmojiGroups(token);
      setReactionGroups(groups);
    } catch (e: any) {
      setError(e?.message || t('home.reactionLoadFailed'));
    } finally {
      setReactionPickerLoading(false);
    }
  }

  async function refreshPostReactionCounts(post: FeedPost) {
    if (!post.uuid) return;
    try {
      const counts = await api.getPostReactionCounts(token, post.uuid);
      applyPostPatch(post.id, (current) => ({ ...current, reactions_emoji_counts: counts }));
    } catch {
      // Keep UI resilient if counts refresh fails.
    }
  }

  async function openReactionPicker(post: FeedPost) {
    setReactionPickerPost(post);
    await ensureReactionGroups();
  }

  function closeReactionPicker() {
    if (reactionActionLoading) return;
    setReactionPickerPost(null);
  }

  async function reactToPostWithEmoji(post: FeedPost, emojiId?: number) {
    if (!post.uuid || !emojiId || reactionActionLoading) return;
    setReactionActionLoading(true);
    try {
      const reaction = await api.reactToPost(token, post.uuid, emojiId);
      applyPostPatch(post.id, (current) => ({ ...current, reaction }));
      await refreshPostReactionCounts(post);
      setReactionPickerPost(null);
    } catch (e: any) {
      setError(e?.message || t('home.reactionLoadFailed'));
    } finally {
      setReactionActionLoading(false);
    }
  }

  function openReportPostModal(post: FeedPost) {
    setReportPostTarget(post);
  }

  function closeReportPostModal() {
    if (reportingPost) return;
    setReportPostTarget(null);
  }

  async function submitPostReport(categoryName: ReportablePostCategoryName) {
    if (!reportPostTarget?.uuid) {
      setError(t('home.reportPostUnavailable'));
      return;
    }

    const category = moderationCategories.find((item) => matchesReportCategory(item, categoryName));
    if (!category?.id) {
      setError(t('home.reportPostCategoriesUnavailable'));
      return;
    }

    setReportingPost(true);
    try {
      const message = await api.reportPost(token, reportPostTarget.uuid, category.id);
      setNotice(message || t('home.reportPostSuccess'));
      setReportPostTarget(null);
    } catch (e: any) {
      setError(e?.message || t('home.reportPostFailed'));
    } finally {
      setReportingPost(false);
    }
  }

  async function openReactionList(post: FeedPost, emoji?: ReactionEmoji) {
    if (!post.uuid || !emoji?.id) {
      setError(t('home.reactionUnavailable'));
      return;
    }
    setReactionListOpen(true);
    setReactionListEmoji(emoji);
    setReactionListUsers([]);
    setReactionListLoading(true);
    try {
      const reactions = await api.getPostReactions(token, post.uuid, emoji.id);
      setReactionListUsers(reactions);
    } catch (e: any) {
      setError(e?.message || t('home.reactionLoadFailed'));
    } finally {
      setReactionListLoading(false);
    }
  }

  function closeReactionList() {
    setReactionListOpen(false);
    setReactionListEmoji(null);
    setReactionListUsers([]);
    setReactionListLoading(false);
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

  function handleSearchFocus() {
    if (searchBlurTimerRef.current) {
      clearTimeout(searchBlurTimerRef.current);
      searchBlurTimerRef.current = null;
    }
    setSearchFocused(true);
  }

  function handleSearchBlur() {
    searchBlurTimerRef.current = setTimeout(() => {
      setSearchFocused(false);
    }, 180);
  }

  function closeSearchDropdown() {
    if (searchBlurTimerRef.current) {
      clearTimeout(searchBlurTimerRef.current);
      searchBlurTimerRef.current = null;
    }
    setSearchFocused(false);
  }

  async function handleShowAllSearchResults() {
    const query = searchQuery.trim();
    if (query.length < 2) return;
    closeSearchDropdown();
    setSearchResultsActive(true);
    setSearchResultsQuery(query);
    onNavigate({ screen: 'search', query });
    if (user?.username) {
      const key = getSearchResultsStateKey(user.username);
      if (key) {
        await AsyncStorage.setItem(
          key,
          JSON.stringify({
            query,
            updated_at: Date.now(),
          })
        );
      }
    }
    await loadSearchResults(query, 20, setSearchResultsLoading, committedSearchRequestSeqRef);
  }

  async function handleBackToHomeFeed() {
    if (user?.username) {
      const key = getSearchResultsStateKey(user.username);
      if (key) await AsyncStorage.removeItem(key);
    }
    setSearchResultsActive(false);
    setSearchResultsLoading(false);
    setSearchResultsQuery('');
    setSearchQuery('');
    closeSearchDropdown();
    setActiveFeed('home');
    onNavigate({ screen: 'feed', feed: 'home' });
    await loadFeed('home');
  }

  function handleSelectSearchUser(username?: string) {
    if (!username) return;
    closeSearchDropdown();
    onNavigate({ screen: 'profile', username });
  }

  function handleSelectSearchCommunity(name?: string) {
    if (!name) return;
    closeSearchDropdown();
    onNavigate({ screen: 'community', name });
  }

  function handleSelectSearchHashtag(name?: string) {
    if (!name) return;
    closeSearchDropdown();
    onNavigate({ screen: 'hashtag', name });
  }

  const viewingProfileRoute = route.screen === 'profile' || route.screen === 'me';
  const viewingCommunityRoute = route.screen === 'community';
  const viewingHashtagRoute = route.screen === 'hashtag';
  const profileRouteUsername = route.screen === 'profile'
    ? route.username
    : user?.username || '';
  const communityRouteName = route.screen === 'community' ? route.name : '';
  const hashtagRouteName = route.screen === 'hashtag' ? route.name : '';
  const showSearchDropdown = searchFocused && searchQuery.trim().length >= 2;
  const hasAnySearchResults = searchUsers.length > 0 || searchCommunities.length > 0 || searchHashtags.length > 0;
  const hasActivePostMedia = !!activePost?.media_thumbnail;
  const showingMainSearchResults = !viewingProfileRoute &&
    !viewingCommunityRoute &&
    !viewingHashtagRoute &&
    searchResultsActive &&
    searchResultsQuery.length >= 2;
  const isWideSearchResultsLayout = viewportWidth >= 1200;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <View style={[styles.topNav, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={styles.topNavLeft}>
          <TouchableOpacity
            style={[styles.topNavBrand, { backgroundColor: c.primary }]}
            activeOpacity={0.85}
            onPress={handleBackToHomeFeed}
            accessibilityLabel={t('home.backToHomeFeedAction')}
          >
            <Text style={styles.topNavBrandLetter}>O</Text>
          </TouchableOpacity>
          <View style={styles.topNavSearchWrap}>
            <View style={[styles.topNavSearch, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
              <MaterialCommunityIcons name="magnify" size={18} color={c.textMuted} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={handleSearchFocus}
                onBlur={handleSearchBlur}
                onSubmitEditing={handleShowAllSearchResults}
                placeholder={t('home.searchPlaceholder')}
                placeholderTextColor={c.placeholder}
                style={[styles.topNavSearchInput, { color: c.textPrimary }]}
              />
            </View>

            {showSearchDropdown ? (
              <View style={[styles.searchDropdown, { backgroundColor: c.surface, borderColor: c.border }]}>
                {searchLoading ? (
                  <View style={styles.searchDropdownLoading}>
                    <ActivityIndicator color={c.primary} size="small" />
                  </View>
                ) : null}

                {!searchLoading ? (
                  <ScrollView
                    style={styles.searchDropdownScroll}
                    contentContainerStyle={styles.searchDropdownScrollContent}
                    keyboardShouldPersistTaps="handled"
                  >
                    <TouchableOpacity
                      style={[styles.searchShowAllButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      onPress={handleShowAllSearchResults}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.searchShowAllButtonText, { color: c.textLink }]}>
                        {t('home.searchShowAllAction')}
                      </Text>
                    </TouchableOpacity>

                    <View style={styles.searchSection}>
                      <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>
                        {t('home.searchSectionUsers')}
                      </Text>
                      {searchUsers.length === 0 ? (
                        <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>
                          {t('home.searchNoUsers')}
                        </Text>
                      ) : (
                        searchUsers.map((item) => (
                          <TouchableOpacity
                            key={`search-user-${item.id}`}
                            style={[styles.searchResultRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                            activeOpacity={0.85}
                            onPress={() => handleSelectSearchUser(item.username)}
                          >
                            <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                              {item.profile?.avatar ? (
                                <Image source={{ uri: item.profile.avatar }} style={styles.searchAvatarImage} resizeMode="cover" />
                              ) : (
                                <Text style={styles.searchAvatarLetter}>
                                  {(item.username?.[0] || t('home.unknownUser')[0] || 'U').toUpperCase()}
                                </Text>
                              )}
                            </View>
                            <View style={styles.searchResultMeta}>
                              <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>
                                @{item.username || t('home.unknownUser')}
                              </Text>
                              <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>
                                {item.profile?.name || t('home.searchNoDisplayName')}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>

                    <View style={styles.searchSection}>
                      <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>
                        {t('home.searchSectionCommunities')}
                      </Text>
                      {searchCommunities.length === 0 ? (
                        <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>
                          {t('home.searchNoCommunities')}
                        </Text>
                      ) : (
                        searchCommunities.map((item) => (
                          <TouchableOpacity
                            key={`search-community-${item.id}`}
                            style={[styles.searchResultRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                            activeOpacity={0.85}
                            onPress={() => handleSelectSearchCommunity(item.name)}
                          >
                            <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                              {item.avatar ? (
                                <Image source={{ uri: item.avatar }} style={styles.searchAvatarImage} resizeMode="cover" />
                              ) : (
                                <MaterialCommunityIcons name="account-group-outline" size={16} color="#fff" />
                              )}
                            </View>
                            <View style={styles.searchResultMeta}>
                              <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>
                                c/{item.name || t('home.unknownUser')}
                              </Text>
                              <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>
                                {item.title || t('home.searchNoCommunityTitle')}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>

                    <View style={styles.searchSection}>
                      <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>
                        {t('home.searchSectionHashtags')}
                      </Text>
                      {searchHashtags.length === 0 ? (
                        <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>
                          {t('home.searchNoHashtags')}
                        </Text>
                      ) : (
                        searchHashtags.map((item) => (
                          <TouchableOpacity
                            key={`search-hashtag-${item.id}`}
                            style={[styles.searchResultRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                            activeOpacity={0.85}
                            onPress={() => handleSelectSearchHashtag(item.name)}
                          >
                            <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                              {item.image || item.emoji?.image ? (
                                <Image source={{ uri: item.image || item.emoji?.image }} style={styles.searchAvatarImage} resizeMode="cover" />
                              ) : (
                                <MaterialCommunityIcons name="pound" size={16} color="#fff" />
                              )}
                            </View>
                            <View style={styles.searchResultMeta}>
                              <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>
                                #{item.name || t('home.unknownUser')}
                              </Text>
                              <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>
                                {t('home.searchHashtagPostsCount', { count: item.posts_count || 0 })}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>

                    {searchError ? (
                      <Text style={[styles.searchSectionError, { color: c.errorText }]}>
                        {searchError}
                      </Text>
                    ) : null}

                    {!searchError && !hasAnySearchResults ? (
                      <Text style={[styles.searchSectionEmptyGlobal, { color: c.textMuted }]}>
                        {t('home.searchNoResults')}
                      </Text>
                    ) : null}
                  </ScrollView>
                ) : null}
              </View>
            ) : null}
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

      <Modal
        visible={!!reactionPickerPost}
        transparent
        animationType="fade"
        onRequestClose={closeReactionPicker}
      >
        <TouchableOpacity style={styles.reactionPickerBackdrop} activeOpacity={1} onPress={closeReactionPicker}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.reactionPickerCard,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>{t('home.reactionPickerTitle')}</Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={closeReactionPicker}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              {reactionPickerLoading ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : (
                <View style={styles.reactionPickerContent}>
                  <ScrollView style={styles.reactionPickerScroll} contentContainerStyle={styles.reactionPickerScrollContent}>
                    {reactionGroups.map((group) => (
                      <View key={`reaction-group-${group.id}`} style={styles.reactionGroup}>
                        <Text style={[styles.reactionGroupTitle, { color: c.textMuted }]}>
                          {group.keyword || t('home.reactAction')}
                        </Text>
                        <View style={styles.reactionEmojiWrap}>
                          {(group.emojis || []).map((emoji) => (
                            <TouchableOpacity
                              key={`reaction-emoji-${group.id}-${emoji.id}`}
                              style={[styles.reactionEmojiButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                              activeOpacity={0.85}
                              disabled={reactionActionLoading}
                              onPress={() => reactToPostWithEmoji(reactionPickerPost as FeedPost, emoji.id)}
                            >
                              {emoji.image ? (
                                <Image source={{ uri: emoji.image }} style={styles.reactionEmojiImage} resizeMode="contain" />
                              ) : (
                                <MaterialCommunityIcons name="emoticon-outline" size={20} color={c.textSecondary} />
                              )}
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={reactionListOpen}
        transparent
        animationType="fade"
        onRequestClose={closeReactionList}
      >
        <TouchableOpacity style={styles.reactionListBackdrop} activeOpacity={1} onPress={closeReactionList}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.reactionListCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                  {t('home.reactionReactorsTitle')}
                </Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={closeReactionList}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.reactionListSubtitle, { color: c.textMuted }]}>
                {reactionListEmoji?.keyword || ''}
              </Text>

              {reactionListLoading ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : reactionListUsers.length === 0 ? (
                <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>{t('home.reactionReactorsEmpty')}</Text>
              ) : (
                <View style={styles.reactionListContent}>
                  <ScrollView style={styles.reactionListScroll} contentContainerStyle={styles.reactionListScrollContent}>
                    {reactionListUsers.map((item, idx) => (
                      <View
                        key={`reaction-user-${item.id || idx}`}
                        style={[styles.reactionUserRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      >
                        <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}>
                          <Text style={styles.feedAvatarLetter}>
                            {(item.reactor?.username?.[0] || 'O').toUpperCase()}
                          </Text>
                        </View>
                        <View style={styles.feedHeaderMeta}>
                          <Text style={[styles.feedAuthor, { color: c.textPrimary }]}>
                            @{item.reactor?.username || t('home.unknownUser')}
                          </Text>
                          <Text style={[styles.feedDate, { color: c.textMuted }]}>
                            {item.created ? new Date(item.created).toLocaleString() : ''}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={!!reportPostTarget}
        transparent
        animationType="fade"
        onRequestClose={closeReportPostModal}
      >
        <TouchableOpacity style={styles.reactionListBackdrop} activeOpacity={1} onPress={closeReportPostModal}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.reportModalCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                  {t('home.reportPostTitle')}
                </Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={closeReportPostModal}
                  activeOpacity={0.85}
                  disabled={reportingPost}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.reportModalSubtitle, { color: c.textMuted }]}>
                {t('home.reportPostPrompt')}
              </Text>

              <ScrollView
                style={styles.reportOptionScroll}
                contentContainerStyle={styles.reportOptionList}
                showsVerticalScrollIndicator
              >
                {REPORTABLE_POST_CATEGORY_NAMES.map((categoryName) => (
                  <TouchableOpacity
                    key={`report-option-${categoryName}`}
                    style={[styles.reportOptionCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    activeOpacity={0.85}
                    onPress={() => submitPostReport(categoryName)}
                    disabled={reportingPost}
                  >
                    <Text style={[styles.reportOptionTitle, { color: c.textPrimary }]}>
                      {t(`home.reportCategory.${categoryName}.title`)}
                    </Text>
                    <Text style={[styles.reportOptionDescription, { color: c.textMuted }]}>
                      {t(`home.reportCategory.${categoryName}.description`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {reportingPost ? <ActivityIndicator color={c.primary} size="small" /> : null}
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
                      @{activePost.creator?.username || t('home.unknownUser')}
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
                  {(activePost.reactions_emoji_counts || []).length > 0 ? (
                    <View style={styles.reactionSummaryWrap}>
                      {(activePost.reactions_emoji_counts || [])
                        .filter((entry) => (entry?.count || 0) > 0)
                        .map((entry, idx) => (
                          <TouchableOpacity
                            key={`${activePost.id}-reaction-summary-modal-${entry.emoji?.id || idx}`}
                            style={[styles.reactionSummaryChip, { borderColor: c.border, backgroundColor: c.surface }]}
                            onPress={() => openReactionList(activePost, entry.emoji)}
                            activeOpacity={0.85}
                          >
                            {entry.emoji?.image ? (
                              <Image source={{ uri: entry.emoji.image }} style={styles.reactionSummaryEmojiImage} resizeMode="contain" />
                            ) : (
                              <MaterialCommunityIcons name="emoticon-outline" size={14} color={c.textSecondary} />
                            )}
                            <Text style={[styles.reactionSummaryCount, { color: c.textSecondary }]}>
                              {entry.count || 0}
                            </Text>
                          </TouchableOpacity>
                        ))}
                    </View>
                  ) : null}

                  <View style={styles.feedActionsRow}>
                        <TouchableOpacity
                          style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                          onPress={() => openReactionPicker(activePost)}
                          activeOpacity={0.85}
                        >
                      <MaterialCommunityIcons name="emoticon-outline" size={16} color={c.textSecondary} />
                      <Text style={[styles.feedActionText, { color: c.textSecondary }]}>{t('home.reactAction')}</Text>
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
                      @{activePost.creator?.username || t('home.unknownUser')}
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
                  {(activePost.reactions_emoji_counts || []).length > 0 ? (
                    <View style={styles.reactionSummaryWrap}>
                      {(activePost.reactions_emoji_counts || [])
                        .filter((entry) => (entry?.count || 0) > 0)
                        .map((entry, idx) => (
                          <TouchableOpacity
                            key={`${activePost.id}-reaction-summary-text-${entry.emoji?.id || idx}`}
                            style={[styles.reactionSummaryChip, { borderColor: c.border, backgroundColor: c.surface }]}
                            onPress={() => openReactionList(activePost, entry.emoji)}
                            activeOpacity={0.85}
                          >
                            {entry.emoji?.image ? (
                              <Image source={{ uri: entry.emoji.image }} style={styles.reactionSummaryEmojiImage} resizeMode="contain" />
                            ) : (
                              <MaterialCommunityIcons name="emoticon-outline" size={14} color={c.textSecondary} />
                            )}
                            <Text style={[styles.reactionSummaryCount, { color: c.textSecondary }]}>
                              {entry.count || 0}
                            </Text>
                          </TouchableOpacity>
                        ))}
                    </View>
                  ) : null}

                  <View style={styles.feedActionsRow}>
                    <TouchableOpacity
                      style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      onPress={() => openReactionPicker(activePost)}
                      activeOpacity={0.85}
                    >
                      <MaterialCommunityIcons name="emoticon-outline" size={16} color={c.textSecondary} />
                      <Text style={[styles.feedActionText, { color: c.textSecondary }]}>{t('home.reactAction')}</Text>
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

            {viewingCommunityRoute ? (
              <View style={[styles.feedCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.welcome, { color: c.textPrimary }]}>
                  c/{communityRouteName}
                </Text>
                <Text style={[styles.subtitle, { color: c.textMuted }]}>
                  {t('home.communityRouteLabel', { community: communityRouteName })}
                </Text>
              </View>
            ) : null}

            {viewingHashtagRoute ? (
              <View style={[styles.feedCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.welcome, { color: c.textPrimary }]}>
                  #{hashtagRouteName}
                </Text>
                <Text style={[styles.subtitle, { color: c.textMuted }]}>
                  {t('home.hashtagRouteLabel', { hashtag: hashtagRouteName })}
                </Text>
              </View>
            ) : null}

            {showingMainSearchResults ? (
              <View style={isWideSearchResultsLayout ? styles.searchResultsWideLayout : undefined}>
                {isWideSearchResultsLayout ? <View style={styles.searchResultsLeftReserve} /> : null}
                <View
                  style={[
                    styles.feedCard,
                    isWideSearchResultsLayout ? styles.searchResultsMainCard : null,
                    { backgroundColor: c.surface, borderColor: c.border },
                  ]}
                >
                <View style={styles.searchMainHeader}>
                  <TouchableOpacity
                    style={[styles.searchShowAllButton, styles.backToFeedButton, styles.backToFeedButtonSlim, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    onPress={handleBackToHomeFeed}
                    activeOpacity={0.85}
                  >
                    <View style={styles.backToFeedButtonContent}>
                      <MaterialCommunityIcons name="arrow-left" size={16} color={c.textLink} />
                      <Text style={[styles.searchShowAllButtonText, styles.backToFeedButtonText, { color: c.textLink }]}>
                        {t('home.backToHomeFeedAction')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={[styles.searchMainTitle, { color: c.textPrimary }]}>
                    {t('home.searchResultsFor', { query: searchResultsQuery })}
                  </Text>
                </View>

                {searchResultsLoading ? (
                  <ActivityIndicator color={c.primary} size="small" style={styles.feedLoading} />
                ) : (
                  <View style={styles.searchMainSections}>
                    <View style={styles.searchSection}>
                      <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>
                        {t('home.searchSectionUsers')}
                      </Text>
                      {searchUsers.length === 0 ? (
                        <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>
                          {t('home.searchNoUsers')}
                        </Text>
                      ) : (
                        <View style={styles.searchTileGrid}>
                          {searchUsers.map((item) => (
                            <TouchableOpacity
                              key={`main-search-user-${item.id}`}
                              style={[
                                styles.searchTile,
                                isWideSearchResultsLayout ? styles.searchTileWide : null,
                                { borderColor: c.border, backgroundColor: c.inputBackground },
                              ]}
                              activeOpacity={0.85}
                              onPress={() => handleSelectSearchUser(item.username)}
                            >
                              <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                                {item.profile?.avatar ? (
                                  <Image source={{ uri: item.profile.avatar }} style={styles.searchAvatarImage} resizeMode="cover" />
                                ) : (
                                  <Text style={styles.searchAvatarLetter}>
                                    {(item.username?.[0] || t('home.unknownUser')[0] || 'U').toUpperCase()}
                                  </Text>
                                )}
                              </View>
                              <View style={styles.searchResultMeta}>
                                <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>
                                  @{item.username || t('home.unknownUser')}
                                </Text>
                                <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>
                                  {item.profile?.name || t('home.searchNoDisplayName')}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>

                    <View style={styles.searchSection}>
                      <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>
                        {t('home.searchSectionCommunities')}
                      </Text>
                      {searchCommunities.length === 0 ? (
                        <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>
                          {t('home.searchNoCommunities')}
                        </Text>
                      ) : (
                        <View style={styles.searchTileGrid}>
                          {searchCommunities.map((item) => (
                            <TouchableOpacity
                              key={`main-search-community-${item.id}`}
                              style={[
                                styles.searchTile,
                                isWideSearchResultsLayout ? styles.searchTileWide : null,
                                { borderColor: c.border, backgroundColor: c.inputBackground },
                              ]}
                              activeOpacity={0.85}
                              onPress={() => handleSelectSearchCommunity(item.name)}
                            >
                              <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                                {item.avatar ? (
                                  <Image source={{ uri: item.avatar }} style={styles.searchAvatarImage} resizeMode="cover" />
                                ) : (
                                  <MaterialCommunityIcons name="account-group-outline" size={16} color="#fff" />
                                )}
                              </View>
                              <View style={styles.searchResultMeta}>
                                <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>
                                  c/{item.name || t('home.unknownUser')}
                                </Text>
                                <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>
                                  {item.title || t('home.searchNoCommunityTitle')}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>

                    <View style={styles.searchSection}>
                      <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>
                        {t('home.searchSectionHashtags')}
                      </Text>
                      {searchHashtags.length === 0 ? (
                        <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>
                          {t('home.searchNoHashtags')}
                        </Text>
                      ) : (
                        <View style={styles.searchTileGrid}>
                          {searchHashtags.map((item) => (
                            <TouchableOpacity
                              key={`main-search-hashtag-${item.id}`}
                              style={[
                                styles.searchTile,
                                isWideSearchResultsLayout ? styles.searchTileWide : null,
                                { borderColor: c.border, backgroundColor: c.inputBackground },
                              ]}
                              activeOpacity={0.85}
                              onPress={() => handleSelectSearchHashtag(item.name)}
                            >
                              <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                                {item.image || item.emoji?.image ? (
                                  <Image source={{ uri: item.image || item.emoji?.image }} style={styles.searchAvatarImage} resizeMode="cover" />
                                ) : (
                                  <MaterialCommunityIcons name="pound" size={16} color="#fff" />
                                )}
                              </View>
                              <View style={styles.searchResultMeta}>
                                <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>
                                  #{item.name || t('home.unknownUser')}
                                </Text>
                                <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>
                                  {t('home.searchHashtagPostsCount', { count: item.posts_count || 0 })}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>

                    {searchError ? (
                      <Text style={[styles.searchSectionError, { color: c.errorText }]}>
                        {searchError}
                      </Text>
                    ) : null}

                    {!searchError && !hasAnySearchResults ? (
                      <Text style={[styles.searchSectionEmptyGlobal, { color: c.textMuted }]}>
                        {t('home.searchNoResults')}
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>
              </View>
            ) : null}

            {!viewingProfileRoute && !viewingCommunityRoute && !viewingHashtagRoute && !showingMainSearchResults ? (
            <View style={[styles.feedCard, { backgroundColor: c.surface, borderColor: c.border }]}>
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
                            {post.community?.name ? (
                              <TouchableOpacity
                                activeOpacity={0.8}
                                onPress={() => onNavigate({ screen: 'community', name: post.community?.name || '' })}
                              >
                                <Text style={[styles.feedCommunityHeaderLink, { color: c.textLink }]}>
                                  c/{post.community.name}
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                            <TouchableOpacity
                              activeOpacity={0.8}
                              onPress={() => {
                                const username = post.creator?.username;
                                if (!username) return;
                                onNavigate({ screen: 'profile', username });
                              }}
                            >
                              <Text style={[styles.feedAuthor, { color: c.textPrimary }]}>
                                @{post.creator?.username || t('home.unknownUser')}
                              </Text>
                            </TouchableOpacity>
                            <Text style={[styles.feedDate, { color: c.textMuted }]}>
                              {post.created ? new Date(post.created).toLocaleString() : ''}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.feedHeaderActions}>
                          {post.creator?.username &&
                          post.creator.username !== user?.username &&
                          !(followStateByUsername[post.creator.username] ?? !!post.creator?.is_following) ? (
                            <TouchableOpacity
                              style={[styles.followButton, { borderColor: c.border, backgroundColor: c.surface }]}
                              activeOpacity={0.85}
                              disabled={!!followActionLoadingByUsername[post.creator.username]}
                              onPress={() =>
                                handleToggleFollow(
                                  post.creator!.username!,
                                  followStateByUsername[post.creator!.username!] ?? !!post.creator?.is_following
                                )
                              }
                            >
                              <Text style={[styles.followButtonText, { color: c.textLink }]}>
                                {followActionLoadingByUsername[post.creator.username] ? '...' : t('home.followAction')}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                          <TouchableOpacity
                            style={[styles.reportButton, { borderColor: c.border, backgroundColor: c.surface }]}
                            activeOpacity={0.85}
                            onPress={() => openReportPostModal(post)}
                            accessibilityLabel={t('home.reportPostAction')}
                          >
                            <MaterialCommunityIcons name="dots-horizontal" size={16} color={c.textSecondary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <View style={styles.postMetaRow}>
                        <View style={[styles.postLengthBadge, { borderColor: c.border, backgroundColor: c.surface }]}>
                          <Text style={[styles.postLengthBadgeText, { color: c.textMuted }]}>
                            {getPostLengthType(post) === 'long' ? t('home.postTypeLong') : t('home.postTypeShort')}
                          </Text>
                        </View>
                      </View>

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
                      {(post.reactions_emoji_counts || []).length > 0 ? (
                        <View style={styles.reactionSummaryWrap}>
                          {(post.reactions_emoji_counts || [])
                            .filter((entry) => (entry?.count || 0) > 0)
                            .map((entry, idx) => (
                              <TouchableOpacity
                                key={`${post.id}-reaction-summary-${entry.emoji?.id || idx}`}
                                style={[styles.reactionSummaryChip, { borderColor: c.border, backgroundColor: c.surface }]}
                                onPress={() => openReactionList(post, entry.emoji)}
                                activeOpacity={0.85}
                              >
                                {entry.emoji?.image ? (
                                  <Image source={{ uri: entry.emoji.image }} style={styles.reactionSummaryEmojiImage} resizeMode="contain" />
                                ) : (
                                  <MaterialCommunityIcons name="emoticon-outline" size={14} color={c.textSecondary} />
                                )}
                                <Text style={[styles.reactionSummaryCount, { color: c.textSecondary }]}>
                                  {entry.count || 0}
                                </Text>
                              </TouchableOpacity>
                            ))}
                        </View>
                      ) : null}

                      <View style={styles.feedActionsRow}>
                        <TouchableOpacity
                          style={[styles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                          onPress={() => openReactionPicker(post)}
                          activeOpacity={0.85}
                        >
                          <MaterialCommunityIcons name="emoticon-outline" size={16} color={c.textSecondary} />
                          <Text style={[styles.feedActionText, { color: c.textSecondary }]}>{t('home.reactAction')}</Text>
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
  topNavSearchWrap: {
    position: 'relative',
    flex: 1,
    maxWidth: 340,
  },
  topNavSearchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  searchDropdown: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: 14,
    zIndex: 1200,
    maxHeight: 460,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  searchDropdownLoading: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchDropdownScroll: {
    maxHeight: 460,
  },
  searchDropdownScrollContent: {
    padding: 10,
    gap: 12,
  },
  searchShowAllButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchShowAllButtonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  backToFeedButton: {
    position: 'absolute',
    left: 0,
    top: 0,
    minWidth: 0,
  },
  backToFeedButtonSlim: {
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 10,
    minHeight: 34,
  },
  backToFeedButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  backToFeedButtonText: {
    fontSize: 12,
  },
  searchResultsWideLayout: {
    width: '100%',
    maxWidth: 1400,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 20,
    marginBottom: 20,
  },
  searchResultsLeftReserve: {
    width: 260,
    minHeight: 1,
  },
  searchResultsMainCard: {
    flex: 1,
    maxWidth: 1120,
  },
  searchMainHeader: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    minHeight: 48,
  },
  searchMainSections: {
    gap: 24,
  },
  searchMainTitle: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 34,
    textAlign: 'center',
  },
  searchSection: {
    gap: 8,
  },
  searchSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingHorizontal: 2,
  },
  searchSectionEmpty: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  searchSectionError: {
    fontSize: 12,
    fontWeight: '700',
  },
  searchSectionEmptyGlobal: {
    fontSize: 12,
    fontWeight: '600',
  },
  searchResultRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchTileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  searchTile: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '48%',
    minWidth: 250,
  },
  searchTileWide: {
    width: '31.5%',
  },
  searchAvatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  searchAvatarImage: {
    width: '100%',
    height: '100%',
  },
  searchAvatarLetter: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  searchResultMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  searchResultPrimary: {
    fontSize: 15,
    fontWeight: '700',
  },
  searchResultSecondary: {
    fontSize: 12,
    fontWeight: '600',
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
  reactionPickerCard: {
    width: 640,
    maxWidth: '94%',
    minHeight: 320,
    maxHeight: '80%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    overflow: 'hidden',
  },
  reactionPickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  reactionPickerContent: {
    flex: 1,
    minHeight: 120,
  },
  reactionPickerScroll: {
    flex: 1,
  },
  reactionPickerScrollContent: {
    gap: 12,
    paddingBottom: 10,
  },
  reactionGroup: {
    gap: 8,
  },
  reactionGroupTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  reactionEmojiWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reactionEmojiButton: {
    width: 42,
    height: 42,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmojiImage: {
    width: 22,
    height: 22,
  },
  reactionListCard: {
    width: 520,
    maxWidth: '92%',
    minHeight: 260,
    maxHeight: '80%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  reactionListBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  reactionListSubtitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  reportModalCard: {
    width: 680,
    maxWidth: '94%',
    minHeight: 420,
    maxHeight: '90%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  reportModalSubtitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  reportOptionScroll: {
    maxHeight: 420,
  },
  reportOptionList: {
    gap: 10,
    paddingBottom: 4,
  },
  reportOptionCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  reportOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  reportOptionDescription: {
    fontSize: 12,
    lineHeight: 17,
  },
  reactionListContent: {
    flex: 1,
    minHeight: 120,
  },
  reactionListScroll: {
    flex: 1,
  },
  reactionListScrollContent: {
    paddingBottom: 8,
    gap: 8,
  },
  reactionUserRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
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
  reportButton: {
    borderWidth: 1,
    borderRadius: 999,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedPostHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  feedHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedCommunityHeaderLink: {
    fontSize: 13,
    fontWeight: '700',
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
  postMetaRow: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  postLengthBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  postLengthBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
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
  reactionSummaryWrap: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reactionSummaryChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  reactionSummaryEmojiImage: {
    width: 14,
    height: 14,
  },
  reactionSummaryCount: {
    fontSize: 12,
    fontWeight: '700',
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
