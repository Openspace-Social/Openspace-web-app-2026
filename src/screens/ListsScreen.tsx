import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  api,
  EmojiGroup,
  FollowingUserResult,
  ListDetailResult,
  ListResult,
  SearchUserResult,
} from '../api/client';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  onNotice: (msg: string) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// On native the detail modal becomes a bottom-sheet drawer; the entire
// content scrolls as one. On web we keep the inner-fixed-height ScrollViews.
function ListBox({ webMaxHeight, children }: { webMaxHeight: number; children: React.ReactNode }) {
  if (Platform.OS === 'web') {
    return (
      <ScrollView style={{ maxHeight: webMaxHeight }} contentContainerStyle={{ gap: 2 }}>
        {children}
      </ScrollView>
    );
  }
  return <View style={{ gap: 2 }}>{children}</View>;
}

function DetailScroller({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'web') return <>{children}</>;
  return (
    <ScrollView
      style={{ flex: 1, marginHorizontal: -20, marginBottom: -20 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

function UserAvatar({
  uri,
  initial,
  size = 32,
  bg,
}: {
  uri?: string;
  initial: string;
  size?: number;
  bg: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        marginRight: 10,
        flexShrink: 0,
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.4 }}>
          {initial.toUpperCase()}
        </Text>
      )}
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ListsScreen({ token, c, t, onNotice }: Props) {
  const s = useStyles(c);

  // ── Lists ─────────────────────────────────────────────────────────────────
  const [lists, setLists] = useState<ListResult[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [listsError, setListsError] = useState('');

  // ── Emoji groups (loaded once) ────────────────────────────────────────────
  const [emojiGroups, setEmojiGroups] = useState<EmojiGroup[]>([]);
  const [emojiGroupsLoading, setEmojiGroupsLoading] = useState(false);

  // ── Member picker — followings pre-loaded, search hits the platform ───────
  const [memberSearch, setMemberSearch] = useState('');
  const [followings, setFollowings] = useState<FollowingUserResult[]>([]);
  const [followingsLoading, setFollowingsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchUserResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchSeqRef = useRef(0);

  // ── Create modal ──────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createEmojiId, setCreateEmojiId] = useState<number | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // ── Detail modal ──────────────────────────────────────────────────────────
  const [detailList, setDetailList] = useState<ListDetailResult | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  // edit
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmojiId, setEditEmojiId] = useState<number | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // adding / removing members
  const [addingUsername, setAddingUsername] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);

  // ── Delete ────────────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<ListResult | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Load lists ────────────────────────────────────────────────────────────
  const loadLists = useCallback(async () => {
    setListsLoading(true);
    setListsError('');
    try {
      const data = await api.getLists(token);
      setLists(data);
    } catch (err: any) {
      setListsError(err?.message || t('lists.loadError', { defaultValue: 'Failed to load lists.' }));
    } finally {
      setListsLoading(false);
    }
  }, [token, t]);

  useEffect(() => { void loadLists(); }, [loadLists]);

  // ── Load emoji groups (once) ──────────────────────────────────────────────
  const loadEmojiGroups = useCallback(async () => {
    if (emojiGroups.length > 0) return;
    setEmojiGroupsLoading(true);
    try {
      const data = await api.getEmojiGroups(token);
      setEmojiGroups(data);
    } catch {
      // non-fatal
    } finally {
      setEmojiGroupsLoading(false);
    }
  }, [token, emojiGroups.length]);

  // ── Load followings once when detail opens ────────────────────────────────
  const loadFollowings = useCallback(async () => {
    if (followings.length > 0) return;
    setFollowingsLoading(true);
    try {
      const data = await api.getFollowings(token, 200);
      setFollowings(data);
    } catch {
      // non-fatal
    } finally {
      setFollowingsLoading(false);
    }
  }, [token, followings.length]);

  // ── Debounced platform-wide search when query is typed ────────────────────
  useEffect(() => {
    const q = memberSearch.trim();
    if (!q) { setSearchResults([]); return; }
    const seq = ++searchSeqRef.current;
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await api.searchUsers(token, q, 10);
        if (searchSeqRef.current === seq) setSearchResults(results);
      } catch {
        if (searchSeqRef.current === seq) setSearchResults([]);
      } finally {
        if (searchSeqRef.current === seq) setSearchLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [memberSearch, token]);

  // ── Open detail ───────────────────────────────────────────────────────────
  async function openDetail(list: ListResult) {
    setDetailList(null);
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError('');
    setEditMode(false);
    setEditError('');
    setMemberSearch('');
    setSearchResults([]);
    try {
      const [data] = await Promise.all([
        api.getListDetail(token, list.id),
        loadEmojiGroups(),
        loadFollowings(),
      ]);
      setDetailList(data);
      setEditName(data.name || '');
      setEditEmojiId(data.emoji?.id ?? null);
    } catch (err: any) {
      setDetailError(err?.message || t('lists.detailLoadError', { defaultValue: 'Failed to load list.' }));
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetailOpen(false);
    setDetailList(null);
    setEditMode(false);
    setEditError('');
    setMemberSearch('');
    setSearchResults([]);
  }

  // ── Exclude users already in the list from both sources ──────────────────
  const memberUsernameSet = useMemo(
    () => new Set((detailList?.users || []).map((u) => u.username).filter(Boolean)),
    [detailList]
  );

  // When search is active → show platform results; otherwise show followings
  const isSearching = memberSearch.trim().length > 0;

  const filteredFollowings = useMemo(() => {
    const q = memberSearch.toLowerCase().trim();
    return followings.filter((f) => {
      if (memberUsernameSet.has(f.username)) return false;
      if (!q) return true;
      return (
        (f.username || '').toLowerCase().includes(q) ||
        (f.profile?.name || '').toLowerCase().includes(q)
      );
    });
  }, [followings, memberSearch, memberUsernameSet]);

  const filteredSearchResults = useMemo(
    () => searchResults.filter((u) => !memberUsernameSet.has(u.username)),
    [searchResults, memberUsernameSet]
  );

  // ── Add member ────────────────────────────────────────────────────────────
  async function addMember(username: string) {
    if (!detailList) return;
    setAddingUsername(username);
    try {
      const current = (detailList.users || []).map((u) => u.username).filter((u): u is string => !!u);
      await api.updateList(token, detailList.id, { usernames: [...current, username] });
      const refreshed = await api.getListDetail(token, detailList.id);
      setDetailList(refreshed);
      setLists((prev) => prev.map((l) => l.id === refreshed.id ? { ...l, follows_count: refreshed.follows_count } : l));
    } catch (err: any) {
      onNotice(err?.message || t('lists.addMemberError', { defaultValue: 'Failed to add member.' }));
    } finally {
      setAddingUsername(null);
    }
  }

  // ── Remove member ─────────────────────────────────────────────────────────
  async function removeMember(userId: number) {
    if (!detailList) return;
    setRemovingUserId(userId);
    try {
      const newUsernames = (detailList.users || [])
        .filter((u) => u.id !== userId)
        .map((u) => u.username)
        .filter((u): u is string => !!u);
      await api.updateList(token, detailList.id, { usernames: newUsernames });
      const refreshed = await api.getListDetail(token, detailList.id);
      setDetailList(refreshed);
      setLists((prev) => prev.map((l) => l.id === refreshed.id ? { ...l, follows_count: refreshed.follows_count } : l));
    } catch (err: any) {
      onNotice(err?.message || t('lists.removeMemberError', { defaultValue: 'Failed to remove member.' }));
    } finally {
      setRemovingUserId(null);
    }
  }

  // ── Save edit ─────────────────────────────────────────────────────────────
  async function saveEdit() {
    if (!detailList) return;
    setEditLoading(true);
    setEditError('');
    try {
      const payload: { name?: string; emoji_id?: number } = {};
      if (editName.trim()) payload.name = editName.trim();
      if (editEmojiId !== null) payload.emoji_id = editEmojiId;
      const updated = await api.updateList(token, detailList.id, payload);
      setDetailList((prev) => prev ? { ...prev, name: updated.name, emoji: updated.emoji } : prev);
      setLists((prev) => prev.map((l) => l.id === updated.id ? { ...l, name: updated.name, emoji: updated.emoji } : l));
      setEditMode(false);
    } catch (err: any) {
      setEditError(err?.message || t('lists.saveError', { defaultValue: 'Failed to save changes.' }));
    } finally {
      setEditLoading(false);
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────
  async function openCreate() {
    setCreateName('');
    setCreateEmojiId(null);
    setCreateError('');
    setCreateOpen(true);
    void loadEmojiGroups();
  }

  async function submitCreate() {
    const name = createName.trim();
    if (!name) { setCreateError(t('lists.nameRequired', { defaultValue: 'Please enter a list name.' })); return; }
    if (createEmojiId === null) { setCreateError(t('lists.emojiRequired', { defaultValue: 'Please choose an emoji.' })); return; }
    setCreateLoading(true);
    setCreateError('');
    try {
      const created = await api.createList(token, name, createEmojiId);
      setLists((prev) => [...prev, created]);
      setCreateOpen(false);
    } catch (err: any) {
      setCreateError(err?.message || t('lists.createError', { defaultValue: 'Failed to create list.' }));
    } finally {
      setCreateLoading(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.deleteList(token, deleteTarget.id);
      setLists((prev) => prev.filter((l) => l.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: any) {
      onNotice(err?.message || t('lists.deleteError', { defaultValue: 'Failed to delete list.' }));
    } finally {
      setDeleteLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { backgroundColor: c.surface, borderColor: c.border }]}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[s.header, { borderBottomColor: c.border }]}>
        <Text style={[s.headerTitle, { color: c.textPrimary }]}>
          {t('lists.title', { defaultValue: 'Lists' })}
        </Text>
        <TouchableOpacity
          style={[s.headerAddBtn, { backgroundColor: c.primary }]}
          activeOpacity={0.8}
          onPress={() => void openCreate()}
        >
          <MaterialCommunityIcons name="plus" size={16} color="#fff" />
          <Text style={s.headerAddBtnText}>
            {t('lists.newList', { defaultValue: 'New list' })}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={[s.description, { color: c.textSecondary }]}>
        {t('lists.description', {
          defaultValue:
            'Lists let you organise the people you follow into named groups, making it easy to browse posts from specific circles of people.',
        })}
      </Text>

      {/* ── Lists ──────────────────────────────────────────────────────────── */}
      {listsLoading ? (
        <ActivityIndicator color={c.primary} size="large" style={{ marginTop: 40 }} />
      ) : listsError ? (
        <View style={s.centreBox}>
          <Text style={[s.errorText, { color: c.errorText }]}>{listsError}</Text>
          <TouchableOpacity onPress={() => void loadLists()} style={s.retryBtn}>
            <Text style={{ color: c.primary }}>{t('lists.retry', { defaultValue: 'Retry' })}</Text>
          </TouchableOpacity>
        </View>
      ) : lists.length === 0 ? (
        <View style={s.centreBox}>
          <MaterialCommunityIcons name="format-list-bulleted" size={40} color={c.textMuted} />
          <Text style={[s.emptyText, { color: c.textMuted }]}>
            {t('lists.empty', { defaultValue: "You haven't created any lists yet." })}
          </Text>
          <TouchableOpacity
            style={[s.outlineBtn, { borderColor: c.primary }]}
            activeOpacity={0.8}
            onPress={() => void openCreate()}
          >
            <Text style={{ color: c.primary }}>
              {t('lists.createFirstList', { defaultValue: 'Create your first list' })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={s.list} contentContainerStyle={s.listContent}>
          {lists.map((list) => (
            <TouchableOpacity
              key={list.id}
              style={[s.listRow, { borderColor: c.border }]}
              activeOpacity={0.75}
              onPress={() => void openDetail(list)}
            >
              <View style={[s.listRowEmoji, { backgroundColor: c.inputBackground }]}>
                <Text style={s.listRowEmojiText}>
                  {list.emoji?.image ? undefined : list.emoji?.keyword ? list.emoji.keyword : t('lists.defaultEmoji', { defaultValue: '📋' })}
                </Text>
                {list.emoji?.image ? (
                  <Image source={{ uri: list.emoji.image }} style={s.listRowEmojiImage} resizeMode="contain" />
                ) : null}
              </View>
              <View style={s.listRowCenter}>
                <Text style={[s.listRowName, { color: c.textPrimary }]} numberOfLines={1}>
                  {list.name}
                </Text>
                <Text style={[s.listRowCount, { color: c.textMuted }]}>
                  {list.follows_count}{' '}
                  {list.follows_count === 1
                    ? t('lists.follow', { defaultValue: 'person' })
                    : t('lists.follows', { defaultValue: 'people' })}
                </Text>
              </View>
              <TouchableOpacity
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={(e) => { e.stopPropagation?.(); setDeleteTarget(list); }}
              >
                <MaterialCommunityIcons name="trash-can-outline" size={16} color={c.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ── Create Modal ─────────────────────────────────────────────────────── */}
      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <Pressable style={s.overlay} onPress={() => setCreateOpen(false)}>
          <Pressable style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
            <Text style={[s.cardTitle, { color: c.textPrimary }]}>
              {t('lists.createTitle', { defaultValue: 'Create list' })}
            </Text>

            <Text style={[s.fieldLabel, { color: c.textSecondary }]}>
              {t('lists.fieldName', { defaultValue: 'Name' })}
            </Text>
            <TextInput
              style={[s.textInput, { backgroundColor: c.inputBackground, borderColor: c.inputBorder, color: c.textPrimary }]}
              placeholder={t('lists.namePlaceholder', { defaultValue: 'e.g. Tech friends' })}
              placeholderTextColor={c.placeholder}
              value={createName}
              onChangeText={setCreateName}
              maxLength={100}
              autoFocus
            />

            <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 14 }]}>
              {t('lists.fieldEmoji', { defaultValue: 'Emoji' })}
            </Text>
            {emojiGroupsLoading ? (
              <ActivityIndicator color={c.primary} size="small" style={{ marginVertical: 8 }} />
            ) : (
              <EmojiPicker
                groups={emojiGroups}
                selectedId={createEmojiId}
                onSelect={setCreateEmojiId}
                c={c}
              />
            )}

            {createError ? (
              <Text style={[s.inlineError, { color: c.errorText }]}>{createError}</Text>
            ) : null}

            <View style={s.cardActions}>
              <TouchableOpacity
                style={[s.btn, s.btnOutline, { borderColor: c.border }]}
                onPress={() => setCreateOpen(false)}
              >
                <Text style={{ color: c.textSecondary }}>{t('lists.cancel', { defaultValue: 'Cancel' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, { backgroundColor: c.primary }]}
                onPress={() => void submitCreate()}
                disabled={createLoading}
              >
                {createLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '600' }}>{t('lists.create', { defaultValue: 'Create' })}</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Detail Modal ──────────────────────────────────────────────────────── */}
      <Modal visible={detailOpen} transparent animationType="fade" onRequestClose={closeDetail}>
        <Pressable style={s.overlay} onPress={closeDetail}>
          <Pressable
            style={[s.card, s.detailCard, { backgroundColor: c.surface, borderColor: c.border }]}
            onPress={() => {}}
          >
            {detailLoading ? (
              <ActivityIndicator color={c.primary} size="large" style={{ marginVertical: 40 }} />
            ) : detailError ? (
              <View style={s.centreBox}>
                <Text style={[s.errorText, { color: c.errorText }]}>{detailError}</Text>
              </View>
            ) : detailList ? (
              <>
                {/* Header */}
                <View style={s.detailHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 }}>
                    <View style={[s.detailEmoji, { backgroundColor: c.inputBackground }]}>
                      {detailList.emoji?.image ? (
                        <Image source={{ uri: detailList.emoji.image }} style={{ width: 22, height: 22 }} resizeMode="contain" />
                      ) : (
                        <Text style={{ fontSize: 18 }}>{detailList.emoji?.keyword || t('lists.defaultEmoji', { defaultValue: '📋' })}</Text>
                      )}
                    </View>
                    <Text style={[s.cardTitle, { color: c.textPrimary, marginBottom: 0, flex: 1 }]} numberOfLines={1}>
                      {detailList.name}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <TouchableOpacity
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => { setEditMode((v) => !v); setEditError(''); }}
                    >
                      <MaterialCommunityIcons
                        name={editMode ? 'close' : 'pencil-outline'}
                        size={18}
                        color={c.textSecondary}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={closeDetail}
                    >
                      <MaterialCommunityIcons name="close" size={18} color={c.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>

                <DetailScroller>

                {/* Edit panel */}
                {editMode ? (
                  <View style={[s.editPanel, { borderColor: c.border }]}>
                    <Text style={[s.fieldLabel, { color: c.textSecondary }]}>
                      {t('lists.fieldName', { defaultValue: 'Name' })}
                    </Text>
                    <TextInput
                      style={[s.textInput, { backgroundColor: c.inputBackground, borderColor: c.inputBorder, color: c.textPrimary }]}
                      value={editName}
                      onChangeText={setEditName}
                      maxLength={100}
                    />
                    <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 10 }]}>
                      {t('lists.fieldEmoji', { defaultValue: 'Emoji' })}
                    </Text>
                    {emojiGroupsLoading ? (
                      <ActivityIndicator color={c.primary} size="small" style={{ marginVertical: 6 }} />
                    ) : (
                      <EmojiPicker
                        groups={emojiGroups}
                        selectedId={editEmojiId}
                        onSelect={setEditEmojiId}
                        c={c}
                      />
                    )}
                    {editError ? (
                      <Text style={[s.inlineError, { color: c.errorText }]}>{editError}</Text>
                    ) : null}
                    <View style={s.cardActions}>
                      <TouchableOpacity
                        style={[s.btn, s.btnOutline, { borderColor: c.border }]}
                        onPress={() => { setEditMode(false); setEditError(''); }}
                      >
                        <Text style={{ color: c.textSecondary }}>{t('lists.cancel', { defaultValue: 'Cancel' })}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.btn, { backgroundColor: c.primary }]}
                        onPress={() => void saveEdit()}
                        disabled={editLoading}
                      >
                        {editLoading
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={{ color: '#fff', fontWeight: '600' }}>{t('lists.save', { defaultValue: 'Save' })}</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                {/* Current members */}
                {(detailList.users || []).length > 0 ? (
                  <>
                    <Text style={[s.sectionLabel, { color: c.textMuted }]}>
                      {t('lists.inThisList', { defaultValue: 'IN THIS LIST' })}{' '}
                      ({detailList.follows_count ?? detailList.users?.length ?? 0})
                    </Text>
                    <ListBox webMaxHeight={160}>
                      {(detailList.users || []).map((user) => (
                        <View key={user.id} style={[s.memberRow, { borderColor: c.border }]}>
                          <UserAvatar
                            uri={user.profile?.avatar}
                            initial={user.username?.[0] || '?'}
                            bg={c.primary}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={[s.memberName, { color: c.textPrimary }]}>
                              {user.profile?.name || user.username}
                            </Text>
                            <Text style={[s.memberHandle, { color: c.textMuted }]}>
                              @{user.username}
                            </Text>
                          </View>
                          <TouchableOpacity
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            onPress={() => void removeMember(user.id)}
                            disabled={removingUserId === user.id}
                          >
                            {removingUserId === user.id
                              ? <ActivityIndicator color={c.textMuted} size="small" />
                              : <MaterialCommunityIcons name="close-circle-outline" size={18} color={c.textMuted} />}
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ListBox>
                  </>
                ) : null}

                {/* Add people */}
                <Text style={[s.sectionLabel, { color: c.textMuted, marginTop: (detailList.users || []).length > 0 ? 14 : 0 }]}>
                  {t('lists.addPeople', { defaultValue: 'ADD ACCOUNTS' })}
                </Text>

                <Text style={[s.addInfoText, { color: c.textMuted }]}>
                  {t('lists.addInfo', { defaultValue: "Search for any public account. Private accounts can only be added if you already follow them." })}
                </Text>

                {/* Search bar */}
                <View style={[s.searchRow, { backgroundColor: c.inputBackground, borderColor: c.inputBorder }]}>
                  <MaterialCommunityIcons name="magnify" size={16} color={c.textMuted} style={{ marginRight: 6 }} />
                  <TextInput
                    style={[s.searchInput, { color: c.textPrimary }]}
                    placeholder={t('lists.searchPeople', { defaultValue: 'Search by name or username…' })}
                    placeholderTextColor={c.placeholder}
                    value={memberSearch}
                    onChangeText={setMemberSearch}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {searchLoading
                    ? <ActivityIndicator color={c.textMuted} size="small" />
                    : memberSearch.length > 0
                      ? (
                        <TouchableOpacity onPress={() => setMemberSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <MaterialCommunityIcons name="close-circle" size={15} color={c.textMuted} />
                        </TouchableOpacity>
                      ) : null}
                </View>

                {/* Picker list — followings by default, platform search results when typing */}
                {followingsLoading && !isSearching ? (
                  <ActivityIndicator color={c.primary} size="small" style={{ marginTop: 12 }} />
                ) : isSearching && !searchLoading && filteredSearchResults.length === 0 ? (
                  <Text style={[s.emptyPickerText, { color: c.textMuted }]}>
                    {t('lists.noSearchResults', { defaultValue: 'No results found.' })}
                  </Text>
                ) : !isSearching && filteredFollowings.length === 0 && !followingsLoading ? (
                  <Text style={[s.emptyPickerText, { color: c.textMuted }]}>
                    {followings.length === 0
                      ? t('lists.noFollowings', { defaultValue: "You're not following anyone yet. Search above to find people." })
                      : t('lists.allInList', { defaultValue: 'Everyone you follow is already in this list.' })}
                  </Text>
                ) : (
                  <ListBox webMaxHeight={220}>
                    {(isSearching ? filteredSearchResults : filteredFollowings).map((u) => {
                      const username = (u as any).username;
                      const name = (u as any).profile?.name;
                      const avatar = (u as any).profile?.avatar;
                      const isPrivate = (u as SearchUserResult).visibility === 'T';
                      const isAlreadyFollowing = isSearching
                        ? !!(u as SearchUserResult).is_following
                        : true; // everything in followings is already followed
                      const isAdding = addingUsername === username;
                      return (
                        <View key={(u as any).id} style={[s.memberRow, { borderColor: c.border }]}>
                          <UserAvatar uri={avatar} initial={username?.[0] || '?'} bg={c.primary} />
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                              <Text style={[s.memberName, { color: c.textPrimary }]}>
                                {name || username}
                              </Text>
                              {isPrivate && (
                                <MaterialCommunityIcons name="lock-outline" size={12} color={c.textMuted} />
                              )}
                              {isSearching && isAlreadyFollowing && (
                                <View style={[s.followingBadge, { backgroundColor: c.primary + '22', borderColor: c.primary + '44' }]}>
                                  <Text style={[s.followingBadgeText, { color: c.primary }]}>
                                    {t('lists.following', { defaultValue: 'Following' })}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text style={[s.memberHandle, { color: c.textMuted }]}>
                              @{username}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={[s.addBtn, { backgroundColor: isPrivate ? c.border : c.primary, opacity: isAdding ? 0.6 : 1 }]}
                            onPress={() => !isPrivate && void addMember(username)}
                            disabled={isAdding || !username || isPrivate}
                          >
                            {isAdding
                              ? <ActivityIndicator color="#fff" size="small" />
                              : <MaterialCommunityIcons name={isPrivate ? 'lock' : 'plus'} size={16} color="#fff" />}
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </ListBox>
                )}
                </DetailScroller>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Delete Confirmation Modal ──────────────────────────────────────────── */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <Pressable style={s.overlay} onPress={() => setDeleteTarget(null)}>
          <Pressable style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
            <Text style={[s.cardTitle, { color: c.textPrimary }]}>
              {t('lists.deleteTitle', { defaultValue: 'Delete list' })}
            </Text>
            <Text style={[s.cardBody, { color: c.textSecondary }]}>
              {t('lists.deleteConfirm', {
                defaultValue: 'Are you sure you want to delete "{{name}}"? This cannot be undone.',
                name: deleteTarget?.name || t('lists.deleteTargetFallback', { defaultValue: 'this list' }),
              })}
            </Text>
            <View style={s.cardActions}>
              <TouchableOpacity
                style={[s.btn, s.btnOutline, { borderColor: c.border }]}
                onPress={() => setDeleteTarget(null)}
              >
                <Text style={{ color: c.textSecondary }}>{t('lists.cancel', { defaultValue: 'Cancel' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, { backgroundColor: '#EF4444' }]}
                onPress={() => void confirmDelete()}
                disabled={deleteLoading}
              >
                {deleteLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '600' }}>{t('lists.delete', { defaultValue: 'Delete' })}</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Emoji Picker ─────────────────────────────────────────────────────────────

function EmojiPicker({
  groups,
  selectedId,
  onSelect,
  c,
}: {
  groups: EmojiGroup[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  c: any;
}) {
  const [activeGroup, setActiveGroup] = useState(0);
  const group = groups[activeGroup];

  if (!groups.length) return null;

  return (
    <View>
      {/* Group tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {groups.map((g, idx) => (
            <TouchableOpacity
              key={g.id}
              onPress={() => setActiveGroup(idx)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 12,
                backgroundColor: activeGroup === idx ? c.primary : c.inputBackground,
                borderWidth: 1,
                borderColor: activeGroup === idx ? c.primary : c.border,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: activeGroup === idx ? '#fff' : c.textSecondary }}>
                {g.keyword}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Emojis grid */}
      {group ? (
        <ScrollView style={{ maxHeight: 120 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {group.emojis.map((emoji) => {
              const selected = selectedId === emoji.id;
              return (
                <TouchableOpacity
                  key={emoji.id}
                  onPress={() => onSelect(emoji.id)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selected ? c.primary + '22' : c.inputBackground,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? c.primary : c.border,
                  }}
                >
                  {emoji.image ? (
                    <Image source={{ uri: emoji.image }} style={{ width: 22, height: 22 }} resizeMode="contain" />
                  ) : (
                    <Text style={{ fontSize: 18 }}>{emoji.keyword}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function useStyles(c: any) {
  return StyleSheet.create({
    container: {
      flex: 1,
      borderWidth: 1,
      borderRadius: 12,
      overflow: 'hidden',
      marginTop: 12,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: Platform.select({ native: 24, default: 16 }),
      paddingVertical: Platform.select({ native: 18, default: 14 }),
      borderBottomWidth: 1,
    },
    headerTitle: {
      fontSize: Platform.select({ native: 44, default: 18 }),
      fontWeight: Platform.select({ native: '800', default: '700' }),
      letterSpacing: Platform.select({ native: -0.8, default: 0 }),
    },
    headerAddBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      gap: 4,
    },
    headerAddBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    description: {
      fontSize: 13,
      lineHeight: 18,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    centreBox: {
      alignItems: 'center',
      paddingVertical: 36,
      paddingHorizontal: 16,
      gap: 10,
    },
    errorText: { fontSize: 14 },
    retryBtn: { paddingHorizontal: 12, paddingVertical: 6 },
    emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
    outlineBtn: {
      borderWidth: 1,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 7,
    },
    list: { flex: 1 },
    listContent: { padding: 12, paddingBottom: Platform.select({ native: 120, default: 12 }), gap: 8 },
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      gap: 12,
    },
    listRowEmoji: {
      width: 36,
      height: 36,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    listRowEmojiText: { fontSize: 18 },
    listRowEmojiImage: { width: 22, height: 22 },
    listRowCenter: { flex: 1 },
    listRowName: { fontSize: 15, fontWeight: '600' },
    listRowCount: { fontSize: 12, marginTop: 1 },
    // Modals
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      ...Platform.select({
        native: { justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 },
        default: { justifyContent: 'center', alignItems: 'center', padding: 20 },
      }),
    },
    card: {
      width: '100%',
      borderWidth: 1,
      padding: 20,
      ...Platform.select({
        native: {
          borderRadius: 0,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          borderBottomWidth: 0,
        },
        default: { maxWidth: 440, borderRadius: 14 },
      }),
    },
    detailCard: Platform.select({
      native: { height: '92%' },
      default: { maxHeight: '90%' },
    }) as any,
    cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: 14 },
    cardBody: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
    cardActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 16,
    },
    btn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      minWidth: 80,
      alignItems: 'center',
    },
    btnOutline: { borderWidth: 1 },
    fieldLabel: {
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 6,
    },
    textInput: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
    },
    inlineError: { fontSize: 12, marginTop: 6 },
    detailHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    detailEmoji: {
      width: 36,
      height: 36,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    editPanel: {
      borderWidth: 1,
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
    sectionLabel: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.9,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    memberScroll: Platform.select({ native: {}, default: { maxHeight: 160 } }) as any,
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 7,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    memberName: { fontSize: 14, fontWeight: '600' },
    memberHandle: { fontSize: 12 },
    addInfoText: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
      marginBottom: 8,
    },
    searchInput: { flex: 1, fontSize: 14, padding: 0 },
    pickerScroll: Platform.select({ native: {}, default: { maxHeight: 220 } }) as any,
    emptyPickerText: {
      fontSize: 13,
      textAlign: 'center',
      paddingVertical: 14,
      lineHeight: 18,
    },
    addBtn: {
      width: 30,
      height: 30,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    followingBadge: {
      borderWidth: 1,
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    followingBadgeText: { fontSize: 10, fontWeight: '700' },
  });
}
