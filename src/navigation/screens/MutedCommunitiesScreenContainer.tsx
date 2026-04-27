import React, { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import MutedCommunitiesScreen from '../../screens/MutedCommunitiesScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';

export default function MutedCommunitiesScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const navigation = useNavigation<any>();

  const handleNotice = useCallback((msg: string) => showToast(msg), [showToast]);
  const handleOpenCommunity = useCallback((name: string) => {
    navigation.navigate('Community', { name });
  }, [navigation]);

  if (!token) return null;

  return (
    <MutedCommunitiesScreen
      token={token}
      c={theme.colors}
      t={t}
      onNotice={handleNotice}
      onOpenCommunity={handleOpenCommunity}
    />
  );
}
