/**
 * CommentLinkPreview — embedded link card for comments and replies.
 *
 * Mirrors the look of the post-body link preview (renderShortPostLinkPreview
 * in PostDetailModal): site name, title, description, URL, optional image.
 * Tapping the card invokes onOpenLink which opens the in-app browser.
 *
 * Self-contained: extracts the first URL from the comment text on mount,
 * fetches the preview metadata via the shared cache, and renders nothing
 * if the text has no URL or the preview hasn't resolved yet.
 */

import React, { useEffect, useState } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import {
  extractFirstUrlFromText,
  fetchShortPostLinkPreviewCached,
  type ShortPostLinkPreview,
} from '../utils/shortPostEmbeds';
import { postCardStyles } from '../styles/postCardStyles';

type Props = {
  text: string | null | undefined;
  c: any;
  onOpenLink: (url: string) => void;
};

export default function CommentLinkPreview({ text, c, onOpenLink }: Props) {
  const url = extractFirstUrlFromText(text || '') || null;
  const [preview, setPreview] = useState<ShortPostLinkPreview | null>(null);

  useEffect(() => {
    if (!url) {
      setPreview(null);
      return;
    }
    let active = true;
    setPreview(null);
    fetchShortPostLinkPreviewCached(url)
      .then((p) => {
        if (active) setPreview(p || null);
      })
      .catch(() => {
        if (active) setPreview(null);
      });
    return () => {
      active = false;
    };
  }, [url]);

  if (!url || !preview) return null;

  // Don't display a card with no useful metadata. The fallback preview
  // returned by fetchShortPostLinkPreview just echoes the URL host as
  // both title and siteName, which makes for an uninformative card.
  const hasUsefulContent = !!(preview.imageUrl || preview.description || (preview.title && preview.title !== preview.siteName));
  if (!hasUsefulContent) return null;

  return (
    <TouchableOpacity
      style={[postCardStyles.shortPostLinkPreviewCard, { borderColor: c.border, backgroundColor: c.inputBackground, marginTop: 6 }]}
      activeOpacity={0.88}
      onPress={() => onOpenLink(preview.url)}
    >
      {preview.imageUrl ? (
        <Image source={{ uri: preview.imageUrl }} style={postCardStyles.shortPostLinkPreviewImage} resizeMode="cover" />
      ) : null}
      <View style={postCardStyles.shortPostLinkPreviewMeta}>
        {preview.siteName ? (
          <Text numberOfLines={1} style={[postCardStyles.shortPostLinkPreviewSite, { color: c.textMuted }]}>
            {preview.siteName}
          </Text>
        ) : null}
        {preview.title ? (
          <Text numberOfLines={2} style={[postCardStyles.shortPostLinkPreviewTitle, { color: c.textPrimary }]}>
            {preview.title}
          </Text>
        ) : null}
        {preview.description ? (
          <Text numberOfLines={2} style={[postCardStyles.shortPostLinkPreviewDescription, { color: c.textSecondary }]}>
            {preview.description}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={[postCardStyles.shortPostLinkPreviewUrl, { color: c.textLink }]}>
          {preview.url}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
