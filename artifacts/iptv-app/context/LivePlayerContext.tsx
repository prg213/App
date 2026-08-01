/**
 * Shared live-TV player context.
 *
 * A single VideoPlayer instance is created here and provided to every screen.
 * Both the home-tab mini-player and the full-screen player attach a VideoView
 * to this same player, so navigating between them never restarts the stream.
 *
 * `activeUrlRef` tracks what is currently loaded so callers can decide whether
 * to call player.replace() (different URL) or simply player.play() (same URL).
 *
 * `miniPlayerRef`    – attach to the mini-player container in index.tsx so we
 *                      can measure its on-screen position for the transition.
 * `triggerExpand`    – call with a navigation callback to animate the mini-player
 *                      expanding to fullscreen before navigating.
 * `triggerCollapse`  – call with a done callback to animate the fullscreen view
 *                      collapsing back to the mini-player position before going back.
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { VideoPlayer } from 'expo-video';

interface LivePlayerContextValue {
  player: VideoPlayer;
  /** Always points to the URL that is currently loaded in the shared player. */
  activeUrlRef: React.MutableRefObject<string>;
  /** Attach to the mini-player container View for position measurement. */
  miniPlayerRef: React.RefObject<View>;
  /**
   * Measure the mini-player, animate it expanding to fullscreen, then call
   * `onNavigate`. Falls back to calling `onNavigate` immediately when the
   * ref is unavailable (e.g. recently-watched rail shortcuts).
   */
  triggerExpand: (onNavigate: () => void) => void;
  /**
   * Animate the fullscreen view collapsing to the mini-player position, then
   * call `onDone`. If no prior expand was recorded the callback fires immediately.
   */
  triggerCollapse: (onDone: () => void) => void;
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

  // Ref that index.tsx attaches to its mini-player container View.
  const miniPlayerRef = useRef<View>(null);

  // Whether the last navigation to the player used the expand animation.
  // Used to decide whether triggerCollapse should animate or just call onDone.
  const wasExpandedRef = useRef(false);

  // Last measured mini-player rect (page-absolute coordinates).
  const miniRectRef = useRef({ x: 0, y: 0, width: 200, height: 112 });

  // ── Animated overlay state ────────────────────────────────────────────────
  const { width: screenW, height: screenH } = useWindowDimensions();

  const animTop     = useRef(new Animated.Value(0)).current;
  const animLeft    = useRef(new Animated.Value(0)).current;
  const animWidth   = useRef(new Animated.Value(screenW)).current;
  const animHeight  = useRef(new Animated.Value(screenH)).current;
  const animOpacity = useRef(new Animated.Value(0)).current;
  const [overlayVisible, setOverlayVisible] = useState(false);

  // ── triggerExpand ─────────────────────────────────────────────────────────
  const triggerExpand = useCallback(
    (onNavigate: () => void) => {
      const ref = miniPlayerRef.current;
      if (!ref) {
        onNavigate();
        return;
      }

      (ref as any).measureInWindow(
        (x: number, y: number, width: number, height: number) => {
          if (!width || !height) {
            onNavigate();
            return;
          }

          const rect = { x, y, width, height };
          miniRectRef.current = rect;
          wasExpandedRef.current = true;

          // Position overlay exactly over the mini-player, start transparent
          animTop.setValue(rect.y);
          animLeft.setValue(rect.x);
          animWidth.setValue(rect.width);
          animHeight.setValue(rect.height);
          animOpacity.setValue(0);
          setOverlayVisible(true);

          const EXPAND_MS = 320;

          Animated.sequence([
            // Quick fade-in so the overlay snaps visibly before expanding
            Animated.timing(animOpacity, {
              toValue: 1,
              duration: 60,
              useNativeDriver: false,
            }),
            // Expand rect to fill the screen
            Animated.parallel([
              Animated.timing(animTop,    { toValue: 0,       duration: EXPAND_MS, useNativeDriver: false }),
              Animated.timing(animLeft,   { toValue: 0,       duration: EXPAND_MS, useNativeDriver: false }),
              Animated.timing(animWidth,  { toValue: screenW, duration: EXPAND_MS, useNativeDriver: false }),
              Animated.timing(animHeight, { toValue: screenH, duration: EXPAND_MS, useNativeDriver: false }),
            ]),
          ]).start(() => {
            // Navigate — the player screen mounts beneath the overlay
            onNavigate();
            // Give the player screen one frame to render, then fade out the overlay
            requestAnimationFrame(() => {
              Animated.timing(animOpacity, {
                toValue: 0,
                duration: 220,
                useNativeDriver: false,
              }).start(() => setOverlayVisible(false));
            });
          });
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animTop, animLeft, animWidth, animHeight, animOpacity, screenW, screenH],
  );

  // ── triggerCollapse ───────────────────────────────────────────────────────
  const triggerCollapse = useCallback(
    (onDone: () => void) => {
      if (!wasExpandedRef.current) {
        onDone();
        return;
      }
      wasExpandedRef.current = false;

      const rect = miniRectRef.current;
      const COLLAPSE_MS = 300;

      // Overlay covers the entire screen instantly, hiding the player screen
      animTop.setValue(0);
      animLeft.setValue(0);
      animWidth.setValue(screenW);
      animHeight.setValue(screenH);
      animOpacity.setValue(1);
      setOverlayVisible(true);

      // Shrink back to the mini-player position
      Animated.parallel([
        Animated.timing(animTop,    { toValue: rect.y,      duration: COLLAPSE_MS, useNativeDriver: false }),
        Animated.timing(animLeft,   { toValue: rect.x,      duration: COLLAPSE_MS, useNativeDriver: false }),
        Animated.timing(animWidth,  { toValue: rect.width,  duration: COLLAPSE_MS, useNativeDriver: false }),
        Animated.timing(animHeight, { toValue: rect.height, duration: COLLAPSE_MS, useNativeDriver: false }),
      ]).start(() => {
        // Navigate back — the mini-player is now revealed beneath the overlay
        onDone();
        Animated.timing(animOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: false,
        }).start(() => setOverlayVisible(false));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animTop, animLeft, animWidth, animHeight, animOpacity, screenW, screenH],
  );

  return (
    <LivePlayerContext.Provider
      value={{ player, activeUrlRef, miniPlayerRef, triggerExpand, triggerCollapse }}
    >
      {children}
      {/* Expanding/collapsing VideoView overlay — rendered on top of everything.
          position: absolute with explicit width/height covers the screen regardless
          of what view hierarchy the provider sits in. */}
      {overlayVisible && (
        <Animated.View
          style={[
            styles.overlay,
            {
              opacity: animOpacity,
              top: animTop,
              left: animLeft,
              width: animWidth,
              height: animHeight,
            },
          ]}
          pointerEvents="none"
        >
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
            allowsFullscreen={false}
          />
        </Animated.View>
      )}
    </LivePlayerContext.Provider>
  );
}

export function useLivePlayer(): LivePlayerContextValue {
  const ctx = useContext(LivePlayerContext);
  if (!ctx) throw new Error('useLivePlayer must be used inside <LivePlayerProvider>');
  return ctx;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    backgroundColor: '#000',
    overflow: 'hidden',
    zIndex: 9999,
    elevation: 9999, // Android: ensure it's above everything
  },
});
