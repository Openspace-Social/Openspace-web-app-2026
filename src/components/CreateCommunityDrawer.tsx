/**
 * CreateCommunityDrawer.tsx
 *
 * 4-step drawer for creating a new community:
 *   Step 1 — Identity    (name, title, type, color)
 *   Step 2 — Categories  (1–3 from global list)
 *   Step 3 — Details     (description ≥200, rules ≥200, adjectives, avatar, cover)
 *   Step 4 — Similar?    (search for existing similar communities — skipped if none found)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, CommunityCategory, SearchCommunityResult } from '../api/client';

// ─── Constants ────────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  '#6366F1', '#3B82F6', '#22C55E', '#14B8A6',
  '#F59E0B', '#F97316', '#EF4444', '#EC4899',
  '#8B5CF6', '#64748B', '#0EA5E9', '#84CC16',
];

const DESC_MIN = 200;
const DESC_MAX = 500;
const RULES_MIN = 200;
const RULES_MAX = 5000;
const NAME_MAX = 32;
const TITLE_MAX = 32;
const ADJ_MAX = 16;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function isValidHex(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

function blobToUri(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  onClose: () => void;
  onCreated: (community: SearchCommunityResult) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateCommunityDrawer({ visible, token, c, t, onClose, onCreated }: Props) {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(500, width * 0.94);
  const translateX = useRef(new Animated.Value(drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);

  // ── Step ──
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // ── Step 1: Identity ──
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [communityType, setCommunityType] = useState<'P' | 'T'>('P');
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [hexInput, setHexInput] = useState(COLOR_PRESETS[0]);
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null);
  const [nameChecking, setNameChecking] = useState(false);
  const nameCheckSeq = useRef(0);

  // ── Step 2: Categories ──
  const [allCategories, setAllCategories] = useState<CommunityCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // ── Step 3: Details ──
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [userAdj, setUserAdj] = useState('');
  const [usersAdj, setUsersAdj] = useState('');
  const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);
  const [coverUri, setCoverUri] = useState<string | null>(null);

  // ── Step 4: Similar communities ──
  const [similarCommunities, setSimilarCommunities] = useState<SearchCommunityResult[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);

  // ── Submit ──
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // ─── Animation ──────────────────────────────────────────────────────────────

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

  // ─── Reset on open ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!visible) return;
    setStep(1);
    setName('');
    setTitle('');
    setCommunityType('P');
    setColor(COLOR_PRESETS[0]);
    setHexInput(COLOR_PRESETS[0]);
    setNameAvailable(null);
    setNameChecking(false);
    setSelectedCategories([]);
    setDescription('');
    setRules('');
    setUserAdj('');
    setUsersAdj('');
    setAvatarBlob(null);
    setAvatarUri(null);
    setCoverBlob(null);
    setCoverUri(null);
    setSimilarCommunities([]);
    setError('');
  }, [visible]);

  // ─── Load categories when step 2 opens ──────────────────────────────────────

  useEffect(() => {
    if (step !== 2 || allCategories.length > 0) return;
    setCategoriesLoading(true);
    api.getCategories(token)
      .then((cats) => setAllCategories(Array.isArray(cats) ? cats : []))
      .catch(() => setAllCategories([]))
      .finally(() => setCategoriesLoading(false));
  }, [step, allCategories.length, token]);

  // ─── Name availability check (debounced) ────────────────────────────────────

  useEffect(() => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed || trimmed.length < 2) {
      setNameAvailable(null);
      setNameChecking(false);
      return;
    }
    setNameChecking(true);
    setNameAvailable(null);
    const seq = ++nameCheckSeq.current;
    const timer = setTimeout(async () => {
      const available = await api.checkCommunityName(token, trimmed);
      if (nameCheckSeq.current !== seq) return;
      setNameChecking(false);
      setNameAvailable(available);
    }, 420);
    return () => clearTimeout(timer);
  }, [name, token]);

  // ─── Search for similar communities ─────────────────────────────────────────

  const searchSimilar = useCallback(async () => {
    setSimilarLoading(true);
    try {
      const queries = [name.trim(), title.trim()].filter(Boolean);
      const results = await Promise.allSettled(
        queries.map((q) => api.searchCommunities(token, q, 8))
      );
      const merged: SearchCommunityResult[] = [];
      const seen = new Set<string>();
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        for (const item of result.value) {
          const key = (item.name || '').toLowerCase();
          if (!key || seen.has(key) || key === name.trim().toLowerCase()) continue;
          seen.add(key);
          merged.push(item);
        }
      }
      setSimilarCommunities(merged.slice(0, 6));
      return merged.length;
    } catch {
      return 0;
    } finally {
      setSimilarLoading(false);
    }
  }, [name, title, token]);

  // ─── Navigation ─────────────────────────────────────────────────────────────

  async function goNext() {
    setError('');
    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
    } else if (step === 2) {
      if (!validateStep2()) return;
      setStep(3);
    } else if (step === 3) {
      if (!validateStep3()) return;
      // Search for similar communities before possibly showing step 4
      const count = await searchSimilar();
      if (count > 0) {
        setStep(4);
      } else {
        await submitCreate();
      }
    } else if (step === 4) {
      await submitCreate();
    }
  }

  function goBack() {
    setError('');
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(3);
  }

  // ─── Validation ─────────────────────────────────────────────────────────────

  function validateStep1(): boolean {
    const trimName = name.trim();
    if (!trimName) { setError(t('createCommunity.errorNameRequired', { defaultValue: 'Community name is required.' })); return false; }
    if (!/^[a-zA-Z0-9_]+$/.test(trimName)) { setError(t('createCommunity.errorNameChars', { defaultValue: 'Name can only contain letters, numbers and underscores.' })); return false; }
    if (trimName.length < 3) { setError(t('createCommunity.errorNameTooShort', { defaultValue: 'Name must be at least 3 characters.' })); return false; }
    if (nameAvailable === false) { setError(t('createCommunity.errorNameTaken', { defaultValue: 'That name is already taken.' })); return false; }
    if (nameAvailable === null || nameChecking) { setError(t('createCommunity.errorNameChecking', { defaultValue: 'Please wait while we check name availability.' })); return false; }
    if (!title.trim()) { setError(t('createCommunity.errorTitleRequired', { defaultValue: 'Community title is required.' })); return false; }
    if (!isValidHex(color)) { setError(t('createCommunity.errorColorInvalid', { defaultValue: 'Please select or enter a valid color.' })); return false; }
    return true;
  }

  function validateStep2(): boolean {
    if (selectedCategories.length === 0) { setError(t('createCommunity.errorCategoryMin', { defaultValue: 'Please select at least 1 category.' })); return false; }
    return true;
  }

  function validateStep3(): boolean {
    if (description.trim().length < DESC_MIN) {
      setError(t('createCommunity.errorDescriptionMin', { defaultValue: 'Description must be at least {{min}} characters.', min: DESC_MIN }));
      return false;
    }
    if (rules.trim().length < RULES_MIN) {
      setError(t('createCommunity.errorRulesMin', { defaultValue: 'Rules must be at least {{min}} characters.', min: RULES_MIN }));
      return false;
    }
    return true;
  }

  // ─── Submit ──────────────────────────────────────────────────────────────────

  async function submitCreate() {
    setSubmitting(true);
    setError('');
    try {
      const created = await api.createCommunity(token, {
        name: name.trim().toLowerCase(),
        title: title.trim(),
        type: communityType,
        color,
        categories: selectedCategories,
        description: description.trim(),
        rules: rules.trim(),
        user_adjective: userAdj.trim() || undefined,
        users_adjective: usersAdj.trim() || undefined,
        invites_enabled: communityType === 'P' ? true : false,
        avatar: avatarBlob || undefined,
        cover: coverBlob || undefined,
      });
      onCreated(created);
      onClose();
    } catch (e: any) {
      setError(e?.message || t('createCommunity.errorGeneric', { defaultValue: 'Failed to create community. Please try again.' }));
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Image pickers ───────────────────────────────────────────────────────────

  async function pickAvatar() {
    const blob = await pickImageFile('image/*');
    if (!blob) return;
    setAvatarBlob(blob);
    setAvatarUri(await blobToUri(blob));
  }

  async function pickCover() {
    const blob = await pickImageFile('image/*');
    if (!blob) return;
    setCoverBlob(blob);
    setCoverUri(await blobToUri(blob));
  }

  // ─── Color handling ──────────────────────────────────────────────────────────

  function handleHexInput(value: string) {
    setHexInput(value);
    const normalized = value.startsWith('#') ? value : `#${value}`;
    if (isValidHex(normalized)) setColor(normalized);
  }

  function selectPresetColor(preset: string) {
    setColor(preset);
    setHexInput(preset);
  }

  if (!mounted) return null;

  // ─── Render ──────────────────────────────────────────────────────────────────

  const totalSteps = 4;
  const stepLabels = [
    t('createCommunity.step1Label', { defaultValue: 'Identity' }),
    t('createCommunity.step2Label', { defaultValue: 'Categories' }),
    t('createCommunity.step3Label', { defaultValue: 'Details' }),
    t('createCommunity.step4Label', { defaultValue: 'Similar?' }),
  ];

  const nextLabel = step === 3
    ? t('createCommunity.nextCheckSimilar', { defaultValue: 'Continue' })
    : step === 4
      ? t('createCommunity.createAction', { defaultValue: 'Create Community' })
      : t('createCommunity.nextAction', { defaultValue: 'Next' });

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Pressable
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        onPress={onClose}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.45)',
          opacity: backdropOpacity,
        }}
      />
      <Animated.View
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: drawerWidth,
          backgroundColor: c.surface,
          borderLeftWidth: 1,
          borderLeftColor: c.border,
          shadowColor: '#000',
          shadowOffset: { width: -4, height: 0 },
          shadowOpacity: 0.18,
          shadowRadius: 16,
          elevation: 24,
          transform: [{ translateX }],
        }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 24, gap: 20, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            {step > 1 ? (
              <TouchableOpacity
                onPress={goBack}
                style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground }}
              >
                <MaterialCommunityIcons name="arrow-left" size={18} color={c.textSecondary} />
              </TouchableOpacity>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: c.textPrimary }}>
                {t('createCommunity.title', { defaultValue: 'Create a Community' })}
              </Text>
              <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 2 }}>
                {t('createCommunity.stepIndicator', { defaultValue: 'Step {{step}} of {{total}}: {{label}}', step, total: totalSteps, label: stepLabels[step - 1] })}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground }}
            >
              <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Step progress bar */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[1, 2, 3, 4].map((s) => (
              <View
                key={s}
                style={{
                  flex: 1, height: 4, borderRadius: 999,
                  backgroundColor: s <= step ? c.primary : c.border,
                }}
              />
            ))}
          </View>

          {/* ── STEP 1: Identity ─────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <FieldGroup label={t('createCommunity.nameLabel', { defaultValue: 'Community name' })} c={c}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 15, color: c.textMuted, fontWeight: '700' }}>c/</Text>
                  <TextInput
                    value={name}
                    onChangeText={(v) => setName(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={NAME_MAX}
                    placeholder={t('createCommunity.namePlaceholder', { defaultValue: 'my_community' })}
                    placeholderTextColor={c.placeholder}
                    style={[inputStyle(c), { flex: 1 }]}
                  />
                  {nameChecking ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : nameAvailable === true ? (
                    <MaterialCommunityIcons name="check-circle" size={20} color="#22C55E" />
                  ) : nameAvailable === false ? (
                    <MaterialCommunityIcons name="close-circle" size={20} color="#EF4444" />
                  ) : null}
                </View>
                <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 4 }}>
                  {t('createCommunity.nameHint', { defaultValue: 'Letters, numbers and underscores only. Max {{max}} characters.', max: NAME_MAX })}
                </Text>
                {nameAvailable === false && (
                  <Text style={{ fontSize: 12, color: '#EF4444', marginTop: 2, fontWeight: '600' }}>
                    {t('createCommunity.nameTaken', { defaultValue: 'This name is already taken.' })}
                  </Text>
                )}
                {nameAvailable === true && (
                  <Text style={{ fontSize: 12, color: '#22C55E', marginTop: 2, fontWeight: '600' }}>
                    {t('createCommunity.nameAvailable', { defaultValue: 'Name is available!' })}
                  </Text>
                )}
              </FieldGroup>

              <FieldGroup label={t('createCommunity.titleLabel', { defaultValue: 'Display title' })} c={c}>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  maxLength={TITLE_MAX}
                  placeholder={t('createCommunity.titlePlaceholder', { defaultValue: 'My Community' })}
                  placeholderTextColor={c.placeholder}
                  style={inputStyle(c)}
                />
                <CharCount current={title.length} max={TITLE_MAX} c={c} />
              </FieldGroup>

              <FieldGroup label={t('createCommunity.typeLabel', { defaultValue: 'Community type' })} c={c}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {(['P', 'T'] as const).map((typeKey) => {
                    const selected = communityType === typeKey;
                    const label = typeKey === 'P'
                      ? t('createCommunity.typePublic', { defaultValue: 'Public' })
                      : t('createCommunity.typePrivate', { defaultValue: 'Private' });
                    const icon = typeKey === 'P' ? 'earth' : 'lock-outline';
                    return (
                      <TouchableOpacity
                        key={typeKey}
                        onPress={() => setCommunityType(typeKey)}
                        style={{
                          flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
                          borderWidth: 1.5, borderRadius: 12, padding: 12,
                          borderColor: selected ? c.primary : c.border,
                          backgroundColor: selected ? `${c.primary}14` : c.inputBackground,
                        }}
                      >
                        <MaterialCommunityIcons name={icon as any} size={18} color={selected ? c.primary : c.textSecondary} />
                        <Text style={{ fontSize: 14, fontWeight: '700', color: selected ? c.primary : c.textSecondary }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 6, lineHeight: 16 }}>
                  {communityType === 'P'
                    ? t('createCommunity.typePublicHint', { defaultValue: 'Anyone can find and join this community.' })
                    : t('createCommunity.typePrivateHint', { defaultValue: 'Only invited members can join this community.' })}
                </Text>
              </FieldGroup>

              <FieldGroup label={t('createCommunity.colorLabel', { defaultValue: 'Brand color' })} c={c}>
                {/* Swatch grid */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                  {COLOR_PRESETS.map((preset) => (
                    <TouchableOpacity
                      key={preset}
                      onPress={() => selectPresetColor(preset)}
                      style={{
                        width: 36, height: 36, borderRadius: 10,
                        backgroundColor: preset,
                        borderWidth: color === preset ? 3 : 1.5,
                        borderColor: color === preset ? c.textPrimary : 'transparent',
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {color === preset && (
                        <MaterialCommunityIcons name="check" size={16} color="#fff" />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Preview + hex input */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: isValidHex(color) ? color : '#6366F1', borderWidth: 1, borderColor: c.border }} />
                  <TextInput
                    value={hexInput}
                    onChangeText={handleHexInput}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={7}
                    placeholder="#6366F1"
                    placeholderTextColor={c.placeholder}
                    style={[inputStyle(c), { flex: 1 }]}
                  />
                </View>
              </FieldGroup>
            </>
          )}

          {/* ── STEP 2: Categories ───────────────────────────────────────── */}
          {step === 2 && (
            <>
              <Text style={{ fontSize: 14, color: c.textSecondary, lineHeight: 20 }}>
                {t('createCommunity.categoriesHint', { defaultValue: 'Choose 1 to 3 categories that best describe your community. This helps people discover it.' })}
              </Text>
              {categoriesLoading ? (
                <ActivityIndicator color={c.primary} style={{ marginTop: 20 }} />
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
                  {allCategories.map((cat) => {
                    const selected = selectedCategories.includes(cat.name);
                    const disabled = !selected && selectedCategories.length >= 3;
                    return (
                      <TouchableOpacity
                        key={cat.name}
                        disabled={disabled}
                        onPress={() => {
                          setSelectedCategories((prev) =>
                            selected
                              ? prev.filter((n) => n !== cat.name)
                              : [...prev, cat.name]
                          );
                        }}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 6,
                          borderWidth: 1.5, borderRadius: 999,
                          paddingHorizontal: 14, paddingVertical: 8,
                          borderColor: selected ? (cat.color || c.primary) : c.border,
                          backgroundColor: selected ? `${cat.color || c.primary}18` : c.inputBackground,
                          opacity: disabled ? 0.4 : 1,
                        }}
                      >
                        {cat.color && (
                          <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: cat.color }} />
                        )}
                        <Text style={{ fontSize: 14, fontWeight: '700', color: selected ? (cat.color || c.primary) : c.textSecondary }}>
                          {cat.title || cat.name}
                        </Text>
                        {selected && (
                          <MaterialCommunityIcons name="check" size={14} color={cat.color || c.primary} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              <Text style={{ fontSize: 12, color: c.textMuted }}>
                {t('createCommunity.categoriesSelected', { defaultValue: '{{count}} of 3 selected', count: selectedCategories.length })}
              </Text>
            </>
          )}

          {/* ── STEP 3: Details ──────────────────────────────────────────── */}
          {step === 3 && (
            <>
              <FieldGroup label={t('createCommunity.descriptionLabel', { defaultValue: 'Description' })} c={c}>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={5}
                  maxLength={DESC_MAX}
                  placeholder={t('createCommunity.descriptionPlaceholder', { defaultValue: 'What is your community about? What topics are discussed here?' })}
                  placeholderTextColor={c.placeholder}
                  style={[inputStyle(c), { minHeight: 100, textAlignVertical: 'top' }]}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ fontSize: 12, color: description.trim().length >= DESC_MIN ? '#22C55E' : c.textMuted }}>
                    {description.trim().length >= DESC_MIN
                      ? t('createCommunity.minMet', { defaultValue: '✓ Minimum met' })
                      : t('createCommunity.minRequired', { defaultValue: 'Min {{min}} characters', min: DESC_MIN })}
                  </Text>
                  <CharCount current={description.length} max={DESC_MAX} c={c} />
                </View>
              </FieldGroup>

              <FieldGroup label={t('createCommunity.rulesLabel', { defaultValue: 'Community rules' })} c={c}>
                <TextInput
                  value={rules}
                  onChangeText={setRules}
                  multiline
                  numberOfLines={6}
                  maxLength={RULES_MAX}
                  placeholder={t('createCommunity.rulesPlaceholder', { defaultValue: 'What are the rules members must follow? Be clear and specific.' })}
                  placeholderTextColor={c.placeholder}
                  style={[inputStyle(c), { minHeight: 120, textAlignVertical: 'top' }]}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ fontSize: 12, color: rules.trim().length >= RULES_MIN ? '#22C55E' : c.textMuted }}>
                    {rules.trim().length >= RULES_MIN
                      ? t('createCommunity.minMet', { defaultValue: '✓ Minimum met' })
                      : t('createCommunity.minRequired', { defaultValue: 'Min {{min}} characters', min: RULES_MIN })}
                  </Text>
                  <CharCount current={rules.length} max={RULES_MAX} c={c} />
                </View>
              </FieldGroup>

              <FieldGroup label={t('createCommunity.adjLabel', { defaultValue: 'Member labels (optional)' })} c={c}>
                <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 8, lineHeight: 16 }}>
                  {t('createCommunity.adjHint', { defaultValue: 'Custom labels for your members (e.g. "Explorer" / "Explorers").' })}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 4 }}>{t('createCommunity.adjSingular', { defaultValue: 'Singular' })}</Text>
                    <TextInput
                      value={userAdj}
                      onChangeText={setUserAdj}
                      maxLength={ADJ_MAX}
                      placeholder="Member"
                      placeholderTextColor={c.placeholder}
                      style={inputStyle(c)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 4 }}>{t('createCommunity.adjPlural', { defaultValue: 'Plural' })}</Text>
                    <TextInput
                      value={usersAdj}
                      onChangeText={setUsersAdj}
                      maxLength={ADJ_MAX}
                      placeholder="Members"
                      placeholderTextColor={c.placeholder}
                      style={inputStyle(c)}
                    />
                  </View>
                </View>
              </FieldGroup>

              <FieldGroup label={t('createCommunity.imagesLabel', { defaultValue: 'Avatar & Cover (optional)' })} c={c}>
                <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10, lineHeight: 16 }}>
                  {t('createCommunity.imagesHint', { defaultValue: 'You can add these now or later from the community settings.' })}
                </Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  {/* Avatar */}
                  <TouchableOpacity
                    onPress={pickAvatar}
                    style={{
                      width: 72, height: 72, borderRadius: 14,
                      borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.border,
                      backgroundColor: c.inputBackground, alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    ) : (
                      <View style={{ alignItems: 'center', gap: 4 }}>
                        <MaterialCommunityIcons name="account-circle-outline" size={24} color={c.textMuted} />
                        <Text style={{ fontSize: 10, color: c.textMuted, fontWeight: '600' }}>Avatar</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  {/* Cover */}
                  <TouchableOpacity
                    onPress={pickCover}
                    style={{
                      flex: 1, height: 72, borderRadius: 14,
                      borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.border,
                      backgroundColor: c.inputBackground, alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    {coverUri ? (
                      <Image source={{ uri: coverUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    ) : (
                      <View style={{ alignItems: 'center', gap: 4 }}>
                        <MaterialCommunityIcons name="image-outline" size={24} color={c.textMuted} />
                        <Text style={{ fontSize: 10, color: c.textMuted, fontWeight: '600' }}>Cover photo</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              </FieldGroup>
            </>
          )}

          {/* ── STEP 4: Similar communities ──────────────────────────────── */}
          {step === 4 && (
            <>
              <View style={{
                borderRadius: 14, borderWidth: 1.5, borderColor: `${c.primary}55`,
                backgroundColor: `${c.primary}0A`, padding: 14, gap: 6,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <MaterialCommunityIcons name="lightbulb-on-outline" size={20} color={c.primary} />
                  <Text style={{ fontSize: 15, fontWeight: '800', color: c.primary }}>
                    {t('createCommunity.similarTitle', { defaultValue: 'Is your community similar to any of these?' })}
                  </Text>
                </View>
                <Text style={{ fontSize: 13, color: c.textSecondary, lineHeight: 18 }}>
                  {t('createCommunity.similarDescription', { defaultValue: 'These communities already exist and may overlap with yours. Joining an existing one helps keep things focused and builds stronger membership.' })}
                </Text>
              </View>

              {similarLoading ? (
                <ActivityIndicator color={c.primary} style={{ marginTop: 20 }} />
              ) : (
                <View style={{ gap: 10 }}>
                  {similarCommunities.map((item) => (
                    <SimilarCommunityCard key={item.id || item.name} item={item} c={c} t={t} token={token} />
                  ))}
                </View>
              )}

              <View style={{ marginTop: 6, gap: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.textSecondary, textAlign: 'center' }}>
                  {t('createCommunity.similarProceedQuestion', { defaultValue: 'None of these fit what you have in mind?' })}
                </Text>
                <TouchableOpacity
                  onPress={() => void submitCreate()}
                  disabled={submitting}
                  style={{
                    borderRadius: 12, paddingVertical: 12, alignItems: 'center',
                    backgroundColor: c.primary, borderWidth: 1, borderColor: c.primary,
                  }}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
                      {t('createCommunity.createAnyway', { defaultValue: 'Yes, create my community' })}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={goBack}
                  style={{
                    borderRadius: 12, paddingVertical: 12, alignItems: 'center',
                    backgroundColor: c.inputBackground, borderWidth: 1, borderColor: c.border,
                  }}
                >
                  <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 14 }}>
                    {t('createCommunity.goBack', { defaultValue: '← Go back and edit' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── Error message ────────────────────────────────────────────── */}
          {!!error && (
            <View style={{ backgroundColor: '#FEF2F2', borderRadius: 10, borderWidth: 1, borderColor: '#FECACA', padding: 12 }}>
              <Text style={{ color: '#DC2626', fontSize: 13, fontWeight: '600' }}>{error}</Text>
            </View>
          )}

          {/* ── Navigation buttons (steps 1–3) ──────────────────────────── */}
          {step < 4 && (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              {step > 1 && (
                <TouchableOpacity
                  onPress={goBack}
                  style={{
                    flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center',
                    borderWidth: 1, borderColor: c.border, backgroundColor: c.inputBackground,
                  }}
                >
                  <Text style={{ color: c.textSecondary, fontWeight: '700', fontSize: 14 }}>
                    {t('createCommunity.backAction', { defaultValue: 'Back' })}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => void goNext()}
                disabled={submitting || similarLoading}
                style={{
                  flex: 2, borderRadius: 12, paddingVertical: 13, alignItems: 'center',
                  backgroundColor: c.primary,
                }}
              >
                {(submitting || similarLoading) ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{nextLabel}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldGroup({ label, c, children }: { label: string; c: any; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textSecondary }}>{label}</Text>
      {children}
    </View>
  );
}

function CharCount({ current, max, c }: { current: number; max: number; c: any }) {
  const near = current >= max * 0.9;
  return (
    <Text style={{ fontSize: 11, color: near ? '#F59E0B' : c.textMuted, fontWeight: '600' }}>
      {current}/{max}
    </Text>
  );
}

function inputStyle(c: any) {
  return {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '500' as const,
    color: c.textPrimary,
    backgroundColor: c.inputBackground,
  };
}

function SimilarCommunityCard({
  item, c, t, token,
}: {
  item: SearchCommunityResult;
  c: any;
  t: (key: string, options?: any) => string;
  token: string;
}) {
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(Array.isArray(item.memberships) && item.memberships.length > 0);
  const accent = item.color || c.primary;
  const title = item.title || item.name || 'Community';
  const initial = (title[0] || 'C').toUpperCase();

  async function handleJoin() {
    if (joining || joined) return;
    setJoining(true);
    try {
      await api.joinCommunity(token, item.name || '');
      setJoined(true);
    } catch {
      // silently ignore
    } finally {
      setJoining(false);
    }
  }

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 12,
      borderWidth: 1, borderRadius: 14, borderColor: c.border,
      backgroundColor: c.inputBackground, padding: 12,
    }}>
      {/* Avatar */}
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: accent, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
        {item.avatar ? (
          <Image source={{ uri: item.avatar }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>{initial}</Text>
        )}
      </View>
      {/* Info */}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: c.textPrimary }} numberOfLines={1}>{title}</Text>
        <Text style={{ fontSize: 12, color: c.textMuted }} numberOfLines={1}>
          c/{item.name} · {(item.members_count ?? 0).toLocaleString()} {t('createCommunity.similarMembers', { defaultValue: 'members' })}
        </Text>
        {item.description ? (
          <Text style={{ fontSize: 12, color: c.textSecondary, lineHeight: 16 }} numberOfLines={2}>{item.description}</Text>
        ) : null}
      </View>
      {/* Join button */}
      <TouchableOpacity
        onPress={() => void handleJoin()}
        disabled={joining || joined}
        style={{
          borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
          borderWidth: 1,
          borderColor: joined ? c.border : c.primary,
          backgroundColor: joined ? c.inputBackground : c.primary,
          flexShrink: 0,
        }}
      >
        {joining ? (
          <ActivityIndicator size="small" color={joined ? c.textSecondary : '#fff'} />
        ) : (
          <Text style={{ fontSize: 12, fontWeight: '800', color: joined ? c.textMuted : '#fff' }}>
            {joined
              ? t('createCommunity.similarJoined', { defaultValue: 'Joined' })
              : t('createCommunity.similarJoin', { defaultValue: 'Join' })}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
