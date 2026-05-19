/**
 * appReview — cooldown bookkeeping for the "Rate Openspace" prompt.
 *
 * We can't read the outcome of the system rating sheet (iOS and Android
 * both keep it opaque to the app), so the prompt is two-stage:
 *
 *   1. A custom in-app modal asks "Enjoying Openspace?" → captures the
 *      user's intent ('rated' | 'opted-out' | 'later').
 *   2. If they say yes we forward to the system review sheet, otherwise
 *      we just record the outcome.
 *
 * Cooldowns:
 *   - rated     → 6 months  (don't pester someone who just rated)
 *   - opted-out → 1 month   (their feedback was "no thanks for now")
 *   - later     → 1 month   (closer to "not now" than "never")
 *
 * Plus a short warmup window after first launch so brand-new users
 * don't get a rating ask on day one.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppReviewOutcome = 'rated' | 'opted-out' | 'later';

const KEY_FIRST_SEEN = '@openspace/rate/firstSeenAt';
const KEY_LAST_PROMPTED = '@openspace/rate/lastPromptedAt';
const KEY_LAST_OUTCOME = '@openspace/rate/lastOutcome';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Don't show the prompt until the user has been around for a few days. */
const WARMUP_DAYS = 2;

const COOLDOWN_DAYS: Record<AppReviewOutcome, number> = {
  rated: 180,
  'opted-out': 30,
  later: 30,
};

/**
 * Returns true when the rating prompt is allowed to show right now.
 * Records `firstSeenAt` on the very first call so we know how long the
 * user has been installed; that's used for the warmup gate.
 */
export async function shouldShowAppReviewPrompt(): Promise<boolean> {
  // The system review sheet is iOS / Android only — `expo-store-review`
  // is a no-op on web, and showing the in-app modal there has nowhere to
  // hand the user off to.
  if (Platform.OS === 'web') return false;

  const now = Date.now();
  const firstSeenStr = await AsyncStorage.getItem(KEY_FIRST_SEEN);
  if (!firstSeenStr) {
    // First launch ever — record and skip. We'll consider asking next
    // time the app opens, after the warmup window has elapsed.
    await AsyncStorage.setItem(KEY_FIRST_SEEN, String(now));
    return false;
  }
  const firstSeen = Number(firstSeenStr);
  if (!Number.isFinite(firstSeen)) return false;
  if (now - firstSeen < WARMUP_DAYS * DAY_MS) return false;

  const [lastPromptedStr, lastOutcome] = await Promise.all([
    AsyncStorage.getItem(KEY_LAST_PROMPTED),
    AsyncStorage.getItem(KEY_LAST_OUTCOME),
  ]);

  // Never prompted yet — past warmup → eligible.
  if (!lastPromptedStr || !lastOutcome) return true;

  const lastPrompted = Number(lastPromptedStr);
  if (!Number.isFinite(lastPrompted)) return true;

  const cooldownDays =
    COOLDOWN_DAYS[lastOutcome as AppReviewOutcome] ?? COOLDOWN_DAYS.later;
  return now - lastPrompted >= cooldownDays * DAY_MS;
}

export async function recordAppReviewOutcome(outcome: AppReviewOutcome): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [KEY_LAST_PROMPTED, String(Date.now())],
      [KEY_LAST_OUTCOME, outcome],
    ]);
  } catch {
    // Persisting failed — we'd rather show the prompt again than crash.
  }
}

/**
 * Test/debug helper. Not used in app code; left here so QA / a settings
 * "reset" hook can wipe local state to re-trigger the flow.
 */
export async function resetAppReviewState(): Promise<void> {
  await AsyncStorage.multiRemove([KEY_FIRST_SEEN, KEY_LAST_PROMPTED, KEY_LAST_OUTCOME]);
}
