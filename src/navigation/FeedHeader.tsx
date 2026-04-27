/**
 * FeedHeader — custom stack header that mirrors the mobile-web top nav.
 *
 * Just a search pill across the row; the user's avatar moved to the
 * bottom Profile tab so the search has the full width to itself.
 *
 * Phase shortcuts still in place:
 *   - No scroll-driven auto-hide (mobile-web's Animated.View translate
 *     trick is a bigger lift and not needed for visual parity).
 *   - Search focus shows a placeholder toast; dropdown wiring pending.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';

export default function FeedHeader() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const c = theme.colors;

  const openSearch = () => {
    // Search modal lives on the root stack; navigate up out of the tabs.
    (navigation.getParent()?.getParent?.() ?? navigation.getParent())?.navigate('Search' as never);
  };

  return (
    <View
      style={[
        styles.headerWrap,
        {
          backgroundColor: c.surface,
          borderBottomColor: c.border,
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    borderBottomWidth: 1,
  },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
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
});
