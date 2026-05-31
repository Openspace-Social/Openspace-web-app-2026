/**
 * Public Source directory (Phase 6.3). Lists every active Source publisher
 * account (BBC News, NASA, ESPN, etc.), filterable by category, searchable
 * by name. One-tap follow for any user; the screen does NOT manage
 * per-community subscriptions — that lives in the community admin
 * (Phase 6.2 mod UI).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, SourceDirectoryEntry } from '../api/client';

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: '', label: 'All' },
  { key: 'news', label: 'News' },
  { key: 'tech', label: 'Tech' },
  { key: 'sports', label: 'Sports' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'science', label: 'Science' },
  { key: 'business', label: 'Business' },
  { key: 'politics', label: 'Politics' },
  { key: 'other', label: 'Other' },
];

type Props = {
  c: any;
  t: (key: string, opts?: any) => string;
  token: string | null;
  onOpenProfile: (username: string) => void;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
};

export default function SourcesDirectoryScreen({
  c, t, token, onOpenProfile, onNotice, onError,
}: Props) {
  const [category, setCategory] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [results, setResults] = useState<SourceDirectoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [followLoading, setFollowLoading] = useState<Record<string, boolean>>({});

  // Debounce the search input so we don't fire on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchText.trim()), 250);
    return () => clearTimeout(handle);
  }, [searchText]);

  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.getSourcesDirectory(token, {
        category: category || undefined,
        search: debouncedSearch || undefined,
        count: 50,
      });
      setResults(payload.results);
      setTotal(payload.total);
    } catch (e: any) {
      onError(e?.message || 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, [token, category, debouncedSearch, onError]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const handleToggleFollow = useCallback(async (entry: SourceDirectoryEntry) => {
    if (!token || !entry.username) return;
    setFollowLoading((prev) => ({ ...prev, [entry.username!]: true }));
    try {
      // This is the Sources directory — every entry is a Source by
      // definition. Use the source-specific endpoints (keyed by
      // source_profile.id) rather than the generic Follow API so the
      // write lands in the right table (UserSourceProfileFollow). The
      // generic Follow API still works against sources, but we keep
      // the two follow systems distinct architecturally.
      const sourceProfileId = entry.source_profile?.id;
      if (sourceProfileId == null) {
        throw new Error('Source profile id missing from directory entry — cannot toggle follow.');
      }
      if (entry.is_following) {
        await api.unfollowSourceProfile(token, sourceProfileId);
        setResults((prev) => prev.map((r) => r.id === entry.id ? { ...r, is_following: false } : r));
        onNotice(`Unfollowed @${entry.username}`);
      } else {
        await api.bulkFollowSourceProfiles(token, [sourceProfileId]);
        setResults((prev) => prev.map((r) => r.id === entry.id ? { ...r, is_following: true } : r));
        onNotice(`Following @${entry.username}`);
      }
    } catch (e: any) {
      onError(e?.message || 'Follow action failed');
    } finally {
      setFollowLoading((prev) => ({ ...prev, [entry.username!]: false }));
    }
  }, [token, onNotice, onError]);

  const renderItem = useCallback(({ item }: { item: SourceDirectoryEntry }) => {
    const handleFollow = () => handleToggleFollow(item);
    const isFollowing = !!item.is_following;
    const isBusy = !!followLoading[item.username || ''];
    return (
      <Pressable
        onPress={() => item.username && onOpenProfile(item.username)}
        style={({ pressed }) => [
          styles.row,
          { borderBottomColor: c.border, backgroundColor: pressed ? c.inputBackground : c.surface },
        ]}
      >
        <View style={[styles.avatarWrap, { backgroundColor: c.inputBackground }]}>
          {item.profile?.avatar ? (
            <Image source={{ uri: item.profile.avatar }} style={styles.avatar} resizeMode="cover" />
          ) : (
            <Text style={[styles.avatarFallback, { color: c.textSecondary }]}>
              {(item.profile?.name || item.username || 'S').slice(0, 1).toUpperCase()}
            </Text>
          )}
        </View>
        <View style={styles.meta}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={1}>
              {item.profile?.name || item.username}
            </Text>
            <View style={[styles.sourcePill, { backgroundColor: c.primary + '18', borderColor: c.primary }]}>
              <Text style={[styles.sourcePillText, { color: c.primary }]}>SOURCE</Text>
            </View>
          </View>
          <Text style={[styles.handle, { color: c.textMuted }]} numberOfLines={1}>
            @{item.username}
            {item.source_profile?.category ? ` · ${item.source_profile.category}` : ''}
            {item.mirrors_count ? ` · ${item.mirrors_count} mirror${item.mirrors_count === 1 ? '' : 's'}` : ''}
          </Text>
          {item.source_profile?.description ? (
            <Text style={[styles.description, { color: c.textSecondary }]} numberOfLines={2}>
              {item.source_profile.description}
            </Text>
          ) : null}
        </View>
        {token ? (
          <TouchableOpacity
            onPress={handleFollow}
            disabled={isBusy}
            style={[
              styles.followBtn,
              isFollowing
                ? { borderColor: c.border, backgroundColor: c.inputBackground }
                : { borderColor: c.primary, backgroundColor: c.primary },
            ]}
            activeOpacity={0.85}
          >
            {isBusy ? (
              <ActivityIndicator size="small" color={isFollowing ? c.textSecondary : '#fff'} />
            ) : (
              <Text style={[styles.followText, { color: isFollowing ? c.textSecondary : '#fff' }]}>
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            )}
          </TouchableOpacity>
        ) : null}
      </Pressable>
    );
  }, [c, handleToggleFollow, followLoading, onOpenProfile, token]);

  const headerContent = useMemo(() => (
    <View>
      <View style={[styles.searchWrap, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={c.textMuted} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search sources by name…"
          placeholderTextColor={c.textMuted}
          style={[styles.searchInput, { color: c.textPrimary }]}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <FlatList
        data={CATEGORIES}
        keyExtractor={(item) => item.key || 'all'}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}
        renderItem={({ item }) => {
          const active = category === item.key;
          return (
            <TouchableOpacity
              onPress={() => setCategory(item.key)}
              style={[
                styles.categoryChip,
                active
                  ? { backgroundColor: c.primary, borderColor: c.primary }
                  : { backgroundColor: c.inputBackground, borderColor: c.border },
              ]}
              activeOpacity={0.85}
            >
              <Text style={[styles.categoryChipText, { color: active ? '#fff' : c.textSecondary }]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
      <Text style={[styles.totalLine, { color: c.textMuted }]}>
        {loading ? 'Loading…' : `${total} source${total === 1 ? '' : 's'}`}
      </Text>
    </View>
  ), [searchText, category, c, loading, total]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <FlatList
        data={results}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        ListHeaderComponent={headerContent}
        ListEmptyComponent={
          loading ? null : (
            <Text style={[styles.empty, { color: c.textMuted }]}>
              No sources match your filter.
            </Text>
          )
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  categoryRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 8,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  totalLine: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
  },
  avatarFallback: {
    fontSize: 20,
    fontWeight: '700',
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  sourcePill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sourcePillText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  handle: {
    fontSize: 12,
    marginTop: 2,
  },
  description: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  followBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 88,
    alignItems: 'center',
  },
  followText: {
    fontSize: 12,
    fontWeight: '700',
  },
  empty: {
    textAlign: 'center',
    paddingVertical: 40,
    fontSize: 13,
  },
});
