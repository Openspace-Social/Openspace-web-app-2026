/**
 * LinkedAccountsScreenContainer — manage social-auth identities.
 *
 * Mirrors HomeScreen's web flow (handleLinkProvider / handleUnlinkProvider)
 * but uses the native Google + Apple SDKs (via `nativeSocialIdToken`) to
 * obtain an id_token, then exchanges it with the same backend endpoints
 * the web app uses. Per-provider loading state keeps the rest of the list
 * tappable while one provider is busy.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import { api, type SocialIdentity, type SocialProvider } from '../../api/client';
import { nativeSocialIdToken } from '../../utils/nativeSocialAuth';

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
  const { showToast } = useAppToast();
  const c = theme.colors;

  const [identities, setIdentities] = useState<SocialIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [providerBusy, setProviderBusy] = useState<SocialProvider | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const list = await api.getLinkedSocialIdentities(token);
      setIdentities(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(e?.message || t('home.linkedAccountsLoadFailed', { defaultValue: 'Could not load linked accounts.' }));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const getIdentity = (provider: SocialProvider) =>
    identities.find((i) => i.provider === provider) || null;

  const getProviderName = (provider: SocialProvider) => providerLabel(provider);

  // ── Link / Unlink handlers ─────────────────────────────────────────────
  const handleLink = useCallback(
    async (provider: SocialProvider) => {
      if (!token || providerBusy) return;
      setProviderBusy(provider);
      try {
        const idToken = await nativeSocialIdToken(provider, t);
        const message = await api.linkSocialIdentity(token, provider, idToken);
        await load();
        showToast(
          message ||
            t('home.linkSuccess', {
              provider: getProviderName(provider),
              defaultValue: `${getProviderName(provider)} connected.`,
            }),
          { type: 'success' },
        );
      } catch (e: any) {
        const raw = String(e?.message || '').toLowerCase();
        // Same heuristics as HomeScreen — backend errors aren't perfectly
        // typed so we sniff the message text for the common "this email is
        // already linked elsewhere" failure mode and surface a friendlier
        // message instead of the raw backend string.
        const friendlyAlreadyLinked =
          raw.includes('invalid token') ||
          raw.includes('already linked') ||
          raw.includes('another user') ||
          raw.includes('email already') ||
          raw.includes('already exists');
        const cancelled = raw.includes(t('auth.socialCancelled', { defaultValue: 'cancelled' }).toLowerCase());
        if (cancelled) {
          // Quiet cancellation — no toast.
          return;
        }
        showToast(
          friendlyAlreadyLinked
            ? t('home.linkEmailAlreadyLinked', {
                defaultValue: 'Email already linked to an Openspace account.',
              })
            : e?.message ||
                t('home.linkFailed', {
                  provider: getProviderName(provider),
                  defaultValue: `Could not link ${getProviderName(provider)}.`,
                }),
          { type: 'error' },
        );
      } finally {
        setProviderBusy(null);
      }
    },
    [token, providerBusy, t, load, showToast],
  );

  const handleUnlink = useCallback(
    async (provider: SocialProvider) => {
      if (!token || providerBusy) return;
      setProviderBusy(provider);
      try {
        const message = await api.unlinkSocialIdentity(token, provider);
        await load();
        showToast(
          message ||
            t('home.unlinkSuccess', {
              provider: getProviderName(provider),
              defaultValue: `${getProviderName(provider)} disconnected.`,
            }),
          { type: 'success' },
        );
      } catch (e: any) {
        showToast(
          e?.message ||
            t('home.unlinkFailed', {
              provider: getProviderName(provider),
              defaultValue: `Could not disconnect ${getProviderName(provider)}.`,
            }),
          { type: 'error' },
        );
      } finally {
        setProviderBusy(null);
      }
    },
    [token, providerBusy, t, load, showToast],
  );

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[styles.subtitle, { color: c.textMuted }]}>
        {t('home.linkedAccountsDescription', {
          defaultValue: 'Connect or disconnect the providers you use to sign in.',
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
            const isBusy = providerBusy === provider;
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
                        ? t('home.linkedStatusWithEmail', {
                            email: identity.email,
                            defaultValue: `Connected as ${identity.email}`,
                          })
                        : t('home.linkedStatusConnected', { defaultValue: 'Connected' })
                      : t('home.linkedStatusNotConnected', { defaultValue: 'Not connected' })}
                  </Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={isBusy || !!providerBusy}
                  onPress={() => (isLinked ? handleUnlink(provider) : handleLink(provider))}
                  style={[
                    styles.actionButton,
                    {
                      borderColor: isLinked ? c.errorText ?? '#ef4444' : c.primary,
                      backgroundColor: isLinked
                        ? `${c.errorText ?? '#ef4444'}1A`
                        : `${c.primary}1A`,
                      opacity: isBusy || (!!providerBusy && !isBusy) ? 0.6 : 1,
                    },
                  ]}
                >
                  {isBusy ? (
                    <ActivityIndicator
                      size="small"
                      color={isLinked ? c.errorText ?? '#ef4444' : c.primary}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.actionButtonText,
                        { color: isLinked ? c.errorText ?? '#ef4444' : c.primary },
                      ]}
                    >
                      {isLinked
                        ? t('home.unlinkAction', { defaultValue: 'Disconnect' })
                        : t('home.linkAction', { defaultValue: 'Connect' })}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}
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
  actionButton: {
    minWidth: 92,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
