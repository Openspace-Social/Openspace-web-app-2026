import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image as RNImage,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CircleResult, EmojiGroup, ListResult, ModerationCategory } from '../api/client';

type Panel = 'main' | 'lists' | 'circles' | 'report';

// Normalise an API label the same way HomeScreen does, then map to i18n key
function normalizeCatLabel(value?: string) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function resolveCategoryI18nKey(cat: { name: string; title: string }): string | null {
  const n = normalizeCatLabel(cat.name);
  const ti = normalizeCatLabel(cat.title);
  const match = (s: string) => n.includes(s) || ti.includes(s);

  if (match('spam')) return 'spam';
  if (match('copyright') || match('trademark')) return 'copyright';
  if (match('platform abuse') || match('abuse')) return 'abuse';
  if (match('pornograph')) return 'pornography';
  if (match('guideline')) return 'guidelines';
  if (match('hatred') || match('bullying')) return 'hatred';
  if (match('self harm')) return 'selfHarm';
  if (match('violent') || match('gory')) return 'violent';
  if (match('child') || match('csam') || match('exploitation')) return 'csam';
  if (match('illegal') || match('drug')) return 'illegal';
  if (match('deceptive')) return 'deceptive';
  if (match('other')) return 'other';
  return null;
}

function resolveCategoryTitle(cat: { name: string; title: string }, t: (k: string, o?: any) => string): string {
  const key = resolveCategoryI18nKey(cat);
  return key ? t(`home.reportCategory.${key}.title`) : cat.title || cat.name;
}

function resolveCategoryDescription(cat: { name: string; title: string; description?: string }, t: (k: string, o?: any) => string): string | undefined {
  const key = resolveCategoryI18nKey(cat);
  if (key) return t(`home.reportCategory.${key}.description`);
  return cat.description;
}

const PRESET_COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#EF4444',
  '#F97316', '#EAB308', '#22C55E', '#14B8A6',
  '#6366F1', '#0EA5E9', '#84CC16', '#F43F5E',
];

type Props = {
  visible: boolean;
  username: string;
  c: any;
  t: (key: string, opts?: any) => string;
  // Connection state
  isConnected: boolean;
  isFullyConnected: boolean;
  isPendingConfirmation: boolean; // they sent us a request
  connectionCircleIds: number[];
  // Data
  userCircles: CircleResult[];
  userLists: ListResult[];
  moderationCategories: ModerationCategory[];
  // Loading
  actionLoading: boolean;
  // Handlers
  onClose: () => void;
  onConnect: (circlesIds: number[]) => void;
  onUpdateConnection: (circlesIds: number[]) => void;
  onConfirmConnection: (circlesIds: number[]) => void;
  onDisconnect: () => void;
  onAddToList: (listId: number, username: string) => Promise<void>;
  onCreateList: (name: string, emojiId: number) => Promise<ListResult | null>;
  onFetchEmojiGroups: () => Promise<EmojiGroup[]>;
  onCreateCircle: (name: string, color: string) => Promise<CircleResult | null>;
  onBlock: () => void;
  onReport: (categoryId: number, description?: string) => void;
};

export default function ProfileActionsMenu({
  visible,
  username,
  c,
  t,
  isConnected,
  isFullyConnected,
  isPendingConfirmation,
  connectionCircleIds,
  userCircles,
  userLists,
  moderationCategories,
  actionLoading,
  onClose,
  onConnect,
  onUpdateConnection,
  onConfirmConnection,
  onDisconnect,
  onAddToList,
  onCreateList,
  onFetchEmojiGroups,
  onCreateCircle,
  onBlock,
  onReport,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const drawerWidth = Math.min(420, screenWidth * 0.88);
  const translateX = useRef(new Animated.Value(drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateX.setValue(drawerWidth);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, { toValue: drawerWidth, duration: 280, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible, drawerWidth]);

  const [panel, setPanel] = useState<Panel>('main');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

  // Circles panel
  const [selectedCircleIds, setSelectedCircleIds] = useState<number[]>([]);
  const [createCircleMode, setCreateCircleMode] = useState(false);
  const [newCircleName, setNewCircleName] = useState('');
  const [newCircleColor, setNewCircleColor] = useState(PRESET_COLORS[0]);
  const [createCircleLoading, setCreateCircleLoading] = useState(false);

  // Lists panel
  const [listActionLoadingId, setListActionLoadingId] = useState<number | null>(null);
  const [createListMode, setCreateListMode] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [createListLoading, setCreateListLoading] = useState(false);
  const [addedListIds, setAddedListIds] = useState<number[]>([]);
  const [emojiGroups, setEmojiGroups] = useState<EmojiGroup[]>([]);
  const [emojiGroupsLoading, setEmojiGroupsLoading] = useState(false);
  const [selectedEmojiId, setSelectedEmojiId] = useState<number | null>(null);

  // Report panel
  const [reportCategoryId, setReportCategoryId] = useState<number | null>(null);
  const [reportDescription, setReportDescription] = useState('');

  // Reset state when menu opens
  useEffect(() => {
    if (visible) {
      setPanel('main');
      setConfirmDisconnect(false);
      setConfirmBlock(false);
      setCreateCircleMode(false);
      setNewCircleName('');
      setNewCircleColor(PRESET_COLORS[0]);
      setCreateListMode(false);
      setNewListName('');
      setAddedListIds([]);
      setReportCategoryId(null);
      setReportDescription('');
    }
  }, [visible]);

  // Pre-select current connection circles when opening circles panel
  useEffect(() => {
    if (panel === 'circles') {
      if (connectionCircleIds.length > 0) {
        setSelectedCircleIds(connectionCircleIds);
      } else {
        // Default to first circle (Connections circle)
        const connectionsCircle = userCircles.find((c) =>
          (c.name || '').toLowerCase() === 'connections'
        );
        setSelectedCircleIds(connectionsCircle ? [connectionsCircle.id] : userCircles[0] ? [userCircles[0].id] : []);
      }
    }
  }, [panel, connectionCircleIds, userCircles]);

  function toggleCircle(id: number) {
    setSelectedCircleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleCreateCircle() {
    if (!newCircleName.trim()) return;
    setCreateCircleLoading(true);
    try {
      const circle = await onCreateCircle(newCircleName.trim(), newCircleColor);
      if (circle) {
        setSelectedCircleIds((prev) => [...prev, circle.id]);
        setCreateCircleMode(false);
        setNewCircleName('');
      }
    } finally {
      setCreateCircleLoading(false);
    }
  }

  function handleCirclesConfirm() {
    if (selectedCircleIds.length === 0) return;
    if (isFullyConnected) {
      onUpdateConnection(selectedCircleIds);
    } else if (isPendingConfirmation) {
      onConfirmConnection(selectedCircleIds);
    } else {
      onConnect(selectedCircleIds);
    }
    onClose();
  }

  async function handleAddToList(listId: number) {
    setListActionLoadingId(listId);
    try {
      await onAddToList(listId, username);
      setAddedListIds((prev) => [...prev, listId]);
    } finally {
      setListActionLoadingId(null);
    }
  }

  async function openCreateListMode() {
    setCreateListMode(true);
    if (emojiGroups.length === 0) {
      setEmojiGroupsLoading(true);
      try {
        const groups = await onFetchEmojiGroups();
        setEmojiGroups(groups);
        // Auto-select first available emoji
        const firstEmoji = groups[0]?.emojis?.[0];
        if (firstEmoji && !selectedEmojiId) setSelectedEmojiId(firstEmoji.id);
      } finally {
        setEmojiGroupsLoading(false);
      }
    }
  }

  async function handleCreateList() {
    if (!newListName.trim() || !selectedEmojiId) return;
    setCreateListLoading(true);
    try {
      const list = await onCreateList(newListName.trim(), selectedEmojiId);
      if (list) {
        setCreateListMode(false);
        setNewListName('');
        // Auto-add user to new list
        handleAddToList(list.id);
      }
    } finally {
      setCreateListLoading(false);
    }
  }

  function handleReport() {
    if (!reportCategoryId) return;
    onReport(reportCategoryId, reportDescription);
    onClose();
  }

  // ─── Shared style helpers ───────────────────────────────────────────────────

  const sheetBg = { backgroundColor: c.surface };
  const borderStyle = { borderColor: c.border };
  const textPrimary = { color: c.textPrimary };
  const textSecondary = { color: c.textSecondary };
  const textMuted = { color: c.textMuted };

  function PanelHeader({ title, onBack }: { title: string; onBack?: () => void }) {
    return (
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: c.border,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {onBack && (
            <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={c.textSecondary} />
            </TouchableOpacity>
          )}
          <Text style={{ fontSize: 16, fontWeight: '700', color: c.textPrimary }}>{title}</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <MaterialCommunityIcons name="close" size={20} color={c.textSecondary} />
        </TouchableOpacity>
      </View>
    );
  }

  function MenuItem({
    icon, label, sublabel, color, onPress, danger, disabled, rightContent,
  }: {
    icon: string; label: string; sublabel?: string; color?: string; onPress: () => void;
    danger?: boolean; disabled?: boolean; rightContent?: React.ReactNode;
  }) {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.75}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 14,
          paddingHorizontal: 20, paddingVertical: 14,
          borderBottomWidth: 1, borderBottomColor: c.border,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <MaterialCommunityIcons name={icon as any} size={22} color={color || (danger ? c.errorText : c.textSecondary)} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '500', color: danger ? c.errorText : c.textPrimary }}>{label}</Text>
          {sublabel ? <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 1 }}>{sublabel}</Text> : null}
        </View>
        {rightContent}
        {!rightContent && <MaterialCommunityIcons name="chevron-right" size={18} color={c.textMuted} />}
      </TouchableOpacity>
    );
  }

  // ─── Panels ─────────────────────────────────────────────────────────────────

  function MainPanel() {
    const connectLabel = isFullyConnected
      ? t('home.profileActionsUpdateCircles')
      : isPendingConfirmation
        ? t('home.profileActionsConfirmConnection')
        : isConnected
          ? t('home.profileActionsConnectionPending')
          : t('home.profileActionsConnect');

    const connectSublabel = isFullyConnected
      ? t('home.profileActionsUpdateCirclesSub')
      : isPendingConfirmation
        ? t('home.profileActionsConfirmConnectionSub')
        : isConnected
          ? t('home.profileActionsConnectionPendingSub')
          : t('home.profileActionsConnectSub');

    const connectIcon = isFullyConnected ? 'account-edit' : isPendingConfirmation ? 'account-check' : isConnected ? 'account-clock' : 'account-multiple-plus';

    return (
      <>
        <PanelHeader title={`@${username}`} />

        <MenuItem
          icon="playlist-plus"
          label={t('home.profileActionsAddToList')}
          sublabel={t('home.profileActionsAddToListSub')}
          onPress={() => setPanel('lists')}
        />

        <MenuItem
          icon={connectIcon}
          label={connectLabel}
          sublabel={connectSublabel}
          onPress={() => !isConnected || isFullyConnected || isPendingConfirmation ? setPanel('circles') : undefined}
          disabled={isConnected && !isFullyConnected && !isPendingConfirmation}
        />

        {isFullyConnected || isConnected ? (
          confirmDisconnect ? (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              paddingHorizontal: 20, paddingVertical: 14,
              borderBottomWidth: 1, borderBottomColor: c.border,
            }}>
              <Text style={{ flex: 1, fontSize: 14, color: c.textPrimary }}>
                {t('home.profileActionsDisconnectConfirm', { username })}
              </Text>
              <TouchableOpacity
                onPress={() => { onDisconnect(); onClose(); }}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: c.errorText }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#fff' }}>{t('home.profileActionsDisconnect')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setConfirmDisconnect(false)}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: c.inputBackground }}
              >
                <Text style={{ fontSize: 13, color: c.textSecondary }}>{t('home.cancelAction')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <MenuItem
              icon="account-remove"
              label={t('home.profileActionsDisconnect')}
              sublabel={t('home.profileActionsDisconnectSub')}
              danger
              onPress={() => setConfirmDisconnect(true)}
              rightContent={<View />}
            />
          )
        ) : null}

        <View style={{ height: 6, backgroundColor: c.inputBackground }} />

        {confirmBlock ? (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            paddingHorizontal: 20, paddingVertical: 14,
            borderBottomWidth: 1, borderBottomColor: c.border,
          }}>
            <Text style={{ flex: 1, fontSize: 14, color: c.textPrimary }}>
              {t('home.profileActionsBlockConfirm', { username })}
            </Text>
            <TouchableOpacity
              onPress={() => { onBlock(); onClose(); }}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: c.errorText }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#fff' }}>{t('home.profileActionsBlock')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setConfirmBlock(false)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: c.inputBackground }}
            >
              <Text style={{ fontSize: 13, color: c.textSecondary }}>{t('home.cancelAction')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <MenuItem
            icon="block-helper"
            label={t('home.profileActionsBlockUser')}
            sublabel={t('home.profileActionsBlockUserSub')}
            danger
            onPress={() => setConfirmBlock(true)}
            rightContent={<View />}
          />
        )}

        <MenuItem
          icon="flag-outline"
          label={t('home.profileActionsReportUser')}
          sublabel={t('home.profileActionsReportUserSub')}
          danger
          onPress={() => setPanel('report')}
        />
      </>
    );
  }

  function ListsPanel() {
    return (
      <>
        <PanelHeader title={t('home.profileActionsAddToList')} onBack={() => setPanel('main')} />
        <ScrollView style={{ flex: 1 }}>
          {userLists.length === 0 && !createListMode ? (
            <Text style={{ padding: 20, textAlign: 'center', color: c.textMuted, fontSize: 14 }}>
              {t('home.profileActionsListsEmpty')}
            </Text>
          ) : null}

          {userLists.map((list) => {
            const alreadyAdded = addedListIds.includes(list.id);
            const isLoading = listActionLoadingId === list.id;
            return (
              <View key={`list-${list.id}`} style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                paddingHorizontal: 20, paddingVertical: 13,
                borderBottomWidth: 1, borderBottomColor: c.border,
              }}>
                <MaterialCommunityIcons name="playlist-check" size={20} color={c.textSecondary} />
                <Text style={{ flex: 1, fontSize: 15, color: c.textPrimary }}>{list.name}</Text>
                <Text style={{ fontSize: 12, color: c.textMuted, marginRight: 8 }}>
                  {t('home.profileActionsListMember', { count: list.follows_count })}
                </Text>
                {isLoading ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : alreadyAdded ? (
                  <MaterialCommunityIcons name="check-circle" size={22} color={c.primary} />
                ) : (
                  <TouchableOpacity
                    onPress={() => handleAddToList(list.id)}
                    style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, backgroundColor: c.primary }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#fff' }}>{t('home.profileActionsListAdd')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          {createListMode ? (
            <View style={{ padding: 16, gap: 12, borderTopWidth: 1, borderTopColor: c.border }}>
              <TextInput
                value={newListName}
                onChangeText={setNewListName}
                placeholder={t('home.profileActionsListNamePlaceholder')}
                placeholderTextColor={c.textMuted}
                style={{
                  borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 9,
                  fontSize: 14, color: c.textPrimary, backgroundColor: c.inputBackground,
                }}
                autoFocus
              />
              {/* Emoji picker */}
              {emojiGroupsLoading ? (
                <ActivityIndicator size="small" color={c.primary} />
              ) : emojiGroups.length > 0 ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 12, color: c.textMuted }}>{t('home.profileActionsListChooseIcon')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {emojiGroups.flatMap((g) => g.emojis || []).slice(0, 30).map((emoji) => (
                        <TouchableOpacity
                          key={`emoji-${emoji.id}`}
                          onPress={() => setSelectedEmojiId(emoji.id)}
                          style={{
                            width: 38, height: 38, borderRadius: 10,
                            alignItems: 'center', justifyContent: 'center',
                            backgroundColor: selectedEmojiId === emoji.id ? c.primary + '22' : c.inputBackground,
                            borderWidth: selectedEmojiId === emoji.id ? 2 : 1,
                            borderColor: selectedEmojiId === emoji.id ? c.primary : c.border,
                          }}
                        >
                          {emoji.image
                            ? <View style={{ width: 24, height: 24 }}><RNImage source={{ uri: emoji.image }} style={{ width: 24, height: 24 }} resizeMode="contain" /></View>
                            : <Text style={{ fontSize: 13, color: c.textSecondary }}>{emoji.keyword?.[0]?.toUpperCase() || '?'}</Text>
                          }
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={handleCreateList}
                  disabled={!newListName.trim() || !selectedEmojiId || createListLoading}
                  style={{
                    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10,
                    backgroundColor: (!newListName.trim() || !selectedEmojiId) ? c.inputBackground : c.primary,
                  }}
                >
                  {createListLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={{ fontSize: 14, fontWeight: '600', color: (!newListName.trim() || !selectedEmojiId) ? c.textMuted : '#fff' }}>{t('home.profileActionsListCreateAndAdd')}</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setCreateListMode(false); setNewListName(''); }}
                  style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: c.inputBackground }}
                >
                  <Text style={{ fontSize: 14, color: c.textSecondary }}>{t('home.cancelAction')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={openCreateListMode}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingHorizontal: 20, paddingVertical: 14,
              }}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={20} color={c.primary} />
              <Text style={{ fontSize: 15, color: c.primary, fontWeight: '500' }}>{t('home.profileActionsListCreateNew')}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </>
    );
  }

  function CirclesPanel() {
    const isUpdate = isFullyConnected;
    const isConfirm = isPendingConfirmation;
    const title = isUpdate ? t('home.profileActionsCirclesUpdate') : isConfirm ? t('home.profileActionsCirclesConfirm') : t('home.profileActionsConnect');
    const sublabel = isUpdate
      ? t('home.profileActionsCirclesUpdateSub')
      : isConfirm
        ? t('home.profileActionsCirclesConfirmSub')
        : t('home.profileActionsCirclesConnectSub');

    return (
      <>
        <PanelHeader title={title} onBack={() => setPanel('main')} />
        <Text style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, fontSize: 13, color: c.textMuted }}>
          {sublabel}
        </Text>
        <ScrollView style={{ flex: 1 }}>
          {userCircles.map((circle) => {
            const selected = selectedCircleIds.includes(circle.id);
            const isConnectionsCircle = (circle.name || '').toLowerCase() === 'connections';
            return (
              <TouchableOpacity
                key={`circle-${circle.id}`}
                onPress={() => !isConnectionsCircle && toggleCircle(circle.id)}
                activeOpacity={isConnectionsCircle ? 1 : 0.75}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingHorizontal: 20, paddingVertical: 13,
                  borderBottomWidth: 1, borderBottomColor: c.border,
                }}
              >
                <View style={{
                  width: 18, height: 18, borderRadius: 9,
                  backgroundColor: circle.color || c.primary,
                  borderWidth: selected ? 0 : 2,
                  borderColor: c.border,
                }} />
                <Text style={{ flex: 1, fontSize: 15, color: c.textPrimary }}>{circle.name}</Text>
                {isConnectionsCircle
                  ? <Text style={{ fontSize: 12, color: c.textMuted }}>{t('home.profileActionsCircleAlwaysIncluded')}</Text>
                  : selected
                    ? <MaterialCommunityIcons name="checkbox-marked-circle" size={22} color={c.primary} />
                    : <MaterialCommunityIcons name="checkbox-blank-circle-outline" size={22} color={c.textMuted} />
                }
              </TouchableOpacity>
            );
          })}

          {createCircleMode ? (
            <View style={{ padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: c.border }}>
              <TextInput
                value={newCircleName}
                onChangeText={setNewCircleName}
                placeholder={t('home.profileActionsCircleNamePlaceholder')}
                placeholderTextColor={c.textMuted}
                style={{
                  borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 9,
                  fontSize: 14, color: c.textPrimary, backgroundColor: c.inputBackground,
                }}
                autoFocus
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {PRESET_COLORS.map((col) => (
                  <TouchableOpacity
                    key={col}
                    onPress={() => setNewCircleColor(col)}
                    style={{
                      width: 28, height: 28, borderRadius: 14,
                      backgroundColor: col,
                      borderWidth: newCircleColor === col ? 3 : 0,
                      borderColor: c.textPrimary,
                    }}
                  />
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={handleCreateCircle}
                  disabled={!newCircleName.trim() || createCircleLoading}
                  style={{
                    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10,
                    backgroundColor: !newCircleName.trim() ? c.inputBackground : c.primary,
                  }}
                >
                  {createCircleLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={{ fontSize: 14, fontWeight: '600', color: !newCircleName.trim() ? c.textMuted : '#fff' }}>{t('home.profileActionsCircleCreate')}</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setCreateCircleMode(false); setNewCircleName(''); }}
                  style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: c.inputBackground }}
                >
                  <Text style={{ fontSize: 14, color: c.textSecondary }}>{t('home.cancelAction')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setCreateCircleMode(true)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingHorizontal: 20, paddingVertical: 14,
              }}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={20} color={c.primary} />
              <Text style={{ fontSize: 15, color: c.primary, fontWeight: '500' }}>{t('home.profileActionsCircleCreateNew')}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: c.border }}>
          <TouchableOpacity
            onPress={handleCirclesConfirm}
            disabled={selectedCircleIds.length === 0 || actionLoading}
            style={{
              alignItems: 'center', paddingVertical: 12, borderRadius: 12,
              backgroundColor: selectedCircleIds.length === 0 ? c.inputBackground : c.primary,
            }}
          >
            {actionLoading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={{ fontSize: 15, fontWeight: '700', color: selectedCircleIds.length === 0 ? c.textMuted : '#fff' }}>
                  {isUpdate ? t('home.profileActionsCircleUpdate') : isConfirm ? t('home.profileActionsCircleConfirmBtn') : t('home.profileActionsCircleSendRequest')}
                </Text>
            }
          </TouchableOpacity>
        </View>
      </>
    );
  }

  function ReportPanel() {
    return (
      <>
        <PanelHeader title={t('home.profileActionsReportTitle', { username })} onBack={() => setPanel('main')} />
        <Text style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, fontSize: 13, color: c.textMuted }}>
          {t('home.profileActionsReportPrompt')}
        </Text>
        <ScrollView style={{ flex: 1 }}>
          {moderationCategories.map((cat) => {
            const selected = reportCategoryId === cat.id;
            return (
              <TouchableOpacity
                key={`report-cat-${cat.id}`}
                onPress={() => setReportCategoryId(cat.id)}
                activeOpacity={0.75}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  paddingHorizontal: 20, paddingVertical: 13,
                  borderBottomWidth: 1, borderBottomColor: c.border,
                  backgroundColor: selected ? c.primary + '12' : 'transparent',
                }}
              >
                <MaterialCommunityIcons
                  name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                  size={20}
                  color={selected ? c.primary : c.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: selected ? '600' : '400', color: c.textPrimary }}>
                    {resolveCategoryTitle(cat, t)}
                  </Text>
                  {resolveCategoryDescription(cat, t) ? (
                    <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 1 }}>{resolveCategoryDescription(cat, t)}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}

          <View style={{ padding: 16 }}>
            <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 6 }}>
              {t('home.profileActionsReportDetailsLabel')}
            </Text>
            <TextInput
              value={reportDescription}
              onChangeText={setReportDescription}
              placeholder={t('home.profileActionsReportDetailsPlaceholder')}
              placeholderTextColor={c.textMuted}
              multiline
              numberOfLines={3}
              maxLength={500}
              style={{
                borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 9,
                fontSize: 14, color: c.textPrimary, backgroundColor: c.inputBackground,
                minHeight: 72, textAlignVertical: 'top',
              }}
            />
          </View>
        </ScrollView>

        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: c.border }}>
          <TouchableOpacity
            onPress={handleReport}
            disabled={!reportCategoryId}
            style={{
              alignItems: 'center', paddingVertical: 12, borderRadius: 12,
              backgroundColor: !reportCategoryId ? c.inputBackground : c.errorText,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: !reportCategoryId ? c.textMuted : '#fff' }}>
              {t('home.profileActionsReportSubmit')}
            </Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

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
          position: 'absolute', top: 0, right: 0, bottom: 0,
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
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {panel === 'main' && <MainPanel />}
          {panel === 'lists' && <ListsPanel />}
          {panel === 'circles' && <CirclesPanel />}
          {panel === 'report' && <ReportPanel />}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}
