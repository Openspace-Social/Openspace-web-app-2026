import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  api,
  CommunityJoinRequest,
  CommunityMember,
  CommunityModeratedObject,
  CommunityOwnershipTransfer,
  FeedPost,
  SearchUserResult,
  SearchCommunityResult,
} from '../api/client';

type Panel =
  | 'main'
  | 'details'
  | 'members'
  | 'administrators'
  | 'ownershipTransfer'
  | 'moderators'
  | 'joinRequests'
  | 'banned'
  | 'reports'
  | 'closed'
  | 'invite'
  | 'unfavorite'
  | 'delete';

type Props = {
  visible: boolean;
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  community: SearchCommunityResult | null;
  currentUserId?: number;
  onClose: () => void;
  onUpdated: (community: SearchCommunityResult) => void;
  onDeleted: () => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

function avatarFromUser(user?: CommunityMember) {
  return user?.profile?.avatar || undefined;
}

function nameFromUser(user?: CommunityMember) {
  return user?.profile?.name || user?.username || 'User';
}

function formatRelativeOrDate(input: string | null | undefined) {
  if (!input) return '';
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString();
}

async function pickImageFile(accept: string): Promise<Blob | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0] as Blob | undefined;
      resolve(file || null);
    };
    input.click();
  });
}

export default function CommunityManagementDrawer({
  visible,
  token,
  c,
  t,
  community,
  currentUserId,
  onClose,
  onUpdated,
  onDeleted,
  onNotice,
  onError,
}: Props) {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(480, width * 0.92);
  const translateX = useRef(new Animated.Value(drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);

  const [panel, setPanel] = useState<Panel>('main');
  const [busy, setBusy] = useState(false);

  const [detailsName, setDetailsName] = useState('');
  const [detailsTitle, setDetailsTitle] = useState('');
  const [detailsDescription, setDetailsDescription] = useState('');
  const [detailsRules, setDetailsRules] = useState('');
  const [detailsColor, setDetailsColor] = useState('');

  const [usernameInput, setUsernameInput] = useState('');
  const [userSuggestions, setUserSuggestions] = useState<SearchUserResult[]>([]);
  const [userSuggestionsLoading, setUserSuggestionsLoading] = useState(false);
  const [admins, setAdmins] = useState<CommunityMember[]>([]);
  const [mods, setMods] = useState<CommunityMember[]>([]);
  const [joinRequests, setJoinRequests] = useState<CommunityJoinRequest[]>([]);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [banned, setBanned] = useState<CommunityMember[]>([]);
  const [ownershipTransfer, setOwnershipTransfer] = useState<CommunityOwnershipTransfer | null>(null);
  const [transferConfirm, setTransferConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [reports, setReports] = useState<CommunityModeratedObject[]>([]);
  const [closedPosts, setClosedPosts] = useState<FeedPost[]>([]);
  const [removeAlsoBan, setRemoveAlsoBan] = useState(false);
  const userSuggestionsSeqRef = useRef(0);

  const communityName = (community?.name || '').trim();
  const memberships = Array.isArray(community?.memberships) ? community!.memberships! : [];
  const myMembership = memberships.find((row) => row.user_id === currentUserId);
  const canManage = !!community?.is_creator || !!myMembership?.is_administrator || !!myMembership?.is_moderator;

  async function fetchLatestCommunitySnapshot(name: string) {
    const latest = await api.getCommunity(token, name);
    onUpdated(latest);
    return latest;
  }

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateX.setValue(drawerWidth);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, { toValue: drawerWidth, duration: 240, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 240, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible, drawerWidth, backdropOpacity, translateX]);

  useEffect(() => {
    if (!visible) return;
    setPanel('main');
    setUsernameInput('');
    setRemoveAlsoBan(false);
    setUserSuggestions([]);
    setUserSuggestionsLoading(false);
    setDetailsName(community?.name || '');
    setDetailsTitle(community?.title || '');
    setDetailsDescription(community?.description || '');
    setDetailsRules(community?.rules || '');
    setDetailsColor(community?.color || '');
  }, [visible, community]);

  useEffect(() => {
    const supportsUserSearchPanels = panel === 'administrators' || panel === 'ownershipTransfer' || panel === 'moderators' || panel === 'banned' || panel === 'invite' || panel === 'joinRequests';
    if (!visible || !supportsUserSearchPanels) {
      setUserSuggestions([]);
      setUserSuggestionsLoading(false);
      return;
    }

    const query = usernameInput.trim().replace(/^@+/, '');
    if (query.length < 2) {
      setUserSuggestions([]);
      setUserSuggestionsLoading(false);
      return;
    }

    const seq = userSuggestionsSeqRef.current + 1;
    userSuggestionsSeqRef.current = seq;
    setUserSuggestionsLoading(true);
    const timer = setTimeout(() => {
      api.searchUsers(token, query, 10)
        .then((rows) => {
          if (userSuggestionsSeqRef.current !== seq) return;
          const normalized = Array.isArray(rows) ? rows : [];
          const deduped = normalized.filter((row, index, arr) => {
            const username = (row?.username || '').trim().toLowerCase();
            if (!username) return false;
            return arr.findIndex((candidate) => ((candidate?.username || '').trim().toLowerCase() === username)) === index;
          });
          setUserSuggestions(deduped);
        })
        .catch(() => {
          if (userSuggestionsSeqRef.current !== seq) return;
          setUserSuggestions([]);
        })
        .finally(() => {
          if (userSuggestionsSeqRef.current !== seq) return;
          setUserSuggestionsLoading(false);
        });
    }, 180);

    return () => {
      clearTimeout(timer);
    };
  }, [panel, token, usernameInput, visible]);

  useEffect(() => {
    if (!visible || !communityName || !canManage) return;

    async function loadPanel() {
      try {
        if (panel === 'administrators') {
          const rows = await api.getCommunityAdministrators(token, communityName, 20);
          setAdmins(rows);
        } else if (panel === 'main' && community?.is_creator) {
          const pending = await api.getPendingCommunityOwnershipTransfer(token, communityName);
          setOwnershipTransfer(pending);
        } else if (panel === 'ownershipTransfer') {
          const pending = await api.getPendingCommunityOwnershipTransfer(token, communityName);
          setOwnershipTransfer(pending);
        } else if (panel === 'members') {
          const rows = await api.getCommunityMembers(token, communityName, 20);
          setMembers(rows);
        } else if (panel === 'moderators') {
          const rows = await api.getCommunityModerators(token, communityName, 20);
          setMods(rows);
        } else if (panel === 'joinRequests') {
          const rows = await api.getCommunityJoinRequests(token, communityName);
          setJoinRequests(Array.isArray(rows) ? rows : []);
        } else if (panel === 'banned') {
          const rows = await api.getCommunityBannedUsers(token, communityName, 20);
          setBanned(rows);
        } else if (panel === 'reports') {
          const rows = await api.getCommunityModerationReports(token, communityName, 20);
          setReports(Array.isArray(rows) ? rows : []);
        } else if (panel === 'closed') {
          const rows = await api.getClosedCommunityPosts(token, communityName, 20);
          setClosedPosts(Array.isArray(rows) ? rows : []);
        }
      } catch (e: any) {
        onError(e?.message || t('home.feedLoadError'));
      }
    }

    void loadPanel();
  }, [panel, visible, communityName, token, canManage, onError, t]);

  async function runAction(action: () => Promise<unknown>, successMessage: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onNotice(successMessage);
    } catch (e: any) {
      onError(e?.message || t('home.feedLoadError'));
    } finally {
      setBusy(false);
      setUsernameInput('');
    }
  }

  const title = useMemo(() => {
    switch (panel) {
      case 'main': return t('community.manageTitle', { defaultValue: 'Manage community' });
      case 'details': return t('community.manageDetails', { defaultValue: 'Details' });
      case 'members': return t('community.manageMembers', { defaultValue: 'Members' });
      case 'administrators': return t('community.manageAdministrators', { defaultValue: 'Administrators' });
      case 'ownershipTransfer': return t('community.manageOwnershipTransfer', { defaultValue: 'Transfer community ownership' });
      case 'moderators': return t('community.manageModerators', { defaultValue: 'Moderators' });
      case 'joinRequests': return t('community.manageJoinRequests', { defaultValue: 'Join requests' });
      case 'banned': return t('community.manageBannedUsers', { defaultValue: 'Banned users' });
      case 'reports': return t('community.manageReports', { defaultValue: 'Moderation reports' });
      case 'closed': return t('community.manageClosedPosts', { defaultValue: 'Closed posts' });
      case 'invite': return t('community.manageInvitePeople', { defaultValue: 'Invite people' });
      case 'unfavorite': return t('community.manageUnfavorite', { defaultValue: 'Unfavorite community' });
      case 'delete': return t('community.manageDelete', { defaultValue: 'Delete community' });
      default: return '';
    }
  }, [panel, t]);

  function renderHeader(showBack = panel !== 'main') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {showBack ? (
            <TouchableOpacity onPress={() => setPanel('main')}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={c.textSecondary} />
            </TouchableOpacity>
          ) : null}
          <Text style={{ fontSize: 18, fontWeight: '800', color: c.textPrimary }}>{title}</Text>
        </View>
      </View>
    );
  }

  function renderMenuItem(
    icon: string,
    label: string,
    sublabel: string,
    nextPanel: Panel,
    danger = false,
    badgeLabel?: string,
  ) {
    return (
      <TouchableOpacity
        key={label}
        onPress={() => setPanel(nextPanel)}
        style={{ flexDirection: 'row', gap: 14, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border }}
      >
        <MaterialCommunityIcons name={icon as any} size={22} color={danger ? c.errorText : c.textSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: danger ? c.errorText : c.textPrimary }}>{label}</Text>
          <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 2 }}>{sublabel}</Text>
        </View>
        {badgeLabel ? (
          <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: c.inputBackground, borderWidth: 1, borderColor: c.border }}>
            <Text style={{ color: c.primary, fontWeight: '800', fontSize: 11 }}>{badgeLabel}</Text>
          </View>
        ) : null}
        <MaterialCommunityIcons name="chevron-right" size={20} color={c.textMuted} />
      </TouchableOpacity>
    );
  }

  function renderUserRow(
    user: CommunityMember,
    onRemove?: () => void,
    removeLabel?: string,
    onSecondaryAction?: () => void,
    secondaryLabel?: string
  ) {
    const avatar = avatarFromUser(user);
    const displayName = nameFromUser(user);
    const handle = user.username ? `@${user.username}` : '@user';
    return (
      <View key={`u-${user.id || user.username}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.border }} />
        ) : (
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>{displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.textPrimary, fontSize: 14, fontWeight: '700' }}>{displayName}</Text>
          <Text style={{ color: c.textMuted, fontSize: 12 }}>{handle}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {onSecondaryAction ? (
            <TouchableOpacity onPress={onSecondaryAction} disabled={busy} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground }}>
              <Text style={{ color: c.errorText, fontWeight: '700', fontSize: 12 }}>{secondaryLabel || t('community.banAction', { defaultValue: 'Ban' })}</Text>
            </TouchableOpacity>
          ) : null}
          {onRemove ? (
            <TouchableOpacity onPress={onRemove} disabled={busy} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground }}>
              <Text style={{ color: c.errorText, fontWeight: '700', fontSize: 12 }}>{removeLabel || t('home.removeAction', { defaultValue: 'Remove' })}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  function renderUsernameAction(
    actionLabel: string,
    action: (username: string) => Promise<unknown>,
    successMessage?: string,
  ) {
    const canSubmit = !!usernameInput.trim() && !busy;
    return (
      <View style={{ padding: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <TextInput
          value={usernameInput}
          onChangeText={setUsernameInput}
          placeholder={t('community.manageUsernamePlaceholder', { defaultValue: 'Enter username' })}
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          style={{ borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.inputBackground, color: c.textPrimary }}
        />
        <TouchableOpacity
          disabled={!canSubmit}
          onPress={() => void runAction(
            () => action(usernameInput.trim().replace(/^@+/, '')),
            successMessage || t('community.manageActionSuccess', { defaultValue: 'Action completed.' }),
          )}
          style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: canSubmit ? c.primary : c.inputBackground }}
        >
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: canSubmit ? '#fff' : c.textMuted, fontWeight: '700' }}>{actionLabel}</Text>}
        </TouchableOpacity>
        {userSuggestionsLoading ? (
          <View style={{ paddingVertical: 6 }}>
            <ActivityIndicator color={c.primary} size="small" />
          </View>
        ) : null}
        {userSuggestions.length > 0 ? (
          <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10, overflow: 'hidden', backgroundColor: c.surface }}>
            {userSuggestions.slice(0, 8).map((candidate) => {
              const username = (candidate.username || '').trim();
              if (!username) return null;
              const candidateName = (candidate.profile?.name || '').trim();
              const avatar = candidate.profile?.avatar || undefined;
              const initial = (candidateName || username || '?')[0].toUpperCase();
              return (
                <TouchableOpacity
                  key={`candidate-${candidate.id}-${username}`}
                  activeOpacity={0.82}
                  onPress={() => {
                    setUsernameInput(username);
                    setUserSuggestions([]);
                    setUserSuggestionsLoading(false);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border }}
                >
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.border }} />
                  ) : (
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{initial}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: c.textPrimary, fontSize: 13, fontWeight: '700' }}>
                      {candidateName || `@${username}`}
                    </Text>
                    <Text numberOfLines={1} style={{ color: c.textMuted, fontSize: 12 }}>
                      @{username}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  }

  function renderMain() {
    if (!canManage) {
      return (
        <View style={{ padding: 20 }}>
          <Text style={{ color: c.textMuted, fontSize: 14 }}>
            {t('community.manageNoPermission', { defaultValue: 'You do not have permission to manage this community.' })}
          </Text>
        </View>
      );
    }

    const pendingOwnershipTarget = ownershipTransfer?.proposed_owner?.username
      ? `@${ownershipTransfer.proposed_owner.username}`
      : null;

    return (
      <>
        {renderMenuItem('account-edit-outline', t('community.manageDetails', { defaultValue: 'Details' }), t('community.manageDetailsSub', { defaultValue: 'Change title, name, avatar, cover and more.' }), 'details')}
        {renderMenuItem('account-group-outline', t('community.manageMembers', { defaultValue: 'Members' }), t('community.manageMembersSub', { defaultValue: 'View, remove, and optionally ban members.' }), 'members')}
        {renderMenuItem('star-outline', t('community.manageAdministrators', { defaultValue: 'Administrators' }), t('community.manageAdministratorsSub', { defaultValue: 'See, add and remove administrators.' }), 'administrators')}
        {community?.is_creator ? renderMenuItem(
          'swap-horizontal-bold',
          t('community.manageOwnershipTransfer', { defaultValue: 'Transfer community ownership' }),
          ownershipTransfer
            ? t('community.manageOwnershipTransferPendingSub', {
                defaultValue: 'Pending acceptance from {{username}}.',
                username: pendingOwnershipTarget || t('home.postAuthorFallback', { defaultValue: 'user' }),
              })
            : t('community.manageOwnershipTransferSub', { defaultValue: 'Propose a new owner and wait for their acceptance.' }),
          'ownershipTransfer',
          false,
          ownershipTransfer ? t('community.transferOwnershipPendingBadge', { defaultValue: 'Pending' }) : undefined,
        ) : null}
        {renderMenuItem('gavel', t('community.manageModerators', { defaultValue: 'Moderators' }), t('community.manageModeratorsSub', { defaultValue: 'See, add and remove moderators.' }), 'moderators')}
        {community?.type === 'R' ? renderMenuItem(
          'account-clock-outline',
          t('community.manageJoinRequests', { defaultValue: 'Join requests' }),
          t('community.manageJoinRequestsSub', { defaultValue: 'Review and approve pending membership requests.' }),
          'joinRequests',
          false,
          joinRequests.length > 0 ? String(joinRequests.length) : undefined,
        ) : null}
        {renderMenuItem('clipboard-text-search-outline', t('community.manageReports', { defaultValue: 'Moderation reports' }), t('community.manageReportsSub', { defaultValue: 'Review the community moderation reports.' }), 'reports')}
        {renderMenuItem('cancel', t('community.manageBannedUsers', { defaultValue: 'Banned users' }), t('community.manageBannedUsersSub', { defaultValue: 'See, add and remove banned users.' }), 'banned')}
        {renderMenuItem('lock-outline', t('community.manageClosedPosts', { defaultValue: 'Closed posts' }), t('community.manageClosedPostsSub', { defaultValue: 'See and manage closed posts.' }), 'closed')}
        {renderMenuItem('email-fast-outline', t('community.manageInvitePeople', { defaultValue: 'Invite people' }), t('community.manageInvitePeopleSub', { defaultValue: 'Invite your connections and followers.' }), 'invite')}
        {renderMenuItem('star-off-outline', t('community.manageUnfavorite', { defaultValue: 'Unfavorite community' }), t('community.manageUnfavoriteSub', { defaultValue: 'Remove this community from your favorites.' }), 'unfavorite', true)}
        {renderMenuItem('delete-outline', t('community.manageDelete', { defaultValue: 'Delete community' }), t('community.manageDeleteSub', { defaultValue: 'Delete this community forever.' }), 'delete', true)}
      </>
    );
  }

  function renderDetails() {
    const fieldLabel = (label: string, hint?: string) => (
      <View style={{ marginBottom: 2 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {label}
        </Text>
        {hint ? (
          <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 1 }}>{hint}</Text>
        ) : null}
      </View>
    );

    const inputStyle = { borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.textPrimary, backgroundColor: c.inputBackground };
    const multilineStyle = { ...inputStyle, minHeight: 88, textAlignVertical: 'top' as const };

    return (
      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ gap: 4 }}>
          {fieldLabel(
            t('community.titleLabel', { defaultValue: 'Title' }),
            t('community.titleHint', { defaultValue: 'The display name shown at the top of your community page.' }),
          )}
          <TextInput value={detailsTitle} onChangeText={setDetailsTitle} placeholder={t('community.titlePlaceholder', { defaultValue: 'e.g. Photography Enthusiasts' })} placeholderTextColor={c.textMuted} style={inputStyle} />
        </View>

        <View style={{ gap: 4 }}>
          {fieldLabel(
            t('community.nameLabel', { defaultValue: 'Name' }),
            t('community.nameHint', { defaultValue: 'The unique URL-safe identifier for your community (letters, numbers, hyphens). Used in links.' }),
          )}
          <TextInput value={detailsName} onChangeText={setDetailsName} autoCapitalize="none" autoCorrect={false} placeholder={t('community.namePlaceholder', { defaultValue: 'e.g. photography-enthusiasts' })} placeholderTextColor={c.textMuted} style={inputStyle} />
        </View>

        <View style={{ gap: 4 }}>
          {fieldLabel(
            t('community.colorLabel', { defaultValue: 'Accent color' }),
            t('community.colorHint', { defaultValue: 'A hex color used to brand your community header and highlights.' }),
          )}
          <TextInput value={detailsColor} onChangeText={setDetailsColor} autoCapitalize="none" autoCorrect={false} placeholder={t('community.colorPlaceholder', { defaultValue: 'e.g. #22C55E' })} placeholderTextColor={c.textMuted} style={inputStyle} />
        </View>

        <View style={{ gap: 4 }}>
          {fieldLabel(
            t('community.descriptionLabel', { defaultValue: 'Description' }),
            t('community.descriptionHint', { defaultValue: 'A short summary of what your community is about. Shown on the community profile.' }),
          )}
          <TextInput value={detailsDescription} onChangeText={setDetailsDescription} multiline numberOfLines={3} placeholder={t('community.descriptionPlaceholder', { defaultValue: 'Tell people what this community is about…' })} placeholderTextColor={c.textMuted} style={multilineStyle} />
        </View>

        <View style={{ gap: 4 }}>
          {fieldLabel(
            t('community.rulesLabel', { defaultValue: 'Rules' }),
            t('community.rulesHint', { defaultValue: 'Community guidelines members are expected to follow. Displayed on the community page.' }),
          )}
          <TextInput value={detailsRules} onChangeText={setDetailsRules} multiline numberOfLines={3} placeholder={t('community.rulesPlaceholder', { defaultValue: 'e.g. Be respectful. No spam. Stay on topic.' })} placeholderTextColor={c.textMuted} style={multilineStyle} />
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={() => void runAction(async () => {
              if (!communityName) return;
              const updated = await api.updateCommunity(token, communityName, {
                title: detailsTitle,
                name: detailsName,
                description: detailsDescription,
                rules: detailsRules,
                color: detailsColor,
              });
              onUpdated(updated);
            }, t('community.detailsUpdated', { defaultValue: 'Community details updated.' }))}
            disabled={busy}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: c.primary }}
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{t('community.saveAction', { defaultValue: 'Save details' })}</Text>}
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={async () => {
              const file = await pickImageFile('image/*');
              if (!file || !communityName) return;
              await runAction(async () => {
                await api.updateCommunityAvatar(token, communityName, file);
                await fetchLatestCommunitySnapshot(communityName);
              }, t('community.avatarUpdated', { defaultValue: 'Avatar updated.' }));
            }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground }}
          >
            <Text style={{ color: c.textPrimary, fontWeight: '700' }}>{t('community.updateAvatar', { defaultValue: 'Update avatar' })}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              const file = await pickImageFile('image/*');
              if (!file || !communityName) return;
              await runAction(async () => {
                await api.updateCommunityCover(token, communityName, file);
                await fetchLatestCommunitySnapshot(communityName);
              }, t('community.coverUpdated', { defaultValue: 'Cover updated.' }));
            }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground }}
          >
            <Text style={{ color: c.textPrimary, fontWeight: '700' }}>{t('community.updateCover', { defaultValue: 'Update cover' })}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function submitAddAdmin(rawUsername: string) {
    const username = rawUsername.trim().replace(/^@+/, '');
    if (!username || busy) return;
    setTransferConfirm({
      title: t('community.addAdministratorConfirmTitle', { defaultValue: 'Add administrator?' }),
      message: t('community.addAdministratorConfirmPrompt', {
        defaultValue: `Add @${username} as an administrator of c/${communityName}? They will receive an invitation to accept.`,
        username,
        communityName,
      }),
      confirmLabel: t('community.addAdministratorConfirmAction', { defaultValue: 'Send invitation' }),
      onConfirm: () => {
        setTransferConfirm(null);
        void runAction(async () => {
          await api.addCommunityAdministrator(token, communityName, username);
          const rows = await api.getCommunityAdministrators(token, communityName, 20);
          setAdmins(rows);
        }, t('community.administratorInviteSent', { defaultValue: 'Administrator invitation sent.' }));
      },
    });
  }

  function submitAddMod(rawUsername: string) {
    const username = rawUsername.trim().replace(/^@+/, '');
    if (!username || busy) return;
    setTransferConfirm({
      title: t('community.addModeratorConfirmTitle', { defaultValue: 'Add moderator?' }),
      message: t('community.addModeratorConfirmPrompt', {
        defaultValue: `Add @${username} as a moderator of c/${communityName}?`,
        username,
        communityName,
      }),
      confirmLabel: t('community.addModeratorConfirmAction', { defaultValue: 'Add moderator' }),
      onConfirm: () => {
        setTransferConfirm(null);
        void runAction(async () => {
          await api.addCommunityModerator(token, communityName, username);
          const rows = await api.getCommunityModerators(token, communityName, 20);
          setMods(rows);
        }, t('community.moderatorAdded', { defaultValue: 'Moderator added.' }));
      },
    });
  }

  function renderAdminModSearchInput(
    placeholder: string,
    onSubmit: (username: string) => void,
    suggestionKeyPrefix: string,
  ) {
    const canSubmit = !!usernameInput.trim() && !busy;
    return (
      <View style={{ padding: 16, gap: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <TextInput
          value={usernameInput}
          onChangeText={setUsernameInput}
          placeholder={placeholder}
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          style={{ borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.inputBackground, color: c.textPrimary }}
        />
        <TouchableOpacity
          disabled={!canSubmit}
          onPress={() => onSubmit(usernameInput)}
          style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: canSubmit ? c.primary : c.inputBackground }}
        >
          {busy
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={{ color: canSubmit ? '#fff' : c.textMuted, fontWeight: '700' }}>{placeholder}</Text>}
        </TouchableOpacity>
        {userSuggestionsLoading ? (
          <View style={{ paddingVertical: 6 }}>
            <ActivityIndicator color={c.primary} size="small" />
          </View>
        ) : null}
        {userSuggestions.length > 0 ? (
          <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10, overflow: 'hidden', backgroundColor: c.surface }}>
            {userSuggestions.slice(0, 8).map((candidate) => {
              const username = (candidate.username || '').trim();
              if (!username) return null;
              const candidateName = (candidate.profile?.name || '').trim();
              const avatar = candidate.profile?.avatar || undefined;
              const initial = (candidateName || username || '?')[0].toUpperCase();
              return (
                <TouchableOpacity
                  key={`${suggestionKeyPrefix}-${candidate.id}-${username}`}
                  activeOpacity={0.82}
                  onPress={() => {
                    setUsernameInput(username);
                    setUserSuggestions([]);
                    setUserSuggestionsLoading(false);
                    onSubmit(username);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border }}
                >
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.border }} />
                  ) : (
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{initial}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: c.textPrimary, fontSize: 13, fontWeight: '700' }}>
                      {candidateName || `@${username}`}
                    </Text>
                    <Text numberOfLines={1} style={{ color: c.textMuted, fontSize: 12 }}>
                      @{username}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  }

  function renderAdministrators() {
    return (
      <>
        {renderAdminModSearchInput(
          t('community.addAdministrator', { defaultValue: 'Add administrator' }),
          submitAddAdmin,
          'admin-candidate',
        )}
        {admins.map((row) => renderUserRow(row, () => {
          void runAction(async () => {
            if (!row.username) return;
            await api.removeCommunityAdministrator(token, communityName, row.username);
            const rows = await api.getCommunityAdministrators(token, communityName, 20);
            setAdmins(rows);
          }, t('community.administratorRemoved', { defaultValue: 'Administrator removed.' }));
        }, t('community.removeAdmin', { defaultValue: 'Remove' })))}
      </>
    );
  }

  function renderModerators() {
    return (
      <>
        {renderAdminModSearchInput(
          t('community.addModerator', { defaultValue: 'Add moderator' }),
          submitAddMod,
          'mod-candidate',
        )}
        {mods.map((row) => renderUserRow(row, () => {
          void runAction(async () => {
            if (!row.username) return;
            await api.removeCommunityModerator(token, communityName, row.username);
            const rows = await api.getCommunityModerators(token, communityName, 20);
            setMods(rows);
          }, t('community.moderatorRemoved', { defaultValue: 'Moderator removed.' }));
        }, t('community.removeModerator', { defaultValue: 'Remove' })))}
      </>
    );
  }

  function renderJoinRequests() {
    if (joinRequests.length === 0) {
      return (
        <Text style={{ color: c.textMuted, padding: 16 }}>
          {t('community.noJoinRequests', { defaultValue: 'No pending join requests.' })}
        </Text>
      );
    }
    return joinRequests.map((req) => {
      const avatar = req.requester?.profile?.avatar || undefined;
      const displayName = (req.requester?.profile?.name || '').trim() || req.requester?.username || 'User';
      const handle = req.requester?.username ? `@${req.requester.username}` : '@user';
      const initial = displayName[0]?.toUpperCase() ?? '?';
      return (
        <View
          key={`jr-${req.id}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border }}
        >
          {avatar ? (
            <Image source={{ uri: avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.border }} />
          ) : (
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{initial}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.textPrimary, fontSize: 14, fontWeight: '700' }}>{displayName}</Text>
            <Text style={{ color: c.textMuted, fontSize: 12 }}>{handle}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity
              disabled={busy}
              onPress={() => void runAction(async () => {
                await api.approveCommunityJoinRequest(token, communityName, req.id);
                const rows = await api.getCommunityJoinRequests(token, communityName);
                setJoinRequests(Array.isArray(rows) ? rows : []);
              }, t('community.joinRequestApproved', { defaultValue: 'Join request approved.' }))}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: c.primary }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                {t('community.approveAction', { defaultValue: 'Approve' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={busy}
              onPress={() => void runAction(async () => {
                await api.rejectCommunityJoinRequest(token, communityName, req.id);
                const rows = await api.getCommunityJoinRequests(token, communityName);
                setJoinRequests(Array.isArray(rows) ? rows : []);
              }, t('community.joinRequestRejected', { defaultValue: 'Join request rejected.' }))}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground }}
            >
              <Text style={{ color: c.errorText, fontWeight: '700', fontSize: 12 }}>
                {t('community.rejectAction', { defaultValue: 'Reject' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    });
  }

  function renderOwnershipTransfer() {
    const pendingTransfer = ownershipTransfer;
    const pendingTargetHandle = pendingTransfer?.proposed_owner?.username ? `@${pendingTransfer.proposed_owner.username}` : null;
    const requestedAt = formatRelativeOrDate(pendingTransfer?.created);
    const canSubmit = !!usernameInput.trim() && !busy && !pendingTransfer;
    const submitOwnershipTransfer = (rawUsername: string) => {
      const username = rawUsername.trim().replace(/^@+/, '');
      if (!username || pendingTransfer || busy) return;
      setTransferConfirm({
        title: t('community.transferOwnershipConfirmTitle', { defaultValue: 'Transfer ownership?' }),
        message: t('community.transferOwnershipConfirmPrompt', {
          defaultValue: `Transfer ownership of c/${communityName} to @${username}? Ownership will not change until they accept.`,
          username,
          communityName,
        }),
        confirmLabel: t('community.transferOwnershipConfirmAction', { defaultValue: 'Send request' }),
        onConfirm: () => {
          setTransferConfirm(null);
          void runAction(async () => {
            const transfer = await api.initiateCommunityOwnershipTransfer(token, communityName, username);
            setOwnershipTransfer(transfer);
          }, t('community.transferOwnershipRequested', { defaultValue: 'Ownership transfer request sent.' }));
        },
      });
    };

    return (
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={{ color: c.textSecondary, fontSize: 13 }}>
          {t('community.transferOwnershipDescription', {
            defaultValue: 'Ownership remains unchanged until the selected member accepts.',
          })}
        </Text>

        {pendingTransfer ? (
          <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, backgroundColor: c.inputBackground, gap: 6 }}>
            <Text style={{ color: c.textPrimary, fontWeight: '700', fontSize: 14 }}>
              {t('community.transferOwnershipPendingLabel', {
                defaultValue: 'Pending transfer',
              })}
            </Text>
            {pendingTransfer?.status ? (
              <Text style={{ color: c.textMuted, fontSize: 12 }}>
                {t('community.transferOwnershipStatusValue', {
                  defaultValue: 'Status: Pending',
                })}
              </Text>
            ) : null}
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>
              {t('community.transferOwnershipPendingValue', {
                defaultValue: 'Waiting for {{username}} to accept ownership.',
                username: pendingTargetHandle || t('home.postAuthorFallback', { defaultValue: 'user' }),
              })}
            </Text>
            {requestedAt ? (
              <Text style={{ color: c.textMuted, fontSize: 12 }}>
                {t('community.transferOwnershipRequestedAt', {
                  defaultValue: 'Requested at: {{value}}',
                  value: requestedAt,
                })}
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={() => {
                setTransferConfirm({
                  title: t('community.transferOwnershipCancelConfirmTitle', { defaultValue: 'Revoke transfer?' }),
                  message: t('community.transferOwnershipCancelConfirmPrompt', {
                    defaultValue: 'Revoke pending ownership transfer to {{username}}?',
                    username: pendingTargetHandle || t('home.postAuthorFallback', { defaultValue: 'user' }),
                  }),
                  confirmLabel: t('community.transferOwnershipCancelAction', { defaultValue: 'Cancel pending transfer' }),
                  danger: true,
                  onConfirm: () => {
                    setTransferConfirm(null);
                    void runAction(async () => {
                      await api.cancelCommunityOwnershipTransfer(token, communityName, pendingTransfer.id);
                      setOwnershipTransfer(null);
                    }, t('community.transferOwnershipCancelled', { defaultValue: 'Ownership transfer cancelled.' }));
                  },
                });
              }}
              disabled={busy}
              style={{ alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}
            >
              {busy ? (
                <ActivityIndicator size="small" color={c.textSecondary} />
              ) : (
                <Text style={{ color: c.errorText, fontWeight: '700', fontSize: 12 }}>
                  {t('community.transferOwnershipCancelAction', { defaultValue: 'Cancel pending transfer' })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        <TextInput
          value={usernameInput}
          onChangeText={setUsernameInput}
          placeholder={t('community.transferOwnershipUsernamePlaceholder', { defaultValue: 'Enter member username' })}
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          editable={!pendingTransfer && !busy}
          style={{ borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.inputBackground, color: c.textPrimary }}
        />
        <TouchableOpacity
          disabled={!canSubmit}
          onPress={() => submitOwnershipTransfer(usernameInput)}
          style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: canSubmit ? c.primary : c.inputBackground }}
        >
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ color: canSubmit ? '#fff' : c.textMuted, fontWeight: '700' }}>
              {pendingTransfer
                ? t('community.transferOwnershipPendingAction', { defaultValue: 'Transfer pending' })
                : t('community.transferOwnershipSendAction', { defaultValue: 'Send transfer request' })}
            </Text>
          )}
        </TouchableOpacity>
        {userSuggestionsLoading ? (
          <View style={{ paddingVertical: 6 }}>
            <ActivityIndicator color={c.primary} size="small" />
          </View>
        ) : null}
        {userSuggestions.length > 0 && !pendingTransfer ? (
          <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10, overflow: 'hidden', backgroundColor: c.surface }}>
            {userSuggestions.slice(0, 8).map((candidate) => {
              const username = (candidate.username || '').trim();
              if (!username) return null;
              const candidateName = (candidate.profile?.name || '').trim();
              const avatar = candidate.profile?.avatar || undefined;
              const initial = (candidateName || username || '?')[0].toUpperCase();
              return (
                <TouchableOpacity
                  key={`ownership-candidate-${candidate.id}-${username}`}
                  activeOpacity={0.82}
                  onPress={() => {
                    setUsernameInput(username);
                    setUserSuggestions([]);
                    setUserSuggestionsLoading(false);
                    submitOwnershipTransfer(username);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border }}
                >
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.border }} />
                  ) : (
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{initial}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: c.textPrimary, fontSize: 13, fontWeight: '700' }}>
                      {candidateName || `@${username}`}
                    </Text>
                    <Text numberOfLines={1} style={{ color: c.textMuted, fontSize: 12 }}>
                      @{username}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  }

  async function refreshMembersAndBanned() {
    const [memberRows, bannedRows] = await Promise.all([
      api.getCommunityMembers(token, communityName, 20),
      api.getCommunityBannedUsers(token, communityName, 20),
    ]);
    setMembers(memberRows);
    setBanned(bannedRows);
  }

  async function runRemoveMemberAction(username: string, ban: boolean) {
    if (busy || !communityName || !username) return;
    setBusy(true);
    try {
      const result = await api.removeCommunityMember(token, communityName, username, { ban });
      await refreshMembersAndBanned();
      const removedPostsCount = typeof result?.removed_posts_count === 'number' ? result.removed_posts_count : 0;
      onNotice(
        ban
          ? t('community.memberRemovedAndBanned', {
              defaultValue: `Removed and banned @${username}. ${removedPostsCount} community posts removed.`,
              username,
              count: removedPostsCount,
            })
          : t('community.memberRemoved', {
              defaultValue: `Removed @${username}. ${removedPostsCount} community posts removed.`,
              username,
              count: removedPostsCount,
            })
      );
    } catch (e: any) {
      onError(e?.message || t('home.feedLoadError'));
    } finally {
      setBusy(false);
      setUsernameInput('');
      setRemoveAlsoBan(false);
    }
  }

  function renderMembers() {
    const query = usernameInput.trim().toLowerCase();
    const filteredMembers = query
      ? members.filter((row) => {
          const username = (row.username || '').toLowerCase();
          const name = (row.profile?.name || '').toLowerCase();
          return username.includes(query) || name.includes(query);
        })
      : members;

    return (
      <>
        {/* Filter input */}
        <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10, backgroundColor: c.inputBackground, paddingHorizontal: 10, gap: 8 }}>
            <MaterialCommunityIcons name="magnify" size={18} color={c.textMuted} />
            <TextInput
              value={usernameInput}
              onChangeText={setUsernameInput}
              placeholder={t('community.memberSearchPlaceholder', { defaultValue: 'Search members…' })}
              placeholderTextColor={c.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, paddingVertical: 10, color: c.textPrimary }}
            />
            {usernameInput.length > 0 ? (
              <TouchableOpacity onPress={() => setUsernameInput('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="close-circle" size={16} color={c.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Member list */}
        {members.length === 0 ? (
          <Text style={{ color: c.textMuted, padding: 16 }}>
            {t('community.noManageableMembers', { defaultValue: 'No removable members found.' })}
          </Text>
        ) : filteredMembers.length === 0 ? (
          <Text style={{ color: c.textMuted, padding: 16 }}>
            {t('community.memberSearchNoResults', { defaultValue: 'No members match your search.' })}
          </Text>
        ) : null}
        {filteredMembers.map((row) => renderUserRow(
          row,
          () => {
            if (!row.username) return;
            void runRemoveMemberAction(row.username, false);
          },
          t('community.removeAction', { defaultValue: 'Remove' }),
          () => {
            if (!row.username) return;
            void runRemoveMemberAction(row.username, true);
          },
          t('community.removeAndBanAction', { defaultValue: 'Remove + ban' }),
        ))}
      </>
    );
  }

  function renderBanned() {
    return (
      <>
        {renderUsernameAction(t('community.banUser', { defaultValue: 'Ban user' }), (username) => api.banCommunityUser(token, communityName, username).then(async () => {
          const rows = await api.getCommunityBannedUsers(token, communityName, 20);
          setBanned(rows);
        }))}
        {banned.map((row) => renderUserRow(row, () => {
          void runAction(async () => {
            if (!row.username) return;
            await api.unbanCommunityUser(token, communityName, row.username);
            const rows = await api.getCommunityBannedUsers(token, communityName, 20);
            setBanned(rows);
          }, t('community.userUnbanned', { defaultValue: 'User unbanned.' }));
        }, t('community.unbanAction', { defaultValue: 'Unban' })))}
      </>
    );
  }

  function renderReports() {
    if (reports.length === 0) {
      return <Text style={{ color: c.textMuted, padding: 16 }}>{t('community.noReports', { defaultValue: 'No moderation reports found.' })}</Text>;
    }
    return reports.map((item) => (
      <View key={`report-${item.id}`} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <Text style={{ color: c.textPrimary, fontWeight: '700', fontSize: 14 }}>
          {`#${item.id} • ${item.object_type || 'OBJ'} • ${item.status || 'unknown'}`}
        </Text>
        <Text style={{ color: c.textSecondary, fontSize: 13, marginTop: 4 }}>
          {(item.category?.title || item.category?.name || 'Category') + ` • ${item.reports_count || 0} reports`}
        </Text>
        {item.description ? (
          <Text style={{ color: c.textMuted, fontSize: 12, marginTop: 4 }} numberOfLines={2}>{item.description}</Text>
        ) : null}
      </View>
    ));
  }

  function renderClosedPosts() {
    if (closedPosts.length === 0) {
      return <Text style={{ color: c.textMuted, padding: 16 }}>{t('community.noClosedPosts', { defaultValue: 'No closed posts.' })}</Text>;
    }
    return closedPosts.map((post) => (
      <View key={`closed-${post.id}`} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border, gap: 6 }}>
        <Text style={{ color: c.textPrimary, fontWeight: '700' }}>{post.creator?.username ? `@${post.creator.username}` : t('home.postAuthorFallback', { defaultValue: 'Unknown' })}</Text>
        <Text style={{ color: c.textSecondary }} numberOfLines={2}>{post.text || post.long_text || t('community.closedPostNoText', { defaultValue: '(No text)' })}</Text>
        <TouchableOpacity
          onPress={() => void runAction(async () => {
            if (!post.uuid) return;
            await api.openPost(token, post.uuid);
            const rows = await api.getClosedCommunityPosts(token, communityName, 20);
            setClosedPosts(rows);
          }, t('community.postOpened', { defaultValue: 'Post opened.' }))}
          style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: c.primary }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{t('community.openPost', { defaultValue: 'Open post' })}</Text>
        </TouchableOpacity>
      </View>
    ));
  }

  function renderInvite() {
    return renderUsernameAction(t('community.inviteUser', { defaultValue: 'Send invite' }), (username) =>
      api.inviteCommunityMember(token, communityName, username)
    );
  }

  function renderUnfavorite() {
    return (
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={{ color: c.textSecondary, fontSize: 14 }}>
          {t('community.unfavoriteConfirmText', { defaultValue: 'Remove this community from your favorites?' })}
        </Text>
        <TouchableOpacity
          onPress={() => void runAction(async () => {
            await api.unfavoriteCommunity(token, communityName);
            onClose();
          }, t('community.unfavorited', { defaultValue: 'Community unfavorited.' }))}
          style={{ alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: c.errorText }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>{t('community.unfavoriteAction', { defaultValue: 'Unfavorite' })}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderDelete() {
    return (
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={{ color: c.textSecondary, fontSize: 14 }}>
          {t('community.deleteConfirmText', { defaultValue: 'This deletes the community forever. This cannot be undone.' })}
        </Text>
        <TouchableOpacity
          onPress={() => void runAction(async () => {
            await api.deleteCommunity(token, communityName);
            onDeleted();
          }, t('community.deleted', { defaultValue: 'Community deleted.' }))}
          style={{ alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: c.errorText }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>{t('community.deleteAction', { defaultValue: 'Delete community' })}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', opacity: backdropOpacity }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

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
          shadowOpacity: 0.2,
          shadowRadius: 18,
          elevation: 20,
        }}
      >
        {renderHeader()}
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {panel === 'main' ? renderMain() : null}
          {panel === 'details' ? renderDetails() : null}
          {panel === 'members' ? renderMembers() : null}
          {panel === 'administrators' ? renderAdministrators() : null}
          {panel === 'ownershipTransfer' ? renderOwnershipTransfer() : null}
          {panel === 'moderators' ? renderModerators() : null}
          {panel === 'joinRequests' ? renderJoinRequests() : null}
          {panel === 'banned' ? renderBanned() : null}
          {panel === 'reports' ? renderReports() : null}
          {panel === 'closed' ? renderClosedPosts() : null}
          {panel === 'invite' ? renderInvite() : null}
          {panel === 'unfavorite' ? renderUnfavorite() : null}
          {panel === 'delete' ? renderDelete() : null}
        </ScrollView>
      </Animated.View>
      {transferConfirm ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, zIndex: 50 }}>
          <Pressable
            onPress={() => setTransferConfirm(null)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
          />
          <View style={{ width: '100%', maxWidth: 520, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, padding: 18, gap: 12 }}>
            <Text style={{ color: c.textPrimary, fontWeight: '800', fontSize: 20 }}>{transferConfirm.title}</Text>
            <Text style={{ color: c.textSecondary, fontSize: 16, lineHeight: 24 }}>{transferConfirm.message}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <TouchableOpacity
                onPress={() => setTransferConfirm(null)}
                style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground }}
              >
                <Text style={{ color: c.textPrimary, fontWeight: '700' }}>{t('home.cancel', { defaultValue: 'Cancel' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={transferConfirm.onConfirm}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 999,
                  backgroundColor: transferConfirm.danger ? (c.errorText || '#dc2626') : c.primary,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>{transferConfirm.confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
