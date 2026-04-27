/**
 * AuthContext — a single source of truth for auth state used by both the
 * legacy HomeScreen-driven routing and the new react-navigation tree.
 *
 * The Provider is mounted in App.tsx so every component under the nav tree
 * can grab `token`, `user`, and the login/logout/refresh handlers without
 * threading them through dozens of props.
 */

import React, { createContext, useContext } from 'react';

export type AuthContextValue = {
  /** Null until the user logs in. */
  token: string | null;
  /** `true` once AsyncStorage has been read (prevents login-screen flash). */
  authReady: boolean;
  /** Called after a successful login or signup. */
  onLogin: (token: string) => Promise<void>;
  /** Called after a token-refresh response from the API. */
  onTokenRefresh: (token: string) => Promise<void>;
  /** Clears stored token and sends the user back to the landing screen. */
  onLogout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ value, children }: { value: AuthContextValue; children: React.ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}

/** Convenience: returns the token or throws — for code that knows the user is authed. */
export function useAuthToken(): string {
  const { token } = useAuth();
  if (!token) throw new Error('useAuthToken called without an authenticated token');
  return token;
}
