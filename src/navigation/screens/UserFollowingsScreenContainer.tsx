/**
 * UserFollowingsScreenContainer — full list of accounts a user follows,
 * with infinite scroll via the API's `max_id` cursor.
 *
 * Reached from PublicProfileScreenContainer's "Show more" on the
 * following slider. Tapping a row navigates to that user's profile.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { api } from '../../api/client';
import type { HomeStackParamList } from '../AppNavigator';

type FollowingUser = {
  id?: number;
  username?: string;
  profile?: { avatar?: string | null; name?: string } | null;
};

const PAGE_SIZE = 20;

function resolveImageUri(value?: string | { url?: string } | null): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.url) return value.url;
  return undefined;
}

export default function UserFollowingsScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const route = useRoute<RouteProp<HomeStackParamList, 'UserFollowings'>>();
  const navigation = useNavigation<any>();
  const username = route.params?.username;
  const c = theme.colors;

  const [items, setItems] = useState<FollowingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  // Guard against stale responses if the user pulls-to-refresh while a
  // pagination request is in flight.
  const fetchTokenRef = useRef(0);

  const loadFirstPage = useCallback(
    async (silent = false) => {
      if (!token || !username) return;
      const myToken = ++fetchTokenRef.current;
      if (!silent) setLoading(true);
      setError('');
      try {
        const list = await api.getFollowings(token, PAGE_SIZE, undefined, username);
        if (myToken !== fetchTokenRef.current) return;
        const normalized = Array.isArray(list) ? (list as any as FollowingUser[]) : [];
        setItems(normalized);
        setHasMore(normalized.length === PAGE_SIZE);
      } catch (e: any) {
        if (myToken !== fetchTokenRef.current) return;
        setError(e?.message || 'Could not load followings.');
      } finally {
        if (myToken === fetchTokenRef.current && !silent) setLoading(false);
      }
    },
    [token, username],
  );

  useEffect(() => {
    void loadFirstPage(false);
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!token || !username || loadingMore || !hasMore || items.length === 0) return;
    const last = items[items.length - 1];
    const lastId = (last as any)?.id;
    if (typeof lastId !== 'number') return;
    setLoadingMore(true);
    try {
      const more = await api.getFollowings(token, PAGE_SIZE, lastId, username);
      const normalized = Array.isArray(more) ? (more as any as FollowingUser[]) : [];
      setItems((prev) => {
        const seen = new Set(prev.map((u) => (u as any)?.id).filter((id) => typeof id === 'number'));
        const deduped = normalized.filter((u) => typeof (u as any)?.id === 'number' && !seen.has((u as any).id));
        return [...prev, ...deduped];
      });
      setHasMore(normalized.length === PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [token, username, loadingMore, hasMore, items]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadFirstPage(true); } finally { setRefreshing(false); }
  }, [loadFirstPage]);

  const renderItem = useCallback(
    ({ item }: { item: FollowingUser }) => {
      const avatarUri = resolveImageUri(item.profile?.avatar);
      return (
        <TouchableOpacity
          style={[styles.row, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          activeOpacity={0.85}
          onPress={() => {
            if (item.username) navigation.navigate('Profile', { username: item.username });
          }}
        >
          <View style={[styles.avatarWrap, { borderColor: c.border, backgroundColor: c.surface }]}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} resizeMode="cover" />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: c.primary }]}>
                <Text style={styles.avatarLetter}>
                  {(item.username?.[0] || item.profile?.name?.[0] || 'U').toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.meta}>
            {item.profile?.name ? (
              <Text numberOfLines={1} style={[styles.displayName, { color: c.textPrimary }]}>
                {item.profile.name}
              </Text>
            ) : null}
            <Text numberOfLines={1} style={[styles.handle, { color: c.textMuted }]}>
              @{item.username || 'user'}
            </Text>
          </View>
        </TouchableOpacity>
      );
    },
    [c, navigation],
  );

  if (loading && items.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.listContent}
      data={items}
      keyExtractor={(item, idx) => `following-${item.id || item.username || idx}`}
      renderItem={renderItem}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      onEndReachedThreshold={0.4}
      onEndReached={() => { void loadMore(); }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={c.primary} colors={[c.primary]} />
      }
      ListEmptyComponent={
        error ? (
          <Text style={[styles.emptyText, { color: c.errorText }]}>{error}</Text>
        ) : (
          <Text style={[styles.emptyText, { color: c.textMuted }]}>
            {t('home.profileFollowingEmpty', { defaultValue: 'Not following anyone yet.' })}
          </Text>
        )
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator color={c.primary} size="small" />
          </View>
        ) : !hasMore && items.length > 0 ? (
          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: c.textMuted }]}>
              {t('home.profileFollowingEnd', { defaultValue: "You've seen them all." })}
            </Text>
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  listContent: { padding: 12, paddingBottom: 120 },
  separator: { height: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: '100%', height: '100%' },
  avatarFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#fff', fontSize: 18, fontWeight: '800' },
  meta: { flex: 1 },
  displayName: { fontSize: 15, fontWeight: '700' },
  handle: { fontSize: 13, marginTop: 2 },
  emptyText: { padding: 24, textAlign: 'center', fontSize: 14 },
  footer: { paddingVertical: 16, alignItems: 'center' },
  footerText: { fontSize: 13, fontWeight: '500' },
});
