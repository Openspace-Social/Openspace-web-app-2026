import React, { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import SearchScreen from '../../screens/SearchScreen';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';

export default function SearchScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const onClose = useCallback(() => navigation.goBack(), [navigation]);

  const onOpenProfile = useCallback((username: string) => {
    navigation.navigate('Main', {
      screen: 'HomeTab',
      params: { screen: 'Profile', params: { username } },
    });
  }, [navigation]);

  const onOpenCommunity = useCallback((name: string) => {
    navigation.navigate('Main', {
      screen: 'HomeTab',
      params: { screen: 'Community', params: { name } },
    });
  }, [navigation]);

  const onOpenHashtag = useCallback((name: string) => {
    navigation.navigate('Main', {
      screen: 'HomeTab',
      params: { screen: 'Hashtag', params: { name } },
    });
  }, [navigation]);

  const onShowAll = useCallback((kind: 'people' | 'communities' | 'hashtags', query: string) => {
    navigation.navigate('Main', {
      screen: 'HomeTab',
      params: { screen: 'SearchResults', params: { kind, query } },
    });
  }, [navigation]);

  if (!token) return null;

  return (
    <SearchScreen
      token={token}
      c={theme.colors}
      t={t}
      onClose={onClose}
      onOpenProfile={onOpenProfile}
      onOpenCommunity={onOpenCommunity}
      onOpenHashtag={onOpenHashtag}
      onShowAll={onShowAll}
    />
  );
}
