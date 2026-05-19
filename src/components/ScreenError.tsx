/**
 * ScreenError — the empty-state error block used by every native screen
 * that fetches data on mount. Until now a failed fetch left the user
 * staring at the error message with no way to retry short of closing
 * the app. This component renders the same message + a Retry button
 * wired to whatever reload function the parent passes, so a flaky API
 * or dropped network is recoverable in-place.
 *
 * Visual: centered, red error message, retry button with the screen's
 * theme chrome. Kept intentionally light — drop-in replacement for
 * `<View style={centered}><Text>...{error}</Text></View>`.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type Props = {
  message: string;
  c: any;
  t: (key: string, options?: any) => string;
  /** Optional reload callback. When omitted the retry button is hidden
   *  (a few screens don't have a clean reload path). */
  onRetry?: () => void | Promise<void>;
  /** When true, render a small spinner in place of the retry label. */
  retrying?: boolean;
};

export default function ScreenError({ message, c, t, onRetry, retrying = false }: Props) {
  return (
    <View style={styles.container}>
      <MaterialCommunityIcons
        name="alert-circle-outline"
        size={28}
        color={c.errorText ?? '#ef4444'}
      />
      <Text style={[styles.message, { color: c.errorText ?? '#ef4444' }]}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => { void onRetry(); }}
          disabled={retrying}
          style={[
            styles.retryButton,
            { borderColor: c.border, backgroundColor: c.inputBackground, opacity: retrying ? 0.7 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry', { defaultValue: 'Try again' })}
        >
          {retrying ? (
            <ActivityIndicator size="small" color={c.textPrimary} />
          ) : (
            <Text style={[styles.retryText, { color: c.textPrimary }]}>
              {t('common.retry', { defaultValue: 'Try again' })}
            </Text>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 14,
  },
  message: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 21,
  },
  retryButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
