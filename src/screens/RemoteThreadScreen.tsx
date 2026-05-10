import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { api, type FederatedInboundObject, type FederatedRemoteThread } from '../api/client';
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
        <Pressable onPress={onPressActor} disabled={!onPressActor} style={({ pressed }) => [pressed ? { opacity: 0.8 } : null]}>
          <Text style={styles.handle} numberOfLines={1}>
            {item.actor.handle || item.actor.preferred_username || item.actor.actor_uri}
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

  const load = useCallback(async () => {
    if (!token || !inboundObjectId) return;
    setLoading(true);
    try {
      const next = await api.getFederatedRemoteThread(token, inboundObjectId);
      setPayload(next);
    } catch (e: any) {
      showToast(
        e?.message || t('home.federatedRemoteThreadLoadError', { defaultValue: 'Could not load fediverse thread.' }),
        { type: 'error' },
      );
      setPayload(null);
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

  const subject = payload?.subject;

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
