import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ModerationTasksScreen from '../../screens/ModerationTasksScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';

export default function ModerationTasksScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();

  const handleNotice = useCallback((msg: string) => showToast(msg, { type: 'success' }), [showToast]);
  const handleError = useCallback((msg: string) => showToast(msg, { type: 'error' }), [showToast]);

  if (!token) return null;

  return (
    <ModerationTasksScreen
      token={token}
      c={theme.colors}
      t={t}
      onError={handleError}
      onNotice={handleNotice}
    />
  );
}
