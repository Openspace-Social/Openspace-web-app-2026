import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, FederatedLinkedAccount, FederatedTimelineNotification, FederatedTimelineStatus } from '../api/client';
import { openExternalLink } from '../utils/openExternalLink';
import { postCardStyles } from '../styles/postCardStyles';
import NativeInlineVideo, { type NativeInlineVideoHandle } from './NativeInlineVideo';
import { useAutoPlayMedia } from '../hooks/useAutoPlayMedia';
import { useIsInViewport } from '../hooks/useIsInViewport';

type Props = {
  c: any;
  t: (key: string, options?: any) => string;
  /** Auth token — used for favourite / boost / bookmark / reply / context
   *  API calls. When null, the interactive controls render disabled so
   *  the screen still works as a read-only display. */
  token?: string | null;
  loading: boolean;
  error: string;
  items: FederatedTimelineStatus[];
  notifications?: FederatedTimelineNotification[];
  linkedAccount: FederatedLinkedAccount | null;
  loadingMore?: boolean;
  hasMore?: boolean;
  onOpenLinkedAccounts?: () => void;
  feedSource?: 'home' | 'posts' | 'notifications';
  onChangeFeedSource?: (value: 'home' | 'posts' | 'notifications') => void;
  onOpenRemoteProfile?: (query: string, fallbackUrl?: string) => void;
  onOpenRemoteThread?: (url: string) => void;
};

// Per-status local overrides — populated optimistically on tap and
// reconciled with the authoritative server response. Keeping all three
// toggles + their counts in one shape means a single map drives the UI.
type StatusOverride = {
  favourited?: boolean;
  favouritesCount?: number;
  reblogged?: boolean;
  reblogsCount?: number;
  bookmarked?: boolean;
  repliesCount?: number;
};

function stripHtml(html?: string) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(day / 365)}y`;
}

function formatCount(value?: number | null): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export default function MastodonFeedScreen({
  c,
  t,
  token,
  loading,
  error,
  items,
  notifications = [],
  linkedAccount,
  loadingMore = false,
  hasMore = false,
  onOpenLinkedAccounts,
  feedSource = 'home',
  onChangeFeedSource,
  onOpenRemoteProfile,
  onOpenRemoteThread,
}: Props) {
  const styles = useMemo(() => makeStyles(c), [c]);

  const [overridesById, setOverridesById] = useState<Record<string, StatusOverride>>({});
  // Loading flag map keyed `${statusId}:${action}` so taps on one button
  // don't visually freeze the others while a request is in flight.
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const [contextById, setContextById] = useState<Record<string, FederatedTimelineStatus[]>>({});
  const [contextLoading, setContextLoading] = useState<Record<string, boolean>>({});
  const [contextError, setContextError] = useState<Record<string, string>>({});

  const [replyDraftById, setReplyDraftById] = useState<Record<string, string>>({});
  const [replySubmitting, setReplySubmitting] = useState<Record<string, boolean>>({});

  // Reply-composer modal state. When set, a focused full-screen sheet
  // appears with a preview of the post being replied to + a single
  // multi-line input — mirrors the `composerState` pattern from
  // PostDetailModal so writing a reply feels the same on Mastodon
  // posts as it does on OpenSpace ones.
  const [composerStatusId, setComposerStatusId] = useState<string | null>(null);
  const { height: screenHeight } = useWindowDimensions();

  // Single read of the user's autoplay-media preference; threaded down
  // to each video so they all honour the same setting without re-reading
  // AsyncStorage per item.
  const autoPlayMedia = useAutoPlayMedia();

  // Generic optimistic-toggle runner. Avoids 6 near-identical handlers
  // for fav / unfav / boost / unboost / bookmark / unbookmark.
  const runToggle = useCallback(
    async (
      status: FederatedTimelineStatus,
      action: 'favourite' | 'reblog' | 'bookmark',
      nextEnabled: boolean,
    ) => {
      if (!token || !linkedAccount?.id) {
        void openExternalLink(status.url);
        return;
      }
      const id = status.id;
      const key = `${id}:${action}`;
      if (actionLoading[key]) return;

      const baseOverride = overridesById[id] || {};
      const baseFav = baseOverride.favourited ?? !!status.favourited;
      const baseFavCount = baseOverride.favouritesCount ?? (typeof status.favourites_count === 'number' ? status.favourites_count : 0);
      const baseRb = baseOverride.reblogged ?? !!status.reblogged;
      const baseRbCount = baseOverride.reblogsCount ?? (typeof status.reblogs_count === 'number' ? status.reblogs_count : 0);
      const baseBm = baseOverride.bookmarked ?? !!status.bookmarked;

      const optimisticPatch: StatusOverride = { ...baseOverride };
      if (action === 'favourite') {
        optimisticPatch.favourited = nextEnabled;
        optimisticPatch.favouritesCount = Math.max(0, baseFavCount + (nextEnabled ? 1 : -1));
      } else if (action === 'reblog') {
        optimisticPatch.reblogged = nextEnabled;
        optimisticPatch.reblogsCount = Math.max(0, baseRbCount + (nextEnabled ? 1 : -1));
      } else if (action === 'bookmark') {
        optimisticPatch.bookmarked = nextEnabled;
      }
      setOverridesById((prev) => ({ ...prev, [id]: optimisticPatch }));
      setActionLoading((prev) => ({ ...prev, [key]: true }));

      try {
        const apiCall =
          action === 'favourite'
            ? (nextEnabled ? api.favouriteFederatedStatus : api.unfavouriteFederatedStatus)
            : action === 'reblog'
              ? (nextEnabled ? api.reblogFederatedStatus : api.unreblogFederatedStatus)
              : (nextEnabled ? api.bookmarkFederatedStatus : api.unbookmarkFederatedStatus);
        const updated = await apiCall(token, linkedAccount.id, id);
        setOverridesById((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            favourited: !!updated.favourited,
            favouritesCount: typeof updated.favourites_count === 'number' ? updated.favourites_count : prev[id]?.favouritesCount,
            reblogged: !!updated.reblogged,
            reblogsCount: typeof updated.reblogs_count === 'number' ? updated.reblogs_count : prev[id]?.reblogsCount,
            bookmarked: !!updated.bookmarked,
          },
        }));
      } catch {
        // Revert to base on failure.
        setOverridesById((prev) => ({
          ...prev,
          [id]: {
            ...prev[id],
            favourited: baseFav,
            favouritesCount: baseFavCount,
            reblogged: baseRb,
            reblogsCount: baseRbCount,
            bookmarked: baseBm,
          },
        }));
      } finally {
        setActionLoading((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [token, linkedAccount?.id, overridesById, actionLoading],
  );

  const handleToggleComments = useCallback(
    async (status: FederatedTimelineStatus) => {
      const id = status.id;
      const wasExpanded = !!expandedById[id];
      setExpandedById((prev) => ({ ...prev, [id]: !wasExpanded }));
      if (wasExpanded) return;
      if (contextById[id] || !token || !linkedAccount?.id) return;
      setContextLoading((prev) => ({ ...prev, [id]: true }));
      setContextError((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      try {
        const ctx = await api.getFederatedStatusContext(token, linkedAccount.id, id);
        setContextById((prev) => ({ ...prev, [id]: ctx.descendants || [] }));
      } catch (e: any) {
        setContextError((prev) => ({
          ...prev,
          [id]: e?.message || t('home.mastodonContextLoadError', { defaultValue: 'Could not load comments.' }),
        }));
      } finally {
        setContextLoading((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [token, linkedAccount?.id, expandedById, contextById, t],
  );

  const handleSubmitReply = useCallback(
    async (status: FederatedTimelineStatus) => {
      if (!token || !linkedAccount?.id) return;
      const id = status.id;
      const draft = (replyDraftById[id] || '').trim();
      if (!draft || replySubmitting[id]) return;
      setReplySubmitting((prev) => ({ ...prev, [id]: true }));
      try {
        const newReply = await api.replyToFederatedStatus(token, linkedAccount.id, id, draft);
        setContextById((prev) => ({
          ...prev,
          [id]: [...(prev[id] || []), newReply],
        }));
        setReplyDraftById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Keep the parent's reply count in sync so the Comments button
        // chip updates without a refetch.
        setOverridesById((prev) => {
          const baseCount = prev[id]?.repliesCount ?? (typeof status.replies_count === 'number' ? status.replies_count : 0);
          return {
            ...prev,
            [id]: { ...prev[id], repliesCount: baseCount + 1 },
          };
        });
        // Reveal the thread (with the new reply at the bottom) and
        // close the focused composer modal.
        setExpandedById((prev) => ({ ...prev, [id]: true }));
        setComposerStatusId((prev) => (prev === id ? null : prev));
      } catch (e: any) {
        setContextError((prev) => ({
          ...prev,
          [id]: e?.message || t('home.mastodonReplyFailed', { defaultValue: 'Could not post reply.' }),
        }));
      } finally {
        setReplySubmitting((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [token, linkedAccount?.id, replyDraftById, replySubmitting, t],
  );

  // Resolve the status the composer is targeting. Mastodon items can be
  // reblogs (item.reblog), so the inner status — the one whose id we
  // captured — is what we render in the preview.
  const composerStatus = useMemo(() => {
    if (!composerStatusId) return null;
    for (const item of items) {
      const inner = item.reblog || item;
      if (inner.id === composerStatusId) return inner;
    }
    return null;
  }, [composerStatusId, items]);

  const composerDraft = composerStatusId ? (replyDraftById[composerStatusId] || '') : '';
  const composerSubmitting = composerStatusId ? !!replySubmitting[composerStatusId] : false;
  const composerCanSubmit = composerDraft.trim().length > 0 && !composerSubmitting;
  const closeComposer = () => {
    if (composerSubmitting) return;
    // Dismiss the keyboard ourselves — without this, on iOS the first
    // tap on the X (or backdrop) only blurs the focused TextInput and
    // doesn't fire the press handler, making the close button feel
    // broken until the user taps a second time.
    Keyboard.dismiss();
    setComposerStatusId(null);
  };

  const showConnectBanner = !linkedAccount;
  const activeItemCount = feedSource === 'notifications' ? notifications.length : items.length;

  // On web, wrap the whole feed in a `feedCard`-equivalent outer card
  // so the Mastodon column matches the OpenSpace one (HomeScreen uses
  // the same maxWidth: 760 / padding: 16 / bordered wrapper around its
  // composer + post list). On native the screen renders flat.
  const webOuterCardStyle = Platform.OS === 'web' ? styles.webOuterCard : null;

  // Card chrome — match whatever the surrounding feed uses on this
  // platform so the Mastodon column doesn't look out-of-place.
  //  - Native: FeedScreenContainer overrides postCardStyles.feedPostCard
  //    to edge-to-edge (no L/R borders, hairline bottom, no radius).
  //    We mirror that here so the Mastodon cards have the same width.
  //  - Web: HomeScreen renders OpenSpace cards with the BASE style
  //    (rounded, bordered, full padding). Edge-to-edge there made the
  //    Mastodon cards visibly wider than the OpenSpace ones.
  const cardStyle = useMemo(
    () =>
      Platform.OS === 'web'
        ? postCardStyles.feedPostCard
        : {
            ...postCardStyles.feedPostCard,
            borderTopWidth: 0,
            borderLeftWidth: 0,
            borderRightWidth: 0,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderRadius: 0,
            paddingHorizontal: 14,
          },
    [],
  );

  return (
    <View
      style={[
        styles.container,
        webOuterCardStyle,
        Platform.OS === 'web' ? { borderColor: c.border, backgroundColor: c.surface } : null,
      ]}
    >
      {showConnectBanner ? (
        <View style={styles.chromeInset}>
        <View style={[styles.connectBanner, { borderColor: c.border, backgroundColor: c.surface }]}>
          <View style={styles.connectBannerLeft}>
            <View style={styles.mastodonPill}>
              <MaterialCommunityIcons name="mastodon" size={14} color="#6364FF" />
              <Text style={styles.mastodonPillText}>Mastodon</Text>
            </View>
            <Text style={[styles.connectBannerText, { color: c.textSecondary }]}>
              {t('home.mastodonFeedDisconnectedBody', {
                defaultValue: 'Connect a Mastodon account in Linked Accounts to bring your home timeline into OpenSpace.',
              })}
            </Text>
          </View>
          {onOpenLinkedAccounts ? (
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.connectBannerCta, { backgroundColor: c.primary }]}
              onPress={onOpenLinkedAccounts}
            >
              <Text style={styles.connectBannerCtaText}>
                {t('home.linkedAccountsTitle', { defaultValue: 'Connect' })}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        </View>
      ) : null}

      {linkedAccount && onChangeFeedSource ? (
        <View style={styles.chromeInset}>
          <View style={[styles.sourceTabs, { borderColor: c.border, backgroundColor: c.surface }]}>
            {([
              { key: 'home', label: t('home.mastodonFeedHomeTab', { defaultValue: 'Home' }) },
              { key: 'posts', label: t('home.mastodonFeedPostsTab', { defaultValue: 'Your posts' }) },
              { key: 'notifications', label: t('home.mastodonFeedNotificationsTab', { defaultValue: 'Notifications' }) },
            ] as const).map((tab) => {
              const active = feedSource === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  activeOpacity={0.88}
                  onPress={() => onChangeFeedSource(tab.key)}
                  style={[
                    styles.sourceTabButton,
                    {
                      backgroundColor: active ? c.primary : c.inputBackground,
                      borderColor: active ? c.primary : c.border,
                    },
                  ]}
                >
                  <Text style={[styles.sourceTabText, { color: active ? '#fff' : c.textSecondary }]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={c.primary} size="small" style={styles.loading} />
      ) : error ? (
        <View style={styles.chromeInset}>
          <Text style={[styles.errorText, { color: c.errorText }]}>{error}</Text>
        </View>
      ) : activeItemCount === 0 ? (
        <View style={styles.chromeInset}>
          <Text style={[styles.emptyText, { color: c.textMuted }]}>
            {linkedAccount
              ? (
                feedSource === 'posts'
                  ? t('home.mastodonPostsEmpty', { defaultValue: 'No Mastodon posts from this account yet.' })
                  : feedSource === 'notifications'
                    ? t('home.mastodonNotificationsEmpty', { defaultValue: 'No Mastodon notifications yet.' })
                    : t('home.mastodonFeedEmpty', { defaultValue: 'No Mastodon posts in this timeline yet.' })
              )
              : t('home.mastodonFeedNeedsAccount', { defaultValue: 'Link a Mastodon account to view this feed.' })}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {feedSource === 'notifications' ? (
            notifications.map((item) => {
              const account = item.account || null;
              const status = item.status || null;
              const displayName = account?.display_name || account?.username || 'Mastodon';
              const handle = account?.acct || account?.username || linkedAccount?.instance_domain || '';
              const relativeTime = formatRelativeTime(item.created_at);
              const typeLabel = item.type === 'mention'
                ? t('home.mastodonNotificationMention', { defaultValue: 'mentioned you' })
                : item.type === 'reblog'
                  ? t('home.mastodonNotificationReblog', { defaultValue: 'boosted your post' })
                  : item.type === 'favourite'
                    ? t('home.mastodonNotificationFavourite', { defaultValue: 'favorited your post' })
                    : item.type === 'follow'
                      ? t('home.mastodonNotificationFollow', { defaultValue: 'followed you' })
                      : item.type === 'poll'
                        ? t('home.mastodonNotificationPoll', { defaultValue: 'updated a poll' })
                        : item.type === 'status'
                          ? t('home.mastodonNotificationStatus', { defaultValue: 'posted' })
                          : item.type || t('home.mastodonNotificationGeneric', { defaultValue: 'sent an update' });
              const text = stripHtml(status?.content);

              return (
                <View
                  key={item.id}
                  style={[
                    cardStyle,
                    { borderColor: c.border, backgroundColor: c.surface },
                  ]}
                >
                  <View style={postCardStyles.feedPostHeader}>
                    <View style={postCardStyles.feedHeaderLeft}>
                      <TouchableOpacity
                        activeOpacity={account?.acct || account?.profile_url ? 0.8 : 1}
                        disabled={!(account?.acct || account?.profile_url) || !onOpenRemoteProfile}
                        style={postCardStyles.feedHeaderLeft}
                        onPress={() => {
                          const query = account?.profile_url || (account?.acct ? `@${account.acct}` : '');
                          if (query && onOpenRemoteProfile) {
                            onOpenRemoteProfile(query, account?.profile_url || status?.url || undefined);
                          }
                        }}
                      >
                        {account?.avatar_url ? (
                          <View style={[postCardStyles.feedAvatar, { backgroundColor: c.primary }]}>
                            <Image source={{ uri: account.avatar_url }} style={postCardStyles.feedAvatarImage} resizeMode="cover" />
                          </View>
                        ) : (
                          <View style={[postCardStyles.feedAvatar, { backgroundColor: c.primary }]}>
                            <Text style={postCardStyles.feedAvatarLetter}>
                              {(displayName || 'M').slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <View style={postCardStyles.feedHeaderMeta}>
                          <Text numberOfLines={1} style={[postCardStyles.feedAuthor, { color: c.textPrimary }]}>
                            {displayName}
                          </Text>
                          <Text numberOfLines={1} style={[postCardStyles.feedDate, { color: c.textMuted }]}>
                            @{handle}
                            {relativeTime ? ` · ${relativeTime}` : ''}
                            {' · '}
                            <Text style={{ color: '#6364FF', fontWeight: '700' }}>{typeLabel}</Text>
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {text ? (
                    <View style={postCardStyles.feedTextWrap}>
                      <Text style={[postCardStyles.feedText, { color: c.textPrimary }]}>{text}</Text>
                    </View>
                  ) : null}

                  {status?.url ? (
                    <View style={[postCardStyles.feedActionsRow, styles.actionsRowTight]}>
                      {onOpenRemoteThread ? (
                        <ActionChip
                          c={c}
                          iconActive="source-branch"
                          iconInactive="source-branch"
                          activeColor={c.primary}
                          active={false}
                          label={t('home.mastodonActionOpenHere', { defaultValue: 'Open here' })}
                          onPress={() => onOpenRemoteThread(status.url!)}
                        />
                      ) : null}
                      <ActionChip
                        c={c}
                        iconActive="open-in-new"
                        iconInactive="open-in-new"
                        activeColor={c.textSecondary}
                        active={false}
                        label={t('home.mastodonActionOpen', { defaultValue: 'Open' })}
                        onPress={() => void openExternalLink(status.url)}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })
          ) : null}

          {feedSource !== 'notifications' ? items.map((item) => {
            const status = item.reblog || item;
            const account = status.account || item.account || null;
            const media = status.media_attachments || [];
            // First-render priority: image > video > gifv. Mastodon
            // posts often only have one media attachment so this picks
            // the right one in the common case; multi-media posts
            // currently fall back to whichever appears first.
            const firstMedia =
              media.find((entry) => entry.type === 'image')
              || media.find((entry) => entry.type === 'video')
              || media.find((entry) => entry.type === 'gifv');
            const firstImage = firstMedia?.type === 'image' ? firstMedia : undefined;
            const firstVideo = firstMedia && (firstMedia.type === 'video' || firstMedia.type === 'gifv') ? firstMedia : undefined;
            const text = stripHtml(status.content);
            const spoiler = stripHtml(status.spoiler_text);
            const isReblog = !!item.reblog;
            const handle = account?.acct || account?.username || linkedAccount?.instance_domain || '';
            const displayName = account?.display_name || account?.username || 'Mastodon';
            const relativeTime = formatRelativeTime(status.created_at);

            const ov = overridesById[status.id] || {};
            const isFavourited = ov.favourited ?? !!status.favourited;
            const favouriteCount = ov.favouritesCount ?? (typeof status.favourites_count === 'number' ? status.favourites_count : 0);
            const isFavLoading = !!actionLoading[`${status.id}:favourite`];

            const isReblogged = ov.reblogged ?? !!status.reblogged;
            const reblogCount = ov.reblogsCount ?? (typeof status.reblogs_count === 'number' ? status.reblogs_count : 0);
            const isReblogLoading = !!actionLoading[`${status.id}:reblog`];

            const isBookmarked = ov.bookmarked ?? !!status.bookmarked;
            const isBookmarkLoading = !!actionLoading[`${status.id}:bookmark`];

            const isExpanded = !!expandedById[status.id];
            const isContextLoading = !!contextLoading[status.id];
            const ctxError = contextError[status.id];
            const descendants = contextById[status.id] || [];
            const replyCount = ov.repliesCount ?? (typeof status.replies_count === 'number' ? status.replies_count : 0);

            const draft = replyDraftById[status.id] || '';
            const isReplySubmitting = !!replySubmitting[status.id];
            const canSubmitReply = draft.trim().length > 0 && !isReplySubmitting;

            return (
              <View
                key={item.id}
                style={[
                  cardStyle,
                  { borderColor: c.border, backgroundColor: c.surface },
                ]}
              >
                {isReblog ? (
                  <View style={styles.reblogBadgeRow}>
                    <MaterialCommunityIcons name="repeat" size={13} color={c.textMuted} />
                    <Text style={[styles.reblogBadgeText, { color: c.textMuted }]}>
                      {t('home.mastodonReblogLabel', { defaultValue: 'Boosted from Mastodon' })}
                    </Text>
                  </View>
                ) : null}

                <View style={postCardStyles.feedPostHeader}>
                  <TouchableOpacity
                    activeOpacity={account?.acct || account?.profile_url ? 0.8 : 1}
                    disabled={!(account?.acct || account?.profile_url) || !onOpenRemoteProfile}
                    style={postCardStyles.feedHeaderLeft}
                    onPress={() => {
                      const query = account?.profile_url || (account?.acct ? `@${account.acct}` : '');
                      if (query && onOpenRemoteProfile) {
                        onOpenRemoteProfile(query, account?.profile_url || status?.url || undefined);
                      }
                    }}
                  >
                    {account?.avatar_url ? (
                      <View style={[postCardStyles.feedAvatar, { backgroundColor: c.primary }]}>
                        <Image source={{ uri: account.avatar_url }} style={postCardStyles.feedAvatarImage} resizeMode="cover" />
                      </View>
                    ) : (
                      <View style={[postCardStyles.feedAvatar, { backgroundColor: c.primary }]}>
                        <Text style={postCardStyles.feedAvatarLetter}>
                          {(displayName || 'M').slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={postCardStyles.feedHeaderMeta}>
                      <Text numberOfLines={1} style={[postCardStyles.feedAuthor, { color: c.textPrimary }]}>
                        {displayName}
                      </Text>
                      <Text numberOfLines={1} style={[postCardStyles.feedDate, { color: c.textMuted }]}>
                        @{handle}
                        {relativeTime ? ` · ${relativeTime}` : ''}
                        {' · '}
                        <Text style={{ color: '#6364FF', fontWeight: '700' }}>via Mastodon</Text>
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>

                {(spoiler || text) ? (
                  <View style={postCardStyles.feedTextWrap}>
                    {spoiler ? (
                      <Text style={[styles.spoiler, { color: c.textSecondary }]}>{spoiler}</Text>
                    ) : null}
                    {text ? (
                      <Text style={[postCardStyles.feedText, { color: c.textPrimary }]}>{text}</Text>
                    ) : null}
                  </View>
                ) : null}

                {firstImage?.preview_url || firstImage?.url ? (
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => void openExternalLink(firstImage.url || firstImage.preview_url)}
                  >
                    <Image
                      source={{ uri: firstImage.preview_url || firstImage.url }}
                      style={postCardStyles.feedMedia}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>
                ) : null}

                {/* Embedded link preview — Mastodon's `status.card` is a
                    server-rendered open-graph snapshot, so we don't need
                    to fetch it ourselves like we do for OpenSpace comments. */}
                {(() => {
                  const card = status.card && typeof status.card === 'object' ? (status.card as Record<string, any>) : null;
                  if (!card) return null;
                  const cardUrl = typeof card.url === 'string' ? card.url : null;
                  if (!cardUrl) return null;
                  const cardTitle = typeof card.title === 'string' ? card.title : '';
                  const cardDescription = typeof card.description === 'string' ? card.description : '';
                  const cardImage = typeof card.image === 'string' ? card.image : null;
                  const cardProvider = typeof card.provider_name === 'string' ? card.provider_name : null;
                  // Skip cards that have no useful content beyond the URL —
                  // matches what we do for comment-link previews.
                  if (!cardImage && !cardTitle && !cardDescription) return null;
                  return (
                    <TouchableOpacity
                      style={[postCardStyles.shortPostLinkPreviewCard, { borderColor: c.border, backgroundColor: c.inputBackground, marginTop: 6 }]}
                      activeOpacity={0.88}
                      onPress={() => void openExternalLink(cardUrl)}
                    >
                      {cardImage ? (
                        <Image source={{ uri: cardImage }} style={postCardStyles.shortPostLinkPreviewImage} resizeMode="cover" />
                      ) : null}
                      <View style={postCardStyles.shortPostLinkPreviewMeta}>
                        {cardProvider ? (
                          <Text numberOfLines={1} style={[postCardStyles.shortPostLinkPreviewSite, { color: c.textMuted }]}>
                            {cardProvider}
                          </Text>
                        ) : null}
                        {cardTitle ? (
                          <Text numberOfLines={2} style={[postCardStyles.shortPostLinkPreviewTitle, { color: c.textPrimary }]}>
                            {cardTitle}
                          </Text>
                        ) : null}
                        {cardDescription ? (
                          <Text numberOfLines={2} style={[postCardStyles.shortPostLinkPreviewDescription, { color: c.textSecondary }]}>
                            {cardDescription}
                          </Text>
                        ) : null}
                        <Text numberOfLines={1} style={[postCardStyles.shortPostLinkPreviewUrl, { color: c.textLink }]}>
                          {cardUrl}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })()}

                {firstVideo?.url ? (
                  <MastodonVideoMedia
                    videoUri={firstVideo.url}
                    posterUri={firstVideo.preview_url}
                    isGifv={firstVideo.type === 'gifv'}
                    autoPlayMedia={autoPlayMedia}
                    c={c}
                    styles={styles}
                  />
                ) : null}

                <View style={[postCardStyles.feedActionsRow, styles.actionsRowTight]}>
                  {status.url && onOpenRemoteThread ? (
                    <ActionChip
                      c={c}
                      iconActive="source-branch"
                      iconInactive="source-branch"
                      activeColor={c.primary}
                      active={false}
                      label={t('home.mastodonActionOpenHere', { defaultValue: 'Open here' })}
                      onPress={() => onOpenRemoteThread(status.url!)}
                    />
                  ) : null}
                  <ActionChip
                    c={c}
                    iconActive="star"
                    iconInactive="star-outline"
                    activeColor="#F5A623"
                    active={isFavourited}
                    loading={isFavLoading}
                    label={favouriteCount > 0 ? formatCount(favouriteCount) : t('home.mastodonActionFavourite', { defaultValue: 'Fav' })}
                    onPress={() => void runToggle(status, 'favourite', !isFavourited)}
                  />
                  <ActionChip
                    c={c}
                    iconActive="comment-text"
                    iconInactive="comment-text-outline"
                    activeColor={c.primary}
                    active={isExpanded}
                    label={replyCount > 0 ? formatCount(replyCount) : t('home.mastodonActionComments', { defaultValue: 'Reply' })}
                    onPress={() => void handleToggleComments(status)}
                  />
                  <ActionChip
                    c={c}
                    iconActive="repeat-variant"
                    iconInactive="repeat-variant"
                    activeColor="#22C55E"
                    active={isReblogged}
                    loading={isReblogLoading}
                    label={reblogCount > 0 ? formatCount(reblogCount) : t('home.mastodonActionBoost', { defaultValue: 'Boost' })}
                    onPress={() => void runToggle(status, 'reblog', !isReblogged)}
                  />
                  <ActionChip
                    c={c}
                    iconActive="bookmark"
                    iconInactive="bookmark-outline"
                    activeColor="#3B82F6"
                    active={isBookmarked}
                    loading={isBookmarkLoading}
                    label={t('home.mastodonActionBookmark', { defaultValue: 'Save' })}
                    onPress={() => void runToggle(status, 'bookmark', !isBookmarked)}
                  />
                  <ActionChip
                    c={c}
                    iconActive="open-in-new"
                    iconInactive="open-in-new"
                    activeColor={c.textSecondary}
                    active={false}
                    label={t('home.mastodonActionOpen', { defaultValue: 'Open' })}
                    onPress={() => void openExternalLink(status.url)}
                  />
                </View>

                {isExpanded ? (
                  <View style={[styles.threadWrap, { borderTopColor: c.border }]}>
                    {isContextLoading ? (
                      <ActivityIndicator color={c.primary} size="small" style={styles.threadLoading} />
                    ) : ctxError ? (
                      <Text style={[styles.threadError, { color: c.errorText }]}>{ctxError}</Text>
                    ) : descendants.length === 0 ? (
                      <Text style={[styles.threadEmpty, { color: c.textMuted }]}>
                        {t('home.mastodonContextEmpty', { defaultValue: 'No comments yet. Be the first to reply.' })}
                      </Text>
                    ) : (
                      descendants.map((reply) => {
                        const replyAccount = reply.account;
                        const replyText = stripHtml(reply.content);
                        const replyHandle = replyAccount?.acct || replyAccount?.username || '';
                        const replyDisplay = replyAccount?.display_name || replyAccount?.username || 'Mastodon';
                        const replyTime = formatRelativeTime(reply.created_at);
                        return (
                          <View key={reply.id} style={[styles.threadItem, { borderTopColor: c.border }]}>
                            {replyAccount?.avatar_url ? (
                              <Image source={{ uri: replyAccount.avatar_url }} style={styles.threadAvatar} />
                            ) : (
                              <View style={[styles.threadAvatar, { backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }]}>
                                <Text style={styles.threadAvatarLetter}>
                                  {(replyDisplay || 'M').slice(0, 1).toUpperCase()}
                                </Text>
                              </View>
                            )}
                            <View style={styles.threadBody}>
                              <Text numberOfLines={1} style={[styles.threadAuthor, { color: c.textPrimary }]}>
                                {replyDisplay}
                                <Text style={[styles.threadHandle, { color: c.textMuted }]}>
                                  {' '}@{replyHandle}{replyTime ? ` · ${replyTime}` : ''}
                                </Text>
                              </Text>
                              {replyText ? (
                                <Text style={[styles.threadText, { color: c.textSecondary }]}>{replyText}</Text>
                              ) : null}
                            </View>
                          </View>
                        );
                      })
                    )}

                    {token && linkedAccount?.id ? (
                      <TouchableOpacity
                        style={[
                          styles.replyLauncher,
                          {
                            borderTopColor: c.border,
                            borderColor: c.inputBorder,
                            backgroundColor: c.inputBackground,
                          },
                        ]}
                        activeOpacity={0.85}
                        onPress={() => setComposerStatusId(status.id)}
                      >
                        <Text style={[styles.replyLauncherText, { color: c.textMuted }]} numberOfLines={1}>
                          {draft.trim().length > 0
                            ? draft
                            : t('home.mastodonReplyPlaceholder', { defaultValue: 'Reply to this Mastodon post…' })}
                        </Text>
                        <MaterialCommunityIcons name="pencil-outline" size={16} color={c.textMuted} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          }) : null}

          {loadingMore ? (
            <ActivityIndicator color={c.primary} size="small" style={styles.loadingMore} />
          ) : !hasMore ? (
            <Text style={[styles.endText, { color: c.textMuted }]}>
              {t('home.feedEndOfResults', { defaultValue: "You're all caught up!" })}
            </Text>
          ) : null}
        </View>
      )}

      <Modal
        visible={composerStatus !== null}
        animationType="fade"
        transparent
        onRequestClose={closeComposer}
      >
        {composerStatus ? (
          <View style={styles.composerOverlay} pointerEvents="box-none">
            <Pressable
              style={styles.composerBackdrop}
              onPress={closeComposer}
            />
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.composerKeyboardWrap}
            >
              <View
                style={[
                  styles.composerSheet,
                  Platform.OS === 'web' ? styles.composerSheetWeb : styles.composerSheetMobile,
                  {
                    borderColor: c.border,
                    backgroundColor: c.surface,
                    maxHeight: Math.min(screenHeight * 0.88, 760),
                  },
                ]}
              >
                {Platform.OS !== 'web' ? (
                  <View style={styles.composerGrabberWrap}>
                    <View style={[styles.composerGrabber, { backgroundColor: c.border }]} />
                  </View>
                ) : null}

                <View style={styles.composerHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.composerTitle, { color: c.textPrimary }]}>
                      {t('home.mastodonReplySubmit', { defaultValue: 'Reply' })}
                    </Text>
                    <Text style={[styles.composerSubtitle, { color: c.textMuted }]} numberOfLines={1}>
                      {t('home.replyingToLabel', {
                        defaultValue: 'Replying to @{{username}}',
                        username:
                          composerStatus.account?.acct
                          || composerStatus.account?.username
                          || linkedAccount?.instance_domain
                          || 'Mastodon',
                      })}
                    </Text>
                  </View>
                  <Pressable
                    // Pressable instead of TouchableOpacity — avoids the
                    // iOS quirk where, with the keyboard open inside a
                    // Modal, the first tap on a TouchableOpacity above
                    // the input gets eaten by the keyboard's
                    // tap-to-dismiss behaviour and never fires onPress.
                    onPress={closeComposer}
                    disabled={composerSubmitting}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.composerCloseBtn,
                      { borderColor: c.border, backgroundColor: c.inputBackground },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                  </Pressable>
                </View>

                {(() => {
                  const previewText = stripHtml(composerStatus.content);
                  const previewMedia = composerStatus.media_attachments || [];
                  const previewImage = previewMedia.find((m) => m.type === 'image');
                  const previewAccount = composerStatus.account;
                  return (
                    <View
                      style={[
                        styles.composerPreview,
                        { borderColor: c.border, backgroundColor: c.inputBackground },
                      ]}
                    >
                      <View style={styles.composerPreviewHeader}>
                        {previewAccount?.avatar_url ? (
                          <Image source={{ uri: previewAccount.avatar_url }} style={styles.composerPreviewAvatar} />
                        ) : (
                          <View style={[styles.composerPreviewAvatar, { backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }]}>
                            <Text style={styles.composerPreviewAvatarLetter}>
                              {(previewAccount?.display_name || previewAccount?.username || 'M').slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text numberOfLines={1} style={[styles.composerPreviewAuthor, { color: c.textPrimary }]}>
                            {previewAccount?.display_name || previewAccount?.username || 'Mastodon'}
                          </Text>
                          <Text numberOfLines={1} style={[styles.composerPreviewHandle, { color: c.textMuted }]}>
                            @{previewAccount?.acct || previewAccount?.username || linkedAccount?.instance_domain || ''}
                          </Text>
                        </View>
                      </View>
                      {previewText ? (
                        <Text numberOfLines={4} style={[styles.composerPreviewText, { color: c.textSecondary }]}>
                          {previewText}
                        </Text>
                      ) : null}
                      {previewImage?.preview_url || previewImage?.url ? (
                        <Image
                          source={{ uri: previewImage.preview_url || previewImage.url }}
                          style={styles.composerPreviewImage}
                          resizeMode="cover"
                        />
                      ) : null}
                    </View>
                  );
                })()}

                <TextInput
                  style={[
                    styles.composerInput,
                    { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary },
                  ]}
                  value={composerDraft}
                  onChangeText={(value) =>
                    setReplyDraftById((prev) => ({ ...prev, [composerStatus.id]: value }))
                  }
                  placeholder={t('home.mastodonReplyPlaceholder', { defaultValue: 'Reply to this Mastodon post…' })}
                  placeholderTextColor={c.placeholder}
                  multiline
                  autoFocus
                  editable={!composerSubmitting}
                />

                <TouchableOpacity
                  style={[
                    styles.composerSubmit,
                    {
                      backgroundColor: composerCanSubmit ? c.primary : c.inputBackground,
                      borderColor: c.border,
                    },
                  ]}
                  activeOpacity={0.85}
                  disabled={!composerCanSubmit}
                  onPress={() => void handleSubmitReply(composerStatus)}
                >
                  {composerSubmitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[styles.composerSubmitText, { color: composerCanSubmit ? '#fff' : c.textMuted }]}>
                      {t('home.mastodonReplySubmit', { defaultValue: 'Reply' })}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

// Single chip used by all 5 action buttons. Centralised so the colour /
// loading / icon-swap rules are consistent across the row.
function ActionChip({
  c,
  iconActive,
  iconInactive,
  activeColor,
  active,
  loading,
  label,
  onPress,
}: {
  c: any;
  iconActive: string;
  iconInactive: string;
  activeColor: string;
  active: boolean;
  loading?: boolean;
  label: string;
  onPress: () => void;
}) {
  const tint = active ? activeColor : c.textSecondary;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={[postCardStyles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground, paddingHorizontal: 4 }]}
      onPress={onPress}
      disabled={!!loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <MaterialCommunityIcons name={(active ? iconActive : iconInactive) as any} size={18} color={tint} />
      )}
      <Text style={[postCardStyles.feedActionText, { color: tint, fontSize: 12 }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// Per-card video media. Owns its own viewport ref so play/pause can be
// driven by visibility, mirroring the rest of the app's autoplay UX —
// without that the player kept running once activated even after the
// user scrolled away.
function MastodonVideoMedia({
  videoUri,
  posterUri,
  isGifv,
  autoPlayMedia,
  c,
  styles,
}: {
  videoUri: string;
  posterUri?: string;
  isGifv: boolean;
  autoPlayMedia: boolean;
  c: any;
  styles: ReturnType<typeof makeStyles>;
}) {
  const viewportRef = useRef<View | null>(null);
  // 0.7 matches PostCard's threshold — needs ≥70% of the card on screen
  // before counting as visible, which prevents thrashing when a video
  // is half-scrolled.
  const { isInViewport, onLayout } = useIsInViewport(viewportRef, 0.7);
  const playerRef = useRef<NativeInlineVideoHandle>(null);
  const [userTapped, setUserTapped] = useState(false);

  // Mount the player once either the autoplay setting permits it OR
  // the user has explicitly tapped play. Toggling play/pause via the
  // imperative handle is cheaper than mount/unmount on every viewport
  // change.
  const isPlayerMounted = (autoPlayMedia || userTapped) && Platform.OS !== 'web';

  useEffect(() => {
    if (!isPlayerMounted) return;
    const player = playerRef.current;
    if (!player) return;
    if (isInViewport) player.play();
    else player.pause();
  }, [isInViewport, isPlayerMounted]);

  return (
    <View ref={viewportRef} onLayout={onLayout} collapsable={false}>
      {isPlayerMounted ? (
        <View style={[postCardStyles.feedMedia, styles.videoWrap, { backgroundColor: '#000' }]}>
          <NativeInlineVideo
            ref={playerRef}
            uri={videoUri}
            autoPlay={isInViewport}
            // Autoplay-driven playback stays muted (matches PostCard);
            // a deliberate tap unmutes so the user hears what they
            // chose to engage with.
            muted={!userTapped}
            nativeControls
            contentFit="contain"
            style={styles.videoPlayer}
          />
        </View>
      ) : (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => {
            if (Platform.OS === 'web') {
              void openExternalLink(videoUri);
              return;
            }
            setUserTapped(true);
          }}
        >
          <View style={styles.videoPosterWrap}>
            {posterUri ? (
              <Image source={{ uri: posterUri }} style={postCardStyles.feedMedia} resizeMode="cover" />
            ) : (
              <View style={[postCardStyles.feedMedia, { backgroundColor: '#000' }]} />
            )}
            <View style={styles.videoPlayOverlay}>
              <View style={styles.videoPlayBadge}>
                <MaterialCommunityIcons name="play" size={28} color="#fff" />
              </View>
            </View>
            {isGifv ? (
              <View style={styles.videoTypeChip}>
                <Text style={styles.videoTypeChipText}>GIF</Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    container: {
      // No outer horizontal padding — post cards run edge-to-edge to
      // match the rest of OpenSpace's feeds. Chrome elements that
      // shouldn't go full-bleed (the connect banner, loading/empty
      // states) get their own horizontal padding via the inset wrapper
      // below.
    },
    // Web-only: matches HomeScreen's `feedCard` exactly so the Mastodon
    // column has identical width and chrome to the OpenSpace one.
    webOuterCard: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      borderWidth: 1,
      borderRadius: 16,
      padding: 16,
      marginBottom: 20,
    },
    chromeInset: {
      // Outer card already pads on web; no need to inset further.
      paddingHorizontal: Platform.OS === 'web' ? 0 : 16,
      paddingTop: Platform.OS === 'web' ? 0 : 12,
    },
    connectBanner: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    connectBannerLeft: {
      flex: 1,
      gap: 6,
    },
    mastodonPill: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: '#6364FF14',
      borderColor: '#6364FF33',
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    mastodonPillText: {
      color: '#6364FF',
      fontSize: 11,
      fontWeight: '700',
    },
    connectBannerText: {
      fontSize: 13,
      lineHeight: 18,
    },
    connectBannerCta: {
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    connectBannerCtaText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '700',
    },
    sourceTabs: {
      marginTop: 12,
      marginBottom: 4,
      borderWidth: 1,
      borderRadius: 14,
      padding: 6,
      flexDirection: 'row',
      gap: 8,
    },
    sourceTabButton: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sourceTabText: {
      fontSize: 13,
      fontWeight: '800',
    },
    loading: {
      paddingVertical: 32,
    },
    errorText: {
      fontSize: 14,
      fontWeight: '600',
      paddingVertical: 12,
    },
    emptyText: {
      fontSize: 14,
      textAlign: 'center',
      paddingVertical: 32,
    },
    list: {
      // Cards are edge-to-edge with a hairline bottom border doing
      // most of the visual separation; an 8px gap matches the
      // FeedScreenContainer separator so the rhythm feels identical.
      gap: 8,
    },
    actionsRowTight: {
      gap: 6,
    },
    reblogBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 4,
    },
    reblogBadgeText: {
      fontSize: 12,
      fontWeight: '600',
    },
    spoiler: {
      fontSize: 13,
      fontWeight: '700',
      marginBottom: 6,
    },
    threadWrap: {
      borderTopWidth: 1,
      marginTop: 10,
      paddingTop: 10,
      gap: 10,
    },
    threadLoading: {
      paddingVertical: 12,
    },
    threadError: {
      fontSize: 13,
      fontWeight: '600',
      paddingVertical: 8,
    },
    threadEmpty: {
      fontSize: 13,
      paddingVertical: 8,
      textAlign: 'center',
    },
    threadItem: {
      flexDirection: 'row',
      gap: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    videoPosterWrap: {
      position: 'relative',
    },
    videoPlayOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    videoPlayBadge: {
      width: 56,
      height: 56,
      borderRadius: 999,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    videoTypeChip: {
      position: 'absolute',
      top: 8,
      right: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
    },
    videoTypeChipText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    videoWrap: {
      overflow: 'hidden',
    },
    videoPlayer: {
      width: '100%',
      height: '100%',
    },
    threadAvatar: {
      width: 30,
      height: 30,
      borderRadius: 999,
      overflow: 'hidden',
    },
    threadAvatarLetter: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 13,
    },
    threadBody: {
      flex: 1,
      gap: 2,
    },
    threadAuthor: {
      fontSize: 13,
      fontWeight: '700',
    },
    threadHandle: {
      fontSize: 12,
      fontWeight: '500',
    },
    threadText: {
      fontSize: 13,
      lineHeight: 18,
    },
    // Inline launcher button at the bottom of the expanded thread —
    // tapping it opens the focused composer modal.
    replyLauncher: {
      borderTopWidth: 1,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      marginTop: 4,
    },
    replyLauncherText: {
      flex: 1,
      fontSize: 13,
    },
    // Focused reply composer modal — mirrors PostDetailModal's composer
    // overlay so the UX is consistent across feed types.
    composerOverlay: {
      flex: 1,
      justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
      alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
    },
    composerBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(11,14,19,0.7)',
    },
    composerKeyboardWrap: {
      width: '100%',
      alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
      justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    },
    composerSheet: {
      borderWidth: 1,
      padding: 16,
      gap: 12,
    },
    composerSheetWeb: {
      width: '100%',
      maxWidth: 640,
      borderRadius: 18,
    },
    composerSheetMobile: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingBottom: 28,
    },
    composerGrabberWrap: {
      alignItems: 'center',
      marginBottom: 4,
    },
    composerGrabber: {
      width: 42,
      height: 5,
      borderRadius: 999,
    },
    composerHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    composerTitle: {
      fontSize: 20,
      fontWeight: '800',
    },
    composerSubtitle: {
      fontSize: 13,
      marginTop: 2,
    },
    composerCloseBtn: {
      width: 36,
      height: 36,
      borderRadius: 999,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    composerPreview: {
      borderWidth: 1,
      borderRadius: 14,
      padding: 12,
      gap: 8,
    },
    composerPreviewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    composerPreviewAvatar: {
      width: 32,
      height: 32,
      borderRadius: 999,
      overflow: 'hidden',
    },
    composerPreviewAvatarLetter: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 13,
    },
    composerPreviewAuthor: {
      fontSize: 13,
      fontWeight: '700',
    },
    composerPreviewHandle: {
      fontSize: 12,
    },
    composerPreviewText: {
      fontSize: 13,
      lineHeight: 18,
    },
    composerPreviewImage: {
      width: '100%',
      height: 140,
      borderRadius: 10,
    },
    composerInput: {
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      lineHeight: 20,
      minHeight: 120,
      textAlignVertical: 'top' as const,
    },
    composerSubmit: {
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    composerSubmitText: {
      fontSize: 14,
      fontWeight: '700',
    },
    loadingMore: {
      paddingVertical: 16,
    },
    endText: {
      textAlign: 'center',
      fontSize: 13,
      paddingVertical: 20,
    },
  });
}
