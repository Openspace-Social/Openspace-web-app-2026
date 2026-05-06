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
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import { api, type FederatedLinkedAccount, type SocialIdentity, type SocialProvider } from '../../api/client';
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
  const [federatedLinkedAccounts, setFederatedLinkedAccounts] = useState<FederatedLinkedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [providerBusy, setProviderBusy] = useState<SocialProvider | null>(null);
  const [mastodonIdentifierInput, setMastodonIdentifierInput] = useState('');
  const [mastodonLinkLoading, setMastodonLinkLoading] = useState(false);
  const [mastodonUnlinkId, setMastodonUnlinkId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [socialList, federatedList] = await Promise.all([
        api.getLinkedSocialIdentities(token),
        api.getFederatedLinkedAccounts(token),
      ]);
      setIdentities(Array.isArray(socialList) ? socialList : []);
      setFederatedLinkedAccounts(Array.isArray(federatedList) ? federatedList : []);
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

  function getMastodonRedirectUri() {
    return Platform.OS === 'web'
      ? `${window.location.origin.replace(/\/+$/, '')}/mastodon-callback`
      : 'openspacesocial://mastodon-callback';
  }

  function parseMastodonCallback(url: string, expectedRedirectUri: string) {
    const normalizedExpected = expectedRedirectUri.replace(/\/+$/, '');
    const parsed = new URL(url);
    const callbackBase = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
    if (callbackBase !== normalizedExpected) {
      throw new Error(
        t('home.mastodonUnexpectedCallback', {
          defaultValue: 'Received an unexpected Mastodon callback.',
        }),
      );
    }
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    const errorCode = parsed.searchParams.get('error');
    const errorDescription = parsed.searchParams.get('error_description');
    if (errorCode) {
      throw new Error(
        errorDescription ||
          t('home.mastodonAuthorizationFailed', {
            defaultValue: 'Mastodon authorization was cancelled or failed.',
          }),
      );
    }
    if (!code || !state) {
      throw new Error(
        t('home.mastodonMissingCallbackParams', {
          defaultValue: 'Mastodon did not return the expected authorization details.',
        }),
      );
    }
    return { code, state };
  }

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

  const handleLinkMastodon = useCallback(async () => {
    if (!token || mastodonLinkLoading || mastodonUnlinkId !== null) return;
    const rawValue = mastodonIdentifierInput.trim();
    if (!rawValue) {
      showToast(
        t('home.mastodonIdentifierRequired', {
          defaultValue: 'Enter a Mastodon instance URL or @name@instance to continue.',
        }),
        { type: 'error' },
      );
      return;
    }

    setMastodonLinkLoading(true);
    try {
      const redirectUri = getMastodonRedirectUri();
      const started = await api.startFederatedLink(token, {
        redirect_uri: redirectUri,
        acct: rawValue.startsWith('@') ? rawValue : undefined,
        instance_domain: rawValue.startsWith('@') ? undefined : rawValue,
      });

      const authResult = await WebBrowser.openAuthSessionAsync(started.authorization_url, redirectUri);
      if (authResult.type !== 'success' || !authResult.url) {
        throw new Error(
          t('home.mastodonAuthorizationFailed', {
            defaultValue: 'Mastodon authorization was cancelled or failed.',
          }),
        );
      }

      const callbackData = parseMastodonCallback(authResult.url, redirectUri);
      await api.completeFederatedLink(token, callbackData);
      setMastodonIdentifierInput('');
      await load();
      showToast(
        t('home.mastodonLinkSuccess', {
          defaultValue: 'Mastodon account linked successfully.',
        }),
        { type: 'success' },
      );
    } catch (e: any) {
      showToast(
        e?.message ||
          t('home.mastodonLinkFailed', {
            defaultValue: 'Could not link your Mastodon account.',
          }),
        { type: 'error' },
      );
    } finally {
      setMastodonLinkLoading(false);
    }
  }, [load, mastodonIdentifierInput, mastodonLinkLoading, mastodonUnlinkId, showToast, t, token]);

  const handleUnlinkMastodon = useCallback(async (linkedAccountId: number) => {
    if (!token || mastodonLinkLoading || mastodonUnlinkId !== null) return;
    setMastodonUnlinkId(linkedAccountId);
    try {
      await api.unlinkFederatedLinkedAccount(token, linkedAccountId);
      await load();
      showToast(
        t('home.mastodonUnlinkSuccess', {
          defaultValue: 'Mastodon account unlinked.',
        }),
        { type: 'success' },
      );
    } catch (e: any) {
      showToast(
        e?.message ||
          t('home.mastodonUnlinkFailed', {
            defaultValue: 'Could not unlink your Mastodon account.',
          }),
        { type: 'error' },
      );
    } finally {
      setMastodonUnlinkId(null);
    }
  }, [load, mastodonLinkLoading, mastodonUnlinkId, showToast, t, token]);

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

          <View style={[styles.mastodonSection, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
            <View style={styles.mastodonSectionHeader}>
              <MaterialCommunityIcons name="mastodon" size={22} color="#6364FF" />
              <View style={styles.meta}>
                <Text style={[styles.providerName, { color: c.textPrimary }]}>Mastodon</Text>
                <Text style={[styles.providerStatus, { color: c.textMuted }]}>
                  {federatedLinkedAccounts.length > 0
                    ? t('home.mastodonLinkedCount', {
                        count: federatedLinkedAccounts.length,
                        defaultValue:
                          federatedLinkedAccounts.length === 1
                            ? '1 Mastodon account connected'
                            : `${federatedLinkedAccounts.length} Mastodon accounts connected`,
                      })
                    : t('home.linkedStatusNotConnected', { defaultValue: 'Not connected' })}
                </Text>
              </View>
            </View>

            {federatedLinkedAccounts.length > 0 ? (
              <View style={styles.mastodonAccountsList}>
                {federatedLinkedAccounts.map((account) => {
                  const isBusy = mastodonUnlinkId === account.id;
                  return (
                    <View
                      key={`mastodon-linked-account-${account.id}`}
                      style={[styles.mastodonAccountRow, { borderColor: c.border }]}
                    >
                      <View style={styles.meta}>
                        <Text style={[styles.providerName, { color: c.textPrimary }]}>
                          @{account.acct || account.username || account.instance_domain}
                        </Text>
                        <Text style={[styles.providerStatus, { color: c.textMuted }]}>
                          {account.instance_domain}
                        </Text>
                      </View>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        disabled={mastodonLinkLoading || mastodonUnlinkId !== null}
                        onPress={() => void handleUnlinkMastodon(account.id)}
                        style={[
                          styles.actionButton,
                          {
                            borderColor: c.errorText ?? '#ef4444',
                            backgroundColor: `${c.errorText ?? '#ef4444'}1A`,
                            opacity: mastodonLinkLoading || (mastodonUnlinkId !== null && !isBusy) ? 0.6 : 1,
                          },
                        ]}
                      >
                        {isBusy ? (
                          <ActivityIndicator size="small" color={c.errorText ?? '#ef4444'} />
                        ) : (
                          <Text style={[styles.actionButtonText, { color: c.errorText ?? '#ef4444' }]}>
                            {t('home.unlinkAction', { defaultValue: 'Disconnect' })}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <Text style={[styles.mastodonBody, { color: c.textMuted }]}>
              {t('home.mastodonConnectBody', {
                defaultValue: 'Enter a Mastodon instance URL or @name@instance to connect it to your OpenSpace account.',
              })}
            </Text>
            <TextInput
              value={mastodonIdentifierInput}
              onChangeText={setMastodonIdentifierInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder={t('home.mastodonConnectPlaceholder', {
                defaultValue: '@name@mastodon.social or mastodon.social',
              })}
              placeholderTextColor={c.textMuted}
              editable={!mastodonLinkLoading && mastodonUnlinkId == null}
              style={[
                styles.mastodonInput,
                {
                  color: c.textPrimary,
                  borderColor: c.border,
                  backgroundColor: c.background,
                },
              ]}
            />
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={mastodonLinkLoading || mastodonUnlinkId !== null}
              onPress={() => void handleLinkMastodon()}
              style={[styles.mastodonButton, { backgroundColor: c.primary, opacity: mastodonUnlinkId !== null ? 0.6 : 1 }]}
            >
              {mastodonLinkLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.mastodonButtonText}>
                  {t('home.linkAction', { defaultValue: 'Connect' })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
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
  mastodonSection: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  mastodonSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mastodonAccountsList: {
    gap: 10,
  },
  mastodonAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  mastodonBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  mastodonInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  mastodonButton: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mastodonButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
