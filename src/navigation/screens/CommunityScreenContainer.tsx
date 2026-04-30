/**
 * CommunityScreenContainer — fetches a community + its posts and wires
 * up the actions (join, leave, mute, notifications, manage). Posts use
 * the same PostInteractionsContext + ConnectedPostCard adapter as the
 * feed so reactions / comments / pin / etc. work identically.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import { useCommentsData } from '../../hooks/useCommentsData';
import { usePostReactions } from '../../hooks/usePostReactions';
import { useReactionList } from '../../hooks/useReactionList';
import { useNativePostInteractions } from '../../hooks/useNativePostInteractions';
import { useAutoPlayMedia } from '../../hooks/useAutoPlayMedia';
import { PostInteractionsProvider } from '../../contexts/PostInteractionsContext';
import ConnectedPostCard from '../../components/ConnectedPostCard';
import ReactionPickerDrawer from '../../components/ReactionPickerDrawer';
import ReactionListDrawer from '../../components/ReactionListDrawer';
import CommunityScreen from '../../screens/CommunityScreen';
import { postCardStyles } from '../../styles/postCardStyles';
import {
  api,
  type CommunityMember,
  type CommunityOwner,
  type FeedPost,
  type ModerationCategory,
  type SearchCommunityResult,
} from '../../api/client';
import type { ReactionGroup as ReactionGroupType } from '../../components/PostCard';
import type { HomeStackParamList } from '../AppNavigator';

const MEMBERS_PAGE_SIZE = 9;

type RouteName = 'Community';

export default function CommunityScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const autoPlayMedia = useAutoPlayMedia();
  const { showToast } = useAppToast();
  const route = useRoute<RouteProp<HomeStackParamList, RouteName>>();
  const navigation = useNavigation<any>();
  const c = theme.colors;
  const communityName = route.params?.name;

  const [community, setCommunity] = useState<SearchCommunityResult | null>(null);
  const [communityLoading, setCommunityLoading] = useState(true);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [joinLoading, setJoinLoading] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [muteLoading, setMuteLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | undefined>();
  const [currentUsername, setCurrentUsername] = useState<string | undefined>();

  const [owner, setOwner] = useState<CommunityOwner | null>(null);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersHasMore, setMembersHasMore] = useState(false);
  const [pinnedPosts, setPinnedPosts] = useState<FeedPost[]>([]);
  const [pinnedPostsLoading, setPinnedPostsLoading] = useState(false);
  const [moderationCategories, setModerationCategories] = useState<ModerationCategory[]>([]);

  // Reaction group state lives here (not in useFeedData since we're not
  // using that hook); keeps the picker working when the user reacts.
  const [reactionGroups, setReactionGroups] = useState<ReactionGroupType[]>([]);
  const [reactionGroupsLoading, setReactionGroupsLoading] = useState(false);
  const [reactionPickerPost, setReactionPickerPost] = useState<FeedPost | null>(null);
  const fetchSeqRef = useRef(0);

  // ── Initial load (community + posts + me) ─────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!token || !communityName) return;
    const seq = ++fetchSeqRef.current;
    setCommunityLoading(true);
    setPostsLoading(true);
    setMembersLoading(true);
    setPinnedPostsLoading(true);
    try {
      const [comRes, postsRes, meRes, ownerRes, membersRes, pinnedRes, catsRes] = await Promise.allSettled([
        api.getCommunity(token, communityName),
        api.getCommunityPosts(token, communityName, 20),
        api.getAuthenticatedUser(token),
        api.getCommunityOwner(token, communityName),
        api.getCommunityMembers(token, communityName, MEMBERS_PAGE_SIZE, undefined, ['administrators', 'moderators']),
        api.getCommunityPinnedPosts(token, communityName),
        api.getModerationCategories(token),
      ]);
      if (seq !== fetchSeqRef.current) return;
      if (comRes.status === 'fulfilled') setCommunity(comRes.value as SearchCommunityResult);
      if (postsRes.status === 'fulfilled') {
        setPosts(Array.isArray(postsRes.value) ? (postsRes.value as FeedPost[]) : []);
      }
      if (meRes.status === 'fulfilled') {
        const u: any = meRes.value;
        setCurrentUserId(typeof u?.id === 'number' ? u.id : undefined);
        setCurrentUsername(u?.username);
      }
      if (ownerRes.status === 'fulfilled') setOwner(ownerRes.value as CommunityOwner);
      if (membersRes.status === 'fulfilled') {
        const list = Array.isArray(membersRes.value) ? (membersRes.value as CommunityMember[]) : [];
        setMembers(list);
        setMembersHasMore(list.length === MEMBERS_PAGE_SIZE);
      }
      if (pinnedRes.status === 'fulfilled') {
        setPinnedPosts(Array.isArray(pinnedRes.value) ? (pinnedRes.value as FeedPost[]) : []);
      }
      if (catsRes.status === 'fulfilled') {
        setModerationCategories(Array.isArray(catsRes.value) ? (catsRes.value as ModerationCategory[]) : []);
      }
    } finally {
      if (seq === fetchSeqRef.current) {
        setCommunityLoading(false);
        setPostsLoading(false);
        setMembersLoading(false);
        setPinnedPostsLoading(false);
      }
    }
  }, [token, communityName]);

  const loadMoreMembers = useCallback(async () => {
    if (!token || !communityName || membersLoading || !membersHasMore) return;
    const last = members[members.length - 1];
    const maxId = typeof last?.id === 'number' ? last.id : undefined;
    setMembersLoading(true);
    try {
      const next = await api.getCommunityMembers(
        token,
        communityName,
        MEMBERS_PAGE_SIZE,
        maxId,
        ['administrators', 'moderators'],
      );
      const arr = Array.isArray(next) ? (next as CommunityMember[]) : [];
      setMembers((prev) => {
        const seen = new Set(prev.map((m) => m.id).filter((v): v is number => typeof v === 'number'));
        return [...prev, ...arr.filter((m) => typeof m.id !== 'number' || !seen.has(m.id))];
      });
      setMembersHasMore(arr.length === MEMBERS_PAGE_SIZE);
    } catch {
      setMembersHasMore(false);
    } finally {
      setMembersLoading(false);
    }
  }, [token, communityName, membersLoading, membersHasMore, members]);

  const onReport = useCallback(async (categoryId: number) => {
    if (!token || !communityName) return;
    try {
      await api.reportCommunity(token, communityName, categoryId);
      showToast(t('home.reportSuccess', { defaultValue: 'Reported, thanks!' }), { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || t('home.reportFailed', { defaultValue: 'Could not submit report right now.' }), { type: 'error' });
    }
  }, [token, communityName, showToast, t]);

  const onOpenProfile = useCallback((username: string) => {
    if (!username) return;
    navigation.navigate('Profile', { username });
  }, [navigation]);

  const onShowAllMembers = useCallback(() => {
    if (!communityName) return;
    navigation.navigate('CommunityMembers', { name: communityName });
  }, [navigation, communityName]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadAll(); } finally { setRefreshing(false); }
  }, [loadAll]);

  // ── Derived membership ────────────────────────────────────────────────────
  const isJoined = !!(community?.memberships && community.memberships.length > 0);
  const isPendingJoinRequest = !!community?.is_pending_join_request;
  const notificationsEnabled = !!community?.are_new_post_notifications_enabled;
  const isTimelineMuted = !!community?.is_timeline_muted;
  const canManage = useMemo(() => {
    if (!community || typeof currentUserId !== 'number') return false;
    if (community.is_creator) return true;
    const mine = community.memberships?.find((row) => row?.user_id === currentUserId);
    return !!mine?.is_administrator || !!mine?.is_moderator;
  }, [community, currentUserId]);

  // ── Action handlers ───────────────────────────────────────────────────────
  const onJoin = useCallback(async () => {
    if (!token || !communityName || joinLoading) return;
    setJoinLoading(true);
    try {
      const res = await api.joinCommunity(token, communityName);
      if (res?.status === 'pending') {
        setCommunity((prev) => (prev ? { ...prev, is_pending_join_request: true } : prev));
        showToast(t('home.communityJoinRequested', { defaultValue: 'Join request sent.' }), { type: 'success' });
      } else {
        await loadAll();
        showToast(t('home.communityJoinedSuccess', { defaultValue: 'Joined community.' }), { type: 'success' });
      }
    } catch (e: any) {
      showToast(e?.message || t('home.communityJoinFailed', { defaultValue: 'Could not join community.' }), { type: 'error' });
    } finally {
      setJoinLoading(false);
    }
  }, [token, communityName, joinLoading, loadAll, showToast, t]);

  const onLeave = useCallback(async () => {
    if (!token || !communityName || joinLoading) return;
    setJoinLoading(true);
    try {
      await api.leaveCommunity(token, communityName);
      await loadAll();
      showToast(t('home.communityLeftSuccess', { defaultValue: 'Left community.' }), { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || t('home.communityLeaveFailed', { defaultValue: 'Could not leave community.' }), { type: 'error' });
    } finally {
      setJoinLoading(false);
    }
  }, [token, communityName, joinLoading, loadAll, showToast, t]);

  const onToggleNotifications = useCallback(async () => {
    if (!token || !communityName || notificationsLoading) return;
    setNotificationsLoading(true);
    try {
      const enabled = notificationsEnabled;
      if (enabled) {
        await api.unsubscribeFromCommunityNotifications(token, communityName);
      } else {
        await api.subscribeToCommunityNotifications(token, communityName);
      }
      setCommunity((prev) => (prev ? { ...prev, are_new_post_notifications_enabled: !enabled } : prev));
    } catch (e: any) {
      showToast(e?.message || t('home.communityNotificationsFailed', { defaultValue: 'Could not update notifications.' }), { type: 'error' });
    } finally {
      setNotificationsLoading(false);
    }
  }, [token, communityName, notificationsLoading, notificationsEnabled, showToast, t]);

  const onMute = useCallback(async (durationDays: number | null) => {
    if (!token || !communityName || muteLoading) return;
    setMuteLoading(true);
    try {
      await api.muteCommunityTimeline(token, communityName, durationDays);
      setCommunity((prev) => (prev ? { ...prev, is_timeline_muted: true } : prev));
      showToast(
        durationDays
          ? t('community.feedMuted30DaysNotice', { defaultValue: 'Community muted for 30 days.' })
          : t('community.feedMutedIndefiniteNotice', { defaultValue: 'Community muted indefinitely.' }),
        { type: 'success' },
      );
    } catch (e: any) {
      showToast(e?.message || t('home.communityMuteFailed', { defaultValue: 'Could not mute community.' }), { type: 'error' });
    } finally {
      setMuteLoading(false);
    }
  }, [token, communityName, muteLoading, showToast, t]);

  const onUnmute = useCallback(async () => {
    if (!token || !communityName || muteLoading) return;
    setMuteLoading(true);
    try {
      await api.unmuteCommunityTimeline(token, communityName);
      setCommunity((prev) => (prev ? { ...prev, is_timeline_muted: false } : prev));
      showToast(t('community.feedUnmutedNotice', { defaultValue: 'Community unmuted.' }), { type: 'success' });
    } catch (e: any) {
      showToast(e?.message || t('home.communityUnmuteFailed', { defaultValue: 'Could not unmute community.' }), { type: 'error' });
    } finally {
      setMuteLoading(false);
    }
  }, [token, communityName, muteLoading, showToast, t]);

  const onOpenManage = useCallback(() => {
    if (!communityName) return;
    navigation.navigate('ProfileTab', { screen: 'ManageCommunity', params: { name: communityName } });
  }, [navigation, communityName]);

  // ── Reactions (matching FeedScreenContainer) ──────────────────────────────
  const ensureReactionGroups = useCallback(async () => {
    if (!token || reactionGroups.length > 0 || reactionGroupsLoading) return;
    setReactionGroupsLoading(true);
    try {
      const groups = await api.getPostReactionEmojiGroups(token);
      setReactionGroups(groups as ReactionGroupType[]);
    } catch {} finally { setReactionGroupsLoading(false); }
  }, [token, reactionGroups.length, reactionGroupsLoading]);

  // Use the shared optimistic-update hook so this container's reaction
  // logic stays in sync with the feed and post-detail flows.
  const patchPostInList = useCallback(
    (postId: number, fn: (p: FeedPost) => FeedPost) => {
      setPosts((prev) => prev.map((p) => ((p as any).id === postId ? fn(p) : p)));
    },
    [],
  );
  const { reactionActionLoading, reactToPost } = usePostReactions({
    token,
    reactionGroups,
    patchPost: patchPostInList,
  });

  const openReactionPicker = useCallback((post: FeedPost) => setReactionPickerPost(post), []);
  const closeReactionPicker = useCallback(() => setReactionPickerPost(null), []);
  const handlePickReaction = useCallback((emojiId: number) => {
    if (!reactionPickerPost) return;
    const post = reactionPickerPost;
    setReactionPickerPost(null);
    void reactToPost(post, emojiId);
  }, [reactionPickerPost, reactToPost]);

  const removeFromPosts = useCallback((postId: number) => {
    setPosts((prev) => prev.filter((p) => (p as any).id !== postId));
  }, []);
  const patchInPosts = useCallback((postId: number, mutate: (p: FeedPost) => FeedPost) => {
    setPosts((prev) => prev.map((p) => ((p as any).id === postId ? mutate(p) : p)));
  }, []);

  const comments = useCommentsData(token, posts);
  const reactionList = useReactionList(token);
  const interactions = useNativePostInteractions({
    reactionGroups,
    reactionPickerLoading: reactionGroupsLoading,
    reactionActionLoading,
    ensureReactionGroups,
    reactToPost,
    openReactionPicker,
    openReactionList: reactionList.open,
    comments,
    removePost: removeFromPosts,
    patchPost: patchInPosts,
  });

  const renderPostCard = useCallback((post: FeedPost) => (
    <ConnectedPostCard
      post={post}
      variant="feed"
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
  ), [c, t, currentUsername, token]);

  if (!token || !communityName) return null;

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
      <ReactionListDrawer
        visible={!!reactionList.post}
        emojiCounts={reactionList.post?.reactions_emoji_counts || []}
        activeEmoji={reactionList.emoji}
        users={reactionList.users}
        loading={reactionList.loading}
        onSelectEmoji={reactionList.selectEmoji}
        onSelectUser={(username) => {
          reactionList.close();
          interactions.onNavigateProfile(username);
        }}
        onClose={reactionList.close}
        c={c}
        t={t}
      />
      <View style={styles.root}>
        <CommunityScreen
          token={token}
          c={c}
          t={t}
          community={community}
          loading={communityLoading}
          posts={posts}
          postsLoading={postsLoading}
          refreshing={refreshing}
          onRefresh={() => { void onRefresh(); }}
          isJoined={isJoined}
          isPendingJoinRequest={isPendingJoinRequest}
          joinLoading={joinLoading}
          notificationsEnabled={notificationsEnabled}
          notificationsLoading={notificationsLoading}
          isTimelineMuted={isTimelineMuted}
          muteLoading={muteLoading}
          canManage={canManage}
          onJoin={() => { void onJoin(); }}
          onLeave={() => { void onLeave(); }}
          onToggleNotifications={() => { void onToggleNotifications(); }}
          onMute={(d) => { void onMute(d); }}
          onUnmute={() => { void onUnmute(); }}
          onOpenManage={onOpenManage}
          owner={owner}
          members={members}
          membersLoading={membersLoading}
          membersHasMore={membersHasMore}
          onLoadMoreMembers={() => { void loadMoreMembers(); }}
          onShowAllMembers={onShowAllMembers}
          pinnedPosts={pinnedPosts}
          pinnedPostsLoading={pinnedPostsLoading}
          moderationCategories={moderationCategories}
          onOpenProfile={onOpenProfile}
          onReport={onReport}
          renderPostCard={renderPostCard}
        />
      </View>
    </PostInteractionsProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
