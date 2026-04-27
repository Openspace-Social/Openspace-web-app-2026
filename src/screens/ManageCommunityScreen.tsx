/**
 * ManageCommunityScreen — native-only screen for editing a community's
 * details (title, name, accent color, description, rules) plus avatar and
 * cover image. Mirrors the "details" panel of CommunityManagementDrawer
 * (web), without touching that web drawer.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api, SearchCommunityResult } from '../api/client';

type Props = {
  token: string;
  communityName: string;
  c: any;
  t: (key: string, options?: any) => string;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
};

export default function ManageCommunityScreen({ token, communityName, c, t, onNotice, onError }: Props) {
  const s = useMemo(() => makeStyles(c), [c]);

  const [loading, setLoading] = useState(true);
  const [community, setCommunity] = useState<SearchCommunityResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [coverSaving, setCoverSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');

  const applyCommunity = useCallback((next: SearchCommunityResult) => {
    setCommunity(next);
    setTitle(next.title || '');
    setName(next.name || '');
    setColor(next.color || '');
    setDescription(next.description || '');
    setRules(next.rules || '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await api.getCommunity(token, communityName);
      applyCommunity(fresh);
    } catch (e: any) {
      onError(e?.message || t('community.manageLoadError', { defaultValue: 'Unable to load community.' }));
    } finally {
      setLoading(false);
    }
  }, [token, communityName, applyCommunity, onError, t]);

  useEffect(() => { void load(); }, [load]);

  const handleSaveDetails = useCallback(async () => {
    if (!community || saving) return;
    setSaving(true);
    try {
      const updated = await api.updateCommunity(token, community.name || communityName, {
        title,
        name,
        description,
        rules,
        color,
      });
      applyCommunity(updated);
      onNotice(t('community.detailsUpdated', { defaultValue: 'Community details updated.' }));
    } catch (e: any) {
      onError(e?.message || t('community.detailsUpdateError', { defaultValue: 'Could not update community details.' }));
    } finally {
      setSaving(false);
    }
  }, [community, saving, token, communityName, title, name, description, rules, color, applyCommunity, onNotice, onError, t]);

  const pickAndUpload = useCallback(async (kind: 'avatar' | 'cover') => {
    const setBusy = kind === 'avatar' ? setAvatarSaving : setCoverSaving;
    if ((kind === 'avatar' && avatarSaving) || (kind === 'cover' && coverSaving)) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        onError(t('home.profileImagePickerPermissionDenied', { defaultValue: 'Photo access is needed to upload an image.' }));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: false,
        allowsEditing: true,
        aspect: kind === 'avatar' ? [1, 1] : [16, 9],
        quality: 0.9,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri || !community) return;
      setBusy(true);
      const rnFile = { uri, type: 'image/jpeg', name: kind === 'avatar' ? 'community-avatar.jpg' : 'community-cover.jpg' } as any;
      const targetName = community.name || communityName;
      const updated = kind === 'avatar'
        ? await api.updateCommunityAvatar(token, targetName, rnFile)
        : await api.updateCommunityCover(token, targetName, rnFile);
      applyCommunity(updated);
      onNotice(kind === 'avatar'
        ? t('community.avatarUpdated', { defaultValue: 'Avatar updated.' })
        : t('community.coverUpdated', { defaultValue: 'Cover updated.' }));
    } catch (e: any) {
      onError(e?.message || t('home.profileImagePickerFailed', { defaultValue: 'Could not upload image.' }));
    } finally {
      setBusy(false);
    }
  }, [avatarSaving, coverSaving, community, token, communityName, applyCommunity, onNotice, onError, t]);

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
        <Text style={[s.emptyText, { color: c.textMuted }]}>
          {t('community.manageLoadError', { defaultValue: 'Unable to load community.' })}
        </Text>
      </View>
    );
  }

  const accent = color || c.primary;
  const initial = (community.title?.[0] || community.name?.[0] || 'C').toUpperCase();

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[s.coverWrap, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
          {community.cover ? (
            <Image source={{ uri: community.cover }} style={s.coverImage} resizeMode="cover" />
          ) : (
            <View style={[s.coverPlaceholder, { backgroundColor: accent }]} />
          )}
          <TouchableOpacity
            style={[s.coverButton, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
            activeOpacity={0.85}
            onPress={() => void pickAndUpload('cover')}
            disabled={coverSaving}
          >
            {coverSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="camera-outline" size={16} color="#fff" />
                <Text style={s.coverButtonText}>
                  {t('community.updateCover', { defaultValue: 'Update cover' })}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={s.avatarRow}>
          <View style={[s.avatarWrap, { borderColor: c.background, backgroundColor: accent }]}>
            {community.avatar ? (
              <Image source={{ uri: community.avatar }} style={s.avatarImage} resizeMode="cover" />
            ) : (
              <Text style={s.avatarInitial}>{initial}</Text>
            )}
          </View>
          <TouchableOpacity
            style={[s.avatarButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            activeOpacity={0.85}
            onPress={() => void pickAndUpload('avatar')}
            disabled={avatarSaving}
          >
            {avatarSaving ? (
              <ActivityIndicator size="small" color={c.primary} />
            ) : (
              <>
                <MaterialCommunityIcons name="image-edit-outline" size={16} color={c.textPrimary} />
                <Text style={[s.avatarButtonText, { color: c.textPrimary }]}>
                  {t('community.updateAvatar', { defaultValue: 'Update avatar' })}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={s.formColumn}>
          <Field
            c={c}
            label={t('community.titleLabel', { defaultValue: 'Title' })}
            hint={t('community.titleHint', { defaultValue: 'The display name shown at the top of your community page.' })}
          >
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={t('community.titlePlaceholder', { defaultValue: 'e.g. Photography Enthusiasts' })}
              placeholderTextColor={c.textMuted}
              style={[s.input, { color: c.textPrimary, borderColor: c.inputBorder, backgroundColor: c.inputBackground }]}
            />
          </Field>

          <Field
            c={c}
            label={t('community.nameLabel', { defaultValue: 'Name' })}
            hint={t('community.nameHint', { defaultValue: 'The unique URL-safe identifier for your community (letters, numbers, hyphens). Used in links.' })}
          >
            <TextInput
              value={name}
              onChangeText={setName}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t('community.namePlaceholder', { defaultValue: 'e.g. photography-enthusiasts' })}
              placeholderTextColor={c.textMuted}
              style={[s.input, { color: c.textPrimary, borderColor: c.inputBorder, backgroundColor: c.inputBackground }]}
            />
          </Field>

          <Field
            c={c}
            label={t('community.colorLabel', { defaultValue: 'Accent color' })}
            hint={t('community.colorHint', { defaultValue: 'A hex color used to brand your community header and highlights.' })}
          >
            <View style={s.colorRow}>
              <TextInput
                value={color}
                onChangeText={setColor}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('community.colorPlaceholder', { defaultValue: 'e.g. #22C55E' })}
                placeholderTextColor={c.textMuted}
                style={[s.input, { flex: 1, color: c.textPrimary, borderColor: c.inputBorder, backgroundColor: c.inputBackground }]}
              />
              <View style={[s.colorSwatch, { backgroundColor: accent, borderColor: c.border }]} />
            </View>
          </Field>

          <Field
            c={c}
            label={t('community.descriptionLabel', { defaultValue: 'Description' })}
            hint={t('community.descriptionHint', { defaultValue: 'A short summary of what your community is about. Shown on the community profile.' })}
          >
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              placeholder={t('community.descriptionPlaceholder', { defaultValue: 'Tell people what this community is about…' })}
              placeholderTextColor={c.textMuted}
              style={[s.input, s.multiline, { color: c.textPrimary, borderColor: c.inputBorder, backgroundColor: c.inputBackground }]}
            />
          </Field>

          <Field
            c={c}
            label={t('community.rulesLabel', { defaultValue: 'Rules' })}
            hint={t('community.rulesHint', { defaultValue: 'Community guidelines members are expected to follow. Displayed on the community page.' })}
          >
            <TextInput
              value={rules}
              onChangeText={setRules}
              multiline
              numberOfLines={4}
              placeholder={t('community.rulesPlaceholder', { defaultValue: 'e.g. Be respectful. No spam. Stay on topic.' })}
              placeholderTextColor={c.textMuted}
              style={[s.input, s.multiline, { color: c.textPrimary, borderColor: c.inputBorder, backgroundColor: c.inputBackground }]}
            />
          </Field>

          <TouchableOpacity
            style={[s.saveButton, { backgroundColor: c.primary, opacity: saving ? 0.7 : 1 }]}
            activeOpacity={0.88}
            onPress={() => void handleSaveDetails()}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <MaterialCommunityIcons name="content-save-outline" size={16} color="#fff" />
                <Text style={s.saveButtonText}>
                  {t('community.saveAction', { defaultValue: 'Save details' })}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ c, label, hint, children }: { c: any; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </Text>
      {hint ? <Text style={{ fontSize: 12, color: c.textMuted, lineHeight: 16 }}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const makeStyles = (c: any) =>
  StyleSheet.create({
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    scrollContent: { paddingBottom: 140 },
    coverWrap: {
      height: 160,
      width: '100%',
      borderBottomWidth: 1,
      overflow: 'hidden',
    },
    coverImage: { width: '100%', height: '100%' },
    coverPlaceholder: { width: '100%', height: '100%', opacity: 0.4 },
    coverButton: {
      position: 'absolute',
      right: 12,
      bottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
    },
    coverButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    avatarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 16,
      marginTop: -36,
      marginBottom: 4,
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
    avatarInitial: { color: '#fff', fontWeight: '900', fontSize: 32 },
    avatarButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      height: 38,
      marginTop: 32,
    },
    avatarButtonText: { fontWeight: '700', fontSize: 13 },
    formColumn: {
      paddingHorizontal: 16,
      paddingTop: 16,
      gap: 16,
    },
    input: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    multiline: { minHeight: 96, textAlignVertical: 'top', paddingTop: 10 },
    colorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    colorSwatch: { width: 38, height: 38, borderRadius: 10, borderWidth: 1 },
    saveButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 46,
      borderRadius: 12,
      marginTop: 4,
    },
    saveButtonText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    emptyText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  });
