import React, { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import ManageCommunitiesScreen from '../../screens/ManageCommunitiesScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';

export default function ManageCommunitiesScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const navigation = useNavigation<any>();

  const handleNotice = useCallback((msg: string) => showToast(msg), [showToast]);
  const handleOpenCommunity = useCallback((name: string) => {
    navigation.navigate('Community', { name });
  }, [navigation]);
  const handleOpenManageCommunity = useCallback((name: string) => {
    if (!name) return;
    navigation.navigate('ManageCommunity', { name });
  }, [navigation]);

  if (!token) return null;

  return (
    <ManageCommunitiesScreen
      token={token}
      c={theme.colors}
      t={t}
      onNotice={handleNotice}
      onOpenCommunity={handleOpenCommunity}
      onOpenManageCommunity={handleOpenManageCommunity}
    />
  );
}
