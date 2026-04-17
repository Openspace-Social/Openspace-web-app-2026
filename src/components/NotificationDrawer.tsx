import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppNotification, NotificationType } from '../api/client';

const DURATION = 280;
const DRAWER_MAX_WIDTH = 420;
const PAGE_SIZE = 15;

type Props = {
  visible: boolean;
  c: any;
  t: (key: string, options?: any) => string;
  notifications: AppNotification[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  unreadCount: number;
  onClose: () => void;
  onLoadMore: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: number) => void;
  onDeleteNotification: (id: number) => void;
  onDeleteAll: () => void;
  onNavigateProfile: (username: string) => void;
  onNavigatePost: (postId: number, postUuid?: string) => void;
  onNavigateCommunity: (name: string) => void;
  onAcceptConnection: (username: string) => Promise<void>;
  onDeclineConnection: (username: string) => Promise<void>;
};

export default function NotificationDrawer({
  visible,
  c,
  t,
  notifications,
  loading,
  loadingMore,
  hasMore,
  unreadCount,
  onClose,
  onLoadMore,
  onMarkAllRead,
  onMarkRead,
  onDeleteNotification,
  onDeleteAll,
  onNavigateProfile,
  onNavigatePost,
  onNavigateCommunity,
  onAcceptConnection,
  onDeclineConnection,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const drawerWidth = Math.min(DRAWER_MAX_WIDTH, screenWidth * 0.88);

  const translateX = useRef(new Animated.Value(drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Keep modal mounted during the close animation so it can slide out
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateX.setValue(drawerWidth);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: DURATION, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: DURATION, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, { toValue: drawerWidth, duration: DURATION, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: DURATION, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible, drawerWidth]);

  const handleScroll = useCallback((event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    if (contentSize.height - contentOffset.y - layoutMeasurement.height < 200) {
      if (!loadingMore && hasMore) onLoadMore();
    }
  }, [loadingMore, hasMore, onLoadMore]);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      {/* Backdrop */}
      <Animated.View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', opacity: backdropOpacity }}
        pointerEvents="auto"
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      {/* Drawer panel — slides in from right */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: drawerWidth,
          backgroundColor: c.surface,
          transform: [{ translateX }],
          shadowColor: '#000',
          shadowOffset: { width: -4, height: 0 },
          shadowOpacity: 0.18,
          shadowRadius: 16,
          elevation: 24,
        }}
      >
        {/* Header */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingTop: 56,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="bell-outline" size={22} color={c.textPrimary} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: c.textPrimary }}>
              {t('home.notificationDrawerTitle')}
              {unreadCount > 0 ? (
                <Text style={{ color: c.primary }}>{`  ${unreadCount}`}</Text>
              ) : null}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {unreadCount > 0 && (
              <TouchableOpacity
                onPress={onMarkAllRead}
                activeOpacity={0.8}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: c.inputBackground }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: c.textSecondary }}>
                  {t('home.notificationMarkAllRead')}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.8}
              style={{ padding: 6, borderRadius: 8 }}
            >
              <MaterialCommunityIcons name="close" size={20} color={c.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Notification list */}
        {loading && notifications.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={c.primary} size="large" />
          </View>
        ) : notifications.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 }}>
            <MaterialCommunityIcons name="bell-sleep-outline" size={48} color={c.textMuted} />
            <Text style={{ fontSize: 16, fontWeight: '600', color: c.textMuted, textAlign: 'center' }}>
              {t('home.notificationEmptyTitle')}
            </Text>
            <Text style={{ fontSize: 14, color: c.textMuted, textAlign: 'center', lineHeight: 20 }}>
              {t('home.notificationEmptyBody')}
            </Text>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            onScroll={handleScroll}
            scrollEventThrottle={200}
            showsVerticalScrollIndicator={false}
          >
            {notifications.map((notif) => (
              <NotificationRow
                key={notif.id}
                notif={notif}
                c={c}
                t={t}
                onMarkRead={onMarkRead}
                onDelete={onDeleteNotification}
                onNavigateProfile={onNavigateProfile}
                onNavigatePost={onNavigatePost}
                onNavigateCommunity={onNavigateCommunity}
                onAcceptConnection={onAcceptConnection}
                onDeclineConnection={onDeclineConnection}
              />
            ))}
            {loadingMore && (
              <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                <ActivityIndicator color={c.primary} size="small" />
              </View>
            )}
            {!hasMore && notifications.length > 0 && (
              <View style={{ paddingVertical: 24, alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 13, color: c.textMuted }}>{t('home.notificationAllCaughtUp')}</Text>
                {notifications.length > 3 && (
                  <TouchableOpacity onPress={onDeleteAll} activeOpacity={0.8}>
                    <Text style={{ fontSize: 13, color: c.errorText }}>{t('home.notificationClearAll')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </ScrollView>
        )}
      </Animated.View>
    </Modal>
  );
}

// ─── Individual notification row ──────────────────────────────────────────────

type RowProps = {
  notif: AppNotification;
  c: any;
  t: (key: string, options?: any) => string;
  onMarkRead: (id: number) => void;
  onDelete: (id: number) => void;
  onNavigateProfile: (username: string) => void;
  onNavigatePost: (postId: number, postUuid?: string) => void;
  onNavigateCommunity: (name: string) => void;
  onAcceptConnection: (username: string) => Promise<void>;
  onDeclineConnection: (username: string) => Promise<void>;
};

function NotificationRow({ notif, c, t, onMarkRead, onDelete, onNavigateProfile, onNavigatePost, onNavigateCommunity, onAcceptConnection, onDeclineConnection }: RowProps) {
  const obj = notif.content_object as any;
  const { icon, iconColor, actor, actorAvatar, body, postThumbnail, onPress } =
    resolveNotification(notif.notification_type, obj, c, t, onNavigateProfile, onNavigatePost, onNavigateCommunity);

  const initial = (actor?.[0] || '?').toUpperCase();
  const isCR = notif.notification_type === 'CR';
  const requesterUsername = isCR ? (obj?.connection_requester?.username as string | undefined) : undefined;
  const [connectionState, setConnectionState] = React.useState<'idle' | 'accepting' | 'declining' | 'accepted' | 'declined'>('idle');

  function handlePress() {
    if (!notif.read) onMarkRead(notif.id);
    onPress?.();
  }

  async function handleAccept() {
    if (!requesterUsername || connectionState !== 'idle') return;
    setConnectionState('accepting');
    try {
      await onAcceptConnection(requesterUsername);
      setConnectionState('accepted');
      if (!notif.read) onMarkRead(notif.id);
    } catch {
      setConnectionState('idle');
    }
  }

  async function handleDecline() {
    if (!requesterUsername || connectionState !== 'idle') return;
    setConnectionState('declining');
    try {
      await onDeclineConnection(requesterUsername);
      setConnectionState('declined');
      if (!notif.read) onMarkRead(notif.id);
    } catch {
      setConnectionState('idle');
    }
  }

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={handlePress}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 16,
        paddingVertical: 13,
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        backgroundColor: notif.read ? c.surface : c.primary + '0d', // subtle tint for unread
        position: 'relative',
      }}
    >
      {/* Unread dot */}
      {!notif.read && (
        <View style={{
          position: 'absolute',
          left: 5,
          top: '50%',
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: c.primary,
          marginTop: -3,
        }} />
      )}

      {/* Avatar with notification type badge */}
      <View style={{ position: 'relative', flexShrink: 0 }}>
        <View style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: c.primary,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}>
          {actorAvatar ? (
            <Image source={{ uri: actorAvatar }} style={{ width: 44, height: 44, borderRadius: 22 }} resizeMode="cover" />
          ) : (
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 17 }}>{initial}</Text>
          )}
        </View>
        {/* Type badge */}
        <View style={{
          position: 'absolute',
          bottom: -2,
          right: -2,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: iconColor,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: c.surface,
        }}>
          <MaterialCommunityIcons name={icon as any} size={11} color="#fff" />
        </View>
      </View>

      {/* Text + thumbnail */}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, color: c.textPrimary, lineHeight: 20 }} numberOfLines={3}>
          {body}
        </Text>
        {notif.created && (
          <Text style={{ fontSize: 12, color: c.textMuted }}>
            {formatRelativeTime(notif.created, t)}
          </Text>
        )}
        {isCR && requesterUsername && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {connectionState === 'accepted' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: c.inputBackground, borderWidth: 1, borderColor: c.border }}>
                <MaterialCommunityIcons name="account-check" size={14} color={c.textSecondary} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSecondary }}>
                  {t('home.profileAcceptConnectionAction', { defaultValue: 'Accepted' })}
                </Text>
              </View>
            ) : connectionState === 'declined' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: c.inputBackground, borderWidth: 1, borderColor: c.border }}>
                <MaterialCommunityIcons name="account-remove-outline" size={14} color={c.textMuted} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: c.textMuted }}>
                  {t('home.profileDeclineConnectionAction', { defaultValue: 'Declined' })}
                </Text>
              </View>
            ) : (
              <>
                {/* Accept */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={connectionState !== 'idle'}
                  onPress={() => void handleAccept()}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: c.primary, opacity: connectionState !== 'idle' ? 0.6 : 1 }}
                >
                  {connectionState === 'accepting'
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <>
                        <MaterialCommunityIcons name="account-check" size={14} color="#fff" />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                          {t('home.profileAcceptConnectionAction', { defaultValue: 'Accept' })}
                        </Text>
                      </>
                  }
                </TouchableOpacity>
                {/* Decline */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={connectionState !== 'idle'}
                  onPress={() => void handleDecline()}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: c.inputBackground, borderWidth: 1, borderColor: c.border, opacity: connectionState !== 'idle' ? 0.6 : 1 }}
                >
                  {connectionState === 'declining'
                    ? <ActivityIndicator size="small" color={c.textSecondary} />
                    : <>
                        <MaterialCommunityIcons name="account-remove-outline" size={14} color={c.textSecondary} />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: c.textPrimary }}>
                          {t('home.profileDeclineConnectionAction', { defaultValue: 'Decline' })}
                        </Text>
                      </>
                  }
                </TouchableOpacity>
                {/* View Profile */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => { onNavigateProfile(requesterUsername); if (!notif.read) onMarkRead(notif.id); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, backgroundColor: c.inputBackground, borderWidth: 1, borderColor: c.border }}
                >
                  <MaterialCommunityIcons name="account" size={14} color={c.textSecondary} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: c.textPrimary }}>
                    {t('home.profileViewAction', { defaultValue: 'View Profile' })}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>

      {/* Post thumbnail */}
      {postThumbnail ? (
        <Image
          source={{ uri: postThumbnail }}
          style={{ width: 46, height: 46, borderRadius: 6, backgroundColor: c.border, flexShrink: 0 }}
          resizeMode="cover"
        />
      ) : null}

      {/* Delete button */}
      <TouchableOpacity
        onPress={() => onDelete(notif.id)}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={{ paddingLeft: 4, flexShrink: 0 }}
      >
        <MaterialCommunityIcons name="close" size={15} color={c.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Notification content resolver ───────────────────────────────────────────

function resolveNotification(
  type: NotificationType,
  obj: any,
  c: any,
  t: (key: string, options?: any) => string,
  onNavigateProfile: (u: string) => void,
  onNavigatePost: (id: number, uuid?: string) => void,
  onNavigateCommunity: (name: string) => void,
) {
  const someone = t('home.notificationSomeone');

  switch (type) {
    case 'F': {
      const u = obj?.follower;
      const name = u?.profile?.name || u?.username || someone;
      return {
        icon: 'account-plus', iconColor: '#7C3AED',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: t('home.notificationTypeFollow', { name }),
        postThumbnail: null,
        onPress: () => u?.username && onNavigateProfile(u.username),
      };
    }
    case 'FR': {
      const u = obj?.follow_request?.creator;
      const name = u?.profile?.name || u?.username || someone;
      return {
        icon: 'account-clock', iconColor: '#7C3AED',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: t('home.notificationTypeFollowRequest', { name }),
        postThumbnail: null,
        onPress: () => u?.username && onNavigateProfile(u.username),
      };
    }
    case 'FRA': {
      const u = obj?.follow?.user;
      const name = u?.profile?.name || u?.username || someone;
      return {
        icon: 'account-check', iconColor: '#7C3AED',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: t('home.notificationTypeFollowRequestApproved', { name }),
        postThumbnail: null,
        onPress: () => u?.username && onNavigateProfile(u.username),
      };
    }
    case 'PR': {
      const r = obj?.post_reaction?.reactor;
      const emoji = obj?.post_reaction?.emoji?.keyword || '❤️';
      const post = obj?.post_reaction?.post;
      const name = r?.profile?.name || r?.username || someone;
      return {
        icon: 'emoticon-happy-outline', iconColor: '#EC4899',
        actor: r?.username, actorAvatar: r?.profile?.avatar,
        body: t('home.notificationTypePostReaction', { name, emoji }),
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'PC': {
      const cmt = obj?.post_comment;
      const cmtr = cmt?.commenter;
      const post = cmt?.post;
      const name = cmtr?.profile?.name || cmtr?.username || someone;
      return {
        icon: 'comment-outline', iconColor: '#2563EB',
        actor: cmtr?.username, actorAvatar: cmtr?.profile?.avatar,
        body: t('home.notificationTypePostComment', { name, text: truncate(cmt?.text, 60) }),
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'PCR': {
      const cmt = obj?.post_comment;
      const cmtr = cmt?.commenter;
      const post = cmt?.post;
      const name = cmtr?.profile?.name || cmtr?.username || someone;
      return {
        icon: 'comment-text-outline', iconColor: '#2563EB',
        actor: cmtr?.username, actorAvatar: cmtr?.profile?.avatar,
        body: t('home.notificationTypePostCommentReply', { name, text: truncate(cmt?.text, 60) }),
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'PCRA': {
      const r = obj?.post_comment_reaction?.reactor;
      const emoji = obj?.post_comment_reaction?.emoji?.keyword || '❤️';
      const post = obj?.post_comment_reaction?.post_comment?.post;
      const name = r?.profile?.name || r?.username || someone;
      return {
        icon: 'emoticon-happy-outline', iconColor: '#EC4899',
        actor: r?.username, actorAvatar: r?.profile?.avatar,
        body: t('home.notificationTypeCommentReaction', { name, emoji }),
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'CR': {
      const u = obj?.connection_requester;
      const name = u?.profile?.name || u?.username || someone;
      return {
        icon: 'account-multiple-plus', iconColor: '#0891B2',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: t('home.notificationTypeConnectionRequest', { name }),
        postThumbnail: null,
        onPress: () => u?.username && onNavigateProfile(u.username),
      };
    }
    case 'CC': {
      const u = obj?.connection_confirmator;
      const name = u?.profile?.name || u?.username || someone;
      return {
        icon: 'account-multiple-check', iconColor: '#0891B2',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: t('home.notificationTypeConnectionConfirmed', { name }),
        postThumbnail: null,
        onPress: () => u?.username && onNavigateProfile(u.username),
      };
    }
    case 'PUM': {
      const u = obj?.post_user_mention?.user;
      const post = obj?.post_user_mention?.post;
      const name = u?.profile?.name || u?.username || someone;
      return {
        icon: 'at', iconColor: '#D97706',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: t('home.notificationTypePostMention', { name }),
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'PCUM': {
      const u = obj?.post_comment_user_mention?.user;
      const cmt = obj?.post_comment_user_mention?.post_comment;
      const post = cmt?.post;
      const name = u?.profile?.name || u?.username || someone;
      return {
        icon: 'at', iconColor: '#D97706',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: t('home.notificationTypeCommentMention', { name }),
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'CI': {
      const creator = obj?.community_invite?.creator;
      const community = obj?.community_invite?.community;
      const name = creator?.profile?.name || creator?.username || someone;
      return {
        icon: 'account-group', iconColor: '#059669',
        actor: creator?.username, actorAvatar: creator?.profile?.avatar,
        body: t('home.notificationTypeCommunityInvite', { name, community: community?.name || '' }),
        postThumbnail: null,
        onPress: () => community?.name && onNavigateCommunity(community.name),
      };
    }
    case 'CNP': {
      const post = obj?.post;
      const community = post?.community;
      return {
        icon: 'newspaper-variant-outline', iconColor: '#059669',
        actor: community?.name, actorAvatar: community?.avatar,
        body: t('home.notificationTypeCommunityNewPost', { community: community?.name || '' }),
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'UNP': {
      const post = obj?.post;
      const creator = post?.creator;
      const name = creator?.profile?.name || creator?.username || someone;
      return {
        icon: 'newspaper-variant-outline', iconColor: '#6366F1',
        actor: creator?.username, actorAvatar: creator?.profile?.avatar,
        body: t('home.notificationTypeUserNewPost', { name }),
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    default:
      return { icon: 'bell', iconColor: c.primary, actor: undefined, actorAvatar: undefined, body: t('home.notificationTypeGeneric'), postThumbnail: null, onPress: undefined };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text?: string, max = 60) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function formatRelativeTime(iso: string, t: (key: string, opts?: any) => string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('home.justNow');
  if (mins < 60) return t('home.relativeMinutesAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('home.relativeHoursAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  if (days < 7) return t('home.relativeDaysAgo', { count: days });
  return new Date(iso).toLocaleDateString();
}
