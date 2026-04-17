import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ApiRequestError, api } from '../api/client';
import { useTheme } from '../theme/ThemeContext';

interface InviteDrawerProps {
  visible: boolean;
  token: string;
  inviterName?: string;
  onClose: () => void;
}

const DRAWER_WIDTH = Platform.OS === 'web' ? 560 : 360;
const DURATION = 280;

type InviteMessageType = 'success' | 'info' | 'error';

export default function InviteDrawer({ visible, token, inviterName, onClose }: InviteDrawerProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const c = theme.colors;

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<InviteMessageType>('info');

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
          toValue: 1,
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
  }, [backdropOpacity, translateX, visible]);

  useEffect(() => {
    if (!visible) {
      setEmail('');
      setSending(false);
      setMessage('');
      setMessageType('info');
    }
  }, [visible]);

  const helperTitle = useMemo(() => {
    const firstName = (inviterName || '').trim().split(/\s+/)[0];
    if (!firstName) {
      return t('home.inviteDrawerHelperTitle', { defaultValue: 'Invite people to Openspace' });
    }
    return t('home.inviteDrawerHelperTitleNamed', {
      defaultValue: '{{name}} can invite people to Openspace',
      name: firstName,
    });
  }, [inviterName, t]);

  const handleSend = async () => {
    if (!email.trim() || sending) return;
    setSending(true);
    setMessage('');
    try {
      const response = await api.sendDirectInviteEmail(token, email.trim());
      if (response?.status === 'already_registered') {
        setMessageType('info');
        setMessage(
          response?.message ||
          t('home.inviteDrawerAlreadyRegistered', { defaultValue: 'That email is already registered on Openspace.' })
        );
        return;
      }

      setMessageType('success');
      setMessage(
        response?.message ||
        t('home.inviteDrawerSent', { defaultValue: 'Invite sent successfully.' })
      );
      setEmail('');
    } catch (error) {
      const fallback = t('home.inviteDrawerError', { defaultValue: 'Could not send invite. Please try again.' });
      if (error instanceof ApiRequestError) {
        setMessage(error.message || fallback);
      } else {
        setMessage(fallback);
      }
      setMessageType('error');
    } finally {
      setSending(false);
    }
  };

  const messageStyles = {
    success: { borderColor: '#2E9B4D', backgroundColor: '#EAF7EE', color: '#206C37' },
    info: { borderColor: c.border, backgroundColor: c.inputBackground, color: c.textSecondary },
    error: { borderColor: '#D14343', backgroundColor: '#FCECEC', color: '#A12E2E' },
  } as const;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        </Animated.View>
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
          <SafeAreaView style={styles.inner}>
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              <Text style={[styles.headerTitle, { color: c.textPrimary }]}>
                {t('home.sideMenuInvites', { defaultValue: 'Invites' })}
              </Text>
              <TouchableOpacity onPress={onClose} style={[styles.closeButton, { backgroundColor: c.inputBackground }]}>
                <MaterialCommunityIcons name="close" size={18} color={c.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.body}>
              <Text style={[styles.helperTitle, { color: c.textPrimary }]}>{helperTitle}</Text>
              <Text style={[styles.helperText, { color: c.textMuted }]}>
                {t('home.inviteDrawerHelperText', {
                  defaultValue: 'Send email invites as many times as you want. We will tell you if the email is already registered.',
                })}
              </Text>

              <View style={styles.formWrap}>
                <Text style={[styles.label, { color: c.textSecondary }]}>
                  {t('home.inviteDrawerEmailLabel', { defaultValue: 'Email address' })}
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={t('home.inviteDrawerEmailPlaceholder', { defaultValue: 'name@example.com' })}
                  placeholderTextColor={c.placeholder}
                  style={[
                    styles.input,
                    { borderColor: c.inputBorder, backgroundColor: c.inputBackground, color: c.textPrimary },
                  ]}
                />
              </View>

              {message ? (
                <View
                  style={[
                    styles.messageBox,
                    {
                      borderColor: messageStyles[messageType].borderColor,
                      backgroundColor: messageStyles[messageType].backgroundColor,
                    },
                  ]}
                >
                  <Text style={[styles.messageText, { color: messageStyles[messageType].color }]}>{message}</Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.footer, { borderTopColor: c.border }]}>
              <TouchableOpacity
                style={[styles.footerButton, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={onClose}
                activeOpacity={0.85}
              >
                <Text style={[styles.footerButtonText, { color: c.textSecondary }]}>
                  {t('home.inviteDrawerClose', { defaultValue: 'Close' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.footerButton,
                  styles.sendButton,
                  {
                    backgroundColor: email.trim() && !sending ? c.primary : c.inputBorder,
                    borderColor: email.trim() && !sending ? c.primary : c.inputBorder,
                  },
                ]}
                onPress={() => void handleSend()}
                activeOpacity={0.9}
                disabled={!email.trim() || sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="email-outline" size={16} color="#fff" />
                    <Text style={[styles.footerButtonText, styles.sendButtonText]}>
                      {t('home.inviteDrawerSend', { defaultValue: 'Send invite' })}
                    </Text>
                  </>
                )}
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
    backgroundColor: 'transparent',
  },
  drawer: {
    width: DRAWER_WIDTH,
    borderLeftWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: -2, height: 0 },
    elevation: 12,
  },
  inner: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 20,
    gap: 16,
  },
  helperTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  helperText: {
    fontSize: 14,
    lineHeight: 21,
  },
  formWrap: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  messageBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  messageText: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  footerButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  footerButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  sendButton: {
    minWidth: 134,
  },
  sendButtonText: {
    color: '#fff',
  },
});
