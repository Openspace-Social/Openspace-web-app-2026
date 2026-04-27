/**
 * UserCommunitiesScreenContainer — full list of communities a user has
 * joined.
 *
 * Reached from PublicProfileScreenContainer via the "Show more" button on
 * the horizontal communities slider. The API (`getUserCommunities`)
 * returns the full list in one shot — no `maxId` / `offset` is supported —
 * so this screen virtualizes it via FlatList rather than paginating.
 */

import React, { useCallback, useEffect, useState } from 'react';
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

type Community = {
  id?: number | string;
  name?: string;
  title?: string;
  avatar?: string | { url?: string } | null;
};

function resolveImageUri(value?: string | { url?: string } | null): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.url) return value.url;
  return undefined;
}

export default function UserCommunitiesScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const route = useRoute<RouteProp<HomeStackParamList, 'UserCommunities'>>();
  const navigation = useNavigation<any>();
  const username = route.params?.username;
  const c = theme.colors;

  const [items, setItems] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (silent = false) => {
      if (!token || !username) return;
      if (!silent) setLoading(true);
      setError('');
      try {
        const list = await api.getUserCommunities(token, username);
        setItems(Array.isArray(list) ? (list as any) : []);
      } catch (e: any) {
        setError(e?.message || 'Could not load communities.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token, username],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(true); } finally { setRefreshing(false); }
  }, [load]);

  const renderItem = useCallback(
    ({ item }: { item: Community }) => {
      const avatarUri = resolveImageUri(item.avatar);
      return (
        <TouchableOpacity
          style={[styles.row, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          activeOpacity={0.85}
          onPress={() => {
            if (item.name) navigation.navigate('Community', { name: item.name });
          }}
        >
          <View style={[styles.avatarWrap, { borderColor: c.border, backgroundColor: c.surface }]}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} resizeMode="cover" />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: c.primary }]}>
                <Text style={styles.avatarLetter}>
                  {(item.name?.[0] || item.title?.[0] || 'C').toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.meta}>
            <Text numberOfLines={1} style={[styles.title, { color: c.textPrimary }]}>
              {item.title || item.name || 'Community'}
            </Text>
            {item.name ? (
              <Text numberOfLines={1} style={[styles.handle, { color: c.textMuted }]}>
                c/{item.name}
              </Text>
            ) : null}
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
      keyExtractor={(item, idx) => `community-${item.id || item.name || idx}`}
      renderItem={renderItem}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={c.primary} colors={[c.primary]} />
      }
      ListEmptyComponent={
        error ? (
          <Text style={[styles.emptyText, { color: c.errorText }]}>{error}</Text>
        ) : (
          <Text style={[styles.emptyText, { color: c.textMuted }]}>
            {t('home.profileJoinedCommunitiesEmpty', { defaultValue: 'No joined communities yet.' })}
          </Text>
        )
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
  title: { fontSize: 15, fontWeight: '700' },
  handle: { fontSize: 13, marginTop: 2 },
  emptyText: { padding: 24, textAlign: 'center', fontSize: 14 },
});
