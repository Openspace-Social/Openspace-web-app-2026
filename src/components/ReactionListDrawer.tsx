/**
 * ReactionListDrawer — full-height side drawer that lists who reacted to
 * a post. Mirror of `ReactionPickerDrawer`'s open/close mechanics so both
 * surfaces feel like the same "drawer family".
 *
 * Used on native feeds (FeedScreen, CommunityScreen, PublicProfileScreen)
 * where there's no centered Modal pattern — tapping the reactions count
 * or the people icon on a feed card opens this drawer. The post detail
 * already has its own inline "Reactions" tab, so it doesn't use this.
 *
 * The drawer renders:
 *   - The post's existing emoji-count chips at the top, tappable to filter
 *     the reactor list down to a single emoji (or back to "all").
 *   - The list of reactors, each tappable to navigate to the user's profile.
 *
 * Loading and empty states match the existing post-detail "Reactions" tab.
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

type ReactionEmoji = { id?: number; keyword?: string; image?: string };
type EmojiCount = { count?: number; emoji?: ReactionEmoji };
type Reactor = {
  id?: number;
  emoji?: ReactionEmoji;
  reactor?: {
    id?: number;
    username?: string;
    profile?: { avatar?: string };
  };
};

type Props = {
  visible: boolean;
  /** Counts to render as filter chips at the top of the drawer. */
  emojiCounts: EmojiCount[];
  /** Currently-active emoji filter (null = "all reactors"). */
  activeEmoji: ReactionEmoji | null;
  /** The reactor list for the current filter. */
  users: Reactor[];
  loading: boolean;
  /** Called when the user taps an emoji chip — caller re-fetches the list
   *  scoped to that emoji (or null to clear the filter). */
  onSelectEmoji: (emoji: ReactionEmoji | null) => void;
  /** Called when the user taps a reactor row — caller navigates to profile. */
  onSelectUser: (username: string) => void;
  onClose: () => void;
  c: any;
  t: (key: string, options?: any) => string;
  title?: string;
};

const { width: SCREEN_W } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(380, Math.round(SCREEN_W * 0.92));
const OPEN_DURATION = 320;
const CLOSE_DURATION = 260;
const OPEN_EASING = Easing.out(Easing.cubic);
const CLOSE_EASING = Easing.in(Easing.cubic);

export default function ReactionListDrawer({
  visible,
  emojiCounts,
  activeEmoji,
  users,
  loading,
  onSelectEmoji,
  onSelectUser,
  onClose,
  c,
  t,
  title,
}: Props) {
  const insets = useSafeAreaInsets();
  const translateX = React.useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const backdropOpacity = React.useRef(new Animated.Value(0)).current;
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

  const headerTitle = title ?? t('home.reactionListTitle', { defaultValue: 'Who reacted' });
  const visibleCounts = (emojiCounts || []).filter((e) => (e?.count || 0) > 0);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.drawer,
          {
            width: DRAWER_WIDTH,
            backgroundColor: c.surface,
            borderLeftColor: c.border,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 8,
            transform: [{ translateX }],
          },
        ]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text style={[styles.title, { color: c.textPrimary }]}>{headerTitle}</Text>
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: c.inputBackground }]}
            onPress={onClose}
            activeOpacity={0.85}
            accessibilityLabel={t('home.closeAction', { defaultValue: 'Close' })}
          >
            <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Emoji filter chips */}
        {visibleCounts.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsScroll}
            contentContainerStyle={styles.chipsRow}
          >
            <TouchableOpacity
              style={[
                styles.chip,
                {
                  borderColor: c.border,
                  backgroundColor: activeEmoji == null ? c.surface : c.inputBackground,
                },
              ]}
              onPress={() => onSelectEmoji(null)}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: activeEmoji == null ? c.textPrimary : c.textSecondary },
                ]}
              >
                {t('home.reactionListAllChip', { defaultValue: 'All' })}
              </Text>
            </TouchableOpacity>
            {visibleCounts.map((entry, idx) => {
              const isActive = activeEmoji?.id != null && activeEmoji.id === entry.emoji?.id;
              return (
                <TouchableOpacity
                  key={`reaction-list-chip-${entry.emoji?.id || idx}`}
                  style={[
                    styles.chip,
                    {
                      borderColor: c.border,
                      backgroundColor: isActive ? c.surface : c.inputBackground,
                    },
                  ]}
                  onPress={() => onSelectEmoji(entry.emoji || null)}
                  activeOpacity={0.85}
                >
                  {entry.emoji?.image ? (
                    <Image source={{ uri: entry.emoji.image }} style={styles.chipEmoji} resizeMode="contain" />
                  ) : (
                    <MaterialCommunityIcons name="emoticon-outline" size={14} color={c.textSecondary} />
                  )}
                  <Text style={[styles.chipText, { color: c.textSecondary }]}>{entry.count || 0}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {/* Reactor list */}
        <View style={{ flex: 1, minHeight: 0 }}>
          {loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={c.primary} size="small" />
            </View>
          ) : users.length === 0 ? (
            <View style={styles.centerState}>
              <Text style={[styles.emptyText, { color: c.textMuted }]}>
                {t('home.reactionReactorsEmpty', { defaultValue: 'No reactions yet.' })}
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {users.map((item, idx) => {
                const username = item.reactor?.username;
                return (
                  <TouchableOpacity
                    key={`reaction-list-user-${item.id || idx}`}
                    style={[
                      styles.userRow,
                      { borderColor: c.border, backgroundColor: c.inputBackground },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => username && onSelectUser(username)}
                    disabled={!username}
                  >
                    <View style={[styles.avatar, { backgroundColor: c.primary }]}>
                      {item.reactor?.profile?.avatar ? (
                        <Image
                          source={{ uri: item.reactor.profile.avatar }}
                          style={styles.avatarImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <Text style={styles.avatarLetter}>
                          {(username?.[0] || '?').toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.username, { color: c.textPrimary }]} numberOfLines={1}>
                        @{username || t('home.unknownUser', { defaultValue: 'unknown' })}
                      </Text>
                    </View>
                    {item.emoji?.image ? (
                      <Image
                        source={{ uri: item.emoji.image }}
                        style={styles.userEmoji}
                        resizeMode="contain"
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    borderLeftWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: -3, height: 0 },
    shadowRadius: 12,
    elevation: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
    marginBottom: 6,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsScroll: {
    flexGrow: 0,
    marginBottom: 8,
  },
  chipsRow: {
    paddingHorizontal: 14,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipEmoji: { width: 14, height: 14 },
  chipText: { fontSize: 12, fontWeight: '600' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 14, paddingVertical: 8, gap: 6 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarLetter: { color: '#fff', fontWeight: '800', fontSize: 14 },
  username: { fontSize: 14, fontWeight: '600' },
  userEmoji: { width: 18, height: 18 },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: { fontSize: 13 },
});
