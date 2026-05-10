import React from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../context/AuthContext';
import RemoteThreadScreen from '../../screens/RemoteThreadScreen';
import type { HomeStackParamList } from '../AppNavigator';

export default function RemoteThreadScreenContainer() {
  const { token } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const route = useRoute<RouteProp<HomeStackParamList, 'RemoteThread'>>();
  const inboundObjectId = route.params?.inboundObjectId;

  if (!token || !inboundObjectId) return null;

  return (
    <RemoteThreadScreen
      token={token}
      inboundObjectId={inboundObjectId}
      onOpenProfile={(remoteActorId) => navigation.navigate('RemoteProfile', { remoteActorId })}
      onOpenPost={(postUuid) => navigation.navigate('Post', { postUuid })}
    />
  );
}
