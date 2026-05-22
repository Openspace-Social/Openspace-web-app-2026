/**
 * FeedTopTabs — state-driven tab switcher for the four feed types.
 *
 * Replaces an earlier `@react-navigation/material-top-tabs` setup. Material-
 * top-tabs is backed by `react-native-pager-view`, whose internal
 * UIScrollView registered with iOS's scrollsToTop dispatcher and silently
 * stole the status-bar tap-to-top gesture from the focused FlatList. Going
 * state-driven means only one feed is mounted at a time, so the focused
 * FlatList is the unambiguous scrollsToTop claimant.
 *
 * Tradeoffs:
 *   - No more swipe-between-tabs gesture — users tap the tab strip to switch.
 *   - Scroll position resets when switching feeds. The previously-visited
 *     feed unmounts; coming back starts at the top. The auto-loaded feed
 *     is cheap to refetch from cache so the UX hit is small.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import FeedScreenContainer from './screens/FeedScreenContainer';
import MastodonFeedScreenContainer from './screens/MastodonFeedScreenContainer';
import { useChromeVisibility } from '../context/ChromeVisibilityContext';
import type { FeedType } from '../api/client';

type FeedDef = {
  feedType: FeedType;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  labelKey: string;
  labelDefault: string;
};

const FEEDS: FeedDef[] = [
  { feedType: 'home', icon: 'home-variant', labelKey: 'home.feedTabHome', labelDefault: 'Home' },
  { feedType: 'trending', icon: 'fire', labelKey: 'home.feedTabTrending', labelDefault: 'Trending' },
  { feedType: 'public', icon: 'earth', labelKey: 'home.feedTabPublic', labelDefault: 'Public' },
  { feedType: 'explore', icon: 'compass-outline', labelKey: 'home.feedTabExplore', labelDefault: 'Explore' },
  { feedType: 'mastodon', icon: 'mastodon', labelKey: 'home.feedTabMastodon', labelDefault: 'Mastodon' },
];

// How often the bar peeks to hint at offscreen tabs, and how long it
// stays peeked before sliding back.
const PEEK_INTERVAL_MS = 90_000;
const PEEK_HOLD_MS = 700;
const PEEK_DISTANCE_PX = 44;
const PEEK_USER_QUIET_MS = 20_000;

function FeedTopTabBar({
  activeFeed,
  onSelectFeed,
}: {
  activeFeed: FeedType;
  onSelectFeed: (feed: FeedType) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;

  // Slide-out wiring — same shared value the parent FeedHeader + bottom
  // tab bar subscribe to.
  const { hidden } = useChromeVisibility();
  const [barHeight, setBarHeight] = useState(0);
  const handleBarLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    if (next > 0 && next !== barHeight) setBarHeight(next);
  }, [barHeight]);
  const marginTop = barHeight > 0
    ? hidden.interpolate({ inputRange: [0, 1], outputRange: [0, -barHeight] })
    : 0;

  // Auto-scroll the tab strip to center the active tab.
  const scrollViewRef = useRef<ScrollView>(null);
  const tabLayoutsRef = useRef<Record<string, { x: number; width: number }>>({});
  const containerWidthRef = useRef(0);
  const contentWidthRef = useRef(0);
  const scrollXRef = useRef(0);
  const lastUserScrollAtRef = useRef(0);

  useEffect(() => {
    const layout = tabLayoutsRef.current[activeFeed];
    const containerWidth = containerWidthRef.current;
    if (!layout || !scrollViewRef.current || containerWidth <= 0) return;
    const target = Math.max(0, layout.x + layout.width / 2 - containerWidth / 2);
    scrollViewRef.current.scrollTo({ x: target, animated: true });
  }, [activeFeed]);

  // Periodic peek hint that more tabs exist beyond the visible area.
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
      const direction = currentX >= maxX - 1 ? -1 : 1;
      const peekTo = Math.max(0, Math.min(maxX, currentX + direction * PEEK_DISTANCE_PX));
      if (peekTo === currentX) return;

      ref.scrollTo({ x: peekTo, animated: true });
      setTimeout(() => {
        if (Date.now() - lastUserScrollAtRef.current < PEEK_HOLD_MS / 2) return;
        scrollViewRef.current?.scrollTo({ x: currentX, animated: true });
      }, PEEK_HOLD_MS);
    }, PEEK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <Animated.View onLayout={handleBarLayout} style={{ marginTop }}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        // Horizontal scrollers must opt out of iOS's status-bar tap-to-top
        // so they don't compete with the focused feed FlatList.
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
        {FEEDS.map((def) => {
          const isActive = def.feedType === activeFeed;
          const color = isActive ? c.primary : c.textMuted;
          const label = t(def.labelKey, { defaultValue: def.labelDefault });
          return (
            <TouchableOpacity
              key={def.feedType}
              activeOpacity={0.75}
              onPress={() => onSelectFeed(def.feedType)}
              onLayout={(e) => {
                tabLayoutsRef.current[def.feedType] = {
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
    </Animated.View>
  );
}

export default function FeedTopTabs() {
  const [activeFeed, setActiveFeed] = useState<FeedType>('home');
  return (
    <View style={styles.root}>
      <FeedTopTabBar activeFeed={activeFeed} onSelectFeed={setActiveFeed} />
      <View style={styles.feedArea}>
        {activeFeed === 'mastodon' ? (
          <MastodonFeedScreenContainer />
        ) : (
          // `key` forces a fresh mount per feed type so each FeedScreenContainer
          // owns its own scroll state and isn't ever reused across feeds.
          <FeedScreenContainer key={activeFeed} feedType={activeFeed} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  feedArea: { flex: 1 },
  tabBar: {
    borderBottomWidth: 1,
    flexGrow: 0,
    flexShrink: 0,
  },
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
    paddingHorizontal: 16,
    borderBottomWidth: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
});
