/**
 * ModerationPenaltiesScreenContainer — read-only list of any moderation
 * penalties applied to the authenticated user.
 *
 * Web exposes this as a drawer; native mounts it as a normal stack screen
 * under the ProfileTab. The data is identical: id, type, expiration.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { api, type ModerationPenalty } from '../../api/client';

function formatExpiration(value: string | null, fallback: string) {
  if (!value) return fallback;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function ModerationPenaltiesScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;

  const [items, setItems] = useState<ModerationPenalty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const list = await api.getUserModerationPenalties(token);
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(e?.message || 'Could not load penalties.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(true); } finally { setRefreshing(false); }
  }, [load]);

  if (loading && items.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} size="large" />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.listContent}
      data={items}
      keyExtractor={(item) => `penalty-${item.id}`}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { void onRefresh(); }}
          tintColor={c.primary}
          colors={[c.primary]}
        />
      }
      ListHeaderComponent={
        <Text style={[styles.subtitle, { color: c.textMuted }]}>
          {t('home.moderationPenaltiesDescription', {
            defaultValue:
              'These are moderation actions taken on your account. Each entry shows the type and when (if ever) it expires.',
          })}
        </Text>
      }
      renderItem={({ item }) => (
        <View style={[styles.row, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
          <MaterialCommunityIcons name="gavel" size={22} color={c.errorText || '#dc2626'} />
          <View style={styles.meta}>
            <Text style={[styles.type, { color: c.textPrimary }]} numberOfLines={2}>
              {item.type}
            </Text>
            <Text style={[styles.expires, { color: c.textMuted }]} numberOfLines={1}>
              {item.expiration
                ? t('home.moderationPenaltyExpires', {
                    when: formatExpiration(item.expiration, ''),
                    defaultValue: `Expires: ${formatExpiration(item.expiration, '—')}`,
                  })
                : t('home.moderationPenaltyPermanent', { defaultValue: 'Permanent' })}
            </Text>
          </View>
        </View>
      )}
      ListEmptyComponent={
        error ? (
          <Text style={[styles.emptyText, { color: c.errorText }]}>{error}</Text>
        ) : (
          <View style={styles.emptyWrap}>
            <MaterialCommunityIcons name="shield-check-outline" size={28} color={c.textMuted} />
            <Text style={[styles.emptyText, { color: c.textMuted }]}>
              {t('home.moderationPenaltiesEmpty', {
                defaultValue: 'No moderation penalties on your account.',
              })}
            </Text>
          </View>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  listContent: { padding: 14, paddingBottom: 120, gap: 10 },
  subtitle: { fontSize: 13, lineHeight: 19, marginBottom: 8 },
  separator: { height: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  meta: { flex: 1 },
  type: { fontSize: 14, fontWeight: '700' },
  expires: { fontSize: 12, marginTop: 2 },
  emptyWrap: { alignItems: 'center', padding: 24, gap: 10 },
  emptyText: { fontSize: 14, textAlign: 'center' },
});
