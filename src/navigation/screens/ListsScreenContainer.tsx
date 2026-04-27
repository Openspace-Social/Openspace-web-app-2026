import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ListsScreen from '../../screens/ListsScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';

export default function ListsScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const handleNotice = useCallback((msg: string) => showToast(msg), [showToast]);
  if (!token) return null;
  return <ListsScreen token={token} c={theme.colors} t={t} onNotice={handleNotice} />;
}
