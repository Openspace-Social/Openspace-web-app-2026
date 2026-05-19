/**
 * SearchResultsSkeleton — placeholder for the search results page.
 *
 * The real screen renders three sections (Users, Communities, Hashtags),
 * each as a tile grid. The skeleton mirrors that structure with three
 * section headings and a row of tiles under each.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { SkeletonBlock, SkeletonCircle, SkeletonGroup } from './Skeleton';

function ResultTile({ tone }: { tone: 'avatar' | 'hashtag' }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={[styles.tile, { borderColor: c.border, backgroundColor: c.surface }]}>
      {tone === 'avatar' ? <SkeletonCircle size={40} /> : <SkeletonBlock width={40} height={40} borderRadius={10} />}
      <View style={styles.tileText}>
        <SkeletonBlock width="70%" height={12} />
        <SkeletonBlock width="50%" height={10} style={{ marginTop: 5 }} />
      </View>
    </View>
  );
}

function ResultSection({ heading, tone, count }: { heading: string; tone: 'avatar' | 'hashtag'; count: number }) {
  return (
    <View style={styles.section}>
      <SkeletonBlock width={heading.length * 6 + 30} height={11} />
      <View style={styles.tileGrid}>
        {Array.from({ length: count }).map((_, idx) => (
          <ResultTile key={`${heading}-tile-${idx}`} tone={tone} />
        ))}
      </View>
    </View>
  );
}

export default function SearchResultsSkeleton() {
  return (
    <SkeletonGroup label="Loading search results" style={styles.container}>
      <ResultSection heading="USERS" tone="avatar" count={3} />
      <ResultSection heading="COMMUNITIES" tone="avatar" count={3} />
      <ResultSection heading="HASHTAGS" tone="hashtag" count={3} />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 20,
    padding: 16,
  },
  section: {
    gap: 10,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 220,
    flexGrow: 1,
    flexBasis: '32%',
  },
  tileText: {
    flex: 1,
  },
});
