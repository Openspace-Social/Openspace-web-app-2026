/**
 * MentionPopupProvider — global slot for the @mention / #hashtag suggestion
 * popup on native (web continues to use its react-dom portal path).
 *
 * Why this exists: MentionHashtagInput used to render its popup inside an
 * inline `<Modal>`, which silently failed to paint when the input lived
 * inside react-navigation's native stack or inside another iOS Modal
 * (PostDetailModal). Lifting the popup to a fixed absolute View at app
 * root (and another inside PostDetailModal) avoids both issues.
 *
 * Why an event-emitter (not useState): if `setNode` updated provider
 * state, every `MentionHashtagInput` rendered as a descendant would
 * re-render on each suggestion-list change, recreate its popup JSX, and
 * trigger the effect that calls `setNode` again — an infinite loop. By
 * routing pushes through a stable subject + per-overlay listener,
 * `setNode` does NOT re-render the provider tree; only the overlay
 * component re-renders.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';

type Listener = (node: ReactNode | null) => void;

type Subject = {
  setNode: (n: ReactNode | null) => void;
  getNode: () => ReactNode | null;
  subscribe: (l: Listener) => () => void;
};

const MentionPopupContext = createContext<Subject | null>(null);

function createSubject(): Subject {
  let current: ReactNode | null = null;
  const listeners = new Set<Listener>();
  return {
    setNode: (n) => {
      current = n;
      listeners.forEach((l) => l(n));
    },
    getNode: () => current,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function MentionPopupProvider({ children }: { children: ReactNode }) {
  // Subject is created once and never replaced — its identity is the
  // contract that lets descendants safely read it from context without
  // worrying about re-render churn.
  const subject = useMemo(createSubject, []);
  return (
    <MentionPopupContext.Provider value={subject}>
      {children}
      <MentionPopupOverlay />
    </MentionPopupContext.Provider>
  );
}

export function MentionPopupOverlay() {
  const subject = useContext(MentionPopupContext);
  const [node, setLocalNode] = useState<ReactNode | null>(() => subject?.getNode() ?? null);

  useEffect(() => {
    if (!subject) return undefined;
    // Sync any node that was set before this overlay mounted (mainly the
    // overlay rendered inside PostDetailModal which mounts later).
    setLocalNode(subject.getNode());
    return subject.subscribe(setLocalNode);
  }, [subject]);

  if (!node) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999 }]}
    >
      {node}
    </View>
  );
}

// Public hook — `setNode` is a stable reference, safe to put in deps.
export function useMentionPopup(): { setNode: (n: ReactNode | null) => void } {
  const subject = useContext(MentionPopupContext);
  // useCallback with [] deps so the returned `setNode` identity never
  // changes for a given subject — callers can safely put it in effect
  // deps without re-triggering the effect.
  const setNode = useCallback(
    (n: ReactNode | null) => {
      subject?.setNode(n);
    },
    [subject],
  );
  return { setNode };
}
