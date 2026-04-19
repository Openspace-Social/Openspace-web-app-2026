import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, SearchCommunityResult } from '../api/client';
import { useAppToast } from '../toast/AppToastContext';
import CreateCommunityDrawer from '../components/CreateCommunityDrawer';

type Props = {
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  onNotice: (msg: string) => void;
  onOpenCommunity: (communityName: string) => void;
};

type SectionKey = 'administrated' | 'moderated' | 'joined' | 'favorites';
type TabKey = SectionKey | 'discover';
type ViewMode = 'grid' | 'list';
type JoinedSortKey = 'default' | 'active' | 'members' | 'az';

const INTEREST_CATEGORIES = [
  'all',
  'fun',
  'technology',
  'sports',
  'art',
  'lifestyle',
  'animals',
  'entertainment',
  'education',
  'food',
  'science',
  'places',
  'photography',
  'humanities',
  'theology',
  'nature',
  'health',
  'psychology',
];
const FAVORITES_ORDER_STORAGE_KEY = '@openspace/communities_favorites_order_v1';

function normalizeCommunityName(value?: string) {
  return (value || '').trim().toLowerCase();
}

function dedupeCommunities(items: SearchCommunityResult[]) {
  const seen = new Set<string>();
  const out: SearchCommunityResult[] = [];
  for (const item of items) {
    const key = normalizeCommunityName(item.name) || String(item.id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function applyFavoritesOrder(items: SearchCommunityResult[], order: string[]) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const indexByName = new Map<string, number>();
  order.forEach((name, index) => {
    if (name) indexByName.set(name, index);
  });
  return [...items].sort((a, b) => {
    const aName = normalizeCommunityName(a.name);
    const bName = normalizeCommunityName(b.name);
    const ai = indexByName.get(aName);
    const bi = indexByName.get(bName);
    if (typeof ai === 'number' && typeof bi === 'number') return ai - bi;
    if (typeof ai === 'number') return -1;
    if (typeof bi === 'number') return 1;
    return (a.title || a.name || '').localeCompare(b.title || b.name || '');
  });
}

function sortJoinedCommunities(items: SearchCommunityResult[], sortBy: JoinedSortKey) {
  const list = [...items];
  if (sortBy === 'default') return list;
  if (sortBy === 'az') {
    return list.sort((a, b) =>
      (a.title || a.name || '').localeCompare(b.title || b.name || '', undefined, { sensitivity: 'base' })
    );
  }
  if (sortBy === 'members') {
    return list.sort((a, b) => {
      const bMembers = Number(b.members_count || 0);
      const aMembers = Number(a.members_count || 0);
      if (bMembers !== aMembers) return bMembers - aMembers;
      return (a.title || a.name || '').localeCompare(b.title || b.name || '');
    });
  }
  return list.sort((a, b) => {
    const bPosts = Number((b as any).posts_count || 0);
    const aPosts = Number((a as any).posts_count || 0);
    if (bPosts !== aPosts) return bPosts - aPosts;
    const bMembers = Number(b.members_count || 0);
    const aMembers = Number(a.members_count || 0);
    if (bMembers !== aMembers) return bMembers - aMembers;
    return (a.title || a.name || '').localeCompare(b.title || b.name || '');
  });
}

function getMembersLabel(item: SearchCommunityResult, t: Props['t']) {
  const count = Number(item.members_count || 0);
  const adjective = count === 1 ? item.user_adjective : item.users_adjective;
  if (adjective && adjective.trim()) return `${count.toLocaleString()} ${adjective}`;
  return t('communitiesHub.membersCount', { count, defaultValue: '{{count}} members' });
}

function CommunityCard({
  item,
  c,
  t,
  mode,
  width,
  onPress,
  action,
}: {
  item: SearchCommunityResult;
  c: any;
  t: Props['t'];
  mode: ViewMode;
  width?: number;
  onPress: () => void;
  action?: React.ReactNode;
}) {
  const title = item.title || item.name || t('communitiesHub.untitledCommunity', { defaultValue: 'Community' });
  const handle = item.name ? `c/${item.name}` : t('communitiesHub.communityHandleFallback', { defaultValue: 'c/community' });
  const initial = (title[0] || 'C').toUpperCase();
  const accent = item.color || c.primary;
  const isList = mode === 'list';

  if (isList) {
    return (
      <TouchableOpacity
        style={[
          styles.listCard,
          { borderColor: c.border, backgroundColor: c.surface },
        ]}
        activeOpacity={0.9}
        onPress={onPress}
      >
        <View style={[styles.listCoverWrap, { backgroundColor: c.inputBackground }]}>
          {item.cover ? (
            <Image source={{ uri: item.cover }} style={styles.listCoverImage} resizeMode="cover" />
          ) : (
            <View style={[styles.listCoverFallback, { backgroundColor: `${accent}22` }]} />
          )}
        </View>

        <View style={styles.listMeta}>
          <View style={[styles.listAvatarWrap, { backgroundColor: accent }]}>
            {item.avatar ? (
              <Image source={{ uri: item.avatar }} style={styles.listAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={styles.listAvatarInitial}>{initial}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.listTitle, { color: c.textPrimary }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.listHandle, { color: c.textMuted }]} numberOfLines={1}>
              {handle}
            </Text>
            <Text style={[styles.listMetaText, { color: c.textSecondary }]} numberOfLines={1}>
              {getMembersLabel(item, t)}
            </Text>
          </View>
          {action}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[
        styles.gridCard,
        {
          width,
          flexBasis: width,
          maxWidth: width,
          borderColor: c.border,
          backgroundColor: c.surface,
        },
      ]}
      activeOpacity={0.9}
      onPress={onPress}
    >
      <View style={[styles.gridCoverWrap, { backgroundColor: c.inputBackground, borderBottomColor: c.border }]}>
        {item.cover ? (
          <Image source={{ uri: item.cover }} style={styles.gridCoverImage} resizeMode="cover" />
        ) : (
          <View style={[styles.gridCoverFallback, { backgroundColor: `${accent}22` }]} />
        )}
      </View>

      <View style={styles.gridBody}>
        <View style={styles.gridIdentityRow}>
          <View style={[styles.gridAvatarWrap, { backgroundColor: accent }]}>
            {item.avatar ? (
              <Image source={{ uri: item.avatar }} style={styles.gridAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={styles.gridAvatarInitial}>{initial}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.gridTitle, { color: c.textPrimary }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.gridHandle, { color: c.textMuted }]} numberOfLines={1}>
              {handle}
            </Text>
          </View>
        </View>

        <View style={[styles.gridFooter, { borderTopColor: c.border }]}>
          <Text style={[styles.gridMeta, { color: c.textSecondary }]} numberOfLines={1}>
            {getMembersLabel(item, t)}
          </Text>
          {action}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function CommunitiesScreen({ token, c, t, onNotice, onOpenCommunity }: Props) {
  const s = useMemo(() => makeStyles(c), [c]);
  const { showToast } = useAppToast();
  const { width, height } = useWindowDimensions();
  const searchSeqRef = useRef(0);

  const [activeTab, setActiveTab] = useState<TabKey>('joined');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const numCols = width >= 1480 ? 4 : width >= 1060 ? 3 : width >= 680 ? 2 : 1;
  const horizontalGap = 14;
  const contentWidth = Math.max(320, Math.min(width - 40, 1480));
  const panelHeight = Math.max(560, Math.min(Math.floor(height * 0.86), 980));
  const usable = Math.max(0, contentWidth - 24);
  const cardWidth =
    usable > 0 ? Math.max(220, Math.floor((usable - horizontalGap * (numCols - 1)) / numCols)) : undefined;

  const [loading, setLoading] = useState(true);
  const [administrated, setAdministrated] = useState<SearchCommunityResult[]>([]);
  const [moderated, setModerated] = useState<SearchCommunityResult[]>([]);
  const [joined, setJoined] = useState<SearchCommunityResult[]>([]);
  const [favorites, setFavorites] = useState<SearchCommunityResult[]>([]);
  const [discover, setDiscover] = useState<SearchCommunityResult[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [joinLoadingName, setJoinLoadingName] = useState<string | null>(null);
  const [leaveLoadingName, setLeaveLoadingName] = useState<string | null>(null);
  const [leaveConfirmItem, setLeaveConfirmItem] = useState<SearchCommunityResult | null>(null);
  const [favoritesOrder, setFavoritesOrder] = useState<string[]>([]);
  const [favoritesReorderMode, setFavoritesReorderMode] = useState(false);
  const [joinedSort, setJoinedSort] = useState<JoinedSortKey>('default');
  const [dragSourceName, setDragSourceName] = useState<string | null>(null);
  const [dragOverName, setDragOverName] = useState<string | null>(null);
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);

  const applySectionError = useCallback(
    (message: string) => {
      showToast(message, { type: 'error' });
      onNotice(message);
    },
    [onNotice, showToast]
  );

  const loadSections = useCallback(async () => {
    setLoading(true);
    try {
      const [administratedRes, moderatedRes, joinedRes, favoritesRes] = await Promise.allSettled([
        api.getAdministratedCommunities(token, 20, 0),
        api.getModeratedCommunities(token, 20, 0),
        api.getJoinedCommunities(token, 20, 0),
        api.getFavoriteCommunities(token, 20, 0),
      ]);

      if (administratedRes.status === 'fulfilled') setAdministrated(dedupeCommunities(administratedRes.value));
      else applySectionError(t('communitiesHub.loadAdministratedError', { defaultValue: 'Failed to load administrated communities.' }));

      if (moderatedRes.status === 'fulfilled') setModerated(dedupeCommunities(moderatedRes.value));
      else applySectionError(t('communitiesHub.loadModeratedError', { defaultValue: 'Failed to load moderated communities.' }));

      if (joinedRes.status === 'fulfilled') setJoined(dedupeCommunities(joinedRes.value));
      else applySectionError(t('communitiesHub.loadJoinedError', { defaultValue: 'Failed to load joined communities.' }));

      if (favoritesRes.status === 'fulfilled') setFavorites(dedupeCommunities(favoritesRes.value));
      else applySectionError(t('communitiesHub.loadFavoritesError', { defaultValue: 'Failed to load favorite communities.' }));
    } finally {
      setLoading(false);
    }
  }, [applySectionError, t, token]);

  useEffect(() => {
    void loadSections();
  }, [loadSections]);

  useEffect(() => {
    AsyncStorage.getItem(FAVORITES_ORDER_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setFavoritesOrder(
              parsed
                .map((v) => normalizeCommunityName(typeof v === 'string' ? v : ''))
                .filter(Boolean)
            );
          }
        } catch {
          // ignore malformed local value
        }
      })
      .catch(() => {
        // no-op
      });
  }, []);

  const loadDiscover = useCallback(
    async (query: string, category: string) => {
      const trimmed = query.trim();
      setDiscoverLoading(true);
      try {
        if (trimmed.length >= 2) {
          const results = await api.searchCommunities(token, trimmed, 24);
          setDiscover(dedupeCommunities(Array.isArray(results) ? results : []));
          return;
        }
        const [trendingRes, suggestedRes] = await Promise.allSettled([
          api.getTrendingCommunities(token, category === 'all' ? undefined : category),
          api.getSuggestedCommunities(token),
        ]);
        const trending = trendingRes.status === 'fulfilled' ? trendingRes.value : [];
        const suggested = suggestedRes.status === 'fulfilled' ? suggestedRes.value : [];
        setDiscover(dedupeCommunities([...(Array.isArray(trending) ? trending : []), ...(Array.isArray(suggested) ? suggested : [])]));
      } catch (err: any) {
        setDiscover([]);
        applySectionError(err?.message || t('communitiesHub.loadDiscoverError', { defaultValue: 'Failed to load discover communities.' }));
      } finally {
        setDiscoverLoading(false);
      }
    },
    [applySectionError, t, token]
  );

  useEffect(() => {
    if (activeTab !== 'discover') return;
    const seq = ++searchSeqRef.current;
    const timer = setTimeout(() => {
      void loadDiscover(searchQuery, selectedCategory).then(() => {
        if (seq !== searchSeqRef.current) return;
      });
    }, searchQuery.trim().length >= 2 ? 300 : 120);
    return () => clearTimeout(timer);
  }, [activeTab, loadDiscover, searchQuery, selectedCategory]);

  async function handleJoinCommunity(item: SearchCommunityResult) {
    const name = (item.name || '').trim();
    if (!name || joinLoadingName === name) return;
    setJoinLoadingName(name);
    try {
      await api.joinCommunity(token, name);
      setDiscover((prev) =>
        prev.map((community) =>
          community.name === name
            ? {
                ...community,
                memberships:
                  Array.isArray(community.memberships) && community.memberships.length > 0
                    ? community.memberships
                    : [{ id: Date.now() }],
              }
            : community
        )
      );
      setJoined((prev) => dedupeCommunities([item, ...prev]));
      showToast(t('communitiesHub.joinedToast', { defaultValue: 'Joined c/{{name}}.', name }), { type: 'success' });
    } catch (err: any) {
      applySectionError(err?.message || t('communitiesHub.joinError', { defaultValue: 'Unable to join this community right now.' }));
    } finally {
      setJoinLoadingName(null);
    }
  }

  function requestLeaveCommunity(item: SearchCommunityResult) {
    const name = (item.name || '').trim();
    if (!name || leaveLoadingName === name) return;
    setLeaveConfirmItem(item);
  }

  async function handleLeaveCommunity(item: SearchCommunityResult) {
    const name = (item.name || '').trim();
    if (!name || leaveLoadingName === name) return;
    setLeaveLoadingName(name);
    try {
      const response = await api.leaveCommunity(token, name);
      setJoined((prev) => prev.filter((community) => community.name !== name));
      setFavorites((prev) => prev.filter((community) => community.name !== name));
      setDiscover((prev) =>
        prev.map((community) =>
          community.name === name ? { ...community, memberships: [] } : community
        )
      );
      const removedPostsCount = Number(response?.removed_posts_count || 0);
      showToast(
        removedPostsCount > 0
          ? t('communitiesHub.leftWithDeletionToast', {
              defaultValue: 'Left c/{{name}}. {{count}} of your post contribution(s) were permanently removed from this community.',
              name,
              count: removedPostsCount,
            })
          : t('communitiesHub.leftToast', {
              defaultValue: 'Left c/{{name}}.',
              name,
            }),
        { type: 'success' }
      );
    } catch (err: any) {
      applySectionError(
        err?.message ||
          t('communitiesHub.leaveError', {
            defaultValue: 'Unable to leave this community right now.',
          })
      );
    } finally {
      setLeaveLoadingName(null);
      setLeaveConfirmItem(null);
    }
  }

  useEffect(() => {
    const favoriteNames = favorites
      .map((item) => normalizeCommunityName(item.name))
      .filter(Boolean);
    if (favoriteNames.length === 0) {
      setFavoritesOrder([]);
      return;
    }
    setFavoritesOrder((prev) => {
      const keep = prev.filter((name) => favoriteNames.includes(name));
      const append = favoriteNames.filter((name) => !keep.includes(name));
      return [...keep, ...append];
    });
  }, [favorites]);

  useEffect(() => {
    AsyncStorage.setItem(FAVORITES_ORDER_STORAGE_KEY, JSON.stringify(favoritesOrder)).catch(() => {
      // non-fatal
    });
  }, [favoritesOrder]);

  const tabs = useMemo(
    () => [
      { key: 'administrated' as const, label: t('communitiesHub.administratedTitle', { defaultValue: 'Administrated' }) },
      { key: 'moderated' as const, label: t('communitiesHub.moderatedTitle', { defaultValue: 'Moderated' }) },
      { key: 'joined' as const, label: t('communitiesHub.joinedTitle', { defaultValue: 'Joined' }) },
      { key: 'favorites' as const, label: t('communitiesHub.favoritesTitle', { defaultValue: 'Favorites' }) },
      { key: 'discover' as const, label: t('communitiesHub.discoverTitle', { defaultValue: 'Discover by interest' }) },
    ],
    [t]
  );

  const activeSectionItems = useMemo(() => {
    if (activeTab === 'administrated') return administrated;
    if (activeTab === 'moderated') return moderated;
    if (activeTab === 'joined') return joined;
    if (activeTab === 'favorites') return favorites;
    return discover;
  }, [activeTab, administrated, moderated, joined, favorites, discover]);

  const orderedFavorites = useMemo(
    () => applyFavoritesOrder(favorites, favoritesOrder),
    [favorites, favoritesOrder]
  );

  const sortedJoined = useMemo(
    () => sortJoinedCommunities(joined, joinedSort),
    [joined, joinedSort]
  );

  const displayItems = useMemo(() => {
    if (activeTab === 'favorites') return orderedFavorites;
    if (activeTab === 'joined') return sortedJoined;
    return activeSectionItems;
  }, [activeSectionItems, activeTab, orderedFavorites, sortedJoined]);

  const activeSectionEmpty = useMemo(() => {
    if (activeTab === 'administrated') return t('communitiesHub.administratedEmpty', { defaultValue: 'No administrated communities yet.' });
    if (activeTab === 'moderated') return t('communitiesHub.moderatedEmpty', { defaultValue: 'No moderated communities yet.' });
    if (activeTab === 'joined') return t('communitiesHub.joinedEmpty', { defaultValue: 'No joined communities yet.' });
    if (activeTab === 'favorites') return t('communitiesHub.favoritesEmpty', { defaultValue: 'No favorite communities yet.' });
    return searchQuery.trim().length >= 2
      ? t('communitiesHub.noSearchResults', { defaultValue: 'No communities match this search.' })
      : t('communitiesHub.noDiscover', { defaultValue: 'No discover communities found for this interest yet.' });
  }, [activeTab, searchQuery, t]);

  function moveFavorite(communityName: string, direction: 'up' | 'down') {
    const name = normalizeCommunityName(communityName);
    if (!name) return;
    const base = orderedFavorites
      .map((community) => normalizeCommunityName(community.name))
      .filter(Boolean);
    const index = base.indexOf(name);
    if (index < 0) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= base.length) return;
    const next = [...base];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setFavoritesOrder(next);
  }

  function reorderFavoritesByNames(sourceName: string, targetName: string) {
    const source = normalizeCommunityName(sourceName);
    const target = normalizeCommunityName(targetName);
    if (!source || !target || source === target) return;
    const base = orderedFavorites
      .map((community) => normalizeCommunityName(community.name))
      .filter(Boolean);
    const sourceIndex = base.indexOf(source);
    const targetIndex = base.indexOf(target);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const next = [...base];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    setFavoritesOrder(next);
  }

  return (
    <View style={[s.container, { backgroundColor: c.surface, borderColor: c.border, height: panelHeight }]}>
      <View style={[s.header, { borderBottomColor: c.border }]}>
        <Text style={[s.headerTitle, { color: c.textPrimary }]}>
          {t('communitiesHub.title', { defaultValue: 'Communities' })}
        </Text>
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
            backgroundColor: c.primary,
          }}
          activeOpacity={0.85}
          onPress={() => setCreateDrawerOpen(true)}
        >
          <MaterialCommunityIcons name="plus" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
            {t('communitiesHub.createCommunity', { defaultValue: 'Create Community' })}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <View style={[s.contentColumn, { maxWidth: contentWidth }]}>
          <View style={s.topControls}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabsRow}>
              {tabs.map((tab) => {
                const selected = activeTab === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[
                      s.tabChip,
                      selected
                        ? { borderColor: c.primary, backgroundColor: `${c.primary}20` }
                        : { borderColor: c.border, backgroundColor: c.surface },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => setActiveTab(tab.key)}
                  >
                    <Text style={[s.tabChipText, { color: selected ? c.primary : c.textSecondary }]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={s.viewModeRow}>
              <TouchableOpacity
                style={[
                  s.viewChip,
                  viewMode === 'grid'
                    ? { borderColor: c.primary, backgroundColor: `${c.primary}20` }
                    : { borderColor: c.border, backgroundColor: c.surface },
                ]}
                activeOpacity={0.85}
                onPress={() => setViewMode('grid')}
              >
                <MaterialCommunityIcons name="view-grid-outline" size={16} color={viewMode === 'grid' ? c.primary : c.textSecondary} />
                <Text style={[s.viewChipText, { color: viewMode === 'grid' ? c.primary : c.textSecondary }]}>
                  {t('communitiesHub.viewGrid', { defaultValue: 'Grid' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.viewChip,
                  viewMode === 'list'
                    ? { borderColor: c.primary, backgroundColor: `${c.primary}20` }
                    : { borderColor: c.border, backgroundColor: c.surface },
                ]}
                activeOpacity={0.85}
                onPress={() => setViewMode('list')}
              >
                <MaterialCommunityIcons name="view-list-outline" size={16} color={viewMode === 'list' ? c.primary : c.textSecondary} />
                <Text style={[s.viewChipText, { color: viewMode === 'list' ? c.primary : c.textSecondary }]}>
                  {t('communitiesHub.viewList', { defaultValue: 'List' })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {activeTab === 'discover' ? (
            <>
              <View style={[s.searchWrap, { backgroundColor: c.inputBackground, borderColor: c.inputBorder }]}>
                <MaterialCommunityIcons name="magnify" size={16} color={c.textMuted} />
                <TextInput
                  style={[s.searchInput, { color: c.textPrimary }]}
                  placeholder={t('communitiesHub.searchPlaceholder', { defaultValue: 'Search communities...' })}
                  placeholderTextColor={c.placeholder}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
                {INTEREST_CATEGORIES.map((category) => {
                  const selected = selectedCategory === category;
                  const label =
                    category === 'all'
                      ? t('communitiesHub.categoryAll', { defaultValue: 'All' })
                      : t(`communitiesHub.category.${category}`, {
                          defaultValue: category.charAt(0).toUpperCase() + category.slice(1),
                        });
                  return (
                    <TouchableOpacity
                      key={category}
                      style={[
                        s.chip,
                        selected
                          ? { borderColor: c.primary, backgroundColor: `${c.primary}20` }
                          : { borderColor: c.border, backgroundColor: c.surface },
                      ]}
                      activeOpacity={0.85}
                      onPress={() => setSelectedCategory(category)}
                    >
                      <Text style={[s.chipText, { color: selected ? c.primary : c.textSecondary }]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          ) : null}

          {activeTab === 'favorites' ? (
            <View style={s.favoritesToolsRow}>
              <TouchableOpacity
                style={[
                  s.reorderChip,
                  favoritesReorderMode
                    ? { borderColor: c.primary, backgroundColor: `${c.primary}20` }
                    : { borderColor: c.border, backgroundColor: c.surface },
                ]}
                activeOpacity={0.85}
                onPress={() => setFavoritesReorderMode((prev) => !prev)}
              >
                <MaterialCommunityIcons
                  name={favoritesReorderMode ? 'check-circle-outline' : 'swap-vertical'}
                  size={16}
                  color={favoritesReorderMode ? c.primary : c.textSecondary}
                />
                <Text style={[s.reorderChipText, { color: favoritesReorderMode ? c.primary : c.textSecondary }]}>
                  {favoritesReorderMode
                    ? t('communitiesHub.doneReordering', { defaultValue: 'Done reordering' })
                    : t('communitiesHub.reorderFavorites', { defaultValue: 'Reorder favorites' })}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {activeTab === 'joined' ? (
            <View style={s.joinedSortRow}>
              {([
                { key: 'default', label: t('communitiesHub.sortDefault', { defaultValue: 'Default' }) },
                { key: 'active', label: t('communitiesHub.sortMostActive', { defaultValue: 'Most active' }) },
                { key: 'members', label: t('communitiesHub.sortMostMembers', { defaultValue: 'Most members' }) },
                { key: 'az', label: t('communitiesHub.sortAZ', { defaultValue: 'A–Z' }) },
              ] as Array<{ key: JoinedSortKey; label: string }>).map((opt) => {
                const selected = joinedSort === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      s.joinedSortChip,
                      selected
                        ? { borderColor: c.primary, backgroundColor: `${c.primary}20` }
                        : { borderColor: c.border, backgroundColor: c.surface },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => setJoinedSort(opt.key)}
                  >
                    <Text style={[s.joinedSortChipText, { color: selected ? c.primary : c.textSecondary }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {loading || (activeTab === 'discover' && discoverLoading) ? (
            <ActivityIndicator color={c.primary} size="large" style={{ marginTop: 24 }} />
          ) : displayItems.length === 0 ? (
            <Text style={[s.emptyText, { color: c.textMuted }]}>{activeSectionEmpty}</Text>
          ) : viewMode === 'grid' ? (
            <View style={[s.grid, { columnGap: horizontalGap, rowGap: 16 }]}>
              {displayItems.map((item, idx, arr) => {
                const communityName = (item.name || '').trim();
                const joinedAlready = Array.isArray(item.memberships) && item.memberships.length > 0;
                const isWebDragEnabled =
                  Platform.OS === 'web' && activeTab === 'favorites' && favoritesReorderMode && !!communityName;
                const cardNode = (
                  <CommunityCard
                    item={item}
                    c={c}
                    t={t}
                    mode="grid"
                    width={cardWidth}
                    onPress={() => communityName && onOpenCommunity(communityName)}
                    action={
                      activeTab === 'discover' && communityName
                        ? joinedAlready
                          ? (
                            <View style={[styles.joinBadge, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                              <Text style={[styles.joinBadgeText, { color: c.textMuted }]}>
                                {t('communitiesHub.joinedBadge', { defaultValue: 'Joined' })}
                              </Text>
                            </View>
                          )
                          : (
                            <TouchableOpacity
                              style={[styles.joinButton, { borderColor: c.primary, backgroundColor: c.primary }]}
                              activeOpacity={0.85}
                              disabled={joinLoadingName === communityName}
                              onPress={(event) => {
                                event.stopPropagation?.();
                                void handleJoinCommunity(item);
                              }}
                            >
                              {joinLoadingName === communityName ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <Text style={styles.joinButtonText}>
                                  {t('communitiesHub.joinAction', { defaultValue: 'Join' })}
                                </Text>
                              )}
                            </TouchableOpacity>
                          )
                        : activeTab === 'joined' && communityName
                          ? (
                            <TouchableOpacity
                              style={[styles.leaveButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                              activeOpacity={0.85}
                              disabled={leaveLoadingName === communityName}
                              onPress={(event) => {
                                event.stopPropagation?.();
                                requestLeaveCommunity(item);
                              }}
                            >
                              {leaveLoadingName === communityName ? (
                                <ActivityIndicator size="small" color={c.textSecondary} />
                              ) : (
                                <Text style={[styles.leaveButtonText, { color: c.textSecondary }]}>
                                  {t('communitiesHub.unjoinAction', { defaultValue: 'Unjoin' })}
                                </Text>
                              )}
                            </TouchableOpacity>
                          )
                          : activeTab === 'favorites' && favoritesReorderMode && communityName
                            ? Platform.OS === 'web'
                              ? (
                                <View style={[s.dragHintChip, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                                  <MaterialCommunityIcons name="drag-vertical" size={14} color={c.textSecondary} />
                                  <Text style={[s.dragHintText, { color: c.textSecondary }]}>
                                    {t('communitiesHub.dragToReorder', { defaultValue: 'Drag' })}
                                  </Text>
                                </View>
                              )
                              : (
                                <View style={s.reorderActionsRow}>
                                  <TouchableOpacity
                                    style={[s.reorderActionBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                                    activeOpacity={0.85}
                                    disabled={idx === 0}
                                    onPress={(event) => {
                                      event.stopPropagation?.();
                                      moveFavorite(communityName, 'up');
                                    }}
                                  >
                                    <MaterialCommunityIcons
                                      name="chevron-up"
                                      size={16}
                                      color={idx === 0 ? c.placeholder : c.textSecondary}
                                    />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[s.reorderActionBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                                    activeOpacity={0.85}
                                    disabled={idx === arr.length - 1}
                                    onPress={(event) => {
                                      event.stopPropagation?.();
                                      moveFavorite(communityName, 'down');
                                    }}
                                  >
                                    <MaterialCommunityIcons
                                      name="chevron-down"
                                      size={16}
                                      color={idx === arr.length - 1 ? c.placeholder : c.textSecondary}
                                    />
                                  </TouchableOpacity>
                                </View>
                              )
                          : null
                    }
                  />
                );
                return (
                  isWebDragEnabled ? (
                    <div
                      key={`${activeTab}-${item.id || item.name}`}
                      draggable
                      onDragStart={(event) => {
                        setDragSourceName(communityName);
                        event.dataTransfer?.setData?.('text/plain', communityName);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOverName(communityName);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const from =
                          dragSourceName ||
                          event.dataTransfer?.getData?.('text/plain') ||
                          '';
                        reorderFavoritesByNames(from, communityName);
                        setDragSourceName(null);
                        setDragOverName(null);
                      }}
                      onDragEnd={() => {
                        setDragSourceName(null);
                        setDragOverName(null);
                      }}
                      style={{ display: 'block' }}
                    >
                      <div
                        style={
                          dragOverName === communityName
                            ? { border: `2px dashed ${c.primary}`, borderRadius: 14 }
                            : undefined
                        }
                      >
                        {cardNode}
                      </div>
                    </div>
                  ) : (
                    <View key={`${activeTab}-${item.id || item.name}`}>
                      {cardNode}
                    </View>
                  )
                );
              })}
            </View>
          ) : (
            <View style={s.listWrap}>
              {displayItems.map((item, idx, arr) => {
                const communityName = (item.name || '').trim();
                const joinedAlready = Array.isArray(item.memberships) && item.memberships.length > 0;
                const isWebDragEnabled =
                  Platform.OS === 'web' && activeTab === 'favorites' && favoritesReorderMode && !!communityName;
                const cardNode = (
                  <CommunityCard
                    item={item}
                    c={c}
                    t={t}
                    mode="list"
                    onPress={() => communityName && onOpenCommunity(communityName)}
                    action={
                      activeTab === 'discover' && communityName
                        ? joinedAlready
                          ? (
                            <View style={[styles.joinBadge, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                              <Text style={[styles.joinBadgeText, { color: c.textMuted }]}>
                                {t('communitiesHub.joinedBadge', { defaultValue: 'Joined' })}
                              </Text>
                            </View>
                          )
                          : (
                            <TouchableOpacity
                              style={[styles.joinButton, { borderColor: c.primary, backgroundColor: c.primary }]}
                              activeOpacity={0.85}
                              disabled={joinLoadingName === communityName}
                              onPress={(event) => {
                                event.stopPropagation?.();
                                void handleJoinCommunity(item);
                              }}
                            >
                              {joinLoadingName === communityName ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <Text style={styles.joinButtonText}>
                                  {t('communitiesHub.joinAction', { defaultValue: 'Join' })}
                                </Text>
                              )}
                            </TouchableOpacity>
                          )
                        : activeTab === 'joined' && communityName
                          ? (
                            <TouchableOpacity
                              style={[styles.leaveButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                              activeOpacity={0.85}
                              disabled={leaveLoadingName === communityName}
                              onPress={(event) => {
                                event.stopPropagation?.();
                                requestLeaveCommunity(item);
                              }}
                            >
                              {leaveLoadingName === communityName ? (
                                <ActivityIndicator size="small" color={c.textSecondary} />
                              ) : (
                                <Text style={[styles.leaveButtonText, { color: c.textSecondary }]}>
                                  {t('communitiesHub.unjoinAction', { defaultValue: 'Unjoin' })}
                                </Text>
                              )}
                            </TouchableOpacity>
                          )
                          : activeTab === 'favorites' && favoritesReorderMode && communityName
                            ? Platform.OS === 'web'
                              ? (
                                <View style={[s.dragHintChip, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                                  <MaterialCommunityIcons name="drag-vertical" size={14} color={c.textSecondary} />
                                  <Text style={[s.dragHintText, { color: c.textSecondary }]}>
                                    {t('communitiesHub.dragToReorder', { defaultValue: 'Drag' })}
                                  </Text>
                                </View>
                              )
                              : (
                                <View style={s.reorderActionsRow}>
                                  <TouchableOpacity
                                    style={[s.reorderActionBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                                    activeOpacity={0.85}
                                    disabled={idx === 0}
                                    onPress={(event) => {
                                      event.stopPropagation?.();
                                      moveFavorite(communityName, 'up');
                                    }}
                                  >
                                    <MaterialCommunityIcons
                                      name="chevron-up"
                                      size={16}
                                      color={idx === 0 ? c.placeholder : c.textSecondary}
                                    />
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[s.reorderActionBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                                    activeOpacity={0.85}
                                    disabled={idx === arr.length - 1}
                                    onPress={(event) => {
                                      event.stopPropagation?.();
                                      moveFavorite(communityName, 'down');
                                    }}
                                  >
                                    <MaterialCommunityIcons
                                      name="chevron-down"
                                      size={16}
                                      color={idx === arr.length - 1 ? c.placeholder : c.textSecondary}
                                    />
                                  </TouchableOpacity>
                                </View>
                              )
                          : null
                    }
                  />
                );
                return (
                  isWebDragEnabled ? (
                    <div
                      key={`${activeTab}-${item.id || item.name}`}
                      draggable
                      onDragStart={(event) => {
                        setDragSourceName(communityName);
                        event.dataTransfer?.setData?.('text/plain', communityName);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOverName(communityName);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const from =
                          dragSourceName ||
                          event.dataTransfer?.getData?.('text/plain') ||
                          '';
                        reorderFavoritesByNames(from, communityName);
                        setDragSourceName(null);
                        setDragOverName(null);
                      }}
                      onDragEnd={() => {
                        setDragSourceName(null);
                        setDragOverName(null);
                      }}
                      style={{ display: 'block' }}
                    >
                      <div
                        style={
                          dragOverName === communityName
                            ? { border: `2px dashed ${c.primary}`, borderRadius: 14 }
                            : undefined
                        }
                      >
                        {cardNode}
                      </div>
                    </div>
                  ) : (
                    <View key={`${activeTab}-${item.id || item.name}`}>
                      {cardNode}
                    </View>
                  )
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
      <CreateCommunityDrawer
        visible={createDrawerOpen}
        token={token}
        c={c}
        t={t}
        onClose={() => setCreateDrawerOpen(false)}
        onCreated={(newCommunity) => {
          setAdministrated((prev) => dedupeCommunities([newCommunity, ...prev]));
          setJoined((prev) => dedupeCommunities([newCommunity, ...prev]));
          setActiveTab('administrated');
          onNotice(t('communitiesHub.communityCreated', { defaultValue: 'Community created! You are now its administrator.' }));
          if (newCommunity.name) onOpenCommunity(newCommunity.name);
        }}
      />

      <Modal
        transparent
        visible={!!leaveConfirmItem}
        animationType="fade"
        onRequestClose={() => {
          if (!leaveLoadingName) setLeaveConfirmItem(null);
        }}
      >
        <Pressable
          style={[s.confirmOverlay, { backgroundColor: c.modalBackdrop || 'rgba(10,16,28,0.55)' }]}
          onPress={() => {
            if (!leaveLoadingName) setLeaveConfirmItem(null);
          }}
        >
          <Pressable
            style={[s.confirmCard, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={() => {}}
          >
            <Text style={[s.confirmTitle, { color: c.textPrimary }]}>
              {t('communitiesHub.leaveConfirmTitle', { defaultValue: 'Leave this community?' })}
            </Text>
            <Text style={[s.confirmText, { color: c.textSecondary }]}>
              {t('communitiesHub.leaveConfirmMessage', {
                defaultValue:
                  'If you leave c/{{name}}, all of your content contributions in this community will be permanently deleted.',
                name: leaveConfirmItem?.name || '',
              })}
            </Text>
            <Text style={[s.confirmWarningText, { color: c.errorText || '#dc2626' }]}>
              {t('communitiesHub.leaveConfirmWarning', {
                defaultValue:
                  'This cannot be undone. Deleted contributions will not come back if you join again later.',
              })}
            </Text>
            <View style={s.confirmActions}>
              <TouchableOpacity
                style={[s.confirmBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                activeOpacity={0.85}
                disabled={!!leaveLoadingName}
                onPress={() => setLeaveConfirmItem(null)}
              >
                <Text style={[s.confirmBtnText, { color: c.textPrimary }]}>
                  {t('home.cancelAction', { defaultValue: 'Cancel' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.confirmBtn,
                  { borderColor: c.errorText || '#dc2626', backgroundColor: `${c.errorText || '#dc2626'}22` },
                ]}
                activeOpacity={0.85}
                disabled={!!leaveLoadingName}
                onPress={() => {
                  if (leaveConfirmItem) {
                    void handleLeaveCommunity(leaveConfirmItem);
                  }
                }}
              >
                {leaveLoadingName && leaveConfirmItem?.name === leaveLoadingName ? (
                  <ActivityIndicator size="small" color={c.errorText || '#dc2626'} />
                ) : (
                  <Text style={[s.confirmBtnText, { color: c.errorText || '#dc2626' }]}>
                    {t('communitiesHub.leaveConfirmAction', { defaultValue: 'Leave and delete contributions' })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  gridCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    minHeight: 242,
  },
  gridCoverWrap: {
    height: 128,
    borderBottomWidth: 1,
  },
  gridCoverImage: {
    width: '100%',
    height: '100%',
  },
  gridCoverFallback: {
    width: '100%',
    height: '100%',
  },
  gridBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  gridIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gridAvatarWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridAvatarImage: {
    width: '100%',
    height: '100%',
  },
  gridAvatarInitial: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  gridTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  gridHandle: {
    marginTop: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  gridFooter: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  gridMeta: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  listCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 108,
  },
  listCoverWrap: {
    width: 146,
    minHeight: 108,
  },
  listCoverImage: {
    width: '100%',
    height: '100%',
  },
  listCoverFallback: {
    width: '100%',
    height: '100%',
  },
  listMeta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  listAvatarWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listAvatarImage: {
    width: '100%',
    height: '100%',
  },
  listAvatarInitial: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  listTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  listHandle: {
    marginTop: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  listMetaText: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
  },
  joinButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  joinBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  leaveButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
});

function makeStyles(c: any) {
  return StyleSheet.create({
    container: {
      width: '100%',
      alignSelf: 'stretch',
      borderWidth: 1,
      borderRadius: 24,
      overflow: 'hidden',
    },
    header: {
      paddingHorizontal: 24,
      paddingVertical: 18,
      borderBottomWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    headerTitle: {
      fontSize: 44,
      fontWeight: '800',
      letterSpacing: -0.8,
      flexShrink: 1,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 12,
      paddingBottom: 24,
    },
    contentColumn: {
      width: '100%',
      alignSelf: 'center',
    },
    topControls: {
      paddingHorizontal: 8,
      paddingTop: 18,
      gap: 10,
    },
    tabsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    tabChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      minHeight: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabChipText: {
      fontSize: 13,
      fontWeight: '700',
    },
    viewModeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
    },
    favoritesToolsRow: {
      paddingHorizontal: 8,
      paddingTop: 10,
    },
    joinedSortRow: {
      paddingHorizontal: 8,
      paddingTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
    },
    joinedSortChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      minHeight: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    joinedSortChipText: {
      fontSize: 13,
      fontWeight: '700',
    },
    reorderChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      alignSelf: 'flex-start',
    },
    reorderChipText: {
      fontSize: 13,
      fontWeight: '700',
    },
    reorderActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    reorderActionBtn: {
      borderWidth: 1,
      borderRadius: 999,
      width: 30,
      height: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dragHintChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      minHeight: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    dragHintText: {
      fontSize: 12,
      fontWeight: '700',
    },
    viewChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    viewChipText: {
      fontSize: 13,
      fontWeight: '700',
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      minHeight: 44,
      marginHorizontal: 8,
      marginTop: 14,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
      paddingVertical: 10,
      fontWeight: '500',
    },
    chipsRow: {
      paddingTop: 12,
      paddingBottom: 4,
      gap: 8,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
    },
    chip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 14,
      minHeight: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipText: {
      fontSize: 14,
      fontWeight: '700',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
      paddingHorizontal: 8,
      paddingTop: 14,
    },
    listWrap: {
      paddingHorizontal: 8,
      paddingTop: 14,
      gap: 12,
    },
    emptyText: {
      fontSize: 15,
      fontWeight: '500',
      marginVertical: 18,
      marginHorizontal: 8,
    },
    confirmOverlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    confirmCard: {
      width: '100%',
      maxWidth: 560,
      borderWidth: 1,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 16,
      gap: 10,
    },
    confirmTitle: {
      fontSize: 20,
      fontWeight: '800',
    },
    confirmText: {
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
    },
    confirmWarningText: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '700',
    },
    confirmActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 4,
      flexWrap: 'wrap',
    },
    confirmBtn: {
      borderWidth: 1,
      borderRadius: 12,
      minHeight: 40,
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmBtnText: {
      fontSize: 14,
      fontWeight: '800',
    },
  });
}
