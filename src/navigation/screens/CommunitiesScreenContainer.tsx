/**
 * CommunitiesScreenContainer — wraps CommunitiesScreen for the navigator.
 *
 * CommunitiesScreen only needs 5 props — much easier to migrate than Feed.
 * The community list itself is self-fetched via api inside the component.
 */

import React, { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import CommunitiesScreen from '../../screens/CommunitiesScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import type { CommunitiesStackParamList } from '../AppNavigator';

export default function CommunitiesScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const navigation = useNavigation<NativeStackNavigationProp<CommunitiesStackParamList, 'CommunitiesList'>>();

  const handleOpenCommunity = useCallback((name: string) => {
    navigation.navigate('Community', { name });
  }, [navigation]);

  const handleNotice = useCallback((msg: string) => {
    showToast(msg);
  }, [showToast]);

  if (!token) return null;

  return (
    <CommunitiesScreen
      token={token}
      c={theme.colors}
      t={t}
      onNotice={handleNotice}
      onOpenCommunity={handleOpenCommunity}
    />
  );
}
