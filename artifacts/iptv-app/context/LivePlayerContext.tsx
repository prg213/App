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
   * True while the collapse animation is running. index.tsx reads this to
   * skip the VideoView remount (videoKey++) that would cause a black flash —
   * the overlay is still covering the mini-player position at that moment so
   * no remount is needed.
   */
  isCollapsingRef: React.MutableRefObject<boolean>;
  /**
   * Measure the mini-player, animate it expanding to fullscreen, then call
   * `onNavigate`. Falls back to calling `onNavigate` immediately when the
   * ref is unavailable (e.g. recently-watched rail shortcuts).
   */
  triggerExpand: (onNavigate: () => void) => void;
  /**
   * Like `triggerExpand` but measures from `sourceRef` instead of the
   * mini-player. Use when opening fullscreen from a card whose position
   * you already have a ref for (e.g. recently-watched rail cards).
   */
  triggerExpandFromRef: (sourceRef: React.RefObject<View | null>, onNavigate: () => void) => void;
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

  // True while the collapse animation is in flight.  index.tsx skips its
  // VideoView remount (videoKey++) when this is set so that the existing
  // mini-player surface is live and ready the instant the overlay disappears.
  const isCollapsingRef = useRef(false);

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

  // ── triggerExpandFromRef ──────────────────────────────────────────────────
  const triggerExpandFromRef = useCallback(
    (sourceRef: React.RefObject<View | null>, onNavigate: () => void) => {
      const ref = sourceRef.current;
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

          animTop.setValue(rect.y);
          animLeft.setValue(rect.x);
          animWidth.setValue(rect.width);
          animHeight.setValue(rect.height);
          animOpacity.setValue(0);
          setOverlayVisible(true);

          const EXPAND_MS = 320;

          Animated.sequence([
            Animated.timing(animOpacity, {
              toValue: 1,
              duration: 60,
              useNativeDriver: false,
            }),
            Animated.parallel([
              Animated.timing(animTop,    { toValue: 0,       duration: EXPAND_MS, useNativeDriver: false }),
              Animated.timing(animLeft,   { toValue: 0,       duration: EXPAND_MS, useNativeDriver: false }),
              Animated.timing(animWidth,  { toValue: screenW, duration: EXPAND_MS, useNativeDriver: false }),
              Animated.timing(animHeight, { toValue: screenH, duration: EXPAND_MS, useNativeDriver: false }),
            ]),
          ]).start(() => {
            onNavigate();
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
      // Always clear the expand flag.
      wasExpandedRef.current = false;
      // Signal to index.tsx that a collapse is in flight so it can skip the
      // VideoView remount (videoKey++) that would cause a black flash.
      isCollapsingRef.current = true;

      const COLLAPSE_MS = 300;

      const startAnimation = (rect: { x: number; y: number; width: number; height: number }) => {
        // Snap the overlay to full screen, fully opaque — this covers the
        // player screen.  The caller should have already unmounted its own
        // VideoView (via setVideoMounted(false)) so the overlay VideoView is
        // now the sole renderer.  Having two VideoViews share the same player
        // simultaneously causes one of them to go black on Android.
        animTop.setValue(0);
        animLeft.setValue(0);
        animWidth.setValue(screenW);
        animHeight.setValue(screenH);
        animOpacity.setValue(1);
        setOverlayVisible(true);

        // Shrink back to the mini-player position.
        Animated.parallel([
          Animated.timing(animTop,    { toValue: rect.y,      duration: COLLAPSE_MS, useNativeDriver: false }),
          Animated.timing(animLeft,   { toValue: rect.x,      duration: COLLAPSE_MS, useNativeDriver: false }),
          Animated.timing(animWidth,  { toValue: rect.width,  duration: COLLAPSE_MS, useNativeDriver: false }),
          Animated.timing(animHeight, { toValue: rect.height, duration: COLLAPSE_MS, useNativeDriver: false }),
        ]).start(() => {
          // Navigate back — home screen is already rendered beneath us.
          onDone();
          // Give the home screen's mini-player VideoView two frames to
          // re-attach the player before we remove the overlay.  One rAF is
          // enough on most devices but two provides a safety margin for
          // slower JS-to-native commit cycles.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              animOpacity.setValue(0);
              setOverlayVisible(false);
              isCollapsingRef.current = false;
            });
          });
        });
      };

      // Measure the mini-player's current on-screen position.  We do this
      // live every time so the endpoint is accurate even when the player was
      // opened without going through triggerExpand (e.g. recently-watched
      // rail).  Fall back to the last recorded rect if the view returns 0.
      const ref = miniPlayerRef.current;
      if (!ref) {
        onDone();
        return;
      }

      (ref as any).measureInWindow(
        (x: number, y: number, width: number, height: number) => {
          if (width && height) {
            miniRectRef.current = { x, y, width, height };
          }
          const rect = miniRectRef.current;
          if (!rect.width || !rect.height) {
            onDone();
            return;
          }
          // One rAF so the caller's synchronous setValue(0) calls (hiding
          // controls / info bar) have been committed to the native layer
          // before the overlay snaps over the full screen.
          requestAnimationFrame(() => startAnimation(rect));
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animTop, animLeft, animWidth, animHeight, animOpacity, screenW, screenH],
  );

  return (
    <LivePlayerContext.Provider
      value={{ player, activeUrlRef, miniPlayerRef, isCollapsingRef, triggerExpand, triggerExpandFromRef, triggerCollapse }}
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
