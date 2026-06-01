/**
 * ChromeVisibilityContext — shared Animated.Value that drives the top
 * FeedHeader and bottom CustomTabBar's slide-in/out behavior on native.
 *
 * Pattern: a single 0..1 value where 0 = chrome fully visible and 1 =
 * chrome fully hidden. The chrome components subscribe and translate
 * themselves off-screen as the value approaches 1; scrollable screens
 * (currently just the home feed) call `useChromeScrollHandler()` to get
 * an `onScroll` callback that flips the value based on scroll direction.
 *
 * Hide rules:
 *   - At the very top of the list (offset ≤ 8 px) the chrome is always
 *     shown — pull-to-refresh and "I just landed here" both feel wrong
 *     with a hidden bar.
 *   - Scrolling down past a small threshold (4 px) hides; scrolling up
 *     past the same threshold shows.
 *   - The animation is a short spring so it feels coupled to the user's
 *     finger without lagging behind.
 *
 * The shared value also exposes `resetVisible()` so a screen losing
 * focus can leave the chrome in a known state for the next screen.
 */

import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { Animated, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

type ChromeVisibilityValue = {
  /** 0 = chrome visible, 1 = chrome hidden. Animated, JS-driver. */
  hidden: Animated.Value;
  /** Snap immediately to visible. Used by screens on focus/blur. */
  resetVisible: () => void;
};

const ChromeVisibilityCtx = createContext<ChromeVisibilityValue | null>(null);

const HIDE_AT_TOP_THRESHOLD_PX = 8;
const DIRECTION_THRESHOLD_PX = 4;
// Within this many pixels of the bottom of the scrollable content, suppress
// chrome toggling entirely. Two reasons:
//
//  1. Pagination — FlatList's onEndReached fires here, the loader footer
//     mounts (content height grows), and the user is mid-scroll. Tiny
//     scroll deltas during this churn would otherwise flip the bottom
//     tab bar in and out, producing the "the toolbar exposes before
//     posts load and jumps the feed" user-reported flicker.
//
//  2. Overscroll bounce — when the user hits the absolute bottom of the
//     feed, iOS rubber-bands the content briefly past contentSize, then
//     snaps back. The snap-back produces a small UPWARD scroll delta
//     (negative dy) that the directional check would otherwise treat as
//     "user scrolled up → show chrome again". Suppressing inside this
//     window keeps the bar in whatever state it was in just before the
//     user reached the bottom — which is what they expect.
//
// 240 was chosen to match the FlatList's `onEndReachedThreshold={0.4}`
// roughly: for a tablet viewport of ~700pt of feed area, 0.4 of that is
// 280pt — close enough that the suppression window covers the same region
// where pagination work is happening. On phones the math works out the
// same way.
const SUPPRESS_NEAR_BOTTOM_PX = 240;
// `useNativeDriver: false` because the chrome components animate layout
// props (negative margin to collapse their slot in the parent flexbox so
// the feed's scroll viewport genuinely grows when chrome hides). Layout
// props can't run on the native driver.
const SPRING_CONFIG = { useNativeDriver: false, friction: 9, tension: 80 } as const;

export function ChromeVisibilityProvider({ children }: { children: React.ReactNode }) {
  const hidden = useRef(new Animated.Value(0)).current;

  const resetVisible = useCallback(() => {
    Animated.spring(hidden, { ...SPRING_CONFIG, toValue: 0 }).start();
  }, [hidden]);

  const value = useMemo<ChromeVisibilityValue>(() => ({ hidden, resetVisible }), [hidden, resetVisible]);
  return <ChromeVisibilityCtx.Provider value={value}>{children}</ChromeVisibilityCtx.Provider>;
}

export function useChromeVisibility(): ChromeVisibilityValue {
  // Hook order must stay stable across renders even when a provider is
  // missing (web / unit tests / unwrapped story-book renders) — so always
  // build the fallback first, then prefer the real ctx when present.
  const fallbackHidden = useRef(new Animated.Value(0)).current;
  const fallback = useMemo<ChromeVisibilityValue>(
    () => ({ hidden: fallbackHidden, resetVisible: () => fallbackHidden.setValue(0) }),
    [fallbackHidden],
  );
  const ctx = useContext(ChromeVisibilityCtx);
  return ctx ?? fallback;
}

/**
 * Hook returning a stable `onScroll` for ScrollView / FlatList. Drives
 * the shared `hidden` value based on scroll direction + position. The
 * caller still needs to set `scrollEventThrottle={16}` for smooth
 * updates (RN's default is 0 which only fires once per gesture).
 */
export function useChromeScrollHandler() {
  const { hidden } = useChromeVisibility();
  const lastYRef = useRef(0);
  const targetRef = useRef<0 | 1>(0);

  return useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const previous = lastYRef.current;
      lastYRef.current = y;

      // Always show near the top — covers pull-to-refresh and the
      // "user just landed on the feed" case.
      if (y <= HIDE_AT_TOP_THRESHOLD_PX) {
        if (targetRef.current !== 0) {
          targetRef.current = 0;
          Animated.spring(hidden, { ...SPRING_CONFIG, toValue: 0 }).start();
        }
        return;
      }

      // Suppress toggling near the bottom — pagination churn + iOS
      // rubber-band bounce both produce spurious upward deltas there
      // that would otherwise pop the tab bar back into view mid-load.
      // See SUPPRESS_NEAR_BOTTOM_PX comment for the why. The chrome
      // stays in whatever state it was in when the user entered the
      // suppression window; it resumes normal direction-based toggling
      // as soon as they scroll back above it.
      const contentSize = event.nativeEvent.contentSize?.height ?? 0;
      const layoutHeight = event.nativeEvent.layoutMeasurement?.height ?? 0;
      if (contentSize > 0 && layoutHeight > 0) {
        const distFromBottom = contentSize - layoutHeight - y;
        if (distFromBottom < SUPPRESS_NEAR_BOTTOM_PX) {
          return;
        }
      }

      const dy = y - previous;
      if (dy > DIRECTION_THRESHOLD_PX && targetRef.current !== 1) {
        targetRef.current = 1;
        Animated.spring(hidden, { ...SPRING_CONFIG, toValue: 1 }).start();
      } else if (dy < -DIRECTION_THRESHOLD_PX && targetRef.current !== 0) {
        targetRef.current = 0;
        Animated.spring(hidden, { ...SPRING_CONFIG, toValue: 0 }).start();
      }
    },
    [hidden],
  );
}
