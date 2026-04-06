import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n/languages';
import { useTheme } from '../theme/ThemeContext';

const LANGUAGE_KEY = '@openspace/language';

export default function LanguagePicker() {
  const { i18n, t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(false);

  const current = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[2]; // default en

  function select(code: string) {
    i18n.changeLanguage(code);
    AsyncStorage.setItem(LANGUAGE_KEY, code);
    setOpen(false);
  }

  return (
    <>
      {/* Trigger button */}
      <TouchableOpacity
        style={[styles.trigger, { borderColor: c.border, backgroundColor: c.surface }]}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
        accessibilityLabel={t('language.current')}
      >
        <Text style={styles.triggerFlag}>{current.flag}</Text>
        <Text style={[styles.triggerLabel, { color: c.textSecondary }]}>
          {current.label}
        </Text>
        <Text style={[styles.chevron, { color: c.textMuted }]}>›</Text>
      </TouchableOpacity>

      {/* Modal */}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          {/* Stop propagation so taps inside the sheet don't close it */}
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View
              style={[
                styles.sheet,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <Text style={[styles.sheetTitle, { color: c.textPrimary }]}>
                {t('language.select')}
              </Text>

              <ScrollView
                style={styles.list}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                {LANGUAGES.map((lang, index) => {
                  const isSelected = lang.code === i18n.language;
                  return (
                    <TouchableOpacity
                      key={lang.code}
                      style={[
                        styles.option,
                        isSelected && { backgroundColor: c.inputBackground },
                        index < LANGUAGES.length - 1 && {
                          borderBottomWidth: 1,
                          borderBottomColor: c.border,
                        },
                      ]}
                      onPress={() => select(lang.code)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.optionFlag}>{lang.flag}</Text>
                      <Text
                        style={[
                          styles.optionLabel,
                          { color: isSelected ? c.primary : c.textPrimary },
                          isSelected && styles.optionLabelSelected,
                        ]}
                      >
                        {lang.label}
                      </Text>
                      {isSelected && (
                        <Text style={[styles.check, { color: c.primary }]}>✓</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const SHEET_MAX_WIDTH = 340;

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  triggerFlag: {
    fontSize: 18,
  },
  triggerLabel: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  chevron: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: -1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    borderRadius: 20,
    borderWidth: 1,
    paddingTop: 20,
    overflow: 'hidden',
    ...Platform.select({
      web: { maxHeight: 480 },
      default: { maxHeight: 440 },
    }),
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  list: {
    flexGrow: 0,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  optionFlag: {
    fontSize: 22,
  },
  optionLabel: {
    fontSize: 15,
    flex: 1,
  },
  optionLabelSelected: {
    fontWeight: '700',
  },
  check: {
    fontSize: 16,
    fontWeight: '700',
  },
});
