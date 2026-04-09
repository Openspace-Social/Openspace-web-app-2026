import React from 'react';
import { Text, View } from 'react-native';

type Props = {
  styles: any;
  c: any;
  title: string;
  subtitle: string;
};

export default function RouteSummaryCard({ styles, c, title, subtitle }: Props) {
  return (
    <View style={[styles.feedCard, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text style={[styles.welcome, { color: c.textPrimary }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: c.textMuted }]}>{subtitle}</Text>
    </View>
  );
}
