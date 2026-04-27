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
    (async () => {
      try {
        const user: any = await api.getAuthenticatedUser(token);
        if (!active) return;
        setCurrentEmail(user?.email ?? undefined);
        setHasUsablePassword(user?.has_usable_password !== false);
        setRequiresCurrentPassword(user?.requires_current_password !== false);
      } catch {
        // Leave defaults — Settings still renders, just without populated fields.
      }
    })();
    return () => { active = false; };
  }, [token]);

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
    // Linked accounts still lives in the legacy HomeScreen drawer — surface
    // a notice until it migrates. Temporary.
    showToast(t('settings.linkedAccountsComingSoon', { defaultValue: 'Linked accounts will return soon in the new navigator.' }));
  }, [showToast, t]);

  const handleNotice = useCallback((message: string) => {
    showToast(message);
  }, [showToast]);

  return (
    <SettingsScreen
      c={theme.colors}
      t={t}
      token={token || undefined}
      currentEmail={currentEmail}
      hasUsablePassword={hasUsablePassword}
      requiresCurrentPassword={requiresCurrentPassword}
      autoPlayMedia={autoPlayMedia}
      onToggleAutoPlayMedia={toggleAutoPlayMedia}
      onOpenLinkedAccounts={handleOpenLinkedAccounts}
      onOpenBlockedUsers={handleOpenBlockedUsers}
      onNotice={handleNotice}
      onChangePassword={changePassword}
      onRequestEmailChange={requestEmailChange}
      onConfirmEmailChange={confirmEmailChange}
      onGetNotificationSettings={getNotificationSettings}
      onUpdateNotificationSettings={updateNotificationSettings}
      onDeleteAccount={handleDeleteAccount}
      onLogout={onLogout}
    />
  );
}
