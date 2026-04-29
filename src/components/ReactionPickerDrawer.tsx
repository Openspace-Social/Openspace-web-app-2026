/**
 * ReactionPickerDrawer — full-height side drawer for picking a reaction emoji.
 *
 * Used in PostDetailModal where the post's media + the post body fill the
 * whole screen and an inline popover anchored to the React button gets
 * clipped behind the media. Sliding in from the right gives the picker
 * its own full-height column with no overlap.
 *
 * The picker preserves the original group structure (Misc / Animals /
 * Food / etc.) so users can find their reaction quickly. Backdrop tap
 * dismisses; the X in the header dismisses too.
 */

import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactionGroup } from './PostCard';

type Props = {
  visible: boolean;
  groups: ReactionGroup[];
  loading: boolean;
  actionLoading: boolean;
  onPick: (emojiId: number) => void;
  onClose: () => void;
  c: any;
  t: (key: string, options?: any) => string;
  /** Optional header title; falls back to localised "React". */
  title?: string;
};

const { width: SCREEN_W } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(380, Math.round(SCREEN_W * 0.92));
// Slightly longer duration with iOS-native cubic easing — feels more like a
// real drawer pull than a hard linear slide.
const OPEN_DURATION = 320;
const CLOSE_DURATION = 260;
const OPEN_EASING = Easing.out(Easing.cubic);
const CLOSE_EASING = Easing.in(Easing.cubic);

export default function ReactionPickerDrawer({
  visible,
  groups,
  loading,
  actionLoading,
  onPick,
  onClose,
  c,
  t,
  title,
}: Props) {
  const insets = useSafeAreaInsets();
  const translateX = React.useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const backdropOpacity = React.useRef(new Animated.Value(0)).current;
  // Keep the modal mounted for the closing animation, then unmount.
  const [mounted, setMounted] = React.useState(visible);

  React.useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 0,
          duration: OPEN_DURATION,
          easing: OPEN_EASING,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: OPEN_DURATION,
          easing: OPEN_EASING,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: DRAWER_WIDTH,
          duration: CLOSE_DURATION,
          easing: CLOSE_EASING,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: CLOSE_DURATION,
          easing: CLOSE_EASING,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, translateX, backdropOpacity]);

  if (!mounted) return null;

  const headerTitle = title || t('home.reactAction', { defaultValue: 'React' });

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View
          style={[
            styles.backdrop,
            { opacity: backdropOpacity },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawer,
            {
              backgroundColor: c.surface,
              borderLeftColor: c.border,
              transform: [{ translateX }],
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          <View style={[styles.headerRow, { borderBottomColor: c.border }]}>
            <Text style={[styles.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
              {headerTitle}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="close" size={22} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading && groups.length === 0 ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : groups.length === 0 ? (
            <Text style={[styles.emptyText, { color: c.textMuted }]}>
              {t('home.feedEmpty', { defaultValue: 'No reactions available.' })}
            </Text>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {groups.map((group) => (
                <View key={`reaction-drawer-group-${group.id}`} style={styles.group}>
                  {group.keyword ? (
                    <Text style={[styles.groupLabel, { color: c.textMuted }]}>
                      {group.keyword}
                    </Text>
                  ) : null}
                  <View style={styles.emojiRow}>
                    {(group.emojis || []).map((emoji, idx) => (
                      <TouchableOpacity
                        key={`reaction-drawer-emoji-${group.id}-${emoji.id || idx}`}
                        style={[
                          styles.emojiTile,
                          {
                            borderColor: c.border,
                            backgroundColor: c.inputBackground,
                            opacity: actionLoading ? 0.5 : 1,
                          },
                        ]}
                        activeOpacity={0.7}
                        disabled={actionLoading || emoji.id == null}
                        onPress={() => {
                          if (emoji.id != null) onPick(emoji.id);
                        }}
                      >
                        {emoji.image ? (
                          <Image source={{ uri: emoji.image }} style={styles.emojiImage} resizeMode="contain" />
                        ) : (
                          <MaterialCommunityIcons name="emoticon-outline" size={20} color={c.textSecondary} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  drawer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: -2, height: 0 },
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    paddingRight: 8,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    padding: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  group: {
    marginBottom: 14,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  emojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emojiTile: {
    width: 50,
    height: 50,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiImage: {
    width: 32,
    height: 32,
  },
});
