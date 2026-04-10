import React from 'react';
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FeedPost } from '../api/client';

type TabKey = 'all' | 'about' | 'followers' | 'photos' | 'reels' | 'more';

type Props = {
  styles: any;
  c: any;
  t: (key: string, options?: any) => string;
  user: any;
  profileRouteUsername: string;
  isCompactProfileLayout: boolean;
  profileTabs: Array<{ key: TabKey; label: string }>;
  profileActiveTab: TabKey;
  onSetProfileActiveTab: (tab: TabKey) => void;
  myProfilePosts: FeedPost[];
  myProfilePostsLoading: boolean;
  myPinnedPosts: FeedPost[];
  myPinnedPostsLoading: boolean;
  onNotice: (message: string) => void;
  renderPostCard: (post: FeedPost, variant: 'feed' | 'profile') => React.ReactNode;
};

export default function MyProfileScreen({
  styles,
  c,
  t,
  user,
  profileRouteUsername,
  isCompactProfileLayout,
  profileTabs,
  profileActiveTab,
  onSetProfileActiveTab,
  myProfilePosts,
  myProfilePostsLoading,
  myPinnedPosts,
  myPinnedPostsLoading,
  onNotice,
  renderPostCard,
}: Props) {
  const safePinnedPosts = Array.isArray(myPinnedPosts) ? myPinnedPosts : [];
  const safeProfilePosts = Array.isArray(myProfilePosts) ? myProfilePosts : [];
  const pinnedIds = new Set(safePinnedPosts.map((post) => post.id));
  const regularProfilePosts = safeProfilePosts.filter((post) => !pinnedIds.has(post.id));

  return (
    <View style={[styles.profilePageCard, { backgroundColor: c.surface, borderColor: c.border }]}> 
      <View style={[styles.profileCoverWrap, { backgroundColor: c.inputBackground, borderColor: c.border }]}> 
        {user?.profile?.cover ? (
          <Image source={{ uri: user.profile.cover }} style={styles.profileCoverImage} resizeMode="cover" />
        ) : (
          <View style={[styles.profileCoverFallback, { backgroundColor: c.inputBackground }]}>
            <MaterialCommunityIcons name="image-outline" size={24} color={c.textMuted} />
          </View>
        )}
        <TouchableOpacity
          style={[styles.profileCoverAction, { backgroundColor: c.surface, borderColor: c.border }]}
          activeOpacity={0.85}
          onPress={() => onNotice(t('home.profileComingSoonAction'))}
        >
          <MaterialCommunityIcons name="camera-outline" size={15} color={c.textSecondary} />
          <Text style={[styles.profileCoverActionText, { color: c.textPrimary }]}>{t('home.profileEditCoverAction')}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.profileIdentityRow, isCompactProfileLayout ? styles.profileIdentityRowCompact : null]}>
        <View style={[styles.profileIdentityLeft, isCompactProfileLayout ? styles.profileIdentityLeftCompact : null]}>
          <View style={[styles.profileAvatarWrap, { borderColor: c.surface, backgroundColor: c.primary }]}> 
            {user?.profile?.avatar ? (
              <Image source={{ uri: user.profile.avatar }} style={styles.profileAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={styles.profileAvatarLetter}>{(user?.username?.[0] || 'U').toUpperCase()}</Text>
            )}
          </View>
          <View style={styles.profileIdentityMeta}>
            <Text style={[styles.profileDisplayName, isCompactProfileLayout ? styles.profileDisplayNameCompact : null, { color: c.textPrimary }]}>
              {user?.profile?.name || `@${user?.username || profileRouteUsername}`}
            </Text>
            <Text style={[styles.profileMetaText, { color: c.textMuted }]}>
              {t('home.profileFollowersCount', { count: user?.followers_count || 0 })}
            </Text>
            <View style={styles.profileMetaInline}>
              {user?.profile?.location ? (
                <Text style={[styles.profileMetaText, { color: c.textMuted }]}>{user.profile.location}</Text>
              ) : null}
              <Text style={[styles.profileMetaText, { color: c.textMuted }]}>@{user?.username || profileRouteUsername}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.profileIdentityActions, isCompactProfileLayout ? styles.profileIdentityActionsCompact : null]}>
          <TouchableOpacity
            style={[styles.profilePrimaryBtn, { backgroundColor: c.primary }]}
            activeOpacity={0.85}
            onPress={() => onNotice(t('home.profileComingSoonAction'))}
          >
            <MaterialCommunityIcons name="plus" size={16} color="#fff" />
            <Text style={styles.profilePrimaryBtnText}>{t('home.profileAddStoryAction')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.profileSecondaryBtn, { backgroundColor: c.inputBackground, borderColor: c.border }]}
            activeOpacity={0.85}
            onPress={() => onNotice(t('home.profileComingSoonAction'))}
          >
            <MaterialCommunityIcons name="pencil-outline" size={16} color={c.textSecondary} />
            <Text style={[styles.profileSecondaryBtnText, { color: c.textPrimary }]}>{t('home.profileEditProfileAction')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.profileTabsRow, { borderTopColor: c.border }]}> 
        {profileTabs.map((tab) => (
          <TouchableOpacity
            key={`profile-tab-${tab.key}`}
            style={[styles.profileTabBtn, profileActiveTab === tab.key ? { borderBottomColor: c.primary } : null]}
            activeOpacity={0.85}
            onPress={() => onSetProfileActiveTab(tab.key)}
          >
            <Text style={[styles.profileTabText, { color: profileActiveTab === tab.key ? c.primary : c.textSecondary }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {profileActiveTab === 'all' ? (
        <View style={[styles.profileBodyLayout, isCompactProfileLayout ? styles.profileBodyLayoutCompact : null]}>
          <View style={[styles.profileBodyLeft, isCompactProfileLayout ? styles.profileBodyLeftCompact : null]}>
            <View style={[styles.profileDetailCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}> 
              <View style={styles.profileSectionTitleRow}>
                <MaterialCommunityIcons name="account-details-outline" size={22} color={c.textPrimary} />
                <Text style={[styles.profileDetailTitle, styles.profileSectionTitleText, { color: c.textPrimary }]}>
                  {t('home.profilePersonalDetailsTitle')}
                </Text>
              </View>
              <View style={styles.profileDetailList}>
                {user?.profile?.location ? (
                  <View style={styles.profileDetailItem}>
                    <MaterialCommunityIcons name="map-marker-outline" size={18} color={c.textMuted} />
                    <Text style={[styles.profileDetailText, { color: c.textSecondary }]}>
                      {t('home.profileLivesInLabel', { location: user.profile.location })}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.profileDetailItem}>
                  <MaterialCommunityIcons name="at" size={18} color={c.textMuted} />
                  <Text style={[styles.profileDetailText, { color: c.textSecondary }]}>@{user?.username || profileRouteUsername}</Text>
                </View>
                {user?.profile?.bio ? (
                  <View style={styles.profileDetailItem}>
                    <MaterialCommunityIcons name="text-box-outline" size={18} color={c.textMuted} />
                    <Text style={[styles.profileDetailText, { color: c.textSecondary }]}>{user.profile.bio}</Text>
                  </View>
                ) : null}
                {user?.profile?.url ? (
                  <View style={styles.profileDetailItem}>
                    <MaterialCommunityIcons name="link-variant" size={18} color={c.textMuted} />
                    <Text style={[styles.profileDetailText, { color: c.textSecondary }]}>{user.profile.url}</Text>
                  </View>
                ) : null}
                <View style={styles.profileDetailItem}>
                  <MaterialCommunityIcons name="calendar-month-outline" size={18} color={c.textMuted} />
                  <Text style={[styles.profileDetailText, { color: c.textSecondary }]}> 
                    {t('home.profileJoinedLabel', {
                      date: user?.date_joined ? new Date(user.date_joined).toLocaleDateString() : '-',
                    })}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <View style={[styles.profileBodyRight, isCompactProfileLayout ? styles.profileBodyRightCompact : null]}>
            <View style={[styles.profileComposerCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}> 
              <View style={styles.profileComposerTop}>
                <View style={[styles.feedAvatar, { backgroundColor: c.primary }]}> 
                  {user?.profile?.avatar ? (
                    <Image source={{ uri: user.profile.avatar }} style={styles.feedAvatarImage} resizeMode="cover" />
                  ) : (
                    <Text style={styles.feedAvatarLetter}>{(user?.username?.[0] || 'U').toUpperCase()}</Text>
                  )}
                </View>
                <TouchableOpacity
                  style={[styles.profileComposerInputMock, { borderColor: c.border, backgroundColor: c.surface }]}
                  activeOpacity={0.85}
                  onPress={() => onNotice(t('home.profileComingSoonAction'))}
                >
                  <Text style={[styles.profileComposerInputText, { color: c.textMuted }]}> {t('home.profileWhatsOnMindTitle')}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.profilePostsCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
              <View style={styles.profileSectionTitleRow}>
                <MaterialCommunityIcons name="pin-outline" size={22} color={c.textPrimary} />
                <Text style={[styles.profileDetailTitle, styles.profileSectionTitleText, { color: c.textPrimary }]}>
                  {t('home.profilePinnedPostsTitle')}
                </Text>
              </View>
              {myPinnedPostsLoading ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : safePinnedPosts.length === 0 ? (
                <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>{t('home.profileNoPinnedPosts')}</Text>
              ) : (
                <View style={styles.feedList}>
                  {safePinnedPosts.map((post) => (
                    <React.Fragment key={`profile-pinned-post-${post.id}`}>{renderPostCard(post, 'profile')}</React.Fragment>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.profilePostsCard, { backgroundColor: c.inputBackground, borderColor: c.border }]}> 
              <View style={styles.profileSectionTitleRow}>
                <MaterialCommunityIcons name="post-outline" size={22} color={c.textPrimary} />
                <Text style={[styles.profileDetailTitle, styles.profileSectionTitleText, { color: c.textPrimary }]}>
                  {t('home.profilePostsTitle')}
                </Text>
              </View>
              {myProfilePostsLoading ? (
                <ActivityIndicator color={c.primary} size="small" />
              ) : regularProfilePosts.length === 0 ? (
                <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>{t('home.profileNoPosts')}</Text>
              ) : (
                <View style={styles.feedList}>
                  {regularProfilePosts.map((post) => (
                    <React.Fragment key={`profile-post-${post.id}`}>{renderPostCard(post, 'profile')}</React.Fragment>
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>
      ) : (
        <View style={[styles.profileDetailCard, { backgroundColor: c.inputBackground, borderColor: c.border, marginTop: 16 }]}> 
          <Text style={[styles.feedEmptyText, { color: c.textMuted }]}>{t('home.profileComingSoonAction')}</Text>
        </View>
      )}
    </View>
  );
}
