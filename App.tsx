import './src/i18n'; // initialise i18next before any component renders
import { StatusBar } from 'expo-status-bar';
import { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from './src/i18n';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import LandingScreen from './src/screens/LandingScreen';
import HomeScreen from './src/screens/HomeScreen';
import CookieConsentBanner from './src/components/CookieConsentBanner';

function Root() {
  const { isDark } = useTheme();
  const [token, setToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

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

  const handleLogin = async (newToken: string) => {
    setToken(newToken);
    await AsyncStorage.setItem('@openspace/auth_token', newToken);
  };

  const handleLogout = async () => {
    setToken(null);
    await AsyncStorage.removeItem('@openspace/auth_token');
  };

  return (
    <View style={styles.root}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {authReady ? (
        token ? (
          <HomeScreen token={token} onLogout={handleLogout} />
        ) : (
          <LandingScreen onLogin={handleLogin} />
        )
      ) : null}
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
      <Root />
    </ThemeProvider>
  );
}
