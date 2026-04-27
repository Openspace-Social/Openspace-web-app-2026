/**
 * CustomTabBar — react-navigation adapter that renders the legacy
 * BottomTabBar component (same visual as web mobile) inside the new
 * Tabs.Navigator.
 *
 * Translates react-navigation's BottomTabBarProps (state / descriptors /
 * navigation) into the legacy component's callback-based interface, routes
 * the center "+" FAB to the composer, and opens the ProfileMenuDrawer
 * when the avatar tab is tapped (matches mobile-web behavior).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import BottomTabBar, { type BottomTab } from '../components/BottomTabBar';
import ProfileMenuDrawer from '../components/ProfileMenuDrawer';
import InviteDrawer from '../components/InviteDrawer';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationsContext';
import { api } from '../api/client';

const TAB_ROUTE_TO_LEGACY: Record<string, BottomTab> = {
  HomeTab: 'home',
  CommunitiesTab: 'communities',
  AlertsTab: 'notifications',
  ProfileTab: 'profile',
};

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { token } = useAuth();
  const { unreadCount } = useNotifications();

  const currentRoute = state.routes[state.index];
  const activeTab = TAB_ROUTE_TO_LEGACY[currentRoute.name] ?? null;

  // Current-user fetch — used for the Profile tab avatar AND the menu
  // drawer's header. Scoped to this component until a shared
  // CurrentUserContext lands.
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [username, setUsername] = useState<string | undefined>(undefined);
  const [displayName, setDisplayName] = useState<string | undefined>(undefined);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [pendingModerationCount, setPendingModerationCount] = useState<number>(0);
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try {
        const u: any = await api.getAuthenticatedUser(token);
        if (!active) return;
        setAvatarUri(u?.profile?.avatar || null);
        setUsername(u?.username || undefined);
        setDisplayName(u?.profile?.name || undefined);
        setIsSuperuser(!!u?.is_superuser);
        const pc = u?.pending_communities_moderated_objects_count;
        setPendingModerationCount(typeof pc === 'number' ? pc : 0);
      } catch {
        // non-fatal — fall back to the generic icon.
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const goTo = useCallback(
    (routeName: string) => {
      const event = navigation.emit({
        type: 'tabPress',
        target: routeName,
        canPreventDefault: true,
      });
      if (!event.defaultPrevented) {
        navigation.navigate(routeName as never);
      }
    },
    [navigation],
  );

  // The Profile tab no longer switches tabs — instead it opens the
  // drawer. Active state on the tab stays tied to whatever the user was
  // on previously, so the bar doesn't flash "active" while the drawer
  // animates in.
  const onProfileTabPress = useCallback(() => {
    setMenuOpen(true);
  }, []);

  // react-navigation's bottom-tabs already wraps the custom tabBar in a
  // safe-area-aware container, so we don't add paddingBottom here.
  return (
    <View>
      <BottomTabBar
        c={theme.colors}
        t={t}
        activeTab={activeTab}
        unreadNotifications={unreadCount}
        avatarUri={avatarUri}
        avatarLetter={username?.slice(0, 1)}
        onNavigateHome={() => goTo('HomeTab')}
        onNavigateCommunities={() => goTo('CommunitiesTab')}
        onOpenComposer={() => navigation.getParent()?.navigate('PostComposer' as never)}
        onOpenNotifications={() => goTo('AlertsTab')}
        onNavigateProfile={onProfileTabPress}
      />
      <ProfileMenuDrawer
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenInvites={() => setInviteOpen(true)}
        navigation={navigation}
        username={username}
        displayName={displayName}
        avatarUri={avatarUri}
        isSuperuser={isSuperuser}
        pendingModerationCount={pendingModerationCount}
      />
      {token ? (
        <InviteDrawer
          visible={inviteOpen}
          token={token}
          inviterName={displayName || username}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}
    </View>
  );
}
