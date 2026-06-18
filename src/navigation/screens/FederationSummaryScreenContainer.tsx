/**
 * FederationSummaryScreenContainer — dedicated "Federation" page.
 *
 * Reached from Settings → Federation tile. Mirrors the LinkedAccounts
 * pattern: a navigator screen that fetches the authenticated user, pulls
 * out `federation_summary`, and renders the existing FederationSummaryCard
 * full-size inside a ScrollView.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { api, type FederationSummary } from '../../api/client';
import FederationSummaryCard from '../../components/FederationSummaryCard';
import ScreenError from '../../components/ScreenError';

export default function FederationSummaryScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;

  const [summary, setSummary] = useState<FederationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      // Dedicated federation dashboard — opt in to the federation summary
      // server-side. The server returns null by default to keep the
      // /api/auth/user/ endpoint sub-second on every other surface; this
      // screen accepts the slower fetch as the cost of showing the data.
      const me: any = await api.getAuthenticatedUser(token, { includeFederationSummary: true });
      setSummary(me?.federation_summary ?? null);
    } catch (e: any) {
      setError(
        e?.message ||
          t('federation.loadFailed', {
            defaultValue: 'Could not load your federation summary right now.',
          }),
      );
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.primary} size="small" />
        </View>
      ) : error ? (
        <ScreenError message={error} c={c} t={t} onRetry={load} retrying={loading} />
      ) : summary ? (
        <FederationSummaryCard c={c} t={t} summary={summary} isOwnProfile />
      ) : (
        <Text style={[styles.emptyText, { color: c.textMuted }]}>
          {t('federation.emptyState', {
            defaultValue: 'Federation is not yet active for this profile.',
          })}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 48,
  },
  centered: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 16,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    paddingVertical: 24,
    textAlign: 'center',
  },
});
