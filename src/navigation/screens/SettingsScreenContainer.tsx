/**
 * SettingsScreenContainer — the navigator-side wrapper for SettingsScreen.
 *
 * Pilot migration (first real route moved onto react-navigation). Responsibilities:
 *   - Pull `token` + `onLogout` from AuthContext instead of prop-drilling.
 *   - Fetch user data (email + has_usable_password) once on mount — HomeScreen
 *     used to hand these in directly; the navigator-side screens are
 *     self-sufficient.
 *   - Wrap the api.* calls with the context token.
 *   - Route side-effects via useNavigation for things like "open blocked users".
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import SettingsScreen from '../../screens/SettingsScreen';
import EditProfileModal, { type ProfileVisibility } from '../../components/EditProfileModal';
import { api, type UserNotificationSettings } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';

const AUTO_PLAY_MEDIA_SETTING_KEY = '@openspace/auto_play_media';

export default function SettingsScreenContainer() {
  const { token, onLogout, onTokenRefresh } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const navigation = useNavigation<any>();

  const [currentEmail, setCurrentEmail] = useState<string | undefined>(undefined);
  const [hasUsablePassword, setHasUsablePassword] = useState<boolean>(true);
  const [requiresCurrentPassword, setRequiresCurrentPassword] = useState<boolean>(true);
  const [autoPlayMedia, setAutoPlayMedia] = useState<boolean>(false);
  const [federationSummary, setFederationSummary] = useState<any>(null);
  const [profileData, setProfileData] = useState<{
    name?: string;
    bio?: string;
    location?: string;
    url?: string;
    followersCountVisible: boolean;
    communityPostsVisible: boolean;
    profileVisibility: ProfileVisibility;
  }>({
    followersCountVisible: true,
    communityPostsVisible: true,
    profileVisibility: 'P',
  });
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  const refreshAuthenticatedUser = useCallback(async () => {
    if (!token) return;
    try {
      // Settings screen is the only navigation surface in the user-facing
      // settings flow that reads federation_summary, so opt in here. The
      // /api/auth/user/ default is null to keep cold app start fast — see
      // OpenSpace-API commit 02f866d for the rationale.
      const user: any = await api.getAuthenticatedUser(token, { includeFederationSummary: true });
      setCurrentEmail(user?.email ?? undefined);
      setHasUsablePassword(user?.has_usable_password !== false);
      setRequiresCurrentPassword(user?.requires_current_password !== false);
      setFederationSummary(user?.federation_summary ?? null);
      const visibility = user?.visibility;
      setProfileData({
        name: user?.profile?.name,
        bio: user?.profile?.bio,
        location: user?.profile?.location,
        url: user?.profile?.url,
        followersCountVisible: user?.followers_count_visible !== false,
        communityPostsVisible: user?.community_posts_visible !== false,
        profileVisibility: visibility === 'O' || visibility === 'T' ? visibility : 'P',
      });
    } catch {
      // Leave defaults — Settings still renders, just without populated fields.
    }
  }, [token]);

  // Load user data + persisted autoplay preference on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(AUTO_PLAY_MEDIA_SETTING_KEY);
        if (active && stored !== null) setAutoPlayMedia(stored === '1');
      } catch {
        // Keep default on read failure.
      }
    })();
    if (!token) return () => { active = false; };
    void refreshAuthenticatedUser();
    return () => { active = false; };
  }, [token, refreshAuthenticatedUser]);

  const saveProfileFields = useCallback(
    async (next: {
      name: string;
      bio: string;
      location: string;
      url: string;
      followersCountVisible: boolean;
      communityPostsVisible: boolean;
      profileVisibility: ProfileVisibility;
    }) => {
      if (!token) return;
      await api.updateAuthenticatedUser(token, {
        name: next.name,
        bio: next.bio,
        location: next.location,
        url: next.url,
        followers_count_visible: next.followersCountVisible,
        community_posts_visible: next.communityPostsVisible,
        visibility: next.profileVisibility,
      });
      await refreshAuthenticatedUser();
      showToast(
        t('home.profileUpdated', { defaultValue: 'Profile updated' }),
        { type: 'success' },
      );
    },
    [token, refreshAuthenticatedUser, showToast, t],
  );

  const toggleAutoPlayMedia = useCallback(() => {
    const next = !autoPlayMedia;
    setAutoPlayMedia(next);
    AsyncStorage.setItem(AUTO_PLAY_MEDIA_SETTING_KEY, next ? '1' : '0').catch(() => {});
  }, [autoPlayMedia]);

  const changePassword = useCallback(async (current: string | null, next: string) => {
    if (!token) throw new Error('Not authenticated');
    const payload: { current_password?: string; new_password: string } = { new_password: next };
    if (current && current.trim()) payload.current_password = current;
    const response: any = await api.updateAuthenticatedUserSettings(token, payload);
    const refreshed = response && typeof response === 'object' && typeof response.token === 'string' && response.token.trim()
      ? response.token.trim()
      : null;
    if (refreshed) await onTokenRefresh(refreshed);
    if (!current || !current.trim()) setHasUsablePassword(true);
  }, [token, onTokenRefresh]);

  const requestEmailChange = useCallback(async (newEmail: string, currentPassword: string) => {
    if (!token) throw new Error('Not authenticated');
    await api.updateAuthenticatedUserSettings(token, { email: newEmail, current_password: currentPassword });
  }, [token]);

  const confirmEmailChange = useCallback(async (tokenOrCode: string): Promise<string> => {
    if (!token) throw new Error('Not authenticated');
    const message = await api.verifyEmailChangeToken(token, tokenOrCode);
    const refreshed: any = await api.getAuthenticatedUser(token);
    setCurrentEmail(refreshed?.email ?? undefined);
    return message;
  }, [token]);

  const getNotificationSettings = useCallback(async (): Promise<UserNotificationSettings> => {
    if (!token) throw new Error('Not authenticated');
    return api.getNotificationSettings(token);
  }, [token]);

  const updateNotificationSettings = useCallback(async (patch: Partial<UserNotificationSettings>): Promise<UserNotificationSettings> => {
    if (!token) throw new Error('Not authenticated');
    return api.updateNotificationSettings(token, patch);
  }, [token]);

  const handleDeleteAccount = useCallback(() => {
    // The inner SettingsScreen component confirms before calling this — at
    // this point we simply sign the user out. Full account deletion flow
    // with password prompt lives inside SettingsScreen itself.
    void onLogout();
  }, [onLogout]);

  const handleOpenBlockedUsers = useCallback(() => {
    navigation.navigate('Blocked');
  }, [navigation]);

  const handleOpenLinkedAccounts = useCallback(() => {
    navigation.navigate('LinkedAccounts');
  }, [navigation]);

  const handleOpenEmailPreferences = useCallback(() => {
    navigation.navigate('EmailPreferences');
  }, [navigation]);

  const handleOpenFederation = useCallback(() => {
    navigation.navigate('FederationSummary');
  }, [navigation]);

  const handleNotice = useCallback((message: string) => {
    showToast(message);
  }, [showToast]);

  return (
    <>
      <SettingsScreen
        c={theme.colors}
        t={t}
        showHeader={false}
        token={token || undefined}
        currentEmail={currentEmail}
        hasUsablePassword={hasUsablePassword}
        requiresCurrentPassword={requiresCurrentPassword}
        autoPlayMedia={autoPlayMedia}
        federationSummary={federationSummary}
        onToggleAutoPlayMedia={toggleAutoPlayMedia}
        onOpenLinkedAccounts={handleOpenLinkedAccounts}
        onOpenEmailPreferences={handleOpenEmailPreferences}
        onOpenFederation={handleOpenFederation}
        onOpenBlockedUsers={handleOpenBlockedUsers}
        onOpenEditProfile={() => setEditProfileOpen(true)}
        onNotice={handleNotice}
        onChangePassword={changePassword}
        onRequestEmailChange={requestEmailChange}
        onConfirmEmailChange={confirmEmailChange}
        onGetNotificationSettings={getNotificationSettings}
        onUpdateNotificationSettings={updateNotificationSettings}
        onDeleteAccount={handleDeleteAccount}
        onLogout={onLogout}
      />
      <EditProfileModal
        visible={editProfileOpen}
        onClose={() => setEditProfileOpen(false)}
        initial={profileData}
        onSave={saveProfileFields}
      />
    </>
  );
}
