import React from 'react';
import {
  ActivityIndicator,
  Image,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CommunityMember, CommunityOwner, FeedPost, SearchCommunityResult } from '../api/client';

const DEFAULT_PROFILE_COVER = require('../../assets/default-profile-cover.png');
const DEFAULT_PROFILE_AVATAR = require('../../assets/default-profile-avatar.png');

const TWO_COL_BREAKPOINT = 800;

type Props = {
  styles: any;
  c: any;
  t: (key: string, options?: any) => string;
  community: SearchCommunityResult | null;
  communityLoading: boolean;
  communityOwner: CommunityOwner | null;
  communityMembers: CommunityMember[];
  communityMembersLoading: boolean;
  posts: FeedPost[];
  postsLoading: boolean;
  postsError: string;
  isJoined: boolean;
  joinLoading: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onOpenProfile: (username: string) => void;
  renderPostCard: (post: FeedPost, variant: 'feed' | 'profile') => React.ReactNode;
};

export default function CommunityProfileScreen({
  styles,
  c,
  t,
  community,
  communityLoading,
  communityOwner,
  communityMembers,
  communityMembersLoading,
  posts,
  postsLoading,
  postsError,
  isJoined,
  joinLoading,
  onJoin,
  onLeave,
  onOpenProfile,
  renderPostCard,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const isTwoCol = screenWidth >= TWO_COL_BREAKPOINT;

  const coverUri = community?.cover || null;
  const avatarUri = community?.avatar || null;
  const title = community?.title || community?.name || '';
  const name = community?.name || '';
  const membersCount = community?.members_count ?? 0;
  const postsCount = community?.posts_count;
  const initial = (title?.[0] || 'C').toUpperCase();
  const accentColor = community?.color || c.primary;
  const isPublic = community?.type !== 'T';
  const description = community?.description || '';
  const categories = community?.categories || [];

  if (communityLoading && !community) {
    return (
      <View style={[styles.profilePageCard, { backgroundColor: c.surface, borderColor: c.border, alignItems: 'center', justifyContent: 'center', minHeight: 200 }]}>
        <ActivityIndicator color={c.primary} size="large" />
      </View>
    );
  }

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = (
    <>
      {/* Cover photo */}
      <View style={[styles.profileCoverWrap, { borderColor: c.border }]}>
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={styles.profileCoverImage} resizeMode="cover" />
        ) : (
          <Image source={DEFAULT_PROFILE_COVER} style={styles.profileCoverImage} resizeMode="cover" />
        )}
      </View>

      {/* Avatar + identity + join button */}
      <View style={styles.profileIdentityRow}>
        <View style={styles.profileIdentityLeft}>
          <View style={[styles.profileAvatarWrap, { borderColor: c.surface, backgroundColor: accentColor }]}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.profileAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={styles.profileAvatarLetter}>{initial}</Text>
            )}
          </View>

          <View style={styles.profileIdentityMeta}>
            <Text style={[styles.profileDisplayName, { color: c.textPrimary }]}>{title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
              <Text style={[styles.profileHandle, { color: c.textMuted }]}>{`c/${name}`}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MaterialCommunityIcons name="account-group-outline" size={14} color={c.textMuted} />
                <Text style={[styles.profileCountLabel, { color: c.textMuted }]}>
                  {membersCount.toLocaleString()}
                </Text>
              </View>
              {postsCount != null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <MaterialCommunityIcons name="file-document-outline" size={14} color={c.textMuted} />
                  <Text style={[styles.profileCountLabel, { color: c.textMuted }]}>
                    {postsCount.toLocaleString()}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Join / Leave button */}
        <View style={{ paddingBottom: 14 }}>
          <TouchableOpacity
            style={[
              styles.profileFollowButton,
              isJoined
                ? { borderColor: c.border, backgroundColor: c.inputBackground }
                : { borderColor: c.primary, backgroundColor: c.primary },
            ]}
            activeOpacity={0.85}
            disabled={joinLoading}
            onPress={isJoined ? onLeave : onJoin}
          >
            {joinLoading ? (
              <ActivityIndicator size="small" color={isJoined ? c.textSecondary : '#fff'} />
            ) : (
              <Text style={[styles.profileFollowButtonText, { color: isJoined ? c.textSecondary : '#fff' }]}>
                {isJoined
                  ? t('home.communityLeaveAction', { defaultValue: 'Leave' })
                  : t('home.communityJoinAction', { defaultValue: 'Join' })}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </>
  );

  // ── About card ──────────────────────────────────────────────────────────────
  const aboutCard = (
    <View style={[styles.profileInfoCard, { borderColor: c.border, backgroundColor: c.inputBackground, marginBottom: 12 }]}>
      <View style={styles.profileInfoCardHeader}>
        <MaterialCommunityIcons name="information-outline" size={16} color={c.textSecondary} />
        <Text style={[styles.profileInfoCardTitle, { color: c.textPrimary }]}>
          {t('home.communityAboutTitle', { defaultValue: 'About' })}
        </Text>
      </View>

      {description ? (
        <Text style={[{ fontSize: 14, lineHeight: 20, marginBottom: 8 }, { color: c.textSecondary }]}>
          {description}
        </Text>
      ) : null}

      {/* Visibility */}
      <View style={styles.profileInfoRow}>
        <MaterialCommunityIcons
          name={isPublic ? 'earth' : 'lock-outline'}
          size={14}
          color={c.textMuted}
        />
        <Text style={[styles.profileInfoValue, { color: c.textSecondary }]}>
          {isPublic
            ? t('home.communityTypePublic', { defaultValue: 'Public community' })
            : t('home.communityTypePrivate', { defaultValue: 'Private community' })}
        </Text>
      </View>

      {/* Member count */}
      <View style={styles.profileInfoRow}>
        <MaterialCommunityIcons name="account-multiple-outline" size={14} color={c.textMuted} />
        <Text style={[styles.profileInfoValue, { color: c.textSecondary }]}>
          {t('home.communityMembersCount', { count: membersCount, defaultValue: '{{count}} members' })}
        </Text>
      </View>

      {/* Post count */}
      {postsCount != null && (
        <View style={styles.profileInfoRow}>
          <MaterialCommunityIcons name="file-document-outline" size={14} color={c.textMuted} />
          <Text style={[styles.profileInfoValue, { color: c.textSecondary }]}>
            {t('home.communityPostsCount', { count: postsCount, defaultValue: '{{count}} posts' })}
          </Text>
        </View>
      )}

      {/* Categories */}
      {categories.length > 0 && (
        <View style={styles.profileInfoRow}>
          <MaterialCommunityIcons name="tag-outline" size={14} color={c.textMuted} />
          <Text style={[styles.profileInfoValue, { color: c.textSecondary }]}>
            {categories.map((cat) => cat.title || cat.name).filter(Boolean).join(', ')}
          </Text>
        </View>
      )}

      {/* Owner */}
      {communityOwner?.username ? (
        <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }}>
          <Text style={[{ fontSize: 12, fontWeight: '600', marginBottom: 6 }, { color: c.textMuted }]}>
            {t('home.communityOwnerLabel', { defaultValue: 'Owner' })}
          </Text>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            onPress={() => onOpenProfile(communityOwner.username!)}
            activeOpacity={0.8}
          >
            {communityOwner.user_avatar ? (
              <Image
                source={{ uri: communityOwner.user_avatar }}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.border }}
                resizeMode="cover"
              />
            ) : (
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: accentColor, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                  {(communityOwner.user_name || communityOwner.username || '?')[0].toUpperCase()}
                </Text>
              </View>
            )}
            <View>
              {communityOwner.user_name ? (
                <Text style={[{ fontSize: 14, fontWeight: '600' }, { color: c.textPrimary }]}>
                  {communityOwner.user_name}
                </Text>
              ) : null}
              <Text style={[{ fontSize: 13 }, { color: c.textMuted }]}>
                {`@${communityOwner.username}`}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  // ── Members card ────────────────────────────────────────────────────────────
  const membersCard = (
    <View style={[styles.profileInfoCard, { borderColor: c.border, backgroundColor: c.inputBackground, marginBottom: 12 }]}>
      <View style={styles.profileInfoCardHeader}>
        <MaterialCommunityIcons name="account-group-outline" size={16} color={c.textSecondary} />
        <Text style={[styles.profileInfoCardTitle, { color: c.textPrimary }]}>
          {t('home.communityMembersTitle', { defaultValue: 'Members' })}
        </Text>
      </View>

      {communityMembersLoading && communityMembers.length === 0 ? (
        <ActivityIndicator color={c.primary} size="small" style={{ marginTop: 8 }} />
      ) : communityMembers.length === 0 ? (
        <Text style={[{ fontSize: 13, marginTop: 4 }, { color: c.textMuted }]}>
          {t('home.communityNoMembers', { defaultValue: 'No members yet.' })}
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
          {communityMembers.map((member) => {
            const avatarUri = member.profile?.avatar || null;
            const displayName = member.profile?.name || member.username || '';
            const handle = member.username || '';
            const memberInitial = (displayName || handle || '?')[0].toUpperCase();
            return (
              <TouchableOpacity
                key={`member-${member.id ?? member.username}`}
                style={{ alignItems: 'center', width: 72 }}
                activeOpacity={0.8}
                onPress={() => handle && onOpenProfile(handle)}
              >
                {avatarUri ? (
                  <Image
                    source={{ uri: avatarUri }}
                    style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: c.border }}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: accentColor, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 20 }}>{memberInitial}</Text>
                  </View>
                )}
                <Text
                  style={[{ fontSize: 11, marginTop: 4, textAlign: 'center' }, { color: c.textSecondary }]}
                  numberOfLines={1}
                >
                  {`@${handle}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {membersCount > communityMembers.length && (
        <TouchableOpacity
          style={[{ marginTop: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center' }, { borderColor: c.border, backgroundColor: c.surface }]}
          activeOpacity={0.8}
        >
          <Text style={[{ fontSize: 14, fontWeight: '600' }, { color: c.textSecondary }]}>
            {t('home.showMore', { defaultValue: 'Show more' })}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // ── Pinned posts card ────────────────────────────────────────────────────────
  const pinnedPostsCard = (
    <View style={[styles.profileInfoCard, { borderColor: c.border, backgroundColor: c.inputBackground, marginBottom: 12 }]}>
      <View style={styles.profileInfoCardHeader}>
        <MaterialCommunityIcons name="pin-outline" size={16} color={c.textSecondary} />
        <Text style={[styles.profileInfoCardTitle, { color: c.textPrimary }]}>
          {t('home.pinnedPostsTitle', { defaultValue: 'Pinned posts' })}
        </Text>
      </View>
      <Text style={[{ fontSize: 13, marginTop: 2 }, { color: c.textMuted }]}>
        {t('home.noPinnedPosts', { defaultValue: 'No pinned posts yet.' })}
      </Text>
    </View>
  );

  // ── Posts section ────────────────────────────────────────────────────────────
  const postsSection = (
    <View style={[styles.profileInfoCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
      <View style={styles.profileInfoCardHeader}>
        <MaterialCommunityIcons name="file-document-multiple-outline" size={16} color={c.textSecondary} />
        <Text style={[styles.profileInfoCardTitle, { color: c.textPrimary }]}>
          {t('home.communityPostsTitle', { defaultValue: 'Posts' })}
          {postsCount != null ? ` (${postsCount.toLocaleString()})` : ''}
        </Text>
      </View>

      {postsLoading ? (
        <ActivityIndicator color={c.primary} size="small" style={styles.feedLoading} />
      ) : postsError ? (
        <Text style={[styles.feedErrorText, { color: c.errorText }]}>{postsError}</Text>
      ) : posts.length === 0 ? (
        <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>
          {t('home.feedEmpty')}
        </Text>
      ) : (
        <View style={styles.feedList}>
          {posts.map((post) => (
            <React.Fragment key={`community-post-${post.id}`}>
              {renderPostCard(post, 'feed')}
            </React.Fragment>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.profilePageCard, { backgroundColor: c.surface, borderColor: c.border }]}>
      {header}

      {isTwoCol ? (
        // Two-column layout
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start', marginTop: 4 }}>
          {/* Left sidebar */}
          <View style={{ width: 260, flexShrink: 0 }}>
            {aboutCard}
            {membersCard}
          </View>
          {/* Right main */}
          <View style={{ flex: 1, minWidth: 0 }}>
            {pinnedPostsCard}
            {postsSection}
          </View>
        </View>
      ) : (
        // Single-column layout
        <View style={{ marginTop: 4 }}>
          {aboutCard}
          {pinnedPostsCard}
          {membersCard}
          {postsSection}
        </View>
      )}
    </View>
  );
}
