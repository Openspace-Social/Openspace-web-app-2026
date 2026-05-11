import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { api, FeedPost, UserProfile } from '../api/client';
import FederationSummaryCard from '../components/FederationSummaryCard';
import { useTheme } from '../theme/ThemeContext';
import { useTranslation } from 'react-i18next';

const DEFAULT_PROFILE_AVATAR = require('../../assets/default-profile-avatar.png');

type Props = {
  username: string;
  onLoginPress: () => void;
};

export default function PublicProfileLandingScreen({ username, onLoginPress }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { t } = useTranslation();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          onPress={onLoginPress}
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
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.heroCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={styles.heroHeader}>
              <View style={[styles.avatarWrap, { borderColor: c.border }]}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatarImage} resizeMode="cover" />
                ) : (
                  <Image source={DEFAULT_PROFILE_AVATAR} style={styles.avatarImage} resizeMode="cover" />
                )}
              </View>
              <View style={styles.heroMeta}>
                <Text style={[styles.displayName, { color: c.textPrimary }]}>{displayName}</Text>
                <Text style={[styles.username, { color: c.textMuted }]}>@{profile.username || username}</Text>
                <View style={styles.countsRow}>
                  <Text style={[styles.countText, { color: c.textSecondary }]}>
                    {t('home.profileFollowersDisplay', {
                      count: profile.followers_count ?? 0,
                      defaultValue: `${profile.followers_count ?? 0} followers`,
                    })}
                  </Text>
                  <Text style={[styles.countText, { color: c.textSecondary }]}>
                    {t('home.profileFollowingDisplay', {
                      count: profile.following_count ?? 0,
                      defaultValue: `${profile.following_count ?? 0} following`,
                    })}
                  </Text>
                </View>
                {location ? (
                  <Text style={[styles.metaText, { color: c.textMuted }]}>{location}</Text>
                ) : null}
              </View>
            </View>

            {bio ? (
              <Text style={[styles.bioText, { color: c.textSecondary }]}>{bio}</Text>
            ) : null}

            {url ? (
              <TouchableOpacity onPress={() => Linking.openURL(url)} activeOpacity={0.8}>
                <Text style={[styles.linkText, { color: c.primary }]}>{url}</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.ctaRow}>
              <TouchableOpacity
                style={[styles.primaryCta, { backgroundColor: c.primary }]}
                onPress={onLoginPress}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryCtaText}>
                  {t('publicProfile.joinCta', { defaultValue: 'Join OpenSpace' })}
                </Text>
              </TouchableOpacity>
              <Text style={[styles.ctaHint, { color: c.textMuted }]}>
                {t('publicProfile.joinHint', {
                  defaultValue: 'Sign in to follow, reply, and connect directly.',
                })}
              </Text>
            </View>
          </View>

          <FederationSummaryCard c={c} t={t} summary={profile.federation_summary} />

          <View style={[styles.postsCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
              {t('publicProfile.recentPostsTitle', { defaultValue: 'Recent public posts' })}
            </Text>
            {posts.length ? (
              posts.map((post) => (
                <View key={post.id || post.uuid} style={[styles.postItem, { borderTopColor: c.border }]}>
                  <Text style={[styles.postText, { color: c.textSecondary }]} numberOfLines={4}>
                    {post.long_text || post.text || t('publicProfile.emptyPostFallback', { defaultValue: 'Shared a post.' })}
                  </Text>
                  <Text style={[styles.postMeta, { color: c.textMuted }]}>
                    {post.created ? new Date(post.created).toLocaleString() : ''}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={[styles.emptyText, { color: c.textMuted }]}>
                {t('publicProfile.noPosts', { defaultValue: 'No public posts to show yet.' })}
              </Text>
            )}
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
  scrollContent: { padding: 20, gap: 18 },
  heroCard: { borderWidth: 1, borderRadius: 28, padding: 24, gap: 18 },
  heroHeader: { flexDirection: 'row', gap: 18, alignItems: 'center' },
  avatarWrap: { width: 110, height: 110, borderRadius: 55, overflow: 'hidden', borderWidth: 1 },
  avatarImage: { width: '100%', height: '100%' },
  heroMeta: { flex: 1, gap: 6 },
  displayName: { fontSize: 34, fontWeight: '800', lineHeight: 40 },
  username: { fontSize: 18, fontWeight: '600' },
  countsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  countText: { fontSize: 15, fontWeight: '600' },
  metaText: { fontSize: 15 },
  bioText: { fontSize: 15, lineHeight: 22 },
  linkText: { fontSize: 14, fontWeight: '700' },
  ctaRow: { gap: 10 },
  primaryCta: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12 },
  primaryCtaText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  ctaHint: { fontSize: 14, lineHeight: 20 },
  postsCard: { borderWidth: 1, borderRadius: 28, padding: 24 },
  sectionTitle: { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  postItem: { paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
  postText: { fontSize: 15, lineHeight: 22 },
  postMeta: { marginTop: 8, fontSize: 12 },
  emptyText: { fontSize: 14, paddingVertical: 12 },
});
