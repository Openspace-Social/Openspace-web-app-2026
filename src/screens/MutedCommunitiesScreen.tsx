import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, MutedCommunityResult } from '../api/client';

type Props = {
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  onNotice: (msg: string) => void;
  onOpenCommunity: (communityName: string) => void;
  refreshKey?: number;
};

/**
 * Formats an ISO datetime string into a human-readable relative label,
 * e.g. "Expires in 28 days" or "Expires today".
 */
function formatExpiry(expiresAt: string | null | undefined, t: Props['t']): string {
  if (!expiresAt) {
    return t('community.muteExpiryIndefinite', { defaultValue: 'Indefinite' });
  }
  const diff = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days <= 0) return t('community.muteExpiryToday', { defaultValue: 'Expires today' });
  if (days === 1) return t('community.muteExpiry1Day', { defaultValue: 'Expires tomorrow' });
  return t('community.muteExpiryDays', { days, defaultValue: `Expires in ${days} days` });
}

export default function MutedCommunitiesScreen({
  token,
  c,
  t,
  onNotice,
  onOpenCommunity,
  refreshKey = 0,
}: Props) {
  const s = useMemo(() => makeStyles(c), [c]);
  const { width, height } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MutedCommunityResult[]>([]);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Picker state: which mute record to change
  const [pickerTarget, setPickerTarget] = useState<MutedCommunityResult | null>(null);

  const contentWidth = Math.max(320, Math.min(width - 40, 1280));
  const panelHeight = Math.max(560, Math.min(Math.floor(height * 0.86), 980));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getMutedTimelineCommunities(token);
      setItems(Array.isArray(result) ? result : []);
    } catch (e: any) {
      onNotice(e?.message || t('community.mutedListLoadError', { defaultValue: 'Unable to load muted communities.' }));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [onNotice, t, token]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function handleUnmute(mute: MutedCommunityResult) {
    const name = mute.community.name;
    if (!name || actionLoading != null) return;
    setActionLoading(mute.id);
    try {
      await api.unmuteCommunityTimeline(token, name);
      setItems((prev) => prev.filter((m) => m.id !== mute.id));
      onNotice(t('community.feedUnmutedNotice', { defaultValue: 'Community unmuted. Posts will appear in your feed again.' }));
    } catch (e: any) {
      onNotice(e?.message || t('community.mutedListLoadError', { defaultValue: 'Unable to unmute.' }));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleChangeDuration(mute: MutedCommunityResult, durationDays: number | null) {
    const name = mute.community.name;
    if (!name || actionLoading != null) return;
    setPickerTarget(null);
    setActionLoading(mute.id);
    try {
      await api.muteCommunityTimeline(token, name, durationDays);
      // Reload the list so the new expires_at is reflected
      await load();
      const label = durationDays
        ? t('community.feedMuted30DaysNotice', { defaultValue: 'Community muted for 30 days.' })
        : t('community.feedMutedIndefiniteNotice', { defaultValue: 'Community muted indefinitely.' });
      onNotice(label);
    } catch (e: any) {
      onNotice(e?.message || t('community.mutedListLoadError', { defaultValue: 'Unable to update mute.' }));
    } finally {
      setActionLoading(null);
    }
  }

  // ── Change-duration picker modal ───────────────────────────────────────────
  const pickerModal = (
    <Modal
      visible={pickerTarget != null}
      transparent
      animationType="fade"
      onRequestClose={() => setPickerTarget(null)}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' }}
        onPress={() => setPickerTarget(null)}
      >
        <Pressable
          style={{
            width: 280,
            maxWidth: '92%',
            borderRadius: 14,
            backgroundColor: c.surface,
            borderWidth: 1,
            borderColor: c.border,
            overflow: 'hidden',
          }}
          onPress={() => {}}
        >
          <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: c.textPrimary, marginBottom: 2 }}>
              {t('community.changeMuteDurationTitle', { defaultValue: 'Change mute duration' })}
            </Text>
            {pickerTarget ? (
              <Text style={{ fontSize: 13, color: c.textMuted }}>
                {pickerTarget.community.title || pickerTarget.community.name}
              </Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={{ paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            activeOpacity={0.75}
            onPress={() => pickerTarget && handleChangeDuration(pickerTarget, 30)}
          >
            <MaterialCommunityIcons name="clock-outline" size={20} color={c.textSecondary} />
            <View>
              <Text style={{ fontSize: 14, fontWeight: '600', color: c.textPrimary }}>
                {t('community.mute30DaysAction', { defaultValue: 'Mute for 30 days' })}
              </Text>
              <Text style={{ fontSize: 12, color: c.textMuted }}>
                {t('community.mute30DaysHint', { defaultValue: 'Automatically unmutes after 30 days' })}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={{ paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            activeOpacity={0.75}
            onPress={() => pickerTarget && handleChangeDuration(pickerTarget, null)}
          >
            <MaterialCommunityIcons name="infinity" size={20} color={c.textSecondary} />
            <View>
              <Text style={{ fontSize: 14, fontWeight: '600', color: c.textPrimary }}>
                {t('community.muteIndefiniteAction', { defaultValue: 'Mute indefinitely' })}
              </Text>
              <Text style={{ fontSize: 12, color: c.textMuted }}>
                {t('community.muteIndefiniteHint', { defaultValue: 'Until you manually unmute' })}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={{ paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.border, alignItems: 'center' }}
            activeOpacity={0.75}
            onPress={() => setPickerTarget(null)}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: c.textMuted }}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );

  return (
    <View style={[s.container, { backgroundColor: c.surface, borderColor: c.border, height: panelHeight }]}>
      {pickerModal}

      <View style={[s.header, { borderBottomColor: c.border }]}>
        <Text style={[s.headerTitle, { color: c.textPrimary }]}>
          {t('community.mutedCommunitiesTitle', { defaultValue: 'Muted Communities' })}
        </Text>
        <Text style={[s.headerSubtitle, { color: c.textMuted }]}>
          {t('community.mutedCommunitiesSubtitle', {
            defaultValue: "Posts from these communities won't appear in your home feed.",
          })}
        </Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <View style={[s.contentColumn, { maxWidth: contentWidth }]}>
          {loading ? (
            <ActivityIndicator color={c.primary} size="large" style={{ marginTop: 20 }} />
          ) : items.length === 0 ? (
            <View style={s.emptyWrap}>
              <MaterialCommunityIcons name="bell-off-outline" size={40} color={c.textMuted} style={{ marginBottom: 12 }} />
              <Text style={[s.emptyText, { color: c.textMuted }]}>
                {t('community.mutedCommunitiesEmpty', { defaultValue: "You haven't muted any communities yet." })}
              </Text>
              <Text style={[s.emptyHint, { color: c.textMuted }]}>
                {t('community.mutedCommunitiesEmptyHint', {
                  defaultValue: 'Visit a community and tap "Mute Feed" to hide its posts from your home feed.',
                })}
              </Text>
            </View>
          ) : (
            <View style={s.listWrap}>
              {items.map((mute) => {
                const comm = mute.community;
                const name = (comm.name || '').trim();
                const title = comm.title || name || t('community.communityFallback', { defaultValue: 'Community' });
                const accent = comm.color || c.primary;
                const initial = (title[0] || 'C').toUpperCase();
                const expiryLabel = formatExpiry(mute.expires_at, t);
                const isIndefinite = !mute.expires_at;
                const isThisLoading = actionLoading === mute.id;

                return (
                  <View key={`muted-${mute.id}`} style={[s.rowCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                    {/* Community identity */}
                    <TouchableOpacity
                      style={s.identityButton}
                      activeOpacity={0.85}
                      onPress={() => name && onOpenCommunity(name)}
                    >
                      <View style={[s.avatarWrap, { backgroundColor: accent }]}>
                        {comm.avatar ? (
                          <Image source={{ uri: comm.avatar }} style={s.avatarImage} resizeMode="cover" />
                        ) : (
                          <Text style={s.avatarInitial}>{initial}</Text>
                        )}
                      </View>

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[s.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>{title}</Text>
                        <Text style={[s.rowHandle, { color: c.textMuted }]} numberOfLines={1}>{name ? `c/${name}` : ''}</Text>
                        {/* Expiry badge */}
                        <View style={[s.expiryBadge, { backgroundColor: isIndefinite ? c.primary + '18' : c.border + '80' }]}>
                          <MaterialCommunityIcons
                            name={isIndefinite ? 'infinity' : 'clock-outline'}
                            size={11}
                            color={isIndefinite ? c.primary : c.textMuted}
                          />
                          <Text style={[s.expiryText, { color: isIndefinite ? c.primary : c.textMuted }]}>
                            {expiryLabel}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>

                    {/* Action buttons */}
                    <View style={s.actionsCol}>
                      {isThisLoading ? (
                        <ActivityIndicator size="small" color={c.primary} />
                      ) : (
                        <>
                          {/* Change duration */}
                          <TouchableOpacity
                            style={[s.actionButton, { borderColor: c.border, backgroundColor: c.surface }]}
                            activeOpacity={0.85}
                            onPress={() => setPickerTarget(mute)}
                          >
                            <MaterialCommunityIcons name="pencil-outline" size={14} color={c.textSecondary} />
                            <Text style={[s.actionButtonText, { color: c.textSecondary }]}>
                              {t('community.changeDurationAction', { defaultValue: 'Change' })}
                            </Text>
                          </TouchableOpacity>

                          {/* Unmute */}
                          <TouchableOpacity
                            style={[s.actionButton, { borderColor: c.primary + '50', backgroundColor: c.primary + '12' }]}
                            activeOpacity={0.85}
                            onPress={() => handleUnmute(mute)}
                          >
                            <MaterialCommunityIcons name="bell-outline" size={14} color={c.primary} />
                            <Text style={[s.actionButtonText, { color: c.primary }]}>
                              {t('community.unmuteAction', { defaultValue: 'Unmute' })}
                            </Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: any) =>
  StyleSheet.create({
    container: {
      width: '100%',
      borderWidth: 1,
      borderRadius: 24,
      overflow: 'hidden',
      alignSelf: 'center',
    },
    header: {
      paddingHorizontal: 28,
      paddingVertical: 24,
      borderBottomWidth: 1,
    },
    headerTitle: {
      fontSize: 52,
      fontWeight: '900',
      letterSpacing: -0.8,
      lineHeight: 56,
    },
    headerSubtitle: {
      marginTop: 8,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '600',
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 24,
      alignItems: 'center',
    },
    contentColumn: {
      width: '100%',
      alignSelf: 'center',
    },
    listWrap: {
      gap: 12,
      width: '100%',
    },
    rowCard: {
      borderWidth: 1,
      borderRadius: 16,
      padding: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    identityButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minWidth: 0,
    },
    avatarWrap: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      flexShrink: 0,
    },
    avatarImage: {
      width: '100%',
      height: '100%',
    },
    avatarInitial: {
      color: '#fff',
      fontWeight: '800',
      fontSize: 22,
    },
    rowTitle: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: '800',
    },
    rowHandle: {
      marginTop: 2,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: '600',
    },
    expiryBadge: {
      marginTop: 5,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 999,
    },
    expiryText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
    actionsCol: {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: 6,
      flexShrink: 0,
    },
    actionButton: {
      height: 34,
      borderRadius: 9,
      borderWidth: 1,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    actionButtonText: {
      fontWeight: '700',
      fontSize: 12,
    },
    emptyWrap: {
      marginTop: 32,
      alignItems: 'center',
      paddingHorizontal: 16,
    },
    emptyText: {
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: 8,
    },
    emptyHint: {
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
      fontWeight: '500',
    },
  });
