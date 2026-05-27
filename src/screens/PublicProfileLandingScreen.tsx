import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { api, FeedPost, UserProfile } from '../api/client';
import FederationSummaryCard from '../components/FederationSummaryCard';
import LinkifyText from '../components/LinkifyText';
import { useTheme } from '../theme/ThemeContext';
import { useTranslation } from 'react-i18next';
import {
  trackFederationVisitorProfileVisit,
  type FederationPreferredAuthMode,
} from '../utils/federationAttribution';

const DEFAULT_PROFILE_AVATAR = require('../../assets/default-profile-avatar.png');

type Props = {
  username: string;
  onLoginPress: (preferredAuthMode?: FederationPreferredAuthMode) => void;
};

export default function PublicProfileLandingScreen({ username, onLoginPress }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isWide = width >= 1080;
  const isTablet = width >= 760;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void trackFederationVisitorProfileVisit(
      username,
      typeof window !== 'undefined' && window.location ? window.location.pathname : `/u/${username}`
    );
  }, [username]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.getUserProfile(null, username),
      api.getUserPosts(null, username, 6),
    ])
      .then(([nextProfile, nextPosts]) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setPosts(nextPosts);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message || 'Could not load profile.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [username]);

  const avatarUri = profile?.profile?.avatar?.trim();
  const displayName = profile?.profile?.name || `@${profile?.username || username}`;
  const bio = profile?.profile?.bio?.trim();
  const location = profile?.profile?.location?.trim();
  const url = profile?.profile?.url?.trim();
  const coverUri = profile?.profile?.cover?.trim();
  const publicPostsCount = typeof profile?.posts_count === 'number' ? profile.posts_count : posts.length;
  // Source publishers (is_source=true) can't follow other accounts, so the
  // "Following" tile would always read 0. Skip it on Source profile pages
  // and let Followers + Posts dominate the hero metrics row.
  const heroMetrics = [
    {
      value: profile?.followers_count ?? 0,
      label: t('publicProfile.heroFollowersMetric', { defaultValue: 'Followers' }),
    },
    ...(profile?.is_source
      ? []
      : [
          {
            value: profile?.following_count ?? 0,
            label: t('publicProfile.heroFollowingMetric', { defaultValue: 'Following' }),
          },
        ]),
    {
      value: publicPostsCount,
      label: t('publicProfile.heroPostsMetric', { defaultValue: 'Public posts' }),
    },
  ];

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <View style={[styles.topBar, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={styles.topBarBrand}>
          <View style={[styles.logoMark, { backgroundColor: c.primary }]}>
            <Text style={styles.logoMarkText}>O</Text>
          </View>
          <Text style={[styles.appName, { color: c.textPrimary }]}>
            Openspace<Text style={{ color: c.textMuted }}>.Social</Text>
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.signInButton, { backgroundColor: c.primary }]}
          onPress={() => onLoginPress()}
          activeOpacity={0.85}
        >
          <Text style={styles.signInButtonText}>{t('auth.signIn', { defaultValue: 'Sign In' })}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.primary} size="large" />
        </View>
      ) : error || !profile ? (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="alert-circle-outline" size={48} color={c.textMuted} />
          <Text style={[styles.errorText, { color: c.textMuted }]}>
            {error || t('home.profileLoadError', { defaultValue: 'Profile not found.' })}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, isWide ? styles.scrollContentWide : null]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.heroCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={[styles.heroCover, { backgroundColor: `${c.primary}18` }]}>
              {coverUri ? (
                <ImageBackground source={{ uri: coverUri }} style={styles.heroCoverImage} resizeMode="cover">
                  <View style={styles.heroCoverOverlay} />
                </ImageBackground>
              ) : (
                <>
                  <View style={[styles.orbLarge, { backgroundColor: `${c.primary}22` }]} />
                  <View style={[styles.orbSmall, { backgroundColor: `${c.primary}16` }]} />
                </>
              )}
              <View style={styles.heroBadgeRow}>
                <View style={[styles.heroBadge, { backgroundColor: `${c.surface}E6`, borderColor: `${c.surface}66` }]}>
                  <MaterialCommunityIcons name="earth" size={14} color={c.primary} />
                  <Text style={[styles.heroBadgeText, { color: c.textPrimary }]}>
                    {t('publicProfile.heroBadge', { defaultValue: 'Fediverse profile' })}
                  </Text>
                </View>
              </View>
            </View>

            <View style={[styles.heroBody, isTablet ? styles.heroBodyWide : null]}>
              <View style={[styles.heroIntro, isWide ? styles.heroIntroWide : null]}>
                <View style={[styles.heroIdentity, isWide ? styles.heroIdentityWide : null]}>
                  <View style={[styles.avatarWrap, { borderColor: c.surface }]}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.avatarImage} resizeMode="cover" />
                    ) : (
                      <Image source={DEFAULT_PROFILE_AVATAR} style={styles.avatarImage} resizeMode="cover" />
                    )}
                  </View>

                  <View style={[styles.heroText, isWide ? styles.heroTextWide : null]}>
                    <Text style={[styles.eyebrow, { color: c.primary }]}>
                      {t('publicProfile.eyebrow', { defaultValue: 'Public profile on OpenSpace' })}
                    </Text>
                    <Text style={[styles.displayName, { color: c.textPrimary }]}>{displayName}</Text>
                    <Text style={[styles.username, { color: c.textMuted }]}>@{profile.username || username}</Text>
                    {location ? (
                      <Text style={[styles.metaText, { color: c.textMuted }]}>{location}</Text>
                    ) : null}
                    <Text style={[styles.valueLine, { color: c.textSecondary }]}>
                      {t('publicProfile.valueLine', {
                        defaultValue: 'Discover public posts, see fediverse reach, and join the conversation directly on OpenSpace.',
                      })}
                    </Text>
                    {bio ? (
                      <LinkifyText
                        text={bio}
                        style={[styles.bioText, { color: c.textSecondary }]}
                        linkColor={c.primary}
                        onPressLink={(linkUrl) => Linking.openURL(linkUrl)}
                      />
                    ) : null}
                    {url ? (
                      <TouchableOpacity onPress={() => Linking.openURL(url)} activeOpacity={0.8}>
                        <Text style={[styles.linkText, { color: c.primary }]}>{url}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                <View style={[styles.heroSocialProof, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                  <Text style={[styles.heroSocialProofTitle, { color: c.textPrimary }]}>
                    {t('publicProfile.socialProofTitle', { defaultValue: 'Already live beyond OpenSpace' })}
                  </Text>
                  <Text style={[styles.heroSocialProofBody, { color: c.textSecondary }]}>
                    {t('publicProfile.socialProofBody', {
                      defaultValue: 'This profile is publicly reachable, discoverable across the fediverse, and gives visitors a richer home for identity, posts, and communities.',
                    })}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.heroRail,
                  isWide ? styles.heroRailWide : null,
                  { backgroundColor: c.inputBackground, borderColor: c.border },
                ]}
              >
                <Text style={[styles.heroRailTitle, { color: c.textPrimary }]}>
                  {t('publicProfile.joinRailTitle', { defaultValue: 'Join OpenSpace to participate directly' })}
                </Text>
                <Text style={[styles.heroRailBody, { color: c.textSecondary }]}>
                  {t('publicProfile.joinRailBody', {
                    defaultValue: 'Bring your Mastodon identity, keep your audience, and cross-post instead of starting over.',
                  })}
                </Text>
                <View style={styles.heroRailList}>
                  {[
                    t('publicProfile.railPointOne', { defaultValue: 'Follow, reply, and post from an OpenSpace profile that already reaches the fediverse' }),
                    t('publicProfile.railPointTwo', { defaultValue: 'Keep your Mastodon audience in view while building your OpenSpace presence' }),
                    t('publicProfile.railPointThree', { defaultValue: 'Cross-post instead of starting from zero on a new network' }),
                  ].map((point) => (
                    <View key={point} style={styles.heroRailItem}>
                      <View style={[styles.heroRailDot, { backgroundColor: c.primary }]} />
                      <Text style={[styles.heroRailItemText, { color: c.textSecondary }]}>{point}</Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity
                  style={[styles.primaryCta, styles.primaryCtaFull, { backgroundColor: c.primary }]}
                  onPress={() => onLoginPress('signup')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryCtaText}>
                    {t('publicProfile.joinCta', { defaultValue: 'Join OpenSpace to follow, post, and participate directly' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryCta, { borderColor: c.border, backgroundColor: c.background }]}
                  onPress={() => onLoginPress('mastodon')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.secondaryCtaText, { color: c.textLink }]}>
                    {t('publicProfile.secondaryJoinCta', { defaultValue: 'Bring your Mastodon identity' })}
                  </Text>
                </TouchableOpacity>
                <Text style={[styles.ctaHint, { color: c.textMuted }]}>
                  {t('publicProfile.joinHint', {
                    defaultValue: 'Keep your audience, cross-post when you want to, and participate from one place.',
                  })}
                </Text>
              </View>
            </View>

            <View style={styles.metricRow}>
              {heroMetrics.map((metric) => (
                <View key={metric.label} style={[styles.metricCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                  <Text style={[styles.metricValue, { color: c.textPrimary }]}>{metric.value}</Text>
                  <Text style={[styles.metricLabel, { color: c.textSecondary }]}>{metric.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.mainGrid, isWide ? styles.mainGridWide : null]}>
            <View style={styles.mainColumn}>
              <FederationSummaryCard c={c} t={t} summary={profile.federation_summary} />

              <View style={[styles.postsCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={[styles.sectionEyebrow, { color: c.primary }]}>
                      {t('publicProfile.postsEyebrow', { defaultValue: 'Public timeline' })}
                    </Text>
                    <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
                      {t('publicProfile.recentPostsTitle', { defaultValue: 'Recent public posts' })}
                    </Text>
                  </View>
                  <View style={[styles.sectionPill, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
                    <Text style={[styles.sectionPillText, { color: c.textSecondary }]}>
                      {t('publicProfile.postsPill', { defaultValue: 'Open on the web' })}
                    </Text>
                  </View>
                </View>
                {posts.length ? (
                  posts.map((post, index) => (
                    <View
                      key={post.id || post.uuid}
                      style={[
                        styles.postCard,
                        { backgroundColor: c.inputBackground, borderColor: c.border },
                        index === 0 ? styles.postCardFirst : null,
                      ]}
                    >
                      <Text style={[styles.postText, { color: c.textSecondary }]} numberOfLines={5}>
                        {post.long_text || post.text || t('publicProfile.emptyPostFallback', { defaultValue: 'Shared a post.' })}
                      </Text>
                      <View style={styles.postFooter}>
                        <Text style={[styles.postMeta, { color: c.textMuted }]}>
                          {post.created ? new Date(post.created).toLocaleString() : ''}
                        </Text>
                        <Text style={[styles.postMeta, { color: c.textMuted }]}>
                          {t('publicProfile.publicPostBadge', { defaultValue: 'Public' })}
                        </Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={[styles.emptyText, { color: c.textMuted }]}>
                    {t('publicProfile.noPosts', { defaultValue: 'No public posts to show yet.' })}
                  </Text>
                )}
              </View>
            </View>

            <View style={[styles.sideColumn, isWide ? styles.sideColumnWide : null]}>
              <View style={[styles.sideCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Text style={[styles.sideCardTitle, { color: c.textPrimary }]}>
                  {t('publicProfile.sideCardTitle', { defaultValue: 'Why people join OpenSpace' })}
                </Text>
                <Text style={[styles.sideCardBody, { color: c.textSecondary }]}>
                  {t('publicProfile.sideCardBody', {
                    defaultValue: 'OpenSpace profiles can be part of the fediverse while still giving people a richer home for identity, posting, and discovery.',
                  })}
                </Text>
                <View style={styles.sideCardRows}>
                  {[
                    {
                      icon: 'access-point-network',
                      title: t('publicProfile.sidePointOneTitle', { defaultValue: 'Distributed reach' }),
                      body: t('publicProfile.sidePointOneBody', { defaultValue: 'Public activity can reach Mastodon and compatible networks.' }),
                    },
                    {
                      icon: 'account-group-outline',
                      title: t('publicProfile.sidePointTwoTitle', { defaultValue: 'Community-native' }),
                      body: t('publicProfile.sidePointTwoBody', { defaultValue: 'Profiles, communities, and posts live together in one product.' }),
                    },
                    {
                      icon: 'message-outline',
                      title: t('publicProfile.sidePointThreeTitle', { defaultValue: 'Conversation-ready' }),
                      body: t('publicProfile.sidePointThreeBody', { defaultValue: 'Join directly instead of only following from afar.' }),
                    },
                  ].map((item) => (
                    <View key={item.title} style={styles.sidePoint}>
                      <View style={[styles.sidePointIcon, { backgroundColor: `${c.primary}16` }]}>
                        <MaterialCommunityIcons name={item.icon as any} size={18} color={c.primary} />
                      </View>
                      <View style={styles.sidePointText}>
                        <Text style={[styles.sidePointTitle, { color: c.textPrimary }]}>{item.title}</Text>
                        <Text style={[styles.sidePointBody, { color: c.textSecondary }]}>{item.body}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topBarBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMark: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  logoMarkText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  appName: { fontSize: 20, fontWeight: '800' },
  signInButton: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  signInButtonText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  errorText: { fontSize: 15, textAlign: 'center', maxWidth: 420 },
  scrollContent: { padding: 18, gap: 18 },
  scrollContentWide: { paddingHorizontal: 28, paddingBottom: 30 },
  heroCard: { borderWidth: 1, borderRadius: 32, overflow: 'hidden' },
  heroCover: { height: 170, position: 'relative', overflow: 'hidden' },
  heroCoverImage: { width: '100%', height: '100%', justifyContent: 'space-between' },
  heroCoverOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.18)' },
  orbLarge: { position: 'absolute', width: 220, height: 220, borderRadius: 110, top: -80, right: -30 },
  orbSmall: { position: 'absolute', width: 150, height: 150, borderRadius: 75, bottom: -35, left: -10 },
  heroBadgeRow: { position: 'absolute', top: 18, left: 18, right: 18, flexDirection: 'row', justifyContent: 'space-between' },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  heroBadgeText: { fontSize: 12, fontWeight: '800' },
  heroBody: { padding: 22, gap: 20 },
  heroBodyWide: { flexDirection: 'row', alignItems: 'stretch', gap: 24 },
  heroIntro: { gap: 18, minWidth: 0 },
  heroIntroWide: { flex: 1, minWidth: 0 },
  heroIdentity: { gap: 18, minWidth: 0 },
  heroIdentityWide: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  heroText: { gap: 8, minWidth: 0 },
  heroTextWide: { flex: 1, minWidth: 0, paddingTop: 6 },
  avatarWrap: {
    width: 116,
    height: 116,
    borderRadius: 58,
    overflow: 'hidden',
    borderWidth: 5,
    marginTop: -80,
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  avatarImage: { width: '100%', height: '100%' },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  displayName: { fontSize: 36, fontWeight: '800', lineHeight: 42 },
  username: { fontSize: 18, fontWeight: '700' },
  metaText: { fontSize: 15 },
  valueLine: { fontSize: 17, lineHeight: 25, maxWidth: 680 },
  bioText: { fontSize: 15, lineHeight: 23, maxWidth: 720 },
  linkText: { fontSize: 14, fontWeight: '700' },
  heroSocialProof: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  heroSocialProofTitle: { fontSize: 15, fontWeight: '800' },
  heroSocialProofBody: { fontSize: 14, lineHeight: 21 },
  heroRail: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 12,
    width: '100%',
  },
  heroRailWide: {
    width: 390,
    minWidth: 390,
    flexShrink: 0,
    alignSelf: 'stretch',
    justifyContent: 'space-between',
  },
  heroRailTitle: { fontSize: 20, fontWeight: '800', lineHeight: 26 },
  heroRailBody: { fontSize: 14, lineHeight: 21 },
  heroRailList: { gap: 9 },
  heroRailItem: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  heroRailDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  heroRailItemText: { flex: 1, fontSize: 14, lineHeight: 20 },
  primaryCta: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12 },
  primaryCtaFull: { alignSelf: 'stretch', alignItems: 'center' },
  primaryCtaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  secondaryCta: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  secondaryCtaText: { fontSize: 14, fontWeight: '700' },
  ctaHint: { fontSize: 14, lineHeight: 20 },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 22, paddingBottom: 22 },
  metricCard: {
    flexGrow: 1,
    flexBasis: 150,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 5,
  },
  metricValue: { fontSize: 28, fontWeight: '800' },
  metricLabel: { fontSize: 13, fontWeight: '600' },
  mainGrid: { gap: 18 },
  mainGridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  mainColumn: { flex: 1, gap: 18 },
  sideColumn: { width: '100%' },
  sideColumnWide: { width: 340 },
  postsCard: { borderWidth: 1, borderRadius: 30, padding: 22, gap: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  sectionEyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  sectionTitle: { fontSize: 24, fontWeight: '800' },
  sectionPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sectionPillText: { fontSize: 12, fontWeight: '700' },
  postCard: { borderWidth: 1, borderRadius: 22, padding: 16, gap: 12 },
  postCardFirst: { marginTop: 4 },
  postText: { fontSize: 15, lineHeight: 22 },
  postFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  postMeta: { fontSize: 12, fontWeight: '600' },
  emptyText: { fontSize: 14, paddingVertical: 12 },
  sideCard: { borderWidth: 1, borderRadius: 30, padding: 22, gap: 14 },
  sideCardTitle: { fontSize: 22, fontWeight: '800', lineHeight: 28 },
  sideCardBody: { fontSize: 15, lineHeight: 22 },
  sideCardRows: { gap: 14 },
  sidePoint: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  sidePointIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sidePointText: { flex: 1, gap: 3 },
  sidePointTitle: { fontSize: 15, fontWeight: '800' },
  sidePointBody: { fontSize: 14, lineHeight: 20 },
});
