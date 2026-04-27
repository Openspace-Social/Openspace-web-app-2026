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

interface PrivacyPolicyDrawerProps {
  visible: boolean;
  onClose: () => void;
}

const DURATION = 280;

export default function PrivacyPolicyDrawer({ visible, onClose }: PrivacyPolicyDrawerProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;
  const { width: viewportWidth } = useWindowDimensions();
  const drawerWidth = Platform.OS === 'web'
    ? Math.min(680, viewportWidth)
    : viewportWidth < 600
      ? viewportWidth
      : 340;
  const sections = (t('privacyPolicy.sections', { returnObjects: true }) || []) as Array<{
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
          toValue: 0,
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
                {t('footer.privacyPolicy')}
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
              <Text style={[styles.paragraph, { color: c.textSecondary }]}>
                {t('privacyPolicy.updatedAt')}
              </Text>

              {sections.map((section, sectionIndex) => (
                <View key={`section-${sectionIndex}`}>
                  <View style={[styles.divider, { backgroundColor: c.border }]} />
                  {!!section.title && (
                    <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
                      {section.title}
                    </Text>
                  )}

                  {(section.paragraphs || []).map((paragraph, paragraphIndex) => (
                    <Text
                      key={`section-${sectionIndex}-paragraph-${paragraphIndex}`}
                      style={[styles.paragraph, { color: c.textSecondary }]}
                    >
                      {paragraph}
                    </Text>
                  ))}

                  {(section.bullets || []).map((bullet, bulletIndex) => (
                    <Text
                      key={`section-${sectionIndex}-bullet-${bulletIndex}`}
                      style={[styles.paragraph, { color: c.textSecondary }]}
                    >
                      {'\u2022'} {bullet}
                    </Text>
                  ))}

                  {(section.paragraphsAfterBullets || []).map((paragraph, paragraphIndex) => (
                    <Text
                      key={`section-${sectionIndex}-paragraph-after-${paragraphIndex}`}
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
    paddingTop: 24,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
    lineHeight: 24,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 16,
  },
  divider: {
    height: 1,
    marginVertical: 24,
  },
});
