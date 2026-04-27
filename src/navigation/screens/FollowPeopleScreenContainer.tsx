/**
 * FollowPeopleScreenContainer — one underlying component, three nav entries
 * (Followers / Following / Blocked). Mode is hardcoded per-wrapper; this keeps
 * each route-screen parameter-free and deep-linkable.
 */

import React, { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import FollowPeopleScreen from '../../screens/FollowPeopleScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';

function Base({ mode }: { mode: 'followers' | 'following' | 'blocked' }) {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const navigation = useNavigation<any>();

  const handleNotice = useCallback((msg: string) => showToast(msg), [showToast]);
  const handleOpenProfile = useCallback((username: string) => {
    navigation.navigate('Profile', { username });
  }, [navigation]);

  if (!token) return null;

  return (
    <FollowPeopleScreen
      mode={mode}
      token={token}
      c={theme.colors}
      t={t}
      onNotice={handleNotice}
      onOpenProfile={handleOpenProfile}
    />
  );
}

export function FollowersScreenContainer() {
  return <Base mode="followers" />;
}

export function FollowingScreenContainer() {
  return <Base mode="following" />;
}

export function BlockedScreenContainer() {
  return <Base mode="blocked" />;
}
