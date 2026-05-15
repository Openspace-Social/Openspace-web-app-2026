/**
 * ReportPostScreenContainer — dedicated "Report post" page.
 *
 * Reached from the PostCard ellipsis menu (and the post-detail report
 * action) via navigation.navigate('ReportPost', { postUuid }). Loads the
 * moderation category taxonomy, lets the user pick a reason + add optional
 * detail, submits via api.reportPost, then pops back to the post.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import { api, type ModerationCategory } from '../../api/client';
import type { HomeStackParamList } from '../AppNavigator';

export default function ReportPostScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const route = useRoute<RouteProp<HomeStackParamList, 'ReportPost'>>();
  const c = theme.colors;
  const postUuid = route.params?.postUuid;

  const [categories, setCategories] = useState<ModerationCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const rows = await api.getModerationCategories(token);
      setCategories(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      setError(
        e?.message ||
          t('home.reportPostCategoriesUnavailable', {
            defaultValue: 'Report categories are not available right now.',
          }),
      );
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (!token || !postUuid) {
      showToast(
        t('home.reportPostUnavailable', { defaultValue: 'This post cannot be reported right now.' }),
        { type: 'error' },
      );
      return;
    }
    if (!selectedCategoryId) return;
    setSubmitting(true);
    try {
      const message = await api.reportPost(
        token,
        postUuid,
        selectedCategoryId,
        description.trim() || undefined,
      );
      showToast(
        message || t('home.reportPostSuccess', { defaultValue: 'Post reported, thanks!' }),
        { type: 'success' },
      );
      navigation.goBack();
    } catch (e: any) {
      showToast(
        e?.message || t('home.reportPostFailed', { defaultValue: 'Could not report this post right now.' }),
        { type: 'error' },
      );
    } finally {
      setSubmitting(false);
    }
  }, [submitting, token, postUuid, selectedCategoryId, description, showToast, t, navigation]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.prompt, { color: c.textMuted }]}>
          {t('home.reportPostPrompt', { defaultValue: 'Why are you reporting this post?' })}
        </Text>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={c.primary} size="small" />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={[styles.errorText, { color: c.errorText }]}>{error}</Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => void load()}
              style={[styles.retryButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            >
              <Text style={[styles.retryText, { color: c.textPrimary }]}>
                {t('common.retry', { defaultValue: 'Try again' })}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.categoryList}>
              {categories.map((cat) => {
                const selected = selectedCategoryId === cat.id;
                return (
                  <TouchableOpacity
                    key={`report-category-${cat.id}`}
                    activeOpacity={0.8}
                    onPress={() => setSelectedCategoryId(cat.id)}
                    style={[
                      styles.categoryRow,
                      {
                        borderColor: selected ? c.primary : c.border,
                        backgroundColor: selected ? `${c.primary}12` : c.surface,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                      size={22}
                      color={selected ? c.primary : c.textMuted}
                    />
                    <View style={styles.categoryText}>
                      <Text style={[styles.categoryTitle, { color: c.textPrimary }]}>
                        {cat.title || cat.name}
                      </Text>
                      {cat.description ? (
                        <Text style={[styles.categoryDescription, { color: c.textMuted }]}>
                          {cat.description}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.detailBlock}>
              <Text style={[styles.detailLabel, { color: c.textMuted }]}>
                {t('home.reportPostDetailsLabel', { defaultValue: 'Additional details (optional)' })}
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder={t('home.reportPostDetailsPlaceholder', {
                  defaultValue: 'Describe the issue…',
                })}
                placeholderTextColor={c.textMuted}
                multiline
                maxLength={500}
                style={[
                  styles.detailInput,
                  { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground },
                ]}
              />
            </View>
          </>
        )}
      </ScrollView>

      {!loading && !error ? (
        <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.background }]}>
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={!selectedCategoryId || submitting}
            onPress={() => void handleSubmit()}
            style={[
              styles.submitButton,
              {
                backgroundColor: !selectedCategoryId ? c.inputBackground : c.errorText ?? '#ef4444',
                opacity: submitting ? 0.7 : 1,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={!selectedCategoryId ? c.textMuted : '#fff'} />
            ) : (
              <Text
                style={[
                  styles.submitText,
                  { color: !selectedCategoryId ? c.textMuted : '#fff' },
                ]}
              >
                {t('home.reportPostSubmit', { defaultValue: 'Submit report' })}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  prompt: {
    fontSize: 14,
    lineHeight: 20,
  },
  centered: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 14,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
  },
  categoryList: {
    gap: 10,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  categoryText: {
    flex: 1,
    gap: 3,
  },
  categoryTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  categoryDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  detailBlock: {
    gap: 6,
    marginTop: 4,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  detailInput: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 92,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submitButton: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: {
    fontSize: 15,
    fontWeight: '800',
  },
});
