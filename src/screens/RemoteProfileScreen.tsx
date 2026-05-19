import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { api, type FederatedInboundObject, type FederatedRemoteActorDetail } from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import { useAppToast } from '../toast/AppToastContext';
import { openExternalLink } from '../utils/openExternalLink';

function stripHtml(html?: string | null) {
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

function formatRelativeTime(iso?: string | null) {
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
  return new Date(ts).toLocaleDateString();
}

function formatCount(value?: number) {
  const n = typeof value === 'number' ? value : 0;
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
}

function makeStyles(c: any) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    scrollContent: { padding: 16, gap: 14 },
    hero: {
      borderRadius: 20,
      padding: 18,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card || c.inputBackground,
      gap: 12,
    },
    heroHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    heroAvatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: `${c.primary}20`,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    heroAvatarImage: { width: '100%', height: '100%' },
    heroAvatarLetter: { color: c.primary, fontSize: 28, fontWeight: '800' },
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.inputBackground,
      paddingHorizontal: 10,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    pillText: { color: c.textSecondary, fontSize: 12, fontWeight: '700' },
    title: { color: c.textPrimary, fontSize: 24, fontWeight: '800' },
    subtitle: { color: c.textSecondary, fontSize: 14, lineHeight: 20 },
    sectionTitle: { color: c.textPrimary, fontSize: 18, fontWeight: '800' },
    sectionHint: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
    card: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card || c.inputBackground,
      padding: 16,
      gap: 10,
    },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    handle: { color: c.textPrimary, fontSize: 15, fontWeight: '700', flexShrink: 1 },
    meta: { color: c.textMuted, fontSize: 12, fontWeight: '600' },
    body: { color: c.textPrimary, fontSize: 15, lineHeight: 22 },
    badge: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: `${c.primary}18`,
    },
    badgeText: { color: c.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
    empty: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.inputBackground,
      padding: 18,
      gap: 8,
    },
    emptyText: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
    link: { color: c.primary, fontSize: 13, fontWeight: '700' },
    actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    actionButton: {
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: c.primary,
      backgroundColor: c.primary,
    },
    actionButtonSecondary: {
      backgroundColor: c.inputBackground,
    },
    actionButtonDisabled: {
      opacity: 0.55,
    },
    actionButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    actionButtonTextSecondary: { color: c.primary },
  });
}

function RemoteObjectCard({
  item,
  c,
  onPress,
}: {
  item: FederatedInboundObject;
  c: any;
  onPress: () => void;
}) {
  const styles = useMemo(() => makeStyles(c), [c]);
  const body = stripHtml(item.content_text || item.content_html || item.summary);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed ? { opacity: 0.88 } : null]}>
      <View style={styles.row}>
        <Text style={styles.handle} numberOfLines={1}>
          {item.actor.handle || item.actor.preferred_username || item.actor.actor_uri}
        </Text>
        <Text style={styles.meta}>{formatRelativeTime(item.published_at)}</Text>
      </View>
      <Text style={styles.body} numberOfLines={4}>
        {body || 'No preview available.'}
      </Text>
      <View style={styles.row}>
        <View style={styles.pill}>
          <MaterialCommunityIcons name="earth" size={14} color={c.textSecondary} />
          <Text style={styles.pillText}>
            {item.in_reply_to_uri ? 'Remote reply' : 'Remote post'}
          </Text>
        </View>
        {item.local_post?.uuid ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Touches OpenSpace</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

type Props = {
  token: string;
  remoteActorId: number;
  onOpenThread: (inboundObjectId: number) => void;
};

type ItemFilter = 'all' | 'posts' | 'replies' | 'touches';

export default function RemoteProfileScreen({ token, remoteActorId, onOpenThread }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const c = theme.colors;
  const styles = useMemo(() => makeStyles(c), [c]);

  const [payload, setPayload] = useState<FederatedRemoteActorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [followSubmitting, setFollowSubmitting] = useState(false);
  const [itemFilter, setItemFilter] = useState<ItemFilter>('all');

  const load = useCallback(async () => {
    if (!token || !remoteActorId) return;
    setLoading(true);
    try {
      const next = await api.getFederatedRemoteActorDetail(token, remoteActorId);
      setPayload(next);
    } catch (e: any) {
      showToast(
        e?.message || t('home.federatedRemoteProfileLoadError', { defaultValue: 'Could not load fediverse profile.' }),
        { type: 'error' },
      );
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [token, remoteActorId, showToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const actor = payload?.actor;
  const relationship = payload?.relationship;
  const hasLinkedMastodonAccount = !!payload?.acting_linked_account?.id;
  const isFollowing = !!relationship?.following;
  const isRequested = !!relationship?.requested;
  const recentItems = payload?.recent_items || [];
  const touchCount = recentItems.filter((item) => !!item.local_post?.uuid).length;
  const filteredItems = recentItems.filter((item) => {
    if (itemFilter === 'posts') return !item.in_reply_to_uri;
    if (itemFilter === 'replies') return !!item.in_reply_to_uri;
    if (itemFilter === 'touches') return !!item.local_post?.uuid;
    return true;
  });

  const handleToggleFollow = useCallback(async () => {
    if (!token || !remoteActorId || followSubmitting) return;
    if (!hasLinkedMastodonAccount) {
      showToast(
        t('home.federatedFollowRequiresLinkedMastodon', {
          defaultValue: 'Link a Mastodon account before following fediverse profiles.',
        }),
        { type: 'error' },
      );
      return;
    }

    setFollowSubmitting(true);
    try {
      const next = isFollowing
        ? await api.unfollowFederatedRemoteActor(token, remoteActorId)
        : await api.followFederatedRemoteActor(token, remoteActorId);
      setPayload((prev) => (
        prev
          ? {
              ...prev,
              acting_linked_account: next.acting_linked_account ?? prev.acting_linked_account,
              resolved_account: next.resolved_account ?? prev.resolved_account,
              relationship: next.relationship ?? prev.relationship,
            }
          : prev
      ));
      showToast(
        isFollowing
          ? t('home.federatedUnfollowSuccess', { defaultValue: 'Unfollowed on Mastodon.' })
          : t('home.federatedFollowSuccess', { defaultValue: 'Following on Mastodon.' }),
        { type: 'success' },
      );
    } catch (e: any) {
      showToast(
        e?.message || t('home.federatedFollowActionError', {
          defaultValue: 'OpenSpace could not update that fediverse follow right now.',
        }),
        { type: 'error' },
      );
    } finally {
      setFollowSubmitting(false);
    }
  }, [
    followSubmitting,
    hasLinkedMastodonAccount,
    isFollowing,
    remoteActorId,
    showToast,
    t,
    token,
  ]);

  if (loading && !payload) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <View style={styles.hero}>
        <View style={styles.row}>
          <View style={[styles.heroHeader, { flex: 1 }]}>
            <View style={styles.heroAvatar}>
              {actor?.profile?.avatar ? (
                <Image source={{ uri: actor.profile.avatar }} style={styles.heroAvatarImage} resizeMode="cover" />
              ) : (
                <Text style={styles.heroAvatarLetter}>
                  {((actor?.display_name || actor?.profile?.name || actor?.handle || 'F').replace(/^@/, '').trim()[0] || 'F').toUpperCase()}
                </Text>
              )}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.title}>{actor?.profile?.name || actor?.display_name || 'Fediverse profile'}</Text>
              <Text style={styles.subtitle}>{actor?.handle || actor?.actor_uri}</Text>
            </View>
          </View>
        </View>
        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => void handleToggleFollow()}
            disabled={followSubmitting || !hasLinkedMastodonAccount || isRequested}
            style={({ pressed }) => [
              styles.actionButton,
              (isFollowing || isRequested) ? styles.actionButtonSecondary : null,
              (followSubmitting || !hasLinkedMastodonAccount || isRequested) ? styles.actionButtonDisabled : null,
              pressed ? { opacity: 0.9 } : null,
            ]}
          >
            <Text
              style={[
                styles.actionButtonText,
                (isFollowing || isRequested) ? styles.actionButtonTextSecondary : null,
              ]}
            >
              {isRequested
                ? t('home.federatedFollowRequested', { defaultValue: 'Requested' })
                : isFollowing
                  ? t('home.federatedFollowing', { defaultValue: 'Following' })
                  : t('home.federatedFollow', { defaultValue: 'Follow on Mastodon' })}
            </Text>
          </Pressable>
          <Pressable onPress={() => actor?.profile_url && void openExternalLink(actor.profile_url)}>
            <Text style={styles.link}>{t('home.openExternal', { defaultValue: 'Open' })}</Text>
          </Pressable>
        </View>
        <View style={styles.pillRow}>
          <View style={styles.pill}>
            <MaterialCommunityIcons name="earth" size={14} color={c.textSecondary} />
            <Text style={styles.pillText}>Remote profile</Text>
          </View>
          <View style={styles.pill}>
            <MaterialCommunityIcons name="text-box-multiple-outline" size={14} color={c.textSecondary} />
            <Text style={styles.pillText}>{formatCount(payload?.counts?.cached_items)} cached items</Text>
          </View>
          <View style={styles.pill}>
            <MaterialCommunityIcons name="post-outline" size={14} color={c.textSecondary} />
            <Text style={styles.pillText}>{formatCount(payload?.counts?.cached_posts)} posts</Text>
          </View>
          <View style={styles.pill}>
            <MaterialCommunityIcons name="reply-outline" size={14} color={c.textSecondary} />
            <Text style={styles.pillText}>{formatCount(payload?.counts?.cached_replies)} replies</Text>
          </View>
          <View style={styles.pill}>
            <MaterialCommunityIcons name="link-variant" size={14} color={c.textSecondary} />
            <Text style={styles.pillText}>{formatCount(touchCount)} touching OpenSpace</Text>
          </View>
        </View>
        <Text style={styles.sectionHint}>
          {t(
            'home.federatedRemoteProfileHint',
            { defaultValue: 'This is a cached fediverse profile built from the remote content OpenSpace already knows about.' },
          )}
        </Text>
        {actor?.summary ? (
          <Text style={styles.sectionHint}>{stripHtml(actor.summary)}</Text>
        ) : null}
        {!hasLinkedMastodonAccount ? (
          <Text style={styles.sectionHint}>
            {t(
              'home.federatedRemoteProfileLinkHint',
              { defaultValue: 'Link a Mastodon account to follow remote profiles and interact across the fediverse.' },
            )}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={styles.sectionTitle}>
          {t('home.federatedRecentActivity', { defaultValue: 'Recent federated activity' })}
        </Text>
        <View style={styles.pillRow}>
          {([
            { key: 'all', label: t('home.filterAll', { defaultValue: 'All' }) },
            { key: 'posts', label: t('home.remotePostsFilter', { defaultValue: 'Posts' }) },
            { key: 'replies', label: t('home.remoteRepliesFilter', { defaultValue: 'Replies' }) },
            { key: 'touches', label: t('home.remoteTouchesFilter', { defaultValue: 'Touches OpenSpace' }) },
          ] as const).map((option) => {
            const active = itemFilter === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => setItemFilter(option.key)}
                style={({ pressed }) => [
                  styles.pill,
                  active ? { borderColor: c.primary, backgroundColor: `${c.primary}18` } : null,
                  pressed ? { opacity: 0.88 } : null,
                ]}
              >
                <Text style={[styles.pillText, active ? { color: c.primary } : null]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.sectionHint}>
          {t(
            'home.federatedRecentActivityHint',
            { defaultValue: 'Tap any item to open the cached thread view inside OpenSpace.' },
          )}
        </Text>
      </View>

      {filteredItems.length ? (
        filteredItems.map((item) => (
          <RemoteObjectCard
            key={item.id}
            item={item}
            c={c}
            onPress={() => onOpenThread(item.id)}
          />
        ))
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {recentItems.length
              ? t(
                  'home.remoteProfileFilterEmpty',
                  { defaultValue: 'No cached fediverse items match this filter yet.' },
                )
              : t(
                  'home.federatedRemoteProfileEmpty',
                  { defaultValue: 'OpenSpace has not cached any visible fediverse activity for this actor yet.' },
                )}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
