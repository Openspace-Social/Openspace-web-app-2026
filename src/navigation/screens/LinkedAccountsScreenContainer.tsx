import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import {
  api,
  type FederatedIdentityJob,
  type FederatedIdentityLink,
  type FederatedLinkedAccount,
  type SocialIdentity,
  type SocialProvider,
} from '../../api/client';
import { nativeSocialIdToken } from '../../utils/nativeSocialAuth';

const PROVIDERS: SocialProvider[] = ['google', 'apple'];

function providerLabel(provider: SocialProvider) {
  return provider === 'google' ? 'Google' : 'Apple';
}

function providerIcon(provider: SocialProvider): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  return provider === 'google' ? 'google' : 'apple';
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

function jobTitle(job: FederatedIdentityJob) {
  switch (job.job_type) {
    case 'import_follows':
      return 'Imported follows';
    case 'import_followers':
      return 'Imported followers';
    case 'crosspost_setup':
      return 'Updated posting behavior';
    case 'migration_notice':
      return 'Prepared migration notice';
    case 'auto_follow_old_account':
      return 'Followed old Mastodon account';
    default:
      return job.job_type.replace(/_/g, ' ');
  }
}

export default function LinkedAccountsScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const c = theme.colors;

  const [identities, setIdentities] = useState<SocialIdentity[]>([]);
  const [federatedLinkedAccounts, setFederatedLinkedAccounts] = useState<FederatedLinkedAccount[]>([]);
  const [federatedIdentities, setFederatedIdentities] = useState<FederatedIdentityLink[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [providerBusy, setProviderBusy] = useState<SocialProvider | null>(null);
  const [mastodonIdentifierInput, setMastodonIdentifierInput] = useState('');
  const [mastodonLinkLoading, setMastodonLinkLoading] = useState(false);
  const [mastodonUnlinkId, setMastodonUnlinkId] = useState<number | null>(null);
  const [settingsBusyId, setSettingsBusyId] = useState<number | null>(null);
  const [jobBusyKey, setJobBusyKey] = useState<string | null>(null);
  const [activeMigrationIdentityId, setActiveMigrationIdentityId] = useState<number | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const linkedAccountById = useMemo(() => {
    const entries = federatedLinkedAccounts.map((account) => [account.id, account] as const);
    return new Map(entries);
  }, [federatedLinkedAccounts]);

  const activeFederatedIdentities = useMemo(
    () => federatedIdentities.filter((identity) => identity.link_status !== 'revoked'),
    [federatedIdentities],
  );

  const archivedFederatedIdentityCount = federatedIdentities.length - activeFederatedIdentities.length;

  const activeMigrationIdentity = useMemo(
    () => activeFederatedIdentities.find((identity) => identity.id === activeMigrationIdentityId) || null,
    [activeMigrationIdentityId, activeFederatedIdentities],
  );

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [socialList, federatedList, identityList] = await Promise.all([
        api.getLinkedSocialIdentities(token),
        api.getFederatedLinkedAccounts(token),
        api.getFederatedIdentities(token),
      ]);
      const nextSocialList = Array.isArray(socialList) ? socialList : [];
      const nextFederatedList = Array.isArray(federatedList) ? federatedList : [];
      const nextIdentityList = Array.isArray(identityList) ? identityList : [];
      setIdentities(nextSocialList);
      setFederatedLinkedAccounts(nextFederatedList);
      setFederatedIdentities(nextIdentityList);
      setNoteDrafts((current) => {
        const nextDrafts: Record<number, string> = {};
        nextIdentityList.forEach((identity) => {
          nextDrafts[identity.id] =
            current[identity.id] !== undefined ? current[identity.id] : (identity.profile_note || '');
        });
        return nextDrafts;
      });
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

  const updateIdentityState = useCallback((nextIdentity: FederatedIdentityLink) => {
    setFederatedIdentities((current) =>
      current.map((identity) => (identity.id === nextIdentity.id ? nextIdentity : identity)),
    );
    setNoteDrafts((current) => ({
      ...current,
      [nextIdentity.id]: nextIdentity.profile_note || '',
    }));
  }, []);

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
              provider: providerLabel(provider),
              defaultValue: `${providerLabel(provider)} connected.`,
            }),
          { type: 'success' },
        );
      } catch (e: any) {
        const raw = String(e?.message || '').toLowerCase();
        const friendlyAlreadyLinked =
          raw.includes('invalid token') ||
          raw.includes('already linked') ||
          raw.includes('another user') ||
          raw.includes('email already') ||
          raw.includes('already exists');
        const cancelled = raw.includes(t('auth.socialCancelled', { defaultValue: 'cancelled' }).toLowerCase());
        if (!cancelled) {
          showToast(
            friendlyAlreadyLinked
              ? t('home.linkEmailAlreadyLinked', {
                  defaultValue: 'Email already linked to an Openspace account.',
                })
              : e?.message ||
                  t('home.linkFailed', {
                    provider: providerLabel(provider),
                    defaultValue: `Could not link ${providerLabel(provider)}.`,
                  }),
            { type: 'error' },
          );
        }
      } finally {
        setProviderBusy(null);
      }
    },
    [load, providerBusy, showToast, t, token],
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
              provider: providerLabel(provider),
              defaultValue: `${providerLabel(provider)} disconnected.`,
            }),
          { type: 'success' },
        );
      } catch (e: any) {
        showToast(
          e?.message ||
            t('home.unlinkFailed', {
              provider: providerLabel(provider),
              defaultValue: `Could not disconnect ${providerLabel(provider)}.`,
            }),
          { type: 'error' },
        );
      } finally {
        setProviderBusy(null);
      }
    },
    [load, providerBusy, showToast, t, token],
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

  const handleSaveIdentitySettings = useCallback(
    async (
      identityId: number,
      payload: {
        crosspost_openbook_to_mastodon?: boolean;
        crosspost_mastodon_to_openbook?: boolean;
        profile_note?: string | null;
      },
      successMessage: string,
    ) => {
      if (!token) return;
      setSettingsBusyId(identityId);
      try {
        const result = await api.updateFederatedCrosspostSettings(token, identityId, payload);
        updateIdentityState(result.identity);
        setWorkspaceNotice({ type: 'success', message: successMessage });
      } catch (e: any) {
        setWorkspaceNotice({
          type: 'error',
          message: e?.message || t('home.mastodonSettingsFailed', { defaultValue: 'Could not update Mastodon settings.' }),
        });
      } finally {
        setSettingsBusyId(null);
      }
    },
    [t, token, updateIdentityState],
  );

  const handleRunIdentityJob = useCallback(
    async (identityId: number, key: string, runner: () => Promise<FederatedIdentityJob>, successMessage: string) => {
      setJobBusyKey(`${identityId}:${key}`);
      try {
        await runner();
        await load();
        setWorkspaceNotice({ type: 'success', message: successMessage });
      } catch (e: any) {
        setWorkspaceNotice({
          type: 'error',
          message: e?.message || t('home.mastodonJobFailed', { defaultValue: 'Could not complete this migration step.' }),
        });
      } finally {
        setJobBusyKey(null);
      }
    },
    [load, t],
  );

  const hasMigrationWorkspace = activeFederatedIdentities.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.container}>
        <Text style={[styles.subtitle, { color: c.textMuted }]}>
          {t('home.linkedAccountsDescription', {
            defaultValue: 'Connect sign-in providers and manage the fediverse identities you want to bring with you.',
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
            <View style={[styles.sectionCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Sign-in providers</Text>
              <Text style={[styles.sectionBody, { color: c.textMuted }]}>
                Connect the identity providers you use to log in so OpenSpace stays easy to access while you migrate.
              </Text>
              <View style={styles.providerList}>
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
                        <Text style={[styles.providerName, { color: c.textPrimary }]}>{providerLabel(provider)}</Text>
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
                            backgroundColor: isLinked ? `${c.errorText ?? '#ef4444'}1A` : `${c.primary}1A`,
                            opacity: isBusy || (!!providerBusy && !isBusy) ? 0.6 : 1,
                          },
                        ]}
                      >
                        {isBusy ? (
                          <ActivityIndicator size="small" color={isLinked ? c.errorText ?? '#ef4444' : c.primary} />
                        ) : (
                          <Text
                            style={[
                              styles.actionButtonText,
                              { color: isLinked ? c.errorText ?? '#ef4444' : c.primary },
                            ]}
                          >
                            {isLinked ? 'Disconnect' : 'Connect'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={[styles.sectionCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.sectionHeaderInline}>
                <View style={styles.sectionHeaderText}>
                  <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Connect Mastodon</Text>
                  <Text style={[styles.sectionBody, { color: c.textMuted }]}>
                    Enter a Mastodon instance or handle to start linking the account you want to migrate with.
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
                        style={[styles.mastodonAccountRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}
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
                            <Text style={[styles.actionButtonText, { color: c.errorText ?? '#ef4444' }]}>Disconnect</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              <TextInput
                value={mastodonIdentifierInput}
                onChangeText={setMastodonIdentifierInput}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="@name@mastodon.social or mastodon.social"
                placeholderTextColor={c.textMuted}
                editable={!mastodonLinkLoading && mastodonUnlinkId == null}
                style={[
                  styles.mastodonInput,
                  {
                    color: c.textPrimary,
                    borderColor: c.border,
                    backgroundColor: c.inputBackground,
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
                  <Text style={styles.mastodonButtonText}>Connect Mastodon</Text>
                )}
              </TouchableOpacity>
            </View>

            {hasMigrationWorkspace ? (
              <View style={[styles.sectionCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Mastodon migration workspace</Text>
                <Text style={[styles.sectionBody, { color: c.textMuted }]}>
                  Open a dedicated workspace for each linked Mastodon identity when you are ready to import your graph or manage migration settings.
                </Text>
                <View style={styles.workspacePreviewList}>
                  {activeFederatedIdentities.map((identity) => {
                    const linkedAccount = identity.linked_account_id ? linkedAccountById.get(identity.linked_account_id) : null;
                    const readiness = identity.migration_readiness;
                    const isReady = !!readiness?.can_claim_move;
                    return (
                      <TouchableOpacity
                        key={`federated-identity-summary-${identity.id}`}
                        activeOpacity={0.9}
                        onPress={() => setActiveMigrationIdentityId(identity.id)}
                        style={[styles.workspacePreviewCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}
                      >
                        <View style={styles.workspacePreviewHeader}>
                          <View style={styles.workspacePreviewText}>
                            <Text style={[styles.workspacePreviewTitle, { color: c.textPrimary }]}>{identity.remote_handle}</Text>
                            <Text style={[styles.workspacePreviewSubtitle, { color: c.textMuted }]}>
                              {linkedAccount?.instance_domain || identity.remote_instance_url.replace(/^https?:\/\//, '')}
                            </Text>
                          </View>
                          <View style={styles.workspacePreviewBadges}>
                            <View style={[styles.badge, { backgroundColor: `${c.primary}16`, borderColor: `${c.primary}33` }]}>
                              <Text style={[styles.badgeText, { color: c.primary }]}>
                                {identity.link_status === 'verified' ? 'Linked' : identity.link_status}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.badge,
                                {
                                  backgroundColor: isReady ? '#DCFCE7' : '#FEF3C7',
                                  borderColor: isReady ? '#86EFAC' : '#FCD34D',
                                },
                              ]}
                            >
                              <Text style={[styles.badgeText, { color: isReady ? '#166534' : '#92400E' }]}>
                                {isReady ? 'Ready' : 'Needs verification'}
                              </Text>
                            </View>
                          </View>
                        </View>
                        <Text style={[styles.workspacePreviewBody, { color: c.textSecondary }]}>
                          {readiness?.note || 'Open this workspace to verify the identity, import your graph, and choose how OpenSpace should work with Mastodon.'}
                        </Text>
                        <View style={styles.workspacePreviewFooter}>
                          <Text style={[styles.workspacePreviewAction, { color: c.primary }]}>Open workspace</Text>
                          <MaterialCommunityIcons name="chevron-right" size={20} color={c.primary} />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {archivedFederatedIdentityCount > 0 ? (
                  <Text style={[styles.archivedNote, { color: c.textMuted }]}>
                    {archivedFederatedIdentityCount} archived Mastodon {archivedFederatedIdentityCount === 1 ? 'identity is' : 'identities are'} hidden from this workspace.
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={[styles.emptyMigrationCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Your migration workspace will appear here</Text>
                <Text style={[styles.sectionBody, { color: c.textMuted }]}>
                  Once you connect a Mastodon identity, OpenSpace will show your import tools, posting toggles, and transition guidance in one place.
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {activeMigrationIdentity ? (() => {
            const identity = activeMigrationIdentity;
              const linkedAccount = identity.linked_account_id ? linkedAccountById.get(identity.linked_account_id) : null;
              const readiness = identity.migration_readiness;
              const actionsUnlocked = identity.link_status === 'verified';
              const isSettingsBusy = settingsBusyId === identity.id;
              const noteDraft = noteDrafts[identity.id] ?? identity.profile_note ?? '';
              const importFollowsBusy = jobBusyKey === `${identity.id}:import-follows`;
              const importFollowersBusy = jobBusyKey === `${identity.id}:import-followers`;
              const autoFollowBusy = jobBusyKey === `${identity.id}:auto-follow-old-account`;
              const migrationNoticeBusy = jobBusyKey === `${identity.id}:migration-notice`;
              const refreshVerificationBusy = jobBusyKey === `${identity.id}:refresh-verification`;

              return (
                <View style={[styles.nestedDrawerPanel, { backgroundColor: c.surface, borderLeftColor: c.border }]}>
                  <View style={[styles.nestedDrawerHeader, { borderBottomColor: c.border }]}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => setActiveMigrationIdentityId(null)}
                      style={[styles.backButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    >
                      <MaterialCommunityIcons name="arrow-left" size={18} color={c.textPrimary} />
                    </TouchableOpacity>
                    <View style={styles.nestedDrawerHeaderText}>
                      <Text style={[styles.nestedDrawerEyebrow, { color: c.textMuted }]}>Mastodon migration workspace</Text>
                      <Text style={[styles.nestedDrawerTitle, { color: c.textPrimary }]}>{identity.remote_handle}</Text>
                      <Text style={[styles.nestedDrawerSubtitle, { color: c.textMuted }]}>
                        {linkedAccount?.instance_domain || identity.remote_instance_url.replace(/^https?:\/\//, '')}
                      </Text>
                    </View>
                  </View>

                  <ScrollView contentContainerStyle={styles.nestedDrawerContent} showsVerticalScrollIndicator={false}>
                    <View style={[styles.heroCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                      <View style={styles.heroHeader}>
                        <View style={[styles.heroIcon, { backgroundColor: `${c.primary}16` }]}>
                          <MaterialCommunityIcons name="mastodon" size={22} color={c.primary} />
                        </View>
                        <View style={styles.heroTextWrap}>
                          <Text style={[styles.heroEyebrow, { color: c.primary }]}>Phase 4</Text>
                          <Text style={[styles.heroTitle, { color: c.textPrimary }]}>
                            {t('home.federationMigrationTitle', {
                              defaultValue: 'Make your Mastodon identity feel at home on OpenSpace',
                            })}
                          </Text>
                          <Text style={[styles.heroBody, { color: c.textSecondary }]}>
                            {t('home.federationMigrationBody', {
                              defaultValue:
                                'Link your fediverse identity, import your graph, choose how you want to publish, and transition at your own pace instead of starting from zero.',
                            })}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.heroPills}>
                        {[
                          'Verify identity',
                          'Import follows',
                          'Choose posting behavior',
                          'Keep your audience',
                        ].map((label) => (
                          <View key={label} style={[styles.heroPill, { backgroundColor: c.surface, borderColor: c.border }]}>
                            <Text style={[styles.heroPillText, { color: c.textPrimary }]}>{label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>

                    <View style={[styles.identityCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                      {workspaceNotice ? (
                        <View
                          style={[
                            styles.workspaceNotice,
                            workspaceNotice.type === 'error'
                              ? { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }
                              : { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
                          ]}
                        >
                          <MaterialCommunityIcons
                            name={workspaceNotice.type === 'error' ? 'alert-circle-outline' : 'check-circle-outline'}
                            size={18}
                            color={workspaceNotice.type === 'error' ? '#B91C1C' : '#047857'}
                          />
                          <Text
                            style={[
                              styles.workspaceNoticeText,
                              { color: workspaceNotice.type === 'error' ? '#991B1B' : '#065F46' },
                            ]}
                          >
                            {workspaceNotice.message}
                          </Text>
                        </View>
                      ) : null}

                      <View style={styles.identityHeader}>
                        <View style={styles.identityHeaderText}>
                          <Text style={[styles.identityHandle, { color: c.textPrimary }]}>{identity.remote_handle}</Text>
                          <Text style={[styles.identitySubhead, { color: c.textMuted }]}>
                            {linkedAccount?.instance_domain || identity.remote_instance_url.replace(/^https?:\/\//, '')}
                          </Text>
                        </View>
                        <View style={styles.identityBadges}>
                          <View style={[styles.badge, { backgroundColor: `${c.primary}16`, borderColor: `${c.primary}33` }]}>
                            <Text style={[styles.badgeText, { color: c.primary }]}>
                              {identity.link_status === 'verified' ? 'Verified' : identity.link_status}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.badge,
                              {
                                backgroundColor: readiness?.remote_alias_verified ? '#DCFCE7' : `${c.border}55`,
                                borderColor: readiness?.remote_alias_verified ? '#86EFAC' : c.border,
                              },
                            ]}
                          >
                            <Text style={[styles.badgeText, { color: readiness?.remote_alias_verified ? '#166534' : c.textMuted }]}>
                              {readiness?.remote_alias_verified ? 'Alias verified' : 'Alias pending'}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <Text style={[styles.identityBody, { color: c.textSecondary }]}>
                        {readiness?.note ||
                          'This linked Mastodon identity can be used to import your graph, control cross-posting, and move gradually into OpenSpace.'}
                      </Text>

                      {!actionsUnlocked ? (
                        <View style={[styles.lockNotice, { backgroundColor: '#FFF7ED', borderColor: '#FDBA74' }]}>
                          <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#C2410C" />
                          <Text style={[styles.lockNoticeText, { color: '#9A3412' }]}>
                            This identity is linked, but migration actions stay locked until the verification step is complete.
                          </Text>
                        </View>
                      ) : null}

                      <View style={[styles.stepCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                    <Text style={[styles.stepTitle, { color: c.textPrimary }]}>1. Verify identity</Text>
                    <Text style={[styles.stepBody, { color: c.textSecondary }]}>
                      Verified identities reduce migration risk and make it clear that your OpenSpace account is additive, not a replacement forced on you.
                    </Text>
                    <View style={styles.verificationList}>
                      <Text style={[styles.verificationItem, { color: c.textSecondary }]}>
                        1. In Mastodon, open Preferences {'>'} Account.
                      </Text>
                      <Text style={[styles.verificationItem, { color: c.textSecondary }]}>
                        2. Find Moving from a different account and click create an account alias.
                      </Text>
                      <Text style={[styles.verificationItem, { color: c.textSecondary }]}>
                        3. Enter this OpenSpace identity {identity.local_actor_handle || identity.local_actor_uri || 'profile'} as the alias, save it, then come back here and run the verification check again.
                      </Text>
                    </View>
                    <Text style={[styles.stepMeta, { color: c.textMuted }]}>
                      Linked on {formatDate(identity.verified_at) || 'Unknown date'}
                    </Text>
                    <Text style={[styles.stepMeta, { color: c.textMuted }]}>
                      Last alias check {formatDate(identity.remote_alias_last_checked_at) || 'not yet run'}
                    </Text>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      disabled={!!jobBusyKey}
                      onPress={() =>
                        void handleRunIdentityJob(
                          identity.id,
                          'refresh-verification',
                          async () => {
                            const refreshed = await api.refreshFederatedIdentityVerification(token!, identity.id);
                            updateIdentityState(refreshed);
                            return {
                              id: refreshed.id,
                              identity_link: refreshed.id,
                              job_type: 'crosspost_setup',
                              status: 'completed',
                              created_at: refreshed.updated_at,
                              updated_at: refreshed.updated_at,
                            } as FederatedIdentityJob;
                          },
                          'Checked Mastodon again for your OpenSpace alias.',
                        )
                      }
                      style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.surface }]}
                    >
                      {refreshVerificationBusy ? (
                        <ActivityIndicator size="small" color={c.primary} />
                      ) : (
                        <Text style={[styles.secondaryActionText, { color: c.textPrimary }]}>Check verification again</Text>
                      )}
                    </TouchableOpacity>
                      </View>

                      <View style={[styles.stepCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                    <Text style={[styles.stepTitle, { color: c.textPrimary }]}>2. Import your graph</Text>
                    <Text style={[styles.stepBody, { color: c.textSecondary }]}>
                      Bring your network over gradually so OpenSpace feels like an expansion of your audience, not a risky reset.
                    </Text>
                    <View style={styles.actionGrid}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        disabled={!!jobBusyKey || !actionsUnlocked}
                        onPress={() =>
                          void handleRunIdentityJob(
                            identity.id,
                            'import-follows',
                            () => api.importFederatedIdentityFollows(token!, identity.id),
                            'Started importing the people you follow on Mastodon.',
                          )
                        }
                        style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.surface }]}
                      >
                        {importFollowsBusy ? <ActivityIndicator size="small" color={c.primary} /> : <Text style={[styles.secondaryActionText, { color: c.textPrimary }]}>Import follows</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        disabled={!!jobBusyKey || !actionsUnlocked}
                        onPress={() =>
                          void handleRunIdentityJob(
                            identity.id,
                            'import-followers',
                            () => api.importFederatedIdentityFollowers(token!, identity.id),
                            'Started importing your Mastodon followers.',
                          )
                        }
                        style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.surface }]}
                      >
                        {importFollowersBusy ? <ActivityIndicator size="small" color={c.primary} /> : <Text style={[styles.secondaryActionText, { color: c.textPrimary }]}>Import followers</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        disabled={!!jobBusyKey || !actionsUnlocked}
                        onPress={() =>
                          void handleRunIdentityJob(
                            identity.id,
                            'auto-follow-old-account',
                            () => api.autoFollowFederatedOldAccount(token!, identity.id),
                            'Queued a follow back to your old Mastodon account.',
                          )
                        }
                        style={[styles.secondaryAction, { borderColor: c.border, backgroundColor: c.surface }]}
                      >
                        {autoFollowBusy ? <ActivityIndicator size="small" color={c.primary} /> : <Text style={[styles.secondaryActionText, { color: c.textPrimary }]}>Follow old account</Text>}
                      </TouchableOpacity>
                    </View>
                      </View>

                      <View style={[styles.stepCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                    <Text style={[styles.stepTitle, { color: c.textPrimary }]}>3. Choose posting behavior</Text>
                    <Text style={[styles.stepBody, { color: c.textSecondary }]}>
                      Decide how OpenSpace and Mastodon should work together while you transition.
                    </Text>
                    <View style={styles.toggleList}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        disabled={isSettingsBusy || !actionsUnlocked}
                        onPress={() =>
                          void handleSaveIdentitySettings(
                            identity.id,
                            { crosspost_openbook_to_mastodon: !identity.crosspost_openbook_to_mastodon },
                            !identity.crosspost_openbook_to_mastodon
                              ? 'OpenSpace posts will now cross-post to Mastodon.'
                              : 'OpenSpace cross-posting to Mastodon is now off.',
                          )
                        }
                        style={[
                          styles.toggleRow,
                          { borderColor: c.border, backgroundColor: c.surface, opacity: actionsUnlocked ? 1 : 0.55 },
                        ]}
                      >
                        <View style={styles.toggleTextWrap}>
                          <Text style={[styles.toggleTitle, { color: c.textPrimary }]}>Cross-post OpenSpace to Mastodon</Text>
                          <Text style={[styles.toggleBody, { color: c.textMuted }]}>Share your OpenSpace posts outward while you keep building here.</Text>
                        </View>
                        <View
                          style={[
                            styles.togglePill,
                            {
                              backgroundColor: identity.crosspost_openbook_to_mastodon ? c.primary : `${c.border}88`,
                            },
                          ]}
                        >
                          <Text style={styles.togglePillText}>{identity.crosspost_openbook_to_mastodon ? 'On' : 'Off'}</Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={0.85}
                        disabled={isSettingsBusy || !actionsUnlocked}
                        onPress={() =>
                          void handleSaveIdentitySettings(
                            identity.id,
                            { crosspost_mastodon_to_openbook: !identity.crosspost_mastodon_to_openbook },
                            !identity.crosspost_mastodon_to_openbook
                              ? 'Mastodon mirroring into OpenSpace is now on.'
                              : 'Mastodon mirroring into OpenSpace is now off.',
                          )
                        }
                        style={[
                          styles.toggleRow,
                          { borderColor: c.border, backgroundColor: c.surface, opacity: actionsUnlocked ? 1 : 0.55 },
                        ]}
                      >
                        <View style={styles.toggleTextWrap}>
                          <Text style={[styles.toggleTitle, { color: c.textPrimary }]}>Mirror Mastodon content into OpenSpace</Text>
                          <Text style={[styles.toggleBody, { color: c.textMuted }]}>Keep selected activity visible in OpenSpace while you transition your audience.</Text>
                        </View>
                        <View
                          style={[
                            styles.togglePill,
                            {
                              backgroundColor: identity.crosspost_mastodon_to_openbook ? c.primary : `${c.border}88`,
                            },
                          ]}
                        >
                          <Text style={styles.togglePillText}>{identity.crosspost_mastodon_to_openbook ? 'On' : 'Off'}</Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                      </View>

                      <View style={[styles.stepCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                    <Text style={[styles.stepTitle, { color: c.textPrimary }]}>4. Customize your federated note</Text>
                    <Text style={[styles.stepBody, { color: c.textSecondary }]}>
                      Give visitors a clear explanation of how this OpenSpace account relates to your Mastodon identity.
                    </Text>
                    <TextInput
                      multiline
                      value={noteDraft}
                      onChangeText={(value) => setNoteDrafts((current) => ({ ...current, [identity.id]: value }))}
                      editable={!isSettingsBusy && actionsUnlocked}
                      placeholder="Verified linked Mastodon identity, migration note, or cross-post guidance"
                      placeholderTextColor={c.textMuted}
                      style={[
                        styles.noteInput,
                        {
                          color: c.textPrimary,
                          borderColor: c.border,
                          backgroundColor: c.surface,
                        },
                      ]}
                    />
                    <View style={styles.stepActions}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        disabled={isSettingsBusy || !actionsUnlocked}
                        onPress={() =>
                          void handleSaveIdentitySettings(
                            identity.id,
                            { profile_note: noteDraft.trim() || null },
                            'Updated your fediverse profile note.',
                          )
                        }
                        style={[styles.primaryAction, { backgroundColor: c.primary, opacity: isSettingsBusy || !actionsUnlocked ? 0.6 : 1 }]}
                      >
                        {isSettingsBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryActionText}>Save note</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        disabled={!!jobBusyKey || !actionsUnlocked}
                        onPress={() =>
                          void handleRunIdentityJob(
                            identity.id,
                            'migration-notice',
                            () => api.createFederatedMigrationNotice(token!, identity.id),
                            'Queued a migration notice job for this identity.',
                          )
                        }
                        style={[
                          styles.secondaryAction,
                          { borderColor: c.border, backgroundColor: c.surface, opacity: actionsUnlocked ? 1 : 0.55 },
                        ]}
                      >
                        {migrationNoticeBusy ? <ActivityIndicator size="small" color={c.primary} /> : <Text style={[styles.secondaryActionText, { color: c.textPrimary }]}>Prepare migration notice</Text>}
                      </TouchableOpacity>
                    </View>
                      </View>

                      <View style={[styles.stepCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                    <Text style={[styles.stepTitle, { color: c.textPrimary }]}>Recent migration activity</Text>
                    {identity.recent_jobs && identity.recent_jobs.length > 0 ? (
                      <View style={styles.jobList}>
                        {identity.recent_jobs.map((job) => (
                          <View key={`job-${job.id}`} style={[styles.jobRow, { borderColor: c.border }]}>
                            <View style={styles.jobMeta}>
                              <Text style={[styles.jobTitle, { color: c.textPrimary }]}>{jobTitle(job)}</Text>
                              <Text style={[styles.jobSubtitle, { color: c.textMuted }]}>
                                {formatDate(job.updated_at) || 'Recently updated'}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.badge,
                                {
                                  backgroundColor:
                                    job.status === 'completed'
                                      ? '#DCFCE7'
                                      : job.status === 'failed'
                                        ? '#FEE2E2'
                                        : `${c.primary}16`,
                                  borderColor:
                                    job.status === 'completed'
                                      ? '#86EFAC'
                                      : job.status === 'failed'
                                        ? '#FCA5A5'
                                        : `${c.primary}33`,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.badgeText,
                                  {
                                    color:
                                      job.status === 'completed'
                                        ? '#166534'
                                        : job.status === 'failed'
                                          ? '#991B1B'
                                          : c.primary,
                                  },
                                ]}
                              >
                                {job.status}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={[styles.stepBody, { color: c.textMuted }]}>
                        No migration jobs have run for this identity yet.
                      </Text>
                    )}
                      </View>
                    </View>
                  </ScrollView>
                </View>
              );
          })() : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 120,
    gap: 14,
  },
  heroCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 14,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextWrap: { flex: 1, gap: 6 },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
  },
  heroBody: {
    fontSize: 15,
    lineHeight: 22,
  },
  heroPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heroPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  nestedDrawerPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    borderLeftWidth: 1,
  },
  nestedDrawerHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nestedDrawerHeaderText: {
    flex: 1,
    gap: 3,
  },
  nestedDrawerEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  nestedDrawerTitle: {
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 26,
  },
  nestedDrawerSubtitle: {
    fontSize: 13,
  },
  nestedDrawerContent: {
    padding: 16,
    paddingBottom: 120,
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
    gap: 12,
  },
  workspacePreviewList: {
    gap: 12,
  },
  workspacePreviewCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  workspacePreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  workspacePreviewText: {
    flex: 1,
    gap: 3,
  },
  workspacePreviewTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  workspacePreviewSubtitle: {
    fontSize: 12,
  },
  workspacePreviewBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  workspacePreviewBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  workspacePreviewFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  workspacePreviewAction: {
    fontSize: 13,
    fontWeight: '800',
  },
  archivedNote: {
    fontSize: 12,
    lineHeight: 18,
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  sectionHeaderInline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sectionHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  providerList: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderRadius: 14,
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
  mastodonAccountsList: {
    gap: 10,
  },
  mastodonAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  mastodonInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  mastodonButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mastodonButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  identityCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  workspaceNotice: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  workspaceNoticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  identityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  identityHeaderText: {
    flex: 1,
    gap: 4,
  },
  identityHandle: {
    fontSize: 20,
    fontWeight: '800',
  },
  identitySubhead: {
    fontSize: 13,
  },
  identityBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  identityBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  lockNotice: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  lockNoticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  stepCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  stepBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  verificationList: {
    gap: 6,
  },
  verificationItem: {
    fontSize: 13,
    lineHeight: 18,
  },
  stepMeta: {
    fontSize: 12,
  },
  actionGrid: {
    gap: 10,
  },
  secondaryAction: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  toggleList: {
    gap: 10,
  },
  toggleRow: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleTextWrap: {
    flex: 1,
    gap: 4,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  toggleBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  togglePill: {
    minWidth: 48,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  togglePillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 92,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  stepActions: {
    gap: 10,
  },
  primaryAction: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  jobList: {
    gap: 10,
  },
  jobRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  jobMeta: {
    flex: 1,
    gap: 3,
  },
  jobTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  jobSubtitle: {
    fontSize: 12,
  },
  emptyMigrationCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
});
