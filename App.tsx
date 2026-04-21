import './src/i18n'; // initialise i18next before any component renders
import { StatusBar } from 'expo-status-bar';
import { useState, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
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
    if (typeof window === 'undefined') return { screen: 'landing' };
    return parsePathToRoute(window.location.pathname);
  });

  // Remember where to redirect after login when coming from a public route.
  const postLoginRoute = useRef<AppRoute | null>(null);

  function navigate(nextRoute: AppRoute, replace = false) {
    setRoute(nextRoute);
    if (typeof window === 'undefined') return;
    const nextPath = routeToPath(nextRoute);
    const currentPath = window.location.pathname || '/';
    if (nextPath === currentPath) return;
    if (replace) window.history.replaceState({}, '', nextPath);
    else window.history.pushState({}, '', nextPath);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
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

  return (
    <View style={styles.root}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {renderContent()}
      <CookieConsentBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

export default function App() {
  return (
    <ThemeProvider>
      <AppToastProvider>
        <Root />
      </AppToastProvider>
    </ThemeProvider>
  );
}
