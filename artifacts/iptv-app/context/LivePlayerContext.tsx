/**
 * Shared live-TV player context.
 *
 * A single VideoPlayer instance is created here and provided to every screen.
 * Both the home-tab mini-player and the full-screen player attach a VideoView
 * to this same player, so navigating between them never restarts the stream.
 *
 * `activeUrlRef` tracks what is currently loaded so callers can decide whether
 * to call player.replace() (different URL) or simply player.play() (same URL).
 */
import React, { createContext, useContext, useRef } from 'react';
import { useVideoPlayer } from 'expo-video';
import type { VideoPlayer } from 'expo-video';

interface LivePlayerContextValue {
  player: VideoPlayer;
  /** Always points to the URL that is currently loaded in the shared player. */
  activeUrlRef: React.MutableRefObject<string>;
}

const LivePlayerContext = createContext<LivePlayerContextValue | null>(null);

export function LivePlayerProvider({ children }: { children: React.ReactNode }) {
  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    // Keep audio when phone screen locks (same as the per-screen flag we set before)
    (p as any).staysActiveInBackground = true;
  });

  // Mutable ref — not state — so reads in effects and callbacks are always current
  // without causing re-renders.
  const activeUrlRef = useRef('');

  return (
    <LivePlayerContext.Provider value={{ player, activeUrlRef }}>
      {children}
    </LivePlayerContext.Provider>
  );
}

export function useLivePlayer(): LivePlayerContextValue {
  const ctx = useContext(LivePlayerContext);
  if (!ctx) throw new Error('useLivePlayer must be used inside <LivePlayerProvider>');
  return ctx;
}
