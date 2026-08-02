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
 *
 * Animation approach: the overlay is a fixed fullscreen view (top:0, left:0,
 * width:screenW, height:screenH) whose position/size is driven entirely by
 * transform: [translateX, translateY, scaleX, scaleY].  This lets every
 * Animated.timing call use useNativeDriver:true, pushing the animation onto
 * the native UI thread for guaranteed-smooth 60 fps on slower devices.
 *
 * Transform math to make the overlay appear at rect (x, y, w, h):
 *   scaleX     = w / screenW
 *   scaleY     = h / screenH
 *   translateX = x + w/2 - screenW/2
 *   translateY = y + h/2 - screenH/2
 * Fullscreen state: scaleX=1, scaleY=1, translateX=0, translateY=0.
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
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

  // ── Animation timing constants ────────────────────────────────────────────
  // Co-located so future tweaks are one-line changes.
  const EXPAND_MS       = 300;  // transform growth (expand direction)
  const COLLAPSE_MS     = 300;  // transform shrink (collapse direction)
  const FADE_IN_MS      =  60;  // overlay snap-in before expansion
  const FADE_OUT_MS     = 200;  // overlay fade-out after navigation
  // Shared easing curve — out-cubic gives a natural deceleration on both
  // expand and collapse so the two directions feel like a matched pair.
  const TRANSFORM_EASING = Easing.out(Easing.cubic);

  // ── Animated overlay state ────────────────────────────────────────────────
  // The overlay is a fixed fullscreen View.  Its apparent position and size
  // are driven entirely by transform, allowing useNativeDriver: true on all
  // animated values.
  const { width: screenW, height: screenH } = useWindowDimensions();

  // Transform animated values — fullscreen "at rest" values are 0/0/1/1.
  const animTranslateX = useRef(new Animated.Value(0)).current;
  const animTranslateY = useRef(new Animated.Value(0)).current;
  const animScaleX     = useRef(new Animated.Value(1)).current;
  const animScaleY     = useRef(new Animated.Value(1)).current;
  const animOpacity    = useRef(new Animated.Value(0)).current;
  const [overlayVisible, setOverlayVisible] = useState(false);

  // ── Transform helpers ─────────────────────────────────────────────────────
  /**
   * Compute transform values that make the fullscreen overlay appear to occupy
   * the given page-absolute rect.
   */
  const rectToTransform = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => ({
      scaleX:     rect.width  / screenW,
      scaleY:     rect.height / screenH,
      translateX: rect.x + rect.width  / 2 - screenW / 2,
      translateY: rect.y + rect.height / 2 - screenH / 2,
    }),
    [screenW, screenH],
  );

  // ── _runExpandAnimation ───────────────────────────────────────────────────
  // Single source of truth for the expand animation sequence.
  // Both triggerExpand and triggerExpandFromRef delegate here after measuring
  // their respective source views.
  const _runExpandAnimation = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, onNavigate: () => void) => {
      miniRectRef.current = rect;
      wasExpandedRef.current = true;

      const { scaleX, scaleY, translateX, translateY } = rectToTransform(rect);

      // Snap transform to source rect, start transparent
      animTranslateX.setValue(translateX);
      animTranslateY.setValue(translateY);
      animScaleX.setValue(scaleX);
      animScaleY.setValue(scaleY);
      animOpacity.setValue(0);
      setOverlayVisible(true);

      Animated.sequence([
        // Quick fade-in so the overlay snaps visibly before expanding
        Animated.timing(animOpacity, {
          toValue: 1,
          duration: FADE_IN_MS,
          useNativeDriver: true,
        }),
        // Expand transforms to fullscreen (translate → 0,0 ; scale → 1,1)
        Animated.parallel([
          Animated.timing(animTranslateX, { toValue: 0, duration: EXPAND_MS, easing: TRANSFORM_EASING, useNativeDriver: true }),
          Animated.timing(animTranslateY, { toValue: 0, duration: EXPAND_MS, easing: TRANSFORM_EASING, useNativeDriver: true }),
          Animated.timing(animScaleX,     { toValue: 1, duration: EXPAND_MS, easing: TRANSFORM_EASING, useNativeDriver: true }),
          Animated.timing(animScaleY,     { toValue: 1, duration: EXPAND_MS, easing: TRANSFORM_EASING, useNativeDriver: true }),
        ]),
      ]).start(() => {
        // Navigate — the player screen mounts beneath the overlay
        onNavigate();
        // Give the player screen one frame to render, then fade out the overlay
        requestAnimationFrame(() => {
          Animated.timing(animOpacity, {
            toValue: 0,
            duration: FADE_OUT_MS,
            useNativeDriver: true,
          }).start(() => setOverlayVisible(false));
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animTranslateX, animTranslateY, animScaleX, animScaleY, animOpacity, rectToTransform],
  );

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
          _runExpandAnimation({ x, y, width, height }, onNavigate);
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [_runExpandAnimation],
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
          _runExpandAnimation({ x, y, width, height }, onNavigate);
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [_runExpandAnimation],
  );

  // ── triggerCollapse ───────────────────────────────────────────────────────
  const triggerCollapse = useCallback(
    (onDone: () => void) => {
      // Always clear the expand flag.
      wasExpandedRef.current = false;
      // Signal to index.tsx that a collapse is in flight so it can skip the
      // VideoView remount (videoKey++) that would cause a black flash.
      isCollapsingRef.current = true;

      const startAnimation = (rect: { x: number; y: number; width: number; height: number }) => {
        const { scaleX, scaleY, translateX, translateY } = rectToTransform(rect);

        // Snap the overlay to full screen, fully opaque — this covers the
        // player screen.  The caller should have already unmounted its own
        // VideoView (via setVideoMounted(false)) so the overlay VideoView is
        // now the sole renderer.  Having two VideoViews share the same player
        // simultaneously causes one of them to go black on Android.
        animTranslateX.setValue(0);
        animTranslateY.setValue(0);
        animScaleX.setValue(1);
        animScaleY.setValue(1);
        animOpacity.setValue(1);
        setOverlayVisible(true);

        // Shrink transforms back to the mini-player position.
        Animated.parallel([
          Animated.timing(animTranslateX, { toValue: translateX, duration: COLLAPSE_MS, easing: TRANSFORM_EASING, useNativeDriver: true }),
          Animated.timing(animTranslateY, { toValue: translateY, duration: COLLAPSE_MS, easing: TRANSFORM_EASING, useNativeDriver: true }),
          Animated.timing(animScaleX,     { toValue: scaleX,     duration: COLLAPSE_MS, easing: TRANSFORM_EASING, useNativeDriver: true }),
          Animated.timing(animScaleY,     { toValue: scaleY,     duration: COLLAPSE_MS, easing: TRANSFORM_EASING, useNativeDriver: true }),
        ]).start(() => {
          // Navigate back — home screen is already rendered beneath us.
          onDone();
          // Keep the overlay visible for 200 ms after navigation so the
          // mini-player VideoView has time to remount (videoKey++) and its
          // native TextureView surface has time to re-bind to the player.
          // Two rAFs (~32 ms) was not enough on slower devices — the surface
          // hadn't rendered its first frame yet, leaving the mini-player black
          // the instant the overlay disappeared.
          setTimeout(() => {
            animOpacity.setValue(0);
            setOverlayVisible(false);
            isCollapsingRef.current = false;
          }, 200);
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
    [animTranslateX, animTranslateY, animScaleX, animScaleY, animOpacity, rectToTransform],
  );

  return (
    <LivePlayerContext.Provider
      value={{ player, activeUrlRef, miniPlayerRef, isCollapsingRef, triggerExpand, triggerExpandFromRef, triggerCollapse }}
    >
      {children}
      {/* Expanding/collapsing VideoView overlay — rendered on top of everything.
          Fixed fullscreen size; apparent position driven by transform so that
          all animations run on the native UI thread (useNativeDriver: true). */}
      {overlayVisible && (
        <Animated.View
          style={[
            styles.overlay,
            {
              width: screenW,
              height: screenH,
              opacity: animOpacity,
              transform: [
                { translateX: animTranslateX },
                { translateY: animTranslateY },
                { scaleX: animScaleX },
                { scaleY: animScaleY },
              ],
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
    top: 0,
    left: 0,
    backgroundColor: '#000',
    zIndex: 9999,
    elevation: 9999, // Android: ensure it's above everything
  },
});
