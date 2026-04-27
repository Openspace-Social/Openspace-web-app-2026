/**
 * LinkedAccountsScreenContainer — list of linked social-auth identities.
 *
 * Read-only on native: shows which providers (Google, Apple) are currently
 * connected and the linked email. Linking and unlinking aren't supported
 * on native yet because the legacy flow (HomeScreen.openSocialPopup)
 * relies on a browser window.popup, which doesn't exist outside web. A
 * future pass with expo-auth-session can implement native OAuth and turn
 * this into a fully-fledged manage screen.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { api, type SocialIdentity, type SocialProvider } from '../../api/client';

const PROVIDERS: SocialProvider[] = ['google', 'apple'];

function providerLabel(provider: SocialProvider) {
  return provider === 'google' ? 'Google' : 'Apple';
}

function providerIcon(provider: SocialProvider): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  return provider === 'google' ? 'google' : 'apple';
}

export default function LinkedAccountsScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;

  const [identities, setIdentities] = useState<SocialIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const list = await api.getLinkedSocialIdentities(token);
      setIdentities(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(e?.message || 'Could not load linked accounts.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const getIdentity = (provider: SocialProvider) =>
    identities.find((i) => i.provider === provider) || null;

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[styles.subtitle, { color: c.textMuted }]}>
        {t('home.linkedAccountsDescription', {
          defaultValue: 'See which sign-in providers are connected to your account.',
        })}
      </Text>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.primary} size="small" />
        </View>
      ) : error ? (
        <Text style={[styles.errorText, { color: c.errorText }]}>{error}</Text>
      ) : (
        <View style={styles.list}>
          {PROVIDERS.map((provider) => {
            const identity = getIdentity(provider);
            const isLinked = !!identity;
            return (
              <View
                key={provider}
                style={[styles.row, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              >
                <MaterialCommunityIcons
                  name={providerIcon(provider)}
                  size={22}
                  color={provider === 'google' ? '#DB4437' : c.textPrimary}
                />
                <View style={styles.meta}>
                  <Text style={[styles.providerName, { color: c.textPrimary }]}>
                    {providerLabel(provider)}
                  </Text>
                  <Text style={[styles.providerStatus, { color: c.textMuted }]}>
                    {isLinked
                      ? identity?.email
                        ? t('home.linkedStatusWithEmail', { email: identity.email, defaultValue: `Connected as ${identity.email}` })
                        : t('home.linkedStatusConnected', { defaultValue: 'Connected' })
                      : t('home.linkedStatusNotConnected', { defaultValue: 'Not connected' })}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusPill,
                    {
                      borderColor: c.border,
                      backgroundColor: isLinked ? (c.primary + '20') : c.background,
                    },
                  ]}
                >
                  <Text style={[styles.statusPillText, { color: isLinked ? c.primary : c.textMuted }]}>
                    {isLinked
                      ? t('home.linkedStatusActive', { defaultValue: 'Active' })
                      : t('home.linkedStatusInactive', { defaultValue: 'None' })}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={[styles.notice, { borderColor: c.border, backgroundColor: c.surface }]}>
        <MaterialCommunityIcons name="information-outline" size={18} color={c.textSecondary} />
        <Text style={[styles.noticeText, { color: c.textSecondary }]}>
          {t('home.linkedAccountsManageOnWeb', {
            defaultValue:
              'Connecting and disconnecting providers is currently only available on the web. Visit openspacelive.com from a browser to manage your linked accounts.',
          })}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 120,
    gap: 12,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  centered: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 12,
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  meta: { flex: 1 },
  providerName: {
    fontSize: 15,
    fontWeight: '700',
  },
  providerStatus: {
    fontSize: 13,
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  notice: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 6,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
});
