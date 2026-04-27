import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, SearchCommunityResult } from '../api/client';

type Props = {
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  onNotice: (msg: string) => void;
  onOpenCommunity: (communityName: string) => void;
  onOpenManageCommunity: (communityName: string) => void;
  refreshKey?: number;
};

function normalizeCommunityName(value?: string) {
  return (value || '').trim().toLowerCase();
}

function dedupeByName(items: SearchCommunityResult[]) {
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

export default function ManageCommunitiesScreen({
  token,
  c,
  t,
  onNotice,
  onOpenCommunity,
  onOpenManageCommunity,
  refreshKey = 0,
}: Props) {
  const s = useMemo(() => makeStyles(c), [c]);
  const { width, height } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SearchCommunityResult[]>([]);

  const contentWidth = Math.max(320, Math.min(width - 40, 1280));
  const panelHeight = Math.max(560, Math.min(Math.floor(height * 0.86), 980));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [administratedRes, moderatedRes] = await Promise.allSettled([
        api.getAdministratedCommunities(token, 50, 0),
        api.getModeratedCommunities(token, 50, 0),
      ]);
      const administrated = administratedRes.status === 'fulfilled' ? administratedRes.value : [];
      const moderated = moderatedRes.status === 'fulfilled' ? moderatedRes.value : [];
      const merged = dedupeByName([...(administrated || []), ...(moderated || [])]);
      setItems(merged);
      if (administratedRes.status === 'rejected' && moderatedRes.status === 'rejected') {
        onNotice(t('community.manageListLoadError', { defaultValue: 'Unable to load manageable communities right now.' }));
      }
    } catch (e: any) {
      onNotice(e?.message || t('community.manageListLoadError', { defaultValue: 'Unable to load manageable communities right now.' }));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [onNotice, t, token]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <View style={[s.container, { backgroundColor: c.surface, borderColor: c.border }, Platform.OS === 'web' ? { height: panelHeight } : { flex: 1 }]}>
      <View style={[s.header, { borderBottomColor: c.border }]}>
        <Text style={[s.headerTitle, { color: c.textPrimary }]}>
          {t('community.manageCommunitiesTitle', { defaultValue: 'Manage Communities' })}
        </Text>
        <Text style={[s.headerSubtitle, { color: c.textMuted }]}>
          {t('community.manageCommunitiesSubtitle', { defaultValue: 'Select a community to open management tools.' })}
        </Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <View style={[s.contentColumn, { maxWidth: contentWidth }]}>
          {loading ? (
            <ActivityIndicator color={c.primary} size="large" style={{ marginTop: 20 }} />
          ) : items.length === 0 ? (
            <Text style={[s.emptyText, { color: c.textMuted }]}>
              {t('community.manageCommunitiesEmpty', { defaultValue: 'You do not manage any communities yet.' })}
            </Text>
          ) : (
            <View style={s.listWrap}>
              {items.map((item) => {
                const name = (item.name || '').trim();
                const title = item.title || name || t('community.communityFallback', { defaultValue: 'Community' });
                const avatar = item.avatar;
                const accent = item.color || c.primary;
                const initial = (title[0] || 'C').toUpperCase();
                const roleLabel = item.is_creator
                  ? t('community.roleOwner', { defaultValue: 'Owner' })
                  : t('community.roleAdminMod', { defaultValue: 'Admin/Moderator' });

                return (
                  <View key={`manage-community-${item.id || name}`} style={[s.rowCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                    <TouchableOpacity style={s.identityButton} activeOpacity={0.85} onPress={() => name && onOpenCommunity(name)}>
                      <View style={[s.avatarWrap, { backgroundColor: accent }]}>
                        {avatar ? (
                          <Image source={{ uri: avatar }} style={s.avatarImage} resizeMode="cover" />
                        ) : (
                          <Text style={s.avatarInitial}>{initial}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>{title}</Text>
                        <Text style={[s.rowHandle, { color: c.textMuted }]} numberOfLines={1}>{name ? `c/${name}` : 'c/community'}</Text>
                        <Text style={[s.rowRole, { color: c.primary }]}>{roleLabel}</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.manageButton, { backgroundColor: c.primary }]}
                      activeOpacity={0.88}
                      onPress={() => name && onOpenManageCommunity(name)}
                    >
                      <MaterialCommunityIcons name="cog-outline" size={16} color="#fff" />
                      <Text style={s.manageButtonText}>
                        {t('community.manageAction', { defaultValue: 'Manage' })}
                      </Text>
                    </TouchableOpacity>
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
      paddingHorizontal: Platform.select({ native: 24, default: 28 }),
      paddingVertical: Platform.select({ native: 18, default: 24 }),
      borderBottomWidth: 1,
    },
    headerTitle: {
      fontSize: Platform.select({ native: 30, default: 52 }),
      fontWeight: Platform.select({ native: '800', default: '900' }),
      letterSpacing: -0.5,
      lineHeight: Platform.select({ native: 36, default: 56 }),
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
      paddingBottom: Platform.select({ native: 120, default: 24 }),
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
    },
    avatarWrap: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
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
      fontSize: 18,
      lineHeight: 22,
      fontWeight: '800',
    },
    rowHandle: {
      marginTop: 2,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '600',
    },
    rowRole: {
      marginTop: 4,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    manageButton: {
      height: 38,
      borderRadius: 10,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    manageButtonText: {
      color: '#fff',
      fontWeight: '800',
      fontSize: 13,
      lineHeight: 16,
    },
    emptyText: {
      marginTop: 18,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '600',
    },
  });
