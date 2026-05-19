/**
 * ProfileSkeleton — full-screen placeholder for the user profile page on web.
 *
 * Mirrors the gross layout of MyProfileScreen / PublicProfileScreen: cover
 * banner, overlapping avatar, name + handle + bio lines, action button row,
 * tab strip, then two PostCardSkeletons. Renders edge-to-edge or inside the
 * profile card chrome depending on `isEdgeToEdge`, matching the real screen
 * so swapping the skeleton out for real content doesn't create a layout jump.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { SkeletonBlock, SkeletonCircle, SkeletonGroup } from './Skeleton';
import PostCardSkeleton from './PostCardSkeleton';

export default function ProfileSkeleton({
  isCompactProfileLayout = false,
  isEdgeToEdge = false,
}: {
  isCompactProfileLayout?: boolean;
  isEdgeToEdge?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const coverHeight = isCompactProfileLayout ? 160 : 220;
  const avatarSize = isCompactProfileLayout ? 96 : 180;

  return (
    <SkeletonGroup
      label="Loading profile"
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
      <SkeletonBlock width="100%" height={coverHeight} borderRadius={0} />

      <View
        style={[
          styles.identityRow,
          isCompactProfileLayout && styles.identityRowCompact,
        ]}
      >
        <View
          style={[
            styles.avatarWrap,
            isCompactProfileLayout && { marginTop: -32 },
          ]}
        >
          <SkeletonCircle size={avatarSize} />
        </View>
        <View style={styles.identityText}>
          <SkeletonBlock width={180} height={20} />
          <SkeletonBlock width={120} height={12} style={{ marginTop: 8 }} />
          <SkeletonBlock width="80%" height={12} style={{ marginTop: 12 }} />
          <SkeletonBlock width="60%" height={12} style={{ marginTop: 6 }} />
        </View>
      </View>

      <View style={styles.actionRow}>
        <SkeletonBlock width={120} height={36} borderRadius={10} />
        <SkeletonBlock width={120} height={36} borderRadius={10} />
        <SkeletonBlock width={40} height={36} borderRadius={10} />
      </View>

      <View style={styles.tabRow}>
        <SkeletonBlock width={70} height={14} />
        <SkeletonBlock width={90} height={14} />
        <SkeletonBlock width={80} height={14} />
        <SkeletonBlock width={70} height={14} />
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
  identityRowCompact: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  avatarWrap: {
    marginTop: -60,
  },
  identityText: {
    flex: 1,
    paddingTop: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 24,
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#0000',
  },
  posts: {
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
});
