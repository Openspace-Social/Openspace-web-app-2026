import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { FeedPost } from '../api/client';

type Props = {
  styles: any;
  c: any;
  t: (key: string, options?: any) => string;
  feedLoading: boolean;
  feedError: string;
  feedPosts: FeedPost[];
  activeFeed: string;
  renderPostCard: (post: FeedPost, variant: 'feed' | 'profile') => React.ReactNode;
};

export default function FeedScreen({
  styles,
  c,
  t,
  feedLoading,
  feedError,
  feedPosts,
  activeFeed,
  renderPostCard,
}: Props) {
  return (
    <View style={[styles.feedCard, { backgroundColor: c.surface, borderColor: c.border }]}>
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
        </View>
      )}
    </View>
  );
}
