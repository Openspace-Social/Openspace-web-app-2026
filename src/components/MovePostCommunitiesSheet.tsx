/**
 * MovePostCommunitiesSheet — native bottom-sheet for changing the
 * communities a post is shared to. Mirrors the web "Change communities"
 * drawer from HomeScreen.tsx but rendered as a slide-up modal.
 *
 * The parent owns the active post + the API call (`api.updatePostTargets`)
 * and any feed-state patching; this component just handles UI: search,
 * selection (max 3), save / cancel.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SearchCommunityResult } from '../api/client';

const MAX = 3;

type Props = {
  visible: boolean;
  c: any;
  t: (key: string, options?: any) => string;
  joined: SearchCommunityResult[];
  joinedLoading: boolean;
  selectedNames: string[];
  submitting: boolean;
  onToggle: (name: string) => void;
  onClose: () => void;
  onSave: () => void;
};

export default function MovePostCommunitiesSheet({
  visible,
  c,
  t,
  joined,
  joinedLoading,
  selectedNames,
  submitting,
  onToggle,
  onClose,
  onSave,
}: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return joined;
    return joined.filter((com) => {
      const n = (com.name || '').toLowerCase();
      const ti = (com.title || '').toLowerCase();
      return n.includes(q) || ti.includes(q);
    });
  }, [joined, search]);

  const selectedSet = useMemo(() => new Set(selectedNames.map((n) => n.toLowerCase())), [selectedNames]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.textPrimary }]}>
                {t('home.movePostCommunitiesTitle', { defaultValue: 'Change communities' })}
              </Text>
              <Text style={[styles.subtitle, { color: c.textMuted }]}>
                {t('home.movePostCommunitiesHint', { defaultValue: 'Select up to 3 communities.' })}{` ${selectedNames.length}/${MAX}`}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialCommunityIcons name="close" size={20} color={c.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={[styles.searchRow, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
            <MaterialCommunityIcons name="magnify" size={16} color={c.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('home.movePostCommunitiesSearchPlaceholder', { defaultValue: 'Search communities…' })}
              placeholderTextColor={c.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.searchInput, { color: c.textPrimary }]}
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialCommunityIcons name="close-circle" size={16} color={c.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }} keyboardShouldPersistTaps="handled">
            {joinedLoading ? (
              <ActivityIndicator color={c.primary} size="small" style={{ marginTop: 16 }} />
            ) : filtered.length === 0 ? (
              <Text style={[styles.empty, { color: c.textMuted }]}>
                {search
                  ? t('home.movePostCommunitiesNoMatches', { defaultValue: 'No communities match that search.' })
                  : t('home.movePostCommunitiesNoJoined', { defaultValue: "You haven't joined any communities yet." })}
              </Text>
            ) : (
              filtered.map((com) => {
                const name = (com.name || '').trim();
                const selected = name ? selectedSet.has(name.toLowerCase()) : false;
                const blocked = !selected && selectedNames.length >= MAX;
                return (
                  <TouchableOpacity
                    key={`move-com-${com.id}`}
                    style={[
                      styles.row,
                      {
                        borderColor: c.border,
                        backgroundColor: selected ? `${c.primary}18` : c.inputBackground,
                        opacity: blocked ? 0.55 : 1,
                      },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => { if (name && !blocked) onToggle(name); }}
                  >
                    <View style={[styles.avatar, { backgroundColor: com.color || c.primary }]}>
                      {com.avatar ? (
                        <Image source={{ uri: com.avatar }} style={styles.avatarImage} resizeMode="cover" />
                      ) : (
                        <Text style={styles.avatarLetter}>{(com.title?.[0] || com.name?.[0] || 'C').toUpperCase()}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>
                        {com.title || name}
                      </Text>
                      <Text style={[styles.rowSub, { color: c.textMuted }]} numberOfLines={1}>{`c/${name}`}</Text>
                    </View>
                    <MaterialCommunityIcons
                      name={selected ? 'check-circle' : 'circle-outline'}
                      size={20}
                      color={selected ? c.primary : c.textMuted}
                    />
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: c.border }]}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: c.border }]}
              activeOpacity={0.85}
              onPress={onClose}
              disabled={submitting}
            >
              <Text style={[styles.cancelBtnText, { color: c.textPrimary }]}>
                {t('home.movePostCommunitiesCancel', { defaultValue: 'Cancel' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.saveBtn,
                {
                  backgroundColor: selectedNames.length === 0 || submitting ? c.border : c.primary,
                  opacity: selectedNames.length === 0 || submitting ? 0.7 : 1,
                },
              ]}
              activeOpacity={0.85}
              onPress={onSave}
              disabled={submitting || selectedNames.length === 0}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {t('home.movePostCommunitiesSave', { defaultValue: 'Save' })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    height: '85%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  handle: { width: 44, height: 5, borderRadius: 999, alignSelf: 'center', marginTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 10,
  },
  title: { fontSize: 16, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 2, fontWeight: '600' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImage: { width: 36, height: 36 },
  avatarLetter: { color: '#fff', fontWeight: '800', fontSize: 14 },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 12, marginTop: 2 },
  empty: { padding: 24, textAlign: 'center', fontSize: 14 },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1 },
  cancelBtn: {
    flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontWeight: '700', fontSize: 15 },
  saveBtn: { flex: 2, borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
