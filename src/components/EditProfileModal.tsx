/**
 * EditProfileModal — sheet-style modal for editing the logged-in user's
 * profile.
 *
 * Fields:
 *   - name (display name), bio, location, url
 *   - followersCountVisible — show/hide the followers count on the profile
 *   - communityPostsVisible — show/hide community posts on the profile
 *   - profileVisibility ('P' Public / 'O' Openspace-only / 'T' Private)
 *
 * Avatar / cover changes happen elsewhere (camera-overlay buttons on the
 * profile header).
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';

export type ProfileVisibility = 'P' | 'O' | 'T';

type Props = {
  visible: boolean;
  onClose: () => void;
  initial: {
    name?: string;
    bio?: string;
    location?: string;
    url?: string;
    followersCountVisible?: boolean;
    communityPostsVisible?: boolean;
    profileVisibility?: ProfileVisibility;
  };
  onSave: (next: {
    name: string;
    bio: string;
    location: string;
    url: string;
    followersCountVisible: boolean;
    communityPostsVisible: boolean;
    profileVisibility: ProfileVisibility;
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
  const [followersCountVisible, setFollowersCountVisible] = useState(true);
  const [communityPostsVisible, setCommunityPostsVisible] = useState(true);
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>('P');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setName(initial.name || '');
      setBio(initial.bio || '');
      setLocation(initial.location || '');
      setUrl(initial.url || '');
      setFollowersCountVisible(initial.followersCountVisible !== false);
      setCommunityPostsVisible(initial.communityPostsVisible !== false);
      setProfileVisibility(
        initial.profileVisibility === 'O' || initial.profileVisibility === 'T'
          ? initial.profileVisibility
          : 'P',
      );
      setError('');
    }
  }, [
    visible,
    initial.name,
    initial.bio,
    initial.location,
    initial.url,
    initial.followersCountVisible,
    initial.communityPostsVisible,
    initial.profileVisibility,
  ]);

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
        followersCountVisible,
        communityPostsVisible,
        profileVisibility,
      });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  const visibilityOptions: Array<{
    value: ProfileVisibility;
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    title: string;
    subtitle: string;
  }> = [
    {
      value: 'P',
      icon: 'earth',
      title: t('home.profileVisibilityPublicTitle', { defaultValue: 'Public' }),
      subtitle: t('home.profileVisibilityPublicSubtitle', {
        defaultValue: 'Everyone on the internet can see your profile.',
      }),
    },
    {
      value: 'O',
      icon: 'account-group-outline',
      title: t('home.profileVisibilityOkunaTitle', { defaultValue: 'Openspace' }),
      subtitle: t('home.profileVisibilityOkunaSubtitle', {
        defaultValue: 'Only members of Openspace can see your profile.',
      }),
    },
    {
      value: 'T',
      icon: 'lock-outline',
      title: t('home.profileVisibilityPrivateTitle', { defaultValue: 'Private' }),
      subtitle: t('home.profileVisibilityPrivateSubtitle', {
        defaultValue: 'Only people you approve can see your profile.',
      }),
    },
  ];

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
          // Android no-op fix — see PostDetailModal composer note.
          // 'padding' on both platforms: the sheet sits at flex-end of an
          // overlay backdrop; padding pushes it above the keyboard.
          behavior="padding"
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

              <View style={[styles.sectionDivider, { borderTopColor: c.border }]} />
              <Text style={[styles.sectionHeading, { color: c.textPrimary }]}>
                {t('home.profileEditPrivacySection', { defaultValue: 'Privacy' })}
              </Text>

              <ToggleRow
                c={c}
                title={t('home.profileFollowersCountTitle', { defaultValue: 'Followers count' })}
                subtitle={t('home.profileFollowersCountSubtitle', {
                  defaultValue: 'Show the number of followers on your profile.',
                })}
                value={followersCountVisible}
                onValueChange={setFollowersCountVisible}
              />

              <ToggleRow
                c={c}
                title={t('home.profileCommunityPostsTitle', { defaultValue: 'Community posts' })}
                subtitle={t('home.profileCommunityPostsSubtitle', {
                  defaultValue: 'Display posts you share with public communities, on your profile.',
                })}
                value={communityPostsVisible}
                onValueChange={setCommunityPostsVisible}
              />

              <Text style={[styles.subSectionHeading, { color: c.textSecondary }]}>
                {t('home.profileVisibilityTitle', { defaultValue: 'Visibility' })}
              </Text>
              <Text style={[styles.subSectionHelper, { color: c.textMuted }]}>
                {t('home.profileVisibilitySubtitleSummary', {
                  defaultValue: 'Control who can see your profile.',
                })}
              </Text>
              <View style={styles.visibilityList}>
                {visibilityOptions.map((option) => {
                  const selected = profileVisibility === option.value;
                  return (
                    <Pressable
                      key={`visibility-${option.value}`}
                      style={[
                        styles.visibilityOption,
                        {
                          borderColor: selected ? c.primary : c.border,
                          backgroundColor: selected ? `${c.primary}14` : c.inputBackground,
                        },
                      ]}
                      onPress={() => setProfileVisibility(option.value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                    >
                      <View
                        style={[
                          styles.visibilityIconWrap,
                          { backgroundColor: selected ? `${c.primary}22` : c.surface, borderColor: c.border },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={option.icon}
                          size={20}
                          color={selected ? c.primary : c.textSecondary}
                        />
                      </View>
                      <View style={styles.visibilityText}>
                        <Text style={[styles.visibilityTitle, { color: c.textPrimary }]}>
                          {option.title}
                        </Text>
                        <Text style={[styles.visibilitySubtitle, { color: c.textMuted }]}>
                          {option.subtitle}
                        </Text>
                      </View>
                      <MaterialCommunityIcons
                        name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                        size={20}
                        color={selected ? c.primary : c.textMuted}
                      />
                    </Pressable>
                  );
                })}
              </View>

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

function ToggleRow({
  c,
  title,
  subtitle,
  value,
  onValueChange,
}: {
  c: any;
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  return (
    <View
      style={[
        styles.toggleRow,
        { borderColor: c.border, backgroundColor: c.inputBackground },
      ]}
    >
      <View style={styles.toggleText}>
        <Text style={[styles.toggleTitle, { color: c.textPrimary }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.toggleSubtitle, { color: c.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        thumbColor="#ffffff"
        trackColor={{ false: '#b8c2d3', true: c.primary }}
      />
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
  sectionDivider: {
    borderTopWidth: 1,
    marginTop: 6,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 4,
  },
  subSectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
  },
  subSectionHelper: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: -4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleText: { flex: 1, gap: 2 },
  toggleTitle: { fontSize: 15, fontWeight: '700' },
  toggleSubtitle: { fontSize: 12, lineHeight: 17 },
  visibilityList: {
    gap: 10,
  },
  visibilityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  visibilityIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityText: { flex: 1, gap: 3 },
  visibilityTitle: { fontSize: 14, fontWeight: '700' },
  visibilitySubtitle: { fontSize: 12, lineHeight: 17 },
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
