import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSwipeToClose } from '../hooks/useSwipeToClose';

type ProfileVisibility = 'P' | 'O' | 'T';

type Panel = 'main' | 'details' | 'followers' | 'communityPosts' | 'visibility';

type Props = {
  visible: boolean;
  onClose: () => void;
  // Theme + i18n (passed from parent)
  c: any;
  t: (key: string, options?: any) => string;
  // Form state
  editUsername: string;
  setEditUsername: (v: string) => void;
  editName: string;
  setEditName: (v: string) => void;
  editLocation: string;
  setEditLocation: (v: string) => void;
  editBio: string;
  setEditBio: (v: string) => void;
  editUrl: string;
  setEditUrl: (v: string) => void;
  editFollowersCountVisible: boolean;
  setEditFollowersCountVisible: (v: boolean) => void;
  editCommunityPostsVisible: boolean;
  setEditCommunityPostsVisible: (v: boolean) => void;
  editProfileVisibility: ProfileVisibility;
  setEditProfileVisibility: (v: ProfileVisibility) => void;
  savingProfile: boolean;
  onSave: () => void;
};

export default function EditProfileDrawer({
  visible,
  onClose,
  c,
  t,
  editUsername, setEditUsername,
  editName, setEditName,
  editLocation, setEditLocation,
  editBio, setEditBio,
  editUrl, setEditUrl,
  editFollowersCountVisible, setEditFollowersCountVisible,
  editCommunityPostsVisible, setEditCommunityPostsVisible,
  editProfileVisibility, setEditProfileVisibility,
  savingProfile,
  onSave,
}: Props) {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(480, width * 0.92);
  const translateX = useRef(new Animated.Value(drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const swipeHandlers = useSwipeToClose({ drawerWidth, translateX, onClose });
  const [mounted, setMounted] = useState(false);
  const [panel, setPanel] = useState<Panel>('main');

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setPanel('main');
      translateX.setValue(drawerWidth);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, { toValue: drawerWidth, duration: 240, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 0, duration: 240, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible, drawerWidth, translateX, backdropOpacity]);

  const title = useMemo(() => {
    switch (panel) {
      case 'main': return t('home.profileEditProfileAction', { defaultValue: 'Edit Profile' });
      case 'details': return t('home.profileEditDetailsTitle', { defaultValue: 'Details' });
      case 'followers': return t('home.profileFollowersCountTitle', { defaultValue: 'Followers count' });
      case 'communityPosts': return t('home.profileCommunityPostsTitle', { defaultValue: 'Community posts' });
      case 'visibility': return t('home.profileVisibilityTitle', { defaultValue: 'Visibility' });
      default: return '';
    }
  }, [panel, t]);

  function renderHeader() {
    const showBack = panel !== 'main';
    return (
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {showBack ? (
            <TouchableOpacity
              onPress={() => setPanel('main')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="arrow-left" size={20} color={c.textSecondary} />
            </TouchableOpacity>
          ) : null}
          <Text style={{ fontSize: 18, fontWeight: '800', color: c.textPrimary }}>{title}</Text>
        </View>
        {!showBack ? (
          <TouchableOpacity
            onPress={savingProfile ? undefined : onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialCommunityIcons name="close" size={22} color={c.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  function renderMenuItem(icon: string, label: string, sublabel: string, target: Panel) {
    return (
      <TouchableOpacity
        key={target}
        onPress={() => setPanel(target)}
        style={{
          flexDirection: 'row',
          gap: 14,
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}
      >
        <MaterialCommunityIcons name={icon as any} size={22} color={c.textSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: c.textPrimary }}>{label}</Text>
          <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 2 }}>{sublabel}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={c.textMuted} />
      </TouchableOpacity>
    );
  }

  function renderMain() {
    return (
      <>
        {renderMenuItem(
          'pencil-outline',
          t('home.profileEditDetailsTitle', { defaultValue: 'Details' }),
          t('home.profileEditDetailsSubtitle', { defaultValue: 'Change your username, name, url, location and bio.' }),
          'details',
        )}
        {renderMenuItem(
          'account-group-outline',
          t('home.profileFollowersCountTitle', { defaultValue: 'Followers count' }),
          t('home.profileFollowersCountSubtitle', { defaultValue: 'Display the number of people that follow you.' }),
          'followers',
        )}
        {renderMenuItem(
          'share-variant-outline',
          t('home.profileCommunityPostsTitle', { defaultValue: 'Community posts' }),
          t('home.profileCommunityPostsSubtitle', { defaultValue: 'Display posts you share with public communities.' }),
          'communityPosts',
        )}
        {renderMenuItem(
          'eye-outline',
          t('home.profileVisibilityTitle', { defaultValue: 'Visibility' }),
          t('home.profileVisibilitySubtitleSummary', { defaultValue: 'Control who can see your profile.' }),
          'visibility',
        )}
      </>
    );
  }

  function renderDetails() {
    return (
      <View style={{ padding: 16, gap: 10 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {t('auth.username', { defaultValue: 'Username' })}
          </Text>
          <TextInput
            value={editUsername}
            onChangeText={setEditUsername}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor: c.inputBorder || c.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: c.textPrimary,
              backgroundColor: c.inputBackground,
            }}
            placeholderTextColor={c.textMuted}
            placeholder={t('auth.usernamePlaceholder', { defaultValue: 'Enter your username' })}
          />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {t('home.profileNameLabel', { defaultValue: 'Name' })}
          </Text>
          <TextInput
            value={editName}
            onChangeText={setEditName}
            style={{
              borderWidth: 1,
              borderColor: c.inputBorder || c.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: c.textPrimary,
              backgroundColor: c.inputBackground,
            }}
            placeholderTextColor={c.textMuted}
            placeholder={t('home.profileNamePlaceholder', { defaultValue: 'Enter your name' })}
          />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {t('home.profileLocationLabel', { defaultValue: 'Location' })}
          </Text>
          <TextInput
            value={editLocation}
            onChangeText={setEditLocation}
            style={{
              borderWidth: 1,
              borderColor: c.inputBorder || c.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: c.textPrimary,
              backgroundColor: c.inputBackground,
            }}
            placeholderTextColor={c.textMuted}
            placeholder={t('home.profileLocationPlaceholder', { defaultValue: 'Enter your location' })}
          />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {t('home.profileUrlLabel', { defaultValue: 'URL' })}
          </Text>
          <TextInput
            value={editUrl}
            onChangeText={setEditUrl}
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor: c.inputBorder || c.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: c.textPrimary,
              backgroundColor: c.inputBackground,
            }}
            placeholderTextColor={c.textMuted}
            placeholder={t('home.profileUrlPlaceholder', { defaultValue: 'Enter your URL' })}
          />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {t('home.profileBioLabel', { defaultValue: 'Bio' })}
          </Text>
          <TextInput
            value={editBio}
            onChangeText={setEditBio}
            multiline
            numberOfLines={6}
            style={{
              borderWidth: 1,
              borderColor: c.inputBorder || c.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              minHeight: 120,
              color: c.textPrimary,
              backgroundColor: c.inputBackground,
              textAlignVertical: 'top',
            }}
            placeholderTextColor={c.textMuted}
            placeholder={t('home.profileBioPlaceholder', { defaultValue: 'Tell people about yourself' })}
          />
        </View>

        {/* Save / Cancel */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
          <TouchableOpacity
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.inputBackground,
            }}
            activeOpacity={0.85}
            onPress={onClose}
            disabled={savingProfile}
          >
            <Text style={{ fontWeight: '700', color: c.textPrimary }}>
              {t('home.cancelAction', { defaultValue: 'Cancel' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: c.primary,
            }}
            activeOpacity={0.85}
            onPress={onSave}
            disabled={savingProfile}
          >
            {savingProfile ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={{ fontWeight: '700', color: '#fff' }}>
                {t('home.saveAction', { defaultValue: 'Save' })}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderFollowers() {
    return (
      <View style={{ padding: 16, gap: 14 }}>
        <Text style={{ fontSize: 14, color: c.textSecondary, lineHeight: 20 }}>
          {t('home.profileFollowersCountSubtitle', {
            defaultValue: 'Display the number of people that follow you, on your profile.',
          })}
        </Text>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 14,
          paddingVertical: 14,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 10,
          backgroundColor: c.inputBackground,
        }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: c.textPrimary }}>
            {t('home.profileFollowersCountTitle', { defaultValue: 'Followers count' })}
          </Text>
          <Switch
            value={editFollowersCountVisible}
            onValueChange={setEditFollowersCountVisible}
            thumbColor="#ffffff"
            trackColor={{ false: '#b8c2d3', true: c.primary }}
          />
        </View>
        <TouchableOpacity
          style={{
            alignItems: 'center',
            paddingVertical: 12,
            borderRadius: 10,
            backgroundColor: c.primary,
            marginTop: 4,
          }}
          activeOpacity={0.85}
          onPress={onSave}
          disabled={savingProfile}
        >
          {savingProfile ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ fontWeight: '700', color: '#fff' }}>
              {t('home.saveAction', { defaultValue: 'Save' })}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  function renderCommunityPosts() {
    return (
      <View style={{ padding: 16, gap: 14 }}>
        <Text style={{ fontSize: 14, color: c.textSecondary, lineHeight: 20 }}>
          {t('home.profileCommunityPostsSubtitle', {
            defaultValue: 'Display posts you share with public communities, on your profile.',
          })}
        </Text>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 14,
          paddingVertical: 14,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 10,
          backgroundColor: c.inputBackground,
        }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: c.textPrimary }}>
            {t('home.profileCommunityPostsTitle', { defaultValue: 'Community posts' })}
          </Text>
          <Switch
            value={editCommunityPostsVisible}
            onValueChange={setEditCommunityPostsVisible}
            thumbColor="#ffffff"
            trackColor={{ false: '#b8c2d3', true: c.primary }}
          />
        </View>
        <TouchableOpacity
          style={{
            alignItems: 'center',
            paddingVertical: 12,
            borderRadius: 10,
            backgroundColor: c.primary,
            marginTop: 4,
          }}
          activeOpacity={0.85}
          onPress={onSave}
          disabled={savingProfile}
        >
          {savingProfile ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ fontWeight: '700', color: '#fff' }}>
              {t('home.saveAction', { defaultValue: 'Save' })}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  function renderVisibility() {
    const options: Array<{
      value: ProfileVisibility;
      icon: string;
      title: string;
      subtitle: string;
    }> = [
      {
        value: 'P',
        icon: 'earth',
        title: t('home.profileVisibilityPublicTitle', { defaultValue: 'Public' }),
        subtitle: t('home.profileVisibilityPublicSubtitle', {
          defaultValue: 'Everyone on the internet can see your profile.',
        }),
      },
      {
        value: 'O',
        icon: 'account-group-outline',
        title: t('home.profileVisibilityOkunaTitle', { defaultValue: 'Openspace' }),
        subtitle: t('home.profileVisibilityOkunaSubtitle', {
          defaultValue: 'Only members of Openspace can see your profile.',
        }),
      },
      {
        value: 'T',
        icon: 'lock-outline',
        title: t('home.profileVisibilityPrivateTitle', { defaultValue: 'Private' }),
        subtitle: t('home.profileVisibilityPrivateSubtitle', {
          defaultValue: 'Only people you approve can see your profile.',
        }),
      },
    ];

    return (
      <View style={{ paddingVertical: 8 }}>
        {options.map((option) => {
          const selected = editProfileVisibility === option.value;
          return (
            <Pressable
              key={`visibility-${option.value}`}
              onPress={() => setEditProfileVisibility(option.value)}
              style={{
                flexDirection: 'row',
                gap: 14,
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: c.border,
                backgroundColor: selected ? (c.primarySubtle || c.inputBackground) : 'transparent',
              }}
            >
              <MaterialCommunityIcons name={option.icon as any} size={22} color={selected ? c.primary : c.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: selected ? c.primary : c.textPrimary }}>
                  {option.title}
                </Text>
                <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 2 }}>
                  {option.subtitle}
                </Text>
              </View>
              <MaterialCommunityIcons
                name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                size={22}
                color={selected ? c.primary : c.textMuted}
              />
            </Pressable>
          );
        })}
        <View style={{ padding: 16 }}>
          <TouchableOpacity
            style={{
              alignItems: 'center',
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: c.primary,
            }}
            activeOpacity={0.85}
            onPress={onSave}
            disabled={savingProfile}
          >
            {savingProfile ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={{ fontWeight: '700', color: '#fff' }}>
                {t('home.saveAction', { defaultValue: 'Save' })}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      {/* Backdrop */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.45)',
          opacity: backdropOpacity,
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={savingProfile ? undefined : onClose} />
      </Animated.View>

      {/* Drawer panel */}
      <Animated.View
        {...swipeHandlers}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: drawerWidth,
          backgroundColor: c.surface,
          transform: [{ translateX }],
          shadowColor: '#000',
          shadowOffset: { width: -4, height: 0 },
          shadowOpacity: 0.2,
          shadowRadius: 18,
          elevation: 20,
          flexDirection: 'column',
        }}
      >
        {renderHeader()}
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {panel === 'main' ? renderMain() : null}
          {panel === 'details' ? renderDetails() : null}
          {panel === 'followers' ? renderFollowers() : null}
          {panel === 'communityPosts' ? renderCommunityPosts() : null}
          {panel === 'visibility' ? renderVisibility() : null}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}
