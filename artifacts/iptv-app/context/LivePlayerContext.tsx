/**
 * Shared live-TV player state.
 *
 * Android and Fire TV keep one libVLC view mounted in the Live TV layout. The
 * fullscreen route borrows that existing surface and renders controls only;
 * changing `nativeSurfaceMode` changes the owning container's layout, never
 * the native view's coordinates or decoder.
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import type { VideoPlayer } from 'expo-video';

export type NativeSurfaceMode = 'mini' | 'fullscreen' | 'hidden';

const VLC_TRACE = '[SV-VLC-TRACE]';

export interface NativeSurfaceHandoff {
  id: string;
  url: string;
}

export interface NativeSurfaceBounds {
  width: number;
  height: number;
  x: number;
  y: number;
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
   * Commits the container-owned layout state. Navigation waits for the real
   * owner to report its measured target bounds, not for an arbitrary timer.
   */
  transitionNativeSurface: (mode: NativeSurfaceMode, onComplete?: () => void) => void;
  /** Called by the single React Native owner after its target layout commits. */
  commitNativeSurfaceLayout: (mode: NativeSurfaceMode, bounds: NativeSurfaceBounds) => void;
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
  const pendingNativeSurfaceTransitionRef = useRef<{
    mode: NativeSurfaceMode;
    onComplete: () => void;
  } | null>(null);

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
    console.log(VLC_TRACE, 'surface-transition-start', {
      mode,
      animated: false,
    });
    pendingNativeSurfaceTransitionRef.current = { mode, onComplete };
    setNativeSurfaceMode(mode);
    // Hidden has no visible owner that can report a layout acknowledgement.
    if (mode === 'hidden') {
      pendingNativeSurfaceTransitionRef.current = null;
      console.log(VLC_TRACE, 'surface-transition-complete', { mode });
      onComplete();
    }
  }, []);

  const commitNativeSurfaceLayout = useCallback((
    mode: NativeSurfaceMode,
    bounds: NativeSurfaceBounds,
  ) => {
    const pending = pendingNativeSurfaceTransitionRef.current;
    if (
      !pending
      || pending.mode !== mode
      || bounds.width <= 0
      || bounds.height <= 0
    ) return;

    pendingNativeSurfaceTransitionRef.current = null;
    console.log(VLC_TRACE, 'surface-transition-layout-ack', {
      mode,
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
    });
    pending.onComplete();
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
        commitNativeSurfaceLayout,
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