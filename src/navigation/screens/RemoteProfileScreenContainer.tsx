import React from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../context/AuthContext';
import RemoteProfileScreen from '../../screens/RemoteProfileScreen';
import type { HomeStackParamList } from '../AppNavigator';

export default function RemoteProfileScreenContainer() {
  const { token } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const route = useRoute<RouteProp<HomeStackParamList, 'RemoteProfile'>>();
  const remoteActorId = route.params?.remoteActorId;

  if (!token || !remoteActorId) return null;

  return (
    <RemoteProfileScreen
      token={token}
      remoteActorId={remoteActorId}
      onOpenThread={(inboundObjectId) => navigation.navigate('RemoteThread', { inboundObjectId })}
    />
  );
}
