import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { useSwipeToClose } from '../hooks/useSwipeToClose';

interface TermsOfUseDrawerProps {
  visible: boolean;
  onClose: () => void;
}

const DURATION = 280;

export default function TermsOfUseDrawer({ visible, onClose }: TermsOfUseDrawerProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;
  const { width: viewportWidth } = useWindowDimensions();
  const drawerWidth = Platform.OS === 'web'
    ? Math.min(680, viewportWidth)
    : viewportWidth < 600
      ? viewportWidth
      : 340;

  const tableOfContents = (t('termsOfUse.tableOfContents', { returnObjects: true }) || []) as string[];
  const sections = (t('termsOfUse.sections', { returnObjects: true }) || []) as Array<{
    title?: string;
    paragraphs?: string[];
    bullets?: string[];
    paragraphsAfterBullets?: string[];
  }>;

  const translateX = useRef(new Animated.Value(drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const swipeHandlers = useSwipeToClose({ drawerWidth, translateX, onClose });

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
  }, [visible, drawerWidth]);

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Backdrop fades in independently */}
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        </Animated.View>

        {/* Drawer slides in from the right */}
        <Animated.View
          {...swipeHandlers}
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
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              <Text style={[styles.headerTitle, { color: c.textPrimary }]}>
                {t('footer.termsOfUse')}
              </Text>
              <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityLabel="Close">
                <Text style={[styles.closeIcon, { color: c.textSecondary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Content */}
            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.updatedAt, { color: c.textMuted }]}>
                {t('termsOfUse.updatedAt')}
              </Text>

              {/* Table of Contents */}
              <Text style={[styles.tocTitle, { color: c.textPrimary }]}>
                {t('termsOfUse.tableOfContentsTitle')}
              </Text>
              {tableOfContents.map((item, index) => (
                <Text key={`toc-${index}`} style={[styles.tocItem, { color: c.textSecondary }]}>
                  {item}
                </Text>
              ))}

              {/* Sections */}
              {sections.map((section, sectionIndex) => (
                <View key={`section-${sectionIndex}`}>
                  <View style={[styles.divider, { backgroundColor: c.border }]} />
                  {!!section.title && (
                    <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
                      {section.title}
                    </Text>
                  )}

                  {(section.paragraphs || []).map((paragraph, i) => (
                    <Text
                      key={`s${sectionIndex}-p${i}`}
                      style={[styles.paragraph, { color: c.textSecondary }]}
                    >
                      {paragraph}
                    </Text>
                  ))}

                  {(section.bullets || []).map((bullet, i) => (
                    <Text
                      key={`s${sectionIndex}-b${i}`}
                      style={[styles.bullet, { color: c.textSecondary }]}
                    >
                      {'\u2022'} {bullet}
                    </Text>
                  ))}

                  {(section.paragraphsAfterBullets || []).map((paragraph, i) => (
                    <Text
                      key={`s${sectionIndex}-pa${i}`}
                      style={[styles.paragraph, { color: c.textSecondary }]}
                    >
                      {paragraph}
                    </Text>
                  ))}
                </View>
              ))}
            </ScrollView>
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
    backgroundColor: 'transparent',
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  closeButton: {
    padding: 4,
  },
  closeIcon: {
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
  },
  updatedAt: {
    fontSize: 13,
    marginBottom: 20,
  },
  tocTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  tocItem: {
    fontSize: 13,
    lineHeight: 22,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
    lineHeight: 22,
    letterSpacing: 0.3,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 12,
  },
  bullet: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 8,
    paddingLeft: 4,
  },
  divider: {
    height: 1,
    marginVertical: 20,
  },
});
