/**
 * NotificationsContext — global unread-notifications count for the native
 * navigator. Polls /notifications/unread/count/ every 60s (matching web's
 * interval) so the bottom-tab badge stays in sync without each consumer
 * re-implementing the timer.
 *
 * Screens that mutate read state (mark all read, mark one read, delete)
 * adjust the count locally for an instant UI response, then the next poll
 * reconciles with the server.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

const POLL_INTERVAL_MS = 60_000;

type NotificationsContextValue = {
  unreadCount: number;
  /** Force-refresh the unread count from the server. */
  refresh: () => Promise<void>;
  /** Local override — useful when a screen marks notifications read and
   *  wants the badge to update before the next poll lands. */
  setUnreadCount: (next: number | ((prev: number) => number)) => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [unreadCount, setUnreadCountState] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const count = await api.getUnreadNotificationsCount(token);
      setUnreadCountState(count);
    } catch {
      // non-fatal — keep last known value
    }
  }, [token]);

  const setUnreadCount = useCallback((next: number | ((prev: number) => number)) => {
    setUnreadCountState((prev) => {
      const value = typeof next === 'function' ? (next as (p: number) => number)(prev) : next;
      return Math.max(0, Math.floor(value || 0));
    });
  }, []);

  useEffect(() => {
    if (!token) {
      setUnreadCountState(0);
      return;
    }
    void refresh();
    timerRef.current = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [token, refresh]);

  return (
    <NotificationsContext.Provider value={{ unreadCount, refresh, setUnreadCount }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    // Tolerant fallback so non-authed trees don't crash if a child accidentally
    // calls the hook before the provider mounts.
    return {
      unreadCount: 0,
      refresh: async () => {},
      setUnreadCount: () => {},
    };
  }
  return ctx;
}
