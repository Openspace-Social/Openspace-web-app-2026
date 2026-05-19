import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { api, type FederatedInboundObject, type FederatedRemoteThread, type FederatedTimelineStatus } from '../api/client';
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
    contextCard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: `${c.primary}10`,
      padding: 16,
      gap: 8,
    },
    card: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card || c.inputBackground,
      padding: 16,
      gap: 10,
    },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    actorAvatar: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: `${c.primary}22`,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    actorAvatarImage: { width: '100%', height: '100%' },
    actorAvatarLetter: { color: c.primary, fontSize: 14, fontWeight: '800' },
    sectionTitle: { color: c.textPrimary, fontSize: 18, fontWeight: '800' },
    sectionHint: { color: c.textMuted, fontSize: 13, lineHeight: 18 },
    handle: { color: c.textPrimary, fontSize: 15, fontWeight: '700', flexShrink: 1 },
    meta: { color: c.textMuted, fontSize: 12, fontWeight: '600' },
    body: { color: c.textPrimary, fontSize: 15, lineHeight: 22 },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    badge: {
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
    badgeText: { color: c.textSecondary, fontSize: 12, fontWeight: '700' },
    replyComposer: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card || c.inputBackground,
      padding: 14,
      gap: 10,
    },
    input: {
      minHeight: 96,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.background,
      color: c.textPrimary,
      paddingHorizontal: 14,
      paddingVertical: 12,
      textAlignVertical: 'top',
      fontSize: 15,
      lineHeight: 21,
    },
    replyButton: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: c.primary,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    replyButtonText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    dividerLabel: { color: c.textMuted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
    link: { color: c.primary, fontSize: 13, fontWeight: '700' },
    actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    actionButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.inputBackground,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    actionButtonActive: {
      borderColor: `${c.primary}44`,
      backgroundColor: `${c.primary}14`,
    },
    actionButtonText: { color: c.textSecondary, fontSize: 13, fontWeight: '800' },
    actionButtonTextActive: { color: c.primary },
    inlineComposer: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.inputBackground,
      padding: 12,
      gap: 10,
    },
  });
}

function ThreadObjectCard({
  item,
  c,
  highlighted = false,
  onPressActor,
}: {
  item: FederatedInboundObject;
  c: any;
  highlighted?: boolean;
  onPressActor?: () => void;
}) {
  const styles = useMemo(() => makeStyles(c), [c]);
  const body = stripHtml(item.content_text || item.content_html || item.summary);
  return (
    <View style={[styles.card, highlighted ? { borderColor: c.primary, backgroundColor: `${c.primary}10` } : null]}>
      <View style={styles.row}>
        <Pressable
          onPress={onPressActor}
          disabled={!onPressActor}
          style={({ pressed }) => [styles.authorRow, pressed ? { opacity: 0.8 } : null]}
        >
          <View style={styles.actorAvatar}>
            {item.actor.profile?.avatar ? (
              <Image source={{ uri: item.actor.profile.avatar }} style={styles.actorAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={styles.actorAvatarLetter}>
                {((item.actor.display_name || item.actor.profile?.name || item.actor.handle || 'F').replace(/^@/, '').trim()[0] || 'F').toUpperCase()}
              </Text>
            )}
          </View>
          <Text style={styles.handle} numberOfLines={1}>
            {item.actor.display_name || item.actor.profile?.name || item.actor.handle || item.actor.preferred_username || item.actor.actor_uri}
          </Text>
        </Pressable>
        <Text style={styles.meta}>{formatRelativeTime(item.published_at)}</Text>
      </View>
      <Text style={styles.body}>{body || 'No preview available.'}</Text>
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <MaterialCommunityIcons name="earth" size={14} color={c.textSecondary} />
          <Text style={styles.badgeText}>{item.visibility || 'remote'}</Text>
        </View>
        <View style={styles.badge}>
          <MaterialCommunityIcons name="source-branch" size={14} color={c.textSecondary} />
          <Text style={styles.badgeText}>Cached remote item</Text>
        </View>
        {item.local_post?.uuid ? (
          <View style={styles.badge}>
            <MaterialCommunityIcons name="link-variant" size={14} color={c.textSecondary} />
            <Text style={styles.badgeText}>References local post</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

type Props = {
  token: string;
  inboundObjectId: number;
  onOpenProfile: (remoteActorId: number) => void;
  onOpenPost?: (postUuid: string) => void;
};

export default function RemoteThreadScreen({ token, inboundObjectId, onOpenProfile, onOpenPost }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const c = theme.colors;
  const styles = useMemo(() => makeStyles(c), [c]);

  const [payload, setPayload] = useState<FederatedRemoteThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyDraft, setReplyDraft] = useState('');
  const [replying, setReplying] = useState(false);
  const [mastodonStatus, setMastodonStatus] = useState<FederatedTimelineStatus | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [mastodonReplyDraft, setMastodonReplyDraft] = useState('');
  const [mastodonReplying, setMastodonReplying] = useState(false);
  const [showMastodonReplyComposer, setShowMastodonReplyComposer] = useState(false);

  const load = useCallback(async () => {
    if (!token || !inboundObjectId) return;
    setLoading(true);
    try {
      const next = await api.getFederatedRemoteThread(token, inboundObjectId);
      setPayload(next);
      setMastodonStatus(next.resolved_status || null);
      setMastodonReplyDraft('');
      setShowMastodonReplyComposer(false);
    } catch (e: any) {
      showToast(
        e?.message || t('home.federatedRemoteThreadLoadError', { defaultValue: 'Could not load fediverse thread.' }),
        { type: 'error' },
      );
      setPayload(null);
      setMastodonStatus(null);
    } finally {
      setLoading(false);
    }
  }, [token, inboundObjectId, showToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReply = useCallback(async () => {
    if (!token || !inboundObjectId) return;
    const trimmed = replyDraft.trim();
    if (!trimmed || replying) return;
    setReplying(true);
    try {
      await api.replyToFederatedInboundObject(token, inboundObjectId, trimmed);
      setReplyDraft('');
      showToast(
        t('home.federatedReplyQueued', { defaultValue: 'Reply queued for federation delivery.' }),
        { type: 'success' },
      );
    } catch (e: any) {
      showToast(
        e?.message || t('home.federatedReplyFailed', { defaultValue: 'Could not queue your fediverse reply.' }),
        { type: 'error' },
      );
    } finally {
      setReplying(false);
    }
  }, [token, inboundObjectId, replyDraft, replying, showToast, t]);

  const runStatusToggle = useCallback(async (
    action: 'favourite' | 'reblog' | 'bookmark',
    shouldEnable: boolean,
  ) => {
    const linkedAccountId = payload?.acting_linked_account?.id;
    const statusId = mastodonStatus?.id;
    if (!token || !linkedAccountId || !statusId) return;

    const loadingKey = `${statusId}:${action}`;
    setActionLoading((prev) => ({ ...prev, [loadingKey]: true }));
    try {
      const updated = action === 'favourite'
        ? (shouldEnable
            ? await api.favouriteFederatedStatus(token, linkedAccountId, statusId)
            : await api.unfavouriteFederatedStatus(token, linkedAccountId, statusId))
        : action === 'reblog'
          ? (shouldEnable
              ? await api.reblogFederatedStatus(token, linkedAccountId, statusId)
              : await api.unreblogFederatedStatus(token, linkedAccountId, statusId))
          : (shouldEnable
              ? await api.bookmarkFederatedStatus(token, linkedAccountId, statusId)
              : await api.unbookmarkFederatedStatus(token, linkedAccountId, statusId));
      setMastodonStatus(updated);
    } catch (e: any) {
      showToast(
        e?.message || t('home.mastodonStatusActionFailed', { defaultValue: 'Could not update this Mastodon action.' }),
        { type: 'error' },
      );
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[loadingKey];
        return next;
      });
    }
  }, [mastodonStatus?.id, payload?.acting_linked_account?.id, showToast, t, token]);

  const handleMastodonReply = useCallback(async () => {
    const linkedAccountId = payload?.acting_linked_account?.id;
    const statusId = mastodonStatus?.id;
    const trimmed = mastodonReplyDraft.trim();
    if (!token || !linkedAccountId || !statusId || !trimmed || mastodonReplying) return;
    setMastodonReplying(true);
    try {
      const created = await api.replyToFederatedStatus(token, linkedAccountId, statusId, trimmed);
      setMastodonReplyDraft('');
      setShowMastodonReplyComposer(false);
      setMastodonStatus((prev) => {
        if (!prev) return created;
        const currentReplies = typeof prev.replies_count === 'number' ? prev.replies_count : 0;
        return { ...prev, replies_count: currentReplies + 1 };
      });
      showToast(
        t('home.mastodonReplySuccess', { defaultValue: 'Reply posted through Mastodon.' }),
        { type: 'success' },
      );
    } catch (e: any) {
      showToast(
        e?.message || t('home.mastodonReplyFailed', { defaultValue: 'Could not post reply.' }),
        { type: 'error' },
      );
    } finally {
      setMastodonReplying(false);
    }
  }, [mastodonReplyDraft, mastodonReplying, mastodonStatus?.id, payload?.acting_linked_account?.id, showToast, t, token]);

  const subject = payload?.subject;
  const resolvedStatus = mastodonStatus;
  const canUseMastodonActions = !!resolvedStatus?.id && !!payload?.acting_linked_account?.id;
  const isFavourited = !!resolvedStatus?.favourited;
  const isReblogged = !!resolvedStatus?.reblogged;
  const isBookmarked = !!resolvedStatus?.bookmarked;
  const favouriteCount = typeof resolvedStatus?.favourites_count === 'number' ? resolvedStatus.favourites_count : 0;
  const reblogCount = typeof resolvedStatus?.reblogs_count === 'number' ? resolvedStatus.reblogs_count : 0;
  const replyCount = typeof resolvedStatus?.replies_count === 'number' ? resolvedStatus.replies_count : 0;

  if (loading && !payload) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      {payload?.local_context_post?.uuid ? (
        <Pressable
          onPress={() => payload.local_context_post?.uuid && onOpenPost?.(payload.local_context_post.uuid)}
          style={({ pressed }) => [styles.contextCard, pressed ? { opacity: 0.9 } : null]}
        >
          <Text style={styles.dividerLabel}>
            {t('home.federatedContextLabel', { defaultValue: 'Touches an OpenSpace post' })}
          </Text>
          <Text style={styles.body} numberOfLines={3}>
            {payload.local_context_post?.text || t('home.federatedContextNoText', { defaultValue: 'Open the referenced local post.' })}
          </Text>
        </Pressable>
      ) : null}

      {payload?.ancestors?.length ? (
        <>
          <Text style={styles.dividerLabel}>
            {t('home.federatedEarlierInThread', { defaultValue: 'Earlier in the thread' })}
          </Text>
          {payload.ancestors.map((item) => (
            <ThreadObjectCard
              key={item.id}
              item={item}
              c={c}
              onPressActor={() => onOpenProfile(item.actor.id)}
            />
          ))}
        </>
      ) : null}

      {subject ? (
        <>
          <Text style={styles.dividerLabel}>
            {t('home.federatedSubjectLabel', { defaultValue: 'Current item' })}
          </Text>
          <ThreadObjectCard
            item={subject}
            c={c}
            highlighted
            onPressActor={() => onOpenProfile(subject.actor.id)}
          />
          {canUseMastodonActions ? (
            <>
              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => void runStatusToggle('favourite', !isFavourited)}
                  style={({ pressed }) => [
                    styles.actionButton,
                    isFavourited ? styles.actionButtonActive : null,
                    pressed ? { opacity: 0.88 } : null,
                    actionLoading[`${resolvedStatus?.id}:favourite`] ? { opacity: 0.65 } : null,
                  ]}
                >
                  <MaterialCommunityIcons
                    name={isFavourited ? 'star' : 'star-outline'}
                    size={16}
                    color={isFavourited ? c.primary : c.textSecondary}
                  />
                  <Text style={[styles.actionButtonText, isFavourited ? styles.actionButtonTextActive : null]}>
                    {favouriteCount > 0 ? `${favouriteCount}` : t('home.mastodonActionFavourite', { defaultValue: 'Fav' })}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowMastodonReplyComposer((prev) => !prev)}
                  style={({ pressed }) => [styles.actionButton, pressed ? { opacity: 0.88 } : null]}
                >
                  <MaterialCommunityIcons name="reply-outline" size={16} color={c.textSecondary} />
                  <Text style={styles.actionButtonText}>
                    {replyCount > 0 ? `${replyCount}` : t('home.mastodonActionComments', { defaultValue: 'Reply' })}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void runStatusToggle('reblog', !isReblogged)}
                  style={({ pressed }) => [
                    styles.actionButton,
                    isReblogged ? styles.actionButtonActive : null,
                    pressed ? { opacity: 0.88 } : null,
                    actionLoading[`${resolvedStatus?.id}:reblog`] ? { opacity: 0.65 } : null,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="repeat"
                    size={16}
                    color={isReblogged ? c.primary : c.textSecondary}
                  />
                  <Text style={[styles.actionButtonText, isReblogged ? styles.actionButtonTextActive : null]}>
                    {reblogCount > 0 ? `${reblogCount}` : t('home.mastodonActionBoost', { defaultValue: 'Boost' })}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void runStatusToggle('bookmark', !isBookmarked)}
                  style={({ pressed }) => [
                    styles.actionButton,
                    isBookmarked ? styles.actionButtonActive : null,
                    pressed ? { opacity: 0.88 } : null,
                    actionLoading[`${resolvedStatus?.id}:bookmark`] ? { opacity: 0.65 } : null,
                  ]}
                >
                  <MaterialCommunityIcons
                    name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
                    size={16}
                    color={isBookmarked ? c.primary : c.textSecondary}
                  />
                  <Text style={[styles.actionButtonText, isBookmarked ? styles.actionButtonTextActive : null]}>
                    {t('home.mastodonActionSave', { defaultValue: 'Save' })}
                  </Text>
                </Pressable>
              </View>
              {showMastodonReplyComposer ? (
                <View style={styles.inlineComposer}>
                  <Text style={styles.sectionHint}>
                    {t('home.replyFromMastodonHint', {
                      defaultValue: 'Reply through your linked Mastodon account so the conversation continues there too.',
                    })}
                  </Text>
                  <TextInput
                    value={mastodonReplyDraft}
                    onChangeText={setMastodonReplyDraft}
                    placeholder={t('home.writeReplyPlaceholder', { defaultValue: 'Write a reply…' })}
                    placeholderTextColor={c.textMuted}
                    multiline
                    style={styles.input}
                  />
                  <TouchableOpacity
                    disabled={mastodonReplying || !mastodonReplyDraft.trim()}
                    onPress={() => void handleMastodonReply()}
                    activeOpacity={0.88}
                    style={[styles.replyButton, (!mastodonReplyDraft.trim() || mastodonReplying) ? { opacity: 0.6 } : null]}
                  >
                    {mastodonReplying ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="send" size={16} color="#fff" />
                        <Text style={styles.replyButtonText}>
                          {t('home.sendMastodonReply', { defaultValue: 'Reply through Mastodon' })}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          ) : payload?.acting_linked_account ? (
            <Text style={styles.sectionHint}>
              {t('home.remoteThreadActionsPending', {
                defaultValue: 'OpenSpace found the fediverse thread, but Mastodon has not resolved this post for actions yet.',
              })}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Pressable onPress={() => subject.url && void openExternalLink(subject.url)}>
              <Text style={styles.link}>{t('home.openOnRemoteServer', { defaultValue: 'Open on remote server' })}</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {subject?.can_reply ? (
        <View style={styles.replyComposer}>
          <Text style={styles.sectionTitle}>
            {t('home.replyFromOpenSpace', { defaultValue: 'Reply from OpenSpace' })}
          </Text>
          <Text style={styles.sectionHint}>
            {t(
              'home.replyFromOpenSpaceHint',
              { defaultValue: 'This sends a federated ActivityPub reply back to the remote thread.' },
            )}
          </Text>
          <TextInput
            value={replyDraft}
            onChangeText={setReplyDraft}
            placeholder={t('home.writeReplyPlaceholder', { defaultValue: 'Write a reply…' })}
            placeholderTextColor={c.textMuted}
            multiline
            style={styles.input}
          />
          <TouchableOpacity
            disabled={replying || !replyDraft.trim()}
            onPress={() => void handleReply()}
            activeOpacity={0.88}
            style={[styles.replyButton, (!replyDraft.trim() || replying) ? { opacity: 0.6 } : null]}
          >
            {replying ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="send" size={16} color="#fff" />
                <Text style={styles.replyButtonText}>
                  {t('home.sendFederatedReply', { defaultValue: 'Send reply' })}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {payload?.descendants?.length ? (
        <>
          <Text style={styles.dividerLabel}>
            {t('home.federatedLaterInThread', { defaultValue: 'Later in the thread' })}
          </Text>
          {payload.descendants.map((item) => (
            <ThreadObjectCard
              key={item.id}
              item={item}
              c={c}
              onPressActor={() => onOpenProfile(item.actor.id)}
            />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
