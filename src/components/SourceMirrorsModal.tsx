/**
 * Modal that lists all mirrors for a Source publisher (BBC, ESPN, ...).
 * Opened from a small "X mirrors" pill on the Source's profile header so
 * the header stays uncluttered when the Source has many mirrors.
 *
 * Each mirror renders as a platform-badge + tappable handle row; tapping
 * the handle opens the home-instance profile URL via onOpenLink.
 */
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const PLATFORM_LABELS: Record<string, string> = {
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  activitypub: 'ActivityPub',
  twitter: 'X',
};

export type SourceMirrorEntry = {
  platform: string;
  handle: string;
  profile_url: string | null;
};

type Props = {
  visible: boolean;
  mirrors: SourceMirrorEntry[];
  onClose: () => void;
  onOpenLink?: (url: string) => void;
  c: any;
  t: (key: string, opts?: any) => string;
};

export default function SourceMirrorsModal({
  visible,
  mirrors,
  onClose,
  onOpenLink,
  c,
  t,
}: Props) {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Inner Pressable swallows the press so taps inside the card
            don't propagate to the backdrop and dismiss the modal. */}
        <Pressable
          style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
          onPress={() => {}}
        >
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: c.textPrimary }]}>
              {t('profile.sourceMirrorsModalTitle', { defaultValue: 'Mirrors' })}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Text style={[styles.closeText, { color: c.textMuted }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.subtitle, { color: c.textMuted }]}>
            {t('profile.sourceMirrorsModalSubtitle', {
              defaultValue: 'This Source publishes posts mirrored from these external accounts.',
            })}
          </Text>

          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingVertical: 4 }}>
            {mirrors.map((mirror) => {
              const platformLabel = PLATFORM_LABELS[mirror.platform] ?? mirror.platform;
              const handleClean = mirror.handle?.startsWith('@')
                ? mirror.handle
                : `@${mirror.handle ?? ''}`;
              return (
                <View
                  key={`${mirror.platform}-${mirror.handle}`}
                  style={[styles.mirrorRow, { borderColor: c.border }]}
                >
                  <View style={[styles.platformBadge, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
                    <Text style={[styles.platformLabel, { color: c.textSecondary }]}>
                      {platformLabel}
                    </Text>
                  </View>
                  {mirror.profile_url ? (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => mirror.profile_url && onOpenLink?.(mirror.profile_url)}
                      style={{ flex: 1 }}
                    >
                      <Text
                        style={[styles.handle, { color: c.textLink, textDecorationLine: 'underline' }]}
                        numberOfLines={1}
                      >
                        {handleClean}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text
                      style={[styles.handle, { color: c.textSecondary, flex: 1 }]}
                      numberOfLines={1}
                    >
                      {handleClean}
                    </Text>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  closeText: {
    fontSize: 18,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    marginBottom: 12,
    lineHeight: 16,
  },
  mirrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  platformBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 90,
    alignItems: 'center',
  },
  platformLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  handle: {
    fontSize: 14,
    fontWeight: '500',
  },
});
