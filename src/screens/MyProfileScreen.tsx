import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  CircleResult,
  FeedPost,
  FollowingUserResult,
  ListResult,
  ModerationCategory,
  SearchCommunityResult,
  UpdateAuthenticatedUserMediaPayload,
  UpdateAuthenticatedUserPayload
} from '../api/client';
import ProfileActionsMenu from '../components/ProfileActionsMenu';

const DEFAULT_PROFILE_AVATAR = require('../../assets/default-profile-avatar.png');
const DEFAULT_PROFILE_COVER = require('../../assets/default-profile-cover.png');

type TabKey = 'all' | 'about' | 'followers' | 'photos' | 'reels' | 'more';
type ProfileVisibility = 'P' | 'O' | 'T';

type Props = {
  styles: any;
  c: any;
  t: (key: string, options?: any) => string;
  user: any;
  profileRouteUsername: string;
  isCompactProfileLayout: boolean;
  profileTabs: Array<{ key: TabKey; label: string }>;
  profileActiveTab: TabKey;
  onSetProfileActiveTab: (tab: TabKey) => void;
  myProfilePosts: FeedPost[];
  myProfilePostsLoading: boolean;
  myPinnedPosts: FeedPost[];
  myPinnedPostsLoading: boolean;
  myJoinedCommunities: SearchCommunityResult[];
  myJoinedCommunitiesLoading: boolean;
  myJoinedCommunitiesLoadingMore: boolean;
  myJoinedCommunitiesHasMore: boolean;
  onLoadMoreJoinedCommunities: () => void;
  onOpenCommunity: (name: string) => void;
  myFollowings: FollowingUserResult[];
  myFollowingsLoading: boolean;
  myFollowingsLoadingMore: boolean;
  myFollowingsHasMore: boolean;
  onLoadMoreFollowings: () => void;
  onOpenProfile: (username: string) => void;
  onUpdateProfile: (payload: UpdateAuthenticatedUserPayload) => Promise<void>;
  onUpdateProfileMedia: (payload: UpdateAuthenticatedUserMediaPayload) => Promise<void>;
  onNotice: (message: string) => void;
  renderPostCard: (post: FeedPost, variant: 'feed' | 'profile') => React.ReactNode;
  isOwnProfile?: boolean;
  isProfileLoading?: boolean;
  isFollowing?: boolean;
  followLoading?: boolean;
  onToggleFollow?: (username: string, currentlyFollowing: boolean) => void;
  // Actions menu
  isConnected?: boolean;
  isFullyConnected?: boolean;
  isPendingConfirmation?: boolean;
  connectionCircleIds?: number[];
  userCircles?: CircleResult[];
  userLists?: ListResult[];
  moderationCategories?: ModerationCategory[];
  actionsLoading?: boolean;
  onConnect?: (circlesIds: number[]) => void;
  onUpdateConnection?: (circlesIds: number[]) => void;
  onConfirmConnection?: (circlesIds: number[]) => void;
  onDisconnect?: () => void;
  onAddToList?: (listId: number, username: string) => Promise<void>;
  onCreateList?: (name: string, emojiId: number) => Promise<ListResult | null>;
  onFetchEmojiGroups?: () => Promise<any[]>;
  onCreateCircle?: (name: string, color: string) => Promise<CircleResult | null>;
  onBlockUser?: (username: string) => void;
  onReportUser?: (username: string, categoryId: number, description?: string) => void;
};

export default function MyProfileScreen({
  styles,
  c,
  t,
  user,
  profileRouteUsername,
  isCompactProfileLayout,
  profileTabs,
  profileActiveTab,
  onSetProfileActiveTab,
  myProfilePosts,
  myProfilePostsLoading,
  myPinnedPosts,
  myPinnedPostsLoading,
  myJoinedCommunities,
  myJoinedCommunitiesLoading,
  myJoinedCommunitiesLoadingMore,
  myJoinedCommunitiesHasMore,
  onLoadMoreJoinedCommunities,
  onOpenCommunity,
  myFollowings,
  myFollowingsLoading,
  myFollowingsLoadingMore,
  myFollowingsHasMore,
  onLoadMoreFollowings,
  onOpenProfile,
  onUpdateProfile,
  onUpdateProfileMedia,
  onNotice,
  renderPostCard,
  isOwnProfile = true,
  isProfileLoading = false,
  isFollowing = false,
  followLoading = false,
  onToggleFollow,
  isConnected = false,
  isFullyConnected = false,
  isPendingConfirmation = false,
  connectionCircleIds = [],
  userCircles = [],
  userLists = [],
  moderationCategories = [],
  actionsLoading = false,
  onConnect,
  onUpdateConnection,
  onConfirmConnection,
  onDisconnect,
  onAddToList,
  onCreateList,
  onFetchEmojiGroups,
  onCreateCircle,
  onBlockUser,
  onReportUser,
}: Props) {
  const resolveImageUri = React.useCallback((value: unknown): string | undefined => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const lowered = trimmed.toLowerCase();
      if (lowered === 'none' || lowered === 'null' || lowered === 'undefined') return undefined;
      return trimmed;
    }
    if (value && typeof value === 'object') {
      const maybeUrl = (value as { url?: unknown }).url;
      if (typeof maybeUrl === 'string' && maybeUrl.trim()) {
        return maybeUrl.trim();
      }
    }
    return undefined;
  }, []);

  const resolveVisibility = React.useCallback((value: unknown, defaultVisible = true) => {
    if (value === true) return true;
    if (value === false || value === null) return false;
    return defaultVisible;
  }, []);

  const [editProfileModalOpen, setEditProfileModalOpen] = React.useState(false);
  const [detailsExpanded, setDetailsExpanded] = React.useState(false);
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [editUsername, setEditUsername] = React.useState('');
  const [editName, setEditName] = React.useState('');
  const [editLocation, setEditLocation] = React.useState('');
  const [editBio, setEditBio] = React.useState('');
  const [editUrl, setEditUrl] = React.useState('');
  const [editFollowersCountVisible, setEditFollowersCountVisible] = React.useState(true);
  const [editCommunityPostsVisible, setEditCommunityPostsVisible] = React.useState(true);
  const [editProfileVisibility, setEditProfileVisibility] = React.useState<ProfileVisibility>('P');
  const [avatarOptionsOpen, setAvatarOptionsOpen] = React.useState(false);
  const [avatarEditorOpen, setAvatarEditorOpen] = React.useState(false);
  const [avatarEditorUri, setAvatarEditorUri] = React.useState<string | null>(null);
  const [avatarEditorScale, setAvatarEditorScale] = React.useState(1);
  const [avatarEditorOffsetX, setAvatarEditorOffsetX] = React.useState(0);
  const [avatarEditorOffsetY, setAvatarEditorOffsetY] = React.useState(0);
  const [avatarEditorGrayscale, setAvatarEditorGrayscale] = React.useState(false);
  const [avatarSaving, setAvatarSaving] = React.useState(false);
  const [coverOptionsOpen, setCoverOptionsOpen] = React.useState(false);
  const [coverEditorOpen, setCoverEditorOpen] = React.useState(false);
  const [coverEditorUri, setCoverEditorUri] = React.useState<string | null>(null);
  const [coverEditorScale, setCoverEditorScale] = React.useState(1);
  const [coverEditorOffsetX, setCoverEditorOffsetX] = React.useState(0);
  const [coverEditorOffsetY, setCoverEditorOffsetY] = React.useState(0);
  const [coverEditorGrayscale, setCoverEditorGrayscale] = React.useState(false);
  const [coverSaving, setCoverSaving] = React.useState(false);
  const objectUrlRef = React.useRef<string[]>([]);

  const [actionsMenuOpen, setActionsMenuOpen] = React.useState(false);
  const [visibleJoinedCommunities, setVisibleJoinedCommunities] = React.useState(9);
  const [visibleFollowings, setVisibleFollowings] = React.useState(9);
  const safePinnedPosts = Array.isArray(myPinnedPosts) ? myPinnedPosts : [];
  const safeProfilePosts = Array.isArray(myProfilePosts) ? myProfilePosts : [];
  const showCommunityPostsOnProfile = resolveVisibility(user?.community_posts_visible, true);
  const filteredPinnedPosts = showCommunityPostsOnProfile
    ? safePinnedPosts
    : safePinnedPosts.filter((post) => !post.community?.name);
  const filteredProfilePosts = showCommunityPostsOnProfile
    ? safeProfilePosts
    : safeProfilePosts.filter((post) => !post.community?.name);
  const safeJoinedCommunities = Array.isArray(myJoinedCommunities) ? myJoinedCommunities : [];
  const safeFollowings = Array.isArray(myFollowings) ? myFollowings : [];
  const hasVerifiedBadge = Array.isArray(user?.profile?.badges)
    ? user.profile.badges.some((badge: any) => (badge?.keyword || '').toUpperCase() === 'VERIFIED')
    : false;
  const pinnedIds = new Set(filteredPinnedPosts.map((post) => post.id));
  const regularProfilePosts = filteredProfilePosts.filter((post) => !pinnedIds.has(post.id));
  const shownJoinedCommunities = safeJoinedCommunities.slice(0, visibleJoinedCommunities);
  const shownFollowings = safeFollowings.slice(0, visibleFollowings);
  const hasHiddenJoinedCommunities = shownJoinedCommunities.length < safeJoinedCommunities.length;
  const hasHiddenFollowings = shownFollowings.length < safeFollowings.length;
  const canRequestMoreJoinedCommunities =
    !myJoinedCommunitiesLoading && (myJoinedCommunitiesHasMore || hasHiddenJoinedCommunities);
  const canRequestMoreFollowings =
    !myFollowingsLoading && (myFollowingsHasMore || hasHiddenFollowings);
  const avatarDisplayUri = resolveImageUri(user?.profile?.avatar);
  const coverDisplayUri = resolveImageUri(user?.profile?.cover);
  const resolvedFollowingCountRaw =
    user?.following_count ??
    user?.followings_count ??
    user?.follows_count ??
    user?.following?.count;
  const resolvedFollowingCount = Number.isFinite(Number(resolvedFollowingCountRaw))
    ? Number(resolvedFollowingCountRaw)
    : safeFollowings.length;
  const resolvedFollowersCountRaw = user?.followers_count;
  const hasResolvedFollowersCount =
    resolvedFollowersCountRaw !== null &&
    resolvedFollowersCountRaw !== undefined &&
    resolvedFollowersCountRaw !== '' &&
    Number.isFinite(Number(resolvedFollowersCountRaw));
  const resolvedFollowersCount = hasResolvedFollowersCount ? Number(resolvedFollowersCountRaw) : 0;
  const shouldShowFollowersCount = isOwnProfile
    ? resolveVisibility(user?.followers_count_visible, true)
    : hasResolvedFollowersCount;

  const hydrateEditProfileState = React.useCallback(() => {
    const nextVisibility: ProfileVisibility =
      user?.visibility === 'O' || user?.visibility === 'T' || user?.visibility === 'P'
        ? user.visibility
        : 'P';
    setEditUsername(user?.username || profileRouteUsername || '');
    setEditName(user?.profile?.name || '');
    setEditLocation(user?.profile?.location || '');
    setEditBio(user?.profile?.bio || '');
    setEditUrl(user?.profile?.url || '');
    setEditFollowersCountVisible(resolveVisibility(user?.followers_count_visible, true));
    setEditCommunityPostsVisible(resolveVisibility(user?.community_posts_visible, true));
    setEditProfileVisibility(nextVisibility);
  }, [profileRouteUsername, resolveVisibility, user]);

  React.useEffect(() => {
    setVisibleJoinedCommunities(9);
    setVisibleFollowings(9);
  }, [profileRouteUsername]);

  React.useEffect(() => {
    return () => {
      objectUrlRef.current.forEach((url) => {
        if (url.startsWith('blob:') && typeof URL !== 'undefined') {
          URL.revokeObjectURL(url);
        }
      });
      objectUrlRef.current = [];
    };
  }, []);

  React.useEffect(() => {
    if (
      visibleJoinedCommunities > safeJoinedCommunities.length &&
      myJoinedCommunitiesHasMore &&
      !myJoinedCommunitiesLoading &&
      !myJoinedCommunitiesLoadingMore
    ) {
      onLoadMoreJoinedCommunities();
    }
  }, [
    visibleJoinedCommunities,
    safeJoinedCommunities.length,
    myJoinedCommunitiesHasMore,
    myJoinedCommunitiesLoading,
    myJoinedCommunitiesLoadingMore,
    onLoadMoreJoinedCommunities,
  ]);

  React.useEffect(() => {
    if (
      visibleFollowings > safeFollowings.length &&
      myFollowingsHasMore &&
      !myFollowingsLoading &&
      !myFollowingsLoadingMore
    ) {
      onLoadMoreFollowings();
    }
  }, [
    visibleFollowings,
    safeFollowings.length,
    myFollowingsHasMore,
    myFollowingsLoading,
    myFollowingsLoadingMore,
    onLoadMoreFollowings,
  ]);

  function openEditProfileModal() {
    hydrateEditProfileState();
    setDetailsExpanded(false);
    setEditProfileModalOpen(true);
  }

  function closeEditProfileModal() {
    if (savingProfile) return;
    setEditProfileModalOpen(false);
  }

  function openAvatarOptions() {
    setAvatarOptionsOpen(true);
  }

  function closeAvatarOptions() {
    if (avatarSaving || coverSaving) return;
    setAvatarOptionsOpen(false);
  }

  function openAvatarEditorWithUri(uri: string) {
    setAvatarEditorUri(uri);
    setAvatarEditorScale(1);
    setAvatarEditorOffsetX(0);
    setAvatarEditorOffsetY(0);
    setAvatarEditorGrayscale(false);
    setAvatarEditorOpen(true);
    setAvatarOptionsOpen(false);
  }

  function uploadNewAvatar() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      onNotice(t('home.profileImagePickerUnavailable', { defaultValue: 'Image picker is currently available on web.' }));
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      objectUrlRef.current.push(url);
      openAvatarEditorWithUri(url);
    };
    input.click();
  }

  function closeAvatarEditor() {
    if (avatarSaving || coverSaving) return;
    setAvatarEditorOpen(false);
  }

  function openCoverOptions() {
    setCoverOptionsOpen(true);
  }

  function closeCoverOptions() {
    if (avatarSaving || coverSaving) return;
    setCoverOptionsOpen(false);
  }

  function openCoverEditorWithUri(uri: string) {
    setCoverEditorUri(uri);
    setCoverEditorScale(1);
    setCoverEditorOffsetX(0);
    setCoverEditorOffsetY(0);
    setCoverEditorGrayscale(false);
    setCoverEditorOpen(true);
    setCoverOptionsOpen(false);
  }

  function uploadNewCover() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      onNotice(t('home.profileImagePickerUnavailable', { defaultValue: 'Image picker is currently available on web.' }));
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      objectUrlRef.current.push(url);
      openCoverEditorWithUri(url);
    };
    input.click();
  }

  function closeCoverEditor() {
    if (avatarSaving || coverSaving) return;
    setCoverEditorOpen(false);
  }

  async function exportEditedAvatarBlob(): Promise<Blob | null> {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !avatarEditorUri) return null;

    return new Promise((resolve) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const outputSize = 512;
        const canvas = document.createElement('canvas');
        canvas.width = outputSize;
        canvas.height = outputSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        if (avatarEditorGrayscale) {
          ctx.filter = 'grayscale(100%)';
        }

        const baseScale = Math.min(outputSize / img.width, outputSize / img.height);
        const renderScale = baseScale * avatarEditorScale;
        const drawWidth = img.width * renderScale;
        const drawHeight = img.height * renderScale;
        const drawX = (outputSize - drawWidth) / 2 + avatarEditorOffsetX;
        const drawY = (outputSize - drawHeight) / 2 + avatarEditorOffsetY;
        ctx.fillStyle = '#ececec';
        ctx.fillRect(0, 0, outputSize, outputSize);
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

        canvas.toBlob(
          (blob) => resolve(blob),
          'image/jpeg',
          0.92
        );
      };
      img.onerror = () => resolve(null);
      img.src = avatarEditorUri;
    });
  }

  async function saveEditedAvatar() {
    if (avatarSaving) return;
    setAvatarSaving(true);
    try {
      const blob = await exportEditedAvatarBlob();
      if (!blob) {
        onNotice(t('home.profileAvatarEditFailed', { defaultValue: 'Could not process avatar image.' }));
        return;
      }
      const namedBlob = blob as Blob & { name?: string };
      namedBlob.name = 'avatar.jpg';
      await onUpdateProfileMedia({ avatarFile: namedBlob });
      setAvatarEditorOpen(false);
    } finally {
      setAvatarSaving(false);
    }
  }

  async function exportEditedCoverBlob(): Promise<Blob | null> {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !coverEditorUri) return null;

    return new Promise((resolve) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const outputWidth = 1500;
        const outputHeight = 500;
        const canvas = document.createElement('canvas');
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        if (coverEditorGrayscale) {
          ctx.filter = 'grayscale(100%)';
        }

        const baseScale = Math.min(outputWidth / img.width, outputHeight / img.height);
        const renderScale = baseScale * coverEditorScale;
        const drawWidth = img.width * renderScale;
        const drawHeight = img.height * renderScale;
        const drawX = (outputWidth - drawWidth) / 2 + coverEditorOffsetX;
        const drawY = (outputHeight - drawHeight) / 2 + coverEditorOffsetY;
        ctx.fillStyle = '#ececec';
        ctx.fillRect(0, 0, outputWidth, outputHeight);
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

        canvas.toBlob(
          (blob) => resolve(blob),
          'image/jpeg',
          0.92
        );
      };
      img.onerror = () => resolve(null);
      img.src = coverEditorUri;
    });
  }

  async function saveEditedCover() {
    if (coverSaving) return;
    setCoverSaving(true);
    try {
      const blob = await exportEditedCoverBlob();
      if (!blob) {
        onNotice(t('home.profileCoverEditFailed', { defaultValue: 'Could not process cover photo.' }));
        return;
      }
      const namedBlob = blob as Blob & { name?: string };
      namedBlob.name = 'cover.jpg';
      await onUpdateProfileMedia({ coverFile: namedBlob });
      setCoverEditorOpen(false);
    } finally {
      setCoverSaving(false);
    }
  }

  async function submitEditProfile() {
    if (savingProfile) return;
    setSavingProfile(true);
    try {
      await onUpdateProfile({
        username: editUsername.trim() || undefined,
        name: editName.trim() || undefined,
        location: editLocation.trim() || undefined,
        bio: editBio.trim() || undefined,
        url: editUrl.trim() || undefined,
        followers_count_visible: !!editFollowersCountVisible,
        community_posts_visible: !!editCommunityPostsVisible,
        visibility: editProfileVisibility,
      });
      setEditProfileModalOpen(false);
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <View style={[styles.profilePageCard, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Modal
        visible={isOwnProfile && avatarOptionsOpen}
        animationType="fade"
        transparent
        onRequestClose={closeAvatarOptions}
      >
        <Pressable style={styles.profileEditModalBackdrop} onPress={closeAvatarOptions}>
          <Pressable
            style={[styles.profileAvatarOptionsCard, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text style={[styles.profileAvatarOptionsTitle, { color: c.textPrimary }]}>
              {t('home.profileAvatarOptionsTitle', { defaultValue: 'Avatar photo' })}
            </Text>
            <TouchableOpacity
              style={[styles.profileAvatarOptionsAction, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={uploadNewAvatar}
            >
              <MaterialCommunityIcons name="upload-outline" size={18} color={c.textSecondary} />
              <Text style={[styles.profileAvatarOptionsActionText, { color: c.textPrimary }]}>
                {t('home.profileAvatarUploadNewAction', { defaultValue: 'Upload and edit new photo' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.profileAvatarOptionsCancel, { borderColor: c.border, backgroundColor: c.surface }]}
              activeOpacity={0.85}
              onPress={closeAvatarOptions}
            >
              <Text style={[styles.profileAvatarOptionsCancelText, { color: c.textSecondary }]}>
                {t('home.cancelAction', { defaultValue: 'Cancel' })}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={isOwnProfile && coverOptionsOpen}
        animationType="fade"
        transparent
        onRequestClose={closeCoverOptions}
      >
        <Pressable style={styles.profileEditModalBackdrop} onPress={closeCoverOptions}>
          <Pressable
            style={[styles.profileAvatarOptionsCard, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text style={[styles.profileAvatarOptionsTitle, { color: c.textPrimary }]}>
              {t('home.profileCoverOptionsTitle', { defaultValue: 'Cover photo' })}
            </Text>
            <TouchableOpacity
              style={[styles.profileAvatarOptionsAction, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={uploadNewCover}
            >
              <MaterialCommunityIcons name="upload-outline" size={18} color={c.textSecondary} />
              <Text style={[styles.profileAvatarOptionsActionText, { color: c.textPrimary }]}>
                {t('home.profileAvatarUploadNewAction', { defaultValue: 'Upload and edit new photo' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.profileAvatarOptionsCancel, { borderColor: c.border, backgroundColor: c.surface }]}
              activeOpacity={0.85}
              onPress={closeCoverOptions}
            >
              <Text style={[styles.profileAvatarOptionsCancelText, { color: c.textSecondary }]}>
                {t('home.cancelAction', { defaultValue: 'Cancel' })}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={isOwnProfile && avatarEditorOpen}
        animationType="fade"
        transparent
        onRequestClose={closeAvatarEditor}
      >
        <Pressable style={styles.profileEditModalBackdrop} onPress={closeAvatarEditor}>
          <Pressable
            style={[styles.profileAvatarEditorCard, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text style={[styles.profileAvatarOptionsTitle, { color: c.textPrimary }]}>
              {t('home.profileAvatarEditorTitle', { defaultValue: 'Edit avatar' })}
            </Text>

            <View style={[styles.profileAvatarEditorPreview, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
              <Image
                source={avatarEditorUri ? { uri: avatarEditorUri } : DEFAULT_PROFILE_AVATAR}
                style={[
                  styles.profileAvatarEditorImage,
                  {
                    transform: [
                      { translateX: avatarEditorOffsetX },
                      { translateY: avatarEditorOffsetY },
                      { scale: avatarEditorScale },
                    ],
                  },
                  Platform.OS === 'web' && avatarEditorGrayscale ? ({ filter: 'grayscale(100%)' } as any) : null,
                ]}
                resizeMode="contain"
              />
            </View>

            <View style={styles.profileAvatarEditorControls}>
              <Text style={[styles.profileAvatarControlLabel, { color: c.textSecondary }]}>
                {t('home.profileAvatarZoomLabel', { defaultValue: 'Zoom' })}
              </Text>
              <View style={styles.profileAvatarControlRow}>
                <TouchableOpacity
                  style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={() => setAvatarEditorScale((prev) => Math.max(0.6, Number((prev - 0.1).toFixed(2))))}
                >
                  <MaterialCommunityIcons name="minus" size={16} color={c.textSecondary} />
                </TouchableOpacity>
                <Text style={[styles.profileAvatarControlValue, { color: c.textPrimary }]}>
                  {Math.round(avatarEditorScale * 100)}%
                </Text>
                <TouchableOpacity
                  style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={() => setAvatarEditorScale((prev) => Math.min(2.6, Number((prev + 0.1).toFixed(2))))}
                >
                  <MaterialCommunityIcons name="plus" size={16} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.profileAvatarControlLabel, { color: c.textSecondary }]}>
                {t('home.profileAvatarPositionLabel', { defaultValue: 'Position' })}
              </Text>
              <View style={styles.profileAvatarPositionPad}>
                <TouchableOpacity
                  style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={() => setAvatarEditorOffsetY((prev) => prev - 12)}
                >
                  <MaterialCommunityIcons name="arrow-up" size={16} color={c.textSecondary} />
                </TouchableOpacity>
                <View style={styles.profileAvatarPositionMid}>
                  <TouchableOpacity
                    style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    onPress={() => setAvatarEditorOffsetX((prev) => prev - 12)}
                  >
                    <MaterialCommunityIcons name="arrow-left" size={16} color={c.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    onPress={() => {
                      setAvatarEditorOffsetX(0);
                      setAvatarEditorOffsetY(0);
                    }}
                  >
                    <MaterialCommunityIcons name="crosshairs-gps" size={16} color={c.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    onPress={() => setAvatarEditorOffsetX((prev) => prev + 12)}
                  >
                    <MaterialCommunityIcons name="arrow-right" size={16} color={c.textSecondary} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={() => setAvatarEditorOffsetY((prev) => prev + 12)}
                >
                  <MaterialCommunityIcons name="arrow-down" size={16} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.profileAvatarSwitchRow}>
                <Text style={[styles.profileAvatarControlLabel, { color: c.textSecondary }]}>
                  {t('home.profileAvatarGrayscaleLabel', { defaultValue: 'Grayscale' })}
                </Text>
                <Switch
                  value={avatarEditorGrayscale}
                  onValueChange={setAvatarEditorGrayscale}
                  thumbColor="#ffffff"
                  trackColor={{ false: '#b8c2d3', true: c.primary }}
                />
              </View>
            </View>

            <View style={[styles.profileEditModalActions, { borderTopColor: c.border }]}>
              <TouchableOpacity
                style={[styles.profileEditModalButton, { backgroundColor: c.inputBackground, borderColor: c.border }]}
                activeOpacity={0.85}
                onPress={closeAvatarEditor}
                disabled={avatarSaving}
              >
                <Text style={[styles.profileEditModalButtonText, { color: c.textPrimary }]}>
                  {t('home.cancelAction', { defaultValue: 'Cancel' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.profileEditModalButton, { backgroundColor: c.primary }]}
                activeOpacity={0.85}
                onPress={saveEditedAvatar}
                disabled={avatarSaving}
              >
                {avatarSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.profileEditModalButtonTextPrimary}>
                    {t('home.saveAction', { defaultValue: 'Save' })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={isOwnProfile && coverEditorOpen}
        animationType="fade"
        transparent
        onRequestClose={closeCoverEditor}
      >
        <Pressable style={styles.profileEditModalBackdrop} onPress={closeCoverEditor}>
          <Pressable
            style={[styles.profileCoverEditorCard, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text style={[styles.profileAvatarOptionsTitle, { color: c.textPrimary }]}>
              {t('home.profileCoverEditorTitle', { defaultValue: 'Edit cover photo' })}
            </Text>

            <View style={[styles.profileCoverEditorPreview, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
              <Image
                source={coverEditorUri ? { uri: coverEditorUri } : DEFAULT_PROFILE_COVER}
                style={[
                  styles.profileCoverEditorImage,
                  {
                    transform: [
                      { translateX: coverEditorOffsetX },
                      { translateY: coverEditorOffsetY },
                      { scale: coverEditorScale },
                    ],
                  },
                  Platform.OS === 'web' && coverEditorGrayscale ? ({ filter: 'grayscale(100%)' } as any) : null,
                ]}
                resizeMode="contain"
              />
            </View>

            <View style={styles.profileAvatarEditorControls}>
              <Text style={[styles.profileAvatarControlLabel, { color: c.textSecondary }]}>
                {t('home.profileAvatarZoomLabel', { defaultValue: 'Zoom' })}
              </Text>
              <View style={styles.profileAvatarControlRow}>
                <TouchableOpacity
                  style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={() => setCoverEditorScale((prev) => Math.max(0.6, Number((prev - 0.1).toFixed(2))))}
                >
                  <MaterialCommunityIcons name="minus" size={16} color={c.textSecondary} />
                </TouchableOpacity>
                <Text style={[styles.profileAvatarControlValue, { color: c.textPrimary }]}>
                  {Math.round(coverEditorScale * 100)}%
                </Text>
                <TouchableOpacity
                  style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={() => setCoverEditorScale((prev) => Math.min(2.6, Number((prev + 0.1).toFixed(2))))}
                >
                  <MaterialCommunityIcons name="plus" size={16} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.profileAvatarControlLabel, { color: c.textSecondary }]}>
                {t('home.profileAvatarPositionLabel', { defaultValue: 'Position' })}
              </Text>
              <View style={styles.profileAvatarPositionPad}>
                <TouchableOpacity
                  style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={() => setCoverEditorOffsetY((prev) => prev - 12)}
                >
                  <MaterialCommunityIcons name="arrow-up" size={16} color={c.textSecondary} />
                </TouchableOpacity>
                <View style={styles.profileAvatarPositionMid}>
                  <TouchableOpacity
                    style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    onPress={() => setCoverEditorOffsetX((prev) => prev - 12)}
                  >
                    <MaterialCommunityIcons name="arrow-left" size={16} color={c.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    onPress={() => {
                      setCoverEditorOffsetX(0);
                      setCoverEditorOffsetY(0);
                    }}
                  >
                    <MaterialCommunityIcons name="crosshairs-gps" size={16} color={c.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    onPress={() => setCoverEditorOffsetX((prev) => prev + 12)}
                  >
                    <MaterialCommunityIcons name="arrow-right" size={16} color={c.textSecondary} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[styles.profileAvatarControlBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={() => setCoverEditorOffsetY((prev) => prev + 12)}
                >
                  <MaterialCommunityIcons name="arrow-down" size={16} color={c.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.profileAvatarSwitchRow}>
                <Text style={[styles.profileAvatarControlLabel, { color: c.textSecondary }]}>
                  {t('home.profileAvatarGrayscaleLabel', { defaultValue: 'Grayscale' })}
                </Text>
                <Switch
                  value={coverEditorGrayscale}
                  onValueChange={setCoverEditorGrayscale}
                  thumbColor="#ffffff"
                  trackColor={{ false: '#b8c2d3', true: c.primary }}
                />
              </View>
            </View>

            <View style={[styles.profileEditModalActions, { borderTopColor: c.border }]}>
              <TouchableOpacity
                style={[styles.profileEditModalButton, { backgroundColor: c.inputBackground, borderColor: c.border }]}
                activeOpacity={0.85}
                onPress={closeCoverEditor}
                disabled={coverSaving}
              >
                <Text style={[styles.profileEditModalButtonText, { color: c.textPrimary }]}>
                  {t('home.cancelAction', { defaultValue: 'Cancel' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.profileEditModalButton, { backgroundColor: c.primary }]}
                activeOpacity={0.85}
                onPress={saveEditedCover}
                disabled={coverSaving}
              >
                {coverSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.profileEditModalButtonTextPrimary}>
                    {t('home.saveAction', { defaultValue: 'Save' })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={isOwnProfile && editProfileModalOpen}
        animationType="fade"
        transparent
        onRequestClose={closeEditProfileModal}
      >
        <Pressable style={styles.profileEditModalBackdrop} onPress={closeEditProfileModal}>
          <Pressable
            style={[
              styles.profileEditModalCard,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            <ScrollView
              style={styles.profileEditModalScroll}
              contentContainerStyle={styles.profileEditModalScrollContent}
              showsVerticalScrollIndicator
            >
              <TouchableOpacity
                style={[styles.profileEditOptionRow, { borderColor: c.border }]}
                activeOpacity={0.85}
                onPress={() => setDetailsExpanded((prev) => !prev)}
              >
                <View style={styles.profileEditOptionIcon}>
                  <MaterialCommunityIcons name="pencil-outline" size={21} color={c.textSecondary} />
                </View>
                <View style={styles.profileEditOptionTextWrap}>
                  <Text style={[styles.profileEditOptionTitle, { color: c.textPrimary }]}>
                    {t('home.profileEditDetailsTitle', { defaultValue: 'Details' })}
                  </Text>
                  <Text style={[styles.profileEditOptionSubtitle, { color: c.textSecondary }]}>
                    {t('home.profileEditDetailsSubtitle', {
                      defaultValue: 'Change your username, name, url, location, avatar or cover photo.',
                    })}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name={detailsExpanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={c.textMuted}
                />
              </TouchableOpacity>

              {detailsExpanded ? (
                <View style={[styles.profileEditDetailsGroup, { borderColor: c.border }]}>
                  <View style={styles.profileEditField}>
                    <Text style={[styles.profileEditFieldLabel, { color: c.textSecondary }]}>
                      {t('auth.username', { defaultValue: 'Username' })}
                    </Text>
                    <TextInput
                      value={editUsername}
                      onChangeText={setEditUsername}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[styles.profileEditInput, { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground }]}
                      placeholderTextColor={c.textMuted}
                      placeholder={t('auth.usernamePlaceholder', { defaultValue: 'Enter your username' })}
                    />
                  </View>
                  <View style={styles.profileEditField}>
                    <Text style={[styles.profileEditFieldLabel, { color: c.textSecondary }]}>
                      {t('home.profileNameLabel', { defaultValue: 'Name' })}
                    </Text>
                    <TextInput
                      value={editName}
                      onChangeText={setEditName}
                      style={[styles.profileEditInput, { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground }]}
                      placeholderTextColor={c.textMuted}
                      placeholder={t('home.profileNamePlaceholder', { defaultValue: 'Enter your name' })}
                    />
                  </View>
                  <View style={styles.profileEditField}>
                    <Text style={[styles.profileEditFieldLabel, { color: c.textSecondary }]}>
                      {t('home.profileLocationLabel', { defaultValue: 'Location' })}
                    </Text>
                    <TextInput
                      value={editLocation}
                      onChangeText={setEditLocation}
                      style={[styles.profileEditInput, { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground }]}
                      placeholderTextColor={c.textMuted}
                      placeholder={t('home.profileLocationPlaceholder', { defaultValue: 'Enter your location' })}
                    />
                  </View>
                  <View style={styles.profileEditField}>
                    <Text style={[styles.profileEditFieldLabel, { color: c.textSecondary }]}>
                      {t('home.profileUrlLabel', { defaultValue: 'URL' })}
                    </Text>
                    <TextInput
                      value={editUrl}
                      onChangeText={setEditUrl}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[styles.profileEditInput, { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground }]}
                      placeholderTextColor={c.textMuted}
                      placeholder={t('home.profileUrlPlaceholder', { defaultValue: 'Enter your URL' })}
                    />
                  </View>
                  <View style={styles.profileEditField}>
                    <Text style={[styles.profileEditFieldLabel, { color: c.textSecondary }]}>
                      {t('home.profileBioLabel', { defaultValue: 'Bio' })}
                    </Text>
                    <TextInput
                      value={editBio}
                      onChangeText={setEditBio}
                      multiline
                      numberOfLines={8}
                      style={[
                        styles.profileEditInput,
                        styles.profileEditTextarea,
                        { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground },
                      ]}
                      placeholderTextColor={c.textMuted}
                      placeholder={t('home.profileBioPlaceholder', { defaultValue: 'Tell people about yourself' })}
                    />
                  </View>
                </View>
              ) : null}

              <View style={[styles.profileEditOptionRow, { borderColor: c.border }]}>
                <View style={styles.profileEditOptionIcon}>
                  <MaterialCommunityIcons name="account-group-outline" size={21} color={c.textSecondary} />
                </View>
                <View style={styles.profileEditOptionTextWrap}>
                  <Text style={[styles.profileEditOptionTitle, { color: c.textPrimary }]}>
                    {t('home.profileFollowersCountTitle', { defaultValue: 'Followers count' })}
                  </Text>
                  <Text style={[styles.profileEditOptionSubtitle, { color: c.textSecondary }]}>
                    {t('home.profileFollowersCountSubtitle', {
                      defaultValue: 'Display the number of people that follow you, on your profile.',
                    })}
                  </Text>
                </View>
                <Switch
                  value={editFollowersCountVisible}
                  onValueChange={setEditFollowersCountVisible}
                  thumbColor="#ffffff"
                  trackColor={{ false: '#b8c2d3', true: c.primary }}
                />
              </View>

              <View style={[styles.profileEditOptionRow, { borderColor: c.border }]}>
                <View style={styles.profileEditOptionIcon}>
                  <MaterialCommunityIcons name="share-variant-outline" size={21} color={c.textSecondary} />
                </View>
                <View style={styles.profileEditOptionTextWrap}>
                  <Text style={[styles.profileEditOptionTitle, { color: c.textPrimary }]}>
                    {t('home.profileCommunityPostsTitle', { defaultValue: 'Community posts' })}
                  </Text>
                  <Text style={[styles.profileEditOptionSubtitle, { color: c.textSecondary }]}>
                    {t('home.profileCommunityPostsSubtitle', {
                      defaultValue: 'Display posts you share with public communities, on your profile.',
                    })}
                  </Text>
                </View>
                <Switch
                  value={editCommunityPostsVisible}
                  onValueChange={setEditCommunityPostsVisible}
                  thumbColor="#ffffff"
                  trackColor={{ false: '#b8c2d3', true: c.primary }}
                />
              </View>

              <View style={styles.profileEditVisibilitySection}>
                <Text style={[styles.profileEditVisibilityHeading, { color: c.textPrimary }]}>
                  {t('home.profileVisibilityTitle', { defaultValue: 'Visibility' })}
                </Text>
                {[
                  {
                    value: 'P' as ProfileVisibility,
                    icon: 'earth',
                    title: t('home.profileVisibilityPublicTitle', { defaultValue: 'Public' }),
                    subtitle: t('home.profileVisibilityPublicSubtitle', {
                      defaultValue: 'Everyone on the internet can see your profile.',
                    }),
                  },
                  {
                    value: 'O' as ProfileVisibility,
                    icon: 'account-group-outline',
                    title: t('home.profileVisibilityOkunaTitle', { defaultValue: 'Openspace' }),
                    subtitle: t('home.profileVisibilityOkunaSubtitle', {
                      defaultValue: 'Only members of Openspace can see your profile.',
                    }),
                  },
                  {
                    value: 'T' as ProfileVisibility,
                    icon: 'lock-outline',
                    title: t('home.profileVisibilityPrivateTitle', { defaultValue: 'Private' }),
                    subtitle: t('home.profileVisibilityPrivateSubtitle', {
                      defaultValue: 'Only people you approve can see your profile.',
                    }),
                  },
                ].map((option) => {
                  const selected = editProfileVisibility === option.value;
                  return (
                    <Pressable
                      key={`profile-visibility-${option.value}`}
                      style={[
                        styles.profileEditOptionRow,
                        selected ? styles.profileEditOptionRowSelected : null,
                        {
                          borderColor: selected ? c.primary : c.border,
                          backgroundColor: selected ? c.surface : 'transparent',
                        },
                      ]}
                      onPress={() => setEditProfileVisibility(option.value)}
                    >
                      <View style={styles.profileEditOptionIcon}>
                        <MaterialCommunityIcons name={option.icon as any} size={21} color={c.textSecondary} />
                      </View>
                      <View style={styles.profileEditOptionTextWrap}>
                        <Text style={[styles.profileEditOptionTitle, { color: c.textPrimary }]}>
                          {option.title}
                        </Text>
                        <Text style={[styles.profileEditOptionSubtitle, { color: c.textSecondary }]}>
                          {option.subtitle}
                        </Text>
                      </View>
                      <View style={styles.profileEditVisibilityCheckWrap}>
                        <MaterialCommunityIcons
                          name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                          size={26}
                          color={selected ? c.primary : c.textMuted}
                        />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <View style={[styles.profileEditModalActions, { borderTopColor: c.border }]}>
              <TouchableOpacity
                style={[styles.profileEditModalButton, { backgroundColor: c.inputBackground, borderColor: c.border }]}
                activeOpacity={0.85}
                onPress={closeEditProfileModal}
                disabled={savingProfile}
              >
                <Text style={[styles.profileEditModalButtonText, { color: c.textPrimary }]}>
                  {t('home.cancelAction', { defaultValue: 'Cancel' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.profileEditModalButton, { backgroundColor: c.primary }]}
                activeOpacity={0.85}
                onPress={submitEditProfile}
                disabled={savingProfile}
              >
                {savingProfile ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.profileEditModalButtonTextPrimary}>
                    {t('home.saveAction', { defaultValue: 'Save' })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={[styles.profileCoverWrap, { backgroundColor: c.inputBackground, borderColor: c.border }]}> 
        {coverDisplayUri ? (
          <Image
            source={{ uri: coverDisplayUri }}
            style={styles.profileCoverImage}
            resizeMode="cover"
          />
        ) : isProfileLoading ? (
          <View
            style={[
              styles.profileCoverImage,
              { backgroundColor: c.inputBackground, alignItems: 'center', justifyContent: 'center' },
            ]}
          >
            <ActivityIndicator color={c.primary} size="small" />
          </View>
        ) : (
          <Image
            source={DEFAULT_PROFILE_COVER}
            style={styles.profileCoverImage}
            resizeMode="cover"
          />
        )}
        {isOwnProfile ? (
          <Pressable
            style={[styles.profileCoverAction, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={openCoverOptions}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="camera-outline" size={15} color={c.textSecondary} />
            <Text style={[styles.profileCoverActionText, { color: c.textPrimary }]}>{t('home.profileEditCoverAction')}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.profileIdentityRow, isCompactProfileLayout ? styles.profileIdentityRowCompact : null]}>
        <View style={[styles.profileIdentityLeft, isCompactProfileLayout ? styles.profileIdentityLeftCompact : null]}>
          <View style={styles.profileAvatarActionWrap}>
            <View style={[styles.profileAvatarWrap, { borderColor: c.surface, backgroundColor: c.primary }]}>
              {avatarDisplayUri ? (
                <Image
                  source={{ uri: avatarDisplayUri }}
                  style={styles.profileAvatarImage}
                  resizeMode="cover"
                />
              ) : isProfileLoading ? (
                <View
                  style={[
                    styles.profileAvatarImage,
                    { backgroundColor: c.inputBackground, alignItems: 'center', justifyContent: 'center' },
                  ]}
                >
                  <ActivityIndicator color={c.primary} size="small" />
                </View>
              ) : (
                <Image
                  source={DEFAULT_PROFILE_AVATAR}
                  style={styles.profileAvatarImage}
                  resizeMode="cover"
                />
              )}
            </View>
            {isOwnProfile ? (
              <TouchableOpacity
                style={[styles.profileAvatarEditAction, { backgroundColor: c.surface, borderColor: c.border }]}
                activeOpacity={0.85}
                onPress={openAvatarOptions}
              >
                <MaterialCommunityIcons name="camera-outline" size={16} color={c.textSecondary} />
                <Text numberOfLines={1} style={[styles.profileAvatarEditActionText, { color: c.textSecondary }]}>
                  {t('home.profileAvatarEditAction')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.profileIdentityMeta}>
            <View style={styles.profileDisplayNameRow}>
                <Text style={[styles.profileDisplayName, isCompactProfileLayout ? styles.profileDisplayNameCompact : null, { color: c.textPrimary }]}>
                {user?.profile?.name || `@${user?.username || profileRouteUsername}`}
              </Text>
              {hasVerifiedBadge ? (
                <MaterialCommunityIcons
                  name="check-decagram"
                  size={isCompactProfileLayout ? 22 : 26}
                  color="#1d9bf0"
                  style={styles.profileVerifiedBadge}
                />
              ) : null}
              <View style={styles.profileNameCountsRow}>
                {shouldShowFollowersCount ? (
                  <Text style={[styles.profileMetaCountText, { color: c.textMuted }]}>
                    {t('home.profileFollowersDisplay', {
                      count: resolvedFollowersCount,
                      defaultValue: `${resolvedFollowersCount} followers`,
                    })}
                  </Text>
                ) : null}
                <Text style={[styles.profileMetaCountText, { color: c.textMuted }]}>
                  {t('home.profileFollowingDisplay', {
                    count: resolvedFollowingCount,
                    defaultValue: `${resolvedFollowingCount} following`,
                  })}
                </Text>
              </View>
            </View>
            <View style={styles.profileMetaInline}>
              {user?.profile?.location ? (
                <Text style={[styles.profileMetaText, { color: c.textMuted }]}>{user.profile.location}</Text>
              ) : null}
              <Text style={[styles.profileMetaText, { color: c.textMuted }]}>@{user?.username || profileRouteUsername}</Text>
            </View>
          </View>
        </View>

        {isOwnProfile ? (
          <View style={[styles.profileIdentityActions, isCompactProfileLayout ? styles.profileIdentityActionsCompact : null]}>
            <TouchableOpacity
              style={[styles.profilePrimaryBtn, { backgroundColor: c.primary }]}
              activeOpacity={0.85}
              onPress={() => onNotice(t('home.profileComingSoonAction'))}
            >
              <MaterialCommunityIcons name="plus" size={16} color="#fff" />
              <Text style={styles.profilePrimaryBtnText}>{t('home.profileAddStoryAction')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.profileSecondaryBtn, { backgroundColor: c.inputBackground, borderColor: c.border }]}
              activeOpacity={0.85}
              onPress={openEditProfileModal}
            >
              <MaterialCommunityIcons name="pencil-outline" size={16} color={c.textSecondary} />
              <Text style={[styles.profileSecondaryBtnText, { color: c.textPrimary }]}>{t('home.profileEditProfileAction')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.profileIdentityActions, isCompactProfileLayout ? styles.profileIdentityActionsCompact : null]}>
            <TouchableOpacity
              style={[
                styles.profilePrimaryBtn,
                isFollowing
                  ? { backgroundColor: c.inputBackground, borderWidth: 1, borderColor: c.border }
                  : { backgroundColor: c.primary },
              ]}
              activeOpacity={0.85}
              disabled={followLoading}
              onPress={() => onToggleFollow?.(user?.username || profileRouteUsername, isFollowing)}
            >
              {followLoading ? (
                <ActivityIndicator size="small" color={isFollowing ? c.textSecondary : '#fff'} />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name={isFollowing ? 'account-check' : 'account-plus'}
                    size={16}
                    color={isFollowing ? c.textSecondary : '#fff'}
                  />
                  <Text style={[styles.profilePrimaryBtnText, isFollowing ? { color: c.textSecondary } : {}]}>
                    {isFollowing
                      ? t('home.profileUnfollowAction', { defaultValue: 'Unfollow' })
                      : t('home.profileFollowAction', { defaultValue: 'Follow' })}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.profileSecondaryBtn, { backgroundColor: c.inputBackground, borderColor: c.border, paddingHorizontal: 10 }]}
              activeOpacity={0.85}
              onPress={() => setActionsMenuOpen(true)}
            >
              <MaterialCommunityIcons name="dots-horizontal" size={20} color={c.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        <ProfileActionsMenu
          visible={actionsMenuOpen}
          username={user?.username || profileRouteUsername}
          c={c}
          t={t}
          isConnected={isConnected}
          isFullyConnected={isFullyConnected}
          isPendingConfirmation={isPendingConfirmation}
          connectionCircleIds={connectionCircleIds}
          userCircles={userCircles}
          userLists={userLists}
          moderationCategories={moderationCategories}
          actionLoading={actionsLoading}
          onClose={() => setActionsMenuOpen(false)}
          onConnect={(circlesIds) => onConnect?.(circlesIds)}
          onUpdateConnection={(circlesIds) => onUpdateConnection?.(circlesIds)}
          onConfirmConnection={(circlesIds) => onConfirmConnection?.(circlesIds)}
          onDisconnect={() => onDisconnect?.()}
          onAddToList={onAddToList || (() => Promise.resolve())}
          onCreateList={onCreateList || (() => Promise.resolve(null))}
          onFetchEmojiGroups={onFetchEmojiGroups || (() => Promise.resolve([]))}
          onCreateCircle={onCreateCircle || (() => Promise.resolve(null))}
          onBlock={() => onBlockUser?.(user?.username || profileRouteUsername)}
          onReport={(catId, desc) => onReportUser?.(user?.username || profileRouteUsername, catId, desc)}
        />
      </View>

      <View style={[styles.profileTabsRow, { borderTopColor: c.border }]}>
        <Text style={[styles.profileTabText, { color: c.textSecondary }]}>
          {t('home.profileInfoRecentActivityTitle')}
        </Text>
      </View>

      <View style={[styles.profileBodyLayout, isCompactProfileLayout ? styles.profileBodyLayoutCompact : null]}>
          <View style={[styles.profileBodyLeft, isCompactProfileLayout ? styles.profileBodyLeftCompact : null]}>
            <View style={[styles.profileDetailCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}> 
              <View style={styles.profileSectionTitleRow}>
                <MaterialCommunityIcons name="account-details-outline" size={22} color={c.textPrimary} />
                <Text style={[styles.profileDetailTitle, styles.profileSectionTitleText, { color: c.textPrimary }]}>
                  {t('home.profilePersonalDetailsTitle')}
                </Text>
              </View>
              <View style={styles.profileDetailList}>
                {user?.profile?.location ? (
                  <View style={styles.profileDetailItem}>
                    <MaterialCommunityIcons name="map-marker-outline" size={18} color={c.textMuted} />
                    <Text style={[styles.profileDetailText, { color: c.textSecondary }]}>
                      {t('home.profileLivesInLabel', { location: user.profile.location })}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.profileDetailItem}>
                  <MaterialCommunityIcons name="at" size={18} color={c.textMuted} />
                  <Text style={[styles.profileDetailText, { color: c.textSecondary }]}>@{user?.username || profileRouteUsername}</Text>
                </View>
                {user?.profile?.bio ? (
                  <View style={styles.profileDetailItem}>
                    <MaterialCommunityIcons name="text-box-outline" size={18} color={c.textMuted} />
                    <Text style={[styles.profileDetailText, { color: c.textSecondary }]}>{user.profile.bio}</Text>
                  </View>
                ) : null}
                {user?.profile?.url ? (
                  <View style={styles.profileDetailItem}>
                    <MaterialCommunityIcons name="link-variant" size={18} color={c.textMuted} />
                    <Text style={[styles.profileDetailText, { color: c.textSecondary }]}>{user.profile.url}</Text>
                  </View>
                ) : null}
                <View style={styles.profileDetailItem}>
                  <MaterialCommunityIcons name="calendar-month-outline" size={18} color={c.textMuted} />
                  <Text style={[styles.profileDetailText, { color: c.textSecondary }]}> 
                    {t('home.profileJoinedLabel', {
                      date: user?.date_joined ? new Date(user.date_joined).toLocaleDateString() : '-',
                    })}
                  </Text>
                </View>
              </View>
            </View>

            <View style={[styles.profileDetailCard, { backgroundColor: c.inputBackground, borderColor: c.border, marginTop: 14 }]}>
              <View style={styles.profileSectionTitleRow}>
                <MaterialCommunityIcons name="account-group-outline" size={22} color={c.textPrimary} />
                <Text style={[styles.profileDetailTitle, styles.profileSectionTitleText, { color: c.textPrimary }]}>
                  {t('home.profileJoinedCommunitiesTitle', { defaultValue: "Communities I've joined" })}
                </Text>
              </View>

              {myJoinedCommunitiesLoading ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : shownJoinedCommunities.length === 0 ? (
                <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>
                  {t('home.profileJoinedCommunitiesEmpty', { defaultValue: 'No joined communities yet.' })}
                </Text>
              ) : (
                <View style={styles.profileCommunitiesGrid}>
                  {shownJoinedCommunities.map((community) => (
                    (() => {
                      const communityAvatarUri = resolveImageUri(community.avatar);
                      return (
                    <TouchableOpacity
                      key={`profile-joined-community-${community.id || 'na'}-${community.name || community.title || 'community'}`}
                      style={styles.profileCommunityTile}
                      activeOpacity={0.85}
                      onPress={() => {
                        if (!community.name) return;
                        onOpenCommunity(community.name);
                      }}
                    >
                      <View style={[styles.profileCommunityAvatarWrap, { borderColor: c.border, backgroundColor: c.surface }]}>
                        {communityAvatarUri ? (
                          <Image
                            source={{ uri: communityAvatarUri }}
                            style={styles.profileCommunityAvatar}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={[styles.profileCommunityAvatarFallback, { backgroundColor: c.primary }]}>
                            <Text style={styles.profileCommunityAvatarLetter}>
                              {(community.name?.[0] || community.title?.[0] || 'C').toUpperCase()}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text numberOfLines={1} style={[styles.profileCommunityName, { color: c.textPrimary }]}>
                        {community.name ? `c/${community.name}` : (community.title || 'c/community')}
                      </Text>
                    </TouchableOpacity>
                      );
                    })()
                  ))}
                </View>
              )}

              {canRequestMoreJoinedCommunities ? (
                <TouchableOpacity
                  style={[styles.profileShowMoreJoinedBtn, { borderColor: c.border, backgroundColor: c.surface }]}
                  activeOpacity={0.85}
                  disabled={myJoinedCommunitiesLoadingMore}
                  onPress={() => setVisibleJoinedCommunities((prev) => prev + 9)}
                >
                  {myJoinedCommunitiesLoadingMore ? (
                    <ActivityIndicator color={c.primary} size="small" />
                  ) : (
                    <Text style={[styles.profileShowMoreJoinedText, { color: c.textSecondary }]}>
                      {t('home.profileShowMoreCommunities', { defaultValue: 'Show more' })}
                    </Text>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={[styles.profileDetailCard, { backgroundColor: c.inputBackground, borderColor: c.border, marginTop: 14 }]}>
              <View style={styles.profileSectionTitleRow}>
                <MaterialCommunityIcons name="account-heart-outline" size={22} color={c.textPrimary} />
                <Text style={[styles.profileDetailTitle, styles.profileSectionTitleText, { color: c.textPrimary }]}>
                  {t('home.profileFollowingTitle', { defaultValue: 'Accounts I follow' })}
                </Text>
              </View>

              {myFollowingsLoading ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : shownFollowings.length === 0 ? (
                <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>
                  {t('home.profileFollowingEmpty', { defaultValue: 'Not following anyone yet.' })}
                </Text>
              ) : (
                <View style={styles.profileCommunitiesGrid}>
                  {shownFollowings.map((followedUser) => (
                    (() => {
                      const followingAvatarUri = resolveImageUri(followedUser.profile?.avatar);
                      return (
                    <TouchableOpacity
                      key={`profile-following-user-${followedUser.id}`}
                      style={styles.profileCommunityTile}
                      activeOpacity={0.85}
                      onPress={() => {
                        if (!followedUser.username) return;
                        onOpenProfile(followedUser.username);
                      }}
                    >
                      <View style={[styles.profileCommunityAvatarWrap, { borderColor: c.border, backgroundColor: c.surface }]}>
                        {followingAvatarUri ? (
                          <Image source={{ uri: followingAvatarUri }} style={styles.profileCommunityAvatar} resizeMode="cover" />
                        ) : (
                          <View style={[styles.profileCommunityAvatarFallback, { backgroundColor: c.primary }]}>
                            <Text style={styles.profileCommunityAvatarLetter}>
                              {(followedUser.username?.[0] || followedUser.profile?.name?.[0] || 'U').toUpperCase()}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text numberOfLines={1} style={[styles.profileCommunityName, { color: c.textPrimary }]}>
                        @{followedUser.username || 'user'}
                      </Text>
                    </TouchableOpacity>
                      );
                    })()
                  ))}
                </View>
              )}

              {canRequestMoreFollowings ? (
                <TouchableOpacity
                  style={[styles.profileShowMoreJoinedBtn, { borderColor: c.border, backgroundColor: c.surface }]}
                  activeOpacity={0.85}
                  disabled={myFollowingsLoadingMore}
                  onPress={() => setVisibleFollowings((prev) => prev + 9)}
                >
                  {myFollowingsLoadingMore ? (
                    <ActivityIndicator color={c.primary} size="small" />
                  ) : (
                    <Text style={[styles.profileShowMoreJoinedText, { color: c.textSecondary }]}>
                      {t('home.profileShowMoreFollowings', { defaultValue: 'Show more' })}
                    </Text>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View style={[styles.profileBodyRight, isCompactProfileLayout ? styles.profileBodyRightCompact : null]}>
            {isOwnProfile ? (
              <View style={[styles.profileComposerCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                <View style={styles.profileComposerTop}>
                  <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}>
                  <Image
                    source={avatarDisplayUri ? { uri: avatarDisplayUri } : DEFAULT_PROFILE_AVATAR}
                    style={styles.feedAvatarImage}
                    resizeMode="cover"
                  />
                  </View>
                  <TouchableOpacity
                    style={[styles.profileComposerInputMock, { borderColor: c.border, backgroundColor: c.surface }]}
                    activeOpacity={0.85}
                    onPress={() => onNotice(t('home.profileComingSoonAction'))}
                  >
                    <Text style={[styles.profileComposerInputText, { color: c.textMuted }]}> {t('home.profileWhatsOnMindTitle')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <View style={[styles.profilePostsCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
              <View style={styles.profileSectionTitleRow}>
                <MaterialCommunityIcons name="pin-outline" size={22} color={c.textPrimary} />
                <Text style={[styles.profileDetailTitle, styles.profileSectionTitleText, { color: c.textPrimary }]}>
                  {t('home.profilePinnedPostsTitle')}
                </Text>
              </View>
              {myPinnedPostsLoading ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : filteredPinnedPosts.length === 0 ? (
                <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>{t('home.profileNoPinnedPosts')}</Text>
              ) : (
                <View style={styles.feedList}>
                  {filteredPinnedPosts.map((post) => (
                    <React.Fragment key={`profile-pinned-post-${post.id}`}>{renderPostCard(post, 'profile')}</React.Fragment>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.profilePostsCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}> 
              <View style={styles.profileSectionTitleRow}>
                <MaterialCommunityIcons name="post-outline" size={22} color={c.textPrimary} />
                <Text style={[styles.profileDetailTitle, styles.profileSectionTitleText, { color: c.textPrimary }]}>
                  {t('home.profilePostsTitle')}
                </Text>
              </View>
              {myProfilePostsLoading ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : regularProfilePosts.length === 0 ? (
                <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>{t('home.profileNoPosts')}</Text>
              ) : (
                <View style={styles.feedList}>
                  {regularProfilePosts.map((post) => (
                    <React.Fragment key={`profile-post-${post.id}`}>{renderPostCard(post, 'profile')}</React.Fragment>
                  ))}
                </View>
              )}
            </View>
          </View>
      </View>
    </View>
  );
}
