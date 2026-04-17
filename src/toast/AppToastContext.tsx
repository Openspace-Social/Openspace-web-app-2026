import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
  const [message, setMessage] = useState('');
  const [type, setType] = useState<ToastType>('error');
  const [visible, setVisible] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
  const translateY = useRef(new Animated.Value(-14)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastDeadlineRef = useRef<number>(0);
  const c = theme.colors;
  const colorMap = c as Record<string, string | undefined>;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -14, duration: 140, useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      setMessage('');
      setRemainingMs(0);
      setDurationMs(DEFAULT_DURATION_MS);
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
    const deadline = Date.now() + duration;
    toastDeadlineRef.current = deadline;
    setDurationMs(duration);
    setRemainingMs(duration);
    countdownTimerRef.current = setInterval(() => {
      const nextRemaining = Math.max(0, toastDeadlineRef.current - Date.now());
      setRemainingMs(nextRemaining);
      if (nextRemaining <= 0 && countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    }, 100);

    hideTimerRef.current = setTimeout(
      hideToast,
      duration,
    );
  }, [clearHideTimer, hideToast, opacity, translateY]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const ctx = useMemo(() => ({ showToast }), [showToast]);

  const bg =
    type === 'success'
      ? colorMap.successBackground || '#166534'
      : type === 'info'
        ? '#1d4ed8'
        : c.errorBackground || '#991b1b';
  const border =
    type === 'success'
      ? colorMap.successBorder || '#86efac'
      : type === 'info'
        ? '#93c5fd'
        : c.errorBorder || '#fca5a5';
  const fg =
    type === 'success'
      ? colorMap.successText || '#dcfce7'
      : type === 'info'
        ? '#eff6ff'
        : c.errorText || '#fee2e2';

  const title =
    type === 'success'
      ? 'Success'
      : type === 'info'
        ? 'Notice'
        : 'Error';
  const progress = durationMs > 0 ? Math.max(0, Math.min(1, remainingMs / durationMs)) : 0;

  return (
    <AppToastContext.Provider value={ctx}>
      {children}
      {visible ? (
        <Modal transparent visible animationType="none" onRequestClose={hideToast}>
          <View pointerEvents="box-none" style={styles.modalRoot}>
            <View pointerEvents="none" style={styles.overlay}>
              <Animated.View
                style={[
                  styles.toast,
                  {
                    width: Math.min(560, Math.max(250, width - 36)),
                    marginTop: Platform.OS === 'web' ? 72 : 88,
                    backgroundColor: bg,
                    borderColor: border,
                    transform: [{ translateY }],
                    opacity,
                  },
                ]}
              >
                <Text style={[styles.title, { color: fg }]}>
                  {title}
                </Text>
                <Text style={[styles.message, { color: fg }]} numberOfLines={4}>
                  {message}
                </Text>
                <View style={[styles.progressTrack, { borderColor: border }]}>
                  <View style={[styles.progressFill, { backgroundColor: fg, width: `${progress * 100}%` }]} />
                </View>
              </Animated.View>
            </View>
          </View>
        </Modal>
      ) : null}
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
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    top: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  toast: {
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 20,
  },
  title: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  progressTrack: {
    marginTop: 6,
    height: 4,
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'hidden',
    opacity: 0.85,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
});
