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
  AppNotification,
  FeedPost,
  FeedType,
  ModerationCategory,
  PostComment,
  UpdateAuthenticatedUserMediaPayload,
  UpdateAuthenticatedUserPayload,
  CircleResult,
  CommunityMember,
  CommunityOwner,
  FollowingUserResult,
  SearchCommunityResult,
  SearchHashtagResult,
  SearchUserResult,
  SocialIdentity,
  SocialProvider
} from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import LanguagePicker from '../components/LanguagePicker';
import { AppRoute } from '../routing';
import SearchResultsScreen from './SearchResultsScreen';
import MyProfileScreen from './MyProfileScreen';
import PublicProfileScreen from './PublicProfileScreen';
import CommunityProfileScreen from './CommunityProfileScreen';
import PostCard from '../components/PostCard';
import FeedScreen from './FeedScreen';
import PostDetailModal from '../components/PostDetailModal';
import RouteSummaryCard from '../components/RouteSummaryCard';
import LongPostDrawer, { LongPostBlock } from '../components/LongPostDrawer';
import NotificationDrawer from '../components/NotificationDrawer';

interface HomeScreenProps {
  token: string;
  onLogout: () => void;
  route: AppRoute;
  onNavigate: (route: AppRoute, replace?: boolean) => void;
}

const WELCOME_NOTICE_KEY_PREFIX = '@openspace/welcome_notice_last_shown';
const WELCOME_NOTICE_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours
const SEARCH_RESULTS_STATE_KEY_PREFIX = '@openspace/search_results_state';
const PROFILE_COMMUNITIES_PAGE_SIZE = 20;
const PROFILE_FOLLOWINGS_PAGE_SIZE = 20;
const SHORT_POST_MAX_LENGTH = 5000;

function extractPlainTextFromBlocks(blocks: LongPostBlock[]) {
  return blocks
    .map((block) => `${block.text || ''} ${block.caption || ''}`.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildLongPostHtmlFromBlocks(blocks: LongPostBlock[]) {
  return blocks
    .map((block) => {
      if (block.type === 'heading') {
        const level = block.level || 2;
        return `<h${level}>${escapeHtml(block.text || '')}</h${level}>`;
      }
      if (block.type === 'quote') {
        return `<blockquote><p>${escapeHtml(block.text || '')}</p></blockquote>`;
      }
      if (block.type === 'image') {
        if (!block.url) return '';
        const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : '';
        return `<figure><img src=\"${escapeHtml(block.url)}\" alt=\"${escapeHtml(block.caption || '')}\" />${caption}</figure>`;
      }
      if (block.type === 'embed') {
        if (!block.url) return '';
        return `<p><a href=\"${escapeHtml(block.url)}\" target=\"_blank\" rel=\"noopener noreferrer\">${escapeHtml(block.url)}</a></p>`;
      }
      return `<p>${escapeHtml(block.text || '')}</p>`;
    })
    .filter(Boolean)
    .join('');
}

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
    avatar?: string;
    profile?: { avatar?: string };
  };
};

type ProfileTabKey = 'all' | 'about' | 'followers' | 'photos' | 'reels' | 'more';
type ComposerMediaType = 'image' | 'video';
type ComposerImageSelection = {
  file: Blob & { name?: string; type?: string };
  previewUri?: string;
};
type ComposerVideoSelection = ComposerImageSelection;

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
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
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
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedNextMaxId, setFeedNextMaxId] = useState<number | undefined>(undefined);
  const [communityRoutePosts, setCommunityRoutePosts] = useState<FeedPost[]>([]);
  const [communityRouteLoading, setCommunityRouteLoading] = useState(false);
  const [communityRouteError, setCommunityRouteError] = useState('');
  const [communityInfo, setCommunityInfo] = useState<SearchCommunityResult | null>(null);
  const [communityInfoLoading, setCommunityInfoLoading] = useState(false);
  const [communityJoinLoading, setCommunityJoinLoading] = useState(false);
  const [communityOwner, setCommunityOwner] = useState<CommunityOwner | null>(null);
  const [communityMembers, setCommunityMembers] = useState<CommunityMember[]>([]);
  const [communityMembersLoading, setCommunityMembersLoading] = useState(false);
  const [myProfilePosts, setMyProfilePosts] = useState<FeedPost[]>([]);
  const [myProfilePostsLoading, setMyProfilePostsLoading] = useState(false);
  const [myPinnedPosts, setMyPinnedPosts] = useState<FeedPost[]>([]);
  const [myPinnedPostsLoading, setMyPinnedPostsLoading] = useState(false);
  const [myJoinedCommunities, setMyJoinedCommunities] = useState<SearchCommunityResult[]>([]);
  const [myJoinedCommunitiesLoading, setMyJoinedCommunitiesLoading] = useState(false);
  const [myJoinedCommunitiesLoadingMore, setMyJoinedCommunitiesLoadingMore] = useState(false);
  const [myJoinedCommunitiesOffset, setMyJoinedCommunitiesOffset] = useState(0);
  const [myJoinedCommunitiesHasMore, setMyJoinedCommunitiesHasMore] = useState(true);
  const [myFollowings, setMyFollowings] = useState<FollowingUserResult[]>([]);
  const [myFollowingsLoading, setMyFollowingsLoading] = useState(false);
  const [myFollowingsLoadingMore, setMyFollowingsLoadingMore] = useState(false);
  const [myFollowingsMaxId, setMyFollowingsMaxId] = useState<number | undefined>(undefined);
  const [myFollowingsHasMore, setMyFollowingsHasMore] = useState(true);
  const [profileUser, setProfileUser] = useState<any>(null);
  const [profileUserLoading, setProfileUserLoading] = useState(false);
  const [profilePosts, setProfilePosts] = useState<FeedPost[]>([]);
  const [profilePostsLoading, setProfilePostsLoading] = useState(false);
  const [profilePinnedPosts, setProfilePinnedPosts] = useState<FeedPost[]>([]);
  const [profilePinnedPostsLoading, setProfilePinnedPostsLoading] = useState(false);
  const [profileJoinedCommunities, setProfileJoinedCommunities] = useState<SearchCommunityResult[]>([]);
  const [profileJoinedCommunitiesLoading, setProfileJoinedCommunitiesLoading] = useState(false);
  const [profileJoinedCommunitiesLoadingMore, setProfileJoinedCommunitiesLoadingMore] = useState(false);
  const [profileJoinedCommunitiesOffset, setProfileJoinedCommunitiesOffset] = useState(0);
  const [profileJoinedCommunitiesHasMore, setProfileJoinedCommunitiesHasMore] = useState(true);
  const [profileFollowings, setProfileFollowings] = useState<FollowingUserResult[]>([]);
  const [profileFollowingsLoading, setProfileFollowingsLoading] = useState(false);
  const [profileFollowingsLoadingMore, setProfileFollowingsLoadingMore] = useState(false);
  const [profileFollowingsMaxId, setProfileFollowingsMaxId] = useState<number | undefined>(undefined);
  const [profileFollowingsHasMore, setProfileFollowingsHasMore] = useState(true);
  const [followStateByUsername, setFollowStateByUsername] = useState<Record<string, boolean>>({});
  const [followActionLoadingByUsername, setFollowActionLoadingByUsername] = useState<Record<string, boolean>>({});
  const [postRouteLoading, setPostRouteLoading] = useState(false);
  const [activePost, setActivePost] = useState<FeedPost | null>(null);
  const [expandedPostIds, setExpandedPostIds] = useState<Record<number, boolean>>({});
  const [commentBoxPostIds, setCommentBoxPostIds] = useState<Record<number, boolean>>({});
  const [draftComments, setDraftComments] = useState<Record<number, string>>({});
  const [draftReplies, setDraftReplies] = useState<Record<number, string>>({});
  const [commentEditDrafts, setCommentEditDrafts] = useState<Record<number, string>>({});
  const [replyEditDrafts, setReplyEditDrafts] = useState<Record<number, string>>({});
  const [editingCommentById, setEditingCommentById] = useState<Record<number, boolean>>({});
  const [editingReplyById, setEditingReplyById] = useState<Record<number, boolean>>({});
  const [commentMutationLoadingById, setCommentMutationLoadingById] = useState<Record<number, boolean>>({});
  const [localComments, setLocalComments] = useState<Record<number, PostComment[]>>({});
  const [commentRepliesById, setCommentRepliesById] = useState<Record<number, PostComment[]>>({});
  const [commentRepliesExpanded, setCommentRepliesExpanded] = useState<Record<number, boolean>>({});
  const [commentRepliesLoadingById, setCommentRepliesLoadingById] = useState<Record<number, boolean>>({});
  const [reactionGroups, setReactionGroups] = useState<ReactionGroup[]>([]);
  const [reactionPickerPost, setReactionPickerPost] = useState<FeedPost | null>(null);
  const [reactionPickerLoading, setReactionPickerLoading] = useState(false);
  const [reactionActionLoading, setReactionActionLoading] = useState(false);
  const [reactionListOpen, setReactionListOpen] = useState(false);
  const [reactionListPost, setReactionListPost] = useState<FeedPost | null>(null);
  const [reactionListLoading, setReactionListLoading] = useState(false);
  const [reactionListEmoji, setReactionListEmoji] = useState<ReactionEmoji | null>(null);
  const [reactionListUsers, setReactionListUsers] = useState<PostReaction[]>([]);
  const [moderationCategories, setModerationCategories] = useState<ModerationCategory[]>([]);
  const [reportPostTarget, setReportPostTarget] = useState<FeedPost | null>(null);
  const [reportingPost, setReportingPost] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const composerTextRef = useRef('');
  const [composerTextLength, setComposerTextLength] = useState(0);
  const [composerInputKey, setComposerInputKey] = useState(0);
  const [composerImages, setComposerImages] = useState<ComposerImageSelection[]>([]);
  const [composerVideo, setComposerVideo] = useState<ComposerVideoSelection | null>(null);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [composerStep, setComposerStep] = useState<'compose' | 'destination'>('compose');
  const [composerPostType, setComposerPostType] = useState<'P' | 'LP'>('P');
  const [composerModalMounted, setComposerModalMounted] = useState(false);
  const [composerLongPostBlocks, setComposerLongPostBlocks] = useState<LongPostBlock[]>([
    { id: 'initial-paragraph', type: 'paragraph', text: '' },
  ]);
  const [composerDraftUuid, setComposerDraftUuid] = useState<string | null>(null);
  const [composerDraftSaving, setComposerDraftSaving] = useState(false);
  const [composerDraftSavedAt, setComposerDraftSavedAt] = useState<string | null>(null);
  const [composerDraftExpiryDays, setComposerDraftExpiryDays] = useState(14);
  const [composerDraftsOpen, setComposerDraftsOpen] = useState(false);
  const [composerDraftsLoading, setComposerDraftsLoading] = useState(false);
  const [composerDrafts, setComposerDrafts] = useState<FeedPost[]>([]);
  const [composerDraftDeleteUuid, setComposerDraftDeleteUuid] = useState<string | null>(null);
  const [longPostDrawerOpen, setLongPostDrawerOpen] = useState(false);
  const [longPostDrawerExpanded, setLongPostDrawerExpanded] = useState(false);
  const [longPostEditDrawerOpen, setLongPostEditDrawerOpen] = useState(false);
  const [longPostEditDrawerExpanded, setLongPostEditDrawerExpanded] = useState(false);
  const [longPostEditBlocks, setLongPostEditBlocks] = useState<LongPostBlock[]>([]);
  const [editingLongPost, setEditingLongPost] = useState<FeedPost | null>(null);
  const [longPostEditError, setLongPostEditError] = useState('');
  const [composerSelectedCircleId, setComposerSelectedCircleId] = useState<number | null>(null);
  const [composerSelectedCommunityNames, setComposerSelectedCommunityNames] = useState<string[]>([]);
  const [composerCircles, setComposerCircles] = useState<CircleResult[]>([]);
  const [composerJoinedCommunities, setComposerJoinedCommunities] = useState<SearchCommunityResult[]>([]);
  const [composerCommunitySearch, setComposerCommunitySearch] = useState('');
  const [composerDestinationsLoading, setComposerDestinationsLoading] = useState(false);
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
  const [profileActiveTab, setProfileActiveTab] = useState<ProfileTabKey>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkedAccountsOpen, setLinkedAccountsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [externalLinkModalOpen, setExternalLinkModalOpen] = useState(false);
  const [pendingExternalLink, setPendingExternalLink] = useState<string | null>(null);
  const [tooltipTab, setTooltipTab] = useState<FeedType | null>(null);
  const [showWelcomeNotice, setShowWelcomeNotice] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const externalLinkResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestSeqRef = useRef(0);
  const committedSearchRequestSeqRef = useRef(0);
  const lastNonPostRouteRef = useRef<AppRoute>(
    route.screen === 'post' ? { screen: 'feed', feed: route.feed || 'home' } : route
  );
  const welcomeTranslateX = useRef(new Animated.Value(-380)).current;
  const composerTranslateX = useRef(new Animated.Value(0)).current;
  const composerClosingRef = useRef(false);
  const longPostAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Notifications ────────────────────────────────────────────────────────────
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifLoadingMore, setNotifLoadingMore] = useState(false);
  const [notifHasMore, setNotifHasMore] = useState(false);
  const [notifNextMaxId, setNotifNextMaxId] = useState<number | undefined>(undefined);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    ])
      .then(([authenticatedUser, identities]) => {
        if (!active) return;
        setUser(authenticatedUser);
        setLinkedIdentities(identities);
      })
      .catch(() => {
        if (!active) return;
        setFeedError(t('home.feedLoadError'));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setIdentitiesLoading(false);
      });

    // Load the feed via loadFeed so pagination state (hasMore, nextMaxId) is set correctly
    loadFeed('home').finally(() => {
      if (!active) setFeedLoading(false);
    });

    return () => {
      active = false;
    };
  }, [token]);

  // ── Notification unread-count polling ────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    function fetchUnreadCount() {
      api.getUnreadNotificationsCount(token).then((count) => {
        setUnreadCount(count);
      }).catch(() => {});
    }

    fetchUnreadCount();
    notifPollTimerRef.current = setInterval(fetchUnreadCount, 60_000);

    // Re-fetch immediately when tab regains visibility
    function handleVisibilityChange() {
      if (Platform.OS === 'web' && document.visibilityState === 'visible') {
        fetchUnreadCount();
      }
    }
    if (Platform.OS === 'web') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (notifPollTimerRef.current) clearInterval(notifPollTimerRef.current);
      if (Platform.OS === 'web') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [token]);

  useEffect(() => {
    if (!user?.username) return;
    let active = true;
    setMyProfilePostsLoading(true);
    setMyPinnedPostsLoading(true);
    Promise.allSettled([
      api.getUserPosts(token, user.username, 10),
      api.getPinnedPosts(token, user.username, 10),
    ])
      .then(([postsResult, pinnedResult]) => {
        if (!active) return;
        const posts = postsResult.status === 'fulfilled' ? postsResult.value : [];
        const pinned = pinnedResult.status === 'fulfilled' ? pinnedResult.value : [];
        setMyProfilePosts(Array.isArray(posts) ? posts : []);
        setMyPinnedPosts(Array.isArray(pinned) ? pinned : []);
      })
      .finally(() => {
        if (!active) return;
        setMyProfilePostsLoading(false);
        setMyPinnedPostsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, user?.username]);

  async function loadMyFollowingsPage(maxId?: number) {
    const followings = await api.getFollowings(token, PROFILE_FOLLOWINGS_PAGE_SIZE, maxId);
    const safeFollowings = Array.isArray(followings) ? followings : [];
    const hasMore = safeFollowings.length === PROFILE_FOLLOWINGS_PAGE_SIZE;
    return { followings: safeFollowings, hasMore };
  }

  useEffect(() => {
    if (!user?.username) return;
    let active = true;
    setMyFollowingsLoading(true);
    setMyFollowingsMaxId(undefined);
    setMyFollowingsHasMore(true);

    loadMyFollowingsPage(undefined)
      .then(({ followings, hasMore }) => {
        if (!active) return;
        setMyFollowings(followings);
        const lastId = followings.length ? followings[followings.length - 1]?.id : undefined;
        setMyFollowingsMaxId(typeof lastId === 'number' ? lastId : undefined);
        setMyFollowingsHasMore(hasMore);
      })
      .catch(() => {
        if (!active) return;
        setMyFollowings([]);
        setMyFollowingsMaxId(undefined);
        setMyFollowingsHasMore(false);
      })
      .finally(() => {
        if (!active) return;
        setMyFollowingsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, user?.username]);

  async function loadMoreMyFollowings() {
    if (myFollowingsLoading || myFollowingsLoadingMore || !myFollowingsHasMore) return;
    setMyFollowingsLoadingMore(true);
    try {
      const { followings, hasMore } = await loadMyFollowingsPage(myFollowingsMaxId);
      setMyFollowings((prev) => {
        const existingIds = new Set(prev.map((f) => f.id));
        const deduped = followings.filter((f) => !existingIds.has(f.id));
        return [...prev, ...deduped];
      });
      const lastId = followings.length ? followings[followings.length - 1]?.id : undefined;
      setMyFollowingsMaxId(typeof lastId === 'number' ? lastId : myFollowingsMaxId);
      setMyFollowingsHasMore(hasMore);
    } catch {
      setMyFollowingsHasMore(false);
    } finally {
      setMyFollowingsLoadingMore(false);
    }
  }

  async function loadMyJoinedCommunitiesPage(offset = 0) {
    const communities = await api.getJoinedCommunities(token, PROFILE_COMMUNITIES_PAGE_SIZE, offset);
    const safeCommunities = Array.isArray(communities) ? communities : [];
    const hasMore = safeCommunities.length === PROFILE_COMMUNITIES_PAGE_SIZE;
    return { communities: safeCommunities, hasMore };
  }

  useEffect(() => {
    if (!user?.username) return;
    let active = true;
    setMyJoinedCommunitiesLoading(true);
    setMyJoinedCommunitiesOffset(0);
    setMyJoinedCommunitiesHasMore(true);

    loadMyJoinedCommunitiesPage(0)
      .then(({ communities, hasMore }) => {
        if (!active) return;
        setMyJoinedCommunities(communities);
        setMyJoinedCommunitiesOffset(communities.length);
        setMyJoinedCommunitiesHasMore(hasMore);
      })
      .catch(() => {
        if (!active) return;
        setMyJoinedCommunities([]);
        setMyJoinedCommunitiesOffset(0);
        setMyJoinedCommunitiesHasMore(false);
      })
      .finally(() => {
        if (!active) return;
        setMyJoinedCommunitiesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, user?.username]);

  async function loadMoreMyJoinedCommunities() {
    if (myJoinedCommunitiesLoading || myJoinedCommunitiesLoadingMore || !myJoinedCommunitiesHasMore) return;
    setMyJoinedCommunitiesLoadingMore(true);
    try {
      const { communities, hasMore } = await loadMyJoinedCommunitiesPage(myJoinedCommunitiesOffset);
      setMyJoinedCommunities((prev) => {
        const existingIds = new Set(prev.map((community) => community.id));
        const deduped = communities.filter((community) => !existingIds.has(community.id));
        return [...prev, ...deduped];
      });
      setMyJoinedCommunitiesOffset((prev) => prev + communities.length);
      setMyJoinedCommunitiesHasMore(hasMore);
    } catch {
      setMyJoinedCommunitiesHasMore(false);
    } finally {
      setMyJoinedCommunitiesLoadingMore(false);
    }
  }

  async function loadProfileFollowingsPage(username: string, maxId?: number) {
    const followings = await api.getFollowings(token, PROFILE_FOLLOWINGS_PAGE_SIZE, maxId, username);
    const safeFollowings = Array.isArray(followings) ? followings : [];
    const hasMore = safeFollowings.length === PROFILE_FOLLOWINGS_PAGE_SIZE;
    return { followings: safeFollowings, hasMore };
  }

  async function loadProfileJoinedCommunitiesPage(username: string, offset = 0) {
    const communities = await api.getUserCommunities(token, username);
    const safeCommunities = Array.isArray(communities) ? communities : [];
    const hasMore = false;
    return { communities: safeCommunities, hasMore };
  }

  useEffect(() => {
    if (route.screen !== 'profile' || !route.username) return;
    let active = true;
    const username = route.username;
    setProfileUserLoading(true);
    setProfilePostsLoading(true);
    setProfilePinnedPostsLoading(true);
    setProfileJoinedCommunitiesLoading(true);
    setProfileFollowingsLoading(true);
    setProfileJoinedCommunitiesOffset(0);
    setProfileFollowingsMaxId(undefined);
    setProfileJoinedCommunitiesHasMore(true);
    setProfileFollowingsHasMore(true);

    Promise.allSettled([
      api.getUserByUsername(token, username),
      api.getUserPosts(token, username, 10),
      api.getPinnedPosts(token, username, 10),
      loadProfileJoinedCommunitiesPage(username, 0),
      loadProfileFollowingsPage(username),
    ])
      .then(([userResult, postsResult, pinnedResult, communitiesResult, followingsResult]) => {
        if (!active) return;
        const nextUser = userResult.status === 'fulfilled' ? userResult.value : null;
        const nextPosts = postsResult.status === 'fulfilled' ? postsResult.value : [];
        const nextPinned = pinnedResult.status === 'fulfilled' ? pinnedResult.value : [];
        const nextCommunities = communitiesResult.status === 'fulfilled' ? communitiesResult.value : { communities: [], hasMore: false };
        const nextFollowings = followingsResult.status === 'fulfilled' ? followingsResult.value : { followings: [], hasMore: false };

        setProfileUser(nextUser);
        setProfilePosts(Array.isArray(nextPosts) ? nextPosts : []);
        setProfilePinnedPosts(Array.isArray(nextPinned) ? nextPinned : []);
        setProfileJoinedCommunities(Array.isArray(nextCommunities.communities) ? nextCommunities.communities : []);
        setProfileJoinedCommunitiesOffset(Array.isArray(nextCommunities.communities) ? nextCommunities.communities.length : 0);
        setProfileJoinedCommunitiesHasMore(!!nextCommunities.hasMore);
        setProfileFollowings(Array.isArray(nextFollowings.followings) ? nextFollowings.followings : []);
        const lastFollowingId = Array.isArray(nextFollowings.followings) && nextFollowings.followings.length
          ? nextFollowings.followings[nextFollowings.followings.length - 1]?.id
          : undefined;
        setProfileFollowingsMaxId(typeof lastFollowingId === 'number' ? lastFollowingId : undefined);
        setProfileFollowingsHasMore(!!nextFollowings.hasMore);
      })
      .catch(() => {
        if (!active) return;
        setProfileUser(null);
        setProfilePosts([]);
        setProfilePinnedPosts([]);
        setProfileJoinedCommunities([]);
        setProfileFollowings([]);
        setProfileJoinedCommunitiesHasMore(false);
        setProfileFollowingsHasMore(false);
      })
      .finally(() => {
        if (!active) return;
        setProfileUserLoading(false);
        setProfilePostsLoading(false);
        setProfilePinnedPostsLoading(false);
        setProfileJoinedCommunitiesLoading(false);
        setProfileFollowingsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [route, token]);

  async function loadMoreProfileFollowings() {
    if (route.screen !== 'profile' || !route.username) return;
    if (profileFollowingsLoading || profileFollowingsLoadingMore || !profileFollowingsHasMore) return;
    setProfileFollowingsLoadingMore(true);
    try {
      const { followings, hasMore } = await loadProfileFollowingsPage(route.username, profileFollowingsMaxId);
      setProfileFollowings((prev) => {
        const existingIds = new Set(prev.map((f) => f.id));
        const deduped = followings.filter((f) => !existingIds.has(f.id));
        return [...prev, ...deduped];
      });
      const lastId = followings.length ? followings[followings.length - 1]?.id : undefined;
      setProfileFollowingsMaxId(typeof lastId === 'number' ? lastId : profileFollowingsMaxId);
      setProfileFollowingsHasMore(hasMore);
    } catch {
      setProfileFollowingsHasMore(false);
    } finally {
      setProfileFollowingsLoadingMore(false);
    }
  }

  async function loadMoreProfileJoinedCommunities() {
    if (route.screen !== 'profile' || !route.username) return;
    if (profileJoinedCommunitiesLoading || profileJoinedCommunitiesLoadingMore || !profileJoinedCommunitiesHasMore) return;
    setProfileJoinedCommunitiesLoadingMore(true);
    try {
      const { communities, hasMore } = await loadProfileJoinedCommunitiesPage(route.username, profileJoinedCommunitiesOffset);
      setProfileJoinedCommunities((prev) => {
        const existingIds = new Set(prev.map((community) => community.id));
        const deduped = communities.filter((community) => !existingIds.has(community.id));
        return [...prev, ...deduped];
      });
      setProfileJoinedCommunitiesOffset((prev) => prev + communities.length);
      setProfileJoinedCommunitiesHasMore(hasMore);
    } catch {
      setProfileJoinedCommunitiesHasMore(false);
    } finally {
      setProfileJoinedCommunitiesLoadingMore(false);
    }
  }

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
    if (route.screen !== 'post') {
      lastNonPostRouteRef.current = route;
    }

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
      const postInCurrentContext =
        feedPosts.find((post) => post.id === route.postId) ||
        communityRoutePosts.find((post) => post.id === route.postId) ||
        myProfilePosts.find((post) => post.id === route.postId) ||
        profilePosts.find((post) => post.id === route.postId) ||
        null;
      if (postInCurrentContext) {
        setActivePost(postInCurrentContext);
        void loadCommentsForPost(postInCurrentContext);
      }
      return;
    }

    setActivePost(null);
  }, [route, feedPosts, communityRoutePosts, myProfilePosts, profilePosts]);

  useEffect(() => {
    const routePostId = route.screen === 'post' ? route.postId : null;
    if (!routePostId) return;

  const routedPostInMemory =
      feedPosts.find((post) => post.id === routePostId) ||
      communityRoutePosts.find((post) => post.id === routePostId) ||
      myProfilePosts.find((post) => post.id === routePostId) ||
      profilePosts.find((post) => post.id === routePostId) ||
      null;

    if (routedPostInMemory) {
      if (activePost?.id !== routedPostInMemory.id) {
        setActivePost(routedPostInMemory);
      }
      void loadCommentsForPost(routedPostInMemory);
      setPostRouteLoading(false);
      return;
    }

    const postId = routePostId;
    if (activePost?.id === routePostId) return;
    let cancelled = false;

    async function fetchRoutedPost() {
      setPostRouteLoading(true);
      try {
        const fetchedPost = await api.getPostById(token, postId);
        if (cancelled) return;
        setActivePost(fetchedPost);
        void loadCommentsForPost(fetchedPost);
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
  }, [route, token, activePost?.id, feedPosts, communityRoutePosts, myProfilePosts, profilePosts]);

  // Match the server's own page size — the existing site uses count=10
  const FEED_PAGE_SIZE = 10;

  async function loadFeed(feed: FeedType) {
    setFeedLoading(true);
    setFeedError('');
    setFeedNextMaxId(undefined);
    setFeedHasMore(false);
    try {
      const nextPosts = await api.getFeed(token, feed, FEED_PAGE_SIZE);
      setFeedPosts(nextPosts);
      if (nextPosts.length > 0) {
        // Optimistically assume more pages exist whenever any posts come back.
        // The true end is confirmed only when a subsequent page returns empty.
        const lastId = nextPosts[nextPosts.length - 1]?.id;
        setFeedHasMore(true);
        setFeedNextMaxId(typeof lastId === 'number' ? lastId : undefined);
      }
    } catch (e: any) {
      setFeedPosts([]);
      setFeedError(e.message || t('home.feedLoadError'));
    } finally {
      setFeedLoading(false);
    }
  }

  async function loadMoreFeed() {
    if (feedLoadingMore || !feedHasMore || feedNextMaxId === undefined) return;
    setFeedLoadingMore(true);
    try {
      const morePosts = await api.getFeed(token, activeFeed, FEED_PAGE_SIZE, feedNextMaxId);
      if (morePosts.length > 0) {
        setFeedPosts((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          return [...prev, ...morePosts.filter((p) => !existingIds.has(p.id))];
        });
        const lastId = morePosts[morePosts.length - 1]?.id;
        setFeedNextMaxId(typeof lastId === 'number' ? lastId : undefined);
        setFeedHasMore(true);
      } else {
        // Empty page = genuinely reached the end
        setFeedHasMore(false);
        setFeedNextMaxId(undefined);
      }
    } catch {
      // silently fail — user can keep scrolling to retry
    } finally {
      setFeedLoadingMore(false);
    }
  }

  // Ref to the root ScrollView so we can attach a DOM scroll listener on web
  const mainScrollRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // On web, React Native Web renders ScrollView as a plain div.
    // Grab the underlying DOM node and listen directly on it.
    const node = mainScrollRef.current;
    const scrollTarget: EventTarget | null =
      node && typeof node.getScrollableNode === 'function'
        ? node.getScrollableNode()
        : node?._nativeTag
          ? null
          : (node as HTMLElement | null);

    const target = scrollTarget ?? window;

    const handleScroll = () => {
      let distFromBottom: number;
      if (target === window) {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        distFromBottom = document.documentElement.scrollHeight - scrollTop - window.innerHeight;
      } else {
        const el = target as HTMLElement;
        distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      }
      if (distFromBottom < 600) {
        void loadMoreFeed();
      }
    };

    target.addEventListener('scroll', handleScroll as EventListener, { passive: true } as AddEventListenerOptions);
    return () => target.removeEventListener('scroll', handleScroll as EventListener);
  }, [feedHasMore, feedLoadingMore, feedLoading, feedNextMaxId, activeFeed]);

  useEffect(() => {
    const isCommunityRoute = route.screen === 'community';
    const routeCommunityName = isCommunityRoute ? route.name : '';

    if (!isCommunityRoute || !routeCommunityName) {
      setCommunityRoutePosts([]);
      setCommunityRouteError('');
      setCommunityRouteLoading(false);
      setCommunityInfo(null);
      setCommunityOwner(null);
      setCommunityMembers([]);
      return;
    }

    let cancelled = false;

    async function loadCommunityRoute() {
      setCommunityRouteLoading(true);
      setCommunityInfoLoading(true);
      setCommunityMembersLoading(true);
      setCommunityRouteError('');
      try {
        const [posts, info, owner, members] = await Promise.all([
          api.getCommunityPosts(token, routeCommunityName, 20),
          api.getCommunity(token, routeCommunityName).catch(() => null),
          api.getCommunityOwner(token, routeCommunityName).catch(() => null),
          api.getCommunityMembers(token, routeCommunityName, 9).catch(() => []),
        ]);
        if (!cancelled) {
          setCommunityRoutePosts(posts);
          setCommunityInfo(info);
          setCommunityOwner(owner);
          setCommunityMembers(members as CommunityMember[]);
        }
      } catch (e: any) {
        if (!cancelled) {
          setCommunityRoutePosts([]);
          setCommunityRouteError(e?.message || t('home.feedLoadError'));
        }
      } finally {
        if (!cancelled) {
          setCommunityRouteLoading(false);
          setCommunityInfoLoading(false);
          setCommunityMembersLoading(false);
        }
      }
    }

    setCommunityInfo(null);
    setCommunityOwner(null);
    setCommunityMembers([]);
    void loadCommunityRoute();
    return () => {
      cancelled = true;
    };
  }, [route, token, t]);

  async function handleJoinCommunity() {
    const name = route.screen === 'community' ? route.name : '';
    if (!name || communityJoinLoading) return;
    setCommunityJoinLoading(true);
    try {
      await api.joinCommunity(token, name);
      setCommunityInfo((prev) => prev ? {
        ...prev,
        members_count: (prev.members_count ?? 0) + 1,
        memberships: [...(prev.memberships ?? []), { user_id: -1 }],
      } : prev);
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
    } finally {
      setCommunityJoinLoading(false);
    }
  }

  async function handleLeaveCommunity() {
    const name = route.screen === 'community' ? route.name : '';
    if (!name || communityJoinLoading) return;
    setCommunityJoinLoading(true);
    try {
      await api.leaveCommunity(token, name);
      setCommunityInfo((prev) => prev ? {
        ...prev,
        members_count: Math.max(0, (prev.members_count ?? 1) - 1),
        memberships: [],
      } : prev);
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
    } finally {
      setCommunityJoinLoading(false);
    }
  }

  useEffect(() => {
    setFollowStateByUsername((prev) => {
      const next = { ...prev };
      for (const post of [...feedPosts, ...communityRoutePosts]) {
        const username = post.creator?.username;
        if (!username || username in next) continue;
        if (typeof post.creator?.is_following === 'boolean') {
          next[username] = post.creator.is_following;
        }
      }
      return next;
    });
  }, [feedPosts, communityRoutePosts]);

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
      setCommunityRoutePosts((prev) =>
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

  function toPlainText(value?: string) {
    if (!value) return '';
    return value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function blocksToPlainText(value?: unknown[]) {
    if (!Array.isArray(value)) return '';
    return value
      .map((block) => {
        if (!block || typeof block !== 'object') return '';
        const typed = block as { text?: unknown; caption?: unknown; url?: unknown };
        const parts = [
          typeof typed.text === 'string' ? typed.text : '',
          typeof typed.caption === 'string' ? typed.caption : '',
          typeof typed.url === 'string' ? typed.url : '',
        ].filter(Boolean);
        return parts.join(' ').trim();
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  function postHasMedia(post?: FeedPost | null) {
    if (!post) return false;
    if (post.media_thumbnail) return true;
    if (!Array.isArray(post.media) || post.media.length === 0) return false;
    return post.media.some((item) => !!item?.thumbnail || !!item?.image || !!item?.file);
  }

  function getPostText(post: FeedPost) {
    const type = (post.type || '').toUpperCase();
    if (type === 'LP') {
      const blocksText = blocksToPlainText(post.long_text_blocks);
      if (blocksText) return toPlainText(blocksText);
      const renderedHtmlText = toPlainText(post.long_text_rendered_html);
      if (renderedHtmlText) return renderedHtmlText;
      const longText = toPlainText(post.long_text);
      if (longText) return longText;
      return toPlainText(post.text);
    }
    const shortText = toPlainText(post.text);
    if (shortText) return shortText;
    return toPlainText(post.long_text);
  }

  function getPostLengthType(post: FeedPost): 'long' | 'short' {
    const type = (post.type || '').toUpperCase();
    if (type === 'LP') return 'long';
    if (type === 'P') return 'short';
    return getPostText(post).length > 280 ? 'long' : 'short';
  }

  function getPostReactionCount(post: FeedPost) {
    return (post.reactions_emoji_counts || []).reduce((sum, item) => sum + (item?.count || 0), 0);
  }

  function getPostCommentsCount(post: FeedPost) {
    const loadedComments = localComments[post.id];
    if (loadedComments) {
      return Math.max(post.comments_count || 0, loadedComments.length);
    }
    return post.comments_count || 0;
  }

  function getSourcePost(postId: number) {
    return (
      feedPosts.find((post) => post.id === postId) ||
      communityRoutePosts.find((post) => post.id === postId) ||
      myProfilePosts.find((post) => post.id === postId) ||
      profilePosts.find((post) => post.id === postId) ||
      (activePost?.id === postId ? activePost : null)
    );
  }

  function toggleExpand(postId: number) {
    setExpandedPostIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
  }

  async function loadCommentsForPost(post: FeedPost) {
    if (!post.uuid) return;
    try {
      const comments = await api.getPostComments(token, post.uuid, 20);
      setLocalComments((prev) => ({ ...prev, [post.id]: comments }));
    } catch {
      // Do not block the post UI if comment loading fails.
    }
  }

  function toggleCommentBox(postId: number) {
    const isOpening = !commentBoxPostIds[postId];
    setCommentBoxPostIds((prev) => ({ ...prev, [postId]: !prev[postId] }));
    if (isOpening) {
      const sourcePost = getSourcePost(postId);
      if (sourcePost) void loadCommentsForPost(sourcePost);
    }
  }

  function updateDraftComment(postId: number, value: string) {
    setDraftComments((prev) => ({ ...prev, [postId]: value }));
  }

  async function submitComment(postId: number) {
    const nextValue = (draftComments[postId] || '').trim();
    if (!nextValue) return;
    const sourcePost = getSourcePost(postId);
    if (!sourcePost?.uuid) {
      setError(t('home.feedLoadError'));
      return;
    }

    try {
      const createdComment = await api.createPostComment(token, sourcePost.uuid, nextValue);
      setLocalComments((prev) => ({
        ...prev,
        [postId]: [createdComment, ...(prev[postId] || [])],
      }));
      setDraftComments((prev) => ({ ...prev, [postId]: '' }));
      applyPostPatch(postId, (post) => ({
        ...post,
        comments_count: (post.comments_count || 0) + 1,
      }));
    } catch (e: any) {
      setError(e?.message || t('home.feedLoadError'));
    }
  }

  async function loadRepliesForComment(postUuid: string, commentId: number) {
    setCommentRepliesLoadingById((prev) => ({ ...prev, [commentId]: true }));
    try {
      const replies = await api.getPostCommentReplies(token, postUuid, commentId, 20);
      setCommentRepliesById((prev) => ({ ...prev, [commentId]: replies }));
    } catch {
      setCommentRepliesById((prev) => ({ ...prev, [commentId]: [] }));
    } finally {
      setCommentRepliesLoadingById((prev) => ({ ...prev, [commentId]: false }));
    }
  }

  function updateDraftReply(commentId: number, value: string) {
    setDraftReplies((prev) => ({ ...prev, [commentId]: value }));
  }

  function toggleCommentReplies(postId: number, commentId: number) {
    const isOpening = !commentRepliesExpanded[commentId];
    setCommentRepliesExpanded((prev) => ({ ...prev, [commentId]: !prev[commentId] }));
    if (!isOpening) return;

    const sourcePost = getSourcePost(postId);
    if (!sourcePost?.uuid) return;
    if (commentRepliesById[commentId]) return;
    void loadRepliesForComment(sourcePost.uuid, commentId);
  }

  async function submitReply(postId: number, commentId: number) {
    const sourcePost = getSourcePost(postId);
    const nextValue = (draftReplies[commentId] || '').trim();
    if (!sourcePost?.uuid || !nextValue) return;

    try {
      const createdReply = await api.createPostCommentReply(token, sourcePost.uuid, commentId, nextValue);
      setCommentRepliesById((prev) => ({
        ...prev,
        [commentId]: [createdReply, ...(prev[commentId] || [])],
      }));
      setCommentRepliesExpanded((prev) => ({ ...prev, [commentId]: true }));
      setDraftReplies((prev) => ({ ...prev, [commentId]: '' }));
      setLocalComments((prev) => ({
        ...prev,
        [postId]: (prev[postId] || []).map((comment) =>
          comment.id === commentId
            ? { ...comment, replies_count: (comment.replies_count || 0) + 1 }
            : comment
        ),
      }));
    } catch (e: any) {
      setError(e?.message || t('home.replyLoadFailed'));
    }
  }

  function startEditingComment(commentId: number, currentText: string, isReply: boolean) {
    if (isReply) {
      setEditingReplyById((prev) => ({ ...prev, [commentId]: true }));
      setReplyEditDrafts((prev) => ({ ...prev, [commentId]: currentText || '' }));
      return;
    }
    setEditingCommentById((prev) => ({ ...prev, [commentId]: true }));
    setCommentEditDrafts((prev) => ({ ...prev, [commentId]: currentText || '' }));
  }

  function cancelEditingComment(commentId: number, isReply: boolean) {
    if (isReply) {
      setEditingReplyById((prev) => ({ ...prev, [commentId]: false }));
      return;
    }
    setEditingCommentById((prev) => ({ ...prev, [commentId]: false }));
  }

  function updateEditCommentDraft(commentId: number, value: string, isReply: boolean) {
    if (isReply) {
      setReplyEditDrafts((prev) => ({ ...prev, [commentId]: value }));
      return;
    }
    setCommentEditDrafts((prev) => ({ ...prev, [commentId]: value }));
  }

  async function saveEditedComment(postId: number, commentId: number, isReply: boolean, parentCommentId?: number) {
    const sourcePost = getSourcePost(postId);
    const draft = (isReply ? replyEditDrafts[commentId] : commentEditDrafts[commentId]) || '';
    const nextValue = draft.trim();
    if (!sourcePost?.uuid || !nextValue) return;

    setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: true }));
    try {
      const updated = await api.updatePostComment(token, sourcePost.uuid, commentId, nextValue);
      if (isReply && parentCommentId) {
        setCommentRepliesById((prev) => ({
          ...prev,
          [parentCommentId]: (prev[parentCommentId] || []).map((reply) =>
            reply.id === commentId ? { ...reply, ...updated, text: updated.text || nextValue } : reply
          ),
        }));
        setEditingReplyById((prev) => ({ ...prev, [commentId]: false }));
      } else {
        setLocalComments((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).map((comment) =>
            comment.id === commentId ? { ...comment, ...updated, text: updated.text || nextValue } : comment
          ),
        }));
        setEditingCommentById((prev) => ({ ...prev, [commentId]: false }));
      }
    } catch (e: any) {
      setError(e?.message || t('home.commentEditFailed'));
    } finally {
      setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: false }));
    }
  }

  async function deleteComment(postId: number, commentId: number, isReply: boolean, parentCommentId?: number) {
    const sourcePost = getSourcePost(postId);
    if (!sourcePost?.uuid) return;

    setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: true }));
    try {
      await api.deletePostComment(token, sourcePost.uuid, commentId);
      if (isReply && parentCommentId) {
        setCommentRepliesById((prev) => ({
          ...prev,
          [parentCommentId]: (prev[parentCommentId] || []).filter((reply) => reply.id !== commentId),
        }));
        setLocalComments((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).map((comment) =>
            comment.id === parentCommentId
              ? { ...comment, replies_count: Math.max((comment.replies_count || 1) - 1, 0) }
              : comment
          ),
        }));
      } else {
        setLocalComments((prev) => ({
          ...prev,
          [postId]: (prev[postId] || []).filter((comment) => comment.id !== commentId),
        }));
        applyPostPatch(postId, (post) => ({
          ...post,
          comments_count: Math.max((post.comments_count || 1) - 1, 0),
        }));
        setCommentRepliesById((prev) => {
          const next = { ...prev };
          delete next[commentId];
          return next;
        });
      }
      setNotice(t('home.commentDeleteSuccess'));
    } catch (e: any) {
      setError(e?.message || t('home.commentDeleteFailed'));
    } finally {
      setCommentMutationLoadingById((prev) => ({ ...prev, [commentId]: false }));
    }
  }

  function clearWebFocus() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const activeEl = document.activeElement as HTMLElement | null;
    activeEl?.blur?.();
  }

  function openPostDetail(post: FeedPost) {
    clearWebFocus();
    setActivePost(post);
    void loadCommentsForPost(post);
    onNavigate({ screen: 'post', postId: post.id, feed: activeFeed });
  }

  function closePostDetail() {
    clearWebFocus();
    setActivePost(null);
    const returnRoute = lastNonPostRouteRef.current;
    onNavigate(returnRoute, true);
  }

  function applyPostPatch(postId: number, patch: (post: FeedPost) => FeedPost) {
    setFeedPosts((prev) => prev.map((post) => (post.id === postId ? patch(post) : post)));
    setCommunityRoutePosts((prev) => prev.map((post) => (post.id === postId ? patch(post) : post)));
    setMyProfilePosts((prev) => prev.map((post) => (post.id === postId ? patch(post) : post)));
    setMyPinnedPosts((prev) => prev.map((post) => (post.id === postId ? patch(post) : post)));
    setActivePost((prev) => (prev && prev.id === postId ? patch(prev) : prev));
  }

  function openLongPostEdit(post: FeedPost) {
    const rawBlocks = Array.isArray(post.long_text_blocks) ? post.long_text_blocks : [];
    const blocks: LongPostBlock[] = rawBlocks.map((b, idx) => {
      const block = b as Record<string, unknown>;
      return {
        id: `edit-${idx}-${Date.now()}`,
        type: (block.type as LongPostBlock['type']) || 'paragraph',
        text: typeof block.text === 'string' ? block.text : undefined,
        level: typeof block.level === 'number' ? (block.level as 1 | 2 | 3) : undefined,
        url: typeof block.url === 'string' ? block.url : undefined,
        caption: typeof block.caption === 'string' ? block.caption : undefined,
      };
    });
    setEditingLongPost(post);
    setLongPostEditBlocks(blocks.length > 0 ? blocks : [{ id: 'edit-initial', type: 'paragraph', text: '' }]);
    setLongPostEditError('');
    setLongPostEditDrawerOpen(true);
  }

  async function saveLongPostEdit() {
    if (!editingLongPost?.uuid) return;
    try {
      const plainText = extractPlainTextFromBlocks(longPostEditBlocks);
      const updated = await api.updatePostContent(token, editingLongPost.uuid, {
        long_text_blocks: longPostEditBlocks,
        long_text: plainText.length >= 500 ? plainText : undefined,
        long_text_rendered_html: buildLongPostHtmlFromBlocks(longPostEditBlocks),
      });
      const returnedBlocks = Array.isArray(updated?.long_text_blocks) && (updated.long_text_blocks as unknown[]).length > 0
        ? updated.long_text_blocks
        : longPostEditBlocks;
      applyPostPatch(editingLongPost.id, (current) => ({
        ...current,
        type: 'LP',
        long_text_blocks: returnedBlocks,
        long_text: updated?.long_text ?? current.long_text,
        long_text_rendered_html: updated?.long_text_rendered_html ?? current.long_text_rendered_html,
      }));
      setLongPostEditDrawerOpen(false);
      setEditingLongPost(null);
      setNotice(t('home.postEditSuccess'));
    } catch (e: any) {
      console.error('[saveLongPostEdit] 400 response body:', e?.data);
      setLongPostEditError(e?.message || t('home.postEditFailed'));
    }
  }

  async function editPost(post: FeedPost, text: string) {
    if (!post.uuid) {
      setError(t('home.postEditUnavailable'));
      return;
    }
    try {
      const updated = await api.updatePost(token, post.uuid, text);
      const nextText = updated?.text ?? text;
      applyPostPatch(post.id, (current) => ({ ...current, text: nextText }));
      setNotice(t('home.postEditSuccess'));
    } catch (e: any) {
      setError(e?.message || t('home.postEditFailed'));
      throw e;
    }
  }

  async function deletePost(post: FeedPost) {
    if (!post.uuid) {
      setError(t('home.postDeleteUnavailable'));
      return;
    }
    try {
      await api.deletePost(token, post.uuid);
      setFeedPosts((prev) => prev.filter((item) => item.id !== post.id));
      setCommunityRoutePosts((prev) => prev.filter((item) => item.id !== post.id));
      setMyProfilePosts((prev) => prev.filter((item) => item.id !== post.id));
      setMyPinnedPosts((prev) => prev.filter((item) => item.id !== post.id));
      setActivePost((prev) => (prev?.id === post.id ? null : prev));
      setNotice(t('home.postDeleteSuccess'));
    } catch (e: any) {
      setError(e?.message || t('home.postDeleteFailed'));
      throw e;
    }
  }

  async function togglePinPost(post: FeedPost) {
    if (!post.uuid) {
      setError(t('home.postPinUnavailable'));
      return;
    }
    try {
      const currentlyPinned = !!post.is_pinned;
      const updated = currentlyPinned
        ? await api.unpinPost(token, post.uuid)
        : await api.pinPost(token, post.uuid);

      const nextPinned =
        typeof updated?.is_pinned === 'boolean' ? updated.is_pinned : !currentlyPinned;
      const nextPinnedAt =
        typeof updated?.pinned_at === 'string'
          ? updated.pinned_at
          : (nextPinned ? new Date().toISOString() : undefined);

      applyPostPatch(post.id, (current) => ({
        ...current,
        is_pinned: nextPinned,
        pinned_at: nextPinnedAt,
      }));

      setMyPinnedPosts((prev) => {
        const existing = prev.find((item) => item.id === post.id);
        const without = prev.filter((item) => item.id !== post.id);
        if (!nextPinned) return without;
        const source = existing || post;
        return [{ ...source, is_pinned: true, pinned_at: nextPinnedAt }, ...without];
      });

      setNotice(nextPinned ? t('home.postPinnedSuccess') : t('home.postUnpinnedSuccess'));
    } catch (e: any) {
      setError(e?.message || t('home.postPinFailed'));
      throw e;
    }
  }

  async function updateMyProfile(payload: UpdateAuthenticatedUserPayload) {
    const profilePayload = {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.location !== undefined ? { location: payload.location } : {}),
      ...(payload.bio !== undefined ? { bio: payload.bio } : {}),
      ...(payload.url !== undefined ? { url: payload.url } : {}),
    };

    try {
      const updatedUser = await api.updateAuthenticatedUser(token, payload);
      if (updatedUser && typeof updatedUser === 'object') {
        const nextUser = updatedUser as any;
        setUser((prev: any) => ({
          ...(prev || {}),
          ...(payload || {}),
          ...nextUser,
          profile: {
            ...(prev?.profile || {}),
            ...profilePayload,
            ...(nextUser?.profile || {}),
          },
        }));
      } else {
        setUser((prev: any) => ({
          ...(prev || {}),
          ...(payload || {}),
          profile: {
            ...(prev?.profile || {}),
            ...profilePayload,
          },
        }));
      }
      setNotice(t('home.profileUpdateSuccess', { defaultValue: 'Profile updated.' }));
    } catch (e: any) {
      setError(e?.message || t('home.profileUpdateFailed', { defaultValue: 'Could not update profile right now.' }));
      throw e;
    }
  }

  async function updateMyProfileMedia(media: UpdateAuthenticatedUserMediaPayload) {
    try {
      const updatedUser = await api.updateAuthenticatedUserWithMedia(token, {}, media);
      if (updatedUser && typeof updatedUser === 'object') {
        const nextUser = updatedUser as any;
        setUser((prev: any) => ({
          ...(prev || {}),
          ...nextUser,
          profile: {
            ...(prev?.profile || {}),
            ...(nextUser?.profile || {}),
          },
        }));
      }
      setNotice(t('home.profileUpdateSuccess', { defaultValue: 'Profile updated.' }));
    } catch (e: any) {
      setError(e?.message || t('home.profileUpdateFailed', { defaultValue: 'Could not update profile right now.' }));
      throw e;
    }
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
      applyPostPatch(post.id, (current) => {
        const existing = current.reactions_emoji_counts || [];
        // Update counts in place, preserving the current display order.
        // Add any new emojis from the server at the end; drop any that hit zero.
        const countMap = new Map(counts.map((c) => [c.emoji?.id, c.count ?? 0]));
        const updated = existing
          .map((e) => ({ ...e, count: countMap.has(e.emoji?.id) ? countMap.get(e.emoji?.id)! : (e.count ?? 0) }))
          .filter((e) => (e.count ?? 0) > 0);
        const existingIds = new Set(existing.map((e) => e.emoji?.id));
        counts.forEach((c) => {
          if (!existingIds.has(c.emoji?.id) && (c.count ?? 0) > 0) updated.push(c);
        });
        return { ...current, reactions_emoji_counts: updated };
      });
    } catch {
      // Keep UI resilient if counts refresh fails.
    }
  }

  async function openReactionPicker(post: FeedPost) {
    requestAnimationFrame(() => {
      setReactionPickerPost(post);
    });
    await ensureReactionGroups();
  }

  function closeReactionPicker() {
    if (reactionActionLoading) return;
    setReactionPickerPost(null);
  }

  async function reactToPostWithEmoji(post: FeedPost, emojiId?: number) {
    if (!post.uuid || !emojiId || reactionActionLoading) return;
    const isAlreadyMyReaction = post.reaction?.emoji?.id === emojiId;
    const prevReactionEmojiId = post.reaction?.emoji?.id;
    const emojiMeta = (post.reactions_emoji_counts || []).find((e) => e.emoji?.id === emojiId)?.emoji;

    // Optimistic update — apply immediately so the UI feels instant
    if (isAlreadyMyReaction) {
      applyPostPatch(post.id, (current) => ({
        ...current,
        reaction: null,
        reactions_emoji_counts: (current.reactions_emoji_counts || [])
          .map((e) => e.emoji?.id === emojiId ? { ...e, count: Math.max(0, (e.count || 1) - 1) } : e)
          .filter((e) => (e.count || 0) > 0),
      }));
    } else {
      applyPostPatch(post.id, (current) => ({
        ...current,
        reaction: { emoji: emojiMeta },
        reactions_emoji_counts: (current.reactions_emoji_counts || []).map((e) => {
          if (e.emoji?.id === emojiId) return { ...e, count: (e.count || 0) + 1 };
          if (prevReactionEmojiId && e.emoji?.id === prevReactionEmojiId) return { ...e, count: Math.max(0, (e.count || 1) - 1) };
          return e;
        }),
      }));
    }

    setReactionActionLoading(true);
    try {
      if (isAlreadyMyReaction) {
        await api.removeReactionFromPost(token, post.uuid);
      } else {
        const reaction = await api.reactToPost(token, post.uuid, emojiId);
        // Reconcile with the server's canonical reaction object
        applyPostPatch(post.id, (current) => ({ ...current, reaction }));
      }
      await refreshPostReactionCounts(post);
      setReactionPickerPost(null);
    } catch (e: any) {
      // Revert optimistic update on failure
      applyPostPatch(post.id, () => post);
      setError(e?.message || t('home.reactionLoadFailed'));
    } finally {
      setReactionActionLoading(false);
    }
  }

  async function reactToComment(postId: number, commentId: number, emojiId?: number) {
    const sourcePost = getSourcePost(postId);
    if (!sourcePost?.uuid || !emojiId || reactionActionLoading) return;
    setReactionActionLoading(true);
    try {
      const reaction = await api.reactToPostComment(token, sourcePost.uuid, commentId, emojiId);
      const counts = await api.getPostCommentReactionCounts(token, sourcePost.uuid, commentId);
      setLocalComments((prev) => ({
        ...prev,
        [postId]: (prev[postId] || []).map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                reaction,
                reactions_emoji_counts: counts,
              }
            : comment
        ),
      }));
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
    if (!post.uuid) {
      setError(t('home.reactionUnavailable'));
      return;
    }
    setReactionListOpen(true);
    setReactionListPost(post);
    setReactionListEmoji(emoji || null);
    setReactionListUsers([]);
    setReactionListLoading(true);
    try {
      const reactions = await api.getPostReactions(token, post.uuid, emoji?.id);
      setReactionListUsers(reactions);
    } catch (e: any) {
      setError(e?.message || t('home.reactionLoadFailed'));
    } finally {
      setReactionListLoading(false);
    }
  }

  async function loadReactionListInline(post: FeedPost, emoji?: ReactionEmoji) {
    if (!post.uuid) {
      setError(t('home.reactionUnavailable'));
      return;
    }
    setReactionListEmoji(emoji || null);
    setReactionListUsers([]);
    setReactionListLoading(true);
    try {
      const reactions = await api.getPostReactions(token, post.uuid, emoji?.id);
      setReactionListUsers(reactions);
    } catch (e: any) {
      setError(e?.message || t('home.reactionLoadFailed'));
    } finally {
      setReactionListLoading(false);
    }
  }

  function closeReactionList() {
    setReactionListOpen(false);
    setReactionListPost(null);
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

  function isInternalOpenspaceUrl(url: string) {
    try {
      const parsed = new URL(url);
      const hostname = (parsed.hostname || '').toLowerCase();
      return (
        hostname.endsWith('openspace.social') ||
        hostname === 'openspace-staging-api.us-east-2.elasticbeanstalk.com' ||
        hostname === 'localhost' ||
        hostname === '127.0.0.1'
      );
    } catch {
      return false;
    }
  }

  async function confirmOpenPendingExternalLink() {
    const url = pendingExternalLink;
    if (!url) {
      setExternalLinkModalOpen(false);
      return;
    }

    if (externalLinkResetTimerRef.current) {
      clearTimeout(externalLinkResetTimerRef.current);
      externalLinkResetTimerRef.current = null;
    }

    setExternalLinkModalOpen(false);
    externalLinkResetTimerRef.current = setTimeout(() => {
      setPendingExternalLink(null);
      externalLinkResetTimerRef.current = null;
    }, 220);

    setTimeout(() => {
      Linking.openURL(url).catch(() => setError(t('home.openLinkFailed')));
    }, 140);
  }

  function cancelOpenPendingExternalLink() {
    if (externalLinkResetTimerRef.current) {
      clearTimeout(externalLinkResetTimerRef.current);
      externalLinkResetTimerRef.current = null;
    }
    setExternalLinkModalOpen(false);
    externalLinkResetTimerRef.current = setTimeout(() => {
      setPendingExternalLink(null);
      externalLinkResetTimerRef.current = null;
    }, 220);
  }

  function openLink(url?: string) {
    if (!url) return;
    if (isInternalOpenspaceUrl(url)) {
      Linking.openURL(url).catch(() => setError(t('home.openLinkFailed')));
      return;
    }
    setPendingExternalLink(url);
    setExternalLinkModalOpen(true);
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

  useEffect(() => {
    return () => {
      if (externalLinkResetTimerRef.current) {
        clearTimeout(externalLinkResetTimerRef.current);
        externalLinkResetTimerRef.current = null;
      }
    };
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

  useEffect(() => {
    return () => {
      if (typeof URL === 'undefined') return;
      for (const image of composerImages) {
        if (image.previewUri?.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(image.previewUri);
          } catch {
            // best-effort cleanup for browser object URLs
          }
        }
      }
      if (composerVideo?.previewUri?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(composerVideo.previewUri);
        } catch {
          // best-effort cleanup for browser object URLs
        }
      }
    };
  }, [composerImages, composerVideo]);

  useEffect(() => {
    if (!longPostDrawerOpen || composerPostType !== 'LP') return;

    const hasDraftContent = composerLongPostBlocks.some((block) => {
      const text = (block.text || '').trim();
      const url = (block.url || '').trim();
      const caption = (block.caption || '').trim();
      return !!text || !!url || !!caption;
    });
    if (!hasDraftContent) return;

    if (longPostAutosaveTimerRef.current) {
      clearTimeout(longPostAutosaveTimerRef.current);
      longPostAutosaveTimerRef.current = null;
    }

    longPostAutosaveTimerRef.current = setTimeout(() => {
      void saveLongPostDraft(false);
    }, 20000);

    return () => {
      if (longPostAutosaveTimerRef.current) {
        clearTimeout(longPostAutosaveTimerRef.current);
        longPostAutosaveTimerRef.current = null;
      }
    };
  }, [longPostDrawerOpen, composerPostType, composerLongPostBlocks]);

  // ── Notification handlers ─────────────────────────────────────────────────────

  async function handleOpenNotifications() {
    setNotifDrawerOpen(true);
    setNotifLoading(true);
    setNotifications([]);
    setNotifHasMore(false);
    setNotifNextMaxId(undefined);
    try {
      const result = await api.getNotifications(token);
      setNotifications(result.notifications);
      setNotifHasMore(result.hasMore);
      setNotifNextMaxId(result.nextMaxId);
    } catch {
      // silently ignore — empty state will show
    } finally {
      setNotifLoading(false);
    }
  }

  async function handleLoadMoreNotifications() {
    if (notifLoadingMore || !notifHasMore) return;
    setNotifLoadingMore(true);
    try {
      const result = await api.getNotifications(token, notifNextMaxId);
      setNotifications((prev) => [...prev, ...result.notifications]);
      setNotifHasMore(result.hasMore);
      setNotifNextMaxId(result.nextMaxId);
    } catch {
      // silently ignore
    } finally {
      setNotifLoadingMore(false);
    }
  }

  async function handleMarkAllRead() {
    try {
      await api.markNotificationsRead(token);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // silently ignore
    }
  }

  async function handleMarkRead(id: number) {
    try {
      await api.markNotificationRead(token, id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silently ignore
    }
  }

  async function handleDeleteNotification(id: number) {
    try {
      await api.deleteNotification(token, id);
      const deleted = notifications.find((n) => n.id === id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (deleted && !deleted.read) setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silently ignore
    }
  }

  async function handleDeleteAllNotifications() {
    try {
      await api.deleteAllNotifications(token);
      setNotifications([]);
      setNotifHasMore(false);
      setNotifNextMaxId(undefined);
      setUnreadCount(0);
    } catch {
      // silently ignore
    }
  }

  function handleNotificationNavigatePost(postId: number) {
    setNotifDrawerOpen(false);
    onNavigate({ screen: 'post', postId });
  }

  function handleNotificationNavigateProfile(username: string) {
    setNotifDrawerOpen(false);
    onNavigate({ screen: 'profile', username });
  }

  function handleNotificationNavigateCommunity(name: string) {
    setNotifDrawerOpen(false);
    onNavigate({ screen: 'community', name });
  }

  // ─────────────────────────────────────────────────────────────────────────────

  function handleProfileComingSoon() {
    setProfileMenuOpen(false);
    onNavigate({ screen: 'me' });
  }

  function clearComposerMedia() {
    if (typeof URL !== 'undefined') {
      for (const image of composerImages) {
        if (image.previewUri?.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(image.previewUri);
          } catch {
            // best-effort cleanup for browser object URLs
          }
        }
      }
      if (composerVideo?.previewUri?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(composerVideo.previewUri);
        } catch {
          // best-effort cleanup for browser object URLs
        }
      }
    }
    setComposerImages([]);
    setComposerVideo(null);
  }

  function openComposerModal(action?: 'video' | 'image' | 'emoji') {
    composerTextRef.current = '';
    setComposerTextLength(0);
    setComposerInputKey((prev) => prev + 1);
    setComposerPostType('P');
    setComposerLongPostBlocks([{ id: 'initial-paragraph', type: 'paragraph', text: '' }]);
    showComposerDrawer();
    setComposerStep('compose');
    setComposerDraftUuid(null);
    setComposerDraftSavedAt(null);
    setComposerDraftExpiryDays(14);
    setComposerDraftsOpen(false);
    setComposerDrafts([]);
    setComposerSelectedCircleId(null);
    setComposerSelectedCommunityNames([]);
    setComposerCommunitySearch('');
    setLongPostDrawerOpen(false);
    setLongPostDrawerExpanded(false);
    if (action === 'image' || action === 'video') {
      openComposerMediaPicker(action);
    }
  }

  function showComposerDrawer() {
    composerClosingRef.current = false;
    setComposerOpen(true);
    setComposerModalMounted(true);
    const startAnimation = () => {
      composerTranslateX.setValue(composerDrawerWidth);
      Animated.timing(composerTranslateX, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(startAnimation);
      return;
    }
    setTimeout(startAnimation, 0);
  }

  function resetComposerState() {
    composerTextRef.current = '';
    setComposerTextLength(0);
    setComposerInputKey((prev) => prev + 1);
    clearComposerMedia();
    setComposerSubmitting(false);
    setComposerStep('compose');
    setComposerDraftUuid(null);
    setComposerDraftSavedAt(null);
    setComposerDraftExpiryDays(14);
    setComposerDraftsOpen(false);
    setComposerDraftsLoading(false);
    setComposerDrafts([]);
    setComposerDraftDeleteUuid(null);
    setComposerSelectedCircleId(null);
    setComposerSelectedCommunityNames([]);
    setComposerCommunitySearch('');
    setComposerDestinationsLoading(false);
    setComposerPostType('P');
    setComposerLongPostBlocks([{ id: 'initial-paragraph', type: 'paragraph', text: '' }]);
    setLongPostDrawerOpen(false);
    setLongPostDrawerExpanded(false);
    if (longPostAutosaveTimerRef.current) {
      clearTimeout(longPostAutosaveTimerRef.current);
      longPostAutosaveTimerRef.current = null;
    }
  }

  function hideComposerDrawer(onHidden?: () => void) {
    if (!composerModalMounted) {
      onHidden?.();
      return;
    }
    if (composerClosingRef.current) return;
    composerClosingRef.current = true;
    Animated.timing(composerTranslateX, {
      toValue: composerDrawerWidth,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      composerClosingRef.current = false;
      setComposerOpen(false);
      setComposerModalMounted(false);
      onHidden?.();
    });
  }

  function closeComposerModal() {
    hideComposerDrawer(() => {
      resetComposerState();
    });
  }

  function switchToLongPostForm() {
    setComposerPostType('LP');
    hideComposerDrawer(() => {
      setLongPostDrawerOpen(true);
    });
  }

  async function openComposerDestinationFromLongPost() {
    if (composerSubmitting || composerDestinationsLoading) return;
    setComposerPostType('LP');
    setError('');
    setLongPostDrawerOpen(false);
    setComposerStep('destination');
    showComposerDrawer();
    try {
      await loadComposerDestinations();
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not publish your post right now.' }));
    }
  }

  function getComposerLongPayload() {
    const trimmedLongText = extractPlainTextFromBlocks(composerLongPostBlocks);
    return {
      long_text: trimmedLongText.length >= 500 ? trimmedLongText : undefined,
      long_text_blocks: composerLongPostBlocks,
      long_text_rendered_html: buildLongPostHtmlFromBlocks(composerLongPostBlocks),
      long_text_version: 1,
      type: 'LP' as const,
      draft_expiry_days: composerDraftExpiryDays,
    };
  }

  async function saveLongPostDraft(showSuccessNotice = true) {
    if (composerDraftSaving || composerSubmitting || composerDestinationsLoading) return;
    setComposerDraftSaving(true);
    setError('');
    try {
      const longPayload = getComposerLongPayload();
      if (!composerDraftUuid) {
        const created = await api.createPost(token, {
          ...longPayload,
          is_draft: true,
        });
        setComposerDraftUuid(created.uuid || null);
      } else {
        await api.updatePostContent(token, composerDraftUuid, {
          ...longPayload,
        });
      }
      setComposerDraftSavedAt(new Date().toISOString());
      if (showSuccessNotice) {
        setNotice(t('home.postComposerDraftSuccess', { defaultValue: 'Draft saved.' }));
      }
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not save draft right now.' }));
    } finally {
      setComposerDraftSaving(false);
    }
  }

  async function loadLongPostDrafts() {
    setComposerDraftsLoading(true);
    setError('');
    try {
      const drafts = await api.getDraftPosts(token, 20);
      const longDrafts = drafts.filter((post) => post.type === 'LP');
      setComposerDrafts(longDrafts);
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not load drafts right now.' }));
    } finally {
      setComposerDraftsLoading(false);
    }
  }

  function openLongPostDraftsDrawer() {
    setComposerDraftsOpen(true);
    void loadLongPostDrafts();
  }

  async function resumeLongPostDraft(post: FeedPost) {
    const blocks = Array.isArray(post.long_text_blocks) && post.long_text_blocks.length > 0
      ? (post.long_text_blocks as LongPostBlock[])
      : [{ id: 'initial-paragraph', type: 'paragraph' as const, text: post.long_text || '' }];
    setComposerPostType('LP');
    setComposerLongPostBlocks(blocks);
    setComposerDraftUuid(post.uuid || null);
    setComposerDraftSavedAt(post.created || null);
    setComposerDraftsOpen(false);
    setLongPostDrawerOpen(true);
  }

  async function deleteLongPostDraft(postUuid?: string) {
    if (!postUuid || composerDraftDeleteUuid) return;
    setComposerDraftDeleteUuid(postUuid);
    setError('');
    try {
      await api.deletePost(token, postUuid);
      setComposerDrafts((prev) => prev.filter((post) => post.uuid !== postUuid));
      if (composerDraftUuid === postUuid) {
        setComposerDraftUuid(null);
        setComposerDraftSavedAt(null);
      }
      setNotice(t('home.postDeletedNotice', { defaultValue: 'Post deleted.' }));
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not delete draft right now.' }));
    } finally {
      setComposerDraftDeleteUuid(null);
    }
  }

  function openComposerMediaPicker(kind: ComposerMediaType) {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setNotice(t('home.postComposerMediaUnsupported', { defaultValue: 'Media upload is currently available on web.' }));
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'video' ? 'video/*' : 'image/*';
    if (kind === 'image') {
      input.multiple = true;
    }
    input.onchange = () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;

      if (kind === 'video') {
        const file = files[0];
        const previewUri = typeof URL !== 'undefined' ? URL.createObjectURL(file) : undefined;
        if (typeof URL !== 'undefined') {
          for (const image of composerImages) {
            if (image.previewUri?.startsWith('blob:')) {
              try {
                URL.revokeObjectURL(image.previewUri);
              } catch {
                // best-effort cleanup for browser object URLs
              }
            }
          }
          if (composerVideo?.previewUri?.startsWith('blob:')) {
            try {
              URL.revokeObjectURL(composerVideo.previewUri);
            } catch {
              // best-effort cleanup for browser object URLs
            }
          }
        }
        setComposerImages([]);
        setComposerVideo({
          file: file as Blob & { name?: string; type?: string },
          previewUri,
        });
        return;
      }

      const imageFiles = files.filter((file) => file.type.startsWith('image/')).slice(0, 5);
      if (!imageFiles.length) return;

      setComposerVideo((prev) => {
        if (prev?.previewUri?.startsWith('blob:') && typeof URL !== 'undefined') {
          try {
            URL.revokeObjectURL(prev.previewUri);
          } catch {
            // best-effort cleanup for browser object URLs
          }
        }
        return null;
      });

      setComposerImages((prev) => {
        const remaining = Math.max(0, 5 - prev.length);
        if (remaining <= 0) {
          setNotice(t('home.postComposerMaxImagesReached', { count: 5, defaultValue: 'You can upload up to 5 photos.' }));
          return prev;
        }
        const nextFiles = imageFiles.slice(0, remaining);
        const nextEntries: ComposerImageSelection[] = nextFiles.map((file) => ({
          file: file as Blob & { name?: string; type?: string },
          previewUri: typeof URL !== 'undefined' ? URL.createObjectURL(file) : undefined,
        }));
        return [...prev, ...nextEntries];
      });
    };
    input.click();
  }

  function removeComposerImage(index: number) {
    setComposerImages((prev) => {
      const target = prev[index];
      if (target?.previewUri?.startsWith('blob:') && typeof URL !== 'undefined') {
        try {
          URL.revokeObjectURL(target.previewUri);
        } catch {
          // best-effort cleanup for browser object URLs
        }
      }
      return prev.filter((_, idx) => idx !== index);
    });
  }

  async function loadComposerDestinations() {
    setComposerDestinationsLoading(true);
    try {
      const [circles, joinedCommunitiesFirstPage] = await Promise.all([
        api.getCircles(token),
        api.getJoinedCommunities(token, 20, 0),
      ]);

      const joinedCommunitiesAll: SearchCommunityResult[] = Array.isArray(joinedCommunitiesFirstPage)
        ? [...joinedCommunitiesFirstPage]
        : [];
      let offset = joinedCommunitiesAll.length;
      while (joinedCommunitiesAll.length > 0 && joinedCommunitiesAll.length % 20 === 0) {
        const nextPage = await api.getJoinedCommunities(token, 20, offset);
        if (!Array.isArray(nextPage) || nextPage.length === 0) break;
        joinedCommunitiesAll.push(...nextPage);
        offset += nextPage.length;
        if (nextPage.length < 20) break;
      }

      const safeCircles = Array.isArray(circles) ? circles : [];
      const safeCommunities = joinedCommunitiesAll.filter(
        (community, index, all) => all.findIndex((candidate) => candidate.id === community.id) === index
      );
      setComposerCircles(safeCircles);
      setComposerJoinedCommunities(safeCommunities);

      const hasCommunities = safeCommunities.length > 0;

      if (safeCircles.length > 0) {
        const circleStillExists = safeCircles.some((circle) => circle.id === composerSelectedCircleId);
        if (!circleStillExists && composerSelectedCircleId !== null) setComposerSelectedCircleId(null);
      } else {
        // Keep null to represent Public destination for non-community posts.
        setComposerSelectedCircleId(null);
      }

      if (hasCommunities) {
        const safeNames = new Set(
          safeCommunities.map((community) => community.name).filter((name): name is string => !!name)
        );
        setComposerSelectedCommunityNames((prev) => prev.filter((name) => safeNames.has(name)).slice(0, 3));
      } else {
        setComposerSelectedCommunityNames([]);
      }

      if (safeCircles.length === 0 && !hasCommunities) {
        throw new Error(
          t('home.postComposerDestinationEmpty', {
            defaultValue: 'You need at least one circle or joined community before publishing.',
          })
        );
      }
    } finally {
      setComposerDestinationsLoading(false);
    }
  }

  async function goToComposerDestinationStep() {
    if (composerSubmitting || composerDestinationsLoading) return;
    const trimmedText = composerTextRef.current.trim();
    const trimmedLongText = extractPlainTextFromBlocks(composerLongPostBlocks);
    const hasImages = composerImages.length > 0;
    const hasVideo = !!composerVideo;
    const hasTextContent = composerPostType === 'LP' ? !!trimmedLongText : !!trimmedText;
    if (!hasTextContent && !hasImages && !hasVideo) {
      setError(t('home.postComposerValidation', { defaultValue: 'Write something or attach media.' }));
      return;
    }
    setError('');
    try {
      await loadComposerDestinations();
      setComposerStep('destination');
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not publish your post right now.' }));
    }
  }

  async function submitComposerPost(options?: { saveAsDraft?: boolean }) {
    const saveAsDraft = !!options?.saveAsDraft;
    if (composerSubmitting || composerDestinationsLoading || composerDraftSaving) return;
    if (composerStep === 'compose' && !saveAsDraft) {
      await goToComposerDestinationStep();
      return;
    }
    const trimmedText = composerTextRef.current.trim();
    const trimmedLongText = extractPlainTextFromBlocks(composerLongPostBlocks);
    const longTextBlocks = composerPostType === 'LP' ? composerLongPostBlocks : undefined;
    const longTextRenderedHtml = composerPostType === 'LP'
      ? buildLongPostHtmlFromBlocks(composerLongPostBlocks)
      : undefined;
    const hasImages = composerImages.length > 0;
    const hasVideo = !!composerVideo;
    const hasTextContent = composerPostType === 'LP' ? !!trimmedLongText : !!trimmedText;
    if (!hasTextContent && !hasImages && !hasVideo) {
      setError(t('home.postComposerValidation', { defaultValue: 'Write something or attach media.' }));
      return;
    }

    if (composerPostType === 'LP' && saveAsDraft) {
      await saveLongPostDraft(true);
      return;
    }

    const targetCircleId = saveAsDraft ? null : composerSelectedCircleId;
    const targetCommunityNames = saveAsDraft ? [] : composerSelectedCommunityNames.slice(0, 3);

    setComposerSubmitting(true);
    setError('');
    setNotice('');

    try {
      const postPayload = {
        text: composerPostType === 'LP' ? undefined : (trimmedText || undefined),
        long_text: composerPostType === 'LP' && trimmedLongText.length >= 500 ? trimmedLongText : undefined,
        long_text_blocks: composerPostType === 'LP' ? longTextBlocks : undefined,
        long_text_rendered_html: longTextRenderedHtml,
        long_text_version: composerPostType === 'LP' ? 1 : undefined,
        draft_expiry_days: composerPostType === 'LP' ? composerDraftExpiryDays : undefined,
        type: composerPostType,
      } as const;

      const createPrimaryPost = async (primaryImage?: Blob | null, isDraft = false) => {
        return api.createPost(token, {
          ...postPayload,
          image: primaryImage,
          video: composerVideo?.file,
          circle_id: targetCircleId ? [targetCircleId] : undefined,
          community_names: targetCommunityNames.length > 0 ? targetCommunityNames : undefined,
          is_draft: isDraft || undefined,
        });
      };

      if (composerPostType === 'LP' && composerDraftUuid && !hasImages && !hasVideo && !saveAsDraft) {
        await api.updatePostContent(token, composerDraftUuid, {
          long_text: trimmedLongText.length >= 500 ? trimmedLongText : undefined,
          long_text_blocks: composerLongPostBlocks,
          long_text_rendered_html: longTextRenderedHtml,
          long_text_version: 1,
          draft_expiry_days: composerDraftExpiryDays,
          type: 'LP',
        });
        await api.updatePostTargets(token, composerDraftUuid, {
          circle_id: targetCircleId ? [targetCircleId] : [],
          community_names: targetCommunityNames,
        });
        await api.publishPost(token, composerDraftUuid);
      } else if (hasImages && composerImages.length > 1) {
        const draftPost = await createPrimaryPost(composerImages[0]?.file, true);

        if (!draftPost.uuid) {
          throw new Error(t('home.postComposerFailed', { defaultValue: 'Could not publish your post right now.' }));
        }

        for (let index = 1; index < composerImages.length; index += 1) {
          const image = composerImages[index];
          await api.addPostMedia(token, draftPost.uuid, {
            file: image.file,
            order: index + 1,
          });
        }
        if (!saveAsDraft) {
          await api.publishPost(token, draftPost.uuid);
        }
      } else {
        const createdPost = await createPrimaryPost(composerImages[0]?.file, saveAsDraft);
        if (saveAsDraft && composerPostType === 'LP') {
          setComposerDraftUuid(createdPost.uuid || null);
          setComposerDraftSavedAt(new Date().toISOString());
        }
      }

      closeComposerModal();
      setNotice(
        saveAsDraft
          ? t('home.postComposerDraftSuccess', { defaultValue: 'Draft saved.' })
          : t('home.postComposerSuccess', { defaultValue: 'Post published.' })
      );
      await loadFeed(activeFeed);
    } catch (e: any) {
      setError(e?.message || t('home.postComposerFailed', { defaultValue: 'Could not publish your post right now.' }));
    } finally {
      setComposerSubmitting(false);
    }
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

  // Keep the last non-post route as the background context while a post modal is open.
  const displayRoute = route.screen === 'post' ? lastNonPostRouteRef.current : route;
  const viewingProfileRoute = displayRoute.screen === 'profile' || displayRoute.screen === 'me';
  const viewingCommunityRoute = displayRoute.screen === 'community';
  const viewingHashtagRoute = displayRoute.screen === 'hashtag';
  const profileRouteUsername = displayRoute.screen === 'profile'
    ? displayRoute.username
    : user?.username || '';
  const communityRouteName = displayRoute.screen === 'community' ? displayRoute.name : '';
  const hashtagRouteName = displayRoute.screen === 'hashtag' ? displayRoute.name : '';
  const showSearchDropdown = searchFocused && searchQuery.trim().length >= 2;
  const hasAnySearchResults = searchUsers.length > 0 || searchCommunities.length > 0 || searchHashtags.length > 0;
  const hasActivePostMedia = postHasMedia(activePost);
  const composerCommunitySearchTrimmed = composerCommunitySearch.trim().toLowerCase();
  const filteredComposerJoinedCommunities = composerCommunitySearchTrimmed
    ? composerJoinedCommunities.filter((community) => {
        const name = (community.name || '').toLowerCase();
        const title = (community.title || '').toLowerCase();
        return name.includes(composerCommunitySearchTrimmed) || title.includes(composerCommunitySearchTrimmed);
      })
    : composerJoinedCommunities;

  function sanitizeCircleColor(value?: string) {
    if (!value || typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed;
    if (/^rgb(a)?\(/i.test(trimmed)) return trimmed;
    if (/^hsl(a)?\(/i.test(trimmed)) return trimmed;
    return undefined;
  }
  const showingMainSearchResults = !viewingProfileRoute &&
    !viewingCommunityRoute &&
    !viewingHashtagRoute &&
    searchResultsActive &&
    searchResultsQuery.length >= 2;
  const isWideSearchResultsLayout = viewportWidth >= 1200;
  const isCompactProfileLayout = viewportWidth < 1180;
  const profileTabs: Array<{ key: ProfileTabKey; label: string }> = [
    { key: 'all', label: t('home.profileTabAll') },
    { key: 'about', label: t('home.profileTabAbout') },
    { key: 'followers', label: t('home.profileTabFollowers') },
    { key: 'photos', label: t('home.profileTabPhotos') },
    { key: 'reels', label: t('home.profileTabReels') },
    { key: 'more', label: t('home.profileTabMore') },
  ];
  const showFeedFollowButton = !viewingProfileRoute && !viewingCommunityRoute && !viewingHashtagRoute && !showingMainSearchResults;
  const reactionListModalHeight = Math.max(420, Math.min(Math.floor(viewportHeight * 0.8), 740));
  const composerDrawerWidth =
    Platform.OS === 'web'
      ? composerStep === 'compose'
        ? Math.min(980, Math.max(760, viewportWidth * 0.72))
        : Math.min(840, Math.max(640, viewportWidth * 0.62))
      : viewportWidth;

  function handleNavigateProfile(username: string) {
    onNavigate({ screen: 'profile', username });
  }

  function handleNavigateProfileFromPostDetail(username: string) {
    closeReactionList();
    clearWebFocus();
    setActivePost(null);
    onNavigate({ screen: 'profile', username }, true);
  }

  function handleNavigateCommunity(name: string) {
    onNavigate({ screen: 'community', name });
  }

  function renderPostCard(
    post: FeedPost,
    variant: 'feed' | 'profile' = 'feed',
    pinnedPostsSource: FeedPost[] = myPinnedPosts
  ) {
    const PIN_LIMIT = 5;
    const pinnedIndex = pinnedPostsSource.findIndex((item) => item.id === post.id);
    return (
      <PostCard
        key={`${variant}-${activeFeed}-${post.id}`}
        post={post}
        variant={variant}
        styles={styles}
        c={c}
        t={t}
        currentUsername={user?.username}
        expandedPostIds={expandedPostIds}
        commentBoxPostIds={commentBoxPostIds}
        localComments={localComments}
        commentRepliesById={commentRepliesById}
        commentRepliesExpanded={commentRepliesExpanded}
        commentRepliesLoadingById={commentRepliesLoadingById}
        draftComments={draftComments}
        draftReplies={draftReplies}
        commentEditDrafts={commentEditDrafts}
        replyEditDrafts={replyEditDrafts}
        editingCommentById={editingCommentById}
        editingReplyById={editingReplyById}
        commentMutationLoadingById={commentMutationLoadingById}
        reactionGroups={reactionGroups}
        reactionPickerLoading={reactionPickerLoading}
        reactionActionLoading={reactionActionLoading}
        followStateByUsername={followStateByUsername}
        followActionLoadingByUsername={followActionLoadingByUsername}
        showFollowButton={variant === 'feed' && showFeedFollowButton}
        onEnsureReactionGroups={ensureReactionGroups}
        onReactToComment={reactToComment}
        onReactToPostWithEmoji={reactToPostWithEmoji}
        onToggleFollow={handleToggleFollow}
        onOpenPostDetail={openPostDetail}
        onToggleExpand={toggleExpand}
        onOpenReactionList={openReactionList}
        onOpenReactionPicker={openReactionPicker}
        onToggleCommentBox={toggleCommentBox}
        onToggleCommentReplies={toggleCommentReplies}
        onSharePost={handleSharePost}
        onOpenLink={openLink}
        onUpdateDraftComment={updateDraftComment}
        onUpdateDraftReply={updateDraftReply}
        onStartEditingComment={startEditingComment}
        onCancelEditingComment={cancelEditingComment}
        onUpdateEditCommentDraft={updateEditCommentDraft}
        onSaveEditedComment={saveEditedComment}
        onDeleteComment={deleteComment}
        onSubmitComment={submitComment}
        onSubmitReply={submitReply}
        onOpenReportPostModal={openReportPostModal}
        onEditPost={editPost}
        onOpenLongPostEdit={openLongPostEdit}
        onDeletePost={deletePost}
        onTogglePinPost={togglePinPost}
        pinnedPostsCount={pinnedPostsSource.length}
        pinnedPostsLimit={PIN_LIMIT}
        pinnedDisplayIndex={pinnedIndex >= 0 ? pinnedIndex + 1 : null}
        pinnedDisplayLimit={PIN_LIMIT}
        onNavigateProfile={handleNavigateProfile}
        onNavigateCommunity={handleNavigateCommunity}
        token={token}
        onFetchUserProfile={api.getUserProfile}
        getPostText={getPostText}
        getPostLengthType={getPostLengthType}
        getPostReactionCount={getPostReactionCount}
        getPostCommentsCount={getPostCommentsCount}
      />
    );
  }

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
          <TouchableOpacity
            style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
            activeOpacity={0.85}
            onPress={() => void handleOpenNotifications()}
          >
            <MaterialCommunityIcons
              name={unreadCount > 0 ? 'bell-badge-outline' : 'bell-outline'}
              size={18}
              color={unreadCount > 0 ? c.primary : c.textSecondary}
            />
            {unreadCount > 0 ? (
              <View style={{
                position: 'absolute',
                top: 2,
                right: 2,
                minWidth: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: c.primary,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 2,
              }}>
                <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', lineHeight: 12 }}>
                  {unreadCount > 99 ? '99+' : String(unreadCount)}
                </Text>
              </View>
            ) : null}
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
        visible={externalLinkModalOpen}
        transparent
        animationType="fade"
        onRequestClose={cancelOpenPendingExternalLink}
      >
        <TouchableOpacity
          style={styles.externalLinkModalBackdrop}
          activeOpacity={1}
          onPress={cancelOpenPendingExternalLink}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.externalLinkModalCard,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <Text style={[styles.externalLinkModalTitle, { color: c.textPrimary }]}>
                {t('home.externalLinkWarningTitle')}
              </Text>
              <Text style={[styles.externalLinkModalBody, { color: c.textSecondary }]}>
                {t('home.externalLinkWarningBody')}
              </Text>
              {pendingExternalLink ? (
                <Text numberOfLines={2} style={[styles.externalLinkModalUrl, { color: c.textMuted }]}>
                  {pendingExternalLink}
                </Text>
              ) : null}
              <View style={styles.externalLinkModalActions}>
                <TouchableOpacity
                  style={[styles.externalLinkCancelButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={cancelOpenPendingExternalLink}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.externalLinkCancelButtonText, { color: c.textSecondary }]}>
                    {t('home.externalLinkCancelAction')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.externalLinkContinueButton, { backgroundColor: c.primary }]}
                  onPress={confirmOpenPendingExternalLink}
                  activeOpacity={0.85}
                >
                  <Text style={styles.externalLinkContinueButtonText}>
                    {t('home.externalLinkContinueAction')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={composerModalMounted}
        transparent
        animationType="none"
        onRequestClose={closeComposerModal}
      >
        <TouchableOpacity
          style={styles.postComposerModalBackdrop}
          activeOpacity={1}
          onPress={closeComposerModal}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <Animated.View
              style={[
                styles.postComposerModalCard,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  width: composerDrawerWidth,
                  transform: [{ translateX: composerTranslateX }],
                },
              ]}
            >
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                  {composerStep === 'compose'
                    ? t('home.postComposerTitle', { defaultValue: 'Create post' })
                    : t('home.postComposerDestinationTitle', { defaultValue: 'Choose where to publish' })}
                </Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={closeComposerModal}
                  activeOpacity={0.85}
                  disabled={composerSubmitting}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.postComposerContent}>
              {composerStep === 'compose' ? (
                <View style={styles.postComposerComposeContent}>
                  <View style={styles.postComposerModeRow}>
                    <Text style={[styles.postComposerModeLabel, { color: c.textSecondary }]}>
                      {composerPostType === 'LP'
                        ? t('home.longPostModeActive', { defaultValue: 'Long post mode active' })
                        : t('home.shortPostModeActive', { defaultValue: 'Short post mode active' })}
                    </Text>
                    <TouchableOpacity
                      style={[styles.postComposerModeButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      activeOpacity={0.85}
                      onPress={switchToLongPostForm}
                    >
                      <MaterialCommunityIcons name="text-box-edit-outline" size={16} color={c.textSecondary} />
                      <Text style={[styles.postComposerModeButtonText, { color: c.textSecondary }]}>
                        {t('home.longPostSwitchToForm', { defaultValue: 'Switch to Long Post Form' })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    key={`composer-input-${composerInputKey}`}
                    style={[
                      styles.postComposerTextInput,
                      {
                        borderColor: c.inputBorder,
                        backgroundColor: c.inputBackground,
                        color: c.textPrimary,
                      },
                    ]}
                    placeholder={t('home.postComposerInputPlaceholder', {
                      defaultValue: "What's on your mind?",
                    })}
                    placeholderTextColor={c.placeholder}
                    defaultValue={composerTextRef.current}
                    onChangeText={(value) => {
                      composerTextRef.current = value;
                      setComposerTextLength(value.length);
                      if (composerPostType === 'LP') {
                        setComposerPostType('P');
                      }
                    }}
                    editable={!composerSubmitting && !composerDestinationsLoading}
                    multiline
                    textAlignVertical="top"
                    maxLength={SHORT_POST_MAX_LENGTH}
                  />
                  <View style={styles.postComposerCounterAndToolsRow}>
                    <View style={styles.postComposerToolbarInline}>
                      <TouchableOpacity
                        style={[styles.postComposerToolButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        activeOpacity={0.85}
                        disabled={composerSubmitting || !!composerVideo}
                        onPress={() => openComposerMediaPicker('image')}
                      >
                        <MaterialCommunityIcons name="image" size={18} color="#22c55e" />
                        <Text style={[styles.postComposerToolButtonText, { color: c.textSecondary }]}>
                          {t('home.postComposerImageAction', { defaultValue: 'Photos' })}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.postComposerToolButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        activeOpacity={0.85}
                        disabled={composerSubmitting || composerImages.length > 0}
                        onPress={() => openComposerMediaPicker('video')}
                      >
                        <MaterialCommunityIcons name="video" size={18} color="#ff2d55" />
                        <Text style={[styles.postComposerToolButtonText, { color: c.textSecondary }]}>
                          {t('home.postComposerVideoAction', { defaultValue: 'Video' })}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.postComposerCounterRow}>
                      <Text style={[styles.postComposerCounterText, { color: c.textMuted }]}>
                        {t('home.postComposerCharacterCounter', {
                          defaultValue: '{{count}}/{{max}} characters',
                          count: composerTextLength,
                          max: SHORT_POST_MAX_LENGTH,
                        })}
                      </Text>
                    </View>
                  </View>

                  {composerVideo ? (
                    <View style={[styles.postComposerPreviewWrap, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                      <View style={styles.postComposerVideoPreview}>
                        <MaterialCommunityIcons name="video" size={26} color={c.textSecondary} />
                        <Text numberOfLines={1} style={[styles.postComposerPreviewName, { color: c.textSecondary }]}>
                          {composerVideo.file.name || t('home.postComposerVideoLabel', { defaultValue: 'Video selected' })}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  {!composerVideo && composerImages.length > 0 ? (
                    <View style={[styles.postComposerPreviewWrap, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                      <View style={styles.postComposerImageGrid}>
                        {composerImages.map((image, index) => (
                          <View key={`composer-image-${index}`} style={styles.postComposerImageTile}>
                            {image.previewUri ? (
                              <Image
                                source={{ uri: image.previewUri }}
                                style={styles.postComposerImageTilePreview}
                                resizeMode="cover"
                              />
                            ) : (
                              <View style={styles.postComposerVideoPreview}>
                                <MaterialCommunityIcons name="image" size={22} color={c.textSecondary} />
                              </View>
                            )}
                            <TouchableOpacity
                              style={[styles.postComposerImageRemove, { backgroundColor: c.surface, borderColor: c.border }]}
                              activeOpacity={0.85}
                              disabled={composerSubmitting}
                              onPress={() => removeComposerImage(index)}
                            >
                              <MaterialCommunityIcons name="close" size={14} color={c.textSecondary} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {composerVideo || composerImages.length > 0 ? (
                    <View style={styles.postComposerToolbar}>
                      <TouchableOpacity
                        style={[styles.postComposerToolButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        activeOpacity={0.85}
                        disabled={composerSubmitting}
                        onPress={clearComposerMedia}
                      >
                        <MaterialCommunityIcons name="close-circle-outline" size={18} color={c.textSecondary} />
                        <Text style={[styles.postComposerToolButtonText, { color: c.textSecondary }]}>
                          {t('home.postComposerRemoveMediaAction', { defaultValue: 'Remove all media' })}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ) : (
                <ScrollView
                  style={styles.postComposerDestinationScroll}
                  contentContainerStyle={styles.postComposerDestinationScrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                <View style={styles.postComposerDestinationStepWrap}>
                  <Text style={[styles.postComposerDestinationTitle, { color: c.textPrimary }]}>
                    {t('home.postComposerDestinationTitle', { defaultValue: 'Choose where to publish' })}
                  </Text>
                  <Text style={[styles.postComposerDestinationBody, { color: c.textMuted }]}>
                    {t('home.postComposerDestinationBody', {
                      defaultValue: 'Select one circle or up to 3 joined communities.',
                    })}
                  </Text>

                  {composerDestinationsLoading ? (
                    <View style={styles.postComposerDestinationLoading}>
                      <ActivityIndicator color={c.primary} size="small" />
                    </View>
                  ) : (
                    <>
                      <Text style={[styles.postComposerDestinationSectionTitle, { color: c.textPrimary }]}>
                        {t('home.postComposerCircleOption', { defaultValue: 'Circle' })}
                      </Text>
                      <ScrollView
                        style={[styles.postComposerDestinationList, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        contentContainerStyle={styles.postComposerDestinationListContent}
                      >
                        <TouchableOpacity
                          key="composer-circle-public"
                          style={[
                            styles.postComposerDestinationItem,
                            {
                              borderColor: composerSelectedCircleId === null ? c.primary : c.border,
                              backgroundColor: composerSelectedCircleId === null ? `${c.primary}14` : c.surface,
                            },
                          ]}
                          activeOpacity={0.85}
                          onPress={() => setComposerSelectedCircleId(null)}
                        >
                          <MaterialCommunityIcons
                            name={composerSelectedCircleId === null ? 'radiobox-marked' : 'radiobox-blank'}
                            size={18}
                            color={composerSelectedCircleId === null ? c.primary : c.textMuted}
                          />
                          <View style={styles.postComposerDestinationItemMeta}>
                            <Text style={[styles.postComposerDestinationItemTitle, { color: c.textPrimary }]}>
                              {t('home.postComposerPublicDestinationTitle', { defaultValue: 'Public (no circle)' })}
                            </Text>
                            <Text style={[styles.postComposerDestinationItemSubtitle, { color: c.textMuted }]}>
                              {t('home.postComposerPublicDestinationSubtitle', {
                                defaultValue: 'Visible outside circles based on your profile privacy settings.',
                              })}
                            </Text>
                          </View>
                        </TouchableOpacity>

                        {composerCircles.map((circle) => {
                          const selected = composerSelectedCircleId === circle.id;
                          const circleColor = sanitizeCircleColor(circle.color);
                          return (
                            <TouchableOpacity
                              key={`composer-circle-${circle.id}`}
                              style={[
                                styles.postComposerDestinationItem,
                                {
                                  borderColor: selected ? c.primary : c.border,
                                  backgroundColor: selected ? `${c.primary}14` : c.surface,
                                },
                              ]}
                              activeOpacity={0.85}
                              onPress={() => setComposerSelectedCircleId(circle.id)}
                            >
                              <MaterialCommunityIcons
                                name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                                size={18}
                                color={selected ? c.primary : c.textMuted}
                              />
                              <View
                                style={[
                                  styles.postComposerCircleColorSwatch,
                                  { backgroundColor: circleColor || c.border },
                                ]}
                              />
                              <View style={styles.postComposerDestinationItemMeta}>
                                <Text style={[styles.postComposerDestinationItemTitle, { color: c.textPrimary }]}>
                                  {circle.name || t('home.postComposerCircleOption', { defaultValue: 'Circle' })}
                                </Text>
                                <Text style={[styles.postComposerDestinationItemSubtitle, { color: c.textMuted }]}>
                                  {t('home.postComposerCircleUsersCount', {
                                    count: circle.users_count || 0,
                                    defaultValue: '{{count}} members',
                                  })}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          );
                        })}

                        {composerCircles.length === 0 ? (
                          <Text style={[styles.postComposerDestinationEmptyText, { color: c.textMuted }]}>
                            {t('home.postComposerNoCircles', { defaultValue: 'No circles found.' })}
                          </Text>
                        ) : null}
                      </ScrollView>

                      <Text style={[styles.postComposerDestinationSectionTitle, { color: c.textPrimary }]}>
                        {t('home.postComposerCommunityOption', { defaultValue: 'Community' })}
                      </Text>
                      <View style={styles.postComposerDestinationCounterRow}>
                        <Text style={[styles.postComposerDestinationBody, { color: c.textMuted }]}>
                          {t('home.postComposerCommunitySelectHint', {
                            defaultValue: 'Select up to 3 communities.',
                          })}
                        </Text>
                        <Text style={[styles.postComposerDestinationCounterText, { color: c.textMuted }]}>
                          {`${composerSelectedCommunityNames.length}/3`}
                        </Text>
                      </View>

                      <TextInput
                        style={[
                          styles.postComposerDestinationSearchInput,
                          { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary },
                        ]}
                        placeholder={t('home.postComposerCommunitySearchPlaceholder', {
                          defaultValue: 'Search your communities',
                        })}
                        placeholderTextColor={c.placeholder}
                        value={composerCommunitySearch}
                        onChangeText={setComposerCommunitySearch}
                        editable={!composerSubmitting}
                      />

                      <ScrollView
                        style={[styles.postComposerDestinationList, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        contentContainerStyle={styles.postComposerDestinationListContent}
                      >
                        {filteredComposerJoinedCommunities.map((community) => {
                          const selected = !!community.name && composerSelectedCommunityNames.includes(community.name);
                          const communityInitial = (community.title || community.name || 'C').slice(0, 1).toUpperCase();
                          return (
                            <TouchableOpacity
                              key={`composer-community-${community.id}`}
                              style={[
                                styles.postComposerDestinationItem,
                                {
                                  borderColor: selected ? c.primary : c.border,
                                  backgroundColor: selected ? `${c.primary}14` : c.surface,
                                },
                              ]}
                              activeOpacity={0.85}
                              onPress={() => {
                                const targetName = community.name || '';
                                if (!targetName) return;
                                setComposerSelectedCommunityNames((prev) => {
                                  if (prev.includes(targetName)) {
                                    return prev.filter((name) => name !== targetName);
                                  }
                                  if (prev.length >= 3) {
                                    setError(
                                      t('home.postComposerCommunityLimitReached', {
                                        defaultValue: 'You can select up to 3 communities.',
                                      })
                                    );
                                    return prev;
                                  }
                                  return [...prev, targetName];
                                });
                              }}
                            >
                              <MaterialCommunityIcons
                                name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                                size={18}
                                color={selected ? c.primary : c.textMuted}
                              />
                              <View style={[styles.postComposerCommunityAvatar, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                                {community.avatar ? (
                                  <Image
                                    source={{ uri: community.avatar }}
                                    style={styles.postComposerCommunityAvatarImage}
                                    resizeMode="cover"
                                  />
                                ) : (
                                  <Text style={[styles.postComposerCommunityAvatarLetter, { color: c.textSecondary }]}>
                                    {communityInitial}
                                  </Text>
                                )}
                              </View>
                              <View style={styles.postComposerDestinationItemMeta}>
                                <Text style={[styles.postComposerDestinationItemTitle, { color: c.textPrimary }]}>
                                  {community.title || (community.name ? `c/${community.name}` : t('home.postComposerCommunityOption', { defaultValue: 'Community' }))}
                                </Text>
                                <Text style={[styles.postComposerDestinationItemSubtitle, { color: c.textMuted }]}>
                                  {community.name ? `c/${community.name}` : ''}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          );
                        })}

                        {filteredComposerJoinedCommunities.length === 0 ? (
                          <Text style={[styles.postComposerDestinationEmptyText, { color: c.textMuted }]}>
                            {composerCommunitySearchTrimmed
                              ? t('home.postComposerNoMatchingCommunities', { defaultValue: 'No matching communities found.' })
                              : t('home.postComposerNoJoinedCommunities', { defaultValue: 'No joined communities found.' })}
                          </Text>
                        ) : null}
                      </ScrollView>
                    </>
                  )}
                </View>
                </ScrollView>
              )}
              </View>

              <View style={styles.postComposerActions}>
                {composerStep === 'compose' && composerPostType === 'LP' ? (
                  <>
                    <TouchableOpacity
                      style={[styles.externalLinkCancelButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      onPress={() => void submitComposerPost({ saveAsDraft: true })}
                      activeOpacity={0.85}
                      disabled={composerSubmitting || composerDestinationsLoading}
                    >
                      <Text style={[styles.externalLinkCancelButtonText, { color: c.textSecondary }]}>
                        {t('home.postComposerDraftAction', { defaultValue: 'Save as Draft' })}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.externalLinkContinueButton, { backgroundColor: c.primary }]}
                      onPress={() => void goToComposerDestinationStep()}
                      activeOpacity={0.85}
                      disabled={composerSubmitting || composerDestinationsLoading}
                    >
                      {composerSubmitting || composerDestinationsLoading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.externalLinkContinueButtonText}>
                          {t('home.postComposerSaveAndPublishAction', { defaultValue: 'Save and Publish' })}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                <TouchableOpacity
                  style={[styles.externalLinkCancelButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={composerStep === 'destination' ? () => setComposerStep('compose') : closeComposerModal}
                  activeOpacity={0.85}
                  disabled={composerSubmitting || composerDestinationsLoading}
                >
                  <Text style={[styles.externalLinkCancelButtonText, { color: c.textSecondary }]}>
                    {composerStep === 'destination'
                      ? t('home.backAction', { defaultValue: 'Back' })
                      : t('home.cancelAction')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.externalLinkContinueButton, { backgroundColor: c.primary }]}
                  onPress={() => void submitComposerPost()}
                  activeOpacity={0.85}
                  disabled={composerSubmitting || composerDestinationsLoading}
                >
                  {composerSubmitting || composerDestinationsLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.externalLinkContinueButtonText}>
                      {composerStep === 'compose'
                        ? t('home.nextAction', { defaultValue: 'Next' })
                        : t('home.postComposerPublishAction', { defaultValue: 'Publish' })}
                    </Text>
                  )}
                </TouchableOpacity>
                  </>
                )}
              </View>
            </Animated.View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <PostDetailModal
        styles={styles}
        c={c}
        t={t}
        visible={!!activePost || postRouteLoading}
        postRouteLoading={postRouteLoading}
        activePost={activePost}
        hasActivePostMedia={hasActivePostMedia}
        currentUsername={user?.username}
        currentUserAvatar={user?.profile?.avatar}
        localComments={localComments}
        commentRepliesById={commentRepliesById}
        commentRepliesExpanded={commentRepliesExpanded}
        commentRepliesLoadingById={commentRepliesLoadingById}
        draftComments={draftComments}
        draftReplies={draftReplies}
        commentEditDrafts={commentEditDrafts}
        replyEditDrafts={replyEditDrafts}
        editingCommentById={editingCommentById}
        editingReplyById={editingReplyById}
        commentMutationLoadingById={commentMutationLoadingById}
        reactionGroups={reactionGroups}
        reactionPickerLoading={reactionPickerLoading}
        reactionActionLoading={reactionActionLoading}
        getPostText={getPostText}
        getPostReactionCount={getPostReactionCount}
        getPostCommentsCount={getPostCommentsCount}
        onClose={closePostDetail}
        onLoadReactionList={loadReactionListInline}
        onEnsureReactionGroups={ensureReactionGroups}
        onReactToPostWithEmoji={reactToPostWithEmoji}
        onReactToComment={reactToComment}
        onToggleCommentReplies={toggleCommentReplies}
        onSharePost={handleSharePost}
        onOpenLink={openLink}
        onUpdateDraftComment={updateDraftComment}
        onUpdateDraftReply={updateDraftReply}
        onStartEditingComment={startEditingComment}
        onCancelEditingComment={cancelEditingComment}
        onUpdateEditCommentDraft={updateEditCommentDraft}
        onSaveEditedComment={saveEditedComment}
        onDeleteComment={deleteComment}
        onSubmitComment={submitComment}
        onSubmitReply={submitReply}
        onNavigateProfile={handleNavigateProfileFromPostDetail}
        reactionListOpen={reactionListOpen}
        reactionListLoading={reactionListLoading}
        reactionListEmoji={reactionListEmoji}
        reactionListUsers={reactionListUsers}
        onCloseReactionList={closeReactionList}
      />

      <LongPostDrawer
        visible={longPostDrawerOpen}
        expanded={longPostDrawerExpanded}
        blocks={composerLongPostBlocks}
        draftExpiryDays={composerDraftExpiryDays}
        draftSaving={composerDraftSaving}
        draftSavedAtLabel={
          composerDraftSavedAt
            ? t('home.longPostDraftSavedAt', {
              defaultValue: 'Last saved {{time}}',
              time: new Date(composerDraftSavedAt).toLocaleTimeString(),
            })
            : null
        }
        onChangeBlocks={(value) => {
          setComposerLongPostBlocks(value);
          setComposerPostType('LP');
        }}
        onChangeDraftExpiryDays={setComposerDraftExpiryDays}
        onSaveDraft={() => {
          void saveLongPostDraft(true);
        }}
        onOpenDrafts={openLongPostDraftsDrawer}
        onClose={() => setLongPostDrawerOpen(false)}
        onApply={() => {
          void openComposerDestinationFromLongPost();
        }}
        onToggleExpanded={() => setLongPostDrawerExpanded((prev) => !prev)}
      />

      <LongPostDrawer
        visible={longPostEditDrawerOpen}
        expanded={longPostEditDrawerExpanded}
        blocks={longPostEditBlocks}
        draftExpiryDays={0}
        onChangeBlocks={setLongPostEditBlocks}
        onChangeDraftExpiryDays={() => {}}
        onSaveDraft={() => {}}
        onOpenDrafts={() => {}}
        errorMessage={longPostEditError}
        onClose={() => {
          setLongPostEditDrawerOpen(false);
          setEditingLongPost(null);
          setLongPostEditError('');
        }}
        onApply={() => { setLongPostEditError(''); void saveLongPostEdit(); }}
        onToggleExpanded={() => setLongPostEditDrawerExpanded((prev) => !prev)}
      />

      <Modal
        visible={composerDraftsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setComposerDraftsOpen(false)}
      >
        <TouchableOpacity
          style={styles.postComposerModalBackdrop}
          activeOpacity={1}
          onPress={() => setComposerDraftsOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.postComposerModalCard,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  width: Math.min(560, composerDrawerWidth),
                },
              ]}
            >
              <View style={styles.linkedModalHeader}>
                <Text style={[styles.linkedTitle, { color: c.textPrimary }]}>
                  {t('home.longPostDraftsTitle', { defaultValue: 'Long post drafts' })}
                </Text>
                <TouchableOpacity
                  style={[styles.topNavUtility, { backgroundColor: c.inputBackground }]}
                  onPress={() => setComposerDraftsOpen(false)}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              {composerDraftsLoading ? (
                <View style={styles.postComposerDraftsLoading}>
                  <ActivityIndicator color={c.primary} size="small" />
                </View>
              ) : (
                <ScrollView style={styles.postComposerDraftsList} contentContainerStyle={styles.postComposerDraftsListContent}>
                  {composerDrafts.map((draft) => (
                    <View
                      key={`lp-draft-${draft.uuid || draft.id}`}
                      style={[styles.postComposerDraftItem, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    >
                      <View style={styles.postComposerDraftItemMeta}>
                        <Text numberOfLines={2} style={[styles.postComposerDraftItemTitle, { color: c.textPrimary }]}>
                          {extractPlainTextFromBlocks((draft.long_text_blocks as LongPostBlock[]) || []).slice(0, 120)
                            || draft.long_text
                            || t('home.longPostDraftUntitled', { defaultValue: 'Untitled long post draft' })}
                        </Text>
                        <Text style={[styles.postComposerDraftItemSubtitle, { color: c.textMuted }]}>
                          {[
                            draft.created
                              ? t('home.longPostDraftCreatedAt', {
                                defaultValue: 'Created {{date}}',
                                date: new Date(draft.created).toLocaleString(),
                              })
                              : null,
                            draft.draft_expires_at
                              ? t('home.longPostDraftExpiresAt', {
                                defaultValue: 'Expires {{date}}',
                                date: new Date(draft.draft_expires_at).toLocaleString(),
                              })
                              : null,
                          ].filter(Boolean).join(' • ')}
                        </Text>
                      </View>
                      <View style={styles.postComposerDraftItemActions}>
                        <TouchableOpacity
                          style={[styles.externalLinkCancelButton, { borderColor: c.border, backgroundColor: c.surface }]}
                          activeOpacity={0.85}
                          disabled={composerDraftDeleteUuid === draft.uuid}
                          onPress={() => void deleteLongPostDraft(draft.uuid)}
                        >
                          <Text style={[styles.externalLinkCancelButtonText, { color: c.textSecondary }]}>
                            {t('home.deleteAction', { defaultValue: 'Delete' })}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.externalLinkContinueButton, { backgroundColor: c.primary }]}
                          activeOpacity={0.85}
                          onPress={() => void resumeLongPostDraft(draft)}
                        >
                          <Text style={styles.externalLinkContinueButtonText}>
                            {t('home.resumeAction', { defaultValue: 'Resume' })}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                  {composerDrafts.length === 0 ? (
                    <Text style={[styles.postComposerDestinationEmptyText, { color: c.textMuted }]}>
                      {t('home.longPostDraftsEmpty', { defaultValue: 'No saved long post drafts yet.' })}
                    </Text>
                  ) : null}
                </ScrollView>
              )}
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
                              onPress={() => void reactToPostWithEmoji(reactionPickerPost as FeedPost, emoji.id)}
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
        visible={reactionListOpen && !(!!activePost || postRouteLoading)}
        transparent
        animationType="fade"
        onRequestClose={closeReactionList}
      >
        <TouchableOpacity style={styles.reactionListBackdrop} activeOpacity={1} onPress={closeReactionList}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.reactionListCard,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  height: reactionListModalHeight,
                },
              ]}
            >
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

              {reactionListPost?.reactions_emoji_counts?.length ? (
                <View style={styles.reactionSummaryWrap}>
                  <TouchableOpacity
                    style={[
                      styles.reactionSummaryChip,
                      {
                        borderColor: c.border,
                        backgroundColor: !reactionListEmoji?.id ? c.surface : c.inputBackground,
                      },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => void openReactionList(reactionListPost)}
                  >
                    <Text style={[styles.reactionSummaryCount, { color: c.textSecondary }]}>
                      {t('home.profileTabAll')}
                    </Text>
                  </TouchableOpacity>
                  {(reactionListPost.reactions_emoji_counts || [])
                    .filter((entry) => (entry?.count || 0) > 0)
                    .map((entry, idx) => (
                      <TouchableOpacity
                        key={`feed-reaction-filter-${reactionListPost.id}-${entry.emoji?.id || idx}`}
                        style={[
                          styles.reactionSummaryChip,
                          {
                            borderColor: c.border,
                            backgroundColor: reactionListEmoji?.id === entry.emoji?.id ? c.surface : c.inputBackground,
                          },
                        ]}
                        activeOpacity={0.85}
                        onPress={() => void openReactionList(reactionListPost, entry.emoji)}
                      >
                        {entry.emoji?.image ? (
                          <Image source={{ uri: entry.emoji.image }} style={styles.reactionSummaryEmojiImage} resizeMode="contain" />
                        ) : (
                          <MaterialCommunityIcons name="emoticon-outline" size={14} color={c.textSecondary} />
                        )}
                        <Text style={[styles.reactionSummaryCount, { color: c.textSecondary }]}>{entry.count || 0}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
              ) : null}

              <View style={styles.reactionListContent}>
                {reactionListLoading ? (
                  <View style={styles.reactionListState}>
                    <ActivityIndicator color={c.primary} size="small" />
                  </View>
                ) : reactionListUsers.length === 0 ? (
                  <View style={styles.reactionListState}>
                    <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>{t('home.reactionReactorsEmpty')}</Text>
                  </View>
                ) : (
                  <ScrollView style={styles.reactionListScroll} contentContainerStyle={styles.reactionListScrollContent}>
                    {reactionListUsers.map((item, idx) => (
                      <TouchableOpacity
                        key={`reaction-user-${item.id || idx}`}
                        style={[styles.reactionUserRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                        activeOpacity={0.85}
                        onPress={() => {
                          const username = item.reactor?.username;
                          if (!username) return;
                          closeReactionList();
                          onNavigate({ screen: 'profile', username });
                        }}
                      >
                        <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}>
                          {item.reactor?.profile?.avatar || item.reactor?.avatar ? (
                            <Image
                              source={{ uri: item.reactor?.profile?.avatar || item.reactor?.avatar || '' }}
                              style={styles.feedAvatarImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <Text style={styles.feedAvatarLetter}>
                              {(item.reactor?.username?.[0] || 'O').toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <View style={styles.feedHeaderMeta}>
                          <Text style={[styles.feedAuthor, { color: c.textPrimary }]}>
                            @{item.reactor?.username || t('home.unknownUser')}
                          </Text>
                          <Text style={[styles.feedDate, { color: c.textMuted }]}>
                            {item.created ? new Date(item.created).toLocaleString() : ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
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

      <ScrollView
        ref={mainScrollRef}
        contentContainerStyle={styles.rootContent}
        scrollEventThrottle={200}
        onScroll={({ nativeEvent }) => {
          // Native (iOS/Android) scroll handling — web uses the DOM listener above
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 400;
          if (nearBottom && feedHasMore && !feedLoadingMore && !feedLoading) {
            void loadMoreFeed();
          }
        }}
      >
        {loading ? (
          <ActivityIndicator color={c.primary} size="large" />
        ) : (
          <>
            {displayRoute.screen === 'me' ? (
              <MyProfileScreen
                styles={styles}
                c={c}
                t={t}
                user={user}
                profileRouteUsername={profileRouteUsername}
                isCompactProfileLayout={isCompactProfileLayout}
                profileTabs={profileTabs}
                profileActiveTab={profileActiveTab}
                onSetProfileActiveTab={setProfileActiveTab}
                myProfilePosts={myProfilePosts}
                myProfilePostsLoading={myProfilePostsLoading}
                myPinnedPosts={myPinnedPosts}
                myPinnedPostsLoading={myPinnedPostsLoading}
                myJoinedCommunities={myJoinedCommunities}
                myJoinedCommunitiesLoading={myJoinedCommunitiesLoading}
                myJoinedCommunitiesLoadingMore={myJoinedCommunitiesLoadingMore}
                myJoinedCommunitiesHasMore={myJoinedCommunitiesHasMore}
                onLoadMoreJoinedCommunities={loadMoreMyJoinedCommunities}
                onOpenCommunity={(name: string) => onNavigate({ screen: 'community', name })}
                myFollowings={myFollowings}
                myFollowingsLoading={myFollowingsLoading}
                myFollowingsLoadingMore={myFollowingsLoadingMore}
                myFollowingsHasMore={myFollowingsHasMore}
                onLoadMoreFollowings={loadMoreMyFollowings}
                onOpenProfile={(username: string) => onNavigate({ screen: 'profile', username })}
                onUpdateProfile={updateMyProfile}
                onUpdateProfileMedia={updateMyProfileMedia}
                onNotice={setNotice}
                renderPostCard={(post, variant) => renderPostCard(post, variant, myPinnedPosts)}
                isOwnProfile
                isProfileLoading={false}
              />
            ) : null}

            {displayRoute.screen === 'profile' ? (
              <PublicProfileScreen
                styles={styles}
                c={c}
                t={t}
                user={profileUserLoading ? { username: profileRouteUsername, profile: {} } : (profileUser || { username: profileRouteUsername, profile: {} })}
                profileRouteUsername={profileRouteUsername}
                isCompactProfileLayout={isCompactProfileLayout}
                profileTabs={profileTabs}
                profileActiveTab={profileActiveTab}
                onSetProfileActiveTab={setProfileActiveTab}
                myProfilePosts={profilePosts}
                myProfilePostsLoading={profilePostsLoading}
                myPinnedPosts={profilePinnedPosts}
                myPinnedPostsLoading={profilePinnedPostsLoading}
                myJoinedCommunities={profileJoinedCommunities}
                myJoinedCommunitiesLoading={profileJoinedCommunitiesLoading}
                myJoinedCommunitiesLoadingMore={profileJoinedCommunitiesLoadingMore}
                myJoinedCommunitiesHasMore={profileJoinedCommunitiesHasMore}
                onLoadMoreJoinedCommunities={loadMoreProfileJoinedCommunities}
                onOpenCommunity={(name: string) => onNavigate({ screen: 'community', name })}
                myFollowings={profileFollowings}
                myFollowingsLoading={profileFollowingsLoading}
                myFollowingsLoadingMore={profileFollowingsLoadingMore}
                myFollowingsHasMore={profileFollowingsHasMore}
                onLoadMoreFollowings={loadMoreProfileFollowings}
                onOpenProfile={(username: string) => onNavigate({ screen: 'profile', username })}
                onUpdateProfile={updateMyProfile}
                onUpdateProfileMedia={updateMyProfileMedia}
                onNotice={setNotice}
                renderPostCard={(post, variant) => renderPostCard(post, variant, profilePinnedPosts)}
                isProfileLoading={profileUserLoading}
              />
            ) : null}

            {viewingCommunityRoute ? (
              <CommunityProfileScreen
                styles={styles}
                c={c}
                t={t}
                community={communityInfo}
                communityLoading={communityInfoLoading}
                communityOwner={communityOwner}
                communityMembers={communityMembers}
                communityMembersLoading={communityMembersLoading}
                posts={communityRoutePosts}
                postsLoading={communityRouteLoading}
                postsError={communityRouteError}
                isJoined={!!(communityInfo?.memberships?.length)}
                joinLoading={communityJoinLoading}
                onJoin={() => void handleJoinCommunity()}
                onLeave={() => void handleLeaveCommunity()}
                onOpenProfile={(username) => onNavigate({ screen: 'profile', username })}
                renderPostCard={renderPostCard}
              />
            ) : null}

            {viewingHashtagRoute ? (
              <RouteSummaryCard
                styles={styles}
                c={c}
                title={`#${hashtagRouteName}`}
                subtitle={t('home.hashtagRouteLabel', { hashtag: hashtagRouteName })}
              />
            ) : null}

            {showingMainSearchResults ? (
              <SearchResultsScreen
                styles={styles}
                c={c}
                t={t}
                isWideSearchResultsLayout={isWideSearchResultsLayout}
                searchResultsQuery={searchResultsQuery}
                searchResultsLoading={searchResultsLoading}
                searchError={searchError}
                searchUsers={searchUsers}
                searchCommunities={searchCommunities}
                searchHashtags={searchHashtags}
                hasAnySearchResults={hasAnySearchResults}
                onBack={handleBackToHomeFeed}
                onSelectUser={handleSelectSearchUser}
                onSelectCommunity={handleSelectSearchCommunity}
                onSelectHashtag={handleSelectSearchHashtag}
              />
            ) : null}

            {!viewingProfileRoute && !viewingCommunityRoute && !viewingHashtagRoute && !showingMainSearchResults ? (
              <FeedScreen
                styles={styles}
                c={c}
                t={t}
                user={user}
                onComposerPress={() => openComposerModal()}
                onComposerActionPress={(action) => openComposerModal(action)}
                feedLoading={feedLoading}
                feedError={feedError}
                feedPosts={feedPosts}
                activeFeed={activeFeed}
                feedLoadingMore={feedLoadingMore}
                feedHasMore={feedHasMore}
                renderPostCard={renderPostCard}
              />
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

      <NotificationDrawer
        visible={notifDrawerOpen}
        c={c}
        t={t}
        notifications={notifications}
        loading={notifLoading}
        loadingMore={notifLoadingMore}
        hasMore={notifHasMore}
        unreadCount={unreadCount}
        onClose={() => setNotifDrawerOpen(false)}
        onLoadMore={() => void handleLoadMoreNotifications()}
        onMarkAllRead={() => void handleMarkAllRead()}
        onMarkRead={(id) => void handleMarkRead(id)}
        onDeleteNotification={(id) => void handleDeleteNotification(id)}
        onDeleteAll={() => void handleDeleteAllNotifications()}
        onNavigateProfile={handleNotificationNavigateProfile}
        onNavigatePost={handleNotificationNavigatePost}
        onNavigateCommunity={handleNotificationNavigateCommunity}
      />
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
  postComposerModalCard: {
    height: '100%',
    borderWidth: 1,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    padding: 14,
    gap: 12,
    overflow: 'hidden',
  },
  postComposerContent: {
    flex: 1,
    minHeight: 0,
  },
  postComposerComposeContent: {
    flex: 1,
    paddingBottom: 6,
    gap: 10,
  },
  postComposerModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  postComposerModeLabel: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  postComposerModeButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  postComposerModeButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  postComposerDestinationScroll: {
    flex: 1,
  },
  postComposerDestinationScrollContent: {
    paddingBottom: 6,
  },
  postComposerTextInput: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 174,
    maxHeight: 360,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 22,
  },
  postComposerCounterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 0,
  },
  postComposerCounterAndToolsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 0,
  },
  postComposerToolbarInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    flex: 1,
  },
  postComposerCounterText: {
    fontSize: 12,
    fontWeight: '600',
  },
  postComposerPreviewWrap: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 90,
    maxHeight: 280,
  },
  postComposerPreviewImage: {
    width: '100%',
    height: 220,
  },
  postComposerVideoPreview: {
    minHeight: 90,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postComposerPreviewName: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  postComposerImageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 10,
  },
  postComposerImageTile: {
    width: 92,
    height: 92,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  postComposerImageTilePreview: {
    width: '100%',
    height: '100%',
  },
  postComposerImageRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postComposerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  postComposerToolButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  postComposerToolButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  postComposerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
    paddingTop: 10,
  },
  postComposerDestinationStepWrap: {
    gap: 10,
  },
  postComposerDestinationTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  postComposerDestinationBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  postComposerDestinationCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  postComposerDestinationCounterText: {
    fontSize: 12,
    fontWeight: '700',
  },
  postComposerDestinationSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  postComposerDestinationTypeTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  postComposerDestinationTypeTab: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
  },
  postComposerDestinationTypeTabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  postComposerDestinationLoading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postComposerDestinationSearchInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  postComposerDestinationList: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 140,
    maxHeight: 260,
  },
  postComposerDestinationListContent: {
    padding: 10,
    gap: 8,
  },
  postComposerDestinationItem: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postComposerCircleColorSwatch: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  postComposerCommunityAvatar: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postComposerCommunityAvatarImage: {
    width: '100%',
    height: '100%',
  },
  postComposerCommunityAvatarLetter: {
    fontSize: 12,
    fontWeight: '700',
  },
  postComposerDestinationItemMeta: {
    flex: 1,
  },
  postComposerDestinationItemTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  postComposerDestinationItemSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  postComposerDestinationEmptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  postComposerDraftsLoading: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postComposerDraftsList: {
    flex: 1,
  },
  postComposerDraftsListContent: {
    paddingBottom: 6,
    gap: 8,
  },
  postComposerDraftItem: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  postComposerDraftItemMeta: {
    gap: 4,
  },
  postComposerDraftItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  postComposerDraftItemSubtitle: {
    fontSize: 12,
  },
  postComposerDraftItemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
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
    zIndex: 2300,
    elevation: 24,
  },
  reactionPickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 2200,
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
    width: 620,
    maxWidth: '94%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    overflow: 'hidden',
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
  reactionListState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    position: 'relative',
  },
  postDetailMedia: {
    width: '100%',
    height: '100%',
    maxWidth: 980,
    maxHeight: 900,
  },
  postDetailMediaNavButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  postDetailMediaNavButtonLeft: {
    left: 16,
  },
  postDetailMediaNavButtonRight: {
    right: 16,
  },
  postDetailMediaCounter: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    zIndex: 4,
  },
  postDetailMediaCounterText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  postDetailMediaThumbStrip: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 4,
    paddingRight: 20,
  },
  postDetailMediaThumbButton: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  postDetailMediaThumbButtonActive: {
    borderColor: '#3B82F6',
  },
  postDetailMediaThumbImage: {
    width: '100%',
    height: '100%',
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
  feedComposerCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  feedComposerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  feedComposerInputMock: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  feedComposerInputText: {
    fontSize: 20,
    fontWeight: '500',
  },
  feedComposerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedComposerActionButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePageCard: {
    width: '100%',
    maxWidth: 1220,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  profileCoverWrap: {
    width: '100%',
    height: 360,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  profileCoverImage: {
    width: '100%',
    height: '100%',
  },
  profileCoverFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCoverAction: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 170,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  profileCoverActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
  profileIdentityRow: {
    marginTop: -34,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 20,
    flexWrap: 'wrap',
  },
  profileIdentityRowCompact: {
    marginTop: -22,
    alignItems: 'flex-start',
  },
  profileIdentityLeft: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    minWidth: 320,
    flex: 1,
  },
  profileIdentityLeftCompact: {
    minWidth: 0,
    alignItems: 'center',
    width: '100%',
  },
  profileAvatarWrap: {
    width: 180,
    height: 180,
    borderRadius: 999,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarActionWrap: {
    position: 'relative',
    width: 180,
    height: 214,
    alignItems: 'center',
  },
  profileAvatarImage: {
    width: '100%',
    height: '100%',
  },
  profileAvatarEditAction: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    zIndex: 10,
    elevation: 10,
  },
  profileAvatarEditActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  profileAvatarLetter: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '800',
    lineHeight: 58,
  },
  profileIdentityMeta: {
    gap: 6,
    paddingBottom: 14,
  },
  profileDisplayNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  profileNameCountsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 4,
  },
  profileDisplayName: {
    fontSize: 48,
    fontWeight: '800',
    lineHeight: 54,
  },
  profileDisplayNameCompact: {
    fontSize: 34,
    lineHeight: 40,
    textAlign: 'center',
  },
  profileMetaText: {
    fontSize: 21,
    fontWeight: '600',
  },
  profileMetaCountText: {
    fontSize: 16,
    fontWeight: '700',
  },
  profileVerifiedBadge: {
    transform: [{ translateY: 2 }],
  },
  profileMetaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  profileIdentityActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 22,
  },
  profileIdentityActionsCompact: {
    width: '100%',
    paddingBottom: 12,
    justifyContent: 'flex-start',
  },
  profilePrimaryBtn: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profilePrimaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  profileSecondaryBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileSecondaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  profileHandle: {
    fontSize: 16,
    fontWeight: '500',
  },
  profileCountLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  profileFollowButton: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileFollowButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  profileInfoCard: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  profileInfoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  profileInfoCardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  profileInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileInfoValue: {
    fontSize: 14,
    lineHeight: 20,
  },
  profilePageSection: {
    marginTop: 20,
    marginBottom: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  profilePageSectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  profileEditModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  profileEditModalCard: {
    width: 760,
    maxWidth: '96%',
    maxHeight: '90%',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  profileEditModalScroll: {
    maxHeight: 620,
  },
  profileEditModalScrollContent: {
    padding: 14,
    gap: 10,
  },
  profileEditOptionRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileEditOptionRowSelected: {
    borderWidth: 2,
  },
  profileEditOptionIcon: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditOptionTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  profileEditOptionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  profileEditOptionSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  profileEditDetailsGroup: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  profileEditMediaWrap: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 4,
  },
  profileEditCoverPreview: {
    width: '100%',
    height: 170,
    borderBottomWidth: 1,
    position: 'relative',
  },
  profileEditCoverImage: {
    width: '100%',
    height: '100%',
  },
  profileEditCoverFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditCoverActions: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileEditAvatarPreview: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    width: 108,
    height: 108,
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
  },
  profileEditAvatarImage: {
    width: '100%',
    height: '100%',
  },
  profileEditAvatarFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditAvatarFallbackLetter: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 38,
  },
  profileEditAvatarActions: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    flexDirection: 'column',
    gap: 6,
  },
  profileEditMediaAction: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditField: {
    gap: 6,
  },
  profileEditFieldLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  profileEditInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    fontWeight: '600',
  },
  profileEditTextarea: {
    minHeight: 196,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  profileEditVisibilitySection: {
    marginTop: 2,
    gap: 10,
  },
  profileEditVisibilityHeading: {
    fontSize: 16,
    fontWeight: '800',
    paddingHorizontal: 2,
  },
  profileEditVisibilityCheckWrap: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditModalActions: {
    borderTopWidth: 1,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  profileEditModalButton: {
    minWidth: 120,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  profileEditModalButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  profileEditModalButtonTextPrimary: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  profileAvatarOptionsCard: {
    width: 420,
    maxWidth: '94%',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  profileAvatarOptionsTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 2,
  },
  profileAvatarOptionsAction: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileAvatarOptionsActionText: {
    fontSize: 15,
    fontWeight: '700',
  },
  profileAvatarOptionsCancel: {
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    marginTop: 2,
  },
  profileAvatarOptionsCancelText: {
    fontSize: 14,
    fontWeight: '700',
  },
  profileAvatarEditorCard: {
    width: 520,
    maxWidth: '95%',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  profileCoverEditorCard: {
    width: 820,
    maxWidth: '96%',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  profileCoverEditorPreview: {
    width: '94%',
    aspectRatio: 3,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  profileCoverEditorImage: {
    width: '100%',
    height: '100%',
  },
  profileAvatarEditorPreview: {
    width: 280,
    height: 280,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  profileAvatarEditorImage: {
    width: '100%',
    height: '100%',
  },
  profileAvatarEditorControls: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 8,
  },
  profileAvatarControlLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  profileAvatarControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  profileAvatarControlBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarControlValue: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 56,
    textAlign: 'center',
  },
  profileAvatarPositionPad: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  profileAvatarPositionMid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileAvatarSwitchRow: {
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  profileTabsRow: {
    marginTop: 12,
    borderTopWidth: 1,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  profileTabBtn: {
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  profileTabText: {
    fontSize: 16,
    fontWeight: '700',
  },
  profileBodyLayout: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    flexWrap: 'wrap',
  },
  profileBodyLayoutCompact: {
    flexDirection: 'column',
  },
  profileBodyLeft: {
    width: 430,
    flexShrink: 0,
    maxWidth: '100%',
  },
  profileBodyLeftCompact: {
    width: '100%',
  },
  profileBodyRight: {
    flex: 1,
    minWidth: 340,
    gap: 14,
  },
  profileBodyRightCompact: {
    minWidth: 0,
    width: '100%',
  },
  profileDetailCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  profileDetailTitle: {
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 12,
  },
  profileSectionTitleText: {
    marginBottom: 0,
  },
  profileSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  profileDetailList: {
    gap: 10,
  },
  profileDetailItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  profileDetailText: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  profileDetailTextWebWrap: {
    overflow: 'hidden',
    wordBreak: 'break-word',
  } as any,
  profileComposerCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  profileComposerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileComposerInputMock: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  profileComposerInputText: {
    fontSize: 16,
    fontWeight: '600',
  },
  profilePostsCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  profileCommunitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  profileCommunityTile: {
    width: '30.5%',
    minWidth: 92,
    maxWidth: 140,
    alignItems: 'center',
    gap: 8,
  },
  profileCommunityAvatarWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCommunityAvatar: {
    width: '100%',
    height: '100%',
  },
  profileCommunityAvatarFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCommunityAvatarLetter: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
  },
  profileCommunityName: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  profileShowMoreJoinedBtn: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileShowMoreJoinedText: {
    fontSize: 14,
    fontWeight: '700',
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
    overflow: 'hidden',
  },
  feedAvatarImage: {
    width: '100%',
    height: '100%',
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
  postActionMenuWrap: {
    position: 'relative',
    zIndex: 1400,
    elevation: 1400,
  },
  postActionMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  postActionMenuModalCard: {
    width: 220,
    maxWidth: '92%',
    borderWidth: 1,
    borderRadius: 12,
    zIndex: 100,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
    overflow: 'hidden',
  },
  postActionMenuCard: {
    position: 'absolute',
    top: 36,
    right: 0,
    width: 240,
    minWidth: 240,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    zIndex: 1500,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1500,
    overflow: 'visible',
  },
  postActionMenuTiles: {
    width: '100%',
    alignItems: 'stretch',
    gap: 10,
  },
  postActionMenuItem: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  postActionMenuItemText: {
    fontSize: 14,
    fontWeight: '700',
  },
  postActionMenuDivider: {
    height: 1,
    width: '100%',
  },
  feedPostHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    position: 'relative',
    zIndex: 1600,
    overflow: 'visible',
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
  longPostBlockList: {
    gap: 10,
  },
  longPostParagraph: {
    marginBottom: 4,
  },
  longPostHeading: {
    fontWeight: '800',
    letterSpacing: 0.2,
    marginTop: 2,
  },
  longPostHeadingH1: {
    fontSize: 26,
    lineHeight: 32,
    marginBottom: 4,
  },
  longPostHeadingH2: {
    fontSize: 22,
    lineHeight: 28,
    marginBottom: 3,
  },
  longPostHeadingH3: {
    fontSize: 18,
    lineHeight: 24,
    marginBottom: 2,
  },
  longPostQuoteWrap: {
    borderLeftWidth: 3,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 2,
  },
  longPostQuoteText: {
    fontSize: 15,
    lineHeight: 22,
    fontStyle: 'italic',
  },
  longPostImageWrap: {
    marginVertical: 4,
    overflow: 'hidden',
    borderRadius: 12,
  },
  longPostImage: {
    width: '100%',
    minHeight: 220,
    maxHeight: 460,
    borderRadius: 12,
  },
  longPostCaption: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  longPostEmbedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginVertical: 2,
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  longPostEmbedText: {
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 320,
  },
  postInlineEditWrap: {
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  postInlineEditInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 280,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
    fontSize: 14,
    lineHeight: 20,
  },
  postInlineEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  postEditModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  postEditModalCard: {
    width: 780,
    maxWidth: '96%',
    minHeight: 420,
    maxHeight: '86%',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  postEditModalBody: {
    fontSize: 15,
    lineHeight: 22,
  },
  postMetaRow: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  postPinnedBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  postPinnedBadgeText: {
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
  feedMediaGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  feedMediaGridItem: {
    width: '49.1%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  feedMediaGridImage: {
    width: '100%',
    height: '100%',
  },
  feedMediaGridMoreOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  feedMediaGridMoreText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
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
  detailPanelTabsRow: {
    marginTop: 10,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  },
  detailPanelTabButton: {
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailPanelTabText: {
    fontSize: 12,
    fontWeight: '700',
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
  commentThreadItem: {
    gap: 6,
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
  detailCommentItem: {
    gap: 6,
  },
  detailCommentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  detailCommentAvatar: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 2,
  },
  detailCommentAvatarImage: {
    width: '100%',
    height: '100%',
  },
  detailCommentAvatarLetter: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  detailCommentBubble: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 2,
  },
  detailCommentAuthor: {
    fontSize: 13,
    fontWeight: '800',
  },
  commentAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  commentTimeInline: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 0,
  },
  detailCommentText: {
    fontSize: 14,
    lineHeight: 20,
  },
  detailCommentMetaRow: {
    marginLeft: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  detailCommentMetaTime: {
    fontSize: 12,
  },
  detailCommentMetaAction: {
    fontSize: 12,
    fontWeight: '700',
  },
  commentReactionActionWrap: {
    position: 'relative',
    zIndex: 20,
  },
  commentReactionPickerPopover: {
    position: 'absolute',
    bottom: 22,
    left: -6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minWidth: 260,
    maxWidth: 340,
    maxHeight: 280,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 10,
  },
  commentReactionPickerScroll: {
    maxHeight: 260,
  },
  commentReactionPickerScrollContent: {
    gap: 8,
    paddingBottom: 2,
  },
  commentReactionPickerGroup: {
    gap: 5,
  },
  commentReactionPickerGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  commentReactionPickerEmojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  commentReactionPickerEmojiButton: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentReactionPickerEmojiImage: {
    width: 16,
    height: 16,
  },
  postReactionActionWrap: {
    position: 'relative',
    zIndex: 30,
    flex: 1,
  },
  postReactionPickerPopover: {
    position: 'absolute',
    bottom: 46,
    left: 0,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minWidth: 260,
    maxWidth: 360,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 10,
  },
  commentReplyLoadingSlot: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentReactionSummaryWrap: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  commentReactionChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  commentReactionEmojiImage: {
    width: 12,
    height: 12,
  },
  commentReactionCount: {
    fontSize: 11,
    fontWeight: '700',
  },
  commentRepliesWrap: {
    marginLeft: 42,
    gap: 8,
    paddingTop: 2,
  },
  commentReplyRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 4,
  },
  commentReplyMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  commentReplyAvatar: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 2,
  },
  commentReplyBubble: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  commentReplyComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commentReplyInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },
  commentReplySendButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
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
  externalLinkModalCard: {
    width: '90%',
    maxWidth: 420,
    minWidth: 280,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  externalLinkModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  postComposerModalBackdrop: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingVertical: 8,
  },
  externalLinkModalTitle: {
    fontSize: 19,
    fontWeight: '800',
  },
  externalLinkModalBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  externalLinkModalUrl: {
    fontSize: 12,
  },
  externalLinkModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 2,
  },
  externalLinkCancelButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  externalLinkCancelButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  externalLinkContinueButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  externalLinkContinueButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
