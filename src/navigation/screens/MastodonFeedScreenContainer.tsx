import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, RefreshControl, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { api, type FederatedLinkedAccount, type FederatedTimelineStatus } from '../../api/client';
import MastodonFeedScreen from '../../components/MastodonFeedScreen';

const FEED_PAGE_SIZE = 20;

export default function MastodonFeedScreenContainer() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { token } = useAuth();
  const c = theme.colors;

  const [linkedAccount, setLinkedAccount] = useState<FederatedLinkedAccount | null>(null);
  const [items, setItems] = useState<FederatedTimelineStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextMaxId, setNextMaxId] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');

  const loadFeed = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    setError('');
    setNextMaxId(undefined);
    setHasMore(false);
    try {
      const accounts = await api.getFederatedLinkedAccounts(token);
      const primaryAccount = (accounts || []).find((account) => account.provider_type === 'mastodon') || null;
      setLinkedAccount(primaryAccount);
      if (!primaryAccount) {
        setItems([]);
        return;
      }
      const payload = await api.getFederatedHomeFeed(token, primaryAccount.id, FEED_PAGE_SIZE);
      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      setItems(nextItems);
      const nextCursor = payload.paging?.max_id || undefined;
      setNextMaxId(nextCursor || undefined);
      setHasMore(Boolean(nextCursor) && nextItems.length > 0);
    } catch (e: any) {
      setItems([]);
      setError(e?.message || t('home.feedLoadError', { defaultValue: 'Could not load the feed.' }));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    void loadFeed(false);
  }, [loadFeed]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadFeed(true);
    } finally {
      setRefreshing(false);
    }
  }, [loadFeed, refreshing]);

  const handleLoadMore = useCallback(async () => {
    if (!token || !linkedAccount || !nextMaxId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const payload = await api.getFederatedHomeFeed(token, linkedAccount.id, FEED_PAGE_SIZE, nextMaxId);
      const moreItems = Array.isArray(payload.items) ? payload.items : [];
      if (moreItems.length > 0) {
        setItems((prev) => {
          const existingIds = new Set(prev.map((item) => item.id));
          return [...prev, ...moreItems.filter((item) => !existingIds.has(item.id))];
        });
        const nextCursor = payload.paging?.max_id || undefined;
        setNextMaxId(nextCursor || undefined);
        setHasMore(Boolean(nextCursor));
      } else {
        setHasMore(false);
        setNextMaxId(undefined);
      }
    } catch {
      // quiet retry path
    } finally {
      setLoadingMore(false);
    }
  }, [token, linkedAccount, nextMaxId, loadingMore, hasMore]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={c.primary} />}
      onScroll={({ nativeEvent }) => {
        const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
        if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 320) {
          void handleLoadMore();
        }
      }}
      scrollEventThrottle={16}
    >
      <View>
        <MastodonFeedScreen
          c={c}
          t={t}
          loading={loading}
          error={error}
          items={items}
          linkedAccount={linkedAccount}
          loadingMore={loadingMore}
          hasMore={hasMore}
        />
      </View>
    </ScrollView>
  );
}
