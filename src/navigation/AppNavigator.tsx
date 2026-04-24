/**
 * AppNavigator — scaffolding for the react-navigation migration.
 *
 * Currently empty: we're in step 1 of the migration. `NavigationContainer` is
 * mounted in App.tsx but this component is NOT rendered by the running app
 * yet — the custom routing in App.tsx remains the source of truth until we
 * migrate each route. That lets us iterate screen-by-screen.
 *
 * As routes move over, we'll fill in the Stack + Tab navigators here and
 * flip a feature flag in App.tsx to render this tree instead of the old one.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';

// Param lists — these describe the shape of navigation.navigate(...) calls.
// We'll grow these as routes migrate over from src/routing.ts.

export type RootTabParamList = {
  HomeTab: undefined;
  CommunitiesTab: undefined;
  ProfileTab: undefined;
};

export type HomeStackParamList = {
  Feed: { feed?: 'home' | 'trending' | 'public' | 'explore' } | undefined;
  Post: { postUuid: string };
  Profile: { username: string };
  Community: { name: string };
  Hashtag: { name: string };
  Search: { query: string };
};

export type CommunitiesStackParamList = {
  CommunitiesList: undefined;
  Community: { name: string };
};

export type ProfileStackParamList = {
  Me: undefined;
  Profile: { username: string };
  Followers: undefined;
  Following: undefined;
  Circles: undefined;
  Lists: undefined;
  Settings: undefined;
  ManageCommunities: undefined;
  MutedCommunities: undefined;
};

const Tabs = createBottomTabNavigator<RootTabParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const CommunitiesStack = createNativeStackNavigator<CommunitiesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

// Placeholder — real screens will be plugged in during the per-tab migration.
function Placeholder({ label }: { label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>{label}</Text>
    </View>
  );
}

function HomeTabStack() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Feed">{() => <Placeholder label="Feed (pending migration)" />}</HomeStack.Screen>
    </HomeStack.Navigator>
  );
}

function CommunitiesTabStack() {
  return (
    <CommunitiesStack.Navigator screenOptions={{ headerShown: false }}>
      <CommunitiesStack.Screen name="CommunitiesList">
        {() => <Placeholder label="Communities (pending migration)" />}
      </CommunitiesStack.Screen>
    </CommunitiesStack.Navigator>
  );
}

function ProfileTabStack() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="Me">{() => <Placeholder label="Profile (pending migration)" />}</ProfileStack.Screen>
    </ProfileStack.Navigator>
  );
}

/**
 * Full app navigator tree. Not rendered yet — see component docs above.
 * Will be wired into App.tsx once enough routes are migrated.
 */
export default function AppNavigator() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="HomeTab" component={HomeTabStack} />
      <Tabs.Screen name="CommunitiesTab" component={CommunitiesTabStack} />
      <Tabs.Screen name="ProfileTab" component={ProfileTabStack} />
    </Tabs.Navigator>
  );
}
