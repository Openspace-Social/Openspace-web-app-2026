/**
 * ThemedFlatList / ThemedScrollView — drop-in replacements that swap
 * pull-to-refresh implementations per platform:
 *
 *   - iOS: a fully JS-controlled <ActivityIndicator> overlay driven by
 *     onScroll/onScrollEndDrag. This sidesteps RN's Fabric bug where
 *     iOS RefreshControl drops the `tintColor` prop and always renders
 *     the system default charcoal grey (no contrast on dark mode).
 *
 *   - Android: the platform-native <RefreshControl>. It honors
 *     `tintColor` + `colors` correctly and Android scroll views don't
 *     even support iOS-style bounce overscroll, so the JS-overlay
 *     pull-detection (which relies on contentOffset.y going negative)
 *     wouldn't fire on Android anyway.
 *
 * Caller contract is the same as the underlying scroll component plus
 * three new props:
 *   - `refreshing` (controlled — your data hook owns it)
 *   - `onRefresh` (your refetch callback)
 *   - `refreshTintColor` (any color string; both platforms honor it)
 *
 * Existing `onScroll` and `onScrollEndDrag` callbacks are forwarded
 * after our own pull tracking on iOS, so screens that listen for scroll
 * events keep working unchanged on both platforms.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type FlatListProps,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  RefreshControl,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  View,
} from 'react-native';

const PULL_THRESHOLD = 80;
const INDICATOR_TOP_OFFSET = 12;
// Below this pull distance the indicator stays invisible to ignore touch
// jitter / overscroll bounces that aren't actually pull-to-refresh attempts.
const FADE_IN_START = 8;

type RefreshProps = {
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
  /**
   * Spinner color. Pass `theme.colors.textPrimary` (or similar) for a
   * value that auto-adapts between light and dark mode.
   */
  refreshTintColor?: string;
};

/**
 * Internal helper — owns the pull-distance state, scroll-event handlers,
 * and the indicator opacity calculation. Both ThemedFlatList and
 * ThemedScrollView share this so the gesture/visual feel is identical.
 */
function usePullToRefresh(
  refreshing: boolean,
  onRefresh: (() => void | Promise<void>) | undefined,
  callerOnScroll: ((event: NativeSyntheticEvent<NativeScrollEvent>) => void) | undefined,
  callerOnScrollEndDrag:
    | ((event: NativeSyntheticEvent<NativeScrollEvent>) => void)
    | undefined,
) {
  const [pulled, setPulled] = useState(0);
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      setPulled(y < 0 ? -y : 0);
      callerOnScroll?.(event);
    },
    [callerOnScroll],
  );

  const handleEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      if (y < -PULL_THRESHOLD && !refreshingRef.current && onRefreshRef.current) {
        void onRefreshRef.current();
      }
      callerOnScrollEndDrag?.(event);
    },
    [callerOnScrollEndDrag],
  );

  const indicatorOpacity = refreshing
    ? 1
    : pulled > FADE_IN_START
      ? Math.min((pulled - FADE_IN_START) / (PULL_THRESHOLD - FADE_IN_START), 1)
      : 0;

  return { handleScroll, handleEndDrag, indicatorOpacity };
}

function Indicator({ opacity, color }: { opacity: number; color: string }) {
  if (opacity <= 0) return null;
  return (
    <View pointerEvents="none" style={[styles.indicator, { opacity }]}>
      <ActivityIndicator color={color} size="small" />
    </View>
  );
}

// ─── ThemedFlatList ──────────────────────────────────────────────────────

type ThemedFlatListProps<T> = FlatListProps<T> & RefreshProps;

function ThemedFlatListInner<T>(
  props: ThemedFlatListProps<T>,
  ref: React.Ref<FlatList<T>>,
) {
  const {
    refreshing = false,
    onRefresh,
    refreshTintColor = '#888',
    onScroll,
    onScrollEndDrag,
    ...rest
  } = props;

  // Android: RefreshControl works correctly (tintColor honored, gestures
  // map naturally to the OS overscroll behavior). Use it directly — no
  // JS overlay needed.
  if (Platform.OS === 'android') {
    return (
      <FlatList
        ref={ref}
        {...(rest as FlatListProps<T>)}
        onScroll={onScroll}
        onScrollEndDrag={onScrollEndDrag}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { void onRefresh(); }}
              tintColor={refreshTintColor}
              colors={[refreshTintColor]}
            />
          ) : undefined
        }
      />
    );
  }

  // iOS: custom JS overlay (Fabric RefreshControl tintColor bug).
  const { handleScroll, handleEndDrag, indicatorOpacity } = usePullToRefresh(
    refreshing,
    onRefresh,
    onScroll,
    onScrollEndDrag,
  );

  return (
    <View style={styles.root}>
      <Indicator opacity={indicatorOpacity} color={refreshTintColor} />
      <FlatList
        ref={ref}
        {...(rest as FlatListProps<T>)}
        onScroll={handleScroll}
        onScrollEndDrag={handleEndDrag}
        scrollEventThrottle={16}
      />
    </View>
  );
}

// Generic forwardRef + memo don't compose cleanly in TS; cast at the
// boundary so the public type remains generic-aware AND ref-forwarding.
// Consumers can pass a ref<FlatList<T>> and call e.g.
// `ref.current?.scrollToOffset({ offset: 0 })` — and React Navigation's
// `useScrollToTop` hook works against this same ref.
const ThemedFlatList = React.forwardRef(ThemedFlatListInner) as <T>(
  props: ThemedFlatListProps<T> & { ref?: React.Ref<FlatList<T>> },
) => React.ReactElement;

export default ThemedFlatList;

// ─── ThemedScrollView ────────────────────────────────────────────────────

export type ThemedScrollViewProps = ScrollViewProps & RefreshProps;

export function ThemedScrollView(props: ThemedScrollViewProps) {
  const {
    refreshing = false,
    onRefresh,
    refreshTintColor = '#888',
    onScroll,
    onScrollEndDrag,
    children,
    ...rest
  } = props;

  // Android: native RefreshControl. Same reasoning as ThemedFlatList.
  if (Platform.OS === 'android') {
    return (
      <ScrollView
        {...rest}
        onScroll={onScroll}
        onScrollEndDrag={onScrollEndDrag}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { void onRefresh(); }}
              tintColor={refreshTintColor}
              colors={[refreshTintColor]}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    );
  }

  // iOS: custom JS overlay.
  const { handleScroll, handleEndDrag, indicatorOpacity } = usePullToRefresh(
    refreshing,
    onRefresh,
    onScroll,
    onScrollEndDrag,
  );

  return (
    <View style={styles.root}>
      <Indicator opacity={indicatorOpacity} color={refreshTintColor} />
      <ScrollView
        {...rest}
        onScroll={handleScroll}
        onScrollEndDrag={handleEndDrag}
        scrollEventThrottle={16}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  indicator: {
    position: 'absolute',
    top: INDICATOR_TOP_OFFSET,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});
