/**
 * LandingScreenContainer — wraps LandingScreen for the react-navigation tree.
 *
 * Just connects the `onLogin` callback to AuthContext. When login succeeds,
 * AuthContext.onLogin stores the token + flips authReady/token, which in turn
 * causes the root RootStack in AppNavigator to switch from the unauthed group
 * (Landing/PublicPost) to the authed group (Main tabs).
 */

import React from 'react';
import LandingScreen from '../../screens/LandingScreen';
import { useAuth } from '../../context/AuthContext';

export default function LandingScreenContainer() {
  const { onLogin } = useAuth();
  return <LandingScreen onLogin={(token) => void onLogin(token)} />;
}
