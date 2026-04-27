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

interface GuidelinesDrawerProps {
  visible: boolean;
  onClose: () => void;
}

const DURATION = 280;

export default function GuidelinesDrawer({ visible, onClose }: GuidelinesDrawerProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;
  const { width: viewportWidth } = useWindowDimensions();
  const drawerWidth = Platform.OS === 'web'
    ? Math.min(680, viewportWidth)
    : viewportWidth < 600
      ? viewportWidth
      : 340;
  const sections = (t('guidelines.sections', { returnObjects: true }) || []) as Array<{
    title?: string;
    body?: string;
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
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        </Animated.View>

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
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              <Text style={[styles.headerTitle, { color: c.textPrimary }]}>
                {t('guidelines.title')}
              </Text>
              <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityLabel="Close">
                <Text style={[styles.closeIcon, { color: c.textSecondary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.paragraph, { color: c.textSecondary }]}>
                {t('guidelines.intro')}
              </Text>

              {sections.map((section, sectionIndex) => (
                <View key={`section-${sectionIndex}`}>
                  <View style={[styles.divider, { backgroundColor: c.border }]} />
                  {!!section.title && (
                    <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
                      {section.title}
                    </Text>
                  )}
                  {!!section.body && (
                    <Text style={[styles.paragraph, { color: c.textSecondary }]}>
                      {section.body}
                    </Text>
                  )}
                </View>
              ))}

              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <Text style={[styles.paragraph, { color: c.textSecondary }]}>
                {t('guidelines.outro')}
              </Text>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
                {t('guidelines.contact')}
              </Text>
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
    flex: 1,
    paddingRight: 12,
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
    marginVertical: 16,
  },
});
