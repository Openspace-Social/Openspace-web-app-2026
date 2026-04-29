/**
 * useAutoPlayMedia — reads the user's "Auto-play media" preference from
 * AsyncStorage so feeds and post-detail screens can autoplay videos when
 * the toggle is on. The toggle itself lives in Settings and writes the
 * same key, so this hook stays in sync after re-mount.
 *
 * NOTE: this hook only reads once on mount. If the user toggles the
 * setting on a different screen, callers won't see the change until the
 * screen re-mounts. That matches HomeScreen's web behaviour and is
 * acceptable for now — adding a cross-screen listener would mean an
 * AsyncStorage event-emitter shim or a context, which we can do if it
 * becomes a real UX problem.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTO_PLAY_MEDIA_KEY = '@openspace/auto_play_media';

export function useAutoPlayMedia(): boolean {
  const [autoPlay, setAutoPlay] = useState(false);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(AUTO_PLAY_MEDIA_KEY)
      .then((value) => {
        if (active && value !== null) setAutoPlay(value === '1');
      })
      .catch(() => {
        // Keep default on read failure.
      });
    return () => {
      active = false;
    };
  }, []);
  return autoPlay;
}
