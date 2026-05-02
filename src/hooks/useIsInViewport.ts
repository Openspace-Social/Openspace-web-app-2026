/**
 * useIsInViewport — returns true when at least `visibilityRatio` of the
 * View attached to `ref` is currently inside the main feed viewport.
 *
 * `visibilityRatio` is a 0–1 fraction:
 *   - 0   → "any pixel visible" counts as visible (loosest)
 *   - 0.5 → the View is visible only while ≥50% of its height is on screen
 *   - 1.0 → fully on screen (strictest)
 *
 * `View.measure()` returns `pageY` in absolute screen coordinates
 * (already accounts for scroll), so we compare directly against the
 * viewport. Both `setTimeout` retries on mount and a 300ms polling
 * interval cover cases where the page-level ScrollView's onLayout/
 * onScroll don't fire reliably.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { View } from 'react-native';
import { feedViewport } from '../utils/feedViewport';

export function useIsInViewport(
  ref: React.RefObject<View | null>,
  visibilityRatio = 0,
): { isInViewport: boolean; onLayout: () => void } {
  const [isInViewport, setIsInViewport] = useState(false);
  const checkRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;

    const check = () => {
      const node = ref.current;
      if (!node || typeof node.measure !== 'function') return;
      node.measure((_x, _y, _w, height, _pageX, pageY) => {
        if (cancelled) return;
        const viewportHeight = feedViewport.getViewportHeight();
        if (!viewportHeight || !height) return;
        const visibleTop = Math.max(pageY, 0);
        const visibleBottom = Math.min(pageY + height, viewportHeight);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        const visible =
          visibilityRatio <= 0
            ? visibleHeight > 0
            : visibleHeight / height >= visibilityRatio;
        setIsInViewport((prev) => (prev === visible ? prev : visible));
      });
    };
    checkRef.current = check;

    const timers = [50, 250, 700].map((delay) => setTimeout(check, delay));
    const unsubscribe = feedViewport.subscribe(check);
    const pollInterval = setInterval(check, 300);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      clearInterval(pollInterval);
      unsubscribe();
    };
  }, [ref, visibilityRatio]);

  const onLayout = useCallback(() => {
    checkRef.current();
  }, []);

  return { isInViewport, onLayout };
}
