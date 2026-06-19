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
// Cumulative-distance threshold for committing to a hide / show toggle.
// Previous behaviour used a per-frame delta threshold (4px), which was
// over-sensitive during slow scrolls: small finger motions produced dy
// values oscillating around the threshold (down 5, up 5, down 6, up 5),
// each crossing flipped the direction and spring-toggled the bar, and
// the top nav visibly bounced up and down. By accumulating dy in the
// current direction and resetting on direction change, we only trigger
// once the user has SUSTAINED motion totalling at least this many
// pixels — slow micro-scrolls cancel themselves out, fast scrolls
// blow past the threshold within a frame or two.
//
// Bumped from 28 → 72 to further reduce the frequency of toggles during
// slow scrolling. The chrome animation triggers a layout reflow (the
// feed grows when chrome hides, shrinks when it shows), which the user
// reads as a "jerk" because RN auto-adjusts scroll position to keep
// content visible. Fewer toggles per scroll session = fewer jerks. The
// trade-off is the bar takes a little longer to start hiding when the
// user begins a downward gesture; in practice this still feels coupled
// to the finger because anything resembling intentional scrolling
// (>72px sustained) is well above what oscillating jitter produces.
const CUMULATIVE_DIRECTION_THRESHOLD_PX = 72;
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
//
// Softer-than-default spring: lower tension (80 → 40) + higher friction
// (9 → 14) means a slower, more dampened animation. When the chrome
// toggles, the layout shift the user perceives as a "jerk" gets spread
// over a longer interval, making each transition feel like a glide
// rather than a snap. Combined with the higher cumulative threshold
// above, both the frequency AND the abruptness of toggles drop.
const SPRING_CONFIG = { useNativeDriver: false, friction: 14, tension: 40 } as const;

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
  // Cumulative distance scrolled in the CURRENT direction. Resets to 0
  // whenever the direction flips (down → up or vice versa) so small
  // back-and-forth jitter during slow scrolling cancels itself out
  // before ever reaching the toggle threshold.
  const cumulativeDeltaRef = useRef(0);
  // 0 = no movement yet, 1 = currently moving down, -1 = currently moving up.
  // Tracks the direction the accumulator is collecting in so we know when
  // to reset it.
  const directionRef = useRef<-1 | 0 | 1>(0);

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
        // Clear the accumulator so a hide-triggering scroll from the top
        // has to start fresh, rather than carrying over a stale negative
        // value from a previous downward scroll that ended at the top.
        cumulativeDeltaRef.current = 0;
        directionRef.current = 0;
        return;
      }

      // Suppress toggling near the bottom — pagination churn + iOS
      // rubber-band bounce both produce spurious upward deltas there
      // that would otherwise pop the tab bar back into view mid-load.
      // See SUPPRESS_NEAR_BOTTOM_PX comment for the why. The chrome
      // stays in whatever state it was in when the user entered the
      // suppression window; it resumes normal toggling as soon as they
      // scroll back above it.
      const contentSize = event.nativeEvent.contentSize?.height ?? 0;
      const layoutHeight = event.nativeEvent.layoutMeasurement?.height ?? 0;
      if (contentSize > 0 && layoutHeight > 0) {
        const distFromBottom = contentSize - layoutHeight - y;
        if (distFromBottom < SUPPRESS_NEAR_BOTTOM_PX) {
          return;
        }
      }

      const dy = y - previous;
      if (dy === 0) return;

      // Direction of THIS event.
      const eventDirection: -1 | 1 = dy > 0 ? 1 : -1;
      // Direction change → reset accumulator so jitter doesn't accumulate
      // across direction flips. This is the key fix for slow-scroll
      // flicker — small alternating ±dy values keep resetting the
      // accumulator back to 0 instead of reaching the toggle threshold.
      if (eventDirection !== directionRef.current) {
        cumulativeDeltaRef.current = 0;
        directionRef.current = eventDirection;
      }
      cumulativeDeltaRef.current += dy;

      // Only commit a toggle once the user has SUSTAINED motion totalling
      // the cumulative threshold in one direction. After a successful
      // toggle, reset the accumulator so the bar doesn't immediately
      // re-trigger off lingering momentum from the same scroll.
      if (
        cumulativeDeltaRef.current > CUMULATIVE_DIRECTION_THRESHOLD_PX
        && targetRef.current !== 1
      ) {
        targetRef.current = 1;
        Animated.spring(hidden, { ...SPRING_CONFIG, toValue: 1 }).start();
        cumulativeDeltaRef.current = 0;
      } else if (
        cumulativeDeltaRef.current < -CUMULATIVE_DIRECTION_THRESHOLD_PX
        && targetRef.current !== 0
      ) {
        targetRef.current = 0;
        Animated.spring(hidden, { ...SPRING_CONFIG, toValue: 0 }).start();
        cumulativeDeltaRef.current = 0;
      }
    },
    [hidden],
  );
}
