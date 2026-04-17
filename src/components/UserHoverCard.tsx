/**
 * UserHoverCard
 *
 * On web: wraps children in a hover zone. When the pointer rests on the
 * avatar for 350 ms, the component fetches the user profile (cached per
 * username) and renders a floating card via a React portal anchored to the
 * avatar using fixed viewport coordinates — so it is never clipped by any
 * ancestor overflow or z-index context.
 *
 * On native: renders children as-is with no hover behaviour.
 */
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { UserProfile } from '../api/client';
import { useAppToast } from '../toast/AppToastContext';

// In-memory cache keyed by lowercase username. Only populated after a successful fetch.
const profileCache = new Map<string, UserProfile>();

const CARD_WIDTH = 288;

type Props = {
  username: string;
  token: string;
  c: any;
  isFollowing: boolean;
  followLoading: boolean;
  onToggleFollow: (username: string, currentlyFollowing: boolean) => void;
  onOpenProfile: (username: string) => void;
  fetchProfile: (token: string, username: string) => Promise<UserProfile>;
  children: React.ReactNode;
};

export default function UserHoverCard(props: Props) {
  if (Platform.OS !== 'web') return <>{props.children}</>;
  return <WebHoverCard {...props} />;
}

// ─── Web implementation ───────────────────────────────────────────────────────

function WebHoverCard({
  username,
  token,
  c,
  isFollowing,
  followLoading,
  onToggleFollow,
  onOpenProfile,
  fetchProfile,
  children,
}: Props) {
  const { showToast } = useAppToast();
  const cacheKey = username.toLowerCase();
  const [visible, setVisible] = React.useState(false);
  // top = show below avatar; bottom = show above avatar (anchors card's bottom edge)
  const [coords, setCoords] = React.useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const [profile, setProfile] = React.useState<UserProfile | null>(
    profileCache.get(cacheKey) ?? null
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = React.useRef<HTMLDivElement | null>(null);

  // Sync if another card instance already cached this user
  React.useEffect(() => {
    const cached = profileCache.get(cacheKey);
    if (cached && !profile) setProfile(cached);
  }, [cacheKey]);

  function cancelTimers() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (showTimer.current) clearTimeout(showTimer.current);
  }

  function computeCoords() {
    if (!anchorRef.current) return null;
    const rect = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom;
    const left = Math.max(8, Math.min(rect.left, vw - CARD_WIDTH - 12));

    if (spaceBelow >= 220) {
      // Enough room below — anchor card's top to bottom of avatar
      return { top: rect.bottom + 8, left };
    } else {
      // Not enough room below — anchor card's bottom to top of avatar.
      // `bottom` in fixed coords = viewport height minus avatar top.
      return { bottom: vh - rect.top + 8, left };
    }
  }

  function handleMouseEnter() {
    cancelTimers();
    showTimer.current = setTimeout(() => {
      const newCoords = computeCoords();
      if (newCoords) setCoords(newCoords);
      setVisible(true);

      // Always sync from cache first — another PostCard instance for the same
      // username may have populated it after this component mounted.
      const cached = profileCache.get(cacheKey);
      if (cached) {
        setProfile(cached);
        return;
      }

      // Nothing in cache and not already loading — fire the fetch.
      if (loading) return;
      setLoading(true);
      setError('');
      fetchProfile(token, username)
        .then((p) => {
          profileCache.set(cacheKey, p);
          setProfile(p);
        })
        .catch(() => {
          const message = 'Could not load profile.';
          setError(message);
          showToast(message, { type: 'error' });
        })
        .finally(() => setLoading(false));
    }, 350);
  }

  function handleMouseLeave() {
    cancelTimers();
    hideTimer.current = setTimeout(() => setVisible(false), 180);
  }

  // The anchor div (web-only native element via ref)
  const anchorProps = {
    ref: anchorRef,
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    style: { display: 'inline-block', position: 'relative' as const },
  };

  return (
    // @ts-ignore — div is valid on web via RN-web
    <div {...anchorProps}>
      {children}
      {visible && coords && (
        <Portal>
          <HoverCardPopup
            profile={profile}
            loading={loading}
            error={error}
            coords={coords}
            c={c}
            username={username}
            isFollowing={isFollowing}
            followLoading={followLoading}
            onToggleFollow={onToggleFollow}
            onOpenProfile={(u) => { setVisible(false); onOpenProfile(u); }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
        </Portal>
      )}
    </div>
  );
}

// ─── Portal ───────────────────────────────────────────────────────────────────

function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  // Use ReactDOM.createPortal dynamically so this file stays RN-compatible
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactDOM = require('react-dom') as typeof import('react-dom');
  return ReactDOM.createPortal(children, document.body);
}

// ─── The floating card itself ─────────────────────────────────────────────────

type PopupProps = {
  profile: UserProfile | null;
  loading: boolean;
  error: string;
  coords: { top?: number; bottom?: number; left: number };
  c: any;
  username: string;
  isFollowing: boolean;
  followLoading: boolean;
  onToggleFollow: (username: string, currentlyFollowing: boolean) => void;
  onOpenProfile: (username: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

function HoverCardPopup({
  profile,
  loading,
  error,
  coords,
  c,
  username,
  isFollowing,
  followLoading,
  onToggleFollow,
  onOpenProfile,
  onMouseEnter,
  onMouseLeave,
}: PopupProps) {
  const accentColor = c.primary;
  const avatarUri = profile?.profile?.avatar;
  const displayName = profile?.profile?.name || username;
  const bio = profile?.profile?.bio || '';
  // followers_count is null when the user has set their followers count to private
  const followersVisible = profile != null && profile.followers_count !== null;
  const followersCount = profile?.followers_count ?? 0;
  const followingCount = profile?.following_count ?? 0;

  const cardStyle: React.CSSProperties = {
    position: 'fixed',
    ...(coords.top != null ? { top: coords.top } : {}),
    ...(coords.bottom != null ? { bottom: coords.bottom } : {}),
    left: coords.left,
    width: CARD_WIDTH,
    zIndex: 99999,
    borderRadius: 14,
    border: `1px solid ${c.border}`,
    backgroundColor: c.surface,
    boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
    overflow: 'hidden',
    pointerEvents: 'auto',
  };

  return (
    // @ts-ignore
    <div
      style={cardStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {loading && !profile ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <ActivityIndicator color={c.primary} size="small" />
        </View>
      ) : error && !profile ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: c.errorText, fontSize: 13 }}>{error}</Text>
        </View>
      ) : (
        <>
          {/* Accent colour strip */}
          <View style={{ height: 44, backgroundColor: accentColor, opacity: 0.15 }} />

          <View style={{ padding: 14, paddingTop: 0, marginTop: -26 }}>
            {/* Avatar row */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 }}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => onOpenProfile(username)}>
                <View style={{
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  borderWidth: 3,
                  borderColor: c.surface,
                  backgroundColor: accentColor,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  {avatarUri ? (
                    <Image
                      source={{ uri: avatarUri }}
                      style={{ width: 54, height: 54, borderRadius: 27 }}
                      resizeMode="cover"
                    />
                  ) : (
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>
                      {(displayName[0] || '?').toUpperCase()}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>

              {/* Follow / Unfollow */}
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={followLoading}
                onPress={() => onToggleFollow(username, isFollowing)}
                style={{
                  marginTop: 28,
                  paddingHorizontal: 18,
                  paddingVertical: 8,
                  borderRadius: 20,
                  borderWidth: 1.5,
                  borderColor: isFollowing ? c.border : c.primary,
                  backgroundColor: isFollowing ? 'transparent' : c.primary,
                  minWidth: 90,
                  alignItems: 'center',
                }}
              >
                {followLoading ? (
                  <ActivityIndicator size="small" color={isFollowing ? c.textSecondary : '#fff'} />
                ) : (
                  <Text style={{ fontSize: 13, fontWeight: '700', color: isFollowing ? c.textSecondary : '#fff' }}>
                    {isFollowing ? 'Unfollow' : 'Follow'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Name + handle */}
            <TouchableOpacity activeOpacity={0.85} onPress={() => onOpenProfile(username)}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.textPrimary }} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 1 }} numberOfLines={1}>
                {`@${username}`}
              </Text>
            </TouchableOpacity>

            {/* Bio */}
            {bio ? (
              <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 8, lineHeight: 18 }} numberOfLines={3}>
                {bio}
              </Text>
            ) : null}

            {/* Counts — only shown when followers_count is not null (private accounts return null) */}
            {followersVisible ? (
              <View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <MaterialCommunityIcons name="account-multiple-outline" size={14} color={c.textMuted} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: c.textPrimary }}>
                    {followersCount.toLocaleString()}
                  </Text>
                  <Text style={{ fontSize: 13, color: c.textMuted }}>followers</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: c.textPrimary }}>
                    {followingCount.toLocaleString()}
                  </Text>
                  <Text style={{ fontSize: 13, color: c.textMuted }}>following</Text>
                </View>
              </View>
            ) : null}
          </View>
        </>
      )}
    </div>
  );
}
