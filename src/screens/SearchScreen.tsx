/**
 * SearchScreen — native unified Openspace search.
 *
 * Single scrollable view showing 5–6 results from each of People /
 * Communities / Hashtags simultaneously. Each section has a "Show all
 * results" link that navigates to a dedicated infinite-scroll results
 * screen for that section. Mirrors the web /search page UX without
 * forcing the user to switch tabs to peek at the other categories.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  api,
  type SearchCommunityResult,
  type SearchHashtagResult,
  type SearchUserResult,
} from '../api/client';

const DEBOUNCE_MS = 280;
const SECTION_LIMIT = 6;

type Props = {
  token: string;
  c: any;
  t: (key: string, options?: any) => string;
  onClose: () => void;
  onOpenProfile: (username: string) => void;
  onOpenCommunity: (name: string) => void;
  onOpenHashtag: (name: string) => void;
  onShowAll: (kind: 'people' | 'communities' | 'hashtags', query: string) => void;
};

export default function SearchScreen({
  token,
  c,
  t,
  onClose,
  onOpenProfile,
  onOpenCommunity,
  onOpenHashtag,
  onShowAll,
}: Props) {
  const s = useMemo(() => makeStyles(c), [c]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<SearchUserResult[]>([]);
  const [communities, setCommunities] = useState<SearchCommunityResult[]>([]);
  const [hashtags, setHashtags] = useState<SearchHashtagResult[]>([]);
  const seqRef = useRef(0);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const handle = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(handle);
  }, []);

  // Fetch all three sections in parallel on debounced query change.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setUsers([]); setCommunities([]); setHashtags([]); setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      const results = await Promise.allSettled([
        api.searchUsers(token, trimmed, SECTION_LIMIT),
        api.searchCommunities(token, trimmed, SECTION_LIMIT),
        api.searchHashtags(token, trimmed, SECTION_LIMIT),
      ]);
      if (seqRef.current !== seq) return;
      setUsers(results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : []);
      setCommunities(results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : []);
      setHashtags(results[2].status === 'fulfilled' && Array.isArray(results[2].value) ? results[2].value : []);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, token]);

  const handleOpen = useCallback((target: 'profile' | 'community' | 'hashtag', value: string) => {
    if (!value) return;
    onClose();
    setTimeout(() => {
      if (target === 'profile') onOpenProfile(value);
      else if (target === 'community') onOpenCommunity(value);
      else onOpenHashtag(value);
    }, 80);
  }, [onClose, onOpenProfile, onOpenCommunity, onOpenHashtag]);

  const handleShowAll = useCallback((kind: 'people' | 'communities' | 'hashtags') => {
    const trimmed = query.trim();
    if (!trimmed) return;
    onClose();
    setTimeout(() => onShowAll(kind, trimmed), 80);
  }, [query, onClose, onShowAll]);

  const trimmed = query.trim();
  const hasResults = users.length + communities.length + hashtags.length > 0;

  return (
    <KeyboardAvoidingView style={[s.root, { backgroundColor: c.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Top bar */}
      <View style={[s.topBar, { borderBottomColor: c.border, backgroundColor: c.surface }]}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialCommunityIcons name="close" size={22} color={c.textSecondary} />
        </TouchableOpacity>
        <View style={[s.searchPill, { backgroundColor: c.inputBackground, borderColor: c.border }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={c.textMuted} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder={t('home.searchPlaceholder', { defaultValue: 'Search Openspace' })}
            placeholderTextColor={c.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[s.searchInput, { color: c.textPrimary }]}
          />
          {query ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialCommunityIcons name="close-circle" size={16} color={c.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Body */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {!trimmed ? (
          <View style={s.placeholderWrap}>
            <MaterialCommunityIcons name="magnify" size={28} color={c.textMuted} />
            <Text style={[s.placeholderText, { color: c.textMuted }]}>
              {t('home.searchPromptStart', { defaultValue: 'Start typing to search.' })}
            </Text>
          </View>
        ) : loading && !hasResults ? (
          <ActivityIndicator color={c.primary} size="small" style={{ marginTop: 30 }} />
        ) : !hasResults ? (
          <View style={s.placeholderWrap}>
            <Text style={[s.placeholderText, { color: c.textMuted }]}>
              {t('home.searchNoResults', { defaultValue: 'No results match that search.' })}
            </Text>
          </View>
        ) : (
          <>
            {/* People */}
            {users.length > 0 ? (
              <Section
                c={c}
                title={t('home.searchTabPeople', { defaultValue: 'People' })}
                icon="account-multiple-outline"
                onShowAll={() => handleShowAll('people')}
                showAllLabel={t('home.searchShowAllResults', { defaultValue: 'Show all results' })}
              >
                {users.map((u) => {
                  const initial = (u.profile?.name?.[0] || u.username?.[0] || '?').toUpperCase();
                  return (
                    <TouchableOpacity
                      key={`user-${u.id}`}
                      style={[s.row, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      activeOpacity={0.85}
                      onPress={() => handleOpen('profile', u.username || '')}
                    >
                      <View style={[s.avatar, { backgroundColor: c.primary }]}>
                        {u.profile?.avatar ? (
                          <Image source={{ uri: u.profile.avatar }} style={s.avatarImage} resizeMode="cover" />
                        ) : (
                          <Text style={s.avatarLetter}>{initial}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        {u.profile?.name ? (
                          <Text style={[s.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>{u.profile.name}</Text>
                        ) : null}
                        <Text style={[s.rowSub, { color: c.textMuted }]} numberOfLines={1}>@{u.username}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </Section>
            ) : null}

            {/* Communities */}
            {communities.length > 0 ? (
              <Section
                c={c}
                title={t('home.searchTabCommunities', { defaultValue: 'Communities' })}
                icon="account-group-outline"
                onShowAll={() => handleShowAll('communities')}
                showAllLabel={t('home.searchShowAllResults', { defaultValue: 'Show all results' })}
              >
                {communities.map((com) => {
                  const initial = (com.title?.[0] || com.name?.[0] || 'C').toUpperCase();
                  return (
                    <TouchableOpacity
                      key={`com-${com.id}`}
                      style={[s.row, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      activeOpacity={0.85}
                      onPress={() => handleOpen('community', com.name || '')}
                    >
                      <View style={[s.avatar, { backgroundColor: com.color || c.primary }]}>
                        {com.avatar ? (
                          <Image source={{ uri: com.avatar }} style={s.avatarImage} resizeMode="cover" />
                        ) : (
                          <Text style={s.avatarLetter}>{initial}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>{com.title || com.name}</Text>
                        <Text style={[s.rowSub, { color: c.textMuted }]} numberOfLines={1}>
                          {`c/${com.name}`}{typeof com.members_count === 'number' ? ` · ${com.members_count} ${t('home.communityMembersStat', { count: com.members_count, defaultValue: 'members' })}` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </Section>
            ) : null}

            {/* Hashtags */}
            {hashtags.length > 0 ? (
              <Section
                c={c}
                title={t('home.searchTabHashtags', { defaultValue: 'Hashtags' })}
                icon="pound"
                onShowAll={() => handleShowAll('hashtags')}
                showAllLabel={t('home.searchShowAllResults', { defaultValue: 'Show all results' })}
              >
                {hashtags.map((h) => (
                  <TouchableOpacity
                    key={`tag-${h.id}`}
                    style={[s.row, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                    activeOpacity={0.85}
                    onPress={() => handleOpen('hashtag', h.name || '')}
                  >
                    <View style={[s.avatar, { backgroundColor: c.primary }]}>
                      {h.image ? (
                        <Image source={{ uri: h.image }} style={s.avatarImage} resizeMode="cover" />
                      ) : h.emoji?.image ? (
                        <Image source={{ uri: h.emoji.image }} style={{ width: 24, height: 24 }} resizeMode="contain" />
                      ) : (
                        <MaterialCommunityIcons name="pound" size={22} color="#fff" />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>#{h.name}</Text>
                      {typeof h.posts_count === 'number' ? (
                        <Text style={[s.rowSub, { color: c.textMuted }]} numberOfLines={1}>
                          {`${h.posts_count} ${t('home.hashtagPostsStat', { count: h.posts_count, defaultValue: 'posts' })}`}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </Section>
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({
  c,
  title,
  icon,
  onShowAll,
  showAllLabel,
  children,
}: {
  c: any;
  title: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  onShowAll: () => void;
  showAllLabel: string;
  children: React.ReactNode;
}) {
  return (
    <View style={sectionStyles.wrap}>
      <View style={sectionStyles.header}>
        <MaterialCommunityIcons name={icon} size={18} color={c.textPrimary} />
        <Text style={[sectionStyles.title, { color: c.textPrimary }]}>{title}</Text>
        <TouchableOpacity onPress={onShowAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={sectionStyles.right}>
          <Text style={[sectionStyles.showAll, { color: c.primary }]}>{showAllLabel}</Text>
        </TouchableOpacity>
      </View>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  wrap: { gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  right: { marginLeft: 'auto' },
  showAll: { fontSize: 12, fontWeight: '700' },
});

const makeStyles = (c: any) =>
  StyleSheet.create({
    root: { flex: 1 },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
    },
    searchPill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },

    bodyContent: { padding: 12, paddingBottom: 80, gap: 18 },

    placeholderWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10, paddingHorizontal: 32 },
    placeholderText: { fontSize: 13, textAlign: 'center', lineHeight: 18 },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: 1,
      borderRadius: 12,
      padding: 10,
    },
    avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    avatarImage: { width: '100%', height: '100%' },
    avatarLetter: { color: '#fff', fontWeight: '900', fontSize: 18 },
    rowTitle: { fontSize: 14, fontWeight: '800' },
    rowSub: { fontSize: 12, marginTop: 2 },
  });
