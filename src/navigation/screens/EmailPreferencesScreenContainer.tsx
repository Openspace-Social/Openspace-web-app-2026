import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import { api, type EmailPreferences } from '../../api/client';

type ToggleKey = 'promotional' | 'product_updates';

export default function EmailPreferencesScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const c = theme.colors;

  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState<ToggleKey | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.getEmailPreferences(token);
      setPrefs(result);
    } catch (e: any) {
      setError(
        e?.message ||
          t('emailPreferences.loadFailed', {
            defaultValue: 'Could not load your email preferences.',
          }),
      );
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = useCallback(
    async (key: ToggleKey, value: boolean) => {
      if (!token || !prefs) return;
      // Optimistic update — flip immediately, revert on failure so the UI stays snappy.
      const previous = prefs[key];
      setPrefs({ ...prefs, [key]: value });
      setSavingKey(key);
      try {
        const result = await api.updateEmailPreferences(token, { [key]: value });
        setPrefs(result);
      } catch (e: any) {
        setPrefs((current) => (current ? { ...current, [key]: previous } : current));
        showToast(
          e?.message ||
            t('emailPreferences.saveFailed', {
              defaultValue: 'Could not save the change. Please try again.',
            }),
          { type: 'error' },
        );
      } finally {
        setSavingKey(null);
      }
    },
    [prefs, showToast, t, token],
  );

  const suppressed = !!prefs?.suppressed;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.subtitle, { color: c.textMuted }]}>
          {t('emailPreferences.description', {
            defaultValue:
              'Choose which emails you receive from Openspace. You can update these any time. Account-critical mail (security, legal notices) is always sent.',
          })}
        </Text>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={c.primary} size="small" />
          </View>
        ) : error ? (
          <Text style={[styles.errorText, { color: c.errorText }]}>{error}</Text>
        ) : prefs ? (
          <View style={styles.list}>
            {suppressed ? (
              <View
                style={[
                  styles.suppressionNotice,
                  { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
                ]}
              >
                <Text style={[styles.suppressionTitle, { color: '#991B1B' }]}>
                  {t('emailPreferences.suppressedTitle', {
                    defaultValue: 'Email delivery is paused',
                  })}
                </Text>
                <Text style={[styles.suppressionBody, { color: '#7F1D1D' }]}>
                  {t('emailPreferences.suppressedBody', {
                    defaultValue:
                      'We stopped sending email to your address because it bounced or was marked as spam. Update your account email in Settings to re-enable delivery.',
                  })}
                </Text>
              </View>
            ) : null}

            <View
              style={[
                styles.sectionCard,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <ToggleRow
                title={t('emailPreferences.productUpdatesTitle', {
                  defaultValue: 'Product updates',
                })}
                body={t('emailPreferences.productUpdatesBody', {
                  defaultValue:
                    'Occasional news about new features, improvements, and changes to Openspace.',
                })}
                value={prefs.product_updates}
                disabled={savingKey !== null || suppressed}
                onChange={(v) => void handleToggle('product_updates', v)}
                tint={c.primary}
              />
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <ToggleRow
                title={t('emailPreferences.promotionalTitle', {
                  defaultValue: 'Promotional emails',
                })}
                body={t('emailPreferences.promotionalBody', {
                  defaultValue:
                    'Community highlights, announcements, and other marketing emails.',
                })}
                value={prefs.promotional}
                disabled={savingKey !== null || suppressed}
                onChange={(v) => void handleToggle('promotional', v)}
                tint={c.primary}
              />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ToggleRow({
  title,
  body,
  value,
  onChange,
  disabled,
  tint,
}: {
  title: string;
  body: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  tint: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={[styles.toggleTitle, { color: c.textPrimary }]}>{title}</Text>
        <Text style={[styles.toggleBody, { color: c.textMuted }]}>{body}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: '#94a3b8', true: tint }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 120,
    gap: 14,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  centered: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 12,
  },
  list: {
    gap: 12,
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  toggleText: {
    flex: 1,
    gap: 4,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  toggleBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 12,
  },
  suppressionNotice: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  suppressionTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  suppressionBody: {
    fontSize: 13,
    lineHeight: 18,
  },
});
