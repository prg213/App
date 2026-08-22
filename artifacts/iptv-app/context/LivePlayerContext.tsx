/**
 * Shared live-TV player state.
 *
 * Android and Fire TV keep one libVLC view mounted in the Live TV layout. The
 * fullscreen route borrows that existing surface and renders controls only;
 * changing `nativeSurfaceMode` changes the owning container's layout, never
 * the native view's coordinates or decoder.
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { View } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import type { VideoPlayer } from 'expo-video';

export type NativeSurfaceMode = 'mini' | 'fullscreen' | 'hidden';

export interface NativeSurfaceHandoff {
  id: string;
  url: string;
}

interface LivePlayerContextValue {
  player: VideoPlayer;
  /** Always points to the URL currently loaded in the shared Expo player. */
  activeUrlRef: React.MutableRefObject<string>;
  /**
   * Visual state for the single Android VLC owner. The Live TV layout applies
   * this state to its container while the fullscreen route supplies controls.
   */
  nativeSurfaceMode: NativeSurfaceMode;
  nativeSurfaceUrl: string;
  setNativeSurfaceUrl: (url: string) => void;
  /** A route-scoped lease for the fullscreen controls-only handoff. */
  nativeSurfaceHandoff: NativeSurfaceHandoff | null;
  beginNativeSurfaceHandoff: (url: string) => string;
  updateNativeSurfaceHandoffUrl: (id: string, url: string) => void;
  endNativeSurfaceHandoff: (id: string) => void;
  /**
   * Commits the container-owned layout state, then waits one layout frame
   * before navigation changes the transparent controls route.
   */
  transitionNativeSurface: (mode: NativeSurfaceMode, onComplete?: () => void) => void;
  /** The real focusable mini-player container, not a native surface proxy. */
  miniPlayerRef: React.RefObject<View | null>;
  /**
   * Generic non-VLC transition hooks kept for the Expo-video phone path.
   * They deliberately do not measure or move the Android VLC surface.
   */
  triggerExpand: (onNavigate: () => void) => void;
  triggerExpandFromRef: (
    sourceRef: React.RefObject<View | null>,
    onNavigate: () => void,
  ) => void;
  triggerCollapse: (onDone: () => void) => void;
  /** Maintained for callers shared with the Expo-video path. */
  notifyPlayerReady: () => void;
}

const LivePlayerContext = createContext<LivePlayerContextValue | null>(null);

export function LivePlayerProvider({ children }: { children: React.ReactNode }) {
  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = false;
    p.volume = 1;
    (p as any).staysActiveInBackground = true;
  });

  const activeUrlRef = useRef('');
  const miniPlayerRef = useRef<View>(null);
  const [nativeSurfaceMode, setNativeSurfaceMode] = useState<NativeSurfaceMode>('mini');
  const [nativeSurfaceUrl, setNativeSurfaceUrl] = useState('');
  const [nativeSurfaceHandoff, setNativeSurfaceHandoff] = useState<NativeSurfaceHandoff | null>(null);
  const nextNativeSurfaceHandoffIdRef = useRef(0);

  const beginNativeSurfaceHandoff = useCallback((url: string) => {
    const id = String(++nextNativeSurfaceHandoffIdRef.current);
    setNativeSurfaceHandoff({ id, url });
    return id;
  }, []);

  const updateNativeSurfaceHandoffUrl = useCallback((id: string, url: string) => {
    setNativeSurfaceHandoff((current) => (
      current?.id === id ? { ...current, url } : current
    ));
  }, []);

  const endNativeSurfaceHandoff = useCallback((id: string) => {
    setNativeSurfaceHandoff((current) => (
      current?.id === id ? null : current
    ));
  }, []);

  const transitionNativeSurface = useCallback((
    mode: NativeSurfaceMode,
    onComplete: () => void = () => {},
  ) => {
    setNativeSurfaceMode(mode);
    // The mounted VLC child remains an absolute-fill child of its owner. Wait
    // for its parent layout to commit before revealing or removing controls.
    if (mode === 'hidden') {
      onComplete();
      return;
    }
    requestAnimationFrame(onComplete);
  }, []);

  // Expo-video uses these entry points too. They never measure or move a
  // native surface. The two-frame boundary gives a direct fullscreen renderer
  // time to unmount before Live TV mounts its own owner on BACK.
  const triggerExpand = useCallback((onNavigate: () => void) => {
    onNavigate();
  }, []);

  const triggerExpandFromRef = useCallback((
    _sourceRef: React.RefObject<View | null>,
    onNavigate: () => void,
  ) => {
    onNavigate();
  }, []);

  const triggerCollapse = useCallback((onDone: () => void) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(onDone);
    });
  }, []);

  const notifyPlayerReady = useCallback(() => {}, []);

  return (
    <LivePlayerContext.Provider
      value={{
        player,
        activeUrlRef,
        nativeSurfaceMode,
        nativeSurfaceUrl,
        setNativeSurfaceUrl,
        nativeSurfaceHandoff,
        beginNativeSurfaceHandoff,
        updateNativeSurfaceHandoffUrl,
        endNativeSurfaceHandoff,
        transitionNativeSurface,
        miniPlayerRef,
        triggerExpand,
        triggerExpandFromRef,
        triggerCollapse,
        notifyPlayerReady,
      }}
    >
      {children}
    </LivePlayerContext.Provider>
  );
}

export function useLivePlayer(): LivePlayerContextValue {
  const ctx = useContext(LivePlayerContext);
  if (!ctx) throw new Error('useLivePlayer must be used inside <LivePlayerProvider>');
  return ctx;
}