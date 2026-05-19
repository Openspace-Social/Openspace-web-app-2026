/**
 * ListPageSkeleton — placeholder for main-content list pages: Circles,
 * Lists, Followers / Following / Blocked.
 *
 * Each row is a leading avatar/dot + title line + subtitle line + a small
 * trailing button placeholder (where the real screen has Follow / Manage /
 * Add buttons). Matches the rhythm of these screens closely enough that
 * the swap into the real list doesn't shift the page.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { SkeletonBlock, SkeletonCircle, SkeletonGroup } from './Skeleton';

export default function ListPageSkeleton({
  count = 6,
  leadingShape = 'avatar',
  withTrailingButton = true,
}: {
  count?: number;
  leadingShape?: 'avatar' | 'dot' | 'none';
  withTrailingButton?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <SkeletonGroup label="Loading" style={styles.container}>
      {Array.from({ length: count }).map((_, idx) => (
        <View
          key={`list-skeleton-${idx}`}
          style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          {leadingShape === 'avatar' ? <SkeletonCircle size={40} /> : null}
          {leadingShape === 'dot' ? <SkeletonCircle size={18} /> : null}
          <View style={styles.text}>
            <SkeletonBlock width="55%" height={13} />
            <SkeletonBlock width="35%" height={11} style={{ marginTop: 6 }} />
          </View>
          {withTrailingButton ? (
            <SkeletonBlock width={84} height={32} borderRadius={10} />
          ) : null}
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  text: {
    flex: 1,
  },
});
