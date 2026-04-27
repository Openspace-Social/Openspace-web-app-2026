/**
 * FeedPostPreview — a read-only post card used by the new navigator-side
 * FeedScreen while the full PostCard interaction surface (reactions, comments,
 * reposts, sharing) is still owned by HomeScreen.
 *
 * Shows the essentials: creator, text, first image, counts. Tapping the card
 * opens the post detail screen; tapping the avatar / creator name / community
 * chip navigates to the corresponding profile / community. All other actions
 * (react, comment, share) fire an "onStubAction" callback so the container can
 * surface a "coming soon" toast.
 *
 * Replaces with full PostCard once PostInteractionsContext is built out.
 */

import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { FeedPost } from '../api/client';

type Props = {
  post: FeedPost;
  c: any;
  t: (key: string, options?: any) => string;
  onOpenDetail: (post: FeedPost) => void;
  onOpenProfile: (username: string) => void;
  onOpenCommunity: (name: string) => void;
  onStubAction: (label: string) => void;
  /** Reaction integration — when any of these are missing the card falls back to stubs. */
  reactionGroups?: any[];
  reactionActionLoading?: boolean;
  onOpenReactions?: () => void;
  onReact?: (post: FeedPost, emojiId: number) => void;
};

function firstImageUri(post: FeedPost): string | undefined {
  const media = (post as any)?.media;
  if (!Array.isArray(media)) return undefined;
  for (const m of media) {
    const type = m?.type;
    const url = m?.url;
    if (typeof url === 'string' && (type === 'I' || type === undefined)) {
      return url;
    }
  }
  return undefined;
}

function reactionCount(post: FeedPost): number {
  return (post.reactions_emoji_counts || []).reduce((sum, item: any) => sum + (item?.count || 0), 0);
}

export default function FeedPostPreview({
  post,
  c,
  t,
  onOpenDetail,
  onOpenProfile,
  onOpenCommunity,
  onStubAction,
  reactionGroups,
  reactionActionLoading,
  onOpenReactions,
  onReact,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const myReactionEmojiId: number | undefined = (post as any)?.reaction?.emoji?.id;
  const reactionsSupported = !!onReact && !!onOpenReactions;
  const creator = (post as any)?.creator;
  const creatorUsername: string | undefined = creator?.username;
  const creatorAvatar: string | undefined = creator?.avatar || creator?.profile?.avatar;
  const community = (post as any)?.community;
  const communityName: string | undefined = community?.name;
  const text: string = (post as any)?.text || '';
  const image = firstImageUri(post);
  const createdAt = (post as any)?.created ? new Date((post as any).created).toLocaleString() : '';
  const reactions = reactionCount(post);
  const comments = (post as any)?.comments_count || 0;
  const reposts = (post as any)?.reposts_count || 0;

  return (
    <Pressable
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
      onPress={() => onOpenDetail(post)}
      android_ripple={{ color: `${c.primary}15` }}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => creatorUsername && onOpenProfile(creatorUsername)}
          activeOpacity={0.75}
          style={[styles.avatar, { backgroundColor: c.primary }]}
        >
          {creatorAvatar ? (
            <Image source={{ uri: creatorAvatar }} style={styles.avatarImg} resizeMode="cover" />
          ) : (
            <Text style={styles.avatarLetter}>{(creatorUsername?.[0] || 'O').toUpperCase()}</Text>
          )}
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <TouchableOpacity
            onPress={() => creatorUsername && onOpenProfile(creatorUsername)}
            activeOpacity={0.75}
          >
            <Text style={[styles.username, { color: c.textPrimary }]} numberOfLines={1}>
              @{creatorUsername || '—'}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.date, { color: c.textMuted }]} numberOfLines={1}>{createdAt}</Text>
        </View>
        {communityName ? (
          <TouchableOpacity
            onPress={() => onOpenCommunity(communityName)}
            activeOpacity={0.75}
            style={[styles.communityChip, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          >
            <Text style={[styles.communityChipText, { color: c.textSecondary }]} numberOfLines={1}>
              c/{communityName}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {text ? (
        <Text style={[styles.text, { color: c.textPrimary }]} numberOfLines={8}>
          {text}
        </Text>
      ) : null}

      {image ? (
        <View style={styles.imageWrap}>
          <Image source={{ uri: image }} style={styles.image} resizeMode="cover" />
        </View>
      ) : null}

      <View style={[styles.statsRow, { borderTopColor: c.border, borderBottomColor: c.border }]}>
        <Text style={[styles.stat, { color: c.textMuted }]}>
          {t('home.feedReactionsCount', { count: reactions, defaultValue: `${reactions} reactions` })}
        </Text>
        <Text style={[styles.stat, { color: c.textMuted }]}>
          {t('home.feedCommentsCount', { count: comments, defaultValue: `${comments} comments` })}
        </Text>
        {reposts > 0 ? (
          <Text style={[styles.stat, { color: c.textMuted }]}>
            {t('home.feedRepostsCount', { count: reposts, defaultValue: `${reposts} reposts` })}
          </Text>
        ) : null}
      </View>

      {pickerOpen && reactionsSupported ? (
        <ReactionPickerStrip
          groups={reactionGroups || []}
          loading={!!reactionActionLoading}
          c={c}
          onSelect={(emojiId) => {
            setPickerOpen(false);
            onReact?.(post, emojiId);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      <View style={styles.actionsRow}>
        <ActionButton
          icon={myReactionEmojiId ? 'emoticon' : 'emoticon-outline'}
          label={t('home.reactAction', { defaultValue: 'React' })}
          c={c}
          active={!!myReactionEmojiId}
          onPress={() => {
            if (!reactionsSupported) {
              onStubAction(t('home.reactAction', { defaultValue: 'React' }));
              return;
            }
            onOpenReactions?.();
            setPickerOpen((v) => !v);
          }}
        />
        <ActionButton
          icon="comment-outline"
          label={t('home.commentAction', { defaultValue: 'Comment' })}
          c={c}
          onPress={() => onOpenDetail(post)}
        />
        <ActionButton
          icon="repeat-variant"
          label={t('home.repostAction', { defaultValue: 'Repost' })}
          c={c}
          onPress={() => onStubAction(t('home.repostAction', { defaultValue: 'Repost' }))}
        />
        <ActionButton
          icon="share-variant-outline"
          label={t('home.shareAction', { defaultValue: 'Share' })}
          c={c}
          onPress={() => onStubAction(t('home.shareAction', { defaultValue: 'Share' }))}
        />
      </View>
    </Pressable>
  );
}

function ReactionPickerStrip({
  groups,
  loading,
  c,
  onSelect,
  onClose,
}: {
  groups: any[];
  loading: boolean;
  c: any;
  onSelect: (emojiId: number) => void;
  onClose: () => void;
}) {
  // Flatten all emojis across groups into one horizontal-scrollable strip.
  const emojis = groups.flatMap((g: any) => g?.emojis || []).filter((e: any) => e?.id && e?.image);
  return (
    <View
      style={[
        styles.pickerStrip,
        { borderColor: c.border, backgroundColor: c.inputBackground },
      ]}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerStripContent}>
        {emojis.map((emoji: any) => (
          <TouchableOpacity
            key={`picker-${emoji.id}`}
            onPress={() => onSelect(emoji.id)}
            disabled={loading}
            activeOpacity={0.7}
            style={[styles.pickerEmojiBtn, { opacity: loading ? 0.5 : 1 }]}
            accessibilityLabel={emoji.keyword || 'emoji'}
          >
            <Image source={{ uri: emoji.image }} style={styles.pickerEmojiImg} resizeMode="contain" />
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TouchableOpacity
        onPress={onClose}
        style={[styles.pickerCloseBtn, { borderColor: c.border }]}
        accessibilityLabel="Close reaction picker"
      >
        <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  c,
  onPress,
  active,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  c: any;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.actionBtn,
        { borderColor: active ? c.primary : c.border, backgroundColor: c.inputBackground },
      ]}
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons name={icon} size={22} color={active ? c.primary : c.textSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarLetter: { color: '#fff', fontSize: 16, fontWeight: '700' },
  username: { fontSize: 15, fontWeight: '700' },
  date: { fontSize: 12, marginTop: 1 },
  communityChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 140,
  },
  communityChipText: { fontSize: 12, fontWeight: '600' },
  text: { fontSize: 15, lineHeight: 22, marginBottom: 10 },
  imageWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 10,
  },
  image: { width: '100%', height: '100%' },
  statsRow: {
    flexDirection: 'row',
    gap: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginBottom: 8,
  },
  stat: { fontSize: 13, fontWeight: '600' },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 8,
    paddingRight: 4,
  },
  pickerStripContent: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
  },
  pickerEmojiBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmojiImg: { width: 24, height: 24 },
  pickerCloseBtn: {
    width: 32,
    height: 32,
    marginLeft: 4,
    borderLeftWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
