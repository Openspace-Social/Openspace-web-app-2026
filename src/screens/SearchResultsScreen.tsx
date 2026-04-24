import React from 'react';
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SearchCommunityResult, SearchHashtagResult, SearchUserResult } from '../api/client';

type Props = {
  styles: any;
  c: any;
  t: (key: string, options?: any) => string;
  isWideSearchResultsLayout: boolean;
  searchResultsQuery: string;
  searchResultsLoading: boolean;
  searchError: string;
  searchUsers: SearchUserResult[];
  searchCommunities: SearchCommunityResult[];
  searchHashtags: SearchHashtagResult[];
  hasAnySearchResults: boolean;
  onBack: () => void;
  onSelectUser: (username?: string) => void;
  onSelectCommunity: (name?: string) => void;
  onSelectHashtag: (name?: string) => void;
  /** When true, strip the outer card chrome so results run edge-to-edge. */
  isEdgeToEdge?: boolean;
};

export default function SearchResultsScreen({
  styles,
  c,
  t,
  isWideSearchResultsLayout,
  searchResultsQuery,
  searchResultsLoading,
  searchError,
  searchUsers,
  searchCommunities,
  searchHashtags,
  hasAnySearchResults,
  onBack,
  onSelectUser,
  onSelectCommunity,
  onSelectHashtag,
  isEdgeToEdge = false,
}: Props) {
  return (
    <View style={isWideSearchResultsLayout ? styles.searchResultsWideLayout : undefined}>
      {isWideSearchResultsLayout ? <View style={styles.searchResultsLeftReserve} /> : null}
      <View
        style={[
          styles.feedCard,
          isWideSearchResultsLayout ? styles.searchResultsMainCard : null,
          { backgroundColor: c.surface, borderColor: c.border },
          isEdgeToEdge && { borderWidth: 0, borderRadius: 0, paddingHorizontal: 0, marginBottom: 0, maxWidth: '100%' as const },
        ]}
      >
        <View style={styles.searchMainHeader}>
          <TouchableOpacity
            style={[styles.searchShowAllButton, styles.backToFeedButton, styles.backToFeedButtonSlim, { borderColor: c.border, backgroundColor: c.inputBackground }]}
            onPress={onBack}
            activeOpacity={0.85}
          >
            <View style={styles.backToFeedButtonContent}>
              <MaterialCommunityIcons name="arrow-left" size={16} color={c.textLink} />
              <Text style={[styles.searchShowAllButtonText, styles.backToFeedButtonText, { color: c.textLink }]}> 
                {t('home.backToHomeFeedAction')}
              </Text>
            </View>
          </TouchableOpacity>
          <Text style={[styles.searchMainTitle, { color: c.textPrimary }]}>
            {t('home.searchResultsFor', { query: searchResultsQuery })}
          </Text>
        </View>

        {searchResultsLoading ? (
          <ActivityIndicator color={c.primary} size="small" style={styles.feedLoading} />
        ) : (
          <View style={styles.searchMainSections}>
            <View style={styles.searchSection}>
              <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>{t('home.searchSectionUsers')}</Text>
              {searchUsers.length === 0 ? (
                <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>{t('home.searchNoUsers')}</Text>
              ) : (
                <View style={styles.searchTileGrid}>
                  {searchUsers.map((item) => (
                    <TouchableOpacity
                      key={`main-search-user-${item.id}`}
                      style={[styles.searchTile, isWideSearchResultsLayout ? styles.searchTileWide : null, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      activeOpacity={0.85}
                      onPress={() => onSelectUser(item.username)}
                    >
                      <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                        {item.profile?.avatar ? (
                          <Image source={{ uri: item.profile.avatar }} style={styles.searchAvatarImage} resizeMode="cover" />
                        ) : (
                          <Text style={styles.searchAvatarLetter}>{(item.username?.[0] || t('home.unknownUser')[0] || 'U').toUpperCase()}</Text>
                        )}
                      </View>
                      <View style={styles.searchResultMeta}>
                        <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>@{item.username || t('home.unknownUser')}</Text>
                        <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>{item.profile?.name || t('home.searchNoDisplayName')}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.searchSection}>
              <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>{t('home.searchSectionCommunities')}</Text>
              {searchCommunities.length === 0 ? (
                <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>{t('home.searchNoCommunities')}</Text>
              ) : (
                <View style={styles.searchTileGrid}>
                  {searchCommunities.map((item) => (
                    <TouchableOpacity
                      key={`main-search-community-${item.id}`}
                      style={[styles.searchTile, isWideSearchResultsLayout ? styles.searchTileWide : null, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      activeOpacity={0.85}
                      onPress={() => onSelectCommunity(item.name)}
                    >
                      <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                        {item.avatar ? (
                          <Image source={{ uri: item.avatar }} style={styles.searchAvatarImage} resizeMode="cover" />
                        ) : (
                          <MaterialCommunityIcons name="account-group-outline" size={16} color="#fff" />
                        )}
                      </View>
                      <View style={styles.searchResultMeta}>
                        <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>c/{item.name || t('home.unknownUser')}</Text>
                        <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>{item.title || t('home.searchNoCommunityTitle')}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.searchSection}>
              <Text style={[styles.searchSectionTitle, { color: c.textSecondary }]}>{t('home.searchSectionHashtags')}</Text>
              {searchHashtags.length === 0 ? (
                <Text style={[styles.searchSectionEmpty, { color: c.textMuted }]}>{t('home.searchNoHashtags')}</Text>
              ) : (
                <View style={styles.searchTileGrid}>
                  {searchHashtags.map((item) => (
                    <TouchableOpacity
                      key={`main-search-hashtag-${item.id}`}
                      style={[styles.searchTile, isWideSearchResultsLayout ? styles.searchTileWide : null, { borderColor: c.border, backgroundColor: c.inputBackground }]}
                      activeOpacity={0.85}
                      onPress={() => onSelectHashtag(item.name)}
                    >
                      <View style={[styles.searchAvatar, { backgroundColor: c.primary }]}>
                        {item.image || item.emoji?.image ? (
                          <Image source={{ uri: item.image || item.emoji?.image }} style={styles.searchAvatarImage} resizeMode="cover" />
                        ) : (
                          <MaterialCommunityIcons name="pound" size={16} color="#fff" />
                        )}
                      </View>
                      <View style={styles.searchResultMeta}>
                        <Text style={[styles.searchResultPrimary, { color: c.textPrimary }]}>#{item.name || t('home.unknownUser')}</Text>
                        <Text style={[styles.searchResultSecondary, { color: c.textMuted }]}>
                          {t('home.searchHashtagPostsCount', { count: item.posts_count || 0 })}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {searchError ? <Text style={[styles.searchSectionError, { color: c.errorText }]}>{searchError}</Text> : null}

            {!searchError && !hasAnySearchResults ? (
              <Text style={[styles.searchSectionEmptyGlobal, { color: c.textMuted }]}>{t('home.searchNoResults')}</Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}
