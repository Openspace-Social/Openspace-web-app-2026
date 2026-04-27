/**
 * PublicPostScreenContainer — unauthed path for sharing a single post.
 *
 * Pulls the `postUuid` from the route param (react-navigation) and hooks
 * "sign in" up to the Landing screen. The legacy `postLoginRoute.current`
 * trick (App.tsx) to remember the post and redirect back after login is not
 * yet reproduced here — we'll add that once authed-side routes are real,
 * since it depends on knowing where to push after auth.
 */

import React from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import PublicPostScreen from '../../screens/PublicPostScreen';
import type { RootStackParamList } from '../AppNavigator';

export default function PublicPostScreenContainer() {
  const route = useRoute<RouteProp<RootStackParamList, 'PublicPost'>>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'PublicPost'>>();
  const postUuid = route.params?.postUuid || '';
  return (
    <PublicPostScreen
      postUuid={postUuid}
      onLoginPress={() => navigation.navigate('Landing')}
    />
  );
}
