import React from 'react';
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FeedPost } from '../api/client';

type Props = {
  styles: any;
  c: any;
  t: (key: string, options?: any) => string;
  user: any;
  onComposerPress: () => void;
  onComposerActionPress: (action: 'video' | 'image' | 'emoji') => void;
  feedLoading: boolean;
  feedError: string;
  feedPosts: FeedPost[];
  activeFeed: string;
  feedLoadingMore?: boolean;
  feedHasMore?: boolean;
  renderPostCard: (post: FeedPost, variant: 'feed' | 'profile') => React.ReactNode;
};

export default function FeedScreen({
  styles,
  c,
  t,
  user,
  onComposerPress,
  onComposerActionPress,
  feedLoading,
  feedError,
  feedPosts,
  activeFeed,
  feedLoadingMore = false,
  feedHasMore = false,
  renderPostCard,
}: Props) {
  const composerName = user?.profile?.name || user?.username || 'there';
  const composerAvatar = user?.profile?.avatar;
  const composerInitial = (user?.username?.[0] || 'O').toUpperCase();

  return (
    <View style={[styles.feedCard, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={[styles.feedComposerCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
        <View style={styles.feedComposerTop}>
          <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}>
            {composerAvatar ? (
              <Image
                source={{ uri: composerAvatar }}
                style={styles.feedAvatarImage}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.feedAvatarLetter}>{composerInitial}</Text>
            )}
          </View>
          <TouchableOpacity
            style={[styles.feedComposerInputMock, { borderColor: c.border, backgroundColor: c.surface }]}
            activeOpacity={0.85}
            onPress={onComposerPress}
          >
            <Text numberOfLines={1} style={[styles.feedComposerInputText, { color: c.textMuted }]}>
              {t('home.feedComposerPrompt', {
                name: composerName,
                defaultValue: "What's on your mind, {{name}}?",
              })}
            </Text>
          </TouchableOpacity>
          <View style={styles.feedComposerActions}>
            <TouchableOpacity
              style={styles.feedComposerActionButton}
              activeOpacity={0.85}
              onPress={() => onComposerActionPress('video')}
            >
              <MaterialCommunityIcons name="video" size={26} color="#ff2d55" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.feedComposerActionButton}
              activeOpacity={0.85}
              onPress={() => onComposerActionPress('image')}
            >
              <MaterialCommunityIcons name="image" size={26} color="#22c55e" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.feedComposerActionButton}
              activeOpacity={0.85}
              onPress={() => onComposerActionPress('emoji')}
            >
              <MaterialCommunityIcons name="emoticon-happy-outline" size={28} color="#f59e0b" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {feedLoading ? (
        <ActivityIndicator color={c.primary} size="small" style={styles.feedLoading} />
      ) : feedError ? (
        <Text style={[styles.feedErrorText, { color: c.errorText }]}>{feedError}</Text>
      ) : feedPosts.length === 0 ? (
        <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>
          {t('home.feedEmpty')}
        </Text>
      ) : (
        <View style={styles.feedList}>
          {feedPosts.map((post) => (
            <React.Fragment key={`${activeFeed}-${post.id}`}>
              {renderPostCard(post, 'feed')}
            </React.Fragment>
          ))}
          {feedLoadingMore ? (
            <ActivityIndicator color={c.primary} size="small" style={{ paddingVertical: 20 }} />
          ) : !feedHasMore && feedPosts.length > 0 ? (
            <Text style={{ textAlign: 'center', paddingVertical: 20, fontSize: 13, color: c.textMuted }}>
              {t('home.feedEndOfResults', { defaultValue: "You're all caught up!" })}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
