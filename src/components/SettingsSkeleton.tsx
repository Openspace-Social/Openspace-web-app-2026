/**
 * SettingsSkeleton — placeholder for the Settings page.
 *
 * Renders a description blurb + 8 tile rows (icon square + title line +
 * subtitle line + chevron). Matches the rhythm of SettingsScreen's
 * SettingsItem rows.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { SkeletonBlock, SkeletonGroup } from './Skeleton';

export default function SettingsSkeleton({ rows = 8 }: { rows?: number }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <SkeletonGroup label="Loading settings" style={styles.container}>
      <SkeletonBlock width="80%" height={12} />
      <SkeletonBlock width="55%" height={12} style={{ marginTop: 6, marginBottom: 18 }} />
      {Array.from({ length: rows }).map((_, idx) => (
        <View
          key={`settings-row-${idx}`}
          style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          <SkeletonBlock width={36} height={36} borderRadius={10} />
          <View style={styles.text}>
            <SkeletonBlock width="50%" height={13} />
            <SkeletonBlock width="75%" height={11} style={{ marginTop: 6 }} />
          </View>
          <SkeletonBlock width={14} height={14} borderRadius={4} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
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
