import React, { useMemo, useRef, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  Animated,
  TextInput,
  Image,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';

export type LongPostBlockType = 'paragraph' | 'heading' | 'quote' | 'image' | 'embed';

export type LongPostBlock = {
  id: string;
  type: LongPostBlockType;
  text?: string;
  level?: 1 | 2 | 3;
  url?: string;
  caption?: string;
  objectPosition?: string;
};

interface LongPostDrawerProps {
  visible: boolean;
  expanded: boolean;
  blocks: LongPostBlock[];
  draftExpiryDays: number;
  draftSaving?: boolean;
  draftSavedAtLabel?: string | null;
  errorMessage?: string;
  onChangeBlocks: (blocks: LongPostBlock[]) => void;
  onChangeDraftExpiryDays: (days: number) => void;
  onSaveDraft: () => void;
  onOpenDrafts: () => void;
  onClose: () => void;
  onApply: () => void;
  onToggleExpanded: () => void;
}

const DURATION = 280;

const FOCAL_POSITIONS = [
  [{ label: '↖', value: 'left top' }, { label: '↑', value: 'center top' }, { label: '↗', value: 'right top' }],
  [{ label: '←', value: 'left center' }, { label: '·', value: 'center center' }, { label: '→', value: 'right center' }],
  [{ label: '↙', value: 'left bottom' }, { label: '↓', value: 'center bottom' }, { label: '↘', value: 'right bottom' }],
];

function ImageBlockEditor({
  block,
  c,
  t,
  onUpdate,
}: {
  block: LongPostBlock;
  c: any;
  t: any;
  onUpdate: (patch: Partial<LongPostBlock>) => void;
}) {
  const [imageError, setImageError] = useState(false);
  const isValidUrl = !!block.url && block.url.startsWith('http');
  const currentPosition = block.objectPosition || 'center center';

  return (
    <View style={styles.blockEditorGroup}>
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
              Platform.OS === 'web'
                ? ({ objectFit: 'cover', objectPosition: currentPosition } as any)
                : {},
            ]}
            resizeMode="cover"
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
  blocks,
  draftExpiryDays,
  draftSaving,
  draftSavedAtLabel,
  errorMessage,
  onChangeBlocks,
  onChangeDraftExpiryDays,
  onSaveDraft,
  onOpenDrafts,
  onClose,
  onApply,
  onToggleExpanded,
}: LongPostDrawerProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;
  const { width } = useWindowDimensions();

  const drawerWidth = useMemo(() => {
    if (Platform.OS !== 'web') return width;
    if (expanded) return Math.min(1280, Math.max(980, width * 0.92));
    return Math.min(960, Math.max(720, width * 0.78));
  }, [expanded, width]);

  const translateX = useRef(new Animated.Value(drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    translateX.setValue(visible ? drawerWidth : 0);
  }, [drawerWidth, translateX, visible]);

  useEffect(() => {
    if (visible) {
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
    } else {
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
    }
  }, [visible, drawerWidth, translateX, backdropOpacity]);

  function ensureAtLeastOneBlock(next: LongPostBlock[]) {
    if (next.length > 0) return next;
    return [newBlock('paragraph')];
  }

  function addBlock(type: LongPostBlockType, index?: number) {
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

  function renderBlockEditor(block: LongPostBlock) {
    if (block.type === 'image') {
      return (
        <ImageBlockEditor
          block={block}
          c={c}
          t={t}
          onUpdate={(patch) => updateBlock(block.id, patch)}
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

        <TextInput
          style={[
            styles.blockInput,
            styles.blockInputMultiline,
            { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary },
          ]}
          multiline
          textAlignVertical="top"
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
          style={[
            styles.drawer,
            {
              width: drawerWidth,
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

                <View style={styles.draftOptionsRow}>
                  <Text style={[styles.draftOptionsLabel, { color: c.textMuted }]}>
                    {t('home.longPostDraftExpiryLabel', { defaultValue: 'Draft expiry' })}
                  </Text>
                  <View style={styles.draftExpiryChoices}>
                    {[10, 14, 20].map((days) => {
                      const selected = draftExpiryDays === days;
                      return (
                        <TouchableOpacity
                          key={`draft-expiry-${days}`}
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
                  {draftSavedAtLabel ? (
                    <Text style={[styles.draftSavedAtText, { color: c.textMuted }]}>
                      {draftSavedAtLabel}
                    </Text>
                  ) : null}
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
              </ScrollView>
            </View>

            {!!errorMessage && (
              <View style={[styles.footerError, { backgroundColor: c.errorBackground ?? '#FEF2F2', borderColor: c.errorBorder ?? '#FECACA' }]}>
                <Text style={[styles.footerErrorText, { color: c.errorText ?? '#DC2626' }]}>{errorMessage}</Text>
              </View>
            )}

            <View style={[styles.footer, { borderTopColor: c.border }]}>
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
    paddingVertical: 12,
  },
  blockScroll: {
    flex: 1,
  },
  blockScrollContent: {
    paddingBottom: 20,
    gap: 12,
  },
  addRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  draftOptionsRow: {
    gap: 8,
    marginTop: 2,
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
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  draftExpiryChoiceText: {
    fontSize: 12,
    fontWeight: '700',
  },
  draftSavedAtText: {
    fontSize: 12,
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
    fontSize: 14,
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
    justifyContent: 'flex-end',
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
