import React from 'react';
import { Linking, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { FederationSummary } from '../api/client';

type Props = {
  c: any;
  t: (key: string, options?: any) => string;
  summary?: FederationSummary | null;
  isOwnProfile?: boolean;
  compact?: boolean;
};

type MetricProps = {
  c: any;
  label: string;
  value: number;
};

function Metric({ c, label, value }: MetricProps) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 110,
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 14,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        gap: 4,
      }}
    >
      <Text style={{ color: c.textPrimary, fontSize: 24, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: c.textSecondary, fontSize: 13, lineHeight: 18 }}>{label}</Text>
    </View>
  );
}

function activityIconName(type?: string) {
  switch (type) {
    case 'follow':
      return 'account-plus-outline';
    case 'unfollow':
      return 'account-minus-outline';
    case 'reply':
      return 'comment-outline';
    case 'mention':
      return 'at';
    case 'like':
      return 'heart-outline';
    case 'announce':
      return 'repeat-variant';
    default:
      return 'access-point-network';
  }
}

export default function FederationSummaryCard({
  c,
  t,
  summary,
  isOwnProfile = false,
  compact = false,
}: Props) {
  if (!summary) return null;

  const { width } = useWindowDimensions();
  const isNarrow = width < 700;

  const primaryMessage = summary.is_discoverable
    ? t('federation.discoverableStatus', {
        defaultValue: 'Your profile is discoverable on the fediverse.',
      })
    : t('federation.discoverableStatusDisabled', {
        defaultValue: 'Federation is not fully active for this profile yet.',
      });

  const secondaryMessage = summary.can_reach_remote_followers
    ? t('federation.reachStatus', {
        count: summary.remote_followers_count,
        defaultValue: `Your posts can reach ${summary.remote_followers_count} remote followers on Mastodon and compatible apps.`,
      })
    : t('federation.reachStatusNoFollowers', {
        defaultValue: 'Your posts are ready to reach Mastodon followers as your remote audience grows.',
      });

  const actorUri = summary.actor_uri?.trim();
  const recentActivity = Array.isArray(summary.recent_activity) ? summary.recent_activity.slice(0, 4) : [];

  return (
    <View
      style={{
        marginTop: compact ? 0 : 18,
        borderRadius: 28,
        padding: compact ? 18 : 22,
        backgroundColor: c.inputBackground,
        borderWidth: 1,
        borderColor: c.border,
        gap: 16,
      }}
    >
      <View
        style={{
          flexDirection: isNarrow ? 'column' : 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: `${c.primary}18`,
              }}
            >
              <MaterialCommunityIcons name="access-point-network" size={22} color={c.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.textPrimary, fontSize: 20, fontWeight: '800' }}>
                {t('federation.sectionTitle', { defaultValue: 'Federation' })}
              </Text>
              <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 2 }}>
                {summary.fediverse_handle}
              </Text>
            </View>
          </View>
          <Text style={{ color: c.textPrimary, fontSize: 15, lineHeight: 22, fontWeight: '700' }}>
            {primaryMessage}
          </Text>
          <Text style={{ color: c.textSecondary, fontSize: 14, lineHeight: 21 }}>
            {secondaryMessage}
          </Text>
        </View>
        <View
          style={{
            width: isNarrow ? '100%' : undefined,
            flexDirection: isNarrow ? 'row' : 'column',
            flexWrap: 'wrap',
            alignItems: isNarrow ? 'flex-start' : 'flex-end',
            gap: 8,
          }}
        >
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 6,
              backgroundColor: summary.is_enabled ? `${c.primary}18` : `${c.textSecondary}14`,
            }}
          >
            <Text style={{ color: summary.is_enabled ? c.primary : c.textSecondary, fontSize: 12, fontWeight: '800' }}>
              {summary.is_enabled
                ? t('federation.enabledBadge', { defaultValue: 'Live on the fediverse' })
                : t('federation.disabledBadge', { defaultValue: 'Not yet live' })}
            </Text>
          </View>
          <View
            style={{
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 6,
              backgroundColor: summary.can_receive_inbound ? `${c.successText || '#16a34a'}18` : `${c.textSecondary}14`,
            }}
          >
            <Text
              style={{
                color: summary.can_receive_inbound ? (c.successText || '#16a34a') : c.textSecondary,
                fontSize: 12,
                fontWeight: '800',
              }}
            >
              {summary.can_receive_inbound
                ? t('federation.inboundBadge', { defaultValue: 'Receiving inbound activity' })
                : t('federation.inboundBadgeDisabled', { defaultValue: 'Inbound activity paused' })}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Metric
          c={c}
          value={summary.remote_followers_count}
          label={t('federation.remoteFollowersMetric', { defaultValue: 'Remote followers' })}
        />
        <Metric
          c={c}
          value={summary.outbound_deliveries_sent_count}
          label={t('federation.outboundDeliveriesMetric', { defaultValue: 'Outbound deliveries sent' })}
        />
        <Metric
          c={c}
          value={summary.recent_inbound_interactions_count}
          label={t('federation.recentInboundMetric', {
            count: summary.recent_inbound_window_days,
            defaultValue: `Inbound interactions in the last ${summary.recent_inbound_window_days} days`,
          })}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: c.textSecondary, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          {t('federation.statusHeadline', { defaultValue: 'What this means' })}
        </Text>
        <Text style={{ color: c.textSecondary, fontSize: 14, lineHeight: 21 }}>
          {isOwnProfile
            ? t('federation.ownProfileExplainer', {
                defaultValue: 'People on Mastodon and compatible apps can discover this profile, follow you remotely, and receive your public activity.',
              })
            : t('federation.publicProfileExplainer', {
                defaultValue: 'This OpenSpace profile is part of the fediverse, so public activity can travel beyond OpenSpace to compatible networks.',
              })}
        </Text>
        {actorUri ? (
          <Pressable onPress={() => Linking.openURL(actorUri)}>
            <Text style={{ color: c.primary, fontSize: 13, fontWeight: '700' }}>
              {t('federation.viewActorLink', { defaultValue: 'View ActivityPub actor URL' })}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {recentActivity.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: c.textSecondary, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {t('federation.recentActivityHeadline', { defaultValue: 'Recent fediverse activity' })}
          </Text>
          <View style={{ gap: 10 }}>
            {recentActivity.map((item) => {
              const actorHandle = item.actor?.handle?.trim();
              const detailText = item.detail?.trim();
              const showDetail = !!detailText && detailText !== actorHandle;

              return (
                <View
                  key={item.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 11,
                    borderRadius: 16,
                    backgroundColor: c.surface,
                    borderWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: `${c.primary}12`,
                    }}
                  >
                    <MaterialCommunityIcons name={activityIconName(item.type) as any} size={16} color={c.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: c.textPrimary, fontSize: 13, fontWeight: '700', lineHeight: 18 }}>
                      {item.headline || t('federation.activityFallback', { defaultValue: 'Fediverse activity' })}
                    </Text>
                    {actorHandle ? (
                      <Text style={{ color: c.textSecondary, fontSize: 13, lineHeight: 18 }}>
                        {actorHandle}
                      </Text>
                    ) : null}
                    {showDetail ? (
                      <Text style={{ color: c.textSecondary, fontSize: 12, lineHeight: 17 }} numberOfLines={2}>
                        {detailText}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
