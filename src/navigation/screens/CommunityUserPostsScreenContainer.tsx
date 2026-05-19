/**
 * CommunityUserPostsScreenContainer — dedicated "View all posts in c/<name>
 * by @<user>" page.
 *
 * Reached from the PostCard ellipsis menu (a community-admin action) via
 * navigation.navigate('CommunityUserPosts', { communityName, username }).
 * Mirrors FeedScreenContainer's PostInteractionsProvider + ConnectedPostCard
 * pipeline so reactions / comments / navigation behave identically; the data
 * comes from useCommunityUserPostsData.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useCommunityUserPostsData } from '../../hooks/useCommunityUserPostsData';
import { useCommentsData } from '../../hooks/useCommentsData';
import { useNativePostInteractions } from '../../hooks/useNativePostInteractions';
import { useReactionList } from '../../hooks/useReactionList';
import { useAutoPlayMedia } from '../../hooks/useAutoPlayMedia';
import ConnectedPostCard from '../../components/ConnectedPostCard';
import ReactionPickerDrawer from '../../components/ReactionPickerDrawer';
import ReactionListDrawer from '../../components/ReactionListDrawer';
import ScreenError from '../../components/ScreenError';
import ThemedFlatList from '../../components/ThemedFlatList';
import { PostInteractionsProvider } from '../../contexts/PostInteractionsContext';
import { postCardStyles } from '../../styles/postCardStyles';
import { api, type FeedPost } from '../../api/client';
import type { HomeStackParamList } from '../AppNavigator';

export default function CommunityUserPostsScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const autoPlayMedia = useAutoPlayMedia();
  const route = useRoute<RouteProp<HomeStackParamList, 'CommunityUserPosts'>>();
  const communityName = route.params?.communityName;
  const username = route.params?.username;

  const flatListRef = useRef<FlatList<FeedPost>>(null);

  const {
    posts, loading, loadingMore, refreshing, hasMore, error, refresh, loadMore,
    reactionGroups, reactionGroupsLoading, reactionActionLoading,
    ensureReactionGroups, reactToPost, removePost, patchPost,
  } = useCommunityUserPostsData(token, username, communityName);

  // Fetch the authenticated user so PostCard can gate owner-only actions.
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

  // Reaction picker modal state — rendered in this container, opened via
  // the interactions hook (same wiring as FeedScreenContainer).
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

  const interactions = useNativePostInteractions({
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
        showFollowButton={false}
      />
    ),
    [c, t, currentUsername, token, translationLanguageCode, edgeToEdgePostCardStyles, autoPlayMedia],
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
        onSelectUser={(selectedUsername) => {
          reactionList.close();
          interactions.onNavigateProfile(selectedUsername);
        }}
        onClose={reactionList.close}
        c={c}
        t={t}
      />
      <ThemedFlatList
        ref={flatListRef}
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.listContent}
        data={posts}
        keyExtractor={(post) => `community-user-post-${(post as any).id}`}
        renderItem={renderItem}
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
              {t('home.communityUserPostsEmpty', {
                username,
                community: communityName,
                defaultValue: `No posts in c/${communityName} by @${username} yet.`,
              })}
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 60 },
  footer: { paddingVertical: 20, alignItems: 'center' },
  footerText: { fontSize: 13, fontWeight: '500' },
  separator: { height: 8 },
});
