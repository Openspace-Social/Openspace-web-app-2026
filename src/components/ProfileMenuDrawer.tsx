/**
 * ProfileMenuDrawer — right-side profile menu shown when the user taps
 * their avatar in the bottom tab bar.
 *
 * Mirrors mobile-web's drawer (HomeScreen.tsx Modal around line 6182):
 *   - Header with avatar, name, handle, and theme toggle
 *   - "My Openspace" section: Profile, Communities, Manage Communities,
 *     Muted Communities, Circles, Lists, Followers, Following, plus stubs
 *     for Invites and Moderation when not yet migrated.
 *   - "App & Account" section: Settings, Linked Accounts, Support.
 *   - Logout at the bottom.
 *
 * Navigation: each item closes the drawer, then routes via react-navigation
 * to the matching screen (Profile/Communities/Settings/etc.). Items whose
 * targets haven't migrated yet show a "coming soon" toast.
 */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useAppToast } from '../toast/AppToastContext';
import { useAuth } from '../context/AuthContext';

const ANIM_MS = 240;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called when the user taps "Invites" — caller owns the InviteDrawer. */
  onOpenInvites?: () => void;
  /** The Tabs navigation passed directly from CustomTabBar — using
   *  useNavigation() from inside the Modal can resolve to the wrong
   *  navigator on some devices, so the caller owns the dispatcher. */
  navigation: any;
  username?: string;
  displayName?: string;
  avatarUri?: string | null;
  /** Show the "Moderation tasks" entry only for moderators / admins. */
  isSuperuser?: boolean;
  /** Pending count surfaced as a red badge on the Moderation tasks row. */
  pendingModerationCount?: number;
};

type MenuItem = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  badge?: number;
};

export default function ProfileMenuDrawer({
  visible,
  onClose,
  onOpenInvites,
  navigation,
  username,
  displayName,
  avatarUri,
  isSuperuser = false,
  pendingModerationCount = 0,
}: Props) {
  const { theme, isDark, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const { onLogout } = useAuth();
  const { width: viewportWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const c = theme.colors;
  const drawerWidth = Math.min(viewportWidth, 360);
  const translateX = useRef(new Animated.Value(drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateX.setValue(drawerWidth);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: ANIM_MS, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: ANIM_MS, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, { toValue: drawerWidth, duration: ANIM_MS, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: ANIM_MS, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, drawerWidth, translateX, backdropOpacity]);

  const goTo = (tab: string, screen?: string, params?: Record<string, unknown>) => {
    onClose();
    setTimeout(() => {
      if (screen) {
        navigation.navigate(tab, { screen, params });
      } else {
        navigation.navigate(tab);
      }
    }, ANIM_MS / 2);
  };

  const stub = (label: string) => {
    onClose();
    showToast(
      t('home.actionComingSoon', { defaultValue: `${label} will return soon.`, action: label }),
    );
  };

  const myOpenspaceItems: MenuItem[] = [
    {
      icon: 'account-outline',
      label: t('home.sideMenuProfile', { defaultValue: 'Profile' }),
      onPress: () => {
        if (username) {
          // Reuse PublicProfileScreenContainer with the logged-in user's
          // username — it already handles all the sections (communities,
          // followings, pinned, posts, comments).
          goTo('ProfileTab', 'Profile', { username });
        } else {
          stub('Profile');
        }
      },
    },
    { icon: 'account-group-outline', label: t('home.sideMenuCommunities', { defaultValue: 'Communities' }), onPress: () => goTo('CommunitiesTab') },
    { icon: 'shield-crown-outline', label: t('home.sideMenuManageCommunities', { defaultValue: 'Manage Communities' }), onPress: () => goTo('ProfileTab', 'ManageCommunities') },
    { icon: 'bell-off-outline', label: t('home.sideMenuMutedCommunities', { defaultValue: 'Muted Communities' }), onPress: () => goTo('ProfileTab', 'MutedCommunities') },
    { icon: 'circle-outline', label: t('home.sideMenuCircles', { defaultValue: 'Circles' }), onPress: () => goTo('ProfileTab', 'Circles') },
    { icon: 'format-list-bulleted', label: t('home.sideMenuLists', { defaultValue: 'Lists' }), onPress: () => goTo('ProfileTab', 'Lists') },
    { icon: 'account-arrow-down-outline', label: t('home.sideMenuFollowers', { defaultValue: 'Followers' }), onPress: () => goTo('ProfileTab', 'Followers') },
    { icon: 'account-arrow-up-outline', label: t('home.sideMenuFollowing', { defaultValue: 'Following' }), onPress: () => goTo('ProfileTab', 'Following') },
    {
      icon: 'email-plus-outline',
      label: t('home.sideMenuInvites', { defaultValue: 'Invites' }),
      onPress: () => {
        onClose();
        if (onOpenInvites) {
          // Wait for the close animation so the invite drawer slides in
          // cleanly after this one slides out.
          setTimeout(() => onOpenInvites(), ANIM_MS / 2);
        }
      },
    },
    // Superuser-only — matches web's conditional drawer entry.
    ...(isSuperuser
      ? ([
          {
            icon: 'shield-check-outline',
            label: t('home.sideMenuModerationTasks', { defaultValue: 'Moderation tasks' }),
            badge: pendingModerationCount > 0 ? pendingModerationCount : undefined,
            onPress: () => goTo('ProfileTab', 'ModerationTasks'),
          },
        ] as MenuItem[])
      : []),
    {
      icon: 'gavel',
      label: t('home.sideMenuModerationPenalties', { defaultValue: 'Moderation penalties' }),
      onPress: () => goTo('ProfileTab', 'ModerationPenalties'),
    },
  ];

  const appAccountItems: MenuItem[] = [
    { icon: 'cog-outline', label: t('home.sideMenuSettings', { defaultValue: 'Settings' }), onPress: () => goTo('ProfileTab', 'Settings') },
    { icon: 'account-cog-outline', label: t('home.linkedAccountsTitle', { defaultValue: 'Linked Accounts' }), onPress: () => goTo('ProfileTab', 'LinkedAccounts') },
    {
      icon: 'email-outline',
      label: t('home.sideMenuContact', { defaultValue: 'Contact' }),
      onPress: () => {
        // Hand off to the user's mail client so the reply-to address is
        // whatever account they choose; the body is pre-seeded with the
        // username for context. The drawer closes after the OS takes over.
        const subject = encodeURIComponent('Openspace Support & Feedback');
        const body = encodeURIComponent(
          username ? `\n\n— @${username}` : '',
        );
        const url = `mailto:admin@openspacelive.com?subject=${subject}&body=${body}`;
        onClose();
        setTimeout(() => {
          Linking.openURL(url).catch(() => {
            showToast(
              t('home.contactMailtoFailed', {
                defaultValue: 'Could not open your mail app. Email admin@openspacelive.com directly.',
              }),
              { type: 'error' },
            );
          });
        }, ANIM_MS / 2);
      },
    },
    {
      icon: 'coffee-outline',
      label: t('home.sideMenuDonate', { defaultValue: 'Donate' }),
      onPress: () => {
        const url = 'https://buymeacoffee.com/openspace.social';
        onClose();
        setTimeout(() => {
          Linking.openURL(url).catch(() => {
            showToast(
              t('home.donateLinkFailed', {
                defaultValue: 'Could not open the donation page.',
              }),
              { type: 'error' },
            );
          });
        }, ANIM_MS / 2);
      },
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            width: drawerWidth,
            backgroundColor: c.surface,
            borderColor: c.border,
            paddingTop: Platform.OS === 'ios' ? insets.top + 8 : insets.top + 8,
            paddingBottom: insets.bottom + 12,
            transform: [{ translateX }],
          },
        ]}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={[styles.avatar, { backgroundColor: c.primary }]}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} resizeMode="cover" />
              ) : (
                <Text style={styles.avatarLetter}>{(username?.[0] || 'O').toUpperCase()}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.username, { color: c.textPrimary }]} numberOfLines={1}>
                {displayName || username || ''}
              </Text>
              {username ? (
                <Text style={[styles.handle, { color: c.textMuted }]} numberOfLines={1}>
                  @{username}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={[styles.themeToggle, { backgroundColor: c.inputBackground }]}
              activeOpacity={0.85}
              onPress={toggleTheme}
              accessibilityLabel={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
            >
              <MaterialCommunityIcons
                name={isDark ? 'weather-sunny' : 'weather-night'}
                size={18}
                color={c.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* MY OPENSPACE */}
          <Text style={[styles.sectionLabel, { color: c.textMuted }]}>
            {t('home.sideMenuSectionMyOpenspace', { defaultValue: 'MY OPENSPACE' })}
          </Text>
          {myOpenspaceItems.map((item) => (
            <MenuRow key={item.label} c={c} item={item} />
          ))}

          {/* APP & ACCOUNT */}
          <Text style={[styles.sectionLabel, { color: c.textMuted, marginTop: 8 }]}>
            {t('home.sideMenuSectionAppAccount', { defaultValue: 'APP & ACCOUNT' })}
          </Text>
          {appAccountItems.map((item) => (
            <MenuRow key={item.label} c={c} item={item} />
          ))}

          {/* Logout */}
          <TouchableOpacity
            style={[styles.logoutBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            activeOpacity={0.75}
            onPress={() => {
              onClose();
              setTimeout(() => onLogout(), ANIM_MS / 2);
            }}
          >
            <MaterialCommunityIcons name="logout" size={18} color={c.errorText || '#dc2626'} />
            <Text style={[styles.logoutText, { color: c.errorText || '#dc2626' }]}>
              {t('auth.signOut', { defaultValue: 'Log out' })}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function MenuRow({ c, item }: { c: any; item: MenuItem }) {
  return (
    <TouchableOpacity
      style={[styles.row, { borderColor: c.border }]}
      activeOpacity={0.75}
      onPress={item.onPress}
    >
      <MaterialCommunityIcons name={item.icon} size={18} color={c.textSecondary} />
      <Text style={[styles.rowText, { color: c.textPrimary }]}>{item.label}</Text>
      {item.badge != null && item.badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{item.badge > 99 ? '99+' : item.badge}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    borderLeftWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: -3, height: 0 },
    shadowRadius: 12,
    elevation: 24,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    marginBottom: 6,
    borderBottomWidth: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarLetter: { color: '#fff', fontSize: 18, fontWeight: '800' },
  username: { fontSize: 15, fontWeight: '700' },
  handle: { fontSize: 12, fontWeight: '500' },
  themeToggle: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 4,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  rowText: { fontSize: 14, fontWeight: '500', flex: 1 },
  badge: {
    backgroundColor: '#dc2626',
    borderRadius: 999,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 10,
    justifyContent: 'center',
  },
  logoutText: { fontSize: 15, fontWeight: '700' },
});
