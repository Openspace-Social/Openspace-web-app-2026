/**
 * SourcePickerGate — sits inside the AppNavigator's authed Main screen and
 * conditionally overlays SourcePickerOnboarding when the user's
 * has_seen_source_picker flag is False.
 *
 * Why this lives here instead of HomeScreen:
 *   - App.tsx routes to either the legacy HomeScreen (web) or AppNavigator
 *     (iOS / Android), based on Platform.OS. The picker modal needs to fire
 *     on BOTH paths. HomeScreen already has its own effect for the legacy
 *     path; this gate covers the new-navigator path so native iOS/Android
 *     users get the same one-time prompt.
 *   - The gate renders as a sibling to <TabsNavigator />, so the modal
 *     overlays the tabs without interfering with their navigation state.
 *
 * The component is intentionally tiny — its only state is a local
 * "should the modal be open?" boolean, derived once from the user payload
 * we fetch on mount. We never refetch — once the user dismisses the picker,
 * the modal goes away for this session and the server flag is flipped so
 * the next launch's payload reflects True.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import SourcePickerOnboarding from './SourcePickerOnboarding';

export default function SourcePickerGate() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const [show, setShow] = useState(false);
  // Guard so we only ever check the flag once per gate mount. Without it,
  // a re-render that re-fires the effect would re-show the modal after
  // the user dismissed it within the same session.
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    if (checkedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const me: any = await api.getAuthenticatedUser(token);
        if (cancelled) return;
        checkedRef.current = true;
        if (me && me.has_seen_source_picker === false) {
          setShow(true);
        }
      } catch {
        // If user-fetch fails (offline, token expired) we silently skip.
        // The picker is non-critical; surfacing a toast here would distract
        // from whatever else just broke. Next launch will retry.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!show || !token) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.colors.background,
        zIndex: 9999,
      }}
      // pointerEvents default ('auto') intentional — we want the overlay
      // to capture taps so the user can't bypass the picker by reaching
      // through to the tab bar below. The "Maybe later" affordance inside
      // the picker is the dismissal path.
    >
      <SourcePickerOnboarding
        token={token}
        allowMaybeLater
        onComplete={() => setShow(false)}
      />
    </View>
  );
}
