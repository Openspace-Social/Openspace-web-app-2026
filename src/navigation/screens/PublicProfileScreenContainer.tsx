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
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
import ConnectedPostCard from '../../components/ConnectedPostCard';
import ReactionPickerModal from '../../components/ReactionPickerModal';
import EditProfileModal from '../../components/EditProfileModal';
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
  const { showToast } = useAppToast();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<HomeStackParamList, 'Profile'>>();
  const username = route.params?.username;

  const [user, setUser] = useState<PublicUser | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [currentUsername, setCurrentUsername] = useState<string | undefined>(undefined);

  // Own-profile edit state.
  const [editOpen, setEditOpen] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const isOwnProfile = !!currentUsername && !!username && currentUsername === username;

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
          autoPlayMedia={false}
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
      <ReactionPickerModal
        visible={!!reactionPickerPost}
        groups={reactionGroups}
        loading={reactionGroupsLoading}
        actionLoading={reactionActionLoading}
        onPick={handlePickReaction}
        onClose={closeReactionPicker}
        c={c}
        t={t}
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
});
