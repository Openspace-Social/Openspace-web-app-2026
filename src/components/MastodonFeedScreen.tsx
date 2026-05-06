import React, { useMemo } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FederatedLinkedAccount, FederatedTimelineStatus } from '../api/client';
import { openExternalLink } from '../utils/openExternalLink';
import { postCardStyles } from '../styles/postCardStyles';

type Props = {
  c: any;
  t: (key: string, options?: any) => string;
  loading: boolean;
  error: string;
  items: FederatedTimelineStatus[];
  linkedAccount: FederatedLinkedAccount | null;
  loadingMore?: boolean;
  hasMore?: boolean;
  onOpenLinkedAccounts?: () => void;
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

function countLabel(value?: number, singular?: string, plural?: string) {
  const count = typeof value === 'number' ? value : 0;
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function MastodonFeedScreen({
  c,
  t,
  loading,
  error,
  items,
  linkedAccount,
  loadingMore = false,
  hasMore = false,
  onOpenLinkedAccounts,
}: Props) {
  const styles = useMemo(() => makeStyles(c), [c]);

  return (
    <View style={styles.container}>
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.heroBadge}>
            <MaterialCommunityIcons name="mastodon" size={18} color="#6364FF" />
            <Text style={styles.heroBadgeText}>Mastodon</Text>
          </View>
        </View>
        <Text style={styles.heroTitle}>
          {t('home.feedTabMastodon', { defaultValue: 'Mastodon' })}
        </Text>
        <Text style={styles.heroBody}>
          {linkedAccount
            ? t('home.mastodonFeedConnectedBody', {
                defaultValue: 'Showing your linked Mastodon home timeline for @{{acct}}.',
                acct: linkedAccount.acct || linkedAccount.username || linkedAccount.instance_domain,
              })
            : t('home.mastodonFeedDisconnectedBody', {
                defaultValue: 'Connect a Mastodon account in Linked Accounts to bring your home timeline into OpenSpace.',
              })}
        </Text>
        {linkedAccount ? (
          <View style={styles.heroMetaRow}>
            <Text style={styles.heroMetaText}>@{linkedAccount.acct || linkedAccount.username}</Text>
            <Text style={styles.heroMetaDot}>•</Text>
            <Text style={styles.heroMetaText}>{linkedAccount.instance_domain}</Text>
          </View>
        ) : onOpenLinkedAccounts ? (
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.heroAction}
            onPress={onOpenLinkedAccounts}
          >
            <Text style={styles.heroActionText}>
              {t('home.linkedAccountsTitle', { defaultValue: 'Linked Accounts' })}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={c.primary} size="small" style={styles.loading} />
      ) : error ? (
        <Text style={[styles.errorText, { color: c.errorText }]}>{error}</Text>
      ) : items.length === 0 ? (
        <Text style={[styles.emptyText, { color: c.textMuted }]}>
          {linkedAccount
            ? t('home.mastodonFeedEmpty', { defaultValue: 'No Mastodon posts in this timeline yet.' })
            : t('home.mastodonFeedNeedsAccount', { defaultValue: 'Link a Mastodon account to view this feed.' })}
        </Text>
      ) : (
        <View style={styles.list}>
          {items.map((item) => {
            const status = item.reblog || item;
            const account = status.account || item.account || null;
            const media = status.media_attachments || [];
            const firstImage = media.find((entry) => entry.type === 'image');
            const text = stripHtml(status.content);
            const spoiler = stripHtml(status.spoiler_text);
            const isReblog = !!item.reblog;
            return (
              <View key={item.id} style={[postCardStyles.feedPostCard, styles.card]}>
                {isReblog ? (
                  <View style={styles.reblogBadgeRow}>
                    <MaterialCommunityIcons name="repeat" size={14} color={c.textMuted} />
                    <Text style={styles.reblogBadgeText}>
                      {t('home.mastodonReblogLabel', { defaultValue: 'Boosted from Mastodon' })}
                    </Text>
                  </View>
                ) : null}

                <View style={[postCardStyles.feedPostHeader, styles.cardHeader]}>
                  <View style={postCardStyles.feedHeaderLeft}>
                    {account?.avatar_url ? (
                      <Image source={{ uri: account.avatar_url }} style={postCardStyles.feedAvatar} />
                    ) : (
                      <View style={[postCardStyles.feedAvatar, styles.avatarFallback]}>
                        <Text style={postCardStyles.feedAvatarLetter}>
                          {(account?.display_name || account?.username || 'M').slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={postCardStyles.feedHeaderMeta}>
                      <Text numberOfLines={1} style={[postCardStyles.feedAuthor, styles.displayName]}>
                        {account?.display_name || account?.username || 'Mastodon'}
                      </Text>
                      <Text numberOfLines={1} style={[postCardStyles.feedDate, styles.handle]}>
                        @{account?.acct || account?.username || linkedAccount?.instance_domain}
                      </Text>
                    </View>
                  </View>
                  <View style={postCardStyles.feedHeaderActions}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => void openExternalLink(account?.profile_url)}
                      style={[postCardStyles.reportButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    >
                      <MaterialCommunityIcons name="account-circle-outline" size={18} color={c.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => void openExternalLink(status.url || account?.profile_url)}
                      style={[postCardStyles.reportButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    >
                      <MaterialCommunityIcons name="open-in-new" size={18} color={c.primary} />
                    </TouchableOpacity>
                  </View>
                </View>

                {(spoiler || text) ? (
                  <View style={postCardStyles.feedTextWrap}>
                    {spoiler ? <Text style={styles.spoiler}>{spoiler}</Text> : null}
                    {text ? <Text style={[postCardStyles.feedText, styles.content]}>{text}</Text> : null}
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

                <View style={[postCardStyles.feedStatsRow, styles.statsRow, { borderTopColor: c.border, borderBottomColor: c.border }]}>
                  <Text style={postCardStyles.feedStatText}>
                    {countLabel(status.favourites_count, 'favorite', 'favorites')}
                  </Text>
                  <Text style={postCardStyles.feedStatText}>
                    {countLabel(status.replies_count, 'reply', 'replies')}
                  </Text>
                  <Text style={postCardStyles.feedStatText}>
                    {countLabel(status.reblogs_count, 'boost', 'boosts')}
                  </Text>
                </View>

                <View style={postCardStyles.feedActionsRow}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={[postCardStyles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    onPress={() => void openExternalLink(status.url)}
                  >
                    <MaterialCommunityIcons name="comment-text-outline" size={18} color={c.textSecondary} />
                    <Text style={[postCardStyles.feedActionText, { color: c.textSecondary }]}>
                      {t('home.mastodonActionViewThread', { defaultValue: 'View thread' })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={[postCardStyles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    onPress={() => void openExternalLink(account?.profile_url)}
                  >
                    <MaterialCommunityIcons name="account-outline" size={18} color={c.textSecondary} />
                    <Text style={[postCardStyles.feedActionText, { color: c.textSecondary }]}>
                      {t('home.mastodonActionProfile', { defaultValue: 'Profile' })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={[postCardStyles.feedActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    onPress={() => void openExternalLink(status.url)}
                  >
                    <MaterialCommunityIcons name="export-variant" size={18} color={c.textSecondary} />
                    <Text style={[postCardStyles.feedActionText, { color: c.textSecondary }]}>
                      {t('home.mastodonActionOpen', { defaultValue: 'Open' })}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.footerRow}>
                  <Text style={styles.footerText}>
                    {status.created_at ? new Date(status.created_at).toLocaleString() : ''}
                  </Text>
                  {status.application?.name ? (
                    <>
                      <Text style={styles.footerDot}>•</Text>
                      <Text style={styles.footerText}>{status.application.name}</Text>
                    </>
                  ) : null}
                </View>
              </View>
            );
          })}

          {loadingMore ? (
            <ActivityIndicator color={c.primary} size="small" style={styles.loadingMore} />
          ) : !hasMore ? (
            <Text style={[styles.endText, { color: c.textMuted }]}>
              {t('home.feedEndOfResults', { defaultValue: "You're all caught up!" })}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    container: {
      gap: 14,
    },
    heroCard: {
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      borderRadius: 18,
      padding: 18,
      gap: 10,
    },
    heroHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    heroBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: `${c.primary}12`,
      borderColor: `${c.primary}33`,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    heroBadgeText: {
      color: '#6364FF',
      fontSize: 12,
      fontWeight: '700',
    },
    heroTitle: {
      color: c.textPrimary,
      fontSize: 24,
      fontWeight: '800',
    },
    heroBody: {
      color: c.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    heroMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    heroMetaText: {
      color: c.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    heroMetaDot: {
      color: c.textMuted,
      fontSize: 13,
    },
    heroAction: {
      alignSelf: 'flex-start',
      backgroundColor: c.primary,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    heroActionText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '700',
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
      gap: 12,
    },
    card: {
      backgroundColor: c.surface,
      gap: 12,
    },
    reblogBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: -2,
    },
    reblogBadgeText: {
      color: c.textMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    cardHeader: {
    },
    avatarFallback: {
      backgroundColor: c.primary,
    },
    displayName: {
    },
    handle: {
      marginTop: 2,
    },
    spoiler: {
      color: c.textSecondary,
      fontSize: 13,
      fontWeight: '700',
      marginBottom: 6,
    },
    content: {
      fontSize: 14,
      lineHeight: 20,
    },
    statsRow: {
      marginTop: 0,
    },
    footerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6,
    },
    footerText: {
      color: c.textMuted,
      fontSize: 12,
    },
    footerDot: {
      color: c.textMuted,
      fontSize: 12,
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
