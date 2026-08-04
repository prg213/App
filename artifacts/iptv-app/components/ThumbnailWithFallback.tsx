import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View, type ViewStyle } from 'react-native';

interface ThumbnailWithFallbackProps {
  /** Primary thumbnail URI — shown when present and not errored. */
  uri?: string | null;
  /**
   * Fallback URI used as a blurred-poster backdrop when the primary image is
   * absent or fails to load. Rendered at blurRadius=12 with a dark overlay so
   * it reads as an atmospheric placeholder rather than a real thumbnail.
   */
  fallbackUri?: string | null;
  /** Container style — use to set width, height, borderRadius, etc. */
  style?: ViewStyle;
  /**
   * When true, renders a semi-transparent ▶ pill centred over the thumbnail.
   * Defaults to false.
   */
  showPlayOverlay?: boolean;
}

/**
 * Shared thumbnail component used wherever content art can be missing.
 *
 * Render priority:
 *   1. `uri`       — the episode / clip thumbnail (fades in once loaded)
 *   2. `fallbackUri` — the series / movie poster, blurred + darkened
 *                     (shown immediately while primary loads OR if primary errors)
 *   3. shimmer     — animated shimmer when no fallback is available
 *   4. 📺 emoji   — last-resort plain placeholder (no shimmer possible)
 *
 * The primary image fades in (opacity 0→1, ~150 ms) once it finishes loading.
 * While it is still in-flight the blurred fallback (or shimmer) is already
 * visible, eliminating the blank/dark gap on slow connections.
 */
export function ThumbnailWithFallback({
  uri,
  fallbackUri,
  style,
  showPlayOverlay = false,
}: ThumbnailWithFallbackProps) {
  const [primaryError, setPrimaryError] = useState(false);
  const [primaryLoaded, setPrimaryLoaded] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // Reset error/loaded state and opacity whenever the URI changes so a new
  // episode that shares the same component instance gets a fresh load attempt
  // instead of inheriting a stale failure or a fully-opaque image.
  useEffect(() => {
    setPrimaryError(false);
    setPrimaryLoaded(false);
    fadeAnim.setValue(0);
  }, [uri]);

  // Run shimmer loop while waiting for the primary image (and no fallback available)
  useEffect(() => {
    const needsShimmer = !!uri && !primaryLoaded && !primaryError && !fallbackUri;
    if (!needsShimmer) {
      shimmerAnim.stopAnimation();
      shimmerAnim.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [uri, primaryLoaded, primaryError, fallbackUri]);

  const showPrimary = !!uri && !primaryError;

  // Show the blurred fallback layer whenever:
  //   a) primary hasn't finished loading yet (loading placeholder), OR
  //   b) primary errored / no primary URI at all (permanent fallback)
  const showFallbackLayer = !!fallbackUri && (!showPrimary || !primaryLoaded);

  // Show shimmer when primary is loading but there's no fallback to show
  const showShimmer = showPrimary && !primaryLoaded && !fallbackUri;

  // Show emoji only when there's nothing else at all
  const showEmoji = !showPrimary && !fallbackUri;

  const handlePrimaryLoad = () => {
    setPrimaryLoaded(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  const shimmerOpacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View style={[styles.container, style]}>
      {/* Blurred fallback — visible immediately while primary loads, or on error */}
      {showFallbackLayer && (
        <>
          <Image
            source={{ uri: fallbackUri! }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            blurRadius={12}
          />
          <View style={[StyleSheet.absoluteFill, styles.fallbackOverlay]} />
        </>
      )}

      {/* Shimmer placeholder when loading with no fallback */}
      {showShimmer && (
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.shimmer, { opacity: shimmerOpacity }]}
        />
      )}

      {/* Emoji last resort */}
      {showEmoji && <Text style={styles.emptyIcon}>📺</Text>}

      {/* Primary image fades in on top once it has loaded */}
      {showPrimary && (
        <Animated.Image
          source={{ uri: uri! }}
          style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]}
          resizeMode="cover"
          onLoad={handlePrimaryLoad}
          onError={() => setPrimaryError(true)}
        />
      )}

      {showPlayOverlay && (
        <View style={styles.playOverlay}>
          <Text style={styles.playIcon}>▶</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1A1A2E',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackOverlay: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  shimmer: {
    backgroundColor: '#2A2A4A',
  },
  emptyIcon: {
    fontSize: 20,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  playIcon: {
    fontSize: 20,
    color: '#fff',
  },
});
