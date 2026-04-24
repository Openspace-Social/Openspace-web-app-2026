import './src/i18n'; // initialise i18next before any component renders
import { StatusBar } from 'expo-status-bar';
import { useState, useEffect, useRef } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from './src/i18n';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import LandingScreen from './src/screens/LandingScreen';
import HomeScreen from './src/screens/HomeScreen';
import PublicPostScreen from './src/screens/PublicPostScreen';
import CookieConsentBanner from './src/components/CookieConsentBanner';
import { AppRoute, defaultAuthedRoute, parsePathToRoute, routeToPath } from './src/routing';
import { AppToastProvider } from './src/toast/AppToastContext';

// Routes that should be accessible without authentication.
function isPublicRoute(r: AppRoute): boolean {
  return r.screen === 'post';
}

function Root() {
  const { isDark } = useTheme();
  const [token, setToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [route, setRoute] = useState<AppRoute>(() => {
    // On native, `window` exists as a global but `window.location` is undefined,
    // so we must guard on both.
    if (typeof window === 'undefined' || !window.location) return { screen: 'landing' };
    return parsePathToRoute(window.location.pathname);
  });

  // Remember where to redirect after login when coming from a public route.
  const postLoginRoute = useRef<AppRoute | null>(null);

  function navigate(nextRoute: AppRoute, replace = false) {
    setRoute(nextRoute);
    if (typeof window === 'undefined' || !window.location || !window.history) return;
    const nextPath = routeToPath(nextRoute);
    const currentPath = window.location.pathname || '/';
    if (nextPath === currentPath) return;
    if (replace) window.history.replaceState({}, '', nextPath);
    else window.history.pushState({}, '', nextPath);
  }

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location) return;
    const onPopState = () => setRoute(parsePathToRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('@openspace/language').then((lang) => {
      if (lang) i18n.changeLanguage(lang);
    });
    AsyncStorage.getItem('@openspace/auth_token')
      .then((savedToken) => {
        if (savedToken) setToken(savedToken);
      })
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!token) {
      // Public routes (e.g. /posts/:id) are shown without auth — don't redirect.
      if (isPublicRoute(route)) return;
      if (route.screen !== 'landing') navigate({ screen: 'landing' }, true);
      return;
    }
    if (route.screen === 'landing') {
      navigate(defaultAuthedRoute(), true);
    }
  }, [authReady, token, route.screen]);

  const handleLogin = async (newToken: string) => {
    setToken(newToken);
    await AsyncStorage.setItem('@openspace/auth_token', newToken);
    // If the user came from a public post, take them back there; otherwise go home.
    const target = postLoginRoute.current ?? defaultAuthedRoute();
    postLoginRoute.current = null;
    navigate(target, true);
  };

  const handleTokenRefresh = async (newToken: string) => {
    setToken(newToken);
    await AsyncStorage.setItem('@openspace/auth_token', newToken);
  };

  const handleLogout = async () => {
    setToken(null);
    await AsyncStorage.removeItem('@openspace/auth_token');
    navigate({ screen: 'landing' }, true);
  };

  function renderContent() {
    if (!authReady) return null;

    if (token) {
      return (
        <HomeScreen
          token={token}
          onLogout={handleLogout}
          onTokenRefresh={handleTokenRefresh}
          route={route}
          onNavigate={navigate}
        />
      );
    }

    // Unauthenticated — public post view.
    if (route.screen === 'post') {
      return (
        <PublicPostScreen
          postUuid={route.postUuid}
          onLoginPress={() => {
            postLoginRoute.current = route;
            navigate({ screen: 'landing' }, true);
          }}
        />
      );
    }

    return <LandingScreen onLogin={handleLogin} />;
  }

  // Web-only mount tweaks:
  // 1. Expose env(safe-area-inset-*) via viewport-fit=cover (Expo's default lacks it).
  // 2. Hide the vertical-scrollbar gutter below 700px so our edge-to-edge cards
  //    truly reach the viewport edges. Phones have overlay scrollbars already;
  //    this only matters in desktop browsers resized to mobile widths.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (meta) {
      const content = meta.getAttribute('content') || '';
      if (!/viewport-fit\s*=/.test(content)) {
        meta.setAttribute('content', `${content}${content ? ', ' : ''}viewport-fit=cover`);
      }
    }

    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-openspace-scrollbar', 'true');
    styleEl.textContent = `
      @media (max-width: 699px) {
        html, body { overflow-x: hidden; }
        body { scrollbar-width: none; -ms-overflow-style: none; }
        body::-webkit-scrollbar { width: 0; height: 0; display: none; }
        *::-webkit-scrollbar { width: 0; height: 0; }
        * { scrollbar-width: none; }
      }
    `;
    document.head.appendChild(styleEl);
    return () => {
      if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    };
  }, []);

  // Platform-specific root: SafeAreaView on iOS handles notch/home-indicator.
  // On web we use env() insets; on Android edge-to-edge the system handles it.
  const RootContainer: any = Platform.OS === 'ios' ? SafeAreaView : View;
  const rootStyle =
    Platform.OS === 'web'
      ? [styles.root, webSafeAreaStyle as any]
      : styles.root;

  return (
    <RootContainer style={rootStyle}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {renderContent()}
      <CookieConsentBanner />
    </RootContainer>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

// Web-only: top/left/right insets at the app root. Bottom-inset is applied by
// bottom-most components (e.g. BottomTabBar) so inner scroll areas aren't padded.
const webSafeAreaStyle = {
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingLeft: 'env(safe-area-inset-left, 0px)',
  paddingRight: 'env(safe-area-inset-right, 0px)',
} as const;

export default function App() {
  return (
    <SafeAreaProvider>
      {/* NavigationContainer mounted at the root so future react-navigation
          navigators + useNavigation() calls have context available. The custom
          routing in Root() is still the source of truth until we migrate each
          route to the navigator in src/navigation/AppNavigator.tsx. */}
      <NavigationContainer>
        <ThemeProvider>
          <AppToastProvider>
            <Root />
          </AppToastProvider>
        </ThemeProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
