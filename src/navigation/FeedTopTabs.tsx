/**
 * FeedTopTabs — material-top-tabs navigator for the four feed types.
 *
 * Replaces the previous "single FeedScreenContainer + setParams sub-tabs"
 * approach with one screen per feed type and native horizontal swipe
 * (powered by react-native-pager-view). The custom tabBar mirrors the
 * mobile-web FeedSubTabs row visually so nothing changes from the user's
 * point of view except the new gesture.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { createMaterialTopTabNavigator, type MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import FeedScreenContainer from './screens/FeedScreenContainer';
import MastodonFeedScreenContainer from './screens/MastodonFeedScreenContainer';
import type { FeedType } from '../api/client';

export type FeedTopTabParamList = {
  HomeFeed: undefined;
  TrendingFeed: undefined;
  PublicFeed: undefined;
  ExploreFeed: undefined;
  MastodonFeed: undefined;
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
  { routeName: 'MastodonFeed', feedType: 'mastodon', icon: 'mastodon', labelKey: 'home.feedTabMastodon', labelDefault: 'Mastodon' },
];

// How often the bar peeks to hint at offscreen tabs, and how long it
// stays peeked before sliding back. Tuned so it's noticeable but not
// distracting during normal feed scrolling.
const PEEK_INTERVAL_MS = 90_000; // 1.5 minutes
const PEEK_HOLD_MS = 700;
const PEEK_DISTANCE_PX = 44;
// Don't peek if the user has interacted with the bar recently — we
// don't want to fight an in-progress scroll.
const PEEK_USER_QUIET_MS = 20_000;

function FeedTopTabBar({ state, navigation }: MaterialTopTabBarProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;

  // Track each tab's measured x/width so we can auto-scroll the bar to
  // bring the active tab into view when the user swipes the underlying
  // pager (or taps a tab that's clipped offscreen).
  const scrollViewRef = useRef<ScrollView>(null);
  const tabLayoutsRef = useRef<Record<string, { x: number; width: number }>>({});
  const containerWidthRef = useRef(0);
  // Bookkeeping for the peek animation below.
  const contentWidthRef = useRef(0);
  const scrollXRef = useRef(0);
  const lastUserScrollAtRef = useRef(0);

  useEffect(() => {
    const activeRoute = state.routes[state.index];
    if (!activeRoute) return;
    const layout = tabLayoutsRef.current[activeRoute.key];
    const containerWidth = containerWidthRef.current;
    if (!layout || !scrollViewRef.current || containerWidth <= 0) return;
    // Centre the active tab in the visible area, clamped at zero so the
    // first tab doesn't get pushed off the left edge.
    const target = Math.max(0, layout.x + layout.width / 2 - containerWidth / 2);
    scrollViewRef.current.scrollTo({ x: target, animated: true });
  }, [state.index, state.routes]);

  // Periodic peek — slides the bar a few pixels and back so a partially
  // clipped tab briefly comes into view, hinting that more options
  // exist. Skipped when there's no overflow or the user just touched
  // the bar (so we don't fight an in-progress gesture).
  useEffect(() => {
    const interval = setInterval(() => {
      const ref = scrollViewRef.current;
      if (!ref) return;
      const containerWidth = containerWidthRef.current;
      const contentWidth = contentWidthRef.current;
      if (containerWidth <= 0 || contentWidth <= containerWidth) return;
      if (Date.now() - lastUserScrollAtRef.current < PEEK_USER_QUIET_MS) return;

      const currentX = scrollXRef.current;
      const maxX = Math.max(0, contentWidth - containerWidth);
      // If we're already at the right edge, peek by going LEFT instead
      // — the hint is "there's more this way", whichever way that is.
      const direction = currentX >= maxX - 1 ? -1 : 1;
      const peekTo = Math.max(0, Math.min(maxX, currentX + direction * PEEK_DISTANCE_PX));
      if (peekTo === currentX) return;

      ref.scrollTo({ x: peekTo, animated: true });
      const restoreTimer = setTimeout(() => {
        // Re-check the user hasn't grabbed the bar in the meantime.
        if (Date.now() - lastUserScrollAtRef.current < PEEK_HOLD_MS / 2) return;
        scrollViewRef.current?.scrollTo({ x: currentX, animated: true });
      }, PEEK_HOLD_MS);
      // No global cleanup for restoreTimer — it self-resolves after a
      // single tick. The interval cleanup below covers unmount.
      void restoreTimer;
    }, PEEK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <ScrollView
      ref={scrollViewRef}
      horizontal
      // Horizontal scrollers must opt out of iOS's status-bar tap-to-top —
      // otherwise this bar competes with the feed list for the gesture and
      // iOS, seeing more than one claimant, scrolls neither.
      scrollsToTop={false}
      showsHorizontalScrollIndicator={false}
      style={[styles.tabBar, { backgroundColor: c.surface, borderBottomColor: c.border }]}
      contentContainerStyle={styles.tabBarContent}
      onLayout={(e) => { containerWidthRef.current = e.nativeEvent.layout.width; }}
      onContentSizeChange={(w) => { contentWidthRef.current = w; }}
      onScroll={(e) => { scrollXRef.current = e.nativeEvent.contentOffset.x; }}
      onScrollBeginDrag={() => { lastUserScrollAtRef.current = Date.now(); }}
      onScrollEndDrag={() => { lastUserScrollAtRef.current = Date.now(); }}
      scrollEventThrottle={32}
    >
      {state.routes.map((route, index) => {
        const isActive = state.index === index;
        const def = FEEDS.find((f) => f.routeName === (route.name as keyof FeedTopTabParamList));
        if (!def) return null;
        const color = isActive ? c.primary : c.textMuted;
        const label = t(def.labelKey, { defaultValue: def.labelDefault });
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
            onLayout={(e) => {
              tabLayoutsRef.current[route.key] = {
                x: e.nativeEvent.layout.x,
                width: e.nativeEvent.layout.width,
              };
            }}
            style={[styles.tab, { borderBottomColor: isActive ? c.primary : 'transparent' }]}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={label}
          >
            <MaterialCommunityIcons name={def.icon} size={18} color={color} />
            <Text numberOfLines={1} style={[styles.label, { color }]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
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
const MastodonFeedScreen = () => <MastodonFeedScreenContainer />;

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
      <TopTabs.Screen
        name="MastodonFeed"
        component={MastodonFeedScreen}
        options={{ title: 'Mastodon' }}
      />
    </TopTabs.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderBottomWidth: 1,
    flexGrow: 0,
    flexShrink: 0,
  },
  // ScrollView doesn't accept flexDirection on itself — it's set on the
  // content container so the children lay out in a row.
  tabBarContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    // Was flex:1 in the fixed-grid layout; with horizontal scroll each tab
    // sizes to its content + a comfortable tap target.
    paddingHorizontal: 16,
    borderBottomWidth: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
});
