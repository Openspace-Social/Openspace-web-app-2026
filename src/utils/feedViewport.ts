/**
 * feedViewport — module-level scroll position + viewport height of the
 * main feed scroll container, plus a tiny subscribe API. Used by per-card
 * visibility hooks (useIsInViewport) to gate things like video autoplay.
 *
 * Implemented as imperative state + listener Set rather than a React
 * Context so that scroll updates (60fps) don't re-render every subscriber.
 * Each subscriber decides for itself whether the new scroll position
 * actually changed its own visibility.
 *
 * viewportHeight defaults to the device's window height so that the
 * visibility check works on initial render even before the ScrollView's
 * onLayout has fired (which empirically can be delayed or missed across
 * Metro reloads). The page-level ScrollView still calls
 * `setViewportHeight` to refine this value.
 */

import { Dimensions } from 'react-native';

let scrollY = 0;
let viewportHeight = Dimensions.get('window').height;
const listeners = new Set<() => void>();

// Keep viewportHeight roughly correct on rotation / split-view.
Dimensions.addEventListener('change', ({ window }) => {
  if (window.height && window.height !== viewportHeight) {
    viewportHeight = window.height;
    listeners.forEach((listener) => listener());
  }
});

export const feedViewport = {
  setScrollY(y: number) {
    if (y === scrollY) return;
    scrollY = y;
    listeners.forEach((listener) => listener());
  },
  setViewportHeight(h: number) {
    if (h === viewportHeight) return;
    viewportHeight = h;
    listeners.forEach((listener) => listener());
  },
  getScrollY() {
    return scrollY;
  },
  getViewportHeight() {
    return viewportHeight;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
