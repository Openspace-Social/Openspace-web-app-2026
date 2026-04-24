import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type BottomTab = 'home' | 'communities' | 'notifications' | 'profile' | null;

type Props = {
  c: any;
  t: (key: string, options?: any) => string;
  activeTab: BottomTab;
  unreadNotifications: number;
  onNavigateHome: () => void;
  onNavigateCommunities: () => void;
  onOpenComposer: () => void;
  onOpenNotifications: () => void;
  onNavigateProfile: () => void;
};

const BAR_HEIGHT = 56;

export default function BottomTabBar({
  c,
  t,
  activeTab,
  unreadNotifications,
  onNavigateHome,
  onNavigateCommunities,
  onOpenComposer,
  onOpenNotifications,
  onNavigateProfile,
}: Props) {
  const iconColor = (tab: BottomTab) => (activeTab === tab ? c.primary : c.textMuted);
  const labelColor = (tab: BottomTab) => (activeTab === tab ? c.primary : c.textMuted);

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          // env() is web-only; harmless on native since it's cast to any
          ...(Platform.OS === 'web'
            ? ({ paddingBottom: 'env(safe-area-inset-bottom, 0px)' } as any)
            : null),
        },
      ]}
      accessibilityRole={Platform.OS === 'web' ? ('navigation' as any) : undefined}
    >
      <TabButton
        icon="home-variant"
        label={t('nav.tabHome', { defaultValue: 'Home' })}
        active={activeTab === 'home'}
        iconColor={iconColor('home')}
        labelColor={labelColor('home')}
        onPress={onNavigateHome}
      />
      <TabButton
        icon="account-group"
        label={t('nav.tabCommunities', { defaultValue: 'Communities' })}
        active={activeTab === 'communities'}
        iconColor={iconColor('communities')}
        labelColor={labelColor('communities')}
        onPress={onNavigateCommunities}
      />

      {/* Center compose button — visually distinct, always accent */}
      <View style={styles.composeWrap}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('nav.tabCompose', { defaultValue: 'Compose post' })}
          activeOpacity={0.85}
          onPress={onOpenComposer}
          style={[styles.composeBtn, { backgroundColor: c.primary }]}
        >
          <MaterialCommunityIcons name="plus" size={26} color="#fff" />
        </TouchableOpacity>
      </View>

      <TabButton
        icon="bell-outline"
        label={t('nav.tabNotifications', { defaultValue: 'Alerts' })}
        active={activeTab === 'notifications'}
        iconColor={iconColor('notifications')}
        labelColor={labelColor('notifications')}
        onPress={onOpenNotifications}
        badgeCount={unreadNotifications}
        badgeColor={c.errorText || '#dc2626'}
      />
      <TabButton
        icon="account-circle-outline"
        label={t('nav.tabProfile', { defaultValue: 'Profile' })}
        active={activeTab === 'profile'}
        iconColor={iconColor('profile')}
        labelColor={labelColor('profile')}
        onPress={onNavigateProfile}
      />
    </View>
  );
}

function TabButton({
  icon,
  label,
  active,
  iconColor,
  labelColor,
  onPress,
  badgeCount,
  badgeColor,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  active: boolean;
  iconColor: string;
  labelColor: string;
  onPress: () => void;
  badgeCount?: number;
  badgeColor?: string;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      activeOpacity={0.75}
      onPress={onPress}
      style={styles.tabBtn}
    >
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name={icon} size={24} color={iconColor} />
        {badgeCount && badgeCount > 0 ? (
          <View style={[styles.badge, { backgroundColor: badgeColor || '#dc2626' }]}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {badgeCount > 99 ? '99+' : String(badgeCount)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.tabLabel, { color: labelColor }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: BAR_HEIGHT,
    borderTopWidth: 1,
    width: '100%',
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    minHeight: 44,
  },
  iconWrap: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tabLabel: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  composeWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    // subtle lift so it reads as primary action
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
    marginTop: -8,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
