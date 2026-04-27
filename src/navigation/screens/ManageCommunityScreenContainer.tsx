import React, { useCallback } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import ManageCommunityScreen from '../../screens/ManageCommunityScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import type { ProfileStackParamList } from '../AppNavigator';

export default function ManageCommunityScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const route = useRoute<RouteProp<ProfileStackParamList, 'ManageCommunity'>>();
  const navigation = useNavigation<any>();
  const communityName = route.params?.name;

  const handleNotice = useCallback((msg: string) => showToast(msg, { type: 'success' }), [showToast]);
  const handleError = useCallback((msg: string) => showToast(msg, { type: 'error' }), [showToast]);

  if (!token || !communityName) {
    navigation.goBack();
    return null;
  }

  return (
    <ManageCommunityScreen
      token={token}
      communityName={communityName}
      c={theme.colors}
      t={t}
      onNotice={handleNotice}
      onError={handleError}
    />
  );
}
