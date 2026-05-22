/**
 * FeedScreenContainer — navigator-side Feed.
 *
 * Renders the real <PostCard /> from web via the PostInteractionsContext
 * adapter (ConnectedPostCard). Reactions + navigation are wired for real;
 * other interactions fall back to toasts until they migrate off HomeScreen.
 *
 * Virtualized via FlatList.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useRoute, useScrollToTop, type RouteProp } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useFeedData } from '../../hooks/useFeedData';
import { useChromeScrollHandler, useChromeVisibility } from '../../context/ChromeVisibilityContext';
import { useCommentsData } from '../../hooks/useCommentsData';
import { useNativePostInteractions } from '../../hooks/useNativePostInteractions';
import { useReactionList } from '../../hooks/useReactionList';
import { useAutoPlayMedia } from '../../hooks/useAutoPlayMedia';
import ConnectedPostCard from '../../components/ConnectedPostCard';
import ReactionPickerDrawer from '../../components/ReactionPickerDrawer';
import ReactionListDrawer from '../../components/ReactionListDrawer';
import ScreenError from '../../components/ScreenError';
import ThemedFlatList from '../../components/ThemedFlatList';
import MovePostCommunitiesSheet from '../../components/MovePostCommunitiesSheet';
import { PostInteractionsProvider } from '../../contexts/PostInteractionsContext';
import { postCardStyles } from '../../styles/postCardStyles';
import { api, type FeedPost, type FeedType, type SearchCommunityResult } from '../../api/client';
import { useAppToast } from '../../toast/AppToastContext';
import type { HomeStackParamList } from '../AppNavigator';

type Props = {
  /** Pinned feed type — when supplied, route params are ignored. Used by
   *  FeedTopTabs which gives each feed its own screen instance. */
  feedType?: FeedType;
};

export default function FeedScreenContainer({ feedType: feedTypeProp }: Props = {}) {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const autoPlayMedia = useAutoPlayMedia();
  const route = useRoute<RouteProp<HomeStackParamList, 'Feed'>>();
  const feedType: FeedType = feedTypeProp || (route.params?.feed as FeedType) || 'home';

  // Scroll-to-top wiring.
  //   • `useScrollToTop` (React Navigation) listens for `tabPress` on every
  //     parent tab/drawer navigator and scrolls this FlatList to the top
  //     when the screen is focused. It does NOT touch `scrollsToTop`.
  //   • iOS's status-bar tap is a separate, native mechanism: iOS scrolls
  //     the one scroll view with `scrollsToTop === true` — but does nothing
  //     when several are enabled at once. FeedTopTabs keeps every visited
  //     feed tab mounted, so without gating, all their FlatLists (plus the
  //     horizontal tab bar) claim the gesture and it silently no-ops. Tie
  //     `scrollsToTop` to focus so exactly one list owns it at a time.
  const flatListRef = useRef<FlatList<FeedPost>>(null);
  useScrollToTop(flatListRef);
  const isFocused = useIsFocused();

  // Auto-hide the top FeedHeader + bottom CustomTabBar while scrolling
  // the feed downward. Reset to visible whenever this tab loses focus so
  // sibling tabs (Communities, Alerts, etc.) never inherit a hidden bar.
  const handleChromeScroll = useChromeScrollHandler();
  const { hidden: chromeHidden, resetVisible: resetChromeVisible } = useChromeVisibility();
  useEffect(() => {
    if (!isFocused) resetChromeVisible();
  }, [isFocused, resetChromeVisible]);

  // react-navigation reserves `tabBarHeight` of paddingBottom on every
  // tab screen so the bar doesn't cover content. `useBottomTabBarHeight`
  // returns the visible bar height; on iPhones with a home indicator
  // the wrapping SafeAreaView reserves a *further* `insets.bottom` strip
  // underneath that the hook doesn't include. Add both so the feed
  // extends all the way to the screen edge when chrome hides.
  const tabBarHeight = useBottomTabBarHeight();
  const safeBottom = useSafeAreaInsets().bottom;
  const totalBottomReservation = tabBarHeight + safeBottom;
  const feedExtendBottom = chromeHidden.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -totalBottomReservation],
  });

  const {
    posts, loading, loadingMore, refreshing, hasMore, error, refresh, loadMore,
    reactionGroups, reactionGroupsLoading, reactionActionLoading,
    ensureReactionGroups, reactToPost, removePost, patchPost,
  } = useFeedData(token, feedType);
  const { showToast } = useAppToast();

  // Fetch the authenticated user once so PostCard can show the correct
  // "is this mine?" state (controls follow button visibility, delete/edit
  // options, etc.). Scoped to this screen for now; will move to a shared
  // CurrentUserContext when more screens need it.
  const [currentUsername, setCurrentUsername] = useState<string | undefined>(undefined);
  const [translationLanguageCode, setTranslationLanguageCode] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try {
        const u: any = await api.getAuthenticatedUser(token);
        if (!active) return;
        setCurrentUsername(u?.username);
        setTranslationLanguageCode(u?.translation_language?.code);
      } catch {
        // Non-fatal — PostCard falls back to "not my post" behaviour.
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  // Reaction picker modal state — the picker UI is rendered in this
  // container (outside the FlatList) and opened via the interactions hook.
  const [reactionPickerPost, setReactionPickerPost] = useState<FeedPost | null>(null);
  const openReactionPicker = useCallback((post: FeedPost) => {
    setReactionPickerPost(post);
  }, []);
  const closeReactionPicker = useCallback(() => {
    setReactionPickerPost(null);
  }, []);
  const handlePickReaction = useCallback(
    (emojiId: number) => {
      if (!reactionPickerPost) return;
      const post = reactionPickerPost;
      // Close the modal immediately so the optimistic post update inside
      // reactToPost is visible right away. The API call continues in the
      // background; failures roll back the optimistic state.
      setReactionPickerPost(null);
      void reactToPost(post, emojiId);
    },
    [reactionPickerPost, reactToPost],
  );

  // "Who reacted" drawer state — opened when the user taps the reactions
  // count or the people icon on a post. Mirrors what the post-detail
  // screen does inline, but in a side drawer at feed level.
  const reactionList = useReactionList(token);

  // Comments state + CRUD. Needs the `posts` array so it can resolve a
  // post's uuid from the id that PostCard hands us.
  const comments = useCommentsData(token, posts);

  // ── Change-communities sheet state ────────────────────────────────────────
  const [movePost, setMovePost] = useState<FeedPost | null>(null);
  const [moveJoined, setMoveJoined] = useState<SearchCommunityResult[]>([]);
  const [moveJoinedLoading, setMoveJoinedLoading] = useState(false);
  const [moveSelectedNames, setMoveSelectedNames] = useState<string[]>([]);
  const [moveSubmitting, setMoveSubmitting] = useState(false);

  const openMovePostCommunities = useCallback(async (post: FeedPost) => {
    if (!token) return;
    const seed = Array.isArray(post.shared_community_names) && post.shared_community_names.length > 0
      ? post.shared_community_names
      : (post.community?.name ? [post.community.name] : []);
    setMoveSelectedNames(seed);
    setMovePost(post);
    setMoveJoinedLoading(true);
    try {
      // Mirror web — paginate joined communities until exhausted.
      const all: SearchCommunityResult[] = [];
      let offset = 0;
      while (true) {
        const page = await api.getJoinedCommunities(token, 20, offset);
        const arr = Array.isArray(page) ? page : [];
        if (arr.length === 0) break;
        all.push(...arr);
        offset += arr.length;
        if (arr.length < 20) break;
      }
      // Dedupe by id.
      setMoveJoined(all.filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i));
    } catch {
      setMoveJoined([]);
    } finally {
      setMoveJoinedLoading(false);
    }
  }, [token]);

  const closeMovePostCommunities = useCallback(() => {
    if (moveSubmitting) return;
    setMovePost(null);
    setMoveJoined([]);
    setMoveSelectedNames([]);
  }, [moveSubmitting]);

  const toggleMoveCommunity = useCallback((name: string) => {
    setMoveSelectedNames((prev) => {
      const lower = name.toLowerCase();
      const exists = prev.some((n) => n.toLowerCase() === lower);
      if (exists) return prev.filter((n) => n.toLowerCase() !== lower);
      if (prev.length >= 3) return prev;
      return [...prev, name];
    });
  }, []);

  const submitMovePostCommunities = useCallback(async () => {
    if (!token || !movePost?.uuid || moveSubmitting) return;
    if (moveSelectedNames.length === 0) {
      showToast(
        t('home.movePostCommunitiesNoneError', { defaultValue: 'Select at least one community.' }),
        { type: 'error' },
      );
      return;
    }
    setMoveSubmitting(true);
    try {
      const updated = await api.updatePostTargets(token, movePost.uuid, {
        community_names: moveSelectedNames,
      });
      const postId = (movePost as any).id as number | undefined;
      if (typeof postId === 'number') {
        patchPost(postId, (current) => ({
          ...current,
          community: updated?.community ?? current.community,
          shared_community_names: moveSelectedNames,
          shared_communities_count: moveSelectedNames.length,
        } as FeedPost));
      }
      showToast(
        t('home.movePostCommunitiesSuccess', { defaultValue: 'Communities updated.' }),
        { type: 'success' },
      );
      setMovePost(null);
      setMoveJoined([]);
      setMoveSelectedNames([]);
    } catch (e: any) {
      showToast(
        e?.message || t('home.movePostCommunitiesFailed', { defaultValue: 'Could not update communities.' }),
        { type: 'error' },
      );
    } finally {
      setMoveSubmitting(false);
    }
  }, [token, movePost, moveSubmitting, moveSelectedNames, patchPost, showToast, t]);

  const baseInteractions = useNativePostInteractions({
    reactionGroups,
    reactionPickerLoading: reactionGroupsLoading,
    reactionActionLoading,
    ensureReactionGroups,
    reactToPost,
    openReactionPicker,
    openReactionList: reactionList.open,
    comments,
    removePost,
    patchPost,
  });
  const interactions = useMemo(
    () => ({ ...baseInteractions, onMovePostCommunities: openMovePostCommunities }),
    [baseInteractions, openMovePostCommunities],
  );

  const c = theme.colors;

  // Edge-to-edge card style for native feeds: drop the rounded card chrome
  // and run posts flush to the viewport edges. Bottom border doubles as a
  // post separator. Web HomeScreen still uses the original postCardStyles.
  const edgeToEdgePostCardStyles = useMemo(
    () => ({
      ...postCardStyles,
      feedPostCard: {
        ...postCardStyles.feedPostCard,
        borderTopWidth: 0,
        borderLeftWidth: 0,
        borderRightWidth: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderRadius: 0,
        paddingHorizontal: 14,
      },
    }),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => (
      <ConnectedPostCard
        post={item}
        variant="feed"
        styles={edgeToEdgePostCardStyles}
        c={c}
        t={t}
        currentUsername={currentUsername}
        token={token ?? undefined}
        translationLanguageCode={translationLanguageCode}
        autoPlayMedia={autoPlayMedia}
        isPostDetailOpen={false}
        allowExpandControl
        showFollowButton
      />
    ),
    [c, t, currentUsername, token, translationLanguageCode, edgeToEdgePostCardStyles],
  );

  if (loading && posts.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} size="large" />
      </View>
    );
  }

  if (error && posts.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <ScreenError
          message={error}
          c={c}
          t={t}
          onRetry={refresh}
          retrying={refreshing}
        />
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
      <ReactionListDrawer
        visible={!!reactionList.post}
        emojiCounts={reactionList.post?.reactions_emoji_counts || []}
        activeEmoji={reactionList.emoji}
        users={reactionList.users}
        loading={reactionList.loading}
        onSelectEmoji={reactionList.selectEmoji}
        onSelectUser={(username) => {
          reactionList.close();
          baseInteractions.onNavigateProfile(username);
        }}
        onClose={reactionList.close}
        c={c}
        t={t}
      />
      <MovePostCommunitiesSheet
        visible={!!movePost}
        c={c}
        t={t}
        joined={moveJoined}
        joinedLoading={moveJoinedLoading}
        selectedNames={moveSelectedNames}
        submitting={moveSubmitting}
        onToggle={toggleMoveCommunity}
        onClose={closeMovePostCommunities}
        onSave={() => void submitMovePostCommunities()}
      />
      <Animated.View style={{ flex: 1, marginBottom: feedExtendBottom }}>
      <ThemedFlatList
        ref={flatListRef}
        scrollsToTop={isFocused}
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.listContent}
        // iOS otherwise auto-insets scroll content by the safe-area
        // bottom (home indicator zone). Combined with react-navigation's
        // tabBarHeight padding, that leaves a dead strip at the bottom
        // when chrome hides — we want the feed to extend through both.
        contentInsetAdjustmentBehavior="never"
        data={posts}
        keyExtractor={(post) => `${feedType}-${(post as any).id}`}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        onScroll={handleChromeScroll}
        scrollEventThrottle={16}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          void loadMore();
        }}
        refreshing={refreshing}
        onRefresh={() => {
          void refresh();
        }}
        refreshTintColor={c.textPrimary}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={[styles.emptyText, { color: c.textMuted }]}>{t('home.feedEmpty')}</Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={c.primary} size="small" />
            </View>
          ) : !hasMore && posts.length > 0 ? (
            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: c.textMuted }]}>
                {t('home.feedEndOfResults', { defaultValue: "You're all caught up!" })}
              </Text>
            </View>
          ) : null
        }
      />
      </Animated.View>
    </PostInteractionsProvider>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingVertical: 0, paddingHorizontal: 0 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 60 },
  footer: { paddingVertical: 20, alignItems: 'center' },
  footerText: { fontSize: 13, fontWeight: '500' },
  separator: { height: 8 },
});
