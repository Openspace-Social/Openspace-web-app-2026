/**
 * CommentRowSkeleton — single comment placeholder.
 *
 * Small avatar circle on the left, name line + 2 body lines on the right.
 * Three of these stacked is enough to hint at the comments area before the
 * data lands.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonBlock, SkeletonCircle, SkeletonGroup } from './Skeleton';

export default function CommentRowSkeleton() {
  return (
    <SkeletonGroup label="Loading comment" style={styles.row}>
      <SkeletonCircle size={28} />
      <View style={styles.text}>
        <SkeletonBlock width={110} height={10} />
        <SkeletonBlock width="92%" height={10} style={{ marginTop: 6 }} />
        <SkeletonBlock width="64%" height={10} style={{ marginTop: 6 }} />
      </View>
    </SkeletonGroup>
  );
}

/** Convenience: render N stacked comment skeletons. */
export function CommentRowSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, idx) => (
        <CommentRowSkeleton key={`comment-skeleton-${idx}`} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  text: {
    flex: 1,
    paddingTop: 4,
  },
  list: {
    gap: 14,
  },
});
