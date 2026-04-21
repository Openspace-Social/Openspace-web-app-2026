import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, FeedPost } from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import { useTranslation } from 'react-i18next';

interface Props {
  postUuid: string;
  onLoginPress: () => void;
}

export default function PublicPostScreen({ postUuid, onLoginPress }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { t } = useTranslation();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getPostByUuid(null, postUuid)
      .then((p) => {
        if (!cancelled) setPost(p);
      })
      .catch((e: any) => {
        if (!cancelled) {
          const msg = e?.message || String(e) || 'Unknown error';
          console.error('[PublicPostScreen] fetch failed:', msg, 'uuid:', postUuid);
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [postUuid]);

  const creatorUsername = post?.creator?.username || '';
  const creatorAvatar = post?.creator?.profile?.avatar || post?.creator?.avatar || null;
  const postDate = post?.created ? new Date(post.created).toLocaleString() : '';
  const postText = post?.text || post?.long_text || '';
  const mediaThumbnail = post?.media_thumbnail || null;
  const reactionCount =
    Array.isArray((post as any)?.reactions_emoji_counts)
      ? (post as any).reactions_emoji_counts.reduce(
          (sum: number, item: any) => sum + (item?.count || 0),
          0
        )
      : 0;
  const commentCount =
    typeof post?.comments_count === 'number' ? post.comments_count : 0;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* Top navigation bar */}
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
          <Text style={styles.signInButtonText}>
            {t('auth.signIn', { defaultValue: 'Sign In' })}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.centred}>
          <ActivityIndicator color={c.primary} size="large" />
        </View>
      ) : error || !post ? (
        <View style={styles.centred}>
          <MaterialCommunityIcons name="alert-circle-outline" size={48} color={c.textMuted} />
          <Text style={[styles.errorText, { color: c.textMuted }]}>
            {error || t('home.feedLoadError', { defaultValue: 'Post not found.' })}
          </Text>
          <TouchableOpacity
            style={[styles.signInButton, { backgroundColor: c.primary, marginTop: 20 }]}
            onPress={onLoginPress}
            activeOpacity={0.85}
          >
            <Text style={styles.signInButtonText}>
              {t('auth.signIn', { defaultValue: 'Sign In' })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Post card */}
          <View
            style={[
              styles.postCard,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            {/* Author row */}
            <View style={styles.authorRow}>
              <View style={[styles.avatar, { backgroundColor: c.primary }]}>
                {creatorAvatar ? (
                  <Image
                    source={{ uri: creatorAvatar }}
                    style={styles.avatarImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.avatarLetter}>
                    {(creatorUsername[0] || 'O').toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={styles.authorMeta}>
                <Text style={[styles.authorName, { color: c.textPrimary }]}>
                  @{creatorUsername || t('home.unknownUser', { defaultValue: 'Unknown' })}
                </Text>
                {postDate ? (
                  <Text style={[styles.postDate, { color: c.textMuted }]}>{postDate}</Text>
                ) : null}
              </View>
            </View>

            {/* Post text */}
            {postText ? (
              <Text style={[styles.postText, { color: c.textSecondary }]}>{postText}</Text>
            ) : null}

            {/* Media thumbnail */}
            {mediaThumbnail ? (
              <View style={styles.mediaWrap}>
                <Image
                  source={{ uri: mediaThumbnail }}
                  style={styles.mediaImage}
                  resizeMode="cover"
                />
              </View>
            ) : null}

            {/* Stats row */}
            <View style={[styles.statsRow, { borderTopColor: c.border }]}>
              <View style={styles.statItem}>
                <MaterialCommunityIcons name="emoticon-outline" size={15} color={c.textMuted} />
                <Text style={[styles.statText, { color: c.textMuted }]}>
                  {t('home.feedReactionsCount', {
                    count: reactionCount,
                    defaultValue: `${reactionCount} reactions`,
                  })}
                </Text>
              </View>
              <View style={styles.statItem}>
                <MaterialCommunityIcons name="comment-outline" size={15} color={c.textMuted} />
                <Text style={[styles.statText, { color: c.textMuted }]}>
                  {t('home.feedCommentsCount', {
                    count: commentCount,
                    defaultValue: `${commentCount} comments`,
                  })}
                </Text>
              </View>
            </View>
          </View>

          {/* Sign-in CTA */}
          <View
            style={[
              styles.ctaCard,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <MaterialCommunityIcons name="account-circle-outline" size={36} color={c.primary} />
            <Text style={[styles.ctaTitle, { color: c.textPrimary }]}>
              {t('home.publicPostCtaTitle', {
                defaultValue: 'Join the conversation',
              })}
            </Text>
            <Text style={[styles.ctaBody, { color: c.textSecondary }]}>
              {t('home.publicPostCtaBody', {
                defaultValue:
                  'Sign in to react, comment, and connect with the community.',
              })}
            </Text>
            <TouchableOpacity
              style={[styles.ctaButton, { backgroundColor: c.primary }]}
              onPress={onLoginPress}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaButtonText}>
                {t('auth.signIn', { defaultValue: 'Sign In' })}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  topBarBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoMark: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMarkText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  appName: {
    fontSize: 17,
    fontWeight: '700',
  },
  signInButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  signInButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  errorText: {
    fontSize: 15,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    padding: 20,
    gap: 16,
    paddingBottom: 60,
  },
  postCard: {
    width: '100%',
    maxWidth: 600,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarLetter: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  authorMeta: {
    flex: 1,
    gap: 2,
  },
  authorName: {
    fontWeight: '700',
    fontSize: 14,
  },
  postDate: {
    fontSize: 12,
  },
  postText: {
    fontSize: 15,
    lineHeight: 22,
  },
  mediaWrap: {
    borderRadius: 10,
    overflow: 'hidden',
    width: '100%',
    aspectRatio: 16 / 9,
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    marginTop: 4,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
  },
  ctaCard: {
    width: '100%',
    maxWidth: 600,
    borderRadius: 14,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  ctaTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  ctaBody: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  ctaButton: {
    marginTop: 6,
    paddingHorizontal: 28,
    paddingVertical: 11,
    borderRadius: 999,
  },
  ctaButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
