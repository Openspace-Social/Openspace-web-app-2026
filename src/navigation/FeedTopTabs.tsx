/**
 * FeedTopTabs — material-top-tabs navigator for the four feed types.
 *
 * Replaces the previous "single FeedScreenContainer + setParams sub-tabs"
 * approach with one screen per feed type and native horizontal swipe
 * (powered by react-native-pager-view). The custom tabBar mirrors the
 * mobile-web FeedSubTabs row visually so nothing changes from the user's
 * point of view except the new gesture.
 */

import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createMaterialTopTabNavigator, type MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import FeedScreenContainer from './screens/FeedScreenContainer';
import type { FeedType } from '../api/client';

export type FeedTopTabParamList = {
  HomeFeed: undefined;
  TrendingFeed: undefined;
  PublicFeed: undefined;
  ExploreFeed: undefined;
};

const TopTabs = createMaterialTopTabNavigator<FeedTopTabParamList>();

type FeedDef = {
  routeName: keyof FeedTopTabParamList;
  feedType: FeedType;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  labelKey: string;
  labelDefault: string;
};

const FEEDS: FeedDef[] = [
  { routeName: 'HomeFeed', feedType: 'home', icon: 'home-variant', labelKey: 'home.feedTabHome', labelDefault: 'Home' },
  { routeName: 'TrendingFeed', feedType: 'trending', icon: 'fire', labelKey: 'home.feedTabTrending', labelDefault: 'Trending' },
  { routeName: 'PublicFeed', feedType: 'public', icon: 'earth', labelKey: 'home.feedTabPublic', labelDefault: 'Public' },
  { routeName: 'ExploreFeed', feedType: 'explore', icon: 'compass-outline', labelKey: 'home.feedTabExplore', labelDefault: 'Explore' },
];

function FeedTopTabBar({ state, navigation }: MaterialTopTabBarProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;
  return (
    <View style={[styles.tabBar, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
      {state.routes.map((route, index) => {
        const isActive = state.index === index;
        const def = FEEDS.find((f) => f.routeName === (route.name as keyof FeedTopTabParamList));
        if (!def) return null;
        const color = isActive ? c.primary : c.textMuted;
        return (
          <TouchableOpacity
            key={route.key}
            activeOpacity={0.75}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!isActive && !event.defaultPrevented) {
                navigation.navigate(route.name as never);
              }
            }}
            style={[styles.tab, { borderBottomColor: isActive ? c.primary : 'transparent' }]}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <MaterialCommunityIcons name={def.icon} size={18} color={color} />
            <Text numberOfLines={1} style={[styles.label, { color }]}>
              {t(def.labelKey, { defaultValue: def.labelDefault })}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Per-route component factories — each renders FeedScreenContainer pinned
// to a specific feed type so material-top-tabs treats each one as its own
// screen (with isolated mount/unmount, scroll state, and loading state).
function makeFeedScreen(feedType: FeedType) {
  const Screen = () => <FeedScreenContainer feedType={feedType} />;
  Screen.displayName = `FeedScreen_${feedType}`;
  return Screen;
}

const HomeFeedScreen = makeFeedScreen('home');
const TrendingFeedScreen = makeFeedScreen('trending');
const PublicFeedScreen = makeFeedScreen('public');
const ExploreFeedScreen = makeFeedScreen('explore');

export default function FeedTopTabs() {
  const renderTabBar = useCallback(
    (props: MaterialTopTabBarProps) => <FeedTopTabBar {...props} />,
    [],
  );
  return (
    <TopTabs.Navigator
      tabBar={renderTabBar}
      screenOptions={{ swipeEnabled: true, lazy: true }}
    >
      <TopTabs.Screen
        name="HomeFeed"
        component={HomeFeedScreen}
        options={{ title: 'Home' }}
      />
      <TopTabs.Screen
        name="TrendingFeed"
        component={TrendingFeedScreen}
        options={{ title: 'Trending' }}
      />
      <TopTabs.Screen
        name="PublicFeed"
        component={PublicFeedScreen}
        options={{ title: 'Public' }}
      />
      <TopTabs.Screen
        name="ExploreFeed"
        component={ExploreFeedScreen}
        options={{ title: 'Explore' }}
      />
    </TopTabs.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
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
