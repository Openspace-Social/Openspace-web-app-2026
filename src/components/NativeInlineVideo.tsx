/**
 * NativeInlineVideo — thin forwardRef wrapper around expo-video's
 * `useVideoPlayer` + `VideoView` so the same player implementation can be
 * reused in PostCard's feed cell and in PostDetailModal.
 *
 * Web: this component is never rendered on web (callers gate by
 * `Platform.OS !== 'web'`). Importing expo-video on web crashes the
 * bundle, so the require here is conditional.
 *
 * The imperative handle exposes pause / play / getCurrentTime / seekTo so
 * the parent (PostCard) can capture playback position before navigating to
 * the detail screen and pass it through as `resumeTimeSec`.
 *
 * Autoplay is intentionally deferred to the player's `readyToPlay` status
 * — calling `player.play()` from the setup callback fires before the
 * source has loaded and AVPlayer (iOS) silently drops the queued play,
 * which is what made our first autoplay attempt look broken.
 */

import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { Platform, type ViewStyle, type StyleProp } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExpoVideo: any = Platform.OS !== 'web' ? require('expo-video') : null;

export type NativeInlineVideoHandle = {
  pause: () => void;
  play: () => void;
  /** Returns the current playback position in seconds, or 0 if unknown. */
  getCurrentTime: () => number;
  seekTo: (sec: number) => void;
};

export type NativeInlineVideoProps = {
  uri: string;
  autoPlay?: boolean;
  initialTimeSec?: number;
  onConsumeInitialTime?: () => void;
  /** Fires when playback reaches the end of the clip. */
  onEnded?: () => void;
  /** Show the native overlay controls (play/scrub/fullscreen). True for
   *  PostDetailModal, false for the feed cell where the parent draws its
   *  own affordances on top. */
  nativeControls?: boolean;
  contentFit?: 'contain' | 'cover' | 'fill';
  style?: StyleProp<ViewStyle>;
  /** When true, the player starts muted and stays muted. Default false.
   *  The feed cell passes `muted` so scroll-driven autoplay doesn't blast
   *  audio; the post-detail surface omits it so audio plays normally. */
  muted?: boolean;
};

const NativeInlineVideoImpl = forwardRef<NativeInlineVideoHandle, NativeInlineVideoProps>(
  function NativeInlineVideo(
    {
      uri,
      autoPlay = false,
      initialTimeSec = 0,
      onConsumeInitialTime,
      onEnded,
      nativeControls = true,
      contentFit = 'contain',
      style,
      muted = false,
    },
    ref,
  ) {
    const useVideoPlayer = ExpoVideo?.useVideoPlayer;
    const VideoView = ExpoVideo?.VideoView;

    const player = useVideoPlayer
      ? useVideoPlayer(uri, (p: any) => {
          p.loop = false;
          // Audio defaults — explicit so feed autoplay can mute via the
          // `muted` prop AND the post-detail surface starts at full
          // volume. expo-video on Android needs `audioMixingMode: 'auto'`
          // for the AudioFocusManager to request `AUDIOFOCUS_GAIN`;
          // without focus the player can be silent even when not muted.
          p.volume = 1.0;
          p.muted = muted;
          p.audioMixingMode = 'auto';
        })
      : null;

    // Keep `player.muted` in sync if the prop flips after mount (e.g.
    // user enables sound on a feed cell). The setup callback above only
    // runs once per source.
    useEffect(() => {
      if (!player) return;
      try {
        player.muted = muted;
      } catch {
        // ignore — player can be in a transient state
      }
    }, [player, muted]);

    useImperativeHandle(
      ref,
      () => ({
        pause: () => {
          try {
            player?.pause();
          } catch {
            // player can be in a transient unrecoverable state; ignore.
          }
        },
        play: () => {
          try {
            player?.play();
          } catch {
            // ignore — same rationale as pause()
          }
        },
        getCurrentTime: () => {
          const t = Number(player?.currentTime);
          return Number.isFinite(t) && t > 0 ? t : 0;
        },
        seekTo: (sec: number) => {
          if (!player) return;
          try {
            player.currentTime = sec;
          } catch {
            // ignore
          }
        },
      }),
      [player],
    );

    useEffect(() => {
      if (!player) return;
      let seekConsumed = false;
      let autoPlayFired = false;

      const tryApplySeek = () => {
        if (seekConsumed) return;
        if (!Number.isFinite(initialTimeSec) || initialTimeSec <= 0) {
          seekConsumed = true;
          return;
        }
        const dur = Number.isFinite(player.duration) ? player.duration : 0;
        const target =
          dur > 0
            ? Math.max(0, Math.min(initialTimeSec, Math.max(0, dur - 0.25)))
            : Math.max(0, initialTimeSec);
        try {
          player.currentTime = target;
        } catch {
          // ignore
        }
        seekConsumed = true;
        onConsumeInitialTime?.();
      };

      const tryAutoPlay = () => {
        if (autoPlayFired) return;
        if (!autoPlay) {
          autoPlayFired = true;
          return;
        }
        try {
          player.play();
        } catch {
          // try again on next status tick
          return;
        }
        autoPlayFired = true;
      };

      const handleReady = () => {
        tryApplySeek();
        tryAutoPlay();
      };

      const statusSub = player.addListener?.('statusChange', (event: any) => {
        if (event?.status === 'readyToPlay') handleReady();
      });
      const endSub = player.addListener?.('playToEnd', () => {
        onEnded?.();
      });
      if (player.status === 'readyToPlay') handleReady();

      return () => {
        statusSub?.remove?.();
        endSub?.remove?.();
      };
    }, [player, initialTimeSec, onConsumeInitialTime, autoPlay, onEnded]);

    if (!VideoView || !player) return null;

    return (
      <VideoView
        style={[{ width: '100%', height: '100%', backgroundColor: '#000' }, style]}
        player={player}
        fullscreenOptions={{ enable: true }}
        contentFit={contentFit}
        nativeControls={nativeControls}
      />
    );
  },
);

export default NativeInlineVideoImpl;
