import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { api, type FederatedRemoteCommunity, type FederatedRemoteCommunityActivityItem } from '../api/client';
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
    title: { color: c.textPrimary, fontSize: 24, fontWeight: '800' },
    subtitle: { color: c.textSecondary, fontSize: 14, lineHeight: 20 },
    body: { color: c.textPrimary, fontSize: 15, lineHeight: 22 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
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
    card: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card || c.inputBackground,
      padding: 16,
      gap: 10,
    },
    cardTitle: { color: c.textPrimary, fontSize: 18, fontWeight: '800' },
    link: { color: c.primary, fontSize: 13, fontWeight: '700' },
    actionButton: {
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 118,
    },
    actionButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    itemMeta: { color: c.textMuted, fontSize: 12, fontWeight: '700' },
  });
}

type Props = {
  token: string;
  remoteCommunityId: number;
};

export default function RemoteCommunityScreen({ token, remoteCommunityId }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const c = theme.colors;
  const styles = useMemo(() => makeStyles(c), [c]);

  const [community, setCommunity] = useState<FederatedRemoteCommunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<FederatedRemoteCommunityActivityItem[]>([]);
  const [activityHint, setActivityHint] = useState('');

  const load = useCallback(async () => {
    if (!token || !remoteCommunityId) return;
    setLoading(true);
    try {
      const response = await api.getFederatedRemoteCommunityDetail(token, remoteCommunityId);
      setCommunity(response.community || null);
      const activityResponse = await api.getFederatedRemoteCommunityActivity(token, remoteCommunityId);
      setItems(activityResponse.items || []);
      setActivityHint(activityResponse.detail || '');
    } catch (e: any) {
      showToast(
        e?.message || t('home.federatedRemoteCommunityLoadError', { defaultValue: 'Could not load fediverse community.' }),
        { type: 'error' },
      );
      setCommunity(null);
      setItems([]);
      setActivityHint('');
    } finally {
      setLoading(false);
    }
  }, [token, remoteCommunityId, showToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSubscription = useCallback(async () => {
    if (!token || !community || saving) return;
    setSaving(true);
    try {
      const response = community.is_subscribed
        ? await api.unsubscribeFromFederatedRemoteCommunity(token, community.id)
        : await api.subscribeToFederatedRemoteCommunity(token, community.id);
      setCommunity(response.community || community);
      showToast(
        community.is_subscribed
          ? t('home.federatedCommunityUnsubscribed', { defaultValue: 'Removed from your fediverse communities.' })
          : t('home.federatedCommunitySubscribed', { defaultValue: 'Added to your fediverse communities.' }),
        { type: 'success' },
      );
    } catch (e: any) {
      showToast(
        e?.message || t('home.federatedCommunitySubscriptionError', { defaultValue: 'Could not update fediverse community subscription.' }),
        { type: 'error' },
      );
    } finally {
      setSaving(false);
    }
  }, [token, community, saving, showToast, t]);

  if (loading && !community) {
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
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.title}>{community?.title || community?.preferred_username || 'Fediverse community'}</Text>
            <Text style={styles.subtitle}>{community?.handle || community?.actor_uri}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 10 }}>
            <Pressable
              style={[styles.actionButton, { backgroundColor: community?.is_subscribed ? c.textMuted : c.primary, opacity: saving ? 0.7 : 1 }]}
              disabled={saving}
              onPress={() => void toggleSubscription()}
            >
              <Text style={styles.actionButtonText}>
                {community?.is_subscribed
                  ? t('home.federatedCommunitySubscribedCta', { defaultValue: 'Subscribed' })
                  : t('home.federatedCommunitySubscribeCta', { defaultValue: 'Subscribe' })}
              </Text>
            </Pressable>
            <Pressable onPress={() => community?.profile_url && void openExternalLink(community.profile_url)}>
              <Text style={styles.link}>{t('home.openExternal', { defaultValue: 'Open' })}</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.pillRow}>
          <View style={styles.pill}>
            <MaterialCommunityIcons name="earth" size={14} color={c.textSecondary} />
            <Text style={styles.pillText}>Remote community</Text>
          </View>
          <View style={styles.pill}>
            <MaterialCommunityIcons name="account-group-outline" size={14} color={c.textSecondary} />
            <Text style={styles.pillText}>{community?.domain || 'fediverse'}</Text>
          </View>
          <View style={styles.pill}>
            <MaterialCommunityIcons name="server-network" size={14} color={c.textSecondary} />
            <Text style={styles.pillText}>Cached in OpenSpace</Text>
          </View>
          {community?.is_subscribed ? (
            <View style={styles.pill}>
              <MaterialCommunityIcons name="check-circle-outline" size={14} color={c.textSecondary} />
              <Text style={styles.pillText}>Subscribed</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.body}>
          {stripHtml(community?.summary) || t('home.federatedRemoteCommunityNoSummary', { defaultValue: 'No cached summary is available yet.' })}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('home.federatedCommunityRecentActivity', { defaultValue: 'Recent activity' })}</Text>
        {items.length ? (
          items.map((item, index) => {
            const body = stripHtml(item.content_html || item.summary) || t('home.federatedCommunityActivityNoPreview', { defaultValue: 'No cached preview is available yet.' });
            return (
              <Pressable
                key={item.id || item.object_uri || `activity-${index}`}
                onPress={() => item.url && void openExternalLink(item.url)}
                style={({ pressed }) => [styles.card, pressed ? { opacity: 0.92 } : null]}
              >
                <View style={styles.row}>
                  <Text style={styles.itemMeta}>
                    {(item.activity_type || 'Activity').toUpperCase()}
                  </Text>
                  <Text style={styles.itemMeta}>{formatRelativeTime(item.published_at)}</Text>
                </View>
                <Text style={styles.body}>{body}</Text>
                <Text style={styles.link}>
                  {item.url ? t('home.openExternal', { defaultValue: 'Open' }) : (item.attributed_to || community?.handle || 'Fediverse')}
                </Text>
              </Pressable>
            );
          })
        ) : (
          <Text style={styles.body}>
            {activityHint || t(
              'home.federatedCommunityRecentActivityBody',
              { defaultValue: 'We have the community saved, but no recent remote activity has been cached yet.' },
            )}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('home.federatedCommunityNextStep', { defaultValue: 'What this means today' })}</Text>
        <Text style={styles.body}>
          {t(
            'home.federatedCommunityNextStepBody',
            {
              defaultValue:
                'OpenSpace can now discover, cache, and save remote fediverse communities. Posting and deeper remote participation can build on top of this subscription layer next.',
            },
          )}
        </Text>
      </View>
    </ScrollView>
  );
}
