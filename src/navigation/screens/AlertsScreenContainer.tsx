/**
 * AlertsScreenContainer — native AlertsTab. Full-screen list of
 * notifications using NotificationRow / matchesNotificationFilter from the
 * shared NotificationDrawer module (web's drawer is left untouched). Keeps
 * the bottom tab bar tappable, unlike a Modal-based drawer.
 *
 * Polls /unread/count via NotificationsContext (every 60s). When the tab
 * is focused we re-fetch the list and the badge so it stays in sync with
 * web.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  NotificationRow,
  matchesNotificationFilter,
  type NotificationFilterKey,
} from '../../components/NotificationDrawer';
import ThemedFlatList from '../../components/ThemedFlatList';
import { api, AppNotification } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useNotifications } from '../../context/NotificationsContext';

const FILTER_KEYS: NotificationFilterKey[] = [
  'all', 'unread', 'comments', 'replies', 'connections',
  'follows', 'communities', 'mentions', 'reactions', 'reposts', 'moderation',
];

export default function AlertsScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const { unreadCount, refresh: refreshUnread, setUnreadCount } = useNotifications();
  const c = theme.colors;

  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextMaxId, setNextMaxId] = useState<number | undefined>(undefined);
  const [activeFilter, setActiveFilter] = useState<NotificationFilterKey>('all');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [deletingFiltered, setDeletingFiltered] = useState(false);
  const fetchSeqRef = useRef(0);

  const loadFirst = useCallback(async (silent = false) => {
    if (!token) return;
    const mySeq = ++fetchSeqRef.current;
    if (!silent) setLoading(true);
    try {
      const res = await api.getNotifications(token);
      if (mySeq !== fetchSeqRef.current) return;
      setItems(res.notifications);
      setHasMore(res.hasMore);
      setNextMaxId(res.nextMaxId);
    } catch {
      // empty list will render
    } finally {
      if (mySeq === fetchSeqRef.current && !silent) setLoading(false);
    }
  }, [token]);

  // Re-fetch list + unread count whenever the tab gains focus.
  useEffect(() => {
    if (isFocused && token) {
      void loadFirst(false);
      void refreshUnread();
    }
  }, [isFocused, token, loadFirst, refreshUnread]);

  const onLoadMore = useCallback(async () => {
    if (!token || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await api.getNotifications(token, nextMaxId);
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...res.notifications.filter((n) => !seen.has(n.id))];
      });
      setHasMore(res.hasMore);
      setNextMaxId(res.nextMaxId);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [token, loadingMore, hasMore, nextMaxId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFirst(true);
      await refreshUnread();
    } finally { setRefreshing(false); }
  }, [loadFirst, refreshUnread]);

  const onMarkRead = useCallback(async (id: number) => {
    if (!token) return;
    let wasUnread = false;
    setItems((prev) => prev.map((n) => {
      if (n.id !== id) return n;
      if (!n.read) wasUnread = true;
      return { ...n, read: true };
    }));
    if (wasUnread) setUnreadCount((cur) => cur - 1);
    try { await api.markNotificationRead(token, id); } catch { void refreshUnread(); }
  }, [token, setUnreadCount, refreshUnread]);

  const onMarkAllRead = useCallback(async () => {
    if (!token) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try { await api.markNotificationsRead(token); } catch { void refreshUnread(); }
  }, [token, setUnreadCount, refreshUnread]);

  const onDeleteNotification = useCallback(async (id: number) => {
    if (!token) return;
    let wasUnread = false;
    setItems((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target && !target.read) wasUnread = true;
      return prev.filter((n) => n.id !== id);
    });
    if (wasUnread) setUnreadCount((cur) => cur - 1);
    try { await api.deleteNotification(token, id); } catch { void refreshUnread(); }
  }, [token, setUnreadCount, refreshUnread]);

  const onDeleteAll = useCallback(async () => {
    if (!token) return;
    setItems([]);
    setUnreadCount(0);
    try { await api.deleteAllNotifications(token); } catch { void refreshUnread(); }
  }, [token, setUnreadCount, refreshUnread]);

  const onNavigateProfile = useCallback((username: string) => {
    if (!username) return;
    navigation.navigate('ProfileTab', { screen: 'Profile', params: { username } });
  }, [navigation]);

  const onNavigatePost = useCallback((
    _postId: number,
    postUuid?: string,
    commentId?: number,
    parentCommentId?: number,
  ) => {
    if (!postUuid) return;
    navigation.navigate('HomeTab', {
      screen: 'Post',
      params: { postUuid, focusCommentId: commentId, focusParentCommentId: parentCommentId },
    });
  }, [navigation]);

  const onNavigateCommunity = useCallback((name: string) => {
    if (!name) return;
    navigation.navigate('CommunitiesTab', { screen: 'Community', params: { name } });
  }, [navigation]);

  const onAcceptConnection = useCallback(async (username: string) => {
    if (!token || !username) return;
    await api.confirmConnection(token, username);
  }, [token]);

  const onDeclineConnection = useCallback(async (username: string) => {
    if (!token || !username) return;
    await api.disconnectFromUser(token, username);
  }, [token]);

  const onAcceptCommunityAdminInvite = useCallback(async (inviteId: number, communityName: string) => {
    if (!token) return;
    await api.respondCommunityAdministratorInvite(token, communityName, inviteId, 'accept');
  }, [token]);

  const onDeclineCommunityAdminInvite = useCallback(async (inviteId: number, communityName: string) => {
    if (!token) return;
    await api.respondCommunityAdministratorInvite(token, communityName, inviteId, 'decline');
  }, [token]);

  const onAcceptCommunityOwnershipTransfer = useCallback(async (inviteId: number, communityName: string) => {
    if (!token) return;
    await api.respondCommunityOwnershipTransferInvite(token, communityName, inviteId, 'accept');
  }, [token]);

  const onDeclineCommunityOwnershipTransfer = useCallback(async (inviteId: number, communityName: string) => {
    if (!token) return;
    await api.respondCommunityOwnershipTransferInvite(token, communityName, inviteId, 'decline');
  }, [token]);

  const onOpenModerationTasks = useCallback(() => {
    navigation.navigate('ProfileTab', { screen: 'ModerationTasks' });
  }, [navigation]);

  const filtered = useMemo(
    () => items.filter((n) => matchesNotificationFilter(n, activeFilter)),
    [items, activeFilter],
  );

  const filterLabelOf = useCallback((key: NotificationFilterKey) => {
    const map: Record<NotificationFilterKey, string> = {
      all: t('home.notificationFilterAll', { defaultValue: 'All' }),
      unread: t('home.notificationFilterUnread', { defaultValue: 'Unread' }),
      comments: t('home.notificationFilterComments', { defaultValue: 'Comments' }),
      replies: t('home.notificationFilterReplies', { defaultValue: 'Replies' }),
      connections: t('home.notificationFilterConnections', { defaultValue: 'Connections' }),
      follows: t('home.notificationFilterFollows', { defaultValue: 'Follows' }),
      communities: t('home.notificationFilterCommunities', { defaultValue: 'Communities' }),
      mentions: t('home.notificationFilterMentions', { defaultValue: 'Mentions' }),
      reactions: t('home.notificationFilterReactions', { defaultValue: 'Reactions' }),
      reposts: t('home.notificationFilterReposts', { defaultValue: 'Reposts' }),
      moderation: t('home.notificationFilterModeration', { defaultValue: 'Moderation' }),
    };
    return map[key];
  }, [t]);

  const handleClearShown = useCallback(async () => {
    if (!filtered.length || deletingFiltered) return;
    const ids = filtered.map((n) => n.id);
    const idSet = new Set(ids);
    setDeletingFiltered(true);
    setItems((prev) => prev.filter((n) => !idSet.has(n.id)));
    try {
      await Promise.all(ids.map((id) => api.deleteNotification(token!, id).catch(() => null)));
    } finally {
      void refreshUnread();
      setDeletingFiltered(false);
    }
  }, [filtered, deletingFiltered, token, refreshUnread]);

  if (!token) return null;

  if (loading && items.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {/* Header — title + counts + actions */}
      <View style={[styles.header, { borderBottomColor: c.border, backgroundColor: c.surface }]}>
        <View style={styles.headerTitleRow}>
          <MaterialCommunityIcons name="bell-outline" size={22} color={c.textPrimary} />
          <Text style={[styles.headerTitle, { color: c.textPrimary }]}>
            {t('home.notificationDrawerTitle', { defaultValue: 'Notifications' })}
            {unreadCount > 0 ? <Text style={{ color: c.primary }}>{`  ${unreadCount}`}</Text> : null}
          </Text>
        </View>
        <View style={styles.headerActionsRow}>
          {unreadCount > 0 ? (
            <TouchableOpacity
              onPress={onMarkAllRead}
              activeOpacity={0.8}
              style={[styles.headerBtn, { backgroundColor: c.inputBackground }]}
            >
              <Text style={[styles.headerBtnText, { color: c.textSecondary }]}>
                {t('home.notificationMarkAllRead', { defaultValue: 'Mark all read' })}
              </Text>
            </TouchableOpacity>
          ) : null}
          {filtered.length > 0 ? (
            <TouchableOpacity
              onPress={() => void handleClearShown()}
              activeOpacity={0.8}
              disabled={deletingFiltered}
              style={[styles.headerBtn, { backgroundColor: c.inputBackground }]}
            >
              {deletingFiltered ? (
                <ActivityIndicator color={c.textSecondary} size="small" />
              ) : (
                <Text style={[styles.headerBtnText, { color: c.errorText }]}>
                  {t('home.notificationClearShown', { defaultValue: 'Clear shown' })}
                </Text>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Filter bar */}
      <View style={[styles.filterWrap, { borderBottomColor: c.border, backgroundColor: c.background }]}>
        <TouchableOpacity
          onPress={() => setFilterMenuOpen((p) => !p)}
          activeOpacity={0.85}
          style={[styles.filterToggle, { borderColor: c.border, backgroundColor: c.inputBackground }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="filter-variant" size={15} color={c.textSecondary} />
            <Text style={[styles.filterToggleText, { color: c.textPrimary }]}>
              {t('home.notificationFilterLabel', { defaultValue: 'Filter' })}: {filterLabelOf(activeFilter)}
            </Text>
          </View>
          <MaterialCommunityIcons name={filterMenuOpen ? 'chevron-up' : 'chevron-down'} size={18} color={c.textSecondary} />
        </TouchableOpacity>

        {filterMenuOpen ? (
          <View style={styles.filterChips}>
            {FILTER_KEYS.map((key) => {
              const selected = activeFilter === key;
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => { setActiveFilter(key); setFilterMenuOpen(false); }}
                  activeOpacity={0.85}
                  style={[
                    styles.filterChip,
                    {
                      borderColor: selected ? c.primary : c.border,
                      backgroundColor: selected ? `${c.primary}20` : c.surface,
                    },
                  ]}
                >
                  <Text style={[styles.filterChipText, { color: selected ? c.primary : c.textSecondary }]}>
                    {filterLabelOf(key)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>

      {/* List */}
      <ThemedFlatList
        data={filtered}
        keyExtractor={(n) => `notif-${n.id}`}
        renderItem={({ item }) => (
          <NotificationRow
            notif={item}
            c={c}
            t={t}
            onMarkRead={onMarkRead}
            onDelete={onDeleteNotification}
            onNavigateProfile={onNavigateProfile}
            onNavigatePost={onNavigatePost}
            onNavigateCommunity={onNavigateCommunity}
            onAcceptConnection={onAcceptConnection}
            onDeclineConnection={onDeclineConnection}
            onAcceptCommunityAdminInvite={onAcceptCommunityAdminInvite}
            onDeclineCommunityAdminInvite={onDeclineCommunityAdminInvite}
            onAcceptCommunityOwnershipTransfer={onAcceptCommunityOwnershipTransfer}
            onDeclineCommunityOwnershipTransfer={onDeclineCommunityOwnershipTransfer}
            onOpenModerationTasks={onOpenModerationTasks}
          />
        )}
        contentContainerStyle={{ paddingBottom: 140 }}
        onEndReached={() => { void onLoadMore(); }}
        onEndReachedThreshold={0.4}
        refreshing={refreshing}
        onRefresh={() => { void onRefresh(); }}
        refreshTintColor={c.textPrimary}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <MaterialCommunityIcons name="bell-sleep-outline" size={48} color={c.textMuted} />
            <Text style={[styles.emptyTitle, { color: c.textMuted }]}>
              {t('home.notificationEmptyTitle', { defaultValue: 'All caught up' })}
            </Text>
            <Text style={[styles.emptyBody, { color: c.textMuted }]}>
              {t('home.notificationEmptyBody', { defaultValue: 'New notifications will appear here.' })}
            </Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ActivityIndicator color={c.primary} size="small" />
            </View>
          ) : !hasMore && filtered.length > 0 ? (
            <View style={{ paddingVertical: 24, alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 13, color: c.textMuted }}>
                {t('home.notificationAllCaughtUp', { defaultValue: "You've seen them all." })}
              </Text>
              {items.length > 3 ? (
                <TouchableOpacity onPress={onDeleteAll} activeOpacity={0.8}>
                  <Text style={{ fontSize: 13, color: c.errorText }}>
                    {t('home.notificationClearAll', { defaultValue: 'Clear all' })}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 22, fontWeight: '800' },
  headerActionsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  headerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    minHeight: 34,
    justifyContent: 'center',
  },
  headerBtnText: { fontSize: 13, fontWeight: '700' },

  filterWrap: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
  filterToggle: {
    borderWidth: 1, borderRadius: 10, minHeight: 38, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  filterToggleText: { fontSize: 13, fontWeight: '700' },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 10 },
  filterChip: {
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 12,
    height: 34, alignItems: 'center', justifyContent: 'center',
  },
  filterChipText: { fontSize: 12, fontWeight: '700' },

  emptyWrap: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
