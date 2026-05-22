/**
 * ManageCommunityScreenContainer — native route that hosts the shared
 * CommunityManagementDrawer with all 12 management panels (details,
 * members, administrators, moderators, ownership transfer, join requests,
 * banned users, reports, closed posts, invite, unfavorite, delete).
 *
 * Previously this container wrapped a native-only screen that only
 * exposed the Details panel; switching it over to the drawer brings the
 * native app to parity with web. The drawer renders as a Modal that
 * slides in on mount and slides out on dismiss — when the user taps the
 * close button (or onDeleted fires) we navigate back so the modal's
 * close animation maps cleanly to the stack pop.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import CommunityManagementDrawer from '../../components/CommunityManagementDrawer';
import { api, type SearchCommunityResult } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import type { ProfileStackParamList } from '../AppNavigator';

export default function ManageCommunityScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const c = theme.colors;
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const route = useRoute<RouteProp<ProfileStackParamList, 'ManageCommunity'>>();
  const navigation = useNavigation<any>();
  const communityName = route.params?.name;

  const [community, setCommunity] = useState<SearchCommunityResult | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!token || !communityName) return () => { active = false; };
    (async () => {
      try {
        const [communityResult, userResult] = await Promise.all([
          api.getCommunity(token, communityName),
          api.getAuthenticatedUser(token),
        ]);
        if (!active) return;
        setCommunity(communityResult || null);
        setCurrentUserId((userResult as any)?.id);
      } catch (e: any) {
        if (!active) return;
        showToast(
          e?.message || t('community.manageLoadFailed', { defaultValue: 'Could not load community.' }),
          { type: 'error' },
        );
        navigation.goBack();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, communityName, navigation, showToast, t]);

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleUpdated = useCallback((next: SearchCommunityResult) => {
    setCommunity(next);
  }, []);

  const handleDeleted = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleNotice = useCallback((msg: string) => showToast(msg, { type: 'success' }), [showToast]);
  const handleError = useCallback((msg: string) => showToast(msg, { type: 'error' }), [showToast]);

  if (!token || !communityName) {
    return null;
  }

  if (loading || !community) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background }}>
        <ActivityIndicator color={c.primary} size="large" />
      </View>
    );
  }

  return (
    <CommunityManagementDrawer
      // 'page' mode skips the slide-in modal + backdrop wrapper and
      // renders the drawer's content directly into the stack screen.
      // The navigator's own header provides the back button, so the
      // user has an obvious close affordance (the X button inside the
      // drawer is positioned for a side-drawer layout, not a full-page
      // route, and was not discoverable here).
      mode="page"
      visible
      token={token}
      c={c}
      t={t}
      community={community}
      currentUserId={currentUserId}
      onClose={handleClose}
      onUpdated={handleUpdated}
      onDeleted={handleDeleted}
      onNotice={handleNotice}
      onError={handleError}
    />
  );
}
