/**
 * ReactionPickerModal — simple native modal for picking a reaction emoji.
 *
 * Mirrors web's reaction picker but without the full emoji-group tab UI
 * (which lives inside HomeScreen and isn't portable yet). The caller hands
 * in the available reaction groups; the modal flattens them into one grid
 * so the user can tap an emoji to react. Closing happens via backdrop tap
 * or the × button.
 */

import React from 'react';
import {
  ActivityIndicator,
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
import type { ReactionGroup } from './PostCard';

type Emoji = { id?: number; image?: string };

type Props = {
  visible: boolean;
  groups: ReactionGroup[];
  loading: boolean;
  actionLoading: boolean;
  onPick: (emojiId: number) => void;
  onClose: () => void;
  c: any;
  t: (key: string, options?: any) => string;
};

export default function ReactionPickerModal({
  visible,
  groups,
  loading,
  actionLoading,
  onPick,
  onClose,
  c,
  t,
}: Props) {
  const emojis: Emoji[] = groups
    .flatMap((g) => g.emojis || [])
    .filter((e) => !!e && typeof e.id === 'number');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.headerRow}>
            <Text style={[styles.headerTitle, { color: c.textPrimary }]}>
              {t('home.reactAction', { defaultValue: 'React' })}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="close" size={20} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading && emojis.length === 0 ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : emojis.length === 0 ? (
            <Text style={[styles.emptyText, { color: c.textMuted }]}>
              {t('home.feedEmpty', { defaultValue: 'No reactions available.' })}
            </Text>
          ) : (
            <ScrollView
              contentContainerStyle={styles.grid}
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 360 }}
            >
              {emojis.map((emoji) => (
                <TouchableOpacity
                  key={emoji.id}
                  style={[
                    styles.emojiTile,
                    { borderColor: c.border, backgroundColor: c.inputBackground, opacity: actionLoading ? 0.5 : 1 },
                  ]}
                  disabled={actionLoading}
                  onPress={() => {
                    if (emoji.id != null) onPick(emoji.id);
                  }}
                  activeOpacity={0.7}
                >
                  {emoji.image ? (
                    <Image source={{ uri: emoji.image }} style={styles.emojiImage} resizeMode="contain" />
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  loadingWrap: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    padding: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emojiTile: {
    width: 46,
    height: 46,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiImage: {
    width: 30,
    height: 30,
  },
});
