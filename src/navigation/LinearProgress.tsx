/**
 * LinearProgress — thin indeterminate progress bar.
 *
 * Animates a 30%-wide pill across the track on a 1.2s loop, fading in when
 * mounted. Mimics Material's indeterminate linear progress. Used under the
 * FeedSubTabs while the feed is fetching so users see an explicit signal
 * that their tab tap triggered a load (even when scrolled).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, View } from 'react-native';

type Props = {
  color: string;
  trackColor?: string;
  height?: number;
};

export default function LinearProgress({ color, trackColor = 'transparent', height = 3 }: Props) {
  const translate = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    if (trackWidth === 0) return;
    const loop = Animated.loop(
      Animated.timing(translate, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      translate.setValue(0);
    };
  }, [trackWidth, translate]);

  const barWidth = Math.max(60, trackWidth * 0.3);
  const translateX = translate.interpolate({
    inputRange: [0, 1],
    outputRange: [-barWidth, trackWidth],
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w && w !== trackWidth) setTrackWidth(w);
  };

  return (
    <View
      style={[styles.track, { height, backgroundColor: trackColor }]}
      onLayout={onLayout}
    >
      {trackWidth > 0 ? (
        <Animated.View
          style={[
            styles.bar,
            {
              width: barWidth,
              height,
              backgroundColor: color,
              transform: [{ translateX }],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
