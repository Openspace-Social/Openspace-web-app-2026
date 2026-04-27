import React from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type Badge = {
  keyword?: string;
  keyword_description?: string;
};

type Props = {
  badges?: Badge[] | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

// Mirrors OpenSpace-Web/components/user-badges/OkUserBadge.vue. Each known
// keyword from the API fixture (badges.json) gets a distinct icon + color so
// users can see at a glance which kind of badge a profile holds. Unknown
// keywords render nothing rather than a broken placeholder.
const BADGE_VISUALS: Record<string, { icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string }> = {
  VERIFIED: { icon: 'check-decagram', color: '#1d9bf0' },
  ANGEL: { icon: 'heart-circle', color: '#e91e63' },
  FOUNDER: { icon: 'seal', color: '#64dd17' },
  GOLDEN_FOUNDER: { icon: 'seal-variant', color: '#f9a825' },
  DIAMOND_FOUNDER: { icon: 'diamond-stone', color: '#e57373' },
  SUPER_FOUNDER: { icon: 'crown', color: '#9575cd' },
};

export default function UserBadge({ badges, size = 22, style }: Props) {
  if (!Array.isArray(badges) || badges.length === 0) return null;

  const visibleBadges = badges
    .map((badge) => {
      const visual = BADGE_VISUALS[(badge?.keyword || '').toUpperCase()];
      if (!visual) return null;
      return { badge, visual };
    })
    .filter((entry): entry is { badge: Badge; visual: { icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string } } => entry !== null);

  if (visibleBadges.length === 0) return null;

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 4 }, style]}>
      {visibleBadges.map(({ badge, visual }, idx) => (
        <MaterialCommunityIcons
          key={`${badge.keyword || 'badge'}-${idx}`}
          name={visual.icon}
          size={size}
          color={visual.color}
          accessibilityLabel={badge.keyword_description || badge.keyword}
        />
      ))}
    </View>
  );
}
