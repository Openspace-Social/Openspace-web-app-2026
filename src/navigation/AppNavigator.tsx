/**
 * AppNavigator — react-navigation tree being built out incrementally.
 *
 * Status: shell is live, placeholders still inside each tab's Stack. The
 * custom routing in App.tsx remains the source of truth unless the feature
 * flag `USE_NEW_NAVIGATOR` is flipped on — at which point this tree renders
 * instead. That lets us demo the navigation UX (swipe-back, per-tab stacks,
 * hardware back) before migrating real screens over one by one.
 *
 * Migration order (subsequent sessions):
 *   1. Auth gate + Landing/PublicPost for the unauthed stack — done here.
 *   2. FeedScreen → replaces HomeTab's Feed placeholder.
 *   3. CommunitiesScreen → CommunitiesTab's root.
 *   4. MyProfileScreen → ProfileTab's root.
 *   5. Remaining pushed screens (PostDetail, PublicProfile, Community,
 *      Hashtag, Search, Circles, Lists, Followers, Following, Settings, etc.).
 *   6. Delete the old routing + HomeScreen's route-switcher.
 *   7. Flip flag default to on, wire deep-linking config.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { createNativeStackNavigator, type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation, type LinkingOptions } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import CustomTabBar from './CustomTabBar';
import FeedHeader from './FeedHeader';
import FeedTopTabs from './FeedTopTabs';
import SettingsScreenContainer from './screens/SettingsScreenContainer';
import LandingScreenContainer from './screens/LandingScreenContainer';
import PublicPostScreenContainer from './screens/PublicPostScreenContainer';
import CommunitiesScreenContainer from './screens/CommunitiesScreenContainer';
import CirclesScreenContainer from './screens/CirclesScreenContainer';
import ListsScreenContainer from './screens/ListsScreenContainer';
import {
  FollowersScreenContainer,
  FollowingScreenContainer,
  BlockedScreenContainer,
} from './screens/FollowPeopleScreenContainer';
import ManageCommunitiesScreenContainer from './screens/ManageCommunitiesScreenContainer';
import ManageCommunityScreenContainer from './screens/ManageCommunityScreenContainer';
import MutedCommunitiesScreenContainer from './screens/MutedCommunitiesScreenContainer';
import LinkedAccountsScreenContainer from './screens/LinkedAccountsScreenContainer';
import ModerationPenaltiesScreenContainer from './screens/ModerationPenaltiesScreenContainer';
import ModerationTasksScreenContainer from './screens/ModerationTasksScreenContainer';
import AlertsScreenContainer from './screens/AlertsScreenContainer';
import PostComposerScreenContainer from './screens/PostComposerScreenContainer';
import CommunityScreenContainer from './screens/CommunityScreenContainer';
import CommunityMembersScreenContainer from './screens/CommunityMembersScreenContainer';
import SearchScreenContainer from './screens/SearchScreenContainer';
import SearchResultsScreenContainer from './screens/SearchResultsScreenContainer';
import { NotificationsProvider } from '../context/NotificationsContext';
import PostDetailScreenContainer from './screens/PostDetailScreenContainer';
import PublicProfileScreenContainer from './screens/PublicProfileScreenContainer';
import UserCommunitiesScreenContainer from './screens/UserCommunitiesScreenContainer';
import UserFollowingsScreenContainer from './screens/UserFollowingsScreenContainer';

// ── Param lists ──────────────────────────────────────────────────────────────
// Describe the shape of every navigation.navigate(screen, params) call. Grow
// as routes migrate over from src/routing.ts.

export type RootStackParamList = {
  // Unauthed group
  Landing: undefined;
  PublicPost: { postUuid: string };
  // Authed group — contains the tab navigator as a single screen.
  Main: undefined;
  /** Modal-presented composer for short / long posts. Optionally seeded
   *  with a `sharedPost` to start a quote/repost. */
  PostComposer: { sharedPost?: import('../api/client').FeedPost } | undefined;
  /** Modal-presented search overlay opened from the feed header. */
  Search: undefined;
};

export type RootTabParamList = {
  HomeTab: undefined;
  CommunitiesTab: undefined;
  AlertsTab: undefined;
  ProfileTab: undefined;
};

export type HomeStackParamList = {
  Feed: { feed?: 'home' | 'trending' | 'public' | 'explore' } | undefined;
  Post: { postUuid: string; focusComment?: boolean };
  Profile: { username: string };
  Community: { name: string };
  Hashtag: { name: string };
  Search: { query: string };
  SearchResults: { kind: 'people' | 'communities' | 'hashtags'; query: string };
  UserCommunities: { username: string };
  UserFollowings: { username: string };
  CommunityMembers: { name: string };
};

export type CommunitiesStackParamList = {
  CommunitiesList: undefined;
  Community: { name: string };
  CommunityMembers: { name: string };
};

export type ProfileStackParamList = {
  Me: undefined;
  Profile: { username: string };
  Followers: undefined;
  Following: undefined;
  Blocked: undefined;
  Circles: undefined;
  Lists: undefined;
  Settings: undefined;
  ManageCommunities: undefined;
  ManageCommunity: { name: string };
  MutedCommunities: undefined;
  LinkedAccounts: undefined;
  ModerationPenalties: undefined;
  ModerationTasks: undefined;
  UserCommunities: { username: string };
  UserFollowings: { username: string };
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<RootTabParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const CommunitiesStack = createNativeStackNavigator<CommunitiesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

// ── Placeholder screens ──────────────────────────────────────────────────────
// Proves the shell works (push/pop, swipe-back, tab switch, hardware back).
// Real screens replace these one by one in subsequent steps.

function Placeholder({ title, subtitle, actions }: {
  title: string;
  subtitle?: string;
  actions?: Array<{ label: string; onPress: () => void }>;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={[styles.placeholder, { backgroundColor: c.background }]}>
      <Text style={[styles.placeholderTitle, { color: c.textPrimary }]}>{title}</Text>
      {subtitle ? <Text style={[styles.placeholderSubtitle, { color: c.textMuted }]}>{subtitle}</Text> : null}
      {actions?.map((action) => (
        <Pressable
          key={action.label}
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.placeholderButton,
            { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.placeholderButtonText}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── Tab stacks ───────────────────────────────────────────────────────────────

function HomeTabStack() {
  // Root Feed screen renders FeedTopTabs (one tab per feed type, native
  // horizontal swipe via react-native-pager-view). Pushed screens
  // (Post / Profile / Community / Hashtag / Search) keep the default stack
  // header so the back button is preserved — matching the native idiom.
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: true, contentStyle: { backgroundColor: c.background } }}>
      <HomeStack.Screen
        name="Feed"
        component={FeedTopTabs}
        options={{ header: () => <FeedHeader /> }}
      />
      <HomeStack.Screen
        name="Post"
        component={PostDetailScreenContainer}
        // The Post viewer flips to its immersive dark background only once
        // the post has loaded; while we're fetching it we want the regular
        // theme background so the user doesn't see a black flash.
        options={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}
      />
      <HomeStack.Screen
        name="Profile"
        component={PublicProfileScreenContainer}
        options={{ title: 'Profile' }}
      />
      <HomeStack.Screen
        name="Community"
        component={CommunityScreenContainer}
        options={{ title: 'Community' }}
      />
      <HomeStack.Screen
        name="CommunityMembers"
        component={CommunityMembersScreenContainer}
        options={{ title: 'Members' }}
      />
      <HomeStack.Screen
        name="SearchResults"
        component={SearchResultsScreenContainer}
        options={{ title: 'Search results' }}
      />
      <HomeStack.Screen name="Hashtag" options={{ title: 'Hashtag' }}>
        {() => <Placeholder title="Hashtag" subtitle="pending migration" />}
      </HomeStack.Screen>
      <HomeStack.Screen name="Search" options={{ title: 'Search' }}>
        {() => <Placeholder title="Search" subtitle="pending migration" />}
      </HomeStack.Screen>
      <HomeStack.Screen
        name="UserCommunities"
        component={UserCommunitiesScreenContainer}
        options={{ title: 'Communities' }}
      />
      <HomeStack.Screen
        name="UserFollowings"
        component={UserFollowingsScreenContainer}
        options={{ title: 'Following' }}
      />
    </HomeStack.Navigator>
  );
}

function ProfileMePlaceholder() {
  // Lets us jump to all the migrated Profile-tab screens while MyProfile
  // itself is still a placeholder. Goes away when MyProfileScreen is migrated.
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList, 'Me'>>();
  return (
    <Placeholder
      title="My profile"
      subtitle="New navigator shell — pending migration"
      actions={[
        { label: 'Followers', onPress: () => navigation.navigate('Followers') },
        { label: 'Following', onPress: () => navigation.navigate('Following') },
        { label: 'Blocked', onPress: () => navigation.navigate('Blocked') },
        { label: 'Circles', onPress: () => navigation.navigate('Circles') },
        { label: 'Lists', onPress: () => navigation.navigate('Lists') },
        { label: 'Settings', onPress: () => navigation.navigate('Settings') },
        { label: 'Manage communities', onPress: () => navigation.navigate('ManageCommunities') },
        { label: 'Muted communities', onPress: () => navigation.navigate('MutedCommunities') },
      ]}
    />
  );
}

function CommunitiesTabStack() {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <CommunitiesStack.Navigator screenOptions={{ headerShown: true, contentStyle: { backgroundColor: c.background } }}>
      <CommunitiesStack.Screen
        name="CommunitiesList"
        component={CommunitiesScreenContainer}
        options={{ header: () => <FeedHeader /> }}
      />
      <CommunitiesStack.Screen
        name="Community"
        component={CommunityScreenContainer}
        options={{ title: 'Community' }}
      />
      <CommunitiesStack.Screen
        name="CommunityMembers"
        component={CommunityMembersScreenContainer}
        options={{ title: 'Members' }}
      />
    </CommunitiesStack.Navigator>
  );
}

function ProfileTabStack() {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: true, contentStyle: { backgroundColor: c.background } }}>
      <ProfileStack.Screen
        name="Me"
        options={{ header: () => <FeedHeader /> }}
      >
        {() => <ProfileMePlaceholder />}
      </ProfileStack.Screen>
      <ProfileStack.Screen
        name="Profile"
        component={PublicProfileScreenContainer}
        options={{ title: 'Profile' }}
      />
      <ProfileStack.Screen
        name="Followers"
        component={FollowersScreenContainer}
        options={{ title: 'Followers' }}
      />
      <ProfileStack.Screen
        name="Following"
        component={FollowingScreenContainer}
        options={{ title: 'Following' }}
      />
      <ProfileStack.Screen
        name="Blocked"
        component={BlockedScreenContainer}
        options={{ title: 'Blocked' }}
      />
      <ProfileStack.Screen
        name="Circles"
        component={CirclesScreenContainer}
        options={{ title: 'Circles' }}
      />
      <ProfileStack.Screen
        name="Lists"
        component={ListsScreenContainer}
        options={{ title: 'Lists' }}
      />
      <ProfileStack.Screen
        name="Settings"
        component={SettingsScreenContainer}
        options={{ title: 'Settings' }}
      />
      <ProfileStack.Screen
        name="ManageCommunities"
        component={ManageCommunitiesScreenContainer}
        options={{ title: 'Manage communities' }}
      />
      <ProfileStack.Screen
        name="ManageCommunity"
        component={ManageCommunityScreenContainer}
        options={{ title: 'Manage community' }}
      />
      <ProfileStack.Screen
        name="MutedCommunities"
        component={MutedCommunitiesScreenContainer}
        options={{ title: 'Muted communities' }}
      />
      <ProfileStack.Screen
        name="LinkedAccounts"
        component={LinkedAccountsScreenContainer}
        options={{ title: 'Linked accounts' }}
      />
      <ProfileStack.Screen
        name="ModerationPenalties"
        component={ModerationPenaltiesScreenContainer}
        options={{ title: 'Moderation penalties' }}
      />
      <ProfileStack.Screen
        name="ModerationTasks"
        component={ModerationTasksScreenContainer}
        options={{ title: 'Moderation tasks' }}
      />
      <ProfileStack.Screen
        name="UserCommunities"
        component={UserCommunitiesScreenContainer}
        options={{ title: 'Communities' }}
      />
      <ProfileStack.Screen
        name="UserFollowings"
        component={UserFollowingsScreenContainer}
        options={{ title: 'Following' }}
      />
    </ProfileStack.Navigator>
  );
}

// AlertsTab now mounts AlertsScreenContainer directly (see imports). The
// placeholder used to render here while the migration was in progress.

function TabsNavigator() {
  return (
    <Tabs.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="HomeTab" component={HomeTabStack} options={{ title: 'Home' }} />
      <Tabs.Screen name="CommunitiesTab" component={CommunitiesTabStack} options={{ title: 'Communities' }} />
      <Tabs.Screen name="AlertsTab" component={AlertsScreenContainer} options={{ title: 'Alerts' }} />
      <Tabs.Screen name="ProfileTab" component={ProfileTabStack} options={{ title: 'Profile' }} />
    </Tabs.Navigator>
  );
}

// ── Root navigator ───────────────────────────────────────────────────────────

type AppNavigatorProps = {
  /** When false, an auth gate will show Landing (placeholder) instead of the tabs. */
  isAuthed: boolean;
};

export default function AppNavigator({ isAuthed }: AppNavigatorProps) {
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthed ? (
        <>
          <RootStack.Screen name="Main">
            {() => (
              <NotificationsProvider>
                <TabsNavigator />
              </NotificationsProvider>
            )}
          </RootStack.Screen>
          <RootStack.Screen
            name="PostComposer"
            component={PostComposerScreenContainer}
            // fullScreenModal so the composer occupies the whole screen
            // on iOS (default 'modal' leaves a 95% sheet with peek-through).
            options={{ presentation: 'fullScreenModal', headerShown: false }}
          />
          <RootStack.Screen
            name="Search"
            component={SearchScreenContainer}
            options={{ presentation: 'modal', headerShown: false }}
          />
        </>
      ) : (
        <>
          <RootStack.Screen name="Landing" component={LandingScreenContainer} />
          <RootStack.Screen name="PublicPost" component={PublicPostScreenContainer} />
        </>
      )}
    </RootStack.Navigator>
  );
}

// ── Deep-linking config ─────────────────────────────────────────────────────
// Maps URL paths to nested navigator screens. Mirrors the existing
// src/routing.ts so existing /u/:username, /c/:name, /posts/:uuid URLs keep
// working once this navigator is live.

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    Platform.OS === 'web' ? (typeof window !== 'undefined' ? window.location.origin : '') : 'openspace://',
  ].filter(Boolean),
  config: {
    screens: {
      Landing: '/',
      PublicPost: 'posts/:postUuid',
      Main: {
        screens: {
          HomeTab: {
            screens: {
              Feed: {
                path: ':feed(home|trending|public|explore)',
                parse: { feed: (f: string) => f as any },
              },
              Post: 'posts/:postUuid',
              Profile: 'u/:username',
              Community: 'c/:name',
              Hashtag: 'h/:name',
              Search: 'search/:query',
            },
          },
          CommunitiesTab: {
            screens: {
              CommunitiesList: 'communities',
              Community: 'c/:name',
            },
          },
          AlertsTab: 'alerts',
          ProfileTab: {
            screens: {
              Me: 'me',
              Profile: 'u/:username',
              Followers: 'followers',
              Following: 'following',
              Blocked: 'blocked',
              Circles: 'circles',
              Lists: 'lists',
              Settings: 'settings',
              ManageCommunities: 'manage-communities',
              ManageCommunity: 'manage-communities/:name',
              MutedCommunities: 'muted-communities',
              LinkedAccounts: 'linked-accounts',
              ModerationPenalties: 'moderation-penalties',
              ModerationTasks: 'moderation-tasks',
            },
          },
        },
      },
    },
  },
};

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  placeholderTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  placeholderSubtitle: {
    fontSize: 14,
    marginBottom: 8,
  },
  placeholderButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
  },
  placeholderButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
