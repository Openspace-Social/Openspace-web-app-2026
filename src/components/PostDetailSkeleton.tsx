/**
 * PostDetailSkeleton — placeholder for the post-detail surface while the
 * post is being fetched.
 *
 * Composes a PostCardSkeleton at the top (mirrors how the real screen leads
 * with the post body) and three CommentRowSkeletons below to telegraph the
 * comments section. Sits inside the same dark/light background the real
 * detail screen uses.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { SkeletonGroup } from './Skeleton';
import PostCardSkeleton from './PostCardSkeleton';
import CommentRowSkeleton from './CommentRowSkeleton';

export default function PostDetailSkeleton() {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <ScrollView
      contentContainerStyle={[styles.container, { backgroundColor: c.background }]}
      showsVerticalScrollIndicator={false}
    >
      <SkeletonGroup label="Loading post" style={styles.inner}>
        <PostCardSkeleton withMedia />
        <View style={styles.comments}>
          <CommentRowSkeleton />
          <CommentRowSkeleton />
          <CommentRowSkeleton />
        </View>
      </SkeletonGroup>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 80,
  },
  inner: {
    gap: 16,
  },
  comments: {
    gap: 12,
    marginTop: 8,
  },
});
