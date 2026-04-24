import { useMemo, useRef } from 'react';
import { Animated, PanResponder, Platform } from 'react-native';

type Options = {
  /** Full drawer width in px — used as the target when closing. */
  drawerWidth: number;
  /** The Animated.Value backing the drawer's horizontal translate. */
  translateX: Animated.Value;
  /** Called when the gesture commits to closing. The caller is expected to
   *  flip its `visible` prop; the existing open/close animation elsewhere
   *  will take it from there. */
  onClose: () => void;
  /** Optional: skip attaching handlers (e.g. on web if you prefer only buttons). */
  enabled?: boolean;
  /** Fraction of drawerWidth the user must drag past to commit. Default 0.35. */
  closeThreshold?: number;
  /** Velocity (px/ms) above which a flick always commits. Default 0.5. */
  flickVelocity?: number;
};

/**
 * Right-slide drawer swipe-to-close gesture. Attach the returned panHandlers
 * to the Animated.View that renders the drawer panel. Drag right past the
 * threshold, or flick right past the velocity, to close.
 */
export function useSwipeToClose({
  drawerWidth,
  translateX,
  onClose,
  enabled = true,
  closeThreshold = 0.35,
  flickVelocity = 0.5,
}: Options) {
  const startValueRef = useRef(0);

  const responder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) => {
        if (!enabled) return false;
        // Claim the gesture only for clear right-swipes — ignore taps,
        // vertical scrolls, and leftward drags. Threshold keeps scroll/ink
        // interactions from being intercepted.
        return gesture.dx > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2;
      },
      onPanResponderGrant: () => {
        // @ts-ignore _value is the public-ish current numeric value
        startValueRef.current = (translateX as any)._value ?? 0;
        translateX.stopAnimation();
      },
      onPanResponderMove: (_evt, gesture) => {
        const next = Math.max(0, Math.min(drawerWidth, startValueRef.current + gesture.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_evt, gesture) => {
        const passedDistance = gesture.dx > drawerWidth * closeThreshold;
        const passedVelocity = gesture.vx > flickVelocity;
        if (passedDistance || passedVelocity) {
          // Finish the close animation, then tell parent to unmount.
          Animated.timing(translateX, {
            toValue: drawerWidth,
            duration: 180,
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (finished) onClose();
          });
        } else {
          // Snap back open.
          Animated.timing(translateX, {
            toValue: 0,
            duration: 160,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.timing(translateX, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }).start();
      },
    });
    // translateX identity is stable across renders (useRef-based), drawerWidth
    // drives re-memoization when the viewport changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerWidth, enabled, closeThreshold, flickVelocity]);

  // PanResponder on RN Web is only partially implemented; touch events work
  // but mouse drags don't. That's acceptable — mouse users have the close
  // button. On native, handlers behave as expected.
  // We keep the Platform branch here so callers can spread unconditionally.
  return Platform.OS === 'web' && !('ontouchstart' in (globalThis as any))
    ? {}
    : responder.panHandlers;
}
