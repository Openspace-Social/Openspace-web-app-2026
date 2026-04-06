import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Platform,
  Animated,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';

interface AboutUsDrawerProps {
  visible: boolean;
  onClose: () => void;
}

const DRAWER_WIDTH = Platform.OS === 'web' ? 680 : 340;
const DURATION = 280;

export default function AboutUsDrawer({ visible, onClose }: AboutUsDrawerProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;

  const translateX = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateX.setValue(DRAWER_WIDTH);
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
          toValue: DRAWER_WIDTH,
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
  }, [visible]);

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
          style={[
            styles.drawer,
            {
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
                {t('footer.aboutUs')}
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
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
                {t('aboutUs.shiftTitle')}
              </Text>
              <Text style={[styles.paragraph, { color: c.textSecondary }]}>
                {t('aboutUs.shiftBody')}
              </Text>

              <View style={[styles.divider, { backgroundColor: c.border }]} />

              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>
                {t('aboutUs.aboutTitle')}
              </Text>
              <Text style={[styles.paragraph, { color: c.textSecondary }]}>
                {t('aboutUs.about1')}
              </Text>
              <Text style={[styles.paragraph, { color: c.textSecondary }]}>
                {t('aboutUs.about2')}
              </Text>
              <Text style={[styles.paragraph, { color: c.textSecondary }]}>
                {t('aboutUs.about3')}
              </Text>
              <Text style={[styles.paragraph, { color: c.textSecondary }]}>
                {t('aboutUs.about4')}
              </Text>
              <Text style={[styles.paragraph, { color: c.textSecondary }]}>
                {t('aboutUs.about5')}
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
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  drawer: {
    width: DRAWER_WIDTH,
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
