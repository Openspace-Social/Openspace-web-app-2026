/**
 * PostCardSkeleton — placeholder shape rendered while the feed is loading.
 *
 * Approximates a PostCard's layout (avatar circle, header lines, body lines,
 * media block, action row) so the user sees something with the right rhythm
 * the moment the page mounts. Three of these stacked is enough — anything
 * past the fold gets hidden anyway.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { SkeletonBlock, SkeletonCircle, SkeletonGroup } from './Skeleton';

export default function PostCardSkeleton({ withMedia = true }: { withMedia?: boolean }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <SkeletonGroup
      label="Loading post"
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
    >
      <View style={styles.headerRow}>
        <SkeletonCircle size={40} />
        <View style={styles.headerText}>
          <SkeletonBlock width={140} height={12} />
          <SkeletonBlock width={90} height={10} style={{ marginTop: 6 }} />
        </View>
      </View>

      <View style={styles.body}>
        <SkeletonBlock width="92%" height={12} />
        <SkeletonBlock width="78%" height={12} style={{ marginTop: 8 }} />
        <SkeletonBlock width="40%" height={12} style={{ marginTop: 8 }} />
      </View>

      {withMedia ? (
        <SkeletonBlock width="100%" height={220} borderRadius={12} style={styles.media} />
      ) : null}

      <View style={styles.actions}>
        <SkeletonBlock width={56} height={20} borderRadius={10} />
        <SkeletonBlock width={56} height={20} borderRadius={10} />
        <SkeletonBlock width={56} height={20} borderRadius={10} />
      </View>
    </SkeletonGroup>
  );
}

/** Stack a few skeletons to fill the feed area. */
export function PostCardSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, idx) => (
        <PostCardSkeleton key={`post-skeleton-${idx}`} withMedia={idx % 2 === 0} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  body: {
    marginTop: 14,
  },
  media: {
    marginTop: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 14,
  },
});
