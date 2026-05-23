/**
 * Small inline "Mirrored" badge rendered next to the post timestamp for posts
 * that were ingested from an external platform via openbook_sources.
 *
 * Tap (native) or hover/tap (web) reveals a tooltip with provenance —
 * "from @handle on Bluesky" — plus a "View original" link that deep-links
 * back to the home instance via Linking.openURL.
 *
 * The component is presentational: theme colors come in as props from the
 * host PostCard so we don't duplicate theme-context wiring here.
 */
import React, { useCallback, useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export type SourceProvenance = {
  platform: 'bluesky' | 'mastodon' | 'twitter';
  handle: string;
  external_url: string | null;
  external_created_at: string | null;
};

const PLATFORM_LABELS: Record<string, string> = {
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  twitter: 'X',
};

type Props = {
  provenance: SourceProvenance;
  // Theme colors passed from PostCard so we match its palette without
  // duplicating theme-context plumbing.
  textMuted: string;
  textSecondary: string;
  textLink: string;
  surface: string;
  border: string;
};

export const MirroredBadge: React.FC<Props> = ({
  provenance,
  textMuted,
  textSecondary,
  textLink,
  surface,
  border,
}) => {
  const [visible, setVisible] = useState(false);

  const platformLabel =
    PLATFORM_LABELS[provenance.platform] ?? provenance.platform;
  const handleDisplay = provenance.handle.startsWith('@')
    ? provenance.handle
    : `@${provenance.handle}`;

  const openExternal = useCallback(() => {
    if (!provenance.external_url) return;
    Linking.openURL(provenance.external_url).catch(() => {
      // The external host is out of our control; silently swallow rather
      // than surface a noisy error to the user.
    });
    setVisible(false);
  }, [provenance.external_url]);

  const toggle = useCallback(() => setVisible((v) => !v), []);
  const dismiss = useCallback(() => setVisible(false), []);

  // The popover body — shared between native Modal and web absolute overlay.
  const popoverBody = (
    <View
      style={[
        styles.popover,
        { backgroundColor: surface, borderColor: border },
      ]}
    >
      <Text style={[styles.popoverText, { color: textSecondary }]}>
        from <Text style={styles.popoverHandle}>{handleDisplay}</Text> on{' '}
        {platformLabel}
      </Text>
      {provenance.external_url ? (
        <Pressable
          onPress={openExternal}
          hitSlop={8}
          style={styles.popoverLinkButton}
        >
          <Text style={[styles.popoverLink, { color: textLink }]}>
            View original →
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  // Web hover props are added only on web — Pressable accepts onHoverIn/Out
  // via RN Web's interactivity layer.
  const hoverProps =
    Platform.OS === 'web'
      ? {
          onHoverIn: () => setVisible(true),
          onHoverOut: () => setVisible(false),
        }
      : {};

  return (
    <View style={styles.container}>
      <Pressable
        onPress={toggle}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Mirrored from ${handleDisplay} on ${platformLabel}`}
        {...hoverProps}
      >
        <Text style={[styles.badge, { color: textMuted }]}>Mirrored</Text>
      </Pressable>

      {Platform.OS === 'web' && visible ? (
        // Web: absolute popover anchored below the badge. We don't portal
        // it (UserHoverCard does that via ReactDOM.createPortal for true
        // overflow-escape) — for the small footprint here, an absolute
        // child positioned beneath the badge is enough and avoids the
        // portal complexity. If the popover ever gets clipped by a parent
        // overflow:hidden, swap this for a portal.
        <View style={styles.webOverlay} pointerEvents="auto">
          {popoverBody}
        </View>
      ) : null}

      {Platform.OS !== 'web' ? (
        <Modal
          transparent
          visible={visible}
          animationType="fade"
          onRequestClose={dismiss}
        >
          <Pressable style={styles.modalBackdrop} onPress={dismiss}>
            {/* pointerEvents=box-none so taps on the card don't propagate
                to the backdrop and dismiss the modal immediately. */}
            <View style={styles.modalAnchor} pointerEvents="box-none">
              {popoverBody}
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignSelf: 'flex-start',
  },
  badge: {
    fontSize: 12,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  popover: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 220,
    maxWidth: 320,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 4,
  },
  popoverText: {
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  popoverHandle: {
    fontWeight: '600',
  },
  popoverLinkButton: {
    paddingVertical: 2,
  },
  popoverLink: {
    fontSize: 12,
    fontWeight: '600',
  },
  webOverlay: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    zIndex: 1000,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalAnchor: {
    maxWidth: 320,
    width: '100%',
  },
});

export default MirroredBadge;
