/**
 * CommunityScreen — native community profile (`c/<name>`).
 *
 * Mirrors the web CommunityProfileScreen's UX in a slim, native-friendly
 * shell: cover + avatar header, action row (Join / Leave / Mute /
 * Notifications / Manage), About card, and the community's posts feed.
 *
 * Web's CommunityProfileScreen is left untouched — it depends on
 * HomeScreen-internal styles. This is a separate native-only render path.
 */

import React, { useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type {
  CommunityMember,
  CommunityOwner,
  FeedPost,
  ModerationCategory,
  SearchCommunityResult,
} from '../api/client';

type Props = {
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  community: SearchCommunityResult | null;
  loading: boolean;
  posts: FeedPost[];
  postsLoading: boolean;
  refreshing: boolean;
  onRefresh: () => void;

  isJoined: boolean;
  isPendingJoinRequest: boolean;
  joinLoading: boolean;
  notificationsEnabled: boolean;
  notificationsLoading: boolean;
  isTimelineMuted: boolean;
  muteLoading: boolean;
  canManage: boolean;

  onJoin: () => void;
  onLeave: () => void;
  onToggleNotifications: () => void;
  onMute: (durationDays: number | null) => void;
  onUnmute: () => void;
  onOpenManage: () => void;

  // Sections
  owner: CommunityOwner | null;
  members: CommunityMember[];
  membersLoading: boolean;
  membersHasMore: boolean;
  onLoadMoreMembers: () => void;
  onShowAllMembers: () => void;
  pinnedPosts: FeedPost[];
  pinnedPostsLoading: boolean;
  moderationCategories: ModerationCategory[];
  onOpenProfile: (username: string) => void;
  onReport: (categoryId: number) => Promise<void> | void;

  /** Render a single post row. Container provides this so reactions /
   *  comments / pin / etc. all share the same PostInteractionsProvider. */
  renderPostCard: (post: FeedPost) => React.ReactNode;
};

export default function CommunityScreen({
  c,
  t,
  community,
  loading,
  posts,
  postsLoading,
  refreshing,
  onRefresh,
  isJoined,
  isPendingJoinRequest,
  joinLoading,
  notificationsEnabled,
  notificationsLoading,
  isTimelineMuted,
  muteLoading,
  canManage,
  onJoin,
  onLeave,
  onToggleNotifications,
  onMute,
  onUnmute,
  onOpenManage,
  owner,
  members,
  membersLoading,
  membersHasMore,
  onLoadMoreMembers,
  onShowAllMembers,
  pinnedPosts,
  pinnedPostsLoading,
  moderationCategories,
  onOpenProfile,
  onReport,
  renderPostCard,
}: Props) {
  const s = useMemo(() => makeStyles(c), [c]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);

  const promptMuteDuration = () => {
    const thirty = t('community.mute30DaysAction', { defaultValue: 'Mute for 30 days' });
    const indefinite = t('community.muteIndefiniteAction', { defaultValue: 'Mute indefinitely' });
    const cancel = t('common.cancel', { defaultValue: 'Cancel' });
    const title = t('community.muteFeedTitle', { defaultValue: 'Mute community feed' });
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: [thirty, indefinite, cancel],
          cancelButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) onMute(30);
          else if (idx === 1) onMute(null);
        },
      );
    } else {
      Alert.alert(title, undefined, [
        { text: thirty, onPress: () => onMute(30) },
        { text: indefinite, onPress: () => onMute(null) },
        { text: cancel, style: 'cancel' },
      ]);
    }
  };

  if (loading && !community) {
    return (
      <View style={[s.centered, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} size="large" />
      </View>
    );
  }
  if (!community) {
    return (
      <View style={[s.centered, { backgroundColor: c.background }]}>
        <Text style={[s.empty, { color: c.textMuted }]}>
          {t('home.communityNotFound', { defaultValue: 'Community not found.' })}
        </Text>
      </View>
    );
  }

  const accent = community.color || c.primary;
  const initial = (community.title?.[0] || community.name?.[0] || 'C').toUpperCase();
  const handle = community.name ? `c/${community.name}` : '';
  const membersCount = typeof community.members_count === 'number' ? community.members_count : 0;
  const postsCount = typeof community.posts_count === 'number' ? community.posts_count : 0;

  const header = (
    <View>
      {/* Cover */}
      <View style={[s.coverWrap, { backgroundColor: c.inputBackground }]}>
        {community.cover ? (
          <Image source={{ uri: community.cover }} style={s.coverImage} resizeMode="cover" />
        ) : (
          <View style={[s.coverFallback, { backgroundColor: accent }]} />
        )}
      </View>

      {/* Avatar + identity row */}
      <View style={s.identityRow}>
        <View style={[s.avatarWrap, { borderColor: c.background, backgroundColor: accent }]}>
          {community.avatar ? (
            <Image source={{ uri: community.avatar }} style={s.avatarImage} resizeMode="cover" />
          ) : (
            <Text style={s.avatarLetter}>{initial}</Text>
          )}
        </View>
      </View>

      <View style={s.titleBlock}>
        <Text style={[s.title, { color: c.textPrimary }]} numberOfLines={2}>
          {community.title || community.name}
        </Text>
        <Text style={[s.handle, { color: c.textMuted }]} numberOfLines={1}>{handle}</Text>
        <View style={s.statRow}>
          <Stat c={c} icon="account-group-outline" label={`${membersCount}`} hint={t('home.communityMembersStat', { count: membersCount, defaultValue: 'members' })} />
          <View style={[s.statDivider, { backgroundColor: c.border }]} />
          <Stat c={c} icon="message-text-outline" label={`${postsCount}`} hint={t('home.communityPostsStat', { count: postsCount, defaultValue: 'posts' })} />
        </View>
      </View>

      {/* Action row */}
      <View style={s.actionsRow}>
        {!isJoined ? (
          <TouchableOpacity
            style={[s.primaryBtn, { backgroundColor: c.primary, opacity: joinLoading ? 0.7 : 1 }]}
            activeOpacity={0.85}
            onPress={onJoin}
            disabled={joinLoading}
          >
            {joinLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={s.primaryBtnText}>
                {isPendingJoinRequest
                  ? t('home.communityRequestPending', { defaultValue: 'Pending approval' })
                  : community.type === 'T' || community.type === 'R'
                    ? t('home.communityRequestToJoin', { defaultValue: 'Request to join' })
                    : t('home.communityJoinAction', { defaultValue: 'Join' })}
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.secondaryBtn, { borderColor: c.border, backgroundColor: c.inputBackground, opacity: joinLoading ? 0.7 : 1 }]}
            activeOpacity={0.85}
            onPress={onLeave}
            disabled={joinLoading}
          >
            {joinLoading ? (
              <ActivityIndicator color={c.textPrimary} size="small" />
            ) : (
              <Text style={[s.secondaryBtnText, { color: c.textPrimary }]}>
                {t('home.communityLeaveAction', { defaultValue: 'Leave' })}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {isJoined ? (
          <TouchableOpacity
            style={[s.iconBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            activeOpacity={0.85}
            onPress={onToggleNotifications}
            disabled={notificationsLoading}
            accessibilityLabel={t('home.communityNotificationsToggle', { defaultValue: 'Toggle notifications' })}
          >
            {notificationsLoading ? (
              <ActivityIndicator color={c.textPrimary} size="small" />
            ) : (
              <MaterialCommunityIcons
                name={notificationsEnabled ? 'bell' : 'bell-outline'}
                size={18}
                color={notificationsEnabled ? c.primary : c.textPrimary}
              />
            )}
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[s.iconBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          activeOpacity={0.85}
          onPress={() => (isTimelineMuted ? onUnmute() : promptMuteDuration())}
          disabled={muteLoading}
          accessibilityLabel={t('home.communityMuteToggle', { defaultValue: 'Mute community feed' })}
        >
          {muteLoading ? (
            <ActivityIndicator color={c.textPrimary} size="small" />
          ) : (
            <MaterialCommunityIcons
              name={isTimelineMuted ? 'bell-off' : 'volume-off'}
              size={18}
              color={isTimelineMuted ? '#dc2626' : c.textPrimary}
            />
          )}
        </TouchableOpacity>

        {canManage ? (
          <TouchableOpacity
            style={[s.iconBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            activeOpacity={0.85}
            onPress={onOpenManage}
            accessibilityLabel={t('community.manageAction', { defaultValue: 'Manage' })}
          >
            <MaterialCommunityIcons name="cog-outline" size={18} color={c.textPrimary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* About */}
      {community.description ? (
        <ExpandableCard
          c={c}
          t={t}
          label={t('home.communityAboutLabel', { defaultValue: 'ABOUT' })}
          text={community.description}
          styles={s}
        />
      ) : null}
      {community.rules ? (
        <ExpandableCard
          c={c}
          t={t}
          label={t('home.communityRulesLabel', { defaultValue: 'RULES' })}
          text={community.rules}
          styles={s}
        />
      ) : null}

      {/* Owner */}
      {owner ? (
        <Section c={c} icon="crown-outline" title={t('home.communityOwnerSection', { defaultValue: 'Owner' })}>
          <MemberTile
            c={c}
            avatar={owner.user_avatar}
            name={owner.user_name || owner.username}
            handle={owner.username ? `@${owner.username}` : ''}
            onPress={() => owner.username && onOpenProfile(owner.username)}
          />
        </Section>
      ) : null}

      {/* Administrators */}
      {community.administrators && community.administrators.length > 0 ? (
        <Section
          c={c}
          icon="shield-account-outline"
          title={t('home.communityAdministratorsSection', { defaultValue: 'Administrators' })}
          subtitle={`${community.administrators.length}`}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 4 }}>
            {community.administrators.map((m) => (
              <MemberSliderTile
                key={`admin-${m.id || m.username}`}
                c={c}
                member={m}
                onPress={() => m.username && onOpenProfile(m.username)}
              />
            ))}
          </ScrollView>
        </Section>
      ) : null}

      {/* Moderators */}
      {community.moderators && community.moderators.length > 0 ? (
        <Section
          c={c}
          icon="gavel"
          title={t('home.communityModeratorsSection', { defaultValue: 'Moderators' })}
          subtitle={`${community.moderators.length}`}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 4 }}>
            {community.moderators.map((m) => (
              <MemberSliderTile
                key={`mod-${m.id || m.username}`}
                c={c}
                member={m}
                onPress={() => m.username && onOpenProfile(m.username)}
              />
            ))}
          </ScrollView>
        </Section>
      ) : null}

      {/* Pinned posts */}
      {pinnedPosts.length > 0 || pinnedPostsLoading ? (
        <Section c={c} icon="pin-outline" title={t('home.communityPinnedPostsSection', { defaultValue: 'Pinned posts' })}>
          {pinnedPostsLoading && pinnedPosts.length === 0 ? (
            <ActivityIndicator color={c.primary} size="small" style={{ marginVertical: 10 }} />
          ) : (
            <View style={{ gap: 8 }}>
              {pinnedPosts.map((p) => (
                <View key={`pinned-${(p as any).id}`}>{renderPostCard(p)}</View>
              ))}
            </View>
          )}
        </Section>
      ) : null}

      {/* Members — single-line horizontal slider, with "Show more" pinned
          to the right of the section title that opens a dedicated infinite-
          scrollable list. */}
      <Section
        c={c}
        icon="account-multiple-outline"
        title={t('home.communityMembersSection', { defaultValue: 'Members' })}
        subtitle={`${community.members_count || members.length}`}
        headerRight={members.length > 0 || community.members_count ? (
          <TouchableOpacity onPress={onShowAllMembers} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[s.showMoreText, { color: c.primary }]}>
              {t('home.profileShowMoreCommunities', { defaultValue: 'Show more' })}
            </Text>
          </TouchableOpacity>
        ) : null}
      >
        {membersLoading && members.length === 0 ? (
          <ActivityIndicator color={c.primary} size="small" style={{ marginVertical: 10 }} />
        ) : members.length === 0 ? (
          <Text style={[s.emptySectionText, { color: c.textMuted }]}>
            {t('home.communityNoMembers', { defaultValue: 'No members to show.' })}
          </Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 14, paddingVertical: 4 }}
          >
            {members.map((m) => (
              <MemberSliderTile
                key={`member-${m.id || m.username}`}
                c={c}
                member={m}
                onPress={() => m.username && onOpenProfile(m.username)}
              />
            ))}
          </ScrollView>
        )}
      </Section>

      {/* Report */}
      <View style={s.reportRow}>
        <TouchableOpacity
          style={[s.reportBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
          activeOpacity={0.85}
          onPress={() => setReportOpen(true)}
        >
          <MaterialCommunityIcons name="flag-outline" size={16} color={c.errorText} />
          <Text style={[s.reportBtnText, { color: c.errorText }]}>
            {t('home.communityReportAction', { defaultValue: 'Report community' })}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Posts label */}
      <View style={[s.postsHeader, { borderBottomColor: c.border }]}>
        <Text style={[s.postsHeaderText, { color: c.textPrimary }]}>
          {t('home.communityPostsHeader', { defaultValue: 'Posts' })}
        </Text>
      </View>
    </View>
  );

  return (
    <>
      <FlatList
        style={{ backgroundColor: c.background }}
        contentContainerStyle={{ paddingBottom: 140 }}
        data={posts}
        keyExtractor={(item, idx) => `community-post-${(item as any).id || idx}`}
        renderItem={({ item }) => <View style={{ marginBottom: 8 }}>{renderPostCard(item)}</View>}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} colors={[c.primary]} />
        }
        ListEmptyComponent={
          postsLoading ? (
            <ActivityIndicator color={c.primary} size="small" style={{ marginTop: 30 }} />
          ) : (
            <Text style={[s.empty, { color: c.textMuted, marginTop: 30 }]}>
              {t('home.communityNoPosts', { defaultValue: 'No posts in this community yet.' })}
            </Text>
          )
        }
      />

      {/* Report modal */}
      <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={() => setReportOpen(false)}>
        <Pressable style={s.reportOverlay} onPress={() => setReportOpen(false)}>
          <Pressable style={[s.reportCard, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
            <View style={[s.reportHeader, { borderBottomColor: c.border }]}>
              <Text style={[s.reportTitle, { color: c.textPrimary }]}>
                {t('home.reportCommunityTitle', { defaultValue: 'Report community' })}
              </Text>
              <TouchableOpacity onPress={() => setReportOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialCommunityIcons name="close" size={20} color={c.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={[s.reportPrompt, { color: c.textMuted }]}>
              {t('home.reportCommunityPrompt', { defaultValue: 'Why are you reporting this community?' })}
            </Text>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
              {moderationCategories.map((cat) => (
                <TouchableOpacity
                  key={`report-cat-${cat.id}`}
                  style={[s.reportOption, { borderColor: c.border, backgroundColor: c.inputBackground, opacity: reporting ? 0.6 : 1 }]}
                  activeOpacity={0.85}
                  disabled={reporting}
                  onPress={async () => {
                    if (typeof cat.id !== 'number') return;
                    setReporting(true);
                    try {
                      await onReport(cat.id);
                      setReportOpen(false);
                    } finally {
                      setReporting(false);
                    }
                  }}
                >
                  <Text style={[s.reportOptionTitle, { color: c.textPrimary }]} numberOfLines={1}>
                    {cat.title || cat.name}
                  </Text>
                  {cat.description ? (
                    <Text style={[s.reportOptionDesc, { color: c.textMuted }]} numberOfLines={3}>
                      {cat.description}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
              {reporting ? <ActivityIndicator color={c.primary} size="small" style={{ marginTop: 8 }} /> : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ── Section helpers ──────────────────────────────────────────────────────────

const COLLAPSED_LINES = 6;

function ExpandableCard({
  c,
  t,
  label,
  text,
  styles: parentStyles,
}: {
  c: any;
  t: (key: string, options?: any) => string;
  label: string;
  text: string;
  styles: any;
}) {
  const [expanded, setExpanded] = React.useState(false);
  // We only need the toggle when the text would actually overflow the
  // collapsed line cap. `onTextLayout` fires with the line array; if there
  // are more than COLLAPSED_LINES, surface "Show more".
  const [overflows, setOverflows] = React.useState(false);
  const measuredRef = React.useRef(false);

  return (
    <View style={[parentStyles.aboutCard, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
      <Text style={[parentStyles.aboutLabel, { color: c.textMuted }]}>{label}</Text>
      {/* Hidden measurer — laid out invisibly off-flow so the platform tells
       *  us the real (uncapped) line count. */}
      <Text
        style={[parentStyles.aboutText, { position: 'absolute', opacity: 0, color: 'transparent', left: 0, right: 0, zIndex: -1 }]}
        onTextLayout={(e) => {
          if (measuredRef.current) return;
          measuredRef.current = true;
          if ((e?.nativeEvent?.lines?.length || 0) > COLLAPSED_LINES) {
            setOverflows(true);
          }
        }}
        pointerEvents="none"
      >
        {text}
      </Text>
      <Text
        style={[parentStyles.aboutText, { color: c.textPrimary }]}
        numberOfLines={expanded ? undefined : COLLAPSED_LINES}
      >
        {text}
      </Text>
      {overflows ? (
        <TouchableOpacity
          onPress={() => setExpanded((prev) => !prev)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={{ color: c.primary, fontSize: 13, fontWeight: '700' }}>
            {expanded
              ? t('home.communityShowLess', { defaultValue: 'Show less' })
              : t('home.communityShowMore', { defaultValue: 'Show more' })}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function Section({
  c,
  icon,
  title,
  subtitle,
  headerRight,
  children,
}: {
  c: any;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={[sectionStyles.card, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
      <View style={sectionStyles.titleRow}>
        <MaterialCommunityIcons name={icon} size={18} color={c.textPrimary} />
        <Text style={[sectionStyles.title, { color: c.textPrimary }]} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={[sectionStyles.subtitle, { color: c.textMuted }]} numberOfLines={1}>{subtitle}</Text>
        ) : null}
        {headerRight ? <View style={sectionStyles.right}>{headerRight}</View> : null}
      </View>
      {children}
    </View>
  );
}

function MemberTile({
  c,
  avatar,
  name,
  handle,
  onPress,
}: {
  c: any;
  avatar?: string | null;
  name?: string;
  handle?: string;
  onPress: () => void;
}) {
  const initial = (name?.[0] || handle?.[0] || '?').toUpperCase();
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={tileStyles.row}>
      <View style={[tileStyles.avatar, { backgroundColor: c.primary }]}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={{ width: 44, height: 44, borderRadius: 22 }} resizeMode="cover" />
        ) : (
          <Text style={tileStyles.avatarLetter}>{initial}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        {name ? <Text style={[tileStyles.name, { color: c.textPrimary }]} numberOfLines={1}>{name}</Text> : null}
        {handle ? <Text style={[tileStyles.handle, { color: c.textMuted }]} numberOfLines={1}>{handle}</Text> : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={c.textMuted} />
    </TouchableOpacity>
  );
}

function MemberSliderTile({
  c,
  member,
  onPress,
}: {
  c: any;
  member: CommunityMember;
  onPress: () => void;
}) {
  const initial = (member.profile?.name?.[0] || member.username?.[0] || '?').toUpperCase();
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={sliderStyles.tile}>
      <View style={[sliderStyles.avatar, { backgroundColor: c.primary }]}>
        {member.profile?.avatar ? (
          <Image source={{ uri: member.profile.avatar }} style={{ width: 56, height: 56, borderRadius: 28 }} resizeMode="cover" />
        ) : (
          <Text style={sliderStyles.avatarLetter}>{initial}</Text>
        )}
      </View>
      <Text style={[sliderStyles.handle, { color: c.textPrimary }]} numberOfLines={1}>
        @{member.username}
      </Text>
    </TouchableOpacity>
  );
}

function MemberGridTile({
  c,
  member,
  onPress,
}: {
  c: any;
  member: CommunityMember;
  onPress: () => void;
}) {
  const initial = (member.profile?.name?.[0] || member.username?.[0] || '?').toUpperCase();
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={gridStyles.tile}>
      <View style={[gridStyles.avatar, { backgroundColor: c.primary }]}>
        {member.profile?.avatar ? (
          <Image source={{ uri: member.profile.avatar }} style={{ width: 52, height: 52, borderRadius: 26 }} resizeMode="cover" />
        ) : (
          <Text style={gridStyles.avatarLetter}>{initial}</Text>
        )}
      </View>
      <Text style={[gridStyles.handle, { color: c.textPrimary }]} numberOfLines={1}>
        @{member.username}
      </Text>
    </TouchableOpacity>
  );
}

const sectionStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  subtitle: { fontSize: 12, fontWeight: '700' },
  right: { marginLeft: 'auto' },
});
const tileStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarLetter: { color: '#fff', fontWeight: '900', fontSize: 18 },
  name: { fontSize: 14, fontWeight: '800' },
  handle: { fontSize: 12, marginTop: 2 },
});
const sliderStyles = StyleSheet.create({
  tile: { width: 64, alignItems: 'center', gap: 6 },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarLetter: { color: '#fff', fontWeight: '900', fontSize: 22 },
  handle: { fontSize: 11, fontWeight: '600', textAlign: 'center', maxWidth: 64 },
});
const gridStyles = StyleSheet.create({
  tile: { width: '23%', alignItems: 'center', gap: 4 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarLetter: { color: '#fff', fontWeight: '900', fontSize: 20 },
  handle: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
});

function Stat({ c, icon, label, hint }: { c: any; icon: any; label: string; hint: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <MaterialCommunityIcons name={icon} size={15} color={c.textMuted} />
      <Text style={{ fontSize: 14, fontWeight: '800', color: c.textPrimary }}>{label}</Text>
      <Text style={{ fontSize: 13, color: c.textMuted }}>{hint}</Text>
    </View>
  );
}

const COVER_HEIGHT = 160;

const makeStyles = (c: any) =>
  StyleSheet.create({
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    empty: { fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },

    coverWrap: { width: '100%', height: COVER_HEIGHT, overflow: 'hidden' },
    coverImage: { width: '100%', height: '100%' },
    coverFallback: { width: '100%', height: '100%', opacity: 0.5 },

    identityRow: {
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'flex-end',
      marginTop: -42,
    },
    avatarWrap: {
      width: 84,
      height: 84,
      borderRadius: 42,
      borderWidth: 4,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImage: { width: '100%', height: '100%' },
    avatarLetter: { color: '#fff', fontWeight: '900', fontSize: 32 },

    titleBlock: { paddingHorizontal: 16, marginTop: 10, gap: 4 },
    title: { fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
    handle: { fontSize: 14, fontWeight: '600' },
    statRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
    statDivider: { width: 1, height: 14 },

    actionsRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      marginTop: 16,
      alignItems: 'center',
    },
    primaryBtn: {
      flex: 1,
      borderRadius: 999,
      paddingVertical: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
    secondaryBtn: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 999,
      paddingVertical: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryBtnText: { fontWeight: '800', fontSize: 14 },
    iconBtn: {
      width: 42,
      height: 42,
      borderWidth: 1,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },

    aboutCard: {
      marginHorizontal: 16,
      marginTop: 14,
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      gap: 6,
    },
    aboutLabel: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    aboutText: { fontSize: 14, lineHeight: 20 },

    postsHeader: {
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 10,
      marginTop: 8,
      borderBottomWidth: 1,
    },
    postsHeaderText: { fontSize: 16, fontWeight: '800' },

    showMoreText: { fontSize: 12, fontWeight: '700' },
    emptySectionText: { fontSize: 13, paddingVertical: 6 },
    memberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, rowGap: 14 },

    reportRow: { paddingHorizontal: 16, marginTop: 14, marginBottom: 4 },
    reportBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
    },
    reportBtnText: { fontSize: 13, fontWeight: '800' },

    reportOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 18 },
    reportCard: { width: '100%', maxWidth: 460, maxHeight: '80%', borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
    reportHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1 },
    reportTitle: { fontSize: 15, fontWeight: '800' },
    reportPrompt: { fontSize: 12, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
    reportOption: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
    reportOptionTitle: { fontSize: 14, fontWeight: '800' },
    reportOptionDesc: { fontSize: 12, lineHeight: 16 },
  });
