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
 *   1. `uri`       — the episode / clip thumbnail (hidden on load error)
 *   2. `fallbackUri` — the series / movie poster, blurred + darkened
 *   3. 📺 emoji   — last-resort plain placeholder
 *
 * The primary image fades in (opacity 0→1, ~150 ms) once it finishes loading,
 * hiding any brief flash of the blurred fallback that appears while the image
 * is in-flight.
 */
export function ThumbnailWithFallback({
  uri,
  fallbackUri,
  style,
  showPlayOverlay = false,
}: ThumbnailWithFallbackProps) {
  const [primaryError, setPrimaryError] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Reset error state and opacity whenever the URI changes so a new episode
  // that happens to share the same component instance (same React key,
  // different season) gets a fresh load attempt instead of inheriting a stale
  // failure or a fully-opaque image that shows the wrong frame momentarily.
  useEffect(() => {
    setPrimaryError(false);
    fadeAnim.setValue(0);
  }, [uri]);

  const showPrimary = !!uri && !primaryError;
  const showFallback = !showPrimary && !!fallbackUri;

  const handlePrimaryLoad = () => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={[styles.container, style]}>
      {/* Always render fallback / emoji underneath so it shows while primary loads */}
      {showFallback ? (
        <>
          <Image
            source={{ uri: fallbackUri! }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            blurRadius={12}
          />
          <View style={[StyleSheet.absoluteFill, styles.fallbackOverlay]} />
        </>
      ) : !showPrimary ? (
        <Text style={styles.emptyIcon}>📺</Text>
      ) : null}

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
