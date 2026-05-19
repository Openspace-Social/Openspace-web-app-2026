/**
 * Skeleton — base placeholder shapes used while data loads.
 *
 * Two primitives: SkeletonBlock (rect with optional rounding) and
 * SkeletonCircle. Both shimmer with a base ↔ highlight pulse driven by an
 * Animated.Value loop. We use the JS-driver loop on both web and native
 * (instead of a CSS keyframe on web) because RN Web's Animated.View does
 * not reliably forward arbitrary DOM props like `className`, so the cleaner
 * path is one animation strategy for both platforms.
 *
 * Accessibility: the wrapper carries accessibilityRole="progressbar" and
 * a hidden label so screen readers announce "Loading" rather than
 * silently sitting on a row of empty boxes.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

const SHIMMER_DURATION_MS = 1100;

function useShimmerOpacity(): Animated.Value {
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 0.55,
          duration: SHIMMER_DURATION_MS / 2,
          // Web doesn't have a native driver; the JS driver still produces a
          // smooth opacity ramp for a placeholder pulse.
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(value, {
          toValue: 1,
          duration: SHIMMER_DURATION_MS / 2,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);
  return value;
}

type CommonProps = {
  style?: StyleProp<ViewStyle>;
};

export function SkeletonBlock({
  width,
  height,
  borderRadius = 6,
  style,
}: CommonProps & {
  width: number | string;
  height: number | string;
  borderRadius?: number;
}) {
  const { theme } = useTheme();
  const opacity = useShimmerOpacity();
  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height: height as any,
          borderRadius,
          backgroundColor: (theme.colors as any).skeletonBase,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonCircle({
  size,
  style,
}: CommonProps & { size: number }) {
  return <SkeletonBlock width={size} height={size} borderRadius={size / 2} style={style} />;
}

/**
 * Convenience wrapper that announces "Loading" to assistive tech and lays
 * out children in a column. Use it as the outermost element of any
 * surface-specific skeleton so the screen reader doesn't try to describe
 * a wall of empty rectangles.
 */
export function SkeletonGroup({
  children,
  label = 'Loading',
  style,
}: {
  children: React.ReactNode;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[styles.group, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      accessibilityLabel={label}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    width: '100%',
  },
});
