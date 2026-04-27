import React, { useMemo, useRef, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
  TextInput,
  Image,
  ActivityIndicator,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { useSwipeToClose } from '../hooks/useSwipeToClose';
import LexicalLongPostEditor from './LexicalLongPostEditor';
import MentionHashtagInput from './MentionHashtagInput';

export type LongPostBlockType = 'paragraph' | 'heading' | 'quote' | 'image' | 'embed' | 'table';
export type LongPostEditorMode = 'blocks' | 'lexical';

export type LongPostBlock = {
  id: string;
  type: LongPostBlockType;
  position?: number;
  text?: string;
  level?: 1 | 2 | 3;
  url?: string;
  caption?: string;
  align?: 'left' | 'center' | 'right';
  width?: number;
  tableHtml?: string;
  objectPosition?: string;
  imageFit?: 'cover' | 'contain';
  imageScale?: number;
};

interface LongPostDrawerProps {
  visible: boolean;
  expanded: boolean;
  title: string;
  blocks: LongPostBlock[];
  editorMode?: LongPostEditorMode;
  lexicalHtml?: string;
  lexicalResetKey?: string | number;
  draftExpiryDays: number;
  draftSaving?: boolean;
  draftSavedAtLabel?: string | null;
  mediaCount?: number;
  maxImages?: number;
  errorMessage?: string;
  onChangeTitle: (value: string) => void;
  onChangeBlocks: (blocks: LongPostBlock[]) => void;
  onChangeEditorMode?: (mode: LongPostEditorMode) => void;
  onChangeLexicalHtml?: (html: string) => void;
  onUploadImageFiles?: (files: Array<Blob & { name?: string; type?: string }>) => Promise<string[]>;
  onNotify?: (message: string) => void;
  onChangeDraftExpiryDays: (days: number) => void;
  onSaveDraft: () => void;
  onPreview?: () => void;
  onOpenDrafts: () => void;
  onClose: () => void;
  onApply: () => void;
  onToggleExpanded: () => void;
  token?: string;
}

const DURATION = 280;
const LONG_POST_MAX_IMAGES = 5;
const LONG_POST_MAX_CHAR_COUNT = 10000;

const FOCAL_POSITIONS = [
  [{ label: '↖', value: 'left top' }, { label: '↑', value: 'center top' }, { label: '↗', value: 'right top' }],
  [{ label: '←', value: 'left center' }, { label: '·', value: 'center center' }, { label: '→', value: 'right center' }],
  [{ label: '↙', value: 'left bottom' }, { label: '↓', value: 'center bottom' }, { label: '↘', value: 'right bottom' }],
];

function getFocalOffset(position?: string) {
  const map: Record<string, { x: number; y: number }> = {
    'left top': { x: -1, y: -1 },
    'center top': { x: 0, y: -1 },
    'right top': { x: 1, y: -1 },
    'left center': { x: -1, y: 0 },
    'center center': { x: 0, y: 0 },
    'right center': { x: 1, y: 0 },
    'left bottom': { x: -1, y: 1 },
    'center bottom': { x: 0, y: 1 },
    'right bottom': { x: 1, y: 1 },
  };
  return map[position || 'center center'] || { x: 0, y: 0 };
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToPlainText(value?: string) {
  if (!value) return '';
  return decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h1|h2|h3|blockquote|li|div|tr|table)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ImageBlockEditor({
  block,
  c,
  t,
  onUpdate,
  onUploadImageFiles,
  onInsertImagesAfter,
  onNotify,
  currentImageCount,
  maxImages = LONG_POST_MAX_IMAGES,
}: {
  block: LongPostBlock;
  c: any;
  t: any;
  onUpdate: (patch: Partial<LongPostBlock>) => void;
  onUploadImageFiles?: (files: Array<Blob & { name?: string; type?: string }>) => Promise<string[]>;
  onInsertImagesAfter: (urls: string[]) => void;
  onNotify?: (message: string) => void;
  currentImageCount: number;
  maxImages?: number;
}) {
  const [imageError, setImageError] = useState(false);
  const [uploadingSingle, setUploadingSingle] = useState(false);
  const [uploadingBatch, setUploadingBatch] = useState(false);
  const isValidUrl = !!block.url && block.url.startsWith('http');
  const currentPosition = block.objectPosition || 'center center';
  const imageFit = block.imageFit === 'contain' ? 'contain' : 'cover';
  const imageScale = typeof block.imageScale === 'number' && Number.isFinite(block.imageScale)
    ? Math.max(0.8, Math.min(1.6, block.imageScale))
    : 1;
  const focal = getFocalOffset(currentPosition);

  async function pickImages(multiple = false) {
    if (!onUploadImageFiles) return;
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      onNotify?.(
        t('home.postComposerMediaUnsupported', {
          defaultValue: 'Media upload is currently available on web.',
        })
      );
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.onchange = async () => {
      const files = Array.from(input.files || [])
        .filter((file) => file.type?.startsWith('image/'))
        .map((file) => file as Blob & { name?: string; type?: string });
      if (!files.length) return;
      const hasCurrentImage = !!(block.url && block.url.trim());
      const remainingSlots = Math.max(0, maxImages - currentImageCount + (hasCurrentImage ? 1 : 0));
      if (remainingSlots <= 0) {
        onNotify?.(
          t('home.longPostImageLimitReached', {
            defaultValue: `You can add up to ${maxImages} images in a long post.`,
            max: maxImages,
          })
        );
        return;
      }
      const limitedFiles = files.slice(0, remainingSlots);
      if (!limitedFiles.length) return;

      if (multiple) {
        setUploadingBatch(true);
      } else {
        setUploadingSingle(true);
      }

      try {
        const uploadedUrls = await onUploadImageFiles(limitedFiles);
        if (!uploadedUrls.length) return;
        onUpdate({ url: uploadedUrls[0] });
        setImageError(false);
        if (uploadedUrls.length > 1) {
          onInsertImagesAfter(uploadedUrls.slice(1));
        }
      } catch (e: any) {
        onNotify?.(
          e?.message ||
            t('home.postComposerFailed', { defaultValue: 'Could not publish your post right now.' })
        );
      } finally {
        setUploadingSingle(false);
        setUploadingBatch(false);
      }
    };
    input.click();
  }

  return (
    <View style={styles.blockEditorGroup}>
      {onUploadImageFiles ? (
        <View style={styles.imageUploadActionsRow}>
          <TouchableOpacity
            style={[styles.imageUploadButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            activeOpacity={0.85}
            disabled={uploadingSingle || uploadingBatch}
            onPress={() => void pickImages(false)}
          >
            {uploadingSingle ? (
              <ActivityIndicator size="small" color={c.textSecondary} />
            ) : (
              <>
                <MaterialCommunityIcons name="upload" size={14} color={c.textSecondary} />
                <Text style={[styles.imageUploadButtonText, { color: c.textSecondary }]}>
                  {t('home.longPostUploadImageAction', { defaultValue: 'Upload image' })}
                </Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.imageUploadButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            activeOpacity={0.85}
            disabled={uploadingSingle || uploadingBatch}
            onPress={() => void pickImages(true)}
          >
            {uploadingBatch ? (
              <ActivityIndicator size="small" color={c.textSecondary} />
            ) : (
              <>
                <MaterialCommunityIcons name="image-multiple" size={14} color={c.textSecondary} />
                <Text style={[styles.imageUploadButtonText, { color: c.textSecondary }]}>
                  {t('home.longPostUploadGalleryAction', { defaultValue: 'Upload image set' })}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      <TextInput
        style={[styles.blockInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
        placeholder={t('home.longPostImageUrlPlaceholder', { defaultValue: 'Image URL (https://...)' })}
        placeholderTextColor={c.placeholder}
        value={block.url || ''}
        onChangeText={(value) => { onUpdate({ url: value }); setImageError(false); }}
        autoCapitalize="none"
      />

      {isValidUrl && !imageError ? (
        <View style={styles.imagePreviewWrap}>
          <Image
            source={{ uri: block.url }}
            style={[
              styles.imagePreview,
              imageFit === 'cover'
                ? {
                    transform: [
                      { scale: imageScale },
                      { translateX: focal.x * 24 * imageScale },
                      { translateY: focal.y * 24 * imageScale },
                    ],
                  }
                : { transform: [{ scale: imageScale }] },
              Platform.OS === 'web'
                ? ({ objectFit: imageFit, objectPosition: currentPosition } as any)
                : {},
            ]}
            resizeMode={imageFit}
            onError={() => setImageError(true)}
          />
        </View>
      ) : isValidUrl && imageError ? (
        <View style={[styles.imagePreviewError, { borderColor: c.border, backgroundColor: c.inputBackground }]}>
          <MaterialCommunityIcons name="image-broken-variant" size={22} color={c.textMuted} />
          <Text style={[styles.imagePreviewErrorText, { color: c.textMuted }]}>
            {t('home.longPostImageLoadError', { defaultValue: 'Could not load image' })}
          </Text>
        </View>
      ) : null}

      {isValidUrl ? (
        <View style={styles.positionPickerWrap}>
          <View style={styles.imageFitRow}>
            <Text style={[styles.positionPickerLabel, { color: c.textMuted }]}>
              {t('home.longPostImageFitLabel', { defaultValue: 'Image fit' })}
            </Text>
            <View style={styles.imageFitButtons}>
              {([
                { key: 'cover', label: t('home.longPostImageFitCover', { defaultValue: 'Cover' }) },
                { key: 'contain', label: t('home.longPostImageFitContain', { defaultValue: 'Fit' }) },
              ] as const).map((option) => {
                const selected = imageFit === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.imageFitButton,
                      {
                        borderColor: selected ? c.primary : c.border,
                        backgroundColor: selected ? `${c.primary}1A` : c.inputBackground,
                      },
                    ]}
                    onPress={() => onUpdate({ imageFit: option.key })}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.imageFitButtonText, { color: selected ? c.primary : c.textSecondary }]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.imageScaleRow}>
            <Text style={[styles.positionPickerLabel, { color: c.textMuted }]}>
              {t('home.longPostImageScaleLabel', { defaultValue: 'Image size' })}
            </Text>
            <View style={styles.imageScaleButtons}>
              {[0.9, 1, 1.15, 1.3].map((value) => {
                const selected = Math.abs(imageScale - value) < 0.01;
                return (
                  <TouchableOpacity
                    key={`scale-${value}`}
                    style={[
                      styles.imageScaleButton,
                      {
                        borderColor: selected ? c.primary : c.border,
                        backgroundColor: selected ? `${c.primary}1A` : c.inputBackground,
                      },
                    ]}
                    onPress={() => onUpdate({ imageScale: value })}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.imageScaleButtonText, { color: selected ? c.primary : c.textSecondary }]}>
                      {Math.round(value * 100)}%
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <Text style={[styles.positionPickerLabel, { color: c.textMuted }]}>
            {t('home.longPostFocalPoint', { defaultValue: 'Focal point' })}
          </Text>
          <View style={styles.positionGrid}>
            {FOCAL_POSITIONS.map((row, ri) => (
              <View key={ri} style={styles.positionRow}>
                {row.map(({ label, value }) => {
                  const selected = currentPosition === value;
                  return (
                    <TouchableOpacity
                      key={value}
                      style={[
                        styles.positionCell,
                        {
                          borderColor: selected ? c.primary : c.border,
                          backgroundColor: selected ? `${c.primary}1A` : c.inputBackground,
                        },
                      ]}
                      onPress={() => onUpdate({ objectPosition: value })}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.positionCellText, { color: selected ? c.primary : c.textMuted }]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <TextInput
        style={[styles.blockInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
        placeholder={t('home.longPostCaptionPlaceholder', { defaultValue: 'Caption (optional)' })}
        placeholderTextColor={c.placeholder}
        value={block.caption || ''}
        onChangeText={(value) => onUpdate({ caption: value })}
      />
    </View>
  );
}

function newBlock(type: LongPostBlockType): LongPostBlock {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    ...(type === 'heading' ? { level: 2 as const } : null),
  };
}

export default function LongPostDrawer({
  visible,
  expanded,
  title,
  blocks,
  editorMode = 'blocks',
  lexicalHtml = '',
  lexicalResetKey,
  onUploadImageFiles,
  onNotify,
  draftExpiryDays,
  draftSaving,
  draftSavedAtLabel,
  mediaCount = 0,
  maxImages = LONG_POST_MAX_IMAGES,
  errorMessage,
  onChangeTitle,
  onChangeBlocks,
  onChangeEditorMode,
  onChangeLexicalHtml,
  onChangeDraftExpiryDays,
  onSaveDraft,
  onPreview,
  onOpenDrafts,
  onClose,
  onApply,
  onToggleExpanded,
  token,
}: LongPostDrawerProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;
  const { width, height } = useWindowDimensions();
  const [localTitle, setLocalTitle] = useState(title);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lexicalDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drawerWidth = useMemo(() => {
    if (Platform.OS !== 'web') return width;
    // On mobile (<720/980), use full viewport. On desktop, target the preferred
    // fraction, clamped at the upper cap.
    if (expanded) return width < 980 ? width : Math.min(1280, width * 0.92);
    return width < 720 ? width : Math.min(960, width * 0.78);
  }, [expanded, width]);

  const translateX = useRef(new Animated.Value(drawerWidth)).current;
  const animatedDrawerWidth = useRef(new Animated.Value(drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const swipeHandlers = useSwipeToClose({ drawerWidth, translateX, onClose });
  const wasVisibleRef = useRef(visible);
  const [lexicalHeightExpanded, setLexicalHeightExpanded] = useState(false);
  const isLexicalFocusMode = editorMode === 'lexical' && lexicalHeightExpanded;
  const longPostImageCount = useMemo(
    () => blocks.filter((block) => block.type === 'image' && !!(block.url || '').trim()).length,
    [blocks]
  );
  const longPostCharCount = useMemo(() => {
    const safeTitle = (localTitle || '').trim();
    const bodyText =
      editorMode === 'lexical'
        ? htmlToPlainText(lexicalHtml)
        : blocks
            .map((block) => {
              if (!block) return '';
              if (block.type === 'table') {
                return htmlToPlainText(block.tableHtml || '');
              }
              return [block.text || '', block.caption || '', block.url || '']
                .join(' ')
                .replace(/\s{2,}/g, ' ')
                .trim();
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    return `${safeTitle}\n${bodyText}`.trim().length;
  }, [blocks, editorMode, lexicalHtml, localTitle]);
  const longPostCharsRemaining = LONG_POST_MAX_CHAR_COUNT - longPostCharCount;

  useEffect(() => {
    if (!visible) {
      animatedDrawerWidth.setValue(drawerWidth);
      return;
    }
    Animated.timing(animatedDrawerWidth, {
      toValue: drawerWidth,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [animatedDrawerWidth, drawerWidth, visible]);

  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    if (visible && !wasVisible) {
      translateX.setValue(drawerWidth);
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 0,
          duration: DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (!visible && wasVisible) {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: drawerWidth,
          duration: DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (visible && wasVisible) {
      // Width changed while open: keep drawer anchored and stretched in place.
      translateX.setValue(0);
    }
    wasVisibleRef.current = visible;
  }, [visible, drawerWidth, translateX, backdropOpacity]);

  useEffect(() => {
    if (!visible) {
      setLexicalHeightExpanded(false);
      if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
      if (lexicalDebounceRef.current) clearTimeout(lexicalDebounceRef.current);
    } else {
      setLocalTitle(title);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (editorMode !== 'lexical' && lexicalHeightExpanded) {
      setLexicalHeightExpanded(false);
    }
  }, [editorMode, lexicalHeightExpanded]);

  function ensureAtLeastOneBlock(next: LongPostBlock[]) {
    if (next.length > 0) return next;
    return [newBlock('heading')];
  }

  function addBlock(type: LongPostBlockType, index?: number) {
    if (type === 'image' && longPostImageCount >= maxImages) {
      onNotify?.(
        t('home.longPostImageLimitReached', {
          defaultValue: `You can add up to ${maxImages} images in a long post.`,
          max: maxImages,
        })
      );
      return;
    }
    const block = newBlock(type);
    if (typeof index === 'number') {
      const next = [...blocks];
      next.splice(index + 1, 0, block);
      onChangeBlocks(next);
      return;
    }
    onChangeBlocks([...blocks, block]);
  }

  function updateBlock(id: string, patch: Partial<LongPostBlock>) {
    onChangeBlocks(blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  }

  function removeBlock(id: string) {
    const next = ensureAtLeastOneBlock(blocks.filter((block) => block.id !== id));
    onChangeBlocks(next);
  }

  function duplicateBlock(id: string) {
    const idx = blocks.findIndex((block) => block.id === id);
    if (idx < 0) return;
    if (blocks[idx].type === 'image' && longPostImageCount >= maxImages) {
      onNotify?.(
        t('home.longPostImageLimitReached', {
          defaultValue: `You can add up to ${maxImages} images in a long post.`,
          max: maxImages,
        })
      );
      return;
    }
    const clone = { ...blocks[idx], id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    const next = [...blocks];
    next.splice(idx + 1, 0, clone);
    onChangeBlocks(next);
  }

  function moveBlock(id: string, direction: -1 | 1) {
    const idx = blocks.findIndex((block) => block.id === id);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    onChangeBlocks(next);
  }

  function insertImageBlocksAfterId(blockId: string, urls: string[]) {
    if (!urls.length) return;
    const idx = blocks.findIndex((block) => block.id === blockId);
    if (idx < 0) return;
    const remaining = Math.max(0, maxImages - longPostImageCount);
    if (remaining <= 0) {
      onNotify?.(
        t('home.longPostImageLimitReached', {
          defaultValue: `You can add up to ${maxImages} images in a long post.`,
          max: maxImages,
        })
      );
      return;
    }
    const limitedUrls = urls.slice(0, remaining);
    const imageBlocks: LongPostBlock[] = limitedUrls.map((url) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'image',
      url,
    }));
    const next = [...blocks];
    next.splice(idx + 1, 0, ...imageBlocks);
    onChangeBlocks(next);
  }

  function renderBlockEditor(block: LongPostBlock) {
    if (block.type === 'image') {
      return (
        <ImageBlockEditor
          block={block}
          c={c}
          t={t}
          onUpdate={(patch) => updateBlock(block.id, patch)}
          onUploadImageFiles={onUploadImageFiles}
          onNotify={onNotify}
          onInsertImagesAfter={(urls) => insertImageBlocksAfterId(block.id, urls)}
          currentImageCount={longPostImageCount}
          maxImages={maxImages}
        />
      );
    }

    if (block.type === 'embed') {
      return (
        <View style={styles.blockEditorGroup}>
          <TextInput
            style={[styles.blockInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
            placeholder={t('home.longPostEmbedUrlPlaceholder', { defaultValue: 'Embed URL (YouTube, Vimeo, etc.)' })}
            placeholderTextColor={c.placeholder}
            value={block.url || ''}
            onChangeText={(value) => updateBlock(block.id, { url: value })}
            autoCapitalize="none"
          />
          <TextInput
            style={[styles.blockInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
            placeholder={t('home.longPostCaptionPlaceholder', { defaultValue: 'Caption (optional)' })}
            placeholderTextColor={c.placeholder}
            value={block.caption || ''}
            onChangeText={(value) => updateBlock(block.id, { caption: value })}
          />
        </View>
      );
    }

    return (
      <View style={styles.blockEditorGroup}>
        {block.type === 'heading' ? (
          <View style={styles.headingLevelRow}>
            {[1, 2, 3].map((level) => {
              const selected = (block.level || 2) === level;
              return (
                <TouchableOpacity
                  key={`${block.id}-h${level}`}
                  style={[
                    styles.headingLevelButton,
                    {
                      borderColor: selected ? c.primary : c.border,
                      backgroundColor: selected ? `${c.primary}1A` : c.inputBackground,
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => updateBlock(block.id, { level: level as 1 | 2 | 3 })}
                >
                  <Text style={[styles.headingLevelButtonText, { color: selected ? c.primary : c.textSecondary }]}>
                    H{level}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        <MentionHashtagInput
          style={[
            styles.blockInput,
            block.type !== 'heading' ? styles.blockInputMultiline : null,
            { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary },
          ]}
          multiline={block.type !== 'heading'}
          textAlignVertical={block.type !== 'heading' ? 'top' : 'center'}
          placeholder={
            block.type === 'paragraph'
              ? t('home.longPostParagraphPlaceholder', { defaultValue: 'Write paragraph text...' })
              : block.type === 'heading'
                ? t('home.longPostHeadingPlaceholder', { defaultValue: 'Write heading...' })
                : t('home.longPostQuotePlaceholder', { defaultValue: 'Write quote...' })
          }
          placeholderTextColor={c.placeholder}
          value={block.text || ''}
          onChangeText={(value) => updateBlock(block.id, { text: value })}
          numberOfLines={block.type === 'heading' ? 1 : 5}
          token={token}
          c={c}
        />
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}> 
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        </Animated.View>

        <Animated.View
          {...swipeHandlers}
          style={[
            styles.drawer,
            {
              width: animatedDrawerWidth,
              backgroundColor: c.surface,
              borderColor: c.border,
              transform: [{ translateX }],
            },
          ]}
        >
          <SafeAreaView style={styles.drawerInner}>
            <View style={[styles.header, { borderBottomColor: c.border }]}> 
              <View style={styles.headerTextWrap}>
                <Text style={[styles.headerTitle, { color: c.textPrimary }]}> 
                  {t('home.longPostEditorTitle', { defaultValue: 'Long post editor' })}
                </Text>
                <Text style={[styles.headerBody, { color: c.textMuted }]}> 
                  {t('home.longPostEditorBody', {
                    defaultValue: 'Compose using explicit blocks so content maps directly to backend structure.',
                  })}
                </Text>
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity
                  style={[styles.headerIconButton, { backgroundColor: c.inputBackground, borderColor: c.border }]}
                  onPress={onOpenDrafts}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="file-document-multiple-outline" size={18} color={c.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.headerIconButton, { backgroundColor: c.inputBackground, borderColor: c.border }]}
                  onPress={onToggleExpanded}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons
                    name={expanded ? 'arrow-collapse-horizontal' : 'arrow-expand-horizontal'}
                    size={18}
                    color={c.textSecondary}
                  />
                </TouchableOpacity>
                {editorMode === 'lexical' ? (
                  <TouchableOpacity
                    style={[
                      styles.headerIconButton,
                      {
                        backgroundColor: lexicalHeightExpanded ? `${c.primary}1A` : c.inputBackground,
                        borderColor: lexicalHeightExpanded ? c.primary : c.border,
                      },
                    ]}
                    onPress={() => setLexicalHeightExpanded((prev) => !prev)}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons
                      name={lexicalHeightExpanded ? 'arrow-collapse-vertical' : 'arrow-expand-vertical'}
                      size={18}
                      color={c.textSecondary}
                    />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[styles.headerIconButton, { backgroundColor: c.inputBackground, borderColor: c.border }]}
                  onPress={onClose}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.editorWrap}>
              <ScrollView
                style={styles.blockScroll}
                contentContainerStyle={styles.blockScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {!isLexicalFocusMode ? (
                  <>
                    <View style={[styles.titleCard, { borderColor: c.border, backgroundColor: c.surface }]}>
                      <Text style={[styles.titleCardLabel, { color: c.textSecondary }]}>
                        {t('home.longPostTitleLabel', { defaultValue: 'Title' })}
                      </Text>
                      <TextInput
                        style={[styles.titleInput, { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary }]}
                        placeholder={t('home.longPostTitlePlaceholder', { defaultValue: 'Write post title...' })}
                        placeholderTextColor={c.placeholder}
                        value={localTitle}
                        onChangeText={(value) => {
                          setLocalTitle(value);
                          if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
                          titleDebounceRef.current = setTimeout(() => onChangeTitle(value), 150);
                        }}
                      />
                    </View>

                  </>
                ) : null}

                {editorMode === 'blocks' ? (
                  <>
                    <View style={styles.addRow}>
                      {(['heading', 'paragraph', 'quote', 'image', 'embed'] as LongPostBlockType[]).map((type) => (
                        <TouchableOpacity
                          key={`add-${type}`}
                          style={[styles.addButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                          activeOpacity={0.85}
                          onPress={() => addBlock(type)}
                        >
                          <Text style={[styles.addButtonText, { color: c.textSecondary }]}> 
                            {type === 'paragraph'
                              ? t('home.longPostBlockParagraph', { defaultValue: 'Paragraph' })
                              : type === 'heading'
                                ? t('home.longPostBlockHeading', { defaultValue: 'Heading' })
                                : type === 'quote'
                                  ? t('home.longPostBlockQuote', { defaultValue: 'Quote' })
                                  : type === 'image'
                                    ? t('home.longPostBlockImage', { defaultValue: 'Image' })
                                    : t('home.longPostBlockEmbed', { defaultValue: 'Embed' })}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {blocks.map((block, index) => (
                      <View key={block.id} style={[styles.blockCard, { borderColor: c.border, backgroundColor: c.surface }]}> 
                        <View style={styles.blockCardHeader}>
                          <View style={styles.blockCardTitleWrap}>
                            <MaterialCommunityIcons name="drag-vertical" size={16} color={c.textMuted} />
                            <Text style={[styles.blockCardTitle, { color: c.textPrimary }]}> 
                              {block.type === 'paragraph'
                                ? t('home.longPostBlockParagraph', { defaultValue: 'Paragraph' })
                                : block.type === 'heading'
                                  ? t('home.longPostBlockHeading', { defaultValue: 'Heading' })
                                  : block.type === 'quote'
                                    ? t('home.longPostBlockQuote', { defaultValue: 'Quote' })
                                    : block.type === 'image'
                                      ? t('home.longPostBlockImage', { defaultValue: 'Image' })
                                      : t('home.longPostBlockEmbed', { defaultValue: 'Embed' })}
                            </Text>
                          </View>

                          <View style={styles.blockCardActions}>
                            <TouchableOpacity
                              style={[styles.blockActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                              onPress={() => moveBlock(block.id, -1)}
                              activeOpacity={0.85}
                              disabled={index === 0}
                            >
                              <MaterialCommunityIcons name="arrow-up" size={16} color={index === 0 ? c.placeholder : c.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.blockActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                              onPress={() => moveBlock(block.id, 1)}
                              activeOpacity={0.85}
                              disabled={index === blocks.length - 1}
                            >
                              <MaterialCommunityIcons name="arrow-down" size={16} color={index === blocks.length - 1 ? c.placeholder : c.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.blockActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                              onPress={() => duplicateBlock(block.id)}
                              activeOpacity={0.85}
                            >
                              <MaterialCommunityIcons name="content-copy" size={16} color={c.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.blockActionButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                              onPress={() => removeBlock(block.id)}
                              activeOpacity={0.85}
                            >
                              <MaterialCommunityIcons name="delete-outline" size={16} color={c.textSecondary} />
                            </TouchableOpacity>
                          </View>
                        </View>

                        {renderBlockEditor(block)}

                        <View style={styles.blockFooter}>
                          <TouchableOpacity
                            style={[styles.insertAfterButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                            onPress={() => addBlock('paragraph', index)}
                            activeOpacity={0.85}
                          >
                            <MaterialCommunityIcons name="plus" size={14} color={c.textSecondary} />
                            <Text style={[styles.insertAfterText, { color: c.textSecondary }]}> 
                              {t('home.longPostInsertParagraph', { defaultValue: 'Insert paragraph below' })}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </>
                ) : (
                  <View
                    style={[
                      styles.lexicalWrap,
                      {
                        borderColor: c.border,
                        backgroundColor: c.surface,
                        minHeight: isLexicalFocusMode ? Math.max(760, height - 220) : undefined,
                        flex: isLexicalFocusMode ? 1 : undefined,
                      },
                    ]}
                  >
                    <View style={styles.lexicalMetaRow}>
                      {!isLexicalFocusMode ? (
                        <Text style={[styles.lexicalHint, { color: c.textMuted }]}>
                          {t('home.longPostLexicalHint', {
                            defaultValue: 'Lexical beta: rich formatting for fast long-form writing.',
                          })}
                        </Text>
                      ) : (
                        <View />
                      )}
                      <View style={styles.lexicalMetaRight}>
                        {draftSavedAtLabel ? (
                          <Text style={[styles.draftSavedAtText, { color: c.textMuted }]}>
                            {draftSavedAtLabel}
                          </Text>
                        ) : null}
                        <Text style={[styles.mediaUsageText, { color: c.textMuted }]}>
                          {t('home.longPostImageUsage', {
                            defaultValue: 'Images used: {{count}} / {{max}}',
                            count: mediaCount,
                            max: maxImages,
                          })}
                        </Text>
                        <Text
                          style={[
                            styles.mediaUsageText,
                            {
                              color:
                                longPostCharsRemaining < 0
                                  ? (c.errorText ?? '#DC2626')
                                  : (longPostCharsRemaining <= 500 ? '#D97706' : c.textMuted),
                            },
                          ]}
                        >
                          {t('home.longPostCharacterUsage', {
                            defaultValue: 'Characters: {{count}} / {{max}}',
                            count: longPostCharCount,
                            max: LONG_POST_MAX_CHAR_COUNT,
                          })}
                        </Text>
                      </View>
                    </View>
                    <LexicalLongPostEditor
                      key={`lexical-${lexicalResetKey ?? 'default'}`}
                      value={lexicalHtml}
                      placeholder={t('home.longPostLexicalPlaceholder', { defaultValue: 'Start writing your long post...' })}
                      onChange={(html) => {
                        if (lexicalDebounceRef.current) clearTimeout(lexicalDebounceRef.current);
                        lexicalDebounceRef.current = setTimeout(() => onChangeLexicalHtml?.(html), 300);
                      }}
                      onUploadImageFiles={onUploadImageFiles}
                      expandedHeight={lexicalHeightExpanded}
                      maxImages={maxImages}
                      onNotify={onNotify}
                      token={token}
                    />
                  </View>
                )}
              </ScrollView>
            </View>

            {!!errorMessage && (
              <View style={[styles.footerError, { backgroundColor: c.errorBackground ?? '#FEF2F2', borderColor: c.errorBorder ?? '#FECACA' }]}>
                <Text style={[styles.footerErrorText, { color: c.errorText ?? '#DC2626' }]}>{errorMessage}</Text>
              </View>
            )}

            <View style={[styles.footer, { borderTopColor: c.border }]}>
              <View style={styles.footerLeft}>
                <Text style={[styles.draftOptionsLabel, { color: c.textMuted }]}>
                  {t('home.longPostDraftExpiryLabel', { defaultValue: 'Draft expiry' })}
                </Text>
                <View style={styles.draftExpiryChoices}>
                  {[10, 14, 20].map((days) => {
                    const selected = draftExpiryDays === days;
                    return (
                      <TouchableOpacity
                        key={`draft-expiry-footer-${days}`}
                        style={[
                          styles.draftExpiryChoice,
                          {
                            borderColor: selected ? c.primary : c.border,
                            backgroundColor: selected ? `${c.primary}1A` : c.inputBackground,
                          },
                        ]}
                        activeOpacity={0.85}
                        onPress={() => onChangeDraftExpiryDays(days)}
                      >
                        <Text style={[styles.draftExpiryChoiceText, { color: selected ? c.primary : c.textSecondary }]}>
                          {t('home.longPostDraftExpiryDays', { defaultValue: '{{days}} days', days })}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.footerMetaRow}>
                  <View />
                </View>
              </View>
              <View style={styles.footerRight}>
                <TouchableOpacity
                  style={[styles.footerButtonGhost, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={onClose}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.footerGhostText, { color: c.textSecondary }]}>
                    {t('home.cancelAction', { defaultValue: 'Cancel' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.footerButtonGhost, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={onPreview}
                  activeOpacity={0.85}
                  disabled={!onPreview}
                >
                  <Text style={[styles.footerGhostText, { color: c.textSecondary }]}>
                    {t('home.previewAction', { defaultValue: 'Preview' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.footerButtonGhost, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                  onPress={onSaveDraft}
                  activeOpacity={0.85}
                  disabled={!!draftSaving}
                >
                  {draftSaving ? (
                    <Text style={[styles.footerGhostText, { color: c.textSecondary }]}>
                      {t('home.savingAction', { defaultValue: 'Saving...' })}
                    </Text>
                  ) : (
                    <Text style={[styles.footerGhostText, { color: c.textSecondary }]}>
                      {t('home.postComposerDraftAction', { defaultValue: 'Save as Draft' })}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.footerButtonPrimary, { backgroundColor: c.primary }]}
                  onPress={onApply}
                  activeOpacity={0.85}
                >
                  <Text style={styles.footerPrimaryText}>
                    {t('home.longPostSaveAndPublish', { defaultValue: 'Save and Publish' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </SafeAreaView>
        </Animated.View>

      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  drawer: {
    borderLeftWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: -4, height: 0 },
    elevation: 16,
  },
  drawerInner: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 14,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  headerBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorWrap: {
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  blockScroll: {
    flex: 1,
  },
  blockScrollContent: {
    flexGrow: 1,
    paddingBottom: 16,
    gap: 8,
  },
  titleCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  titleCardLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  titleInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '600',
  },
  addRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  draftOptionsLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  draftExpiryChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  draftExpiryChoice: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 42,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftExpiryChoiceText: {
    fontSize: 14,
    fontWeight: '700',
  },
  draftSavedAtText: {
    fontSize: 12,
  },
  mediaUsageText: {
    fontSize: 12,
    fontWeight: '700',
  },
  addButton: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 34,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  blockCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  lexicalWrap: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  lexicalMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
  },
  lexicalMetaRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  lexicalHint: {
    fontSize: 13,
    flexShrink: 1,
  },
  blockCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  blockCardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  blockCardTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  blockCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  blockActionButton: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockEditorGroup: {
    gap: 8,
  },
  imageUploadActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  imageUploadButton: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 32,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  imageUploadButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  imagePreviewWrap: {
    borderRadius: 10,
    overflow: 'hidden',
    height: 180,
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  imagePreviewError: {
    height: 72,
    borderWidth: 1,
    borderRadius: 10,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  imagePreviewErrorText: {
    fontSize: 13,
  },
  positionPickerWrap: {
    gap: 6,
  },
  imageFitRow: {
    gap: 6,
  },
  imageFitButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  imageFitButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  imageFitButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  imageScaleRow: {
    gap: 6,
  },
  imageScaleButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  imageScaleButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  imageScaleButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  positionPickerLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  positionGrid: {
    gap: 4,
  },
  positionRow: {
    flexDirection: 'row',
    gap: 4,
  },
  positionCell: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionCellText: {
    fontSize: 14,
    fontWeight: '600',
  },
  headingLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headingLevelButton: {
    minHeight: 30,
    minWidth: 40,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headingLevelButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  blockInput: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
  blockInputMultiline: {
    minHeight: 110,
    lineHeight: 20,
  },
  blockFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  insertAfterButton: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 32,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  insertAfterText: {
    fontSize: 12,
    fontWeight: '600',
  },
  footerError: {
    borderTopWidth: 1,
    borderWidth: 1,
    marginHorizontal: 22,
    marginTop: 10,
    borderRadius: 10,
    padding: 10,
  },
  footerErrorText: {
    fontSize: 13,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 10,
  },
  footerLeft: {
    flexShrink: 1,
    gap: 6,
    minWidth: 260,
  },
  footerMetaRow: {
    minHeight: 0,
  },
  footerRight: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  footerButtonGhost: {
    minHeight: 42,
    minWidth: 110,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerGhostText: {
    fontSize: 16,
    fontWeight: '700',
  },
  footerButtonPrimary: {
    minHeight: 42,
    minWidth: 145,
    borderRadius: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
