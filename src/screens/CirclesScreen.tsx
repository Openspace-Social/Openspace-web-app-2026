import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { api, CircleDetailResult, CircleResult, ConnectionResult } from '../api/client';

// ─── Preset colours ───────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#6366F1', // indigo (primary)
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#EF4444', // red
  '#F97316', // orange
  '#EAB308', // yellow
  '#22C55E', // green
  '#14B8A6', // teal
  '#3B82F6', // blue
  '#64748B', // slate
];

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  onNotice: (msg: string) => void;
};

// ─── Small helpers ────────────────────────────────────────────────────────────

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

function CircleColorDot({ color, size = 12 }: { color?: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color || '#64748B',
        marginRight: 8,
      }}
    />
  );
}

function UserAvatar({ uri, initial, size = 32, bg }: { uri?: string; initial: string; size?: number; bg: string }) {
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

export default function CirclesScreen({ token, c, t, onNotice }: Props) {
  const s = useStyles(c);

  // ── Circles list ─────────────────────────────────────────────────────────────
  const [circles, setCircles] = useState<CircleResult[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  // ── My connections (loaded once when detail opens) ────────────────────────────
  const [connections, setConnections] = useState<ConnectionResult[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);

  // ── Create modal ──────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createColor, setCreateColor] = useState(PRESET_COLORS[0]);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // ── Detail / edit modal ───────────────────────────────────────────────────────
  const [detailCircle, setDetailCircle] = useState<CircleDetailResult | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  // edit fields
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(PRESET_COLORS[0]);
  const [editMode, setEditMode] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // connection search / add
  const [connectionSearch, setConnectionSearch] = useState('');
  const [addingUsername, setAddingUsername] = useState<string | null>(null); // tracks which row is loading

  // remove member
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);

  // ── Delete confirmation ───────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<CircleResult | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Load circles list ─────────────────────────────────────────────────────────
  const loadCircles = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const data = await api.getCircles(token);
      setCircles(data);
    } catch (err: any) {
      setListError(err?.message || t('circles.loadError', { defaultValue: 'Failed to load circles.' }));
    } finally {
      setListLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void loadCircles();
  }, [loadCircles]);

  // ── Load connections (once) ───────────────────────────────────────────────────
  const loadConnections = useCallback(async () => {
    if (connections.length > 0) return; // already loaded
    setConnectionsLoading(true);
    try {
      const data = await api.getConnections(token);
      setConnections(data);
    } catch {
      // non-fatal — list just won't show
    } finally {
      setConnectionsLoading(false);
    }
  }, [token, connections.length]);

  // ── Open circle detail ────────────────────────────────────────────────────────
  async function openDetail(circle: CircleResult) {
    setDetailCircle(null);
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError('');
    setEditMode(false);
    setEditError('');
    setConnectionSearch('');
    try {
      const [data] = await Promise.all([
        api.getCircleDetail(token, circle.id),
        loadConnections(),
      ]);
      setDetailCircle(data);
      setEditName(data.name || '');
      setEditColor(data.color || PRESET_COLORS[0]);
    } catch (err: any) {
      setDetailError(err?.message || t('circles.detailLoadError', { defaultValue: 'Failed to load circle.' }));
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetailOpen(false);
    setDetailCircle(null);
    setEditMode(false);
    setEditError('');
    setConnectionSearch('');
  }

  // ── Filtered connections for the picker ───────────────────────────────────────
  // Shows all connections NOT already in the circle, filtered by the search term.
  const memberUsernames = useMemo(
    () => new Set((detailCircle?.users || []).map((u) => u.username).filter(Boolean)),
    [detailCircle]
  );

  const filteredConnections = useMemo(() => {
    const q = connectionSearch.toLowerCase().trim();
    return connections.filter((conn) => {
      const u = conn.target_user;
      if (!u) return false;
      if (!u.is_fully_connected) return false;        // exclude pending requests
      if (memberUsernames.has(u.username)) return false; // already in circle
      if (!q) return true;
      return (
        (u.username || '').toLowerCase().includes(q) ||
        (u.profile?.name || '').toLowerCase().includes(q)
      );
    });
  }, [connections, connectionSearch, memberUsernames]);

  // ── Add connection to circle ──────────────────────────────────────────────────
  async function addConnectionToCircle(username: string) {
    if (!detailCircle) return;
    setAddingUsername(username);
    try {
      const currentUsernames = (detailCircle.users || [])
        .map((u) => u.username)
        .filter((u): u is string => !!u);
      const newUsernames = [...currentUsernames, username];
      await api.updateCircle(token, detailCircle.id, { usernames: newUsernames });
      const refreshed = await api.getCircleDetail(token, detailCircle.id);
      setDetailCircle(refreshed);
      setCircles((prev) =>
        prev.map((c) => (c.id === refreshed.id ? { ...c, users_count: refreshed.users_count } : c))
      );
    } catch (err: any) {
      onNotice(err?.message || t('circles.addMemberError', { defaultValue: 'Failed to add member.' }));
    } finally {
      setAddingUsername(null);
    }
  }

  // ── Remove member from circle ─────────────────────────────────────────────────
  async function removeMember(userId: number) {
    if (!detailCircle) return;
    setRemovingMemberId(userId);
    try {
      const newUsernames = (detailCircle.users || [])
        .filter((u) => u.id !== userId)
        .map((u) => u.username)
        .filter((u): u is string => !!u);
      await api.updateCircle(token, detailCircle.id, { usernames: newUsernames });
      const refreshed = await api.getCircleDetail(token, detailCircle.id);
      setDetailCircle(refreshed);
      setCircles((prev) =>
        prev.map((c) => (c.id === refreshed.id ? { ...c, users_count: refreshed.users_count } : c))
      );
    } catch (err: any) {
      onNotice(err?.message || t('circles.removeMemberError', { defaultValue: 'Failed to remove member.' }));
    } finally {
      setRemovingMemberId(null);
    }
  }

  // ── Save name / colour edit ───────────────────────────────────────────────────
  async function saveEdit() {
    if (!detailCircle) return;
    setEditLoading(true);
    setEditError('');
    try {
      const updated = await api.updateCircle(token, detailCircle.id, {
        name: editName.trim() || undefined,
        color: editColor,
      });
      setDetailCircle((prev) => prev ? { ...prev, name: updated.name, color: updated.color } : prev);
      setCircles((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, name: updated.name, color: updated.color } : c))
      );
      setEditMode(false);
    } catch (err: any) {
      setEditError(err?.message || t('circles.saveError', { defaultValue: 'Failed to save changes.' }));
    } finally {
      setEditLoading(false);
    }
  }

  // ── Create circle ─────────────────────────────────────────────────────────────
  function openCreate() {
    setCreateName('');
    setCreateColor(PRESET_COLORS[0]);
    setCreateError('');
    setCreateOpen(true);
  }

  async function submitCreate() {
    const name = createName.trim();
    if (!name) { setCreateError(t('circles.nameRequired', { defaultValue: 'Please enter a circle name.' })); return; }
    setCreateLoading(true);
    setCreateError('');
    try {
      const created = await api.createCircle(token, name, createColor);
      setCircles((prev) => [...prev, created]);
      setCreateOpen(false);
    } catch (err: any) {
      setCreateError(err?.message || t('circles.createError', { defaultValue: 'Failed to create circle.' }));
    } finally {
      setCreateLoading(false);
    }
  }

  // ── Delete circle ─────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.deleteCircle(token, deleteTarget.id);
      setCircles((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: any) {
      onNotice(err?.message || t('circles.deleteError', { defaultValue: 'Failed to delete circle.' }));
    } finally {
      setDeleteLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { backgroundColor: c.surface, borderColor: c.border }]}>

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <View style={[s.header, { borderBottomColor: c.border }]}>
        <Text style={[s.headerTitle, { color: c.textPrimary }]}>
          {t('circles.title', { defaultValue: 'Circles' })}
        </Text>
        <TouchableOpacity
          style={[s.headerAddBtn, { backgroundColor: c.primary }]}
          activeOpacity={0.8}
          onPress={openCreate}
        >
          <MaterialCommunityIcons name="plus" size={16} color="#fff" />
          <Text style={s.headerAddBtnText}>
            {t('circles.newCircle', { defaultValue: 'New circle' })}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={[s.description, { color: c.textSecondary }]}>
        {t('circles.description', {
          defaultValue:
            'Circles let you share posts with specific groups of connections. Choose a circle when you create a post to control who sees it.',
        })}
      </Text>

      {/* ── Circles list ─────────────────────────────────────────────────────── */}
      {listLoading ? (
        <ActivityIndicator color={c.primary} size="large" style={{ marginTop: 40 }} />
      ) : listError ? (
        <View style={s.centreBox}>
          <Text style={[s.errorText, { color: c.errorText }]}>{listError}</Text>
          <TouchableOpacity onPress={() => void loadCircles()} style={s.retryBtn}>
            <Text style={{ color: c.primary }}>{t('circles.retry', { defaultValue: 'Retry' })}</Text>
          </TouchableOpacity>
        </View>
      ) : circles.length === 0 ? (
        <View style={s.centreBox}>
          <MaterialCommunityIcons name="circle-outline" size={40} color={c.textMuted} />
          <Text style={[s.emptyText, { color: c.textMuted }]}>
            {t('circles.empty', { defaultValue: "You don't have any circles yet." })}
          </Text>
          <TouchableOpacity
            style={[s.outlineBtn, { borderColor: c.primary }]}
            activeOpacity={0.8}
            onPress={openCreate}
          >
            <Text style={{ color: c.primary }}>
              {t('circles.createFirstCircle', { defaultValue: 'Create your first circle' })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={s.list} contentContainerStyle={s.listContent}>
          {circles.map((circle) => (
            <TouchableOpacity
              key={circle.id}
              style={[s.circleRow, { borderColor: c.border }]}
              activeOpacity={0.75}
              onPress={() => void openDetail(circle)}
            >
              <View style={s.circleRowLeft}>
                <CircleColorDot color={circle.color} size={14} />
                <Text style={[s.circleName, { color: c.textPrimary }]}>
                  {circle.name || t('circles.unnamed', { defaultValue: 'Unnamed circle' })}
                </Text>
              </View>
              <View style={s.circleRowRight}>
                <Text style={[s.circleMemberCount, { color: c.textMuted }]}>
                  {circle.users_count ?? 0}{' '}
                  {(circle.users_count ?? 0) === 1
                    ? t('circles.member', { defaultValue: 'member' })
                    : t('circles.members', { defaultValue: 'members' })}
                </Text>
                <TouchableOpacity
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={(e) => { e.stopPropagation?.(); setDeleteTarget(circle); }}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={16} color={c.textMuted} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ── Create Modal ─────────────────────────────────────────────────────── */}
      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <Pressable style={s.overlay} onPress={() => setCreateOpen(false)}>
          <Pressable style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
            <Text style={[s.cardTitle, { color: c.textPrimary }]}>
              {t('circles.createTitle', { defaultValue: 'Create circle' })}
            </Text>

            <Text style={[s.fieldLabel, { color: c.textSecondary }]}>
              {t('circles.fieldName', { defaultValue: 'Name' })}
            </Text>
            <TextInput
              style={[s.textInput, { backgroundColor: c.inputBackground, borderColor: c.inputBorder, color: c.textPrimary }]}
              placeholder={t('circles.namePlaceholder', { defaultValue: 'e.g. Close friends' })}
              placeholderTextColor={c.placeholder}
              value={createName}
              onChangeText={setCreateName}
              maxLength={100}
              autoFocus
            />

            <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 14 }]}>
              {t('circles.fieldColor', { defaultValue: 'Colour' })}
            </Text>
            <ColorPicker value={createColor} onChange={setCreateColor} colors={PRESET_COLORS} />

            {createError ? <Text style={[s.inlineError, { color: c.errorText }]}>{createError}</Text> : null}

            <View style={s.cardActions}>
              <TouchableOpacity
                style={[s.btn, s.btnOutline, { borderColor: c.border }]}
                onPress={() => setCreateOpen(false)}
              >
                <Text style={{ color: c.textSecondary }}>{t('circles.cancel', { defaultValue: 'Cancel' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, { backgroundColor: c.primary }]}
                onPress={() => void submitCreate()}
                disabled={createLoading}
              >
                {createLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '600' }}>{t('circles.create', { defaultValue: 'Create' })}</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Detail / Edit Modal ───────────────────────────────────────────────── */}
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
            ) : detailCircle ? (
              <>
                {/* ── Detail header */}
                <View style={s.detailHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <CircleColorDot color={detailCircle.color} size={16} />
                    <Text style={[s.cardTitle, { color: c.textPrimary, marginBottom: 0 }]}>
                      {detailCircle.name || t('circles.unnamed', { defaultValue: 'Unnamed circle' })}
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

                {/* ── Edit panel */}
                {editMode ? (
                  <View style={[s.editPanel, { borderColor: c.border }]}>
                    <Text style={[s.fieldLabel, { color: c.textSecondary }]}>
                      {t('circles.fieldName', { defaultValue: 'Name' })}
                    </Text>
                    <TextInput
                      style={[s.textInput, { backgroundColor: c.inputBackground, borderColor: c.inputBorder, color: c.textPrimary }]}
                      value={editName}
                      onChangeText={setEditName}
                      maxLength={100}
                    />
                    <Text style={[s.fieldLabel, { color: c.textSecondary, marginTop: 10 }]}>
                      {t('circles.fieldColor', { defaultValue: 'Colour' })}
                    </Text>
                    <ColorPicker value={editColor} onChange={setEditColor} colors={PRESET_COLORS} />
                    {editError ? <Text style={[s.inlineError, { color: c.errorText }]}>{editError}</Text> : null}
                    <View style={s.cardActions}>
                      <TouchableOpacity
                        style={[s.btn, s.btnOutline, { borderColor: c.border }]}
                        onPress={() => { setEditMode(false); setEditError(''); }}
                      >
                        <Text style={{ color: c.textSecondary }}>{t('circles.cancel', { defaultValue: 'Cancel' })}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.btn, { backgroundColor: c.primary }]}
                        onPress={() => void saveEdit()}
                        disabled={editLoading}
                      >
                        {editLoading
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={{ color: '#fff', fontWeight: '600' }}>{t('circles.save', { defaultValue: 'Save' })}</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                {/* ── Current members section */}
                {(detailCircle.users || []).length > 0 ? (
                  <>
                    <Text style={[s.sectionLabel, { color: c.textMuted }]}>
                      {t('circles.membersSection', { defaultValue: 'IN THIS CIRCLE' })}{' '}
                      ({detailCircle.users_count ?? detailCircle.users?.length ?? 0})
                    </Text>
                    <ListBox webMaxHeight={160}>
                      {(detailCircle.users || []).map((user) => (
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
                            onPress={() => void removeMember(user.id!)}
                            disabled={removingMemberId === user.id}
                          >
                            {removingMemberId === user.id
                              ? <ActivityIndicator color={c.textMuted} size="small" />
                              : <MaterialCommunityIcons name="close-circle-outline" size={18} color={c.textMuted} />}
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ListBox>
                  </>
                ) : null}

                {/* ── Add from connections ── */}
                <Text style={[s.sectionLabel, { color: c.textMuted, marginTop: (detailCircle.users || []).length > 0 ? 14 : 0 }]}>
                  {t('circles.addFromConnections', { defaultValue: 'ADD FROM CONNECTIONS' })}
                </Text>

                {/* Search bar */}
                <View style={[s.searchRow, { backgroundColor: c.inputBackground, borderColor: c.inputBorder }]}>
                  <MaterialCommunityIcons name="magnify" size={16} color={c.textMuted} style={{ marginRight: 6 }} />
                  <TextInput
                    style={[s.searchInput, { color: c.textPrimary }]}
                    placeholder={t('circles.searchConnections', { defaultValue: 'Search by name or username…' })}
                    placeholderTextColor={c.placeholder}
                    value={connectionSearch}
                    onChangeText={setConnectionSearch}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {connectionSearch.length > 0 ? (
                    <TouchableOpacity onPress={() => setConnectionSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <MaterialCommunityIcons name="close-circle" size={15} color={c.textMuted} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Connections picker list */}
                {connectionsLoading ? (
                  <ActivityIndicator color={c.primary} size="small" style={{ marginTop: 12 }} />
                ) : connections.length === 0 ? (
                  <Text style={[s.emptyPickerText, { color: c.textMuted }]}>
                    {t('circles.noConnections', { defaultValue: "You don't have any confirmed connections yet." })}
                  </Text>
                ) : filteredConnections.length === 0 ? (
                  <Text style={[s.emptyPickerText, { color: c.textMuted }]}>
                    {connectionSearch
                      ? t('circles.noSearchResults', { defaultValue: 'No connections match that search.' })
                      : t('circles.allInCircle', { defaultValue: 'All your connections are already in this circle.' })}
                  </Text>
                ) : (
                  <ListBox webMaxHeight={220}>
                    {filteredConnections.map((conn) => {
                      const u = conn.target_user!;
                      const isAdding = addingUsername === u.username;
                      return (
                        <View key={conn.id} style={[s.memberRow, { borderColor: c.border }]}>
                          <UserAvatar
                            uri={u.profile?.avatar}
                            initial={u.username?.[0] || '?'}
                            bg={c.primary}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={[s.memberName, { color: c.textPrimary }]}>
                              {u.profile?.name || u.username}
                            </Text>
                            <Text style={[s.memberHandle, { color: c.textMuted }]}>
                              @{u.username}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={[s.addBtn, { backgroundColor: c.primary, opacity: isAdding ? 0.6 : 1 }]}
                            onPress={() => void addConnectionToCircle(u.username!)}
                            disabled={isAdding}
                          >
                            {isAdding
                              ? <ActivityIndicator color="#fff" size="small" />
                              : <MaterialCommunityIcons name="plus" size={16} color="#fff" />}
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

      {/* ── Delete Confirmation Modal ─────────────────────────────────────────── */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <Pressable style={s.overlay} onPress={() => setDeleteTarget(null)}>
          <Pressable style={[s.card, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
            <Text style={[s.cardTitle, { color: c.textPrimary }]}>
              {t('circles.deleteTitle', { defaultValue: 'Delete circle' })}
            </Text>
            <Text style={[s.cardBody, { color: c.textSecondary }]}>
              {t('circles.deleteConfirm', {
                defaultValue: 'Are you sure you want to delete "{{name}}"? This cannot be undone.',
                name: deleteTarget?.name || t('circles.deleteTargetFallback', { defaultValue: 'this circle' }),
              })}
            </Text>
            <View style={s.cardActions}>
              <TouchableOpacity
                style={[s.btn, s.btnOutline, { borderColor: c.border }]}
                onPress={() => setDeleteTarget(null)}
              >
                <Text style={{ color: c.textSecondary }}>{t('circles.cancel', { defaultValue: 'Cancel' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, { backgroundColor: '#EF4444' }]}
                onPress={() => void confirmDelete()}
                disabled={deleteLoading}
              >
                {deleteLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '600' }}>{t('circles.delete', { defaultValue: 'Delete' })}</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Color Picker ─────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
      {colors.map((color) => (
        <TouchableOpacity
          key={color}
          onPress={() => onChange(color)}
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: color,
            borderWidth: value === color ? 3 : 0,
            borderColor: '#fff',
            shadowColor: value === color ? color : 'transparent',
            shadowOpacity: 0.7,
            shadowRadius: 5,
            shadowOffset: { width: 0, height: 0 },
          }}
        />
      ))}
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
    headerAddBtnText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '600',
    },
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
    errorText: {
      fontSize: 14,
    },
    retryBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    emptyText: {
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 20,
    },
    outlineBtn: {
      borderWidth: 1,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 7,
    },
    list: { flex: 1 },
    listContent: { padding: 12, paddingBottom: Platform.select({ native: 120, default: 12 }), gap: 8 },
    circleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
    },
    circleRowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    circleName: { fontSize: 15, fontWeight: '600' },
    circleRowRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    circleMemberCount: { fontSize: 12 },
    // ── Modals ────────────────────────────────────────────────────────────────
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
      default: { maxHeight: '88%' },
    }) as any,
    cardTitle: {
      fontSize: 17,
      fontWeight: '700',
      marginBottom: 14,
    },
    cardBody: {
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 16,
    },
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
    // ── Detail modal internals ────────────────────────────────────────────────
    detailHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
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
    // ── Connection picker ─────────────────────────────────────────────────────
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
      marginBottom: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      padding: 0,
    },
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
  });
}
