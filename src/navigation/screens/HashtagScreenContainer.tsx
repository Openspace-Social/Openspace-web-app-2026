/**
 * HashtagScreenContainer — public feed of posts that include a hashtag.
 *
 * Mirrors FeedScreenContainer's structure (PostInteractionsProvider + the
 * shared reaction/reaction-list/move-communities chrome) so reactions,
 * comments, share, repost, and post-detail navigation all work identically.
 * The only divergences are the data hook (useHashtagPostsData) and a small
 * header chip showing the hashtag's brand colour + post count.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRoute, useScrollToTop, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useHashtagPostsData } from '../../hooks/useHashtagPostsData';
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
import { api, type FeedPost, type SearchCommunityResult } from '../../api/client';
import { useAppToast } from '../../toast/AppToastContext';
import type { HomeStackParamList } from '../AppNavigator';

export default function HashtagScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const autoPlayMedia = useAutoPlayMedia();
  const route = useRoute<RouteProp<HomeStackParamList, 'Hashtag'>>();
  const hashtagName = route.params?.name;

  const flatListRef = useRef<FlatList<FeedPost>>(null);
  useScrollToTop(flatListRef);

  const {
    hashtag, hashtagLoading,
    posts, loading, loadingMore, refreshing, hasMore, error, refresh, loadMore,
    reactionGroups, reactionGroupsLoading, reactionActionLoading,
    ensureReactionGroups, reactToPost, removePost, patchPost,
  } = useHashtagPostsData(token, hashtagName);
  const { showToast } = useAppToast();

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
        // Non-fatal.
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

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
      setReactionPickerPost(null);
      void reactToPost(post, emojiId);
    },
    [reactionPickerPost, reactToPost],
  );

  const reactionList = useReactionList(token);
  const comments = useCommentsData(token, posts);

  // ── Move-communities sheet — same wiring as FeedScreenContainer ─────────
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
    [c, t, currentUsername, token, translationLanguageCode, edgeToEdgePostCardStyles, autoPlayMedia],
  );

  // Header — coloured chip + post count. Renders as the FlatList's
  // ListHeaderComponent so it scrolls with the feed (matches the rest of
  // native: no fixed sub-header bar between the nav bar and content).
  const headerChipBg = (hashtag?.color && /^#?[0-9a-fA-F]{3,8}$/.test(String(hashtag.color)))
    ? (String(hashtag.color).startsWith('#') ? String(hashtag.color) : `#${hashtag.color}`)
    : c.surface;
  const headerChipFg = (hashtag?.text_color && /^#?[0-9a-fA-F]{3,8}$/.test(String(hashtag.text_color)))
    ? (String(hashtag.text_color).startsWith('#') ? String(hashtag.text_color) : `#${hashtag.text_color}`)
    : c.textPrimary;
  const postCount = typeof hashtag?.posts_count === 'number' ? hashtag.posts_count : null;

  const ListHeader = (
    <View style={[styles.header, { borderBottomColor: c.border }]}>
      <View style={[styles.chip, { backgroundColor: headerChipBg }]}>
        <Text style={[styles.chipText, { color: headerChipFg }]} numberOfLines={1}>
          #{hashtagName ?? ''}
        </Text>
      </View>
      <Text style={[styles.headerSubtitle, { color: c.textMuted }]}>
        {hashtagLoading
          ? t('home.hashtagLoadingSubtitle', { defaultValue: 'Loading hashtag…' })
          : postCount === null
            ? ''
            : t('home.hashtagPostsCount', {
                count: postCount,
                defaultValue: '{{count}} public posts',
              })}
      </Text>
    </View>
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
      <ThemedFlatList
        ref={flatListRef}
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.listContent}
        data={posts}
        keyExtractor={(post) => `hashtag-${hashtagName}-${(post as any).id}`}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
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
            <Text style={[styles.emptyText, { color: c.textMuted }]}>
              {t('home.hashtagFeedEmpty', { defaultValue: 'No posts yet for this hashtag.' })}
            </Text>
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
    </PostInteractionsProvider>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingVertical: 0, paddingHorizontal: 0 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    maxWidth: '100%',
  },
  chipText: { fontSize: 16, fontWeight: '700' },
  headerSubtitle: { fontSize: 13, fontWeight: '500' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 60 },
  footer: { paddingVertical: 20, alignItems: 'center' },
  footerText: { fontSize: 13, fontWeight: '500' },
  separator: { height: 8 },
});
