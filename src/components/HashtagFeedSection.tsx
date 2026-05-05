/**
 * HashtagFeedSection — web-side hashtag feed.
 *
 * Drops into HomeScreen's legacy route switcher in place of the
 * "coming soon" RouteSummaryCard. Uses the same useHashtagPostsData hook
 * as the native HashtagScreenContainer (so the API + pagination + reaction
 * state all behave identically), but renders posts via HomeScreen's
 * existing renderPostCard callback to keep web-side interaction wiring
 * (reactions, comments, share, etc.) consistent with the rest of the app.
 *
 * Web-only — HomeScreen is gated on Platform.OS === 'web' in App.tsx, and
 * this component uses a "Load more" button instead of FlatList virtualisation
 * to play nicely with the parent page scroll.
 */

import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useHashtagPostsData } from '../hooks/useHashtagPostsData';
import type { FeedPost } from '../api/client';

type RenderPostCard = (
  post: FeedPost,
  variant?: 'feed' | 'profile',
) => React.ReactNode;

type Props = {
  token: string | null;
  hashtagName: string | undefined;
  renderPostCard: RenderPostCard;
  c: any;
};

export default function HashtagFeedSection({ token, hashtagName, renderPostCard, c }: Props) {
  const { t } = useTranslation();
  const {
    hashtag, hashtagLoading,
    posts, loading, loadingMore, hasMore, error, loadMore,
  } = useHashtagPostsData(token, hashtagName);

  // Web-only: auto-load the next page when the sentinel below the list
  // scrolls into view. On a non-web platform (e.g. if this component ever
  // gets reused inside a native HomeScreen build) the IntersectionObserver
  // path is skipped and the user falls back to the explicit "Load more"
  // button at the bottom.
  const sentinelRef = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof IntersectionObserver === 'undefined') return;
    const node = sentinelRef.current as unknown as Element | null;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e?.isIntersecting && hasMore && !loadingMore && !loading) {
          void loadMore();
        }
      },
      { rootMargin: '300px 0px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, loading, loadMore]);

  // Brand colours from the API. Validate the colour shape before applying
  // so a bad value doesn't crash StyleSheet.
  const validHex = (v?: string | null) => !!v && /^#?[0-9a-fA-F]{3,8}$/.test(String(v));
  const formatHex = (v?: string | null) =>
    String(v ?? '').startsWith('#') ? String(v) : `#${v}`;
  const chipBg = validHex(hashtag?.color) ? formatHex(hashtag?.color) : c.surface;
  const chipFg = validHex(hashtag?.text_color) ? formatHex(hashtag?.text_color) : c.textPrimary;
  const postCount = typeof hashtag?.posts_count === 'number' ? hashtag.posts_count : null;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <View style={[styles.chip, { backgroundColor: chipBg }]}>
          <Text style={[styles.chipText, { color: chipFg }]} numberOfLines={1}>
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

      {loading && posts.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.primary} size="large" />
        </View>
      ) : error && posts.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: c.errorText }]}>{error}</Text>
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: c.textMuted }]}>
            {t('home.hashtagFeedEmpty', { defaultValue: 'No posts yet for this hashtag.' })}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {posts.map((post) => (
            <View key={`hashtag-${hashtagName}-${(post as any).id}`} style={styles.listItem}>
              {renderPostCard(post, 'feed')}
            </View>
          ))}

          <View ref={sentinelRef as any} style={styles.sentinel} />

          {loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={c.primary} size="small" />
            </View>
          ) : hasMore ? (
            <TouchableOpacity
              style={[styles.loadMoreBtn, { borderColor: c.border, backgroundColor: c.surface }]}
              onPress={() => { void loadMore(); }}
              activeOpacity={0.85}
            >
              <Text style={[styles.loadMoreBtnText, { color: c.textPrimary }]}>
                {t('home.feedLoadMore', { defaultValue: 'Load more' })}
              </Text>
            </TouchableOpacity>
          ) : posts.length > 0 ? (
            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: c.textMuted }]}>
                {t('home.feedEndOfResults', { defaultValue: "You're all caught up!" })}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
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
  centered: { alignItems: 'center', justifyContent: 'center', padding: 60 },
  errorText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center' },
  list: { paddingHorizontal: 0, paddingTop: 8 },
  listItem: { marginBottom: 8 },
  sentinel: { height: 1 },
  footer: { paddingVertical: 20, alignItems: 'center' },
  footerText: { fontSize: 13, fontWeight: '500' },
  loadMoreBtn: {
    marginHorizontal: 16,
    marginVertical: 16,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    alignItems: 'center',
  },
  loadMoreBtnText: { fontSize: 14, fontWeight: '600' },
});
