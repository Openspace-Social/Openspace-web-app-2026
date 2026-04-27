/**
 * FeedSubTabs — Home / Trending / Public / Explore pill row that mirrors
 * the mobile-web sub-tab strip (HomeScreen.tsx lines 6132-6179).
 *
 * Active tab gets the primary color + a 2px underline; inactive tabs are
 * muted with a transparent underline. Tapping fires `onSelectFeed` so the
 * surrounding screen can re-fetch for the chosen feed.
 *
 * This is purely presentational — data/routing wiring is the caller's
 * responsibility.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';

export type FeedKey = 'home' | 'trending' | 'public' | 'explore';

type FeedTabDef = {
  key: FeedKey;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  labelKey: string;
  labelDefault: string;
};

const FEED_TABS: FeedTabDef[] = [
  { key: 'home', icon: 'home-variant', labelKey: 'home.feedTabHome', labelDefault: 'Home' },
  { key: 'trending', icon: 'fire', labelKey: 'home.feedTabTrending', labelDefault: 'Trending' },
  { key: 'public', icon: 'earth', labelKey: 'home.feedTabPublic', labelDefault: 'Public' },
  { key: 'explore', icon: 'compass-outline', labelKey: 'home.feedTabExplore', labelDefault: 'Explore' },
];

type Props = {
  activeFeed: FeedKey;
  onSelectFeed: (feed: FeedKey) => void;
};

export default function FeedSubTabs({ activeFeed, onSelectFeed }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: c.surface, borderBottomColor: c.border },
      ]}
    >
      {FEED_TABS.map((tab) => {
        const isActive = activeFeed === tab.key;
        const color = isActive ? c.primary : c.textMuted;
        return (
          <TouchableOpacity
            key={tab.key}
            activeOpacity={0.75}
            onPress={() => onSelectFeed(tab.key)}
            style={[
              styles.tab,
              { borderBottomColor: isActive ? c.primary : 'transparent' },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <MaterialCommunityIcons name={tab.icon} size={18} color={color} />
            <Text
              numberOfLines={1}
              style={[styles.label, { color }]}
            >
              {t(tab.labelKey, { defaultValue: tab.labelDefault })}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderBottomWidth: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
});
