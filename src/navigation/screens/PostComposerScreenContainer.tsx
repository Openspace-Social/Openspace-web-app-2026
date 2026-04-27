import React, { useCallback } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import PostComposerScreen from '../../screens/PostComposerScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import type { RootStackParamList } from '../AppNavigator';

export default function PostComposerScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'PostComposer'>>();
  const sharedPost = route.params?.sharedPost;

  const handleNotice = useCallback((msg: string) => showToast(msg, { type: 'success' }), [showToast]);
  const handleError = useCallback((msg: string) => showToast(msg, { type: 'error' }), [showToast]);

  if (!token) return null;

  return (
    <PostComposerScreen
      token={token}
      c={theme.colors}
      t={t}
      sharedPost={sharedPost}
      onClose={() => navigation.goBack()}
      onPosted={() => navigation.goBack()}
      onNotice={handleNotice}
      onError={handleError}
    />
  );
}
