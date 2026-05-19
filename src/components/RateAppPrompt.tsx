/**
 * RateAppPrompt — two-stage rating ask for iOS / Android.
 *
 * 1. Custom in-app modal: "Enjoying Openspace?" with Yes / Not really /
 *    Maybe later. Captures intent so we know how long to wait before the
 *    next ask.
 * 2. On "Yes", forwards to the system review sheet via expo-store-review.
 *    Apple / Google rate-limit that sheet themselves, so we don't have
 *    to second-guess whether it actually appeared — our cooldown handles
 *    the next ask either way.
 *
 * Mounting: drop a single <RateAppPrompt /> inside the authed branch in
 * App.tsx. The component self-checks `shouldShowAppReviewPrompt()` after
 * a short post-mount delay, so it's a "fire-and-forget" anywhere it sits
 * in the tree.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as StoreReview from 'expo-store-review';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import {
  shouldShowAppReviewPrompt,
  recordAppReviewOutcome,
  type AppReviewOutcome,
} from '../utils/appReview';

// Short post-mount delay so we don't slam a modal into the user's face
// the instant the app opens. Lets the feed (or whichever route they
// land on) render first.
const PROMPT_DELAY_MS = 4000;

export default function RateAppPrompt() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;

  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Only consider showing on native, when signed in. Web is gated
    // again inside shouldShowAppReviewPrompt() for defence in depth.
    if (Platform.OS === 'web') return;
    if (!token) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        const ok = await shouldShowAppReviewPrompt();
        if (!cancelled && ok) setVisible(true);
      } catch {
        // Storage read failed — skip the prompt rather than block UX.
      }
    }, PROMPT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token]);

  const close = useCallback(async (outcome: AppReviewOutcome) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Forward to the system review sheet first when the user said yes,
      // so they have somewhere to actually rate. We record the outcome
      // either way — Apple/Google may silently swallow the sheet under
      // their own quotas, but the user's INTENT was to rate, so the
      // 6-month cooldown is what we want.
      if (outcome === 'rated') {
        try {
          const available = await StoreReview.isAvailableAsync();
          if (available && (await StoreReview.hasAction())) {
            await StoreReview.requestReview();
          }
        } catch {
          // If the system sheet errors we still treat their tap as a
          // 'rated' intent and apply the long cooldown.
        }
      }
      await recordAppReviewOutcome(outcome);
    } finally {
      setVisible(false);
      setSubmitting(false);
    }
  }, [submitting]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => void close('later')}
    >
      <Pressable
        style={styles.backdrop}
        onPress={() => void close('later')}
        accessibilityRole="button"
        accessibilityLabel={t('rateApp.dismiss', { defaultValue: 'Dismiss' })}
      >
        <Pressable
          style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
          onPress={() => {}}
        >
          <View style={[styles.iconWrap, { backgroundColor: `${c.primary}18` }]}>
            <MaterialCommunityIcons name="star-outline" size={28} color={c.primary} />
          </View>
          <Text style={[styles.title, { color: c.textPrimary }]}>
            {t('rateApp.title', { defaultValue: 'Enjoying Openspace?' })}
          </Text>
          <Text style={[styles.body, { color: c.textSecondary }]}>
            {t('rateApp.body', {
              defaultValue:
                'A quick rating helps other people find the app. It only takes a moment.',
            })}
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={submitting}
              style={[styles.primaryButton, { backgroundColor: c.primary }]}
              onPress={() => void close('rated')}
            >
              <Text style={styles.primaryButtonText}>
                {t('rateApp.rateAction', { defaultValue: 'Rate Openspace' })}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              disabled={submitting}
              style={[styles.secondaryButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
              onPress={() => void close('later')}
            >
              <Text style={[styles.secondaryButtonText, { color: c.textPrimary }]}>
                {t('rateApp.laterAction', { defaultValue: 'Maybe later' })}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              disabled={submitting}
              style={styles.tertiaryButton}
              onPress={() => void close('opted-out')}
            >
              <Text style={[styles.tertiaryButtonText, { color: c.textMuted }]}>
                {t('rateApp.optOutAction', { defaultValue: "Don't ask for a while" })}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  tertiaryButton: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tertiaryButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
