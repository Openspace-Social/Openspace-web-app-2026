/**
 * EditProfileModal — sheet-style modal for editing the logged-in user's
 * display name, bio, location, and URL.
 *
 * Fields:
 *   - name (display name)
 *   - bio
 *   - location
 *   - url
 *
 * Avatar / cover changes happen elsewhere (camera-overlay buttons on the
 * profile header). This modal is text-only.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  visible: boolean;
  onClose: () => void;
  initial: {
    name?: string;
    bio?: string;
    location?: string;
    url?: string;
  };
  onSave: (next: {
    name: string;
    bio: string;
    location: string;
    url: string;
  }) => Promise<void> | void;
};

export default function EditProfileModal({ visible, onClose, initial, onSave }: Props) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setName(initial.name || '');
      setBio(initial.bio || '');
      setLocation(initial.location || '');
      setUrl(initial.url || '');
      setError('');
    }
  }, [visible, initial.name, initial.bio, initial.location, initial.url]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        bio: bio.trim(),
        location: location.trim(),
        url: url.trim(),
      });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: c.surface,
            paddingTop: insets.top,
            paddingBottom: insets.bottom + 14,
          },
        ]}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kbv}
        >
          <View style={styles.sheetInner}>
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              <Text style={[styles.title, { color: c.textPrimary }]}>
                {t('home.profileEditProfileAction', { defaultValue: 'Edit profile' })}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                disabled={saving}
              >
                <MaterialCommunityIcons name="close" size={22} color={c.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Field
                c={c}
                label={t('home.profileEditNameLabel', { defaultValue: 'Display name' })}
                value={name}
                onChangeText={setName}
                placeholder={t('home.profileEditNamePlaceholder', { defaultValue: 'Your name' })}
                maxLength={64}
              />
              <Field
                c={c}
                label={t('home.profileEditBioLabel', { defaultValue: 'Bio' })}
                value={bio}
                onChangeText={setBio}
                placeholder={t('home.profileEditBioPlaceholder', { defaultValue: 'A few words about you' })}
                multiline
                maxLength={500}
                numberOfLines={6}
              />
              <Field
                c={c}
                label={t('home.profileEditLocationLabel', { defaultValue: 'Location' })}
                value={location}
                onChangeText={setLocation}
                placeholder={t('home.profileEditLocationPlaceholder', { defaultValue: 'Where you are' })}
                maxLength={64}
              />
              <Field
                c={c}
                label={t('home.profileEditUrlLabel', { defaultValue: 'Website' })}
                value={url}
                onChangeText={setUrl}
                placeholder={t('home.profileEditUrlPlaceholder', { defaultValue: 'https://example.com' })}
                autoCapitalize="none"
                keyboardType="url"
                maxLength={200}
              />

              {error ? (
                <Text style={[styles.errorText, { color: c.errorText }]}>{error}</Text>
              ) : null}
            </ScrollView>

            <View style={[styles.footer, { borderTopColor: c.border }]}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                activeOpacity={0.85}
                onPress={onClose}
                disabled={saving}
              >
                <Text style={[styles.cancelText, { color: c.textPrimary }]}>
                  {t('home.cancelAction', { defaultValue: 'Cancel' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: c.primary }]}
                activeOpacity={0.85}
                onPress={() => { void handleSave(); }}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveText}>
                    {t('home.profileEditSaveAction', { defaultValue: 'Save' })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Field({
  c,
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  maxLength,
  numberOfLines,
  autoCapitalize,
  keyboardType,
}: {
  c: any;
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  numberOfLines?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'url' | 'email-address';
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { borderColor: c.border, color: c.textPrimary, backgroundColor: c.inputBackground },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        multiline={multiline}
        numberOfLines={multiline ? numberOfLines || 3 : undefined}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
      />
      {maxLength ? (
        <Text style={[styles.counter, { color: c.textMuted }]}>
          {value.length}/{maxLength}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  kbv: { flex: 1 },
  sheet: {
    flex: 1,
  },
  sheetInner: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontWeight: '700' },
  scrollContent: { padding: 16, gap: 12 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 42,
  },
  inputMultiline: {
    minHeight: 140,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  counter: { fontSize: 11, alignSelf: 'flex-end' },
  errorText: { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderTopWidth: 1,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600' },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
