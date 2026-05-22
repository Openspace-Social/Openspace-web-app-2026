/**
 * FeedHeader — custom stack header that mirrors the mobile-web top nav.
 *
 * Just a search pill across the row; the user's avatar moved to the
 * bottom Profile tab so the search has the full width to itself.
 *
 * Scroll-driven auto-hide: subscribes to ChromeVisibilityContext's
 * shared Animated.Value (0 = visible, 1 = hidden) and translates itself
 * upward off-screen by its own measured height. The Feed screen drives
 * the value via `useChromeScrollHandler()` so scrolling the feed down
 * tucks the header out of the way; scrolling back up reveals it.
 */

import React, { useState } from 'react';
import { Animated, View, Text, TouchableOpacity, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { useChromeVisibility } from '../context/ChromeVisibilityContext';

export default function FeedHeader() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const c = theme.colors;
  const { hidden } = useChromeVisibility();
  const [headerHeight, setHeaderHeight] = useState(0);

  const handleLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    if (next > 0 && next !== headerHeight) setHeaderHeight(next);
  };

  const openSearch = () => {
    // Search modal lives on the root stack; navigate up out of the tabs.
    (navigation.getParent()?.getParent?.() ?? navigation.getParent())?.navigate('Search' as never);
  };

  const openSettings = () => {
    // Settings lives in the ProfileTab's stack — jump from this stack up to
    // the bottom-tab navigator, then into ProfileTab > Settings.
    navigation.getParent()?.navigate('ProfileTab' as never, { screen: 'Settings' } as never);
  };

  // Negative top-margin pulls the header up *out of layout* as `hidden`
  // ramps 0 → 1 — so the screen below grows into the freed slot instead
  // of leaving a transparent gap where the header used to be. Until we
  // have a measured height, keep marginTop at 0 so the header doesn't
  // start collapsed on first paint.
  const marginTop = headerHeight > 0
    ? hidden.interpolate({ inputRange: [0, 1], outputRange: [0, -headerHeight] })
    : 0;

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[
        styles.headerWrap,
        {
          backgroundColor: c.surface,
          borderBottomColor: c.border,
          marginTop,
        },
      ]}
    >
      <View style={styles.topNav}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={openSearch}
          style={[styles.searchPill, { backgroundColor: c.inputBackground, borderColor: c.border }]}
          accessibilityLabel={t('home.searchPlaceholder', { defaultValue: 'Search Openspace' })}
        >
          <MaterialCommunityIcons name="magnify" size={18} color={c.textMuted} />
          <Text style={[styles.searchInput, { color: c.placeholder || c.textMuted }]}>
            {t('home.searchPlaceholder', { defaultValue: 'Search Openspace' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={openSettings}
          style={[styles.iconButton, { backgroundColor: c.inputBackground, borderColor: c.border }]}
          accessibilityRole="button"
          accessibilityLabel={t('home.sideMenuSettings', { defaultValue: 'Settings' })}
        >
          <MaterialCommunityIcons name="cog-outline" size={20} color={c.textSecondary} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    borderBottomWidth: 1,
  },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  iconButton: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
