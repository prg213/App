import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, type ViewStyle } from 'react-native';

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
 * Uses expo-image with cachePolicy="memory-disk" so thumbnails that have
 * already been loaded are served instantly from the persistent disk cache on
 * every subsequent navigation — no re-download, no blurred fallback flash.
 *
 * Render priority:
 *   1. `uri`         — the episode / clip thumbnail (fades in on first load
 *                      only; cached images appear instantly)
 *   2. `fallbackUri` — the series / movie poster, blurred + darkened
 *                      (shown immediately while primary loads OR if primary
 *                      errors; also cached for instant display)
 *   3. shimmer       — animated shimmer when no fallback is available
 *   4. 📺 emoji     — last-resort plain placeholder
 */
export function ThumbnailWithFallback({
  uri,
  fallbackUri,
  style,
  showPlayOverlay = false,
}: ThumbnailWithFallbackProps) {
  const [primaryError, setPrimaryError] = useState(false);
  const [primaryLoaded, setPrimaryLoaded] = useState(false);
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // Reset error/loaded state whenever the URI changes so a new episode that
  // shares the same component instance gets a fresh load attempt instead of
  // inheriting a stale failure or assuming it is already loaded.
  useEffect(() => {
    setPrimaryError(false);
    setPrimaryLoaded(false);
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

  const shimmerOpacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View style={[styles.container, style]}>
      {/* Blurred fallback — visible immediately while primary loads, or on error.
          Cached on disk so repeat visits show it instantly without a network hit. */}
      {showFallbackLayer && (
        <>
          <Image
            source={{ uri: fallbackUri! }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            blurRadius={12}
            cachePolicy="memory-disk"
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

      {/* Primary image — uses memory-disk cache so previously-seen thumbnails
          load instantly on revisit. The transition fade only fires when the
          image isn't already in cache (i.e. the very first load). */}
      {showPrimary && (
        <Image
          source={{ uri: uri! }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={{ duration: 150 }}
          onLoad={() => setPrimaryLoaded(true)}
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
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  playIcon: {
    fontSize: 20,
    color: '#fff',
  },
});
