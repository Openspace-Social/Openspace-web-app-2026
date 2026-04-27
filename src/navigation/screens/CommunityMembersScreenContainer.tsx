/**
 * CommunityMembersScreenContainer — full list of a community's members
 * with infinite scroll (paginated via the API's `max_id` cursor).
 *
 * Reached from CommunityScreen's "Show more" link in the Members section.
 * Tapping a row navigates to the user's public profile.
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
import { api, type CommunityMember } from '../../api/client';
import type { HomeStackParamList } from '../AppNavigator';

const PAGE_SIZE = 20;

export default function CommunityMembersScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const route = useRoute<RouteProp<HomeStackParamList, 'CommunityMembers'>>();
  const navigation = useNavigation<any>();
  const communityName = route.params?.name;
  const c = theme.colors;

  const [items, setItems] = useState<CommunityMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const fetchTokenRef = useRef(0);

  const loadFirstPage = useCallback(
    async (silent = false) => {
      if (!token || !communityName) return;
      const myToken = ++fetchTokenRef.current;
      if (!silent) setLoading(true);
      setError('');
      try {
        const list = await api.getCommunityMembers(token, communityName, PAGE_SIZE);
        if (myToken !== fetchTokenRef.current) return;
        const arr = Array.isArray(list) ? list : [];
        setItems(arr);
        setHasMore(arr.length === PAGE_SIZE);
      } catch (e: any) {
        if (myToken !== fetchTokenRef.current) return;
        setError(e?.message || t('home.communityMembersLoadError', { defaultValue: 'Could not load members.' }));
      } finally {
        if (myToken === fetchTokenRef.current && !silent) setLoading(false);
      }
    },
    [token, communityName, t],
  );

  useEffect(() => { void loadFirstPage(false); }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!token || !communityName || loadingMore || !hasMore || items.length === 0) return;
    const last = items[items.length - 1];
    const lastId = last?.id;
    if (typeof lastId !== 'number') return;
    setLoadingMore(true);
    try {
      const more = await api.getCommunityMembers(token, communityName, PAGE_SIZE, lastId);
      const arr = Array.isArray(more) ? more : [];
      setItems((prev) => {
        const seen = new Set(prev.map((m) => m.id).filter((v): v is number => typeof v === 'number'));
        return [...prev, ...arr.filter((m) => typeof m.id !== 'number' || !seen.has(m.id))];
      });
      setHasMore(arr.length === PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [token, communityName, loadingMore, hasMore, items]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadFirstPage(true); } finally { setRefreshing(false); }
  }, [loadFirstPage]);

  const renderItem = useCallback(
    ({ item }: { item: CommunityMember }) => {
      const initial = (item.profile?.name?.[0] || item.username?.[0] || '?').toUpperCase();
      return (
        <TouchableOpacity
          style={[styles.row, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          activeOpacity={0.85}
          onPress={() => { if (item.username) navigation.navigate('Profile', { username: item.username }); }}
        >
          <View style={[styles.avatarWrap, { borderColor: c.border, backgroundColor: c.surface }]}>
            {item.profile?.avatar ? (
              <Image source={{ uri: item.profile.avatar }} style={styles.avatar} resizeMode="cover" />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: c.primary }]}>
                <Text style={styles.avatarLetter}>{initial}</Text>
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

  if (!token || !communityName) return null;

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
      keyExtractor={(item, idx) => `member-${item.id || item.username || idx}`}
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
            {t('home.communityNoMembers', { defaultValue: 'No members to show.' })}
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
              {t('home.communityMembersEnd', { defaultValue: "You've seen them all." })}
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
    width: 48, height: 48, borderRadius: 999, borderWidth: 1,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
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
