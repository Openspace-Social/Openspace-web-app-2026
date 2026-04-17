import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, FollowingUserResult } from '../api/client';
import { useAppToast } from '../toast/AppToastContext';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  mode: 'followers' | 'following';
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  onNotice: (msg: string) => void;
  onOpenProfile: (username: string) => void;
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function FollowPeopleScreen({ mode, token, c, t, onNotice, onOpenProfile }: Props) {
  const s = useStyles(c);
  const { showToast } = useAppToast();
  const { width } = useWindowDimensions();
  const GRID_GAP = 10;
  const GRID_PADDING = 10;
  const [gridWidth, setGridWidth] = useState(0);

  // Responsive column count: 2 on narrow, 3 on medium, 4 on wide, 5 on extra wide
  const numCols = width >= 1280 ? 5 : width >= 900 ? 4 : width >= 560 ? 3 : 2;
  const usableGridWidth = Math.max(0, gridWidth - GRID_PADDING * 2);
  const tileWidth =
    usableGridWidth > 0
      ? Math.max(120, Math.floor((usableGridWidth - GRID_GAP * (numCols - 1)) / numCols))
      : undefined;

  // ── Data ─────────────────────────────────────────────────────────────────
  const [people, setPeople] = useState<FollowingUserResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const maxIdRef = useRef<number | undefined>(undefined);

  // ── Search ────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FollowingUserResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchSeqRef = useRef(0);

  // ── Action loading ────────────────────────────────────────────────────────
  const [actionLoadingUsername, setActionLoadingUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    showToast(error, { type: 'error' });
    setError('');
  }, [error, showToast]);

  // ── Load first page ───────────────────────────────────────────────────────
  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError('');
    maxIdRef.current = undefined;
    try {
      const data = mode === 'followers'
        ? await api.getFollowers(token, 20)
        : await api.getFollowings(token, 20);
      setPeople(data);
      setHasMore(data.length === 20);
      maxIdRef.current = data.length > 0 ? data[data.length - 1].id : undefined;
    } catch (err: any) {
      setError(err?.message || t('followers.loadError', { defaultValue: 'Failed to load accounts.' }));
    } finally {
      setLoading(false);
    }
  }, [token, mode, t]);

  useEffect(() => { void loadInitial(); }, [loadInitial]);

  // ── Load more ─────────────────────────────────────────────────────────────
  async function loadMore() {
    if (loadingMore || !hasMore || !maxIdRef.current) return;
    setLoadingMore(true);
    try {
      const data = mode === 'followers'
        ? await api.getFollowers(token, 20, maxIdRef.current)
        : await api.getFollowings(token, 20, maxIdRef.current);
      setPeople((prev) => [...prev, ...data]);
      setHasMore(data.length === 20);
      if (data.length > 0) maxIdRef.current = data[data.length - 1].id;
    } catch {
      // non-fatal
    } finally {
      setLoadingMore(false);
    }
  }

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchResults(null); return; }
    const seq = ++searchSeqRef.current;
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const data = mode === 'followers'
          ? await api.searchFollowers(token, q, 20)
          : await api.searchFollowings(token, q, 20);
        if (searchSeqRef.current === seq) setSearchResults(data);
      } catch {
        if (searchSeqRef.current === seq) setSearchResults([]);
      } finally {
        if (searchSeqRef.current === seq) setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, token, mode]);

  // ── Remove follower ───────────────────────────────────────────────────────
  async function handleRemoveFollower(username: string) {
    setActionLoadingUsername(username);
    try {
      await api.removeFollower(token, username);
      setPeople((prev) => prev.filter((p) => p.username !== username));
      if (searchResults) setSearchResults((prev) => prev!.filter((p) => p.username !== username));
    } catch (err: any) {
      setError(err?.message || t('followers.removeError', { defaultValue: 'Could not remove follower.' }));
    } finally {
      setActionLoadingUsername(null);
    }
  }

  // ── Unfollow ──────────────────────────────────────────────────────────────
  async function handleUnfollow(username: string) {
    setActionLoadingUsername(username);
    try {
      await api.unfollowUser(token, username);
      setPeople((prev) => prev.filter((p) => p.username !== username));
      if (searchResults) setSearchResults((prev) => prev!.filter((p) => p.username !== username));
    } catch (err: any) {
      setError(err?.message || t('following.unfollowError', { defaultValue: 'Could not unfollow.' }));
    } finally {
      setActionLoadingUsername(null);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  const displayList = searchResults !== null ? searchResults : people;
  const isFollowers = mode === 'followers';

  // Pad the display list to fill the last row evenly (avoids stretched tiles)
  const padded = [...displayList];
  while (padded.length % numCols !== 0) padded.push(null as any);

  function renderTile(person: FollowingUserResult | null, idx: number) {
    if (!person) {
      return (
        <View
          key={`pad-${idx}`}
          style={[s.tile, s.tileSized, { width: tileWidth, flexBasis: tileWidth, maxWidth: tileWidth, backgroundColor: 'transparent', borderColor: 'transparent' }]}
        />
      );
    }
    const username = person.username || '';
    const displayName = person.profile?.name || username;
    const avatar = person.profile?.avatar;
    const initial = (username[0] || '?').toUpperCase();
    const isActing = actionLoadingUsername === username;

    return (
      <TouchableOpacity
        key={person.id}
        style={[s.tile, s.tileSized, { width: tileWidth, flexBasis: tileWidth, maxWidth: tileWidth, backgroundColor: c.surface, borderColor: c.border }]}
        activeOpacity={0.85}
        onPress={() => username && onOpenProfile(username)}
      >
        {/* Avatar */}
        <View style={[s.avatarWrap, { backgroundColor: c.primary }]}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={s.avatarImage} resizeMode="cover" />
          ) : (
            <Text style={[s.avatarInitial, { color: '#fff' }]}>{initial}</Text>
          )}
        </View>

        {/* Name / handle */}
        <Text style={[s.tileName, { color: c.textPrimary }]} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={[s.tileHandle, { color: c.textMuted }]} numberOfLines={1}>
          @{username}
        </Text>

        {/* Action button */}
        <TouchableOpacity
          style={[s.actionBtn, {
            backgroundColor: c.inputBackground,
            borderColor: c.border,
          }]}
          activeOpacity={0.8}
          disabled={isActing}
          onPress={(e) => {
            e.stopPropagation?.();
            void (isFollowers ? handleRemoveFollower(username) : handleUnfollow(username));
          }}
        >
          {isActing ? (
            <ActivityIndicator size="small" color={c.textSecondary} />
          ) : (
            <>
              <MaterialCommunityIcons
                name={isFollowers ? 'account-minus-outline' : 'account-remove-outline'}
                size={13}
                color={c.textSecondary}
              />
              <Text style={[s.actionBtnText, { color: c.textSecondary }]}>
                {isFollowers
                  ? t('followers.remove', { defaultValue: 'Remove' })
                  : t('following.unfollow', { defaultValue: 'Unfollow' })}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { backgroundColor: c.surface, borderColor: c.border }]}>

      {/* Header */}
      <View style={[s.header, { borderBottomColor: c.border }]}>
        <Text style={[s.headerTitle, { color: c.textPrimary }]}>
          {isFollowers
            ? t('followers.title', { defaultValue: 'Followers' })
            : t('following.title', { defaultValue: 'Following' })}
        </Text>
        {!loading && (
          <Text style={[s.headerCount, { color: c.textMuted }]}>
            {people.length}{hasMore ? '+' : ''}
          </Text>
        )}
      </View>

      {/* Search bar */}
      <View style={[s.searchBar, { backgroundColor: c.inputBackground, borderColor: c.inputBorder }]}>
        <MaterialCommunityIcons name="magnify" size={16} color={c.textMuted} style={{ marginRight: 6 }} />
        <TextInput
          style={[s.searchInput, { color: c.textPrimary }]}
          placeholder={isFollowers
            ? t('followers.searchPlaceholder', { defaultValue: 'Search followers…' })
            : t('following.searchPlaceholder', { defaultValue: 'Search following…' })}
          placeholderTextColor={c.placeholder}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchLoading
          ? <ActivityIndicator size="small" color={c.textMuted} />
          : query.length > 0
            ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="close-circle" size={15} color={c.textMuted} />
              </TouchableOpacity>
            ) : null}
      </View>

      {/* Body */}
      {loading ? (
        <ActivityIndicator color={c.primary} size="large" style={{ marginTop: 48 }} />
      ) : error ? (
        <View style={s.centreBox}>
          <Text style={[s.errorText, { color: c.errorText }]}>{error}</Text>
          <TouchableOpacity onPress={() => void loadInitial()} style={{ marginTop: 8 }}>
            <Text style={{ color: c.primary }}>{t('followers.retry', { defaultValue: 'Retry' })}</Text>
          </TouchableOpacity>
        </View>
      ) : displayList.length === 0 ? (
        <View style={s.centreBox}>
          <MaterialCommunityIcons
            name={isFollowers ? 'account-group-outline' : 'account-heart-outline'}
            size={44}
            color={c.textMuted}
          />
          <Text style={[s.emptyText, { color: c.textMuted }]}>
            {query
              ? t('followers.noResults', { defaultValue: 'No results found.' })
              : isFollowers
                ? t('followers.empty', { defaultValue: 'Nobody is following you yet.' })
                : t('following.empty', { defaultValue: "You're not following anyone yet." })}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.grid}
          onLayout={(event) => {
            const next = Math.floor(event.nativeEvent.layout.width || 0);
            if (next > 0 && next !== gridWidth) setGridWidth(next);
          }}
        >
          {/* Tiles grid — rows of numCols */}
          {chunk(padded, numCols).map((row, rowIdx) => (
            <View key={rowIdx} style={[s.row, { gap: GRID_GAP }]}>
              {row.map((person, colIdx) => renderTile(person, rowIdx * numCols + colIdx))}
            </View>
          ))}

          {searchResults === null && hasMore ? (
            <View style={s.showMoreWrap}>
              <TouchableOpacity
                style={[s.showMoreBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                activeOpacity={0.85}
                disabled={loadingMore}
                onPress={() => void loadMore()}
              >
                {loadingMore ? (
                  <ActivityIndicator size="small" color={c.textSecondary} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="chevron-down" size={16} color={c.textSecondary} />
                    <Text style={[s.showMoreText, { color: c.textSecondary }]}>
                      {t('followers.showMore', { defaultValue: 'Show more' })}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function useStyles(c: any) {
  return StyleSheet.create({
    container: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 12,
      overflow: 'hidden',
      marginTop: 12,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
    },
    headerTitle: { fontSize: 18, fontWeight: '700' },
    headerCount: { fontSize: 14 },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      margin: 12,
      marginBottom: 8,
    },
    searchInput: { flex: 1, fontSize: 14, padding: 0 },
    centreBox: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 12,
      paddingVertical: 48,
    },
    errorText: { fontSize: 14, textAlign: 'center' },
    emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
    scroll: { flex: 1 },
    grid: { padding: 10 },
    row: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      marginBottom: 14,
    },
    tileSized: {
      width: 'auto',
    },
    tile: {
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 10,
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 6,
    },
    avatarWrap: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      marginBottom: 6,
    },
    avatarImage: { width: 64, height: 64 },
    avatarInitial: { fontSize: 24, fontWeight: '700' },
    tileName: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
    tileHandle: { fontSize: 11, textAlign: 'center' },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 'auto',
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      width: '100%',
      alignSelf: 'stretch',
      justifyContent: 'center',
    },
    actionBtnText: { fontSize: 11, fontWeight: '600' },
    showMoreWrap: {
      paddingTop: 6,
      paddingBottom: 16,
      alignItems: 'center',
    },
    showMoreBtn: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 9,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minWidth: 130,
      justifyContent: 'center',
    },
    showMoreText: {
      fontSize: 13,
      fontWeight: '700',
    },
  });
}
