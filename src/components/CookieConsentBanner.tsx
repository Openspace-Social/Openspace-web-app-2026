import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { useCookieConsent } from '../hooks/useCookieConsent';

export default function CookieConsentBanner() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;
  const { status, loading, accept, decline } = useCookieConsent();

  // Don't render until we've checked storage, and don't render if already decided
  if (loading || status !== null) return null;

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: c.surface,
          borderTopColor: c.border,
        },
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.icon}>🍪</Text>
        <View style={styles.textBlock}>
          <Text style={[styles.title, { color: c.textPrimary }]}>
            {t('cookies.title')}
          </Text>
          <Text style={[styles.body, { color: c.textSecondary }]}>
            {t('cookies.body')}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.declineButton, { borderColor: c.border }]}
          onPress={decline}
          activeOpacity={0.75}
        >
          <Text style={[styles.declineText, { color: c.textSecondary }]}>
            {t('cookies.decline')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.acceptButton, { backgroundColor: c.primary }]}
          onPress={accept}
          activeOpacity={0.85}
        >
          <Text style={styles.acceptText}>{t('cookies.acceptAll')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
    ...Platform.select({
      web: {
        boxShadow: '0 -4px 24px rgba(0,0,0,0.08)',
      },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -4 },
        elevation: 12,
      },
    }),
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  icon: {
    fontSize: 24,
    marginTop: 1,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  declineButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  declineText: {
    fontSize: 14,
    fontWeight: '600',
  },
  acceptButton: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  acceptText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
