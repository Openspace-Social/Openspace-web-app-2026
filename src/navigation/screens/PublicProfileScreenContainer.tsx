/**
 * PublicProfileScreenContainer — public user profile.
 *
 * Mirrors the mobile-web profile sections:
 *   1. Header — cover, avatar, name, @username, bio, location, counts
 *   2. Communities I've joined — grid of community avatars
 *   3. Accounts I follow — grid of user avatars
 *   4. Pinned posts — list of ConnectedPostCard
 *   5. Posts — filter chips (Community / Public / Comments), then content
 *
 * Reactions on posts are real (via useUserPostsData). Comments + the rest
 * of the post-interaction surface come from the same useNativePostInteractions
 * pipeline as the feed.
 *
 * Web (HomeScreen + MyProfileScreen) is intentionally untouched.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import { useUserPostsData } from '../../hooks/useUserPostsData';
import { useCommentsData } from '../../hooks/useCommentsData';
import { useNativePostInteractions } from '../../hooks/useNativePostInteractions';
import { useAutoPlayMedia } from '../../hooks/useAutoPlayMedia';
import ConnectedPostCard from '../../components/ConnectedPostCard';
import ReactionPickerDrawer from '../../components/ReactionPickerDrawer';
import EditProfileModal from '../../components/EditProfileModal';
import UserBadge from '../../components/UserBadge';
import { PostInteractionsProvider } from '../../contexts/PostInteractionsContext';
import { postCardStyles } from '../../styles/postCardStyles';
import { api, type FeedPost, type PostComment } from '../../api/client';
import type { HomeStackParamList } from '../AppNavigator';

type PublicUser = {
  username?: string;
  profile?: {
    name?: string;
    avatar?: string | null;
    cover?: string | null;
    bio?: string;
    location?: string;
    url?: string;
    badges?: Array<{ keyword?: string; keyword_description?: string }>;
  } | null;
  // The API omits `followers_count` (returns null/undefined) when the user
  // has hidden their followers count via privacy settings. Web treats that
  // as "don't render the chip" — we mirror that.
  followers_count?: number | null;
  // Following count can come back under multiple field names depending on
  // backend version; resolve them in order.
  following_count?: number | null;
  followings_count?: number | null;
  follows_count?: number | null;
  following?: { count?: number } | null;
  posts_count?: number;
  // Relationship flags returned by the API for non-own profiles. Used to
  // render the action bar (Follow / Connect / Subscribe / Block) and to
  // optimistically update on action.
  is_following?: boolean;
  is_followed?: boolean;
  is_connected?: boolean;
  is_fully_connected?: boolean;
  is_pending_connection_confirmation?: boolean;
  is_subscribed?: boolean;
  is_blocked?: boolean;
  connected_circles?: Array<{ id: number; name?: string; color?: string }> | null;
};

type CommunityLite = {
  id?: number | string;
  name?: string;
  title?: string;
  avatar?: string | { url?: string } | null;
};

type FollowingUser = {
  id?: number;
  username?: string;
  profile?: { avatar?: string | null; name?: string } | null;
};

type ActivityFilter = 'community' | 'public' | 'comments';

const COMMUNITIES_PAGE_SIZE = 9;
const FOLLOWINGS_PAGE_SIZE = 9;

function resolveImageUri(value?: string | { url?: string } | null): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.url) return value.url;
  return undefined;
}

export default function PublicProfileScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const autoPlayMedia = useAutoPlayMedia();
  const { showToast } = useAppToast();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<HomeStackParamList, 'Profile'>>();
  const username = route.params?.username;
  const insets = useSafeAreaInsets();

  const [user, setUser] = useState<PublicUser | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [currentUsername, setCurrentUsername] = useState<string | undefined>(undefined);

  // Own-profile edit state.
  const [editOpen, setEditOpen] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const isOwnProfile = !!currentUsername && !!username && currentUsername === username;

  // ── Profile-action state (Follow / Connect / Subscribe / Block) ──────
  // Loading flags are per-action so multiple concurrent in-flight calls
  // are reported independently. Connection-circle picker is its own
  // modal because the API requires a circle id list.
  const [followLoading, setFollowLoading] = useState(false);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [connectPickerOpen, setConnectPickerOpen] = useState<null | 'connect' | 'update' | 'confirm'>(null);
  const [circles, setCircles] = useState<Array<{ id: number; name?: string; color?: string }>>([]);
  const [connectSelectedIds, setConnectSelectedIds] = useState<number[]>([]);

  // Aux fetches
  const [pinnedPosts, setPinnedPosts] = useState<FeedPost[]>([]);
  const [pinnedLoading, setPinnedLoading] = useState(false);
  const [communities, setCommunities] = useState<CommunityLite[]>([]);
  const [communitiesLoading, setCommunitiesLoading] = useState(false);
  const [followings, setFollowings] = useState<FollowingUser[]>([]);
  const [followingsLoading, setFollowingsLoading] = useState(false);
  const [profileComments, setProfileComments] = useState<PostComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('community');

  const refreshUser = useCallback(async () => {
    if (!token || !username) return;
    try {
      const u = await api.getUserByUsername(token, username);
      setUser(u as PublicUser);
    } catch {
      // keep stale state
    }
  }, [token, username]);

  // Fetch the target user's profile.
  useEffect(() => {
    if (!token || !username) return;
    let active = true;
    setUserLoading(true);
    (async () => {
      try {
        const u = await api.getUserByUsername(token, username);
        if (active) setUser(u as PublicUser);
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setUserLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, username]);

  // ── Own-profile edit handlers ─────────────────────────────────────
  const pickAndUpload = useCallback(
    async (kind: 'avatar' | 'cover') => {
      if (!token) return;
      const setLoading = kind === 'avatar' ? setAvatarUploading : setCoverUploading;
      try {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          showToast(
            t('home.imagePickerPermissionDenied', {
              defaultValue: 'Allow photo library access to change your photo.',
            }),
          );
          return;
        }
        const picked = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: kind === 'avatar' ? [1, 1] : [16, 9],
          quality: 0.85,
        });
        if (picked.canceled || !picked.assets?.[0]?.uri) return;
        setLoading(true);
        const asset = picked.assets[0];
        // React Native's FormData has special handling for { uri, name,
        // type } — fetch(uri).blob() produces an empty blob on iOS for
        // file:// URIs, so we pass the asset descriptor directly and let
        // the platform read the file when uploading.
        const inferredName = (asset.fileName || (kind === 'avatar' ? 'avatar.jpg' : 'cover.jpg'));
        const inferredType = asset.mimeType || 'image/jpeg';
        const fileObj = {
          uri: asset.uri,
          name: inferredName,
          type: inferredType,
        } as any;
        await api.updateAuthenticatedUserWithMedia(
          token,
          {},
          kind === 'avatar' ? { avatarFile: fileObj } : { coverFile: fileObj },
        );
        await refreshUser();
        showToast(
          t(kind === 'avatar' ? 'home.avatarUpdated' : 'home.coverUpdated', {
            defaultValue: kind === 'avatar' ? 'Avatar updated' : 'Cover updated',
          }),
          { type: 'success' },
        );
      } catch (e: any) {
        showToast(e?.message || 'Could not update photo.', { type: 'error' });
      } finally {
        setLoading(false);
      }
    },
    [token, refreshUser, showToast, t],
  );

  const saveProfileFields = useCallback(
    async (next: { name: string; bio: string; location: string; url: string }) => {
      if (!token) return;
      await api.updateAuthenticatedUser(token, {
        name: next.name,
        bio: next.bio,
        location: next.location,
        url: next.url,
      });
      await refreshUser();
      showToast(
        t('home.profileUpdated', { defaultValue: 'Profile updated' }),
        { type: 'success' },
      );
    },
    [token, refreshUser, showToast, t],
  );

  // ── Profile-action handlers ─────────────────────────────────────────
  // Each handler optimistically flips the relevant flag(s) on the user
  // object so the UI reflects the new state immediately, then refreshes
  // from the API to pick up authoritative values (counts, etc.). Errors
  // surface via toast and do NOT roll back — easier to leave the API as
  // the source of truth via the next refreshUser().

  const handleToggleFollow = useCallback(async () => {
    if (!token || !username || followLoading) return;
    const wasFollowing = !!user?.is_following;
    setFollowLoading(true);
    setUser((prev) => (prev ? { ...prev, is_following: !wasFollowing } : prev));
    try {
      if (wasFollowing) await api.unfollowUser(token, username);
      else await api.followUser(token, username);
      await refreshUser();
    } catch (e: any) {
      setUser((prev) => (prev ? { ...prev, is_following: wasFollowing } : prev));
      showToast(e?.message || t('home.profileFollowFailed', { defaultValue: 'Could not update follow.' }), { type: 'error' });
    } finally {
      setFollowLoading(false);
    }
  }, [token, username, followLoading, user?.is_following, refreshUser, showToast, t]);

  const handleToggleSubscribe = useCallback(async () => {
    if (!token || !username || subscribeLoading) return;
    const wasSubscribed = !!user?.is_subscribed;
    setSubscribeLoading(true);
    setUser((prev) => (prev ? { ...prev, is_subscribed: !wasSubscribed } : prev));
    try {
      if (wasSubscribed) await api.unsubscribeFromUserNewPostNotifications(token, username);
      else await api.subscribeToUserNewPostNotifications(token, username);
      showToast(
        wasSubscribed
          ? t('home.profileUnsubscribed', { defaultValue: 'Notifications turned off.' })
          : t('home.profileSubscribed', { defaultValue: 'Notifications turned on.' }),
        { type: 'success' },
      );
    } catch (e: any) {
      setUser((prev) => (prev ? { ...prev, is_subscribed: wasSubscribed } : prev));
      showToast(e?.message || t('home.profileSubscribeFailed', { defaultValue: 'Could not update notifications.' }), { type: 'error' });
    } finally {
      setSubscribeLoading(false);
    }
  }, [token, username, subscribeLoading, user?.is_subscribed, showToast, t]);

  const handleToggleBlock = useCallback(async () => {
    if (!token || !username || blockLoading) return;
    const wasBlocked = !!user?.is_blocked;
    setBlockLoading(true);
    // Optimistic flip — getUserByUsername returns the same `is_blocked`
    // value we just set on the server, but some backend versions hide
    // the field on blocked profiles, so the refresh below isn't always
    // sufficient on its own.
    setUser((prev) => (prev ? { ...prev, is_blocked: !wasBlocked } : prev));
    try {
      if (wasBlocked) await api.unblockUser(token, username);
      else await api.blockUser(token, username);
      try {
        await refreshUser();
        // Re-assert the optimistic flag after the refresh in case the
        // API didn't echo it back (it can return null when the relation
        // changes how the profile is rendered).
        setUser((prev) => (prev ? { ...prev, is_blocked: !wasBlocked } : prev));
      } catch {
        /* refresh failed, keep optimistic value */
      }
      showToast(
        wasBlocked
          ? t('home.profileUnblocked', { defaultValue: 'User unblocked.' })
          : t('home.profileBlocked', { defaultValue: 'User blocked.' }),
        { type: 'success' },
      );
    } catch (e: any) {
      // Roll back optimistic update on failure.
      setUser((prev) => (prev ? { ...prev, is_blocked: wasBlocked } : prev));
      showToast(e?.message || t('home.profileBlockFailed', { defaultValue: 'Could not update block.' }), { type: 'error' });
    } finally {
      setBlockLoading(false);
    }
  }, [token, username, blockLoading, user?.is_blocked, refreshUser, showToast, t]);

  const handleDisconnect = useCallback(async () => {
    if (!token || !username || connectionLoading) return;
    setConnectionLoading(true);
    try {
      await api.disconnectFromUser(token, username);
      await refreshUser();
      showToast(t('home.profileDisconnected', { defaultValue: 'Disconnected.' }), { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || t('home.profileDisconnectFailed', { defaultValue: 'Could not disconnect.' }), { type: 'error' });
    } finally {
      setConnectionLoading(false);
    }
  }, [token, username, connectionLoading, refreshUser, showToast, t]);

  // Open the circle picker. `mode` controls which API call we use on
  // submit. We lazy-load the user's circles the first time it opens.
  const openConnectPicker = useCallback(
    async (mode: 'connect' | 'update' | 'confirm') => {
      setConnectSelectedIds(
        Array.isArray(user?.connected_circles) ? user!.connected_circles!.map((cc) => cc.id) : [],
      );
      setConnectPickerOpen(mode);
      if (token && circles.length === 0) {
        try {
          const list = await api.getCircles(token);
          setCircles(Array.isArray(list) ? (list as any) : []);
        } catch {
          /* keep empty; UI will show the empty state */
        }
      }
    },
    [token, circles.length, user?.connected_circles],
  );

  const submitConnectPicker = useCallback(async () => {
    if (!token || !username || !connectPickerOpen || connectionLoading) return;
    const ids = connectSelectedIds;
    setConnectionLoading(true);
    try {
      if (connectPickerOpen === 'connect') await api.connectWithUser(token, username, ids);
      else if (connectPickerOpen === 'update') await api.updateConnection(token, username, ids);
      else await api.confirmConnection(token, username, ids);
      await refreshUser();
      setConnectPickerOpen(null);
      showToast(
        connectPickerOpen === 'confirm'
          ? t('home.profileConnectionConfirmed', { defaultValue: 'Connection confirmed.' })
          : connectPickerOpen === 'update'
            ? t('home.profileConnectionUpdated', { defaultValue: 'Connection updated.' })
            : t('home.profileConnected', { defaultValue: 'Connection request sent.' }),
        { type: 'success' },
      );
    } catch (e: any) {
      showToast(e?.message || t('home.profileConnectionFailed', { defaultValue: 'Could not update connection.' }), { type: 'error' });
    } finally {
      setConnectionLoading(false);
    }
  }, [token, username, connectPickerOpen, connectionLoading, connectSelectedIds, refreshUser, showToast, t]);

  // Fetch pinned posts.
  useEffect(() => {
    if (!token || !username) return;
    let active = true;
    setPinnedLoading(true);
    (async () => {
      try {
        const list = await api.getPinnedPosts(token, username, 10);
        if (active) setPinnedPosts(Array.isArray(list) ? list : []);
      } catch {
        if (active) setPinnedPosts([]);
      } finally {
        if (active) setPinnedLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, username]);

  // Fetch joined communities. Matching web exactly: no sort param —
  // some backend versions return empty when sort=most_active is set.
  useEffect(() => {
    if (!token || !username) return;
    let active = true;
    setCommunitiesLoading(true);
    (async () => {
      try {
        const list = await api.getUserCommunities(token, username);
        if (active) setCommunities(Array.isArray(list) ? (list as any) : []);
      } catch {
        if (active) setCommunities([]);
      } finally {
        if (active) setCommunitiesLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, username]);

  // Fetch followings (people this user follows).
  useEffect(() => {
    if (!token || !username) return;
    let active = true;
    setFollowingsLoading(true);
    (async () => {
      try {
        const list = await api.getFollowings(token, 30, undefined, username);
        if (active) setFollowings(Array.isArray(list) ? (list as any) : []);
      } catch {
        if (active) setFollowings([]);
      } finally {
        if (active) setFollowingsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, username]);

  // Fetch comments.
  useEffect(() => {
    if (!token || !username) return;
    let active = true;
    setCommentsLoading(true);
    (async () => {
      try {
        const list = await api.getUserComments(token, username, 20);
        if (active) setProfileComments(Array.isArray(list) ? list : []);
      } catch {
        if (active) setProfileComments([]);
      } finally {
        if (active) setCommentsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, username]);

  // Fetch the current user once for owner-gating PostCard's controls.
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try {
        const me: any = await api.getAuthenticatedUser(token);
        if (active) setCurrentUsername(me?.username);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const {
    posts, loading, refreshing, error, refresh,
    reactionGroups, reactionGroupsLoading, reactionActionLoading,
    ensureReactionGroups, reactToPost,
  } = useUserPostsData(token, username);

  const allPosts = useMemo(() => [...pinnedPosts, ...posts], [pinnedPosts, posts]);
  const comments = useCommentsData(token, allPosts);

  // Reaction picker modal state.
  const [reactionPickerPost, setReactionPickerPost] = useState<FeedPost | null>(null);
  const openReactionPicker = useCallback((p: FeedPost) => setReactionPickerPost(p), []);
  const closeReactionPicker = useCallback(() => setReactionPickerPost(null), []);
  const handlePickReaction = useCallback(
    (emojiId: number) => {
      if (!reactionPickerPost) return;
      const target = reactionPickerPost;
      setReactionPickerPost(null);
      void reactToPost(target, emojiId);
    },
    [reactionPickerPost, reactToPost],
  );

  const interactions = useNativePostInteractions({
    reactionGroups,
    reactionPickerLoading: reactionGroupsLoading,
    reactionActionLoading,
    ensureReactionGroups,
    reactToPost,
    openReactionPicker,
    comments,
  });

  const c = theme.colors;

  // Filter posts for the activity tabs.
  const communityPosts = useMemo(
    () => posts.filter((p: any) => !!p?.community),
    [posts],
  );
  const publicPosts = useMemo(
    () => posts.filter((p: any) => !p?.community),
    [posts],
  );

  // ── Followers / Following counts ──────────────────────────────────
  // Followers: web shows the chip only when the API returns a real number.
  // When the user has the privacy setting enabled the API returns null /
  // undefined, and the chip is hidden entirely (rather than reading "0").
  const followersCountRaw = user?.followers_count;
  const hasResolvedFollowersCount =
    followersCountRaw !== null &&
    followersCountRaw !== undefined &&
    Number.isFinite(Number(followersCountRaw));
  const resolvedFollowersCount = hasResolvedFollowersCount ? Number(followersCountRaw) : 0;

  // Following: backend uses different field names across versions —
  // probe them in order, then fall back to the loaded list's length so
  // the chip shows something accurate even if the count field is missing.
  const followingCountRaw =
    user?.following_count ??
    user?.followings_count ??
    user?.follows_count ??
    user?.following?.count;
  const resolvedFollowingCount = Number.isFinite(Number(followingCountRaw))
    ? Number(followingCountRaw)
    : followings.length;

  const renderPost = useCallback(
    (post: FeedPost, key: string) => (
      <View key={key} style={styles.postWrap}>
        <ConnectedPostCard
          post={post}
          variant="profile"
          styles={postCardStyles}
          c={c}
          t={t}
          currentUsername={currentUsername}
          token={token ?? undefined}
          autoPlayMedia={autoPlayMedia}
          isPostDetailOpen={false}
          allowExpandControl
          showFollowButton={false}
        />
      </View>
    ),
    [c, t, currentUsername, token],
  );

  // Horizontal sliders show the first batch in a single row; tapping
  // "Show more" navigates to a dedicated full-screen list.
  const shownCommunities = communities.slice(0, COMMUNITIES_PAGE_SIZE);
  const shownFollowings = followings.slice(0, FOLLOWINGS_PAGE_SIZE);
  const canShowMoreCommunities = communities.length > COMMUNITIES_PAGE_SIZE;
  const canShowMoreFollowings = followings.length > FOLLOWINGS_PAGE_SIZE;

  if (userLoading && !user) {
    return (
      <View style={[styles.centered, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} size="large" />
      </View>
    );
  }

  return (
    <PostInteractionsProvider value={interactions}>
      <ReactionPickerDrawer
        visible={!!reactionPickerPost}
        groups={reactionGroups}
        loading={reactionGroupsLoading}
        actionLoading={reactionActionLoading}
        onPick={handlePickReaction}
        onClose={closeReactionPicker}
        c={c}
        t={t}
        title={t('home.reactToPostTitle', { defaultValue: 'React to post' })}
      />
      {isOwnProfile ? (
        <EditProfileModal
          visible={editOpen}
          onClose={() => setEditOpen(false)}
          initial={{
            name: user?.profile?.name,
            bio: user?.profile?.bio,
            location: user?.profile?.location,
            url: user?.profile?.url,
          }}
          onSave={saveProfileFields}
        />
      ) : null}
      <ScrollView
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void refresh(); }}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        {/* Cover */}
        <View style={[styles.cover, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
          {user?.profile?.cover ? (
            <Image source={{ uri: user.profile.cover }} style={styles.coverImage} resizeMode="cover" />
          ) : null}
          {isOwnProfile ? (
            <TouchableOpacity
              style={styles.coverEditBtn}
              activeOpacity={0.85}
              disabled={coverUploading}
              onPress={() => { void pickAndUpload('cover'); }}
              accessibilityLabel={t('home.profileEditCoverAction', { defaultValue: 'Change cover photo' })}
            >
              {coverUploading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <MaterialCommunityIcons name="camera-outline" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          ) : null}
        </View>
        {/* Identity row */}
        <View style={styles.headerRow}>
          <View>
            <View style={[styles.avatar, { backgroundColor: c.primary, borderColor: c.surface }]}>
              {user?.profile?.avatar ? (
                <Image source={{ uri: user.profile.avatar }} style={styles.avatarImage} resizeMode="cover" />
              ) : (
                <Text style={styles.avatarLetter}>{(user?.username?.[0] || 'O').toUpperCase()}</Text>
              )}
            </View>
            {isOwnProfile ? (
              <TouchableOpacity
                style={[styles.avatarEditBtn, { backgroundColor: c.primary, borderColor: c.surface }]}
                activeOpacity={0.85}
                disabled={avatarUploading}
                onPress={() => { void pickAndUpload('avatar'); }}
                accessibilityLabel={t('home.profileEditAvatarAction', { defaultValue: 'Change avatar' })}
              >
                {avatarUploading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <MaterialCommunityIcons name="camera-outline" size={14} color="#fff" />
                )}
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.metaCol}>
            <View style={styles.nameRow}>
              <Text numberOfLines={1} style={[styles.displayName, { color: c.textPrimary, flexShrink: 1 }]}>
                {user?.profile?.name || user?.username || ''}
              </Text>
              <UserBadge badges={user?.profile?.badges} size={20} />
              {isOwnProfile ? (
                <TouchableOpacity
                  style={[styles.editProfileBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  activeOpacity={0.85}
                  onPress={() => setEditOpen(true)}
                >
                  <MaterialCommunityIcons name="pencil-outline" size={14} color={c.textSecondary} />
                  <Text style={[styles.editProfileText, { color: c.textPrimary }]}>
                    {t('home.profileEditProfileAction', { defaultValue: 'Edit' })}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text numberOfLines={1} style={[styles.handle, { color: c.textMuted }]}>
              @{user?.username || username}
            </Text>
            <View style={styles.countsRow}>
              <CountChip label={t('home.profileCountPosts', { defaultValue: 'Posts' })} value={user?.posts_count ?? 0} c={c} />
              {hasResolvedFollowersCount ? (
                <CountChip label={t('home.profileCountFollowers', { defaultValue: 'Followers' })} value={resolvedFollowersCount} c={c} />
              ) : null}
              <CountChip label={t('home.profileCountFollowing', { defaultValue: 'Following' })} value={resolvedFollowingCount} c={c} />
            </View>
          </View>
        </View>
        {user?.profile?.bio ? (
          <Text style={[styles.bio, { color: c.textSecondary }]}>{user.profile.bio}</Text>
        ) : null}
        {user?.profile?.location ? (
          <View style={styles.locationRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={14} color={c.textMuted} />
            <Text style={[styles.locationText, { color: c.textMuted }]}>{user.profile.location}</Text>
          </View>
        ) : null}

        {/* Action bar — only on other users' profiles. */}
        {!isOwnProfile && user ? (
          <View style={styles.actionBar}>
            <TouchableOpacity
              style={[
                styles.actionBtnPrimary,
                {
                  backgroundColor: user.is_following ? c.inputBackground : c.primary,
                  borderColor: user.is_following ? c.border : c.primary,
                },
              ]}
              activeOpacity={0.85}
              disabled={followLoading}
              onPress={() => { void handleToggleFollow(); }}
            >
              {followLoading ? (
                <ActivityIndicator size="small" color={user.is_following ? c.textPrimary : '#fff'} />
              ) : (
                <Text
                  style={[
                    styles.actionBtnPrimaryText,
                    { color: user.is_following ? c.textPrimary : '#fff' },
                  ]}
                >
                  {user.is_following
                    ? t('home.profileUnfollowAction', { defaultValue: 'Unfollow' })
                    : t('home.profileFollowAction', { defaultValue: 'Follow' })}
                </Text>
              )}
            </TouchableOpacity>

            {/* Connect / Pending / Confirm — state varies by relationship. */}
            <TouchableOpacity
              style={[styles.actionBtnSecondary, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              disabled={connectionLoading}
              onPress={() => {
                if (connectionLoading) return;
                if (user.is_pending_connection_confirmation) {
                  void openConnectPicker('confirm');
                } else if (user.is_connected) {
                  void openConnectPicker('update');
                } else {
                  void openConnectPicker('connect');
                }
              }}
            >
              {connectionLoading ? (
                <ActivityIndicator size="small" color={c.textPrimary} />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name={
                      user.is_fully_connected
                        ? 'account-check'
                        : user.is_pending_connection_confirmation
                          ? 'account-clock-outline'
                          : 'account-plus-outline'
                    }
                    size={14}
                    color={c.textSecondary}
                  />
                  <Text style={[styles.actionBtnSecondaryText, { color: c.textPrimary }]}>
                    {user.is_pending_connection_confirmation
                      ? t('home.profileConfirmConnectionAction', { defaultValue: 'Confirm' })
                      : user.is_fully_connected
                        ? t('home.profileEditCirclesAction', { defaultValue: 'Edit circles' })
                        : user.is_connected
                          ? t('home.profilePendingConnectionAction', { defaultValue: 'Pending' })
                          : t('home.profileConnectAction', { defaultValue: 'Connect' })}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {/* More menu — Subscribe / Disconnect / Block */}
            <TouchableOpacity
              style={[styles.actionBtnIcon, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={() => setActionMenuOpen((o) => !o)}
            >
              <MaterialCommunityIcons name="dots-horizontal" size={18} color={c.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Communities I've joined */}
        <SectionCard
          c={c}
          icon="account-group-outline"
          title={t('home.profileJoinedCommunitiesTitle', { defaultValue: "Communities I've joined" })}
          subtitle={t('home.profileJoinedCommunitiesSortedByActivity', { defaultValue: 'Sorted by most active' })}
          headerRight={
            canShowMoreCommunities && username ? (
              <ShowMoreLink
                c={c}
                label={t('home.profileShowMoreCommunities', { defaultValue: 'Show more' })}
                onPress={() => navigation.navigate('UserCommunities', { username })}
              />
            ) : null
          }
        >
          {communitiesLoading && communities.length === 0 ? (
            <ActivityIndicator color={c.primary} size="small" />
          ) : shownCommunities.length === 0 ? (
            <Text style={[styles.emptyRow, { color: c.textMuted }]}>
              {t('home.profileJoinedCommunitiesEmpty', { defaultValue: 'No joined communities yet.' })}
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.sliderContent}
            >
              {shownCommunities.map((community) => {
                const avatarUri = resolveImageUri(community.avatar);
                return (
                  <TouchableOpacity
                    key={`community-${community.id}-${community.name}`}
                    style={styles.sliderTile}
                    activeOpacity={0.85}
                    onPress={() => {
                      if (community.name) navigation.navigate('Community', { name: community.name });
                    }}
                  >
                    <View style={[styles.tileAvatarWrap, { borderColor: c.border, backgroundColor: c.surface }]}>
                      {avatarUri ? (
                        <Image source={{ uri: avatarUri }} style={styles.tileAvatar} resizeMode="cover" />
                      ) : (
                        <View style={[styles.tileAvatarFallback, { backgroundColor: c.primary }]}>
                          <Text style={styles.tileAvatarLetter}>
                            {(community.name?.[0] || community.title?.[0] || 'C').toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text numberOfLines={1} style={[styles.tileLabel, { color: c.textPrimary }]}>
                      {community.name ? `c/${community.name}` : (community.title || 'c/community')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </SectionCard>

        {/* Accounts I follow */}
        <SectionCard
          c={c}
          icon="account-heart-outline"
          title={t('home.profileFollowingTitle', { defaultValue: 'Accounts I follow' })}
          headerRight={
            canShowMoreFollowings && username ? (
              <ShowMoreLink
                c={c}
                label={t('home.profileShowMoreFollowings', { defaultValue: 'Show more' })}
                onPress={() => navigation.navigate('UserFollowings', { username })}
              />
            ) : null
          }
        >
          {followingsLoading && followings.length === 0 ? (
            <ActivityIndicator color={c.primary} size="small" />
          ) : shownFollowings.length === 0 ? (
            <Text style={[styles.emptyRow, { color: c.textMuted }]}>
              {t('home.profileFollowingEmpty', { defaultValue: 'Not following anyone yet.' })}
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.sliderContent}
            >
              {shownFollowings.map((followed) => {
                const avatarUri = resolveImageUri(followed.profile?.avatar);
                return (
                  <TouchableOpacity
                    key={`following-${followed.id}-${followed.username}`}
                    style={styles.sliderTile}
                    activeOpacity={0.85}
                    onPress={() => {
                      if (followed.username) navigation.navigate('Profile', { username: followed.username });
                    }}
                  >
                    <View style={[styles.tileAvatarWrap, { borderColor: c.border, backgroundColor: c.surface }]}>
                      {avatarUri ? (
                        <Image source={{ uri: avatarUri }} style={styles.tileAvatar} resizeMode="cover" />
                      ) : (
                        <View style={[styles.tileAvatarFallback, { backgroundColor: c.primary }]}>
                          <Text style={styles.tileAvatarLetter}>
                            {(followed.username?.[0] || followed.profile?.name?.[0] || 'U').toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text numberOfLines={1} style={[styles.tileLabel, { color: c.textPrimary }]}>
                      @{followed.username || 'user'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </SectionCard>

        {/* Pinned posts */}
        <SectionCard
          c={c}
          icon="pin-outline"
          title={t('home.profilePinnedPostsTitle', { defaultValue: 'Pinned posts' })}
        >
          {pinnedLoading && pinnedPosts.length === 0 ? (
            <ActivityIndicator color={c.primary} size="small" />
          ) : pinnedPosts.length === 0 ? (
            <Text style={[styles.emptyRow, { color: c.textMuted }]}>
              {t('home.profileNoPinnedPosts', { defaultValue: 'No pinned posts yet.' })}
            </Text>
          ) : (
            <View>
              {pinnedPosts.map((p) => renderPost(p, `pinned-${(p as any).id}`))}
            </View>
          )}
        </SectionCard>

        {/* Posts (Community / Public / Comments) */}
        <SectionCard
          c={c}
          icon="post-outline"
          title={t('home.profilePostsTitle', { defaultValue: 'Posts' })}
        >
          <View style={styles.filterRow}>
            <FilterChip
              c={c}
              active={activityFilter === 'community'}
              label={t('home.profileActivityCommunityPosts', { defaultValue: 'Community' })}
              onPress={() => setActivityFilter('community')}
            />
            <FilterChip
              c={c}
              active={activityFilter === 'public'}
              label={t('home.profileActivityPublicPosts', { defaultValue: 'Public' })}
              onPress={() => setActivityFilter('public')}
            />
            <FilterChip
              c={c}
              active={activityFilter === 'comments'}
              label={t('home.profileActivityComments', { defaultValue: 'Comments' })}
              onPress={() => setActivityFilter('comments')}
            />
          </View>

          {activityFilter === 'comments' ? (
            commentsLoading && profileComments.length === 0 ? (
              <ActivityIndicator color={c.primary} size="small" />
            ) : profileComments.length === 0 ? (
              <Text style={[styles.emptyRow, { color: c.textMuted }]}>
                {t('home.profileActivityNoComments', { defaultValue: 'No recent comments yet.' })}
              </Text>
            ) : (
              <View style={styles.commentList}>
                {profileComments.map((comment: any) => (
                  <View
                    key={`comment-${comment.id}`}
                    style={[styles.commentCard, { borderColor: c.border, backgroundColor: c.surface }]}
                  >
                    <Text style={[styles.commentText, { color: c.textPrimary }]}>
                      {comment.text || t('home.profileActivityEmptyComment', { defaultValue: 'Comment with media' })}
                    </Text>
                    <Text style={[styles.commentMeta, { color: c.textMuted }]}>
                      {comment.post?.community?.name
                        ? `c/${comment.post.community.name}`
                        : t('home.profileActivityPublicPostLabel', { defaultValue: 'Public post' })}
                      {' • '}
                      {comment.created ? new Date(comment.created).toLocaleString() : '-'}
                    </Text>
                  </View>
                ))}
              </View>
            )
          ) : loading && posts.length === 0 ? (
            <ActivityIndicator color={c.primary} size="small" />
          ) : error && posts.length === 0 ? (
            <Text style={[styles.emptyRow, { color: c.errorText }]}>{error}</Text>
          ) : (activityFilter === 'community' ? communityPosts : publicPosts).length === 0 ? (
            <Text style={[styles.emptyRow, { color: c.textMuted }]}>
              {activityFilter === 'community'
                ? t('home.profileActivityNoCommunityPosts', { defaultValue: 'No recent community posts yet.' })
                : t('home.profileActivityNoPublicPosts', { defaultValue: 'No recent public posts yet.' })}
            </Text>
          ) : (
            <View>
              {(activityFilter === 'community' ? communityPosts : publicPosts).map((p) =>
                renderPost(p, `${activityFilter}-${(p as any).id}`),
              )}
            </View>
          )}
        </SectionCard>
      </ScrollView>

      {/* More-actions page — full-screen modal opened from the ⋯ button.
       *  Replaces the inline dropdown so each action gets a clear, tappable
       *  row with breathing room, and the title bar tells the user where
       *  they are. */}
      <Modal
        visible={!isOwnProfile && actionMenuOpen}
        animationType="slide"
        onRequestClose={() => setActionMenuOpen(false)}
        presentationStyle="fullScreen"
      >
        <View style={{ flex: 1, backgroundColor: c.background }}>
          <View style={{ height: insets.top, backgroundColor: c.surface }} />
          <View style={[styles.actionPageHeader, { borderBottomColor: c.border, backgroundColor: c.surface }]}>
            <TouchableOpacity
              onPress={() => setActionMenuOpen(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="arrow-left" size={22} color={c.textSecondary} />
            </TouchableOpacity>
            <Text style={[styles.actionPageTitle, { color: c.textPrimary }]} numberOfLines={1}>
              {t('home.profileActionsTitle', { defaultValue: 'More actions' })}
              {username ? ` · @${username}` : ''}
            </Text>
            <View style={{ width: 22 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 14 }}>
            <View style={[styles.actionPageGroup, { borderColor: c.border, backgroundColor: c.surface }]}>
              <TouchableOpacity
                style={styles.actionPageRow}
                activeOpacity={0.7}
                disabled={subscribeLoading}
                onPress={() => { setActionMenuOpen(false); void handleToggleSubscribe(); }}
              >
                <MaterialCommunityIcons
                  name={user?.is_subscribed ? 'bell-off-outline' : 'bell-outline'}
                  size={20}
                  color={c.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionPageRowTitle, { color: c.textPrimary }]}>
                    {user?.is_subscribed
                      ? t('home.profileUnsubscribeAction', { defaultValue: 'Turn off post notifications' })
                      : t('home.profileSubscribeAction', { defaultValue: 'Notify me of new posts' })}
                  </Text>
                  <Text style={[styles.actionPageRowSub, { color: c.textMuted }]}>
                    {user?.is_subscribed
                      ? t('home.profileUnsubscribeHint', { defaultValue: 'You won\u2019t be alerted for their new posts.' })
                      : t('home.profileSubscribeHint', { defaultValue: 'Get a push for every new post they publish.' })}
                  </Text>
                </View>
                {subscribeLoading ? <ActivityIndicator size="small" color={c.textMuted} /> : (
                  <MaterialCommunityIcons name="chevron-right" size={20} color={c.textMuted} />
                )}
              </TouchableOpacity>

              {user?.is_connected ? (
                <TouchableOpacity
                  style={[styles.actionPageRow, { borderTopColor: c.border, borderTopWidth: 1 }]}
                  activeOpacity={0.7}
                  disabled={connectionLoading}
                  onPress={() => {
                    setActionMenuOpen(false);
                    Alert.alert(
                      t('home.profileDisconnectConfirmTitle', { defaultValue: 'Disconnect?' }),
                      t('home.profileDisconnectConfirmBody', { defaultValue: 'You can reconnect later if you change your mind.' }),
                      [
                        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                        { text: t('home.profileDisconnectAction', { defaultValue: 'Disconnect' }), style: 'destructive', onPress: () => { void handleDisconnect(); } },
                      ],
                    );
                  }}
                >
                  <MaterialCommunityIcons name="account-minus-outline" size={20} color={c.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.actionPageRowTitle, { color: c.textPrimary }]}>
                      {t('home.profileDisconnectAction', { defaultValue: 'Disconnect' })}
                    </Text>
                    <Text style={[styles.actionPageRowSub, { color: c.textMuted }]}>
                      {t('home.profileDisconnectHint', { defaultValue: 'Remove them from your circles.' })}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={c.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={[styles.actionPageGroup, { borderColor: c.border, backgroundColor: c.surface, marginTop: 14 }]}>
              <TouchableOpacity
                style={styles.actionPageRow}
                activeOpacity={0.7}
                disabled={blockLoading}
                onPress={() => {
                  setActionMenuOpen(false);
                  if (user?.is_blocked) {
                    void handleToggleBlock();
                  } else {
                    Alert.alert(
                      t('home.profileBlockConfirmTitle', { defaultValue: 'Block this user?' }),
                      t('home.profileBlockConfirmBody', { defaultValue: 'They won\u2019t be able to see your posts or interact with you.' }),
                      [
                        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                        { text: t('home.profileBlockAction', { defaultValue: 'Block' }), style: 'destructive', onPress: () => { void handleToggleBlock(); } },
                      ],
                    );
                  }
                }}
              >
                <MaterialCommunityIcons
                  name={user?.is_blocked ? 'account-cancel' : 'account-cancel-outline'}
                  size={20}
                  color={c.errorText || '#dc2626'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionPageRowTitle, { color: c.errorText || '#dc2626' }]}>
                    {user?.is_blocked
                      ? t('home.profileUnblockAction', { defaultValue: 'Unblock' })
                      : t('home.profileBlockAction', { defaultValue: 'Block' })}
                  </Text>
                  <Text style={[styles.actionPageRowSub, { color: c.textMuted }]}>
                    {user?.is_blocked
                      ? t('home.profileUnblockHint', { defaultValue: 'They\u2019ll be able to see your posts again.' })
                      : t('home.profileBlockHint', { defaultValue: 'They won\u2019t be able to see your posts or contact you.' })}
                  </Text>
                </View>
                {blockLoading ? <ActivityIndicator size="small" color={c.textMuted} /> : (
                  <MaterialCommunityIcons name="chevron-right" size={20} color={c.textMuted} />
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Connect circle picker — opened from the action bar's Connect /
       *  Pending / Confirm button. The user picks zero or more of their
       *  circles to scope the connection to. Submitting calls the right
       *  api method based on the open mode (connect | update | confirm). */}
      {connectPickerOpen ? (
        <View style={[StyleSheet.absoluteFillObject, styles.modalScrim]}>
          <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.modalTitle, { color: c.textPrimary }]}>
              {connectPickerOpen === 'confirm'
                ? t('home.profileConfirmConnectionTitle', { defaultValue: 'Confirm connection' })
                : connectPickerOpen === 'update'
                  ? t('home.profileEditCirclesTitle', { defaultValue: 'Edit connection circles' })
                  : t('home.profileConnectTitle', { defaultValue: 'Connect with @' }) + (username || '')}
            </Text>
            <Text style={[styles.modalSubtitle, { color: c.textMuted }]}>
              {t('home.profileConnectCirclesHint', { defaultValue: 'Pick the circles this person belongs to (optional).' })}
            </Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {circles.length === 0 ? (
                <Text style={[styles.emptyRow, { color: c.textMuted }]}>
                  {t('home.profileConnectNoCircles', { defaultValue: "You don't have any circles yet." })}
                </Text>
              ) : (
                circles.map((cc) => {
                  const selected = connectSelectedIds.includes(cc.id);
                  const dot = cc.color || c.primary;
                  return (
                    <TouchableOpacity
                      key={`circle-${cc.id}`}
                      activeOpacity={0.85}
                      onPress={() => {
                        setConnectSelectedIds((prev) =>
                          prev.includes(cc.id) ? prev.filter((id) => id !== cc.id) : [...prev, cc.id],
                        );
                      }}
                      style={[styles.circleRow, { borderColor: c.border, backgroundColor: selected ? `${dot}22` : c.inputBackground }]}
                    >
                      <View style={[styles.circleDot, { backgroundColor: dot }]} />
                      <Text style={[styles.circleName, { color: c.textPrimary }]} numberOfLines={1}>
                        {cc.name || t('home.profileCircleFallback', { defaultValue: 'Circle' })}
                      </Text>
                      <MaterialCommunityIcons
                        name={selected ? 'check-circle' : 'circle-outline'}
                        size={20}
                        color={selected ? dot : c.textMuted}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: c.inputBackground, borderColor: c.border }]}
                activeOpacity={0.85}
                disabled={connectionLoading}
                onPress={() => setConnectPickerOpen(null)}
              >
                <Text style={[styles.modalBtnText, { color: c.textPrimary }]}>
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: c.primary, borderColor: c.primary }]}
                activeOpacity={0.85}
                disabled={connectionLoading}
                onPress={() => { void submitConnectPicker(); }}
              >
                {connectionLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: '#fff' }]}>
                    {connectPickerOpen === 'confirm'
                      ? t('home.profileConfirmConnectionAction', { defaultValue: 'Confirm' })
                      : connectPickerOpen === 'update'
                        ? t('home.profileSaveCirclesAction', { defaultValue: 'Save' })
                        : t('home.profileConnectAction', { defaultValue: 'Connect' })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </PostInteractionsProvider>
  );
}

function CountChip({ label, value, c }: { label: string; value: number; c: any }) {
  return (
    <View style={styles.countChip}>
      <Text style={[styles.countValue, { color: c.textPrimary }]}>{value}</Text>
      <Text style={[styles.countLabel, { color: c.textMuted }]}>{label}</Text>
    </View>
  );
}

function SectionCard({
  c,
  icon,
  title,
  subtitle,
  headerRight,
  children,
}: {
  c: any;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  subtitle?: string;
  /** Optional element rendered right-aligned in the title row (e.g. "Show more"). */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.sectionCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
      <View style={styles.sectionTitleRow}>
        <MaterialCommunityIcons name={icon} size={20} color={c.textPrimary} />
        <Text style={[styles.sectionTitle, { color: c.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        {headerRight ? <View style={styles.sectionTitleRight}>{headerRight}</View> : null}
      </View>
      {subtitle ? <Text style={[styles.sectionSubtitle, { color: c.textMuted }]}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

function ShowMoreLink({
  c,
  label,
  onPress,
}: {
  c: any;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={[styles.showMoreLinkText, { color: c.textLink || c.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function FilterChip({
  c,
  active,
  label,
  onPress,
}: {
  c: any;
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.filterChip,
        {
          borderColor: active ? c.primary : c.border,
          backgroundColor: active ? `${c.primary}20` : c.surface,
        },
      ]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <Text style={[styles.filterChipText, { color: active ? c.primary : c.textSecondary }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { paddingBottom: 120 },

  cover: { width: '100%', height: 140, borderBottomWidth: 1, overflow: 'hidden' },
  coverImage: { width: '100%', height: '100%' },
  coverEditBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: { flexDirection: 'row', gap: 14, paddingHorizontal: 14, marginTop: -36 },
  avatar: {
    width: 84, height: 84, borderRadius: 999, borderWidth: 4,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarLetter: { color: '#fff', fontSize: 30, fontWeight: '800' },
  avatarEditBtn: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaCol: { flex: 1, marginTop: 38 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  displayName: { fontSize: 20, fontWeight: '800' },
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    marginLeft: 'auto',
  },
  editProfileText: { fontSize: 12, fontWeight: '700' },
  handle: { fontSize: 14, fontWeight: '500', marginTop: 2 },
  countsRow: { flexDirection: 'row', gap: 14, marginTop: 8, flexWrap: 'wrap' },
  countChip: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  countValue: { fontSize: 14, fontWeight: '700' },
  countLabel: { fontSize: 12 },
  bio: { fontSize: 14, lineHeight: 20, paddingHorizontal: 14, marginTop: 12 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, marginTop: 8 },
  locationText: { fontSize: 13 },

  sectionCard: {
    marginHorizontal: 12,
    marginTop: 14,
    padding: 12,
    borderWidth: 1,
    borderRadius: 14,
    gap: 8,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '800', flexShrink: 1 },
  sectionTitleRight: { marginLeft: 'auto' },
  sectionSubtitle: { fontSize: 12, marginTop: -4 },
  showMoreLinkText: { fontSize: 13, fontWeight: '600' },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '22%', minWidth: 64, alignItems: 'center', gap: 4 },
  sliderContent: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  sliderTile: {
    width: 72,
    alignItems: 'center',
    gap: 4,
  },
  tileAvatarWrap: {
    width: 56, height: 56, borderRadius: 999, borderWidth: 1,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  tileAvatar: { width: '100%', height: '100%' },
  tileAvatarFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  tileAvatarLetter: { color: '#fff', fontSize: 18, fontWeight: '800' },
  tileLabel: { fontSize: 11, fontWeight: '600', textAlign: 'center' },

  showMoreBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 6,
  },
  showMoreText: { fontSize: 13, fontWeight: '600' },

  filterRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  filterChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChipText: { fontSize: 13, fontWeight: '600' },

  emptyRow: { fontSize: 13, textAlign: 'center', paddingVertical: 18 },

  postWrap: { marginTop: 8 },

  commentList: { gap: 8 },
  commentCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  commentText: { fontSize: 14, lineHeight: 20 },
  commentMeta: { fontSize: 11, fontWeight: '500' },

  actionBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, marginTop: 14 },
  actionBtnPrimary: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  actionBtnPrimaryText: { fontSize: 14, fontWeight: '700' },
  actionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 38,
  },
  actionBtnSecondaryText: { fontSize: 13, fontWeight: '700' },
  actionBtnIcon: {
    width: 38,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  actionPageTitle: { flex: 1, fontSize: 16, fontWeight: '800' },
  actionPageGroup: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionPageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  actionPageRowTitle: { fontSize: 15, fontWeight: '700' },
  actionPageRowSub: { fontSize: 12, marginTop: 2 },

  modalScrim: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    elevation: 999,
  },
  modalCard: {
    width: '88%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalSubtitle: { fontSize: 12, marginBottom: 6 },
  circleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  circleDot: { width: 12, height: 12, borderRadius: 999 },
  circleName: { flex: 1, fontSize: 14, fontWeight: '700' },
  modalButtonRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalBtnText: { fontSize: 14, fontWeight: '700' },
});
