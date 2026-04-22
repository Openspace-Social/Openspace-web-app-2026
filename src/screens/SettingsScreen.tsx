import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import LanguagePicker from '../components/LanguagePicker';
import { passwordPolicyHint, validatePasswordAgainstBackendPolicy } from '../utils/passwordPolicy';
import type { UserNotificationSettings } from '../api/client';
import { api } from '../api/client';

type Props = {
  c: any;
  t: (key: string, options?: any) => string;
  token?: string;
  currentEmail?: string;
  hasUsablePassword?: boolean;
  requiresCurrentPassword?: boolean;
  autoPlayMedia: boolean;
  onToggleAutoPlayMedia: () => void;
  onOpenLinkedAccounts: () => void;
  onOpenBlockedUsers: () => void;
  onNotice: (message: string) => void;
  onChangePassword: (currentPassword: string | null, newPassword: string) => Promise<void>;
  onRequestEmailChange: (newEmail: string, currentPassword: string) => Promise<void>;
  onConfirmEmailChange: (tokenOrCode: string) => Promise<string>;
  onGetNotificationSettings: () => Promise<UserNotificationSettings>;
  onUpdateNotificationSettings: (patch: Partial<UserNotificationSettings>) => Promise<UserNotificationSettings>;
  onDeleteAccount: () => void;
};

const EMAIL_CHANGE_PENDING_KEY = '@openspace/settings/email-change-pending-v1';
type PendingEmailChangeState = {
  step: 'confirm';
  email: string;
  requestedAt: number;
};

export default function SettingsScreen({
  c,
  t,
  token,
  currentEmail,
  hasUsablePassword = true,
  requiresCurrentPassword = hasUsablePassword,
  autoPlayMedia,
  onToggleAutoPlayMedia,
  onOpenLinkedAccounts,
  onOpenBlockedUsers,
  onNotice,
  onChangePassword,
  onRequestEmailChange,
  onConfirmEmailChange,
  onGetNotificationSettings,
  onUpdateNotificationSettings,
  onDeleteAccount,
}: Props) {
  const s = useStyles(c);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailStep, setEmailStep] = useState<'request' | 'confirm'>('request');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notifSettingsOpen, setNotifSettingsOpen] = useState(false);
  const [notifSettings, setNotifSettings] = useState<UserNotificationSettings | null>(null);
  const [notifSettingsLoading, setNotifSettingsLoading] = useState(false);
  const [notifSettingsSaving, setNotifSettingsSaving] = useState<Partial<Record<keyof UserNotificationSettings, boolean>>>({});
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [emailConfirmationToken, setEmailConfirmationToken] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [emailFlowHydrating, setEmailFlowHydrating] = useState(false);

  function resetPasswordForm() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  }

  function openPasswordModal() {
    resetPasswordForm();
    setPasswordModalOpen(true);
  }

  function resetEmailForm() {
    setEmailStep('request');
    setEmailValue('');
    setEmailCurrentPassword('');
    setEmailConfirmationToken('');
    setEmailError('');
  }

  async function openNotifSettings() {
    setNotifSettingsOpen(true);
    if (notifSettings) return; // already loaded
    setNotifSettingsLoading(true);
    try {
      const data = await onGetNotificationSettings();
      setNotifSettings(data);
    } catch {
      // silently ignore; user can close and retry
    } finally {
      setNotifSettingsLoading(false);
    }
  }

  async function handleNotifToggle(key: keyof UserNotificationSettings, value: boolean) {
    if (!notifSettings) return;
    // Optimistic update
    setNotifSettings((prev) => prev ? { ...prev, [key]: value } : prev);
    setNotifSettingsSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const updated = await onUpdateNotificationSettings({ [key]: value });
      setNotifSettings(updated);
    } catch {
      // Revert on failure
      setNotifSettings((prev) => prev ? { ...prev, [key]: !value } : prev);
    } finally {
      setNotifSettingsSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  const clearPendingEmailChange = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(EMAIL_CHANGE_PENDING_KEY);
    } catch {
      // ignore storage errors; flow still works without persistence
    }
  }, []);

  const persistPendingEmailChange = useCallback(async (state: PendingEmailChangeState) => {
    try {
      await AsyncStorage.setItem(EMAIL_CHANGE_PENDING_KEY, JSON.stringify(state));
    } catch {
      // ignore storage errors; flow still works without persistence
    }
  }, []);

  async function openEmailModal() {
    setEmailFlowHydrating(true);
    setEmailError('');
    setEmailConfirmationToken('');
    setEmailCurrentPassword('');
    try {
      const raw = await AsyncStorage.getItem(EMAIL_CHANGE_PENDING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PendingEmailChangeState>;
        if (parsed?.step === 'confirm') {
          setEmailStep('confirm');
          setEmailValue(`${parsed.email || ''}`.trim().toLowerCase());
          setEmailModalOpen(true);
          return;
        }
      }
    } catch {
      // ignore parse/storage errors and fall back to request mode
    } finally {
      setEmailFlowHydrating(false);
    }
    resetEmailForm();
    setEmailModalOpen(true);
  }

  async function submitEmailChangeRequest() {
    const normalizedEmail = emailValue.trim().toLowerCase();
    if (!normalizedEmail || !emailCurrentPassword) {
      setEmailError(t('settings.emailChangeAllFieldsRequired', {
        defaultValue: 'Please enter your new email and current password.',
      }));
      return;
    }
    const basicEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!basicEmailRegex.test(normalizedEmail)) {
      setEmailError(t('settings.emailInvalid', { defaultValue: 'Please enter a valid email address.' }));
      return;
    }
    setEmailSubmitting(true);
    setEmailError('');
    try {
      await onRequestEmailChange(normalizedEmail, emailCurrentPassword);
      setEmailStep('confirm');
      await persistPendingEmailChange({
        step: 'confirm',
        email: normalizedEmail,
        requestedAt: Date.now(),
      });
      onNotice(t('settings.emailChangeRequestSent', {
        defaultValue: 'Check your new email for a verification link or token.',
      }));
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('set a password')) {
        setEmailError(t('settings.emailChangeSetPasswordFirst', {
          defaultValue: 'Set a password first before changing email.',
        }));
      } else {
        setEmailError(msg || t('settings.emailChangeRequestError', {
          defaultValue: 'Could not request email change.',
        }));
      }
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function submitEmailChangeConfirm() {
    const tokenOrCode = emailConfirmationToken.trim();
    if (!tokenOrCode) {
      setEmailError(t('settings.emailChangeTokenRequired', {
        defaultValue: 'Please paste the verification token/code.',
      }));
      return;
    }
    setEmailSubmitting(true);
    setEmailError('');
    try {
      const message = await onConfirmEmailChange(tokenOrCode);
      await clearPendingEmailChange();
      setEmailModalOpen(false);
      resetEmailForm();
      onNotice(message || t('settings.emailChangeConfirmed', { defaultValue: 'Email changed successfully.' }));
    } catch (err: any) {
      setEmailError(err?.message || t('settings.emailChangeConfirmError', {
        defaultValue: 'Could not confirm email change.',
      }));
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function cancelPendingEmailChange() {
    await clearPendingEmailChange();
    setEmailStep('request');
    setEmailConfirmationToken('');
    setEmailCurrentPassword('');
    setEmailError('');
    onNotice(t('settings.emailChangePendingCanceled', {
      defaultValue: 'Pending email change canceled.',
    }));
  }

  async function submitPasswordChange() {
    if (!newPassword || !confirmPassword || (requiresCurrentPassword && !currentPassword)) {
      setPasswordError(t('settings.passwordAllFieldsRequired', { defaultValue: 'Please fill in all password fields.' }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings.passwordsDoNotMatch', { defaultValue: 'New password and confirmation do not match.' }));
      return;
    }
    const passwordValidationError = validatePasswordAgainstBackendPolicy(newPassword, t);
    if (passwordValidationError) {
      setPasswordError(passwordValidationError);
      return;
    }
    setPasswordSubmitting(true);
    setPasswordError('');
    try {
      await onChangePassword(requiresCurrentPassword ? currentPassword : null, newPassword);
      setPasswordModalOpen(false);
      resetPasswordForm();
      onNotice(t('settings.passwordUpdated', {
        defaultValue: hasUsablePassword ? 'Password updated successfully.' : 'Password set successfully.',
      }));
    } catch (err: any) {
      setPasswordError(err?.message || t('settings.passwordUpdateError', { defaultValue: 'Could not update password.' }));
    } finally {
      setPasswordSubmitting(false);
    }
  }

  return (
    <View style={[s.container, { backgroundColor: c.surface, borderColor: c.border }]}> 
      <View style={[s.header, { borderBottomColor: c.border }]}> 
        <Text style={[s.title, { color: c.textPrimary }]}>
          {t('home.sideMenuSettings', { defaultValue: 'Settings' })}
        </Text>
      </View>

      <View style={s.body}>
        <SettingsItem
          c={c}
          icon="email-edit-outline"
          title={t('settings.changeEmail', { defaultValue: 'Change Email' })}
          subtitle={currentEmail ? `${t('settings.currentEmail', { defaultValue: 'Current' })}: ${currentEmail}` : undefined}
          onPress={() => { void openEmailModal(); }}
        />

        <SettingsItem
          c={c}
          icon="form-textbox-password"
          title={hasUsablePassword
            ? t('settings.changePassword', { defaultValue: 'Change Password' })
            : t('settings.setPassword', { defaultValue: 'Set Password' })}
          onPress={openPasswordModal}
        />

        <SettingsItem
          c={c}
          icon="bell-outline"
          title={t('settings.notifications', { defaultValue: 'Notifications' })}
          subtitle={t('settings.notificationsSubtitle', { defaultValue: 'Manage which notifications you receive.' })}
          onPress={openNotifSettings}
        />

        <SettingsItem
          c={c}
          icon="play-circle-outline"
          title={t('home.settingsAutoplayMediaTitle', { defaultValue: 'Auto-play audio/video' })}
          subtitle={t('home.settingsAutoplayMediaSubtitle', {
            defaultValue: 'Automatically play videos in your feed.',
          })}
          onPress={onToggleAutoPlayMedia}
          right={
            <Switch
              value={autoPlayMedia}
              onValueChange={onToggleAutoPlayMedia}
              trackColor={{ false: '#94a3b8', true: c.primary }}
              thumbColor="#ffffff"
            />
          }
        />

        <SettingsItem
          c={c}
          icon="translate"
          title={t('settings.language', { defaultValue: 'Language (English)' })}
          right={<LanguagePicker token={token} />}
          onPress={() => {}}
          disableChevron
        />

        <SettingsItem
          c={c}
          icon="account-cog-outline"
          title={t('home.linkedAccountsTitle')}
          onPress={onOpenLinkedAccounts}
        />

        <SettingsItem
          c={c}
          icon="account-cancel-outline"
          title={t('settings.blockedUsers', { defaultValue: 'Blocked users' })}
          onPress={onOpenBlockedUsers}
        />

        <SettingsItem
          c={c}
          icon="account-remove-outline"
          title={t('settings.deleteAccount', { defaultValue: 'Delete account' })}
          subtitle={t('settings.deleteAccountSub', { defaultValue: 'Permanently remove your account and content.' })}
          onPress={() => setDeleteConfirmOpen(true)}
          danger
        />
      </View>

      <SettingsRightDrawerModal
        visible={deleteConfirmOpen}
        c={c}
        onClose={() => {
          if (!deleteSubmitting) {
            setDeleteConfirmOpen(false);
            setDeletePassword('');
            setDeleteError('');
          }
        }}
      >
        <Text style={[s.confirmTitle, { color: c.textPrimary }]}>
          {t('settings.deleteAccount', { defaultValue: 'Delete account' })}
        </Text>
        <Text style={[s.confirmText, { color: c.textSecondary }]}>
          {t('settings.deleteAccountConfirm', {
            defaultValue: 'This is permanent and cannot be undone. All your posts, comments, and data will be deleted.',
          })}
        </Text>

        <View style={s.fieldGroup}>
          <Text style={[s.fieldLabel, { color: c.textSecondary }]}>
            {t('settings.currentPassword', { defaultValue: 'Current password' })}
          </Text>
          <TextInput
            value={deletePassword}
            onChangeText={(v) => { setDeletePassword(v); setDeleteError(''); }}
            secureTextEntry
            autoCapitalize="none"
            style={[s.fieldInput, { color: c.textPrimary, borderColor: deleteError ? c.errorText : c.border, backgroundColor: c.inputBackground }]}
            placeholder={t('settings.currentPassword', { defaultValue: 'Current password' })}
            placeholderTextColor={c.placeholder}
            editable={!deleteSubmitting}
          />
        </View>

        {deleteError ? (
          <Text style={[s.errorText, { color: c.errorText }]}>{deleteError}</Text>
        ) : null}

        <View style={s.confirmActions}>
          <TouchableOpacity
            style={[s.confirmBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            onPress={() => {
              setDeleteConfirmOpen(false);
              setDeletePassword('');
              setDeleteError('');
            }}
            disabled={deleteSubmitting}
          >
            <Text style={[s.confirmBtnText, { color: c.textPrimary }]}>{t('home.cancelAction', { defaultValue: 'Cancel' })}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.confirmBtn, { borderColor: c.errorText, backgroundColor: `${c.errorText}22` }]}
            disabled={deleteSubmitting || !deletePassword}
            onPress={async () => {
              if (!token || !deletePassword) return;
              setDeleteSubmitting(true);
              setDeleteError('');
              try {
                await api.deleteAuthenticatedUser(token, deletePassword);
                setDeleteConfirmOpen(false);
                setDeletePassword('');
                onDeleteAccount();
              } catch (err: any) {
                const status = err?.status ?? err?.response?.status;
                if (status === 401 || status === 400) {
                  setDeleteError(t('settings.deleteAccountWrongPassword', { defaultValue: 'Incorrect password. Please try again.' }));
                } else {
                  setDeleteError(t('settings.deleteAccountError', { defaultValue: 'Something went wrong. Please try again.' }));
                }
              } finally {
                setDeleteSubmitting(false);
              }
            }}
          >
            {deleteSubmitting ? (
              <ActivityIndicator size="small" color={c.errorText} />
            ) : (
              <Text style={[s.confirmBtnText, { color: c.errorText }]}>{t('settings.deleteAccount', { defaultValue: 'Delete account' })}</Text>
            )}
          </TouchableOpacity>
        </View>
      </SettingsRightDrawerModal>

      <SettingsRightDrawerModal visible={passwordModalOpen} c={c} onClose={() => setPasswordModalOpen(false)}>
        <Text style={[s.confirmTitle, { color: c.textPrimary }]}>
          {hasUsablePassword
            ? t('settings.changePassword', { defaultValue: 'Change Password' })
            : t('settings.setPassword', { defaultValue: 'Set Password' })}
        </Text>

        {requiresCurrentPassword ? (
          <View style={s.fieldGroup}>
            <Text style={[s.fieldLabel, { color: c.textSecondary }]}>
              {t('settings.currentPassword', { defaultValue: 'Current password' })}
            </Text>
            <TextInput
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
              style={[s.fieldInput, { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground }]}
              placeholder={t('settings.currentPassword', { defaultValue: 'Current password' })}
              placeholderTextColor={c.placeholder}
            />
          </View>
        ) : null}

        <View style={s.fieldGroup}>
          <Text style={[s.fieldLabel, { color: c.textSecondary }]}>
            {t('settings.newPassword', { defaultValue: 'New password' })}
          </Text>
          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoCapitalize="none"
            style={[s.fieldInput, { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground }]}
            placeholder={t('settings.newPassword', { defaultValue: 'New password' })}
            placeholderTextColor={c.placeholder}
          />
          <Text style={[s.policyHintText, { color: c.textMuted }]}>
            {passwordPolicyHint(t)}
          </Text>
        </View>

        <View style={s.fieldGroup}>
          <Text style={[s.fieldLabel, { color: c.textSecondary }]}>
            {t('settings.confirmPassword', { defaultValue: 'Confirm new password' })}
          </Text>
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoCapitalize="none"
            style={[s.fieldInput, { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground }]}
            placeholder={t('settings.confirmPassword', { defaultValue: 'Confirm new password' })}
            placeholderTextColor={c.placeholder}
          />
        </View>

        {passwordError ? (
          <Text style={[s.errorText, { color: c.errorText }]}>{passwordError}</Text>
        ) : null}

        <View style={s.confirmActions}>
          <TouchableOpacity
            style={[s.confirmBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            onPress={() => setPasswordModalOpen(false)}
            disabled={passwordSubmitting}
          >
            <Text style={[s.confirmBtnText, { color: c.textPrimary }]}>{t('home.cancelAction', { defaultValue: 'Cancel' })}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.confirmBtn, { borderColor: c.primary, backgroundColor: `${c.primary}22` }]}
            onPress={() => void submitPasswordChange()}
            disabled={passwordSubmitting}
          >
            {passwordSubmitting ? (
              <ActivityIndicator size="small" color={c.primary} />
            ) : (
              <Text style={[s.confirmBtnText, { color: c.primary }]}>
                {t('settings.updatePassword', { defaultValue: 'Update password' })}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SettingsRightDrawerModal>

      <SettingsRightDrawerModal visible={emailModalOpen} c={c} onClose={() => setEmailModalOpen(false)}>
        <Text style={[s.confirmTitle, { color: c.textPrimary }]}>
          {t('settings.changeEmail', { defaultValue: 'Change Email' })}
        </Text>

        {emailFlowHydrating ? (
          <View style={s.emailHydrateState}>
            <ActivityIndicator size="small" color={c.primary} />
          </View>
        ) : null}

        {!emailFlowHydrating && emailStep === 'request' ? (
          <>
            <View style={s.fieldGroup}>
              <Text style={[s.fieldLabel, { color: c.textSecondary }]}>
                {t('settings.newEmail', { defaultValue: 'New email' })}
              </Text>
              <TextInput
                value={emailValue}
                onChangeText={setEmailValue}
                autoCapitalize="none"
                keyboardType="email-address"
                style={[s.fieldInput, { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground }]}
                placeholder={t('settings.newEmail', { defaultValue: 'New email' })}
                placeholderTextColor={c.placeholder}
              />
            </View>

            <View style={s.fieldGroup}>
              <Text style={[s.fieldLabel, { color: c.textSecondary }]}>
                {t('settings.currentPassword', { defaultValue: 'Current password' })}
              </Text>
              <TextInput
                value={emailCurrentPassword}
                onChangeText={setEmailCurrentPassword}
                secureTextEntry
                autoCapitalize="none"
                style={[s.fieldInput, { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground }]}
                placeholder={t('settings.currentPassword', { defaultValue: 'Current password' })}
                placeholderTextColor={c.placeholder}
              />
            </View>
          </>
        ) : !emailFlowHydrating ? (
          <View style={s.fieldGroup}>
            <Text style={[s.fieldLabel, { color: c.textSecondary }]}>
              {t('settings.emailChangeTokenLabel', { defaultValue: 'Verification code' })}
            </Text>
            <TextInput
              value={emailConfirmationToken}
              onChangeText={setEmailConfirmationToken}
              autoCapitalize="none"
              keyboardType="number-pad"
              style={[s.fieldInput, { color: c.textPrimary, borderColor: c.border, backgroundColor: c.inputBackground }]}
              placeholder={t('settings.emailChangeTokenPlaceholder', {
                defaultValue: 'Enter 6-digit code',
              })}
              placeholderTextColor={c.placeholder}
            />
            <Text style={[s.policyHintText, { color: c.textMuted }]}>
              {t('settings.emailChangeTokenHint', {
                defaultValue: 'Enter the 6-digit code from your email to confirm your new email.',
              })}
            </Text>
          </View>
        ) : null}

        {emailError ? (
          <Text style={[s.errorText, { color: c.errorText }]}>{emailError}</Text>
        ) : null}

        <View style={s.confirmActions}>
          {emailStep === 'confirm' ? (
            <>
              <TouchableOpacity
                style={[s.confirmBtn, { borderColor: c.errorText, backgroundColor: `${c.errorText}22` }]}
                onPress={() => { void cancelPendingEmailChange(); }}
                disabled={emailSubmitting}
              >
                <Text style={[s.confirmBtnText, { color: c.errorText }]}>
                  {t('settings.emailChangeCancelPending', {
                    defaultValue: 'Cancel pending email change',
                  })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmBtn, { borderColor: c.primary, backgroundColor: `${c.primary}22` }]}
                onPress={() => void submitEmailChangeConfirm()}
                disabled={emailSubmitting}
              >
                {emailSubmitting ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : (
                  <Text style={[s.confirmBtnText, { color: c.primary }]}>
                    {t('settings.confirmEmailChange', { defaultValue: 'Confirm change' })}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[s.confirmBtn, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                onPress={() => setEmailModalOpen(false)}
                disabled={emailSubmitting}
              >
                <Text style={[s.confirmBtnText, { color: c.textPrimary }]}>{t('home.cancelAction', { defaultValue: 'Cancel' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmBtn, { borderColor: c.primary, backgroundColor: `${c.primary}22` }]}
                onPress={() => void submitEmailChangeRequest()}
                disabled={emailSubmitting}
              >
                {emailSubmitting ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : (
                  <Text style={[s.confirmBtnText, { color: c.primary }]}>
                    {t('settings.requestEmailChange', { defaultValue: 'Send verification' })}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </SettingsRightDrawerModal>

      {/* ── Notification Settings Drawer ─────────────────────────────────── */}
      <SettingsRightDrawerModal visible={notifSettingsOpen} c={c} onClose={() => setNotifSettingsOpen(false)}>
        <Text style={[s.confirmTitle, { color: c.textPrimary }]}>
          {t('settings.notifications', { defaultValue: 'Notifications' })}
        </Text>
        <Text style={[s.confirmText, { color: c.textSecondary, marginBottom: 10 }]}>
          {t('settings.notificationsDrawerDescription', {
            defaultValue: 'Choose which notifications you want to receive.',
          })}
        </Text>

        {notifSettingsLoading || !notifSettings ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <ActivityIndicator color={c.primary} />
          </View>
        ) : (
          <>
            {/* Master toggle */}
            <NotifRow
              c={c}
              label={t('settings.notifAll', { defaultValue: 'All Notifications' })}
              description={t('settings.notifAllDesc', { defaultValue: 'Master toggle for all notifications.' })}
              value={Object.values(notifSettings).some(Boolean)}
              saving={false}
              onChange={(v) => {
                const all = Object.fromEntries(
                  (Object.keys(notifSettings) as Array<keyof UserNotificationSettings>).map((k) => [k, v])
                ) as UserNotificationSettings;
                setNotifSettings(all);
                void onUpdateNotificationSettings(all);
              }}
            />

            <NotifSectionHeader c={c} label={t('settings.notifSectionSocial', { defaultValue: 'Social & Relationships' })} />

            <NotifRow c={c}
              label={t('settings.notifFollow', { defaultValue: 'New follower' })}
              description={t('settings.notifFollowDesc', { defaultValue: 'When someone starts following you.' })}
              value={notifSettings.follow_notifications}
              saving={!!notifSettingsSaving.follow_notifications}
              onChange={(v) => void handleNotifToggle('follow_notifications', v)}
            />
            <NotifRow c={c}
              label={t('settings.notifFollowRequest', { defaultValue: 'Follow request' })}
              description={t('settings.notifFollowRequestDesc', { defaultValue: 'When someone requests to follow you.' })}
              value={notifSettings.follow_request_notifications}
              saving={!!notifSettingsSaving.follow_request_notifications}
              onChange={(v) => void handleNotifToggle('follow_request_notifications', v)}
            />
            <NotifRow c={c}
              label={t('settings.notifFollowRequestApproved', { defaultValue: 'Follow request approved' })}
              description={t('settings.notifFollowRequestApprovedDesc', { defaultValue: 'When your follow request is accepted.' })}
              value={notifSettings.follow_request_approved_notifications}
              saving={!!notifSettingsSaving.follow_request_approved_notifications}
              onChange={(v) => void handleNotifToggle('follow_request_approved_notifications', v)}
            />
            <NotifRow c={c}
              label={t('settings.notifConnectionRequest', { defaultValue: 'Connection request' })}
              description={t('settings.notifConnectionRequestDesc', { defaultValue: 'When someone wants to connect with you.' })}
              value={notifSettings.connection_request_notifications}
              saving={!!notifSettingsSaving.connection_request_notifications}
              onChange={(v) => void handleNotifToggle('connection_request_notifications', v)}
            />
            <NotifRow c={c}
              label={t('settings.notifConnectionConfirmed', { defaultValue: 'Connection confirmed' })}
              description={t('settings.notifConnectionConfirmedDesc', { defaultValue: 'When someone confirms your connection request.' })}
              value={notifSettings.connection_confirmed_notifications}
              saving={!!notifSettingsSaving.connection_confirmed_notifications}
              onChange={(v) => void handleNotifToggle('connection_confirmed_notifications', v)}
            />

            <NotifSectionHeader c={c} label={t('settings.notifSectionPosts', { defaultValue: 'Posts & Comments' })} />

            <NotifRow c={c}
              label={t('settings.notifPostComment', { defaultValue: 'Post comment' })}
              description={t('settings.notifPostCommentDesc', { defaultValue: 'When someone comments on your post or a post you\'ve commented on.' })}
              value={notifSettings.post_comment_notifications}
              saving={!!notifSettingsSaving.post_comment_notifications}
              onChange={(v) => void handleNotifToggle('post_comment_notifications', v)}
            />
            <NotifRow c={c}
              label={t('settings.notifPostCommentReply', { defaultValue: 'Comment reply' })}
              description={t('settings.notifPostCommentReplyDesc', { defaultValue: 'When someone replies to your comment.' })}
              value={notifSettings.post_comment_reply_notifications}
              saving={!!notifSettingsSaving.post_comment_reply_notifications}
              onChange={(v) => void handleNotifToggle('post_comment_reply_notifications', v)}
            />
            <NotifRow c={c}
              label={t('settings.notifPostCommentMention', { defaultValue: 'Comment mention' })}
              description={t('settings.notifPostCommentMentionDesc', { defaultValue: 'When someone @mentions you in a comment.' })}
              value={notifSettings.post_comment_user_mention_notifications}
              saving={!!notifSettingsSaving.post_comment_user_mention_notifications}
              onChange={(v) => void handleNotifToggle('post_comment_user_mention_notifications', v)}
            />
            <NotifRow c={c}
              label={t('settings.notifPostMention', { defaultValue: 'Post mention' })}
              description={t('settings.notifPostMentionDesc', { defaultValue: 'When someone @mentions you in a post.' })}
              value={notifSettings.post_user_mention_notifications}
              saving={!!notifSettingsSaving.post_user_mention_notifications}
              onChange={(v) => void handleNotifToggle('post_user_mention_notifications', v)}
            />
            <NotifRow c={c}
              label={t('settings.notifPostCommentReaction', { defaultValue: 'Comment reaction' })}
              description={t('settings.notifPostCommentReactionDesc', { defaultValue: 'When someone reacts to your comment.' })}
              value={notifSettings.post_comment_reaction_notifications}
              saving={!!notifSettingsSaving.post_comment_reaction_notifications}
              onChange={(v) => void handleNotifToggle('post_comment_reaction_notifications', v)}
            />
            <NotifRow c={c}
              label={t('settings.notifPostReaction', { defaultValue: 'Post reaction' })}
              description={t('settings.notifPostReactionDesc', { defaultValue: 'When someone reacts to your post.' })}
              value={notifSettings.post_reaction_notifications}
              saving={!!notifSettingsSaving.post_reaction_notifications}
              onChange={(v) => void handleNotifToggle('post_reaction_notifications', v)}
            />

            <NotifSectionHeader c={c} label={t('settings.notifSectionCommunity', { defaultValue: 'Communities' })} />

            <NotifRow c={c}
              label={t('settings.notifCommunityInvite', { defaultValue: 'Community invite' })}
              description={t('settings.notifCommunityInviteDesc', { defaultValue: 'When someone invites you to join a community.' })}
              value={notifSettings.community_invite_notifications}
              saving={!!notifSettingsSaving.community_invite_notifications}
              onChange={(v) => void handleNotifToggle('community_invite_notifications', v)}
            />
            <NotifRow c={c}
              label={t('settings.notifCommunityNewPost', { defaultValue: 'Community new post' })}
              description={t('settings.notifCommunityNewPostDesc', { defaultValue: 'When a new post is made in a community you follow.' })}
              value={notifSettings.community_new_post_notifications}
              saving={!!notifSettingsSaving.community_new_post_notifications}
              onChange={(v) => void handleNotifToggle('community_new_post_notifications', v)}
            />

            <NotifSectionHeader c={c} label={t('settings.notifSectionActivity', { defaultValue: 'User Activity' })} />

            <NotifRow c={c}
              label={t('settings.notifUserNewPost', { defaultValue: 'User new post' })}
              description={t('settings.notifUserNewPostDesc', { defaultValue: 'When a user you subscribe to creates a new post.' })}
              value={notifSettings.user_new_post_notifications}
              saving={!!notifSettingsSaving.user_new_post_notifications}
              onChange={(v) => void handleNotifToggle('user_new_post_notifications', v)}
            />
          </>
        )}
      </SettingsRightDrawerModal>
    </View>
  );
}

function NotifSectionHeader({ c, label }: { c: any; label: string }) {
  return (
    <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 10, marginBottom: 2, paddingHorizontal: 2 }}>
      {label}
    </Text>
  );
}

function NotifRow({
  c,
  label,
  description,
  value,
  saving,
  onChange,
}: {
  c: any;
  label: string;
  description: string;
  value: boolean;
  saving: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: c.textPrimary }}>{label}</Text>
        <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2, lineHeight: 16 }}>{description}</Text>
      </View>
      {saving ? (
        <ActivityIndicator size="small" color={c.primary} />
      ) : (
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: '#94a3b8', true: c.primary }}
          thumbColor="#ffffff"
        />
      )}
    </View>
  );
}

function SettingsItem({
  c,
  icon,
  title,
  subtitle,
  onPress,
  right,
  danger = false,
  disableChevron = false,
}: {
  c: any;
  icon: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  right?: React.ReactNode;
  danger?: boolean;
  disableChevron?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      style={[
        styles.item,
        {
          backgroundColor: c.inputBackground,
          borderColor: c.border,
        },
      ]}
    >
      <MaterialCommunityIcons name={icon as any} size={20} color={danger ? c.errorText : c.textSecondary} />
      <View style={styles.itemMeta}>
        <Text style={[styles.itemTitle, { color: danger ? c.errorText : c.textPrimary }]}>{title}</Text>
        {subtitle ? <Text style={[styles.itemSubtitle, { color: c.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {right || (disableChevron ? null : <MaterialCommunityIcons name="chevron-right" size={20} color={c.textMuted} />)}
    </TouchableOpacity>
  );
}

function useStyles(c: any) {
  return StyleSheet.create({
    container: {
      width: '100%',
      maxWidth: 1280,
      alignSelf: 'center',
      borderWidth: 1,
      borderRadius: 24,
      overflow: 'hidden',
    },
    header: {
      paddingHorizontal: 30,
      paddingVertical: 24,
      borderBottomWidth: 1,
    },
    title: {
      fontSize: 56,
      fontWeight: '800',
      letterSpacing: -0.8,
      lineHeight: 62,
    },
    body: {
      paddingHorizontal: 24,
      paddingVertical: 20,
      gap: 10,
    },
    confirmTitle: {
      fontSize: 20,
      fontWeight: '800',
    },
    confirmText: {
      fontSize: 14,
      lineHeight: 20,
    },
    confirmActions: {
      marginTop: 8,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
    },
    fieldGroup: {
      gap: 6,
      marginTop: 4,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
    },
    fieldInput: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      fontWeight: '500',
    },
    errorText: {
      fontSize: 13,
      fontWeight: '600',
      marginTop: 6,
    },
    policyHintText: {
      fontSize: 12,
      fontWeight: '500',
      lineHeight: 16,
      marginTop: 2,
    },
    confirmBtn: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    confirmBtnText: {
      fontSize: 14,
      fontWeight: '700',
    },
    emailHydrateState: {
      minHeight: 60,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}

function SettingsRightDrawerModal({
  visible,
  c,
  onClose,
  children,
}: {
  visible: boolean;
  c: any;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const drawerWidth = Math.min(420, screenWidth * 0.88);
  const translateX = React.useRef(new Animated.Value(drawerWidth)).current;
  const opacity = React.useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  React.useEffect(() => {
    if (visible) {
      setMounted(true);
      translateX.setValue(drawerWidth);
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: drawerWidth,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start(() => setMounted(false));
    }
  }, [visible, drawerWidth, opacity, translateX]);

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.drawerBackdropHitArea} onPress={onClose} />
      <Animated.View pointerEvents="none" style={[styles.drawerBackdrop, { opacity }]} />
      <Animated.View
        style={[
          styles.drawerPanel,
          {
            width: drawerWidth,
            backgroundColor: c.surface,
            borderColor: c.border,
            transform: [{ translateX }],
          },
        ]}
      >
        <ScrollView
          style={styles.drawerScroll}
          contentContainerStyle={styles.drawerScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  drawerBackdropHitArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  drawerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'flex-end',
    justifyContent: 'stretch',
  },
  drawerPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    borderLeftWidth: 1,
    paddingTop: 22,
    paddingHorizontal: 18,
    paddingBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 24,
  },
  drawerScroll: {
    flex: 1,
  },
  drawerScrollContent: {
    gap: 10,
    paddingBottom: 20,
  },
  item: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  itemSubtitle: {
    fontSize: 13,
    fontWeight: '500',
  },
});
