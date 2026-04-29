import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';

type ToastType = 'error' | 'success' | 'info';

type ShowToastOptions = {
  type?: ToastType;
  durationMs?: number;
};

type ToastContextValue = {
  showToast: (message: string, options?: ShowToastOptions) => void;
};

const DEFAULT_DURATION_MS = 3200;

const AppToastContext = createContext<ToastContextValue | null>(null);

export function AppToastProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [type, setType] = useState<ToastType>('error');
  const [visible, setVisible] = useState(false);
  const translateY = useRef(new Animated.Value(-14)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const c = theme.colors;
  const isDark = theme.dark;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -14, duration: 140, useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      setMessage('');
    });
  }, [opacity, translateY]);

  const showToast = useCallback((nextMessage: string, options?: ShowToastOptions) => {
    const trimmed = `${nextMessage || ''}`.trim();
    if (!trimmed) return;
    clearHideTimer();
    setMessage(trimmed);
    setType(options?.type || 'error');
    setVisible(true);
    translateY.setValue(-14);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 170, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 170, useNativeDriver: true }),
    ]).start();

    const duration = Math.max(1200, options?.durationMs ?? DEFAULT_DURATION_MS);
    hideTimerRef.current = setTimeout(hideToast, duration);
  }, [clearHideTimer, hideToast, opacity, translateY]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const ctx = useMemo(() => ({ showToast }), [showToast]);

  // Soft, theme-aware palette. Success now uses the platform's brand
  // indigo so the toast matches the rest of the UI rather than fighting
  // it with a hard green. Error uses the same softer red the theme uses
  // elsewhere (e.g., the SettingsScreen error rows). Info is a neutral
  // slate so it doesn't compete with the brand colour.
  const palette = (() => {
    if (type === 'success') {
      return isDark
        ? { bg: '#1E1B4B', border: '#4338CA', fg: '#C7D2FE' }
        : { bg: '#EEF2FF', border: '#C7D2FE', fg: '#4338CA' };
    }
    if (type === 'info') {
      return isDark
        ? { bg: c.surface, border: c.border, fg: c.textSecondary }
        : { bg: '#F1F5F9', border: '#CBD5E1', fg: '#475569' };
    }
    // error — softer than the previous near-black/red. Reuses the theme's
    // existing error tokens so any future palette change flows through.
    return { bg: c.errorBackground, border: c.errorBorder, fg: c.errorText };
  })();

  const title =
    type === 'success' ? 'Success' : type === 'info' ? 'Notice' : 'Error';

  const toastLayer = (
    <View pointerEvents="box-none" style={styles.modalRoot}>
      <View pointerEvents="none" style={styles.overlay}>
        <Animated.View
          style={[
            styles.toast,
            {
              width: Math.min(560, Math.max(250, width - 36)),
              // Clear the status bar + native stack header + FeedHeader
              // (search pill + sub-tabs + progress bar) on native. On web
              // the legacy top nav is fixed around 72pt.
              marginTop: Platform.OS === 'web' ? 72 : insets.top + 110,
              backgroundColor: palette.bg,
              borderColor: palette.border,
              transform: [{ translateY }],
              opacity,
            },
          ]}
        >
          <Text style={[styles.title, { color: palette.fg }]}>
            {title}
          </Text>
          <Text style={[styles.message, { color: palette.fg }]} numberOfLines={4}>
            {message}
          </Text>
        </Animated.View>
      </View>
    </View>
  );

  return (
    <AppToastContext.Provider value={ctx}>
      {children}
      {visible ? toastLayer : null}
    </AppToastContext.Provider>
  );
}

export function useAppToast() {
  const ctx = useContext(AppToastContext);
  if (!ctx) {
    throw new Error('useAppToast must be used within AppToastProvider');
  }
  return ctx;
}

const styles = StyleSheet.create({
  modalRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    pointerEvents: 'box-none' as const,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    top: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  toast: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  title: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
    opacity: 0.85,
  },
  message: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },
});
