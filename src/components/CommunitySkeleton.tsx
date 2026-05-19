/**
 * CommunitySkeleton — placeholder for the community profile page while the
 * community info + posts are being fetched.
 *
 * Mirrors CommunityProfileScreen: cover banner, overlapping community
 * avatar, name + handle + about lines, action button row, a slim member
 * strip, then two post-card skeletons. Honors `isEdgeToEdge` so the swap
 * into the real screen doesn't shift the layout.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { SkeletonBlock, SkeletonCircle, SkeletonGroup } from './Skeleton';
import PostCardSkeleton from './PostCardSkeleton';

export default function CommunitySkeleton({
  isEdgeToEdge = false,
}: {
  isEdgeToEdge?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <SkeletonGroup
      label="Loading community"
      style={[
        styles.outer,
        !isEdgeToEdge
          ? {
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 16,
              backgroundColor: c.surface,
              overflow: 'hidden',
            }
          : undefined,
      ]}
    >
      <SkeletonBlock width="100%" height={180} borderRadius={0} />

      <View style={styles.identityRow}>
        <View style={styles.avatarWrap}>
          <SkeletonBlock width={120} height={120} borderRadius={20} />
        </View>
        <View style={styles.identityText}>
          <SkeletonBlock width={220} height={20} />
          <SkeletonBlock width={120} height={12} style={{ marginTop: 8 }} />
          <SkeletonBlock width="90%" height={12} style={{ marginTop: 14 }} />
          <SkeletonBlock width="72%" height={12} style={{ marginTop: 6 }} />
        </View>
      </View>

      <View style={styles.actionRow}>
        <SkeletonBlock width={120} height={36} borderRadius={10} />
        <SkeletonBlock width={120} height={36} borderRadius={10} />
        <SkeletonBlock width={40} height={36} borderRadius={10} />
      </View>

      <View style={styles.memberRow}>
        <SkeletonCircle size={28} />
        <SkeletonCircle size={28} style={{ marginLeft: -8 }} />
        <SkeletonCircle size={28} style={{ marginLeft: -8 }} />
        <SkeletonCircle size={28} style={{ marginLeft: -8 }} />
        <SkeletonBlock width={90} height={12} style={{ marginLeft: 12 }} />
      </View>

      <View style={styles.posts}>
        <PostCardSkeleton withMedia />
        <PostCardSkeleton withMedia={false} />
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: '100%',
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 20,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  avatarWrap: {
    marginTop: -48,
  },
  identityText: {
    flex: 1,
    paddingTop: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 18,
  },
  posts: {
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
});
