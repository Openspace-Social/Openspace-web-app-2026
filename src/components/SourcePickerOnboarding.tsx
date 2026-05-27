/**
 * SourcePickerOnboarding — interactive "fill your feed" picker shown to:
 *   1. New signups after socialUsername, before shareProfile (in LandingScreen).
 *   2. Existing users on next launch when `has_seen_source_picker === false`
 *      (mounted as a full-screen modal over the home tab).
 *
 * Flow: fetch the 8 categories + per-category profile counts, silently skip
 * any with count == 0, then render one screen per remaining category. The
 * user toggles profiles to follow; a sticky counter shows progress toward
 * the MIN_PICKS=5 total. Per-screen Skip lets them advance without picking;
 * Continue/Done is gated on total picks >= MIN_PICKS on the last screen.
 *
 * On finish: single bulk-POST of all picked source_profile_ids. The endpoint
 * also flips has_seen_source_picker=true server-side so the modal doesn't
 * re-prompt next launch. Posting an empty array is a valid "I'm skipping
 * entirely" signal — same flag flip, no follows created.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { api } from '../api/client';
import type { SourceCategory, SourceDirectoryEntry } from '../api/client';
import { useTheme } from '../theme/ThemeContext';

// Picker enforces this client-side; the server doesn't care (empty array is
// always accepted). Keep loose so we can A/B without a deploy.
const MIN_PICKS = 5;

// Per-category fetch is capped — the directory endpoint allows up to 50.
// 20 keeps the page short enough to scan without scrolling fatigue.
const PER_CATEGORY_COUNT = 20;

export type SourcePickerOnboardingProps = {
  token: string;
  onComplete: () => void;
  // When true (full-screen modal use), shows a small "Maybe later" exit in
  // the header so existing users can dismiss without picking. The dismissal
  // still hits the bulk-follow endpoint with [] to flip the flag, matching
  // the inline-onboarding skip semantics — we never want to re-prompt.
  allowMaybeLater?: boolean;
};

export default function SourcePickerOnboarding({
  token,
  onComplete,
  allowMaybeLater = false,
}: SourcePickerOnboardingProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [categories, setCategories] = useState<SourceCategory[]>([]);
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [profilesByCategory, setProfilesByCategory] = useState<
    Record<string, SourceDirectoryEntry[]>
  >({});
  const [loadingCategory, setLoadingCategory] = useState<string | null>(null);
  const [pickedIds, setPickedIds] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Stable ref for onComplete — parent components (e.g. HomeScreen) typically
  // pass a fresh inline lambda every render, which would otherwise re-fire
  // the bootstrap effect on every parent re-render, repeatedly cancelling
  // the in-flight categories fetch and trapping the picker on the spinner.
  // Storing the latest callback in a ref keeps the effect's dep list stable
  // (just [token]) without losing access to the up-to-date function.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Bootstrap: fetch categories once per token. Filter to non-empty so the
  // picker never renders a category with zero results.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cats = await api.getSourceCategories(token);
        if (cancelled) return;
        const nonEmpty = cats.filter((cat) => cat.profile_count > 0);
        setCategories(nonEmpty);
        setBootstrapping(false);
        if (nonEmpty.length === 0) {
          // No content at all → auto-finish: hit the endpoint to flip the
          // flag, then call onComplete. Avoids a dead-end screen.
          try {
            await api.bulkFollowSourceProfiles(token, []);
          } catch {
            // Best-effort; the modal-prompt path can retry next launch.
          }
          onCompleteRef.current();
        }
      } catch (e: any) {
        if (cancelled) return;
        setBootstrapError(e?.message || 'Failed to load source categories.');
        setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const currentCategory = categories[categoryIndex];
  // Track only the key (string), so per-key memoisation in deps is stable.
  // Without this, `currentCategory` is a new object reference whenever the
  // surrounding `categories` array is rebuilt (e.g. via setState), which
  // would falsely re-trigger the lazy-fetch effect.
  const currentCategoryKey = currentCategory?.key;

  // Lazy-fetch the active category's profiles on screen entry.
  useEffect(() => {
    if (!currentCategoryKey) return;
    if (profilesByCategory[currentCategoryKey]) return; // already cached
    if (loadingCategory === currentCategoryKey) return; // in-flight

    let cancelled = false;
    setLoadingCategory(currentCategoryKey);
    (async () => {
      try {
        const payload = await api.getSourcesDirectory(token, {
          category: currentCategoryKey,
          count: PER_CATEGORY_COUNT,
        });
        if (cancelled) return;
        setProfilesByCategory((prev) => ({
          ...prev,
          [currentCategoryKey]: payload.results,
        }));
        // Pre-populate pickedIds for any profile the server says is already
        // followed — useful for the existing-user modal where the user may
        // have followed some sources via search / discovery prior.
        const alreadyFollowed = payload.results
          .filter((p) => p.is_followed_source && p.source_profile?.id)
          .map((p) => p.source_profile!.id as number);
        if (alreadyFollowed.length > 0) {
          setPickedIds((prev) => {
            const next = new Set(prev);
            alreadyFollowed.forEach((id) => next.add(id));
            return next;
          });
        }
      } catch (e: any) {
        if (cancelled) return;
        // Cache an empty array so we don't refetch on tap-back. The user
        // can hit Skip; we surface the error inline on the empty state.
        setProfilesByCategory((prev) => ({
          ...prev,
          [currentCategoryKey]: [],
        }));
      } finally {
        if (!cancelled) setLoadingCategory(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // profilesByCategory + loadingCategory intentionally omitted from deps:
    // we read their LATEST value via the closure inside the in-flight
    // promise, but they shouldn't TRIGGER the effect — the only signal that
    // should refetch is the active category key changing. Including them
    // would cause a refetch every time setProfilesByCategory fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCategoryKey, token]);

  const togglePick = useCallback((sourceProfileId: number) => {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceProfileId)) next.delete(sourceProfileId);
      else next.add(sourceProfileId);
      return next;
    });
  }, []);

  const isLastScreen = categoryIndex === categories.length - 1;
  const hasMet = pickedIds.size >= MIN_PICKS;

  const advance = useCallback(() => {
    if (isLastScreen) return; // caller should call finish() instead
    setCategoryIndex((i) => i + 1);
  }, [isLastScreen]);

  const finish = useCallback(
    async (overridePickedIds?: number[]) => {
      if (submitting) return;
      setSubmitError(null);
      setSubmitting(true);
      try {
        const ids = overridePickedIds ?? Array.from(pickedIds);
        await api.bulkFollowSourceProfiles(token, ids);
        onComplete();
      } catch (e: any) {
        setSubmitError(
          e?.message ||
            t('sourcePicker.errorSubmit', {
              defaultValue: 'Could not save your selections. Please try again.',
            }),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, pickedIds, token, onComplete, t],
  );

  // ─── Bootstrap states ────────────────────────────────────────────────────

  if (bootstrapping) {
    return (
      <View style={[styles.fillCentered, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  if (bootstrapError) {
    return (
      <View style={[styles.fillCentered, { backgroundColor: c.background }]}>
        <Text style={[styles.errorText, { color: c.errorText }]}>
          {bootstrapError}
        </Text>
        <Pressable
          onPress={onComplete}
          style={({ pressed }) => [
            styles.skipBtn,
            { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={{ color: c.textSecondary }}>
            {t('sourcePicker.skipAll', { defaultValue: 'Skip for now' })}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!currentCategory) {
    // Defensive: bootstrap completed with zero categories AND the auto-skip
    // didn't fire (e.g. race). Just call onComplete.
    return (
      <View style={[styles.fillCentered, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  // ─── Active screen ───────────────────────────────────────────────────────

  const profiles = profilesByCategory[currentCategory.key];
  const isLoadingCurrent = loadingCategory === currentCategory.key;
  const continueLabel = isLastScreen
    ? t('sourcePicker.finish', { defaultValue: 'Done' })
    : t('sourcePicker.continue', { defaultValue: 'Continue' });
  const continueDisabled = isLastScreen
    ? !hasMet || submitting
    : false;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {/* Header: progress + counter + (modal-only) maybe-later */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={[styles.progress, { color: c.textSecondary }]}>
            {t('sourcePicker.stepProgress', {
              current: categoryIndex + 1,
              total: categories.length,
              defaultValue: 'Step {{current}} of {{total}}',
            })}
          </Text>
          {allowMaybeLater && (
            <Pressable
              onPress={() => finish([])}
              hitSlop={8}
              disabled={submitting}
            >
              <Text style={[styles.maybeLater, { color: c.textLink }]}>
                {t('sourcePicker.maybeLater', { defaultValue: 'Maybe later' })}
              </Text>
            </Pressable>
          )}
        </View>
        <Text style={[styles.title, { color: c.textPrimary }]}>
          {translateCategoryTitle(t, currentCategory.key, currentCategory.label)}
        </Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          {t('sourcePicker.subtitle', {
            defaultValue:
              'Pick accounts to follow — their posts will appear in your home feed.',
          })}
        </Text>
        <Text style={[styles.counter, { color: hasMet ? c.primary : c.textSecondary }]}>
          {t('sourcePicker.pickedCounter', {
            picked: pickedIds.size,
            min: MIN_PICKS,
            defaultValue: '{{picked}} of {{min}} picked',
          })}
        </Text>
      </View>

      {/* Body: profile list */}
      {isLoadingCurrent && !profiles ? (
        <View style={styles.fillCentered}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : profiles && profiles.length === 0 ? (
        <View style={styles.fillCentered}>
          <Text style={[styles.errorText, { color: c.textMuted }]}>
            {t('sourcePicker.emptyCategory', {
              defaultValue: 'No sources in this category yet.',
            })}
          </Text>
        </View>
      ) : (
        <FlatList
          data={profiles || []}
          keyExtractor={(item) =>
            String(item.source_profile?.id ?? item.id)
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <SourceCard
              entry={item}
              picked={
                item.source_profile?.id != null &&
                pickedIds.has(item.source_profile.id)
              }
              onToggle={() => {
                const id = item.source_profile?.id;
                if (typeof id === 'number') togglePick(id);
              }}
              colors={c}
              followLabel={t('sourcePicker.follow', { defaultValue: 'Follow' })}
              followingLabel={t('sourcePicker.following', {
                defaultValue: 'Following',
              })}
            />
          )}
        />
      )}

      {/* Footer: skip + continue/done */}
      <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.surface }]}>
        {submitError && (
          <Text style={[styles.errorText, { color: c.errorText, marginBottom: 8 }]}>
            {submitError}
          </Text>
        )}
        <View style={styles.footerRow}>
          <Pressable
            onPress={() => {
              if (isLastScreen) finish();
              else advance();
            }}
            disabled={submitting}
            style={({ pressed }) => [
              styles.skipBtn,
              { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={{ color: c.textSecondary }}>
              {isLastScreen
                ? t('sourcePicker.skipAll', { defaultValue: 'Skip for now' })
                : t('sourcePicker.skipCategory', {
                    defaultValue: 'Skip',
                  })}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (isLastScreen) finish();
              else advance();
            }}
            disabled={continueDisabled}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: continueDisabled ? c.border : c.primary,
                opacity: pressed && !continueDisabled ? 0.85 : 1,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={c.textOnPrimary} />
            ) : (
              <Text style={[styles.primaryBtnText, { color: c.textOnPrimary }]}>
                {continueLabel}
              </Text>
            )}
          </Pressable>
        </View>
        {isLastScreen && !hasMet && (
          <Text style={[styles.minHint, { color: c.textMuted }]}>
            {t('sourcePicker.minHint', {
              min: MIN_PICKS,
              defaultValue: 'Pick at least {{min}} to continue.',
            })}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

type SourceCardProps = {
  entry: SourceDirectoryEntry;
  picked: boolean;
  onToggle: () => void;
  colors: ReturnType<typeof useTheme>['theme']['colors'];
  followLabel: string;
  followingLabel: string;
};

function SourceCard({
  entry,
  picked,
  onToggle,
  colors: c,
  followLabel,
  followingLabel,
}: SourceCardProps) {
  const avatarUri = entry.profile?.avatar;
  const displayName = entry.profile?.name || entry.username || '';
  const handle = entry.username ? `@${entry.username}` : '';
  const description = entry.source_profile?.description;
  const mirrorsCount = entry.mirrors_count ?? entry.mirrors?.length ?? 0;
  const verified = !!entry.source_profile?.verified_at;

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: picked ? c.primary : c.border,
          borderWidth: picked ? 2 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.avatarWrap}>
        {avatarUri ? (
          <Image
            source={{ uri: avatarUri }}
            style={[styles.avatar, { backgroundColor: c.inputBackground }]}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: c.inputBackground }]}>
            <Text style={{ color: c.textMuted, fontSize: 18, fontWeight: '600' }}>
              {(displayName || '?').slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <View style={[styles.cardBody, { minWidth: 0 }]}>
        <View style={styles.nameRow}>
          <Text
            numberOfLines={1}
            style={[styles.name, { color: c.textPrimary }]}
          >
            {displayName}
          </Text>
          {verified && (
            <Text style={[styles.verifiedBadge, { color: c.primary }]}>✓</Text>
          )}
        </View>
        {!!handle && (
          <Text
            numberOfLines={1}
            style={[styles.handle, { color: c.textSecondary }]}
          >
            {handle}
          </Text>
        )}
        {!!description && (
          <Text
            numberOfLines={2}
            style={[styles.description, { color: c.textMuted }]}
          >
            {description}
          </Text>
        )}
        {mirrorsCount > 0 && (
          <Text style={[styles.mirrorsCount, { color: c.textMuted }]}>
            {mirrorsCount === 1
              ? '1 mirror'
              : `${mirrorsCount} mirrors`}
          </Text>
        )}
      </View>
      <View
        style={[
          styles.followPill,
          {
            backgroundColor: picked ? c.primary : 'transparent',
            borderColor: picked ? c.primary : c.border,
          },
        ]}
      >
        <Text
          style={{
            color: picked ? c.textOnPrimary : c.textSecondary,
            fontWeight: '600',
            fontSize: 13,
          }}
        >
          {picked ? followingLabel : followLabel}
        </Text>
      </View>
    </Pressable>
  );
}

// Best-effort localization of the canonical 8 category keys; falls back to
// the server-provided English label (which is itself a sensible default).
function translateCategoryTitle(
  t: (key: string, opts?: any) => string,
  key: string,
  fallbackLabel: string,
): string {
  const i18nKey = `sourcePicker.category.${key}`;
  const translated = t(i18nKey, { defaultValue: '' });
  if (translated && translated !== i18nKey) return translated;
  return t('sourcePicker.categoryTitle', {
    label: fallbackLabel,
    defaultValue: '{{label}} accounts',
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  fillCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    paddingTop: Platform.OS === 'web' ? 16 : 24,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progress: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  maybeLater: {
    fontSize: 14,
    fontWeight: '500',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
    lineHeight: 20,
  },
  counter: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  avatarWrap: {
    width: 48,
    height: 48,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  verifiedBadge: {
    fontSize: 14,
    fontWeight: '700',
  },
  handle: {
    fontSize: 13,
    marginTop: 1,
  },
  description: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  mirrorsCount: {
    fontSize: 11,
    marginTop: 4,
    fontWeight: '500',
  },
  followPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 90,
    alignItems: 'center',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  skipBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 100,
    alignItems: 'center',
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  minHint: {
    marginTop: 8,
    fontSize: 12,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
