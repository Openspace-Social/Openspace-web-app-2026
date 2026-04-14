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
              Notifications
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
                  Mark all read
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
              No notifications yet
            </Text>
            <Text style={{ fontSize: 14, color: c.textMuted, textAlign: 'center', lineHeight: 20 }}>
              When someone follows you, reacts to your posts, or mentions you, it will appear here.
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
                onMarkRead={onMarkRead}
                onDelete={onDeleteNotification}
                onNavigateProfile={onNavigateProfile}
                onNavigatePost={onNavigatePost}
                onNavigateCommunity={onNavigateCommunity}
              />
            ))}
            {loadingMore && (
              <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                <ActivityIndicator color={c.primary} size="small" />
              </View>
            )}
            {!hasMore && notifications.length > 0 && (
              <View style={{ paddingVertical: 24, alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 13, color: c.textMuted }}>You're all caught up</Text>
                {notifications.length > 3 && (
                  <TouchableOpacity onPress={onDeleteAll} activeOpacity={0.8}>
                    <Text style={{ fontSize: 13, color: c.errorText }}>Clear all notifications</Text>
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
  onMarkRead: (id: number) => void;
  onDelete: (id: number) => void;
  onNavigateProfile: (username: string) => void;
  onNavigatePost: (postId: number, postUuid?: string) => void;
  onNavigateCommunity: (name: string) => void;
};

function NotificationRow({ notif, c, onMarkRead, onDelete, onNavigateProfile, onNavigatePost, onNavigateCommunity }: RowProps) {
  const obj = notif.content_object as any;
  const { icon, iconColor, actor, actorAvatar, body, postThumbnail, onPress } =
    resolveNotification(notif.notification_type, obj, c, onNavigateProfile, onNavigatePost, onNavigateCommunity);

  const initial = (actor?.[0] || '?').toUpperCase();

  function handlePress() {
    if (!notif.read) onMarkRead(notif.id);
    onPress?.();
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
            {formatRelativeTime(notif.created)}
          </Text>
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
  onNavigateProfile: (u: string) => void,
  onNavigatePost: (id: number, uuid?: string) => void,
  onNavigateCommunity: (name: string) => void,
) {
  const bold = (text: string) => text; // plain text — bold handled via weight in body parts

  switch (type) {
    case 'F': {
      const u = obj?.follower;
      return {
        icon: 'account-plus', iconColor: '#7C3AED',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: `${u?.profile?.name || u?.username || 'Someone'} started following you.`,
        postThumbnail: null,
        onPress: () => u?.username && onNavigateProfile(u.username),
      };
    }
    case 'FR': {
      const u = obj?.follow_request?.creator;
      return {
        icon: 'account-clock', iconColor: '#7C3AED',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: `${u?.profile?.name || u?.username || 'Someone'} requested to follow you.`,
        postThumbnail: null,
        onPress: () => u?.username && onNavigateProfile(u.username),
      };
    }
    case 'FRA': {
      const u = obj?.follow?.user;
      return {
        icon: 'account-check', iconColor: '#7C3AED',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: `${u?.profile?.name || u?.username || 'Someone'} approved your follow request.`,
        postThumbnail: null,
        onPress: () => u?.username && onNavigateProfile(u.username),
      };
    }
    case 'PR': {
      const r = obj?.post_reaction?.reactor;
      const emoji = obj?.post_reaction?.emoji?.keyword || '❤️';
      const post = obj?.post_reaction?.post;
      return {
        icon: 'emoticon-happy-outline', iconColor: '#EC4899',
        actor: r?.username, actorAvatar: r?.profile?.avatar,
        body: `${r?.profile?.name || r?.username || 'Someone'} reacted with ${emoji} to your post.`,
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'PC': {
      const cmt = obj?.post_comment;
      const cmtr = cmt?.commenter;
      const post = cmt?.post;
      return {
        icon: 'comment-outline', iconColor: '#2563EB',
        actor: cmtr?.username, actorAvatar: cmtr?.profile?.avatar,
        body: `${cmtr?.profile?.name || cmtr?.username || 'Someone'} commented: "${truncate(cmt?.text, 60)}"`,
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'PCR': {
      const cmt = obj?.post_comment;
      const cmtr = cmt?.commenter;
      const post = cmt?.post;
      return {
        icon: 'comment-text-outline', iconColor: '#2563EB',
        actor: cmtr?.username, actorAvatar: cmtr?.profile?.avatar,
        body: `${cmtr?.profile?.name || cmtr?.username || 'Someone'} replied: "${truncate(cmt?.text, 60)}"`,
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'PCRA': {
      const r = obj?.post_comment_reaction?.reactor;
      const emoji = obj?.post_comment_reaction?.emoji?.keyword || '❤️';
      const post = obj?.post_comment_reaction?.post_comment?.post;
      return {
        icon: 'emoticon-happy-outline', iconColor: '#EC4899',
        actor: r?.username, actorAvatar: r?.profile?.avatar,
        body: `${r?.profile?.name || r?.username || 'Someone'} reacted with ${emoji} to your comment.`,
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'CR': {
      const u = obj?.connection_requester;
      return {
        icon: 'account-multiple-plus', iconColor: '#0891B2',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: `${u?.profile?.name || u?.username || 'Someone'} sent you a connection request.`,
        postThumbnail: null,
        onPress: () => u?.username && onNavigateProfile(u.username),
      };
    }
    case 'CC': {
      const u = obj?.connection_confirmator;
      return {
        icon: 'account-multiple-check', iconColor: '#0891B2',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: `${u?.profile?.name || u?.username || 'Someone'} confirmed your connection.`,
        postThumbnail: null,
        onPress: () => u?.username && onNavigateProfile(u.username),
      };
    }
    case 'PUM': {
      const u = obj?.post_user_mention?.user;
      const post = obj?.post_user_mention?.post;
      return {
        icon: 'at', iconColor: '#D97706',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: `${u?.profile?.name || u?.username || 'Someone'} mentioned you in a post.`,
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'PCUM': {
      const u = obj?.post_comment_user_mention?.user;
      const cmt = obj?.post_comment_user_mention?.post_comment;
      const post = cmt?.post;
      return {
        icon: 'at', iconColor: '#D97706',
        actor: u?.username, actorAvatar: u?.profile?.avatar,
        body: `${u?.profile?.name || u?.username || 'Someone'} mentioned you in a comment.`,
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'CI': {
      const creator = obj?.community_invite?.creator;
      const community = obj?.community_invite?.community;
      return {
        icon: 'account-group', iconColor: '#059669',
        actor: creator?.username, actorAvatar: creator?.profile?.avatar,
        body: `${creator?.profile?.name || creator?.username || 'Someone'} invited you to c/${community?.name || 'a community'}.`,
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
        body: `New post in c/${community?.name || 'a community'}.`,
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    case 'UNP': {
      const post = obj?.post;
      const creator = post?.creator;
      return {
        icon: 'newspaper-variant-outline', iconColor: '#6366F1',
        actor: creator?.username, actorAvatar: creator?.profile?.avatar,
        body: `${creator?.profile?.name || creator?.username || 'Someone'} published a new post.`,
        postThumbnail: post?.media_thumbnail || null,
        onPress: () => post?.id && onNavigatePost(post.id, post.uuid),
      };
    }
    default:
      return { icon: 'bell', iconColor: c.primary, actor: undefined, actorAvatar: undefined, body: 'New notification', postThumbnail: null, onPress: undefined };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(text?: string, max = 60) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function formatRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
