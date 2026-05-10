import React from 'react';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import RemoteCommunityScreen from '../../screens/RemoteCommunityScreen';
import type { HomeStackParamList } from '../AppNavigator';

export default function RemoteCommunityScreenContainer() {
  const { token } = useAuth();
  const route = useRoute<RouteProp<HomeStackParamList, 'RemoteCommunity'>>();
  const remoteCommunityId = route.params?.remoteCommunityId;

  if (!token || !remoteCommunityId) return null;

  return <RemoteCommunityScreen token={token} remoteCommunityId={remoteCommunityId} />;
}
