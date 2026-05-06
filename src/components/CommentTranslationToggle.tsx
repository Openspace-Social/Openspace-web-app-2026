/**
 * CommentTranslationToggle — "See translation" / "Show original" UI for
 * a single comment or reply, mirroring PostCard's post-level translation
 * affordance.
 *
 * Renders nothing if the comment text is empty, the comment's language
 * already matches the user's translation language, or the user has no
 * translation language set.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

type Props = {
  commentId: number;
  commentText: string | null | undefined;
  commentLanguageCode: string | null | undefined;
  userTranslationLanguageCode: string | null | undefined;
  isTranslated: boolean;
  isLoading: boolean;
  hasError: boolean;
  onTranslate: () => void;
  onShowOriginal: () => void;
  c: any;
};

export default function CommentTranslationToggle({
  commentText,
  commentLanguageCode,
  userTranslationLanguageCode,
  isTranslated,
  isLoading,
  hasError,
  onTranslate,
  onShowOriginal,
  c,
}: Props) {
  const { t } = useTranslation();

  const hasText = !!(commentText && commentText.trim());
  // Match PostCard's gating exactly: hide when the comment language is
  // unknown or already matches the user's translation language. We still
  // render the "Show original" link if a translation has somehow been
  // applied (e.g. user toggled then language metadata changed).
  const canTranslate =
    hasText &&
    !!userTranslationLanguageCode &&
    !!commentLanguageCode &&
    commentLanguageCode !== userTranslationLanguageCode;

  if (!canTranslate && !isTranslated) return null;

  return (
    <View style={styles.wrap}>
      {isTranslated ? (
        <TouchableOpacity onPress={onShowOriginal} activeOpacity={0.85}>
          <Text style={[styles.link, { color: c.textLink }]}>
            {t('home.showOriginal', { defaultValue: 'Show original' })}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={onTranslate}
          activeOpacity={0.85}
          disabled={isLoading}
          style={styles.row}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={c.textLink} />
          ) : hasError ? (
            <Text style={[styles.link, { color: (c as any).errorText ?? c.textMuted }]}>
              {t('home.translationError', { defaultValue: 'Translation failed — tap to retry' })}
            </Text>
          ) : (
            <Text style={[styles.link, { color: c.textLink }]}>
              {t('home.seeTranslation', { defaultValue: 'See translation' })}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  link: { fontSize: 13, fontWeight: '600' },
});
