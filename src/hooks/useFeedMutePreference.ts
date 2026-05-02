/**
 * useFeedMutePreference — session-scoped mute preference for autoplaying
 * feed videos. Default is muted (so a scrolling feed never blasts audio
 * unsolicited); once the user taps the speaker chip on any feed video,
 * the choice sticks for the rest of the session and subsequent autoplays
 * respect it. Not persisted across app launches by design — autoplay-with-
 * sound is a sensitive default we want users to opt into each session.
 */

import { useEffect, useState } from 'react';

let mutedState = true;
const listeners = new Set<(value: boolean) => void>();

function setFeedMuted(next: boolean) {
  if (mutedState === next) return;
  mutedState = next;
  listeners.forEach((listener) => listener(next));
}

export function useFeedMutePreference(): [boolean, (next: boolean) => void] {
  const [muted, setMuted] = useState(mutedState);
  useEffect(() => {
    listeners.add(setMuted);
    return () => {
      listeners.delete(setMuted);
    };
  }, []);
  return [muted, setFeedMuted];
}
