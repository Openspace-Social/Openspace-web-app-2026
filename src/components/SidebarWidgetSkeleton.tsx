/**
 * SidebarWidgetSkeleton — placeholders for the four widgets framing the
 * main feed on web: profile stats card, Communities, Your Circles, and
 * Trending. Each widget sits inside the same `.sidebarWidget` container in
 * HomeScreen, so these skeletons render the inner contents only — the
 * outer card chrome stays put.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonBlock, SkeletonCircle, SkeletonGroup } from './Skeleton';

/**
 * Generic list-row skeleton for the three list widgets. `leadingShape`
 * chooses the avatar shape to match what the widget would normally show:
 *   - 'circle' for community/user avatars
 *   - 'dot' for circle color swatches
 *   - 'hashtag' for trending (no leading shape, text-only)
 */
export function SidebarListRowSkeletonList({
  count = 3,
  leadingShape = 'circle',
}: {
  count?: number;
  leadingShape?: 'circle' | 'dot' | 'hashtag';
}) {
  return (
    <SkeletonGroup label="Loading">
      {Array.from({ length: count }).map((_, idx) => (
        <View key={`sidebar-row-${idx}`} style={styles.row}>
          {leadingShape === 'circle' ? <SkeletonCircle size={28} /> : null}
          {leadingShape === 'dot' ? <SkeletonCircle size={14} /> : null}
          <View style={styles.rowText}>
            <SkeletonBlock width="80%" height={11} />
            <SkeletonBlock width="55%" height={9} style={{ marginTop: 5 }} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

/**
 * Skeleton for the left-rail profile card: avatar + name/handle lines +
 * three stat columns + a "View Profile" button placeholder.
 */
export function SidebarProfileStatsSkeleton() {
  return (
    <SkeletonGroup label="Loading profile">
      <View style={styles.profileRow}>
        <SkeletonCircle size={48} />
        <View style={styles.profileText}>
          <SkeletonBlock width="80%" height={13} />
          <SkeletonBlock width="55%" height={10} style={{ marginTop: 6 }} />
        </View>
      </View>
      <View style={styles.statsRow}>
        {[0, 1, 2].map((idx) => (
          <View key={`stat-${idx}`} style={styles.statCol}>
            <SkeletonBlock width={28} height={14} />
            <SkeletonBlock width={44} height={9} style={{ marginTop: 5 }} />
          </View>
        ))}
      </View>
      <SkeletonBlock width="100%" height={32} borderRadius={10} style={{ marginTop: 10 }} />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  rowText: {
    flex: 1,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileText: {
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 14,
  },
  statCol: {
    alignItems: 'center',
  },
});
