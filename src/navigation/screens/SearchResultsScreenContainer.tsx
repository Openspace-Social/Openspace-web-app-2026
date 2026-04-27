/**
 * SearchResultsScreenContainer — full-screen list of search results for a
 * single category (people, communities, or hashtags). Reached from the
 * Search modal's "Show all results" link.
 *
 * The backend's search endpoints don't expose pagination cursors, so for
 * now we just request a larger page (count = 50) to cover most queries.
 * A future iteration can add real pagination once the API supports it.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import {
  api,
  type SearchCommunityResult,
  type SearchHashtagResult,
  type SearchUserResult,
} from '../../api/client';
import type { HomeStackParamList } from '../AppNavigator';

// Backend caps each search endpoint at 10 results per request. Until the
// API exposes pagination cursors, we ask for the max it allows.
const PAGE_COUNT = 10;

type Kind = 'people' | 'communities' | 'hashtags';
type ResultItem = SearchUserResult | SearchCommunityResult | SearchHashtagResult;

export default function SearchResultsScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const route = useRoute<RouteProp<HomeStackParamList, 'SearchResults'>>();
  const navigation = useNavigation<any>();
  const c = theme.colors;
  const kind = (route.params?.kind || 'people') as Kind;
  const query = route.params?.query || '';

  const [items, setItems] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    if (!token || !query.trim()) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError('');
    try {
      let list: ResultItem[] = [];
      if (kind === 'people') {
        list = await api.searchUsers(token, query, PAGE_COUNT);
      } else if (kind === 'communities') {
        list = await api.searchCommunities(token, query, PAGE_COUNT);
      } else {
        list = await api.searchHashtags(token, query, PAGE_COUNT);
      }
      if (seqRef.current !== seq) return;
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      if (seqRef.current !== seq) return;
      setError(e?.message || t('home.searchLoadError', { defaultValue: 'Could not load results.' }));
    } finally {
      if (seqRef.current === seq) setLoading(false);
    }
  }, [token, kind, query, t]);

  useEffect(() => { void load(); }, [load]);

  const titleByKind: Record<Kind, string> = {
    people: t('home.searchTabPeople', { defaultValue: 'People' }),
    communities: t('home.searchTabCommunities', { defaultValue: 'Communities' }),
    hashtags: t('home.searchTabHashtags', { defaultValue: 'Hashtags' }),
  };

  if (!token) return null;

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
      keyExtractor={(item, idx) => `result-${kind}-${(item as any).id || idx}`}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
            {titleByKind[kind]}
          </Text>
          <Text style={[styles.headerSubtitle, { color: c.textMuted }]} numberOfLines={1}>
            {t('home.searchResultsForQuery', { query, defaultValue: `Results for "${query}"` })}
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        if (kind === 'people') {
          const u = item as SearchUserResult;
          const initial = (u.profile?.name?.[0] || u.username?.[0] || '?').toUpperCase();
          return (
            <TouchableOpacity
              style={[styles.row, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={() => u.username && navigation.navigate('Profile', { username: u.username })}
            >
              <View style={[styles.avatar, { backgroundColor: c.primary }]}>
                {u.profile?.avatar ? (
                  <Image source={{ uri: u.profile.avatar }} style={styles.avatarImage} resizeMode="cover" />
                ) : (
                  <Text style={styles.avatarLetter}>{initial}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                {u.profile?.name ? (
                  <Text style={[styles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>{u.profile.name}</Text>
                ) : null}
                <Text style={[styles.rowSub, { color: c.textMuted }]} numberOfLines={1}>@{u.username}</Text>
              </View>
            </TouchableOpacity>
          );
        }
        if (kind === 'communities') {
          const com = item as SearchCommunityResult;
          const initial = (com.title?.[0] || com.name?.[0] || 'C').toUpperCase();
          return (
            <TouchableOpacity
              style={[styles.row, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={() => com.name && navigation.navigate('Community', { name: com.name })}
            >
              <View style={[styles.avatar, { backgroundColor: com.color || c.primary }]}>
                {com.avatar ? (
                  <Image source={{ uri: com.avatar }} style={styles.avatarImage} resizeMode="cover" />
                ) : (
                  <Text style={styles.avatarLetter}>{initial}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>{com.title || com.name}</Text>
                <Text style={[styles.rowSub, { color: c.textMuted }]} numberOfLines={1}>
                  {`c/${com.name}`}{typeof com.members_count === 'number' ? ` · ${com.members_count} ${t('home.communityMembersStat', { count: com.members_count, defaultValue: 'members' })}` : ''}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }
        const h = item as SearchHashtagResult;
        return (
          <TouchableOpacity
            style={[styles.row, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            activeOpacity={0.85}
            onPress={() => h.name && navigation.navigate('Hashtag', { name: h.name })}
          >
            <View style={[styles.avatar, { backgroundColor: c.primary }]}>
              {h.image ? (
                <Image source={{ uri: h.image }} style={styles.avatarImage} resizeMode="cover" />
              ) : h.emoji?.image ? (
                <Image source={{ uri: h.emoji.image }} style={{ width: 24, height: 24 }} resizeMode="contain" />
              ) : (
                <MaterialCommunityIcons name="pound" size={22} color="#fff" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>#{h.name}</Text>
              {typeof h.posts_count === 'number' ? (
                <Text style={[styles.rowSub, { color: c.textMuted }]} numberOfLines={1}>
                  {`${h.posts_count} ${t('home.hashtagPostsStat', { count: h.posts_count, defaultValue: 'posts' })}`}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      }}
      ListEmptyComponent={
        error ? (
          <Text style={[styles.emptyText, { color: c.errorText }]}>{error}</Text>
        ) : (
          <Text style={[styles.emptyText, { color: c.textMuted }]}>
            {t('home.searchNoResults', { defaultValue: 'No results match that search.' })}
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
  header: { paddingVertical: 12, paddingHorizontal: 4, marginBottom: 4 },
  headerTitle: { fontSize: 22, fontWeight: '900' },
  headerSubtitle: { fontSize: 13, marginTop: 4, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarLetter: { color: '#fff', fontWeight: '900', fontSize: 18 },
  rowTitle: { fontSize: 14, fontWeight: '800' },
  rowSub: { fontSize: 12, marginTop: 2 },
  emptyText: { padding: 24, textAlign: 'center', fontSize: 14 },
});
