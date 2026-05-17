/**
 * EditPostScreenContainer — dedicated "Edit post" page.
 *
 * Replaces the inline modal that used to render inside PostCard. The modal
 * card sat in the middle of the screen and the on-screen keyboard happily
 * covered the Save button — common complaint on phones. A real page wrapped
 * in a KeyboardAvoidingView keeps the action row above the keyboard, and
 * gives the text area the full screen height.
 *
 * On save, the canonical `api.updatePost` call runs here, then we broadcast
 * the new text through `emitPostContentUpdate` so every other mounted copy
 * of the post (feed / hashtag / profile / community / post-detail) picks up
 * the edit — same pub/sub the reaction-sync fix uses.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppToast } from '../../toast/AppToastContext';
import { api } from '../../api/client';
import { emitPostContentUpdate } from '../../utils/postUpdates';
import type { HomeStackParamList } from '../AppNavigator';

export default function EditPostScreenContainer() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { showToast } = useAppToast();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const route = useRoute<RouteProp<HomeStackParamList, 'EditPost'>>();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const postUuid = route.params?.postUuid;
  const postId = route.params?.postId;
  const initialText = route.params?.initialText ?? '';

  const [text, setText] = useState<string>(initialText);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = text.trim();
  const canSave = !!trimmed && trimmed !== initialText.trim();

  const handleSave = useCallback(async () => {
    if (!token || !postUuid || !canSave || submitting) return;
    setSubmitting(true);
    try {
      const updated: any = await api.updatePost(token, postUuid, trimmed);
      // Broadcast so every mounted screen holding this post (feed, profile,
      // post-detail, etc.) re-renders with the new text. Use whatever the
      // server returned where available so callers see canonical values.
      if (typeof postId === 'number') {
        emitPostContentUpdate(postId, {
          text: typeof updated?.text === 'string' ? updated.text : trimmed,
          long_text: typeof updated?.long_text === 'string' ? updated.long_text : undefined,
        });
      }
      showToast(t('home.editPostSuccess', { defaultValue: 'Post updated.' }), { type: 'success' });
      navigation.goBack();
    } catch (e: any) {
      showToast(
        e?.message || t('home.editPostError', { defaultValue: 'Could not update post.' }),
        { type: 'error' },
      );
    } finally {
      setSubmitting(false);
    }
  }, [token, postUuid, postId, canSave, submitting, trimmed, showToast, t, navigation]);

  const handleCancel = useCallback(() => {
    if (submitting) return;
    navigation.goBack();
  }, [navigation, submitting]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      <View style={styles.container}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          editable={!submitting}
          placeholder={t('home.postEditPlaceholder', { defaultValue: 'Edit your post…' })}
          placeholderTextColor={c.placeholder ?? c.textMuted}
          textAlignVertical="top"
          style={[
            styles.input,
            {
              color: c.textPrimary,
              backgroundColor: c.inputBackground,
              borderColor: c.border,
            },
          ]}
        />
      </View>

      <View
        style={[
          styles.footer,
          {
            borderTopColor: c.border,
            backgroundColor: c.background,
            paddingBottom: 12 + insets.bottom,
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleCancel}
          disabled={submitting}
          style={[styles.cancelButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
        >
          <Text style={[styles.cancelText, { color: c.textPrimary }]}>
            {t('home.cancelAction', { defaultValue: 'Cancel' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => void handleSave()}
          disabled={!canSave || submitting}
          style={[
            styles.saveButton,
            { backgroundColor: !canSave ? c.inputBackground : c.primary, opacity: submitting ? 0.8 : 1 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={!canSave ? c.textMuted : '#fff'} />
          ) : (
            <Text style={[styles.saveText, { color: !canSave ? c.textMuted : '#fff' }]}>
              {t('home.saveAction', { defaultValue: 'Save' })}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 22,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '700' },
  saveButton: {
    flex: 2,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { fontSize: 15, fontWeight: '800' },
});
